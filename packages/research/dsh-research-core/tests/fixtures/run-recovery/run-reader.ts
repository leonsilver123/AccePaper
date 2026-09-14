// Process-boundary fixture, reader side. Runs in its OWN node process, started after the writer
// process has exited:
//
//   node --import tsx/esm tests/fixtures/run-recovery/run-reader.ts --dir <dir> --scenario <s>
//     [--run-id <id>] [--schema <n>]
//
// Restores the run from the snapshot file, observes the recovery invariants (completed steps are
// not re-executed, artifacts / gates / abstentions / audit trail survive, a consumed approval id
// stays consumed, an interrupted attempt is resumable), continues the run through a capability
// this process constructed, and prints one report line. The spec asserts on that report.
//
// Every value here is fixture data.

import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { createRunPersistence } from '../../../src/run-persistence.ts'
import { canStart, completeStep, getArtifact, getRunSnapshot, rollback, startStep } from '../../../src/engine/state-machine.ts'
import { runStep } from '../../../src/engine/pipeline.ts'
import { createHostApprovalChannel } from '../../../src/host.ts'
import { BOUNDARY_RUN_ID, WRITER_APPROVAL_EVENT_ID } from './constants.ts'
import { emitReport, errorInfo, parseArgs, projectRun, requireArg } from './report.ts'

const options = parseArgs(process.argv.slice(2))
const dir = requireArg(options, 'dir')
const scenario = requireArg(options, 'scenario')
const runId = options['run-id'] ?? BOUNDARY_RUN_ID

const persistence = createRunPersistence({
  dir,
  ...(options['schema'] !== undefined ? { schemaVersion: Number(options['schema']) } : {}),
})

/** The stable code a call reports, or 'NONE' when it did not throw. */
async function codeOf(fn: () => unknown): Promise<string> {
  try {
    await fn()
    return 'NONE'
  } catch (error) {
    return errorInfo(error).errorCode
  }
}

const report: Record<string, unknown> = { pid: process.pid, scenario, runId }
try {
  const restored = await persistence.load({ marker: 'READER-CAPABILITY-MARKER', execute: (slug: string) => `reader:${slug}` })
  report['capabilityIdentity'] = restored.capability.execute('x') === 'reader:x'
  report['revision'] = restored.revision
  report['savedAtIso'] = restored.savedAtIso
  report['consumedApprovalEventIds'] = restored.consumedApprovalEventIds
  report['interrupted'] = restored.interrupted
  report['projection'] = projectRun(restored.store, runId)
  await writeFile(join(dir, 'restored.json'), JSON.stringify(report['projection']), { encoding: 'utf8' })

  // Completed steps must not be re-executed: neither startable nor executable, and the
  // executor this process owns must never be invoked for them.
  let executions = 0
  const executor = (): Record<string, unknown> => {
    executions += 1
    return {}
  }
  const completedSteps: Array<Record<string, unknown>> = []
  for (const step of Object.values(getRunSnapshot(restored.store, runId).steps)) {
    if (step.status !== 'passed' && step.status !== 'blocked') continue
    completedSteps.push({
      stepId: step.stepId,
      canStart: canStart(restored.store, runId, step.stepId),
      startErrorCode: await codeOf(() => startStep(restored.store, runId, step.stepId)),
      runStepErrorCode: await codeOf(() => runStep(restored.store, runId, step.stepId, { executor })),
    })
  }
  report['completedSteps'] = completedSteps
  report['executions'] = executions

  if (scenario === 'mid-run') {
    // The interrupted step is resumable on THIS process's capability.
    rollback(restored.store, runId, 'B2-data')
    startStep(restored.store, runId, 'B2-data')
    const res = await runStep(restored.store, runId, 'B2-data', {
      executor: () => ({ dataset: 'reader-process-dataset', 'data-profile': 'reader-process-data-profile' }),
    })
    report['continued'] = {
      status: res.status,
      outputSlugs: res.outputSlugs,
      dataset: getArtifact(restored.store, runId, 'dataset'),
      // The upstream artifact written by the WRITER process is still the writer's value.
      upstreamLandscape: getArtifact(restored.store, runId, 'landscape-map'),
    }
  }

  if (scenario === 'abstained') {
    const channel = createHostApprovalChannel('reader-process-fixture-secret')
    channel.registerPrincipal('fixture-operator')
    const principal = channel.mintPrincipal(runId, 'A1-landscape', 'fixture-operator', 'reader-approval-1')
    report['abstentionRelease'] = await codeOf(() => channel.submit(restored.store, runId, 'A1-landscape', 'approved', principal))
  }

  if (scenario === 'approved') {
    // The restored run is running again: a new attempt on E2-submit, approved with the id the
    // WRITER process consumed, must be refused; a fresh id must still release the gate.
    rollback(restored.store, runId, 'E2-submit')
    startStep(restored.store, runId, 'E2-submit')
    const gateStatus = completeStep(restored.store, runId, 'E2-submit')
    const channel = createHostApprovalChannel('reader-process-fixture-secret')
    channel.registerPrincipal('fixture-operator')
    const replayed = await codeOf(() =>
      channel.submit(
        restored.store,
        runId,
        'E2-submit',
        'approved',
        channel.mintPrincipal(runId, 'E2-submit', 'fixture-operator', WRITER_APPROVAL_EVENT_ID),
      ),
    )
    const fresh = await codeOf(() =>
      channel.submit(
        restored.store,
        runId,
        'E2-submit',
        'approved',
        channel.mintPrincipal(runId, 'E2-submit', 'fixture-operator', 'reader-approval-fresh'),
      ),
    )
    report['replay'] = { gateStatus, replayedCode: replayed, freshCode: fresh }
    report['finalE2Status'] = getRunSnapshot(restored.store, runId).steps['E2-submit']?.status
  }
} catch (error) {
  Object.assign(report, errorInfo(error))
  report['revision'] = null
}
emitReport(report)
