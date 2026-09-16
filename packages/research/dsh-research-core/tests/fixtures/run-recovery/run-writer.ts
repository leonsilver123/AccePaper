// Process-boundary fixture, writer side. Runs in its OWN node process:
//
//   node --import tsx/esm tests/fixtures/run-recovery/run-writer.ts --dir <dir> --scenario <s>
//     --base <revision> [--run-id <id>] [--fail-on-value]
//
// Drives a fixture run to a middle step, flushes it through the run persistence layer, writes
// the observable projection next to the snapshot, and prints one report line. The reader
// process sees only the snapshot file — nothing is handed over in memory.
//
// Every value here is fixture data: seeded inputs, literal artifact values, fixture approval ids.

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createRunPersistence } from '../../../src/run-persistence.ts'
import { getRunSnapshot, rollback, startStep } from '../../../src/engine/state-machine.ts'
import { commitStepOutputs } from '../../../src/engine/commit.ts'
import { runStep } from '../../../src/engine/pipeline.ts'
import { createHostApprovalChannel } from '../../../src/host.ts'
import type { ResearchRunStore } from '../../../src/engine/types.ts'
import { abstainVerdict, freshStore, passStep, runFullPipeline, seedRun, submitBound } from '../../helpers.ts'
import { BOUNDARY_RUN_ID, WRITER_APPROVAL_EVENT_ID } from './constants.ts'
import { emitReport, errorInfo, parseArgs, projectRun, requireArg } from './report.ts'

const options = parseArgs(process.argv.slice(2))
const dir = requireArg(options, 'dir')
const scenario = requireArg(options, 'scenario')
const baseRevision = Number(requireArg(options, 'base'))
const runId = options['run-id'] ?? BOUNDARY_RUN_ID

const persistence = createRunPersistence({ dir })

/** Drive the fixture run to the state the scenario is about. */
async function driveScenario(store: ResearchRunStore): Promise<void> {
  if (scenario === 'approved') {
    // All 16 steps driven; E2-submit held at its human gate and then approved through the host
    // channel, which is what consumes the approval event id.
    runFullPipeline(store, runId)
    const channel = createHostApprovalChannel('writer-process-fixture-secret')
    channel.registerPrincipal('fixture-operator')
    channel.submit(
      store,
      runId,
      'E2-submit',
      'approved',
      channel.mintPrincipal(runId, 'E2-submit', 'fixture-operator', WRITER_APPROVAL_EVENT_ID),
    )
    return
  }

  seedRun(store, runId)

  if (scenario === 'mid-run') {
    // Five steps completed, then the sixth interrupted by a failing executor: the state a
    // process that stopped mid-run leaves behind.
    for (const stepId of ['A1-landscape', 'A2-claim', 'A3-agenda', 'A4-venue', 'B1-method']) {
      passStep(store, runId, stepId)
    }
    startStep(store, runId, 'B2-data')
    await runStep(store, runId, 'B2-data', {
      executor: () => {
        throw new Error('fixture: dataset channel unavailable')
      },
    })
    return
  }

  if (scenario === 'abstained') {
    // A held abstention: the run is stopped by the gate, not by a failure.
    startStep(store, runId, 'A1-landscape')
    commitStepOutputs(store, runId, 'A1-landscape', {
      attemptId: 1,
      expectedRevision: getRunSnapshot(store, runId).revision,
      idempotencyKey: 'A1-landscape#1',
      outputs: [
        { slug: 'landscape-map', value: 'writer-process-landscape-map' },
        { slug: 'gap-list', value: 'writer-process-gap-list' },
      ],
    })
    submitBound(store, runId, 'A1-landscape', abstainVerdict('B'))
    return
  }

  if (scenario === 'rollback') {
    // A superseded attempt in history plus artifact invalidation, so the reader can prove the
    // audit trail survives the boundary unchanged.
    passStep(store, runId, 'A1-landscape')
    rollback(store, runId, 'A1-landscape')
    passStep(store, runId, 'A1-landscape')
    startStep(store, runId, 'A2-claim')
    return
  }

  if (scenario === 'unpersistable') {
    // A value JSON cannot represent, injected straight into the run state (the store is a
    // caller-owned Map and its runs are mutable interfaces).
    const run = store.get(runId)
    if (run === undefined) throw new Error('fixture: run missing from its own store')
    run.inputs['fixture-non-json'] = Number.NaN
    return
  }

  if (scenario === 'approved') {
    throw new Error('fixture: the approved scenario is driven above, before the run is seeded')
  }

  throw new Error(`fixture: unknown scenario '${scenario}'`)
}

const store = freshStore()
await driveScenario(store)

const report: Record<string, unknown> = { pid: process.pid, scenario, runId, baseRevision }
try {
  const written = await persistence.save(store, runId, { baseRevision })
  report['revision'] = written.revision
  await writeFile(join(dir, 'expected.json'), JSON.stringify(projectRun(store, runId)), { encoding: 'utf8' })
} catch (error) {
  report['revision'] = null
  Object.assign(report, errorInfo(error))
}
emitReport(report)
