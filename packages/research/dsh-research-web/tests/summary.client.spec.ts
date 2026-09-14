/**
 * Pure model tests for the research run summary view-model.
 *
 * These run against the fixture-driven transformation only (no React, no
 * `@deepseek-ai/*` runtime imports) so they verify the render data model
 * contract: given a flattened summary input, the derived {@link RunSummary} must
 * surface the fields the {@link ResearchView} renders (run status, 16-step
 * progress, artifact counts, gate history, abstention, degradation, E2
 * human-pending). Naming follows `*.client.spec.ts` so it rides the client
 * tsconfig program when the package is wired in.
 */
import { describe, expect, it } from 'vitest'
import { RESEARCH_FIXTURE, FIXTURE_RUN_ID } from '../src/fixture.ts'
import { loadFixtureSummary, buildSummary } from '../src/loader.ts'
import { toRunSummary, type RunSummaryInput } from '../src/summary.ts'
import { summaryInputFrom } from '../src/run-source.ts'

describe('toRunSummary — derived counters', () => {
  const summary = loadFixtureSummary()

  it('surfaces the run id and mock flag', () => {
    expect(summary.runId).toBe(FIXTURE_RUN_ID)
    expect(summary.isMock).toBe(true)
  })

  it('counts exactly 16 steps', () => {
    expect(summary.totalSteps).toBe(16)
  })

  it('computes per-status counts from the fixture', () => {
    expect(summary.byStatus.passed).toBe(14)
    expect(summary.byStatus.gated).toBe(2) // s08 (gate_abstained) + s15 (human_gate)
    expect(summary.byStatus.failed).toBe(0)
    expect(summary.byStatus.blocked).toBe(0)
    expect(summary.byStatus.in_progress).toBe(0)
    expect(summary.byStatus.pending).toBe(0)
    const total =
      summary.byStatus.passed + summary.byStatus.gated + summary.byStatus.failed
      + summary.byStatus.blocked + summary.byStatus.in_progress + summary.byStatus.pending
    expect(total).toBe(16)
  })

  it('counts artifacts including one invalidated entry', () => {
    expect(summary.artifactCount).toBe(9)
    expect(summary.validArtifactCount).toBe(8) // design_v1 is invalidated
  })

  it('flags abstention and degradation presence', () => {
    expect(summary.hasAbstention).toBe(true)
    expect(summary.hasDegradation).toBe(true)
  })

  it('isolates the E2 human-pending step (humanGate, not resolved)', () => {
    expect(summary.humanPending).toHaveLength(1)
    expect(summary.humanPending[0]?.stepId).toBe('s15')
    expect(summary.humanPending[0]?.humanGate).toBe(true)
    expect(summary.humanPending[0]?.holdReason).toBe('human_gate')
  })
})

describe('toRunSummary — gate history & abstention shape', () => {
  const summary = loadFixtureSummary()

  it('carries every gate verdict with its outcome', () => {
    const outcomes = summary.gates.map(g => `${g.stepId}:${g.component}=${g.outcome}`)
    expect(outcomes).toContain('s08:A=abstained')
    expect(outcomes).toContain('s08:B=passed')
    expect(outcomes).toContain('s12:C=passed')
    // abstained outcome must be recorded verbatim, never collapsed to failed
    const abstained = summary.gates.find(g => g.component === 'A' && g.stepId === 's08')
    expect(abstained?.outcome).toBe('abstained')
    expect(abstained?.passed).toBe(false)
  })

  it('records the abstention freeze with its reason code', () => {
    expect(summary.abstentions).toHaveLength(1)
    const a = summary.abstentions[0]!
    expect(a.stepId).toBe('s08')
    expect(a.component).toBe('A')
    expect(a.reasonCode).toBe('INSUFFICIENT_EVIDENCE')
    expect(a.recordedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('carries degradation notes (step-scoped + run-level)', () => {
    const kinds = summary.degradations.map(d => d.kind)
    expect(kinds).toContain('quality') // s16
    expect(kinds).toContain('coverage') // run-level
    expect(summary.degradations.some(d => d.stepId === 's16')).toBe(true)
  })
})

describe('buildSummary — adapter entry point', () => {
  it('accepts a mapped input and produces the same model shape', () => {
    const mapped: RunSummaryInput = {
      runId: 'run_mapped_xyz',
      source: 'fixture',
      status: 'completed',
      steps: [
        { stepId: 's01', index: 1, phase: 'A', name: 'X', status: 'passed', attempt: 1, humanGate: false, gateOutcomes: [] },
      ],
      artifacts: [],
      gates: [],
      abstentions: [],
      degradations: [],
      deliverables: [],
    }
    const summary = buildSummary(mapped)
    expect(summary.runId).toBe('run_mapped_xyz')
    expect(summary.totalSteps).toBe(1)
    expect(summary.byStatus.passed).toBe(1)
    expect(summary.humanPending).toHaveLength(0)
  })

  it('treats a humanGate step still pending as human-pending (not auto-completed)', () => {
    const input: RunSummaryInput = {
      runId: 'run_hp', source: 'fixture', status: 'running',
      steps: [
        { stepId: 'e2', index: 15, phase: 'E', name: 'Human', status: 'pending', attempt: 0, humanGate: true, gateOutcomes: [] },
      ],
      artifacts: [], gates: [], abstentions: [], degradations: [], deliverables: [],
    }
    const summary = toRunSummary(input)
    expect(summary.humanPending.map(s => s.stepId)).toEqual(['e2'])
  })
})

describe('summaryInputFrom — what the run left on disk', () => {
  it('maps the package and the snapshot into separate deliverables', () => {
    // The Host has reported both since the export and the durable snapshot landed; the view
    // received them and rendered nothing, so a person asking where the files went had no answer in
    // the product. They stay separate entries because either can succeed while the other fails.
    const input = summaryInputFrom({
      run: { runId: 'run-1', steps: [] },
      catalog: [],
      gates: [],
      artifacts: [],
      steps: [],
      packageExport: { files: [{ path: 'run-manifest.json', bytes: 12, sha256: 'ab' }] },
      runPersistence: { runId: 'run-1', revision: 3, interrupted: [] },
    })

    expect(input.deliverables).toEqual([
      { kind: 'package', files: [{ path: 'run-manifest.json', bytes: 12 }], revision: null },
      { kind: 'snapshot', files: [], revision: 3 },
    ])
  })

  it('carries a refusal and a supersession through rather than reporting success', () => {
    const input = summaryInputFrom({
      run: { runId: 'run-1', steps: [] },
      catalog: [],
      gates: [],
      artifacts: [],
      steps: [],
      packageExport: { files: [], error: 'refused: the destination is not writable' },
      runPersistence: {
        runId: 'run-1',
        revision: null,
        interrupted: [],
        error: 'EPERM: rename',
      },
    })

    expect(input.deliverables[0]?.error).toContain('not writable')
    expect(input.deliverables[1]?.revision).toBeNull()
    expect(input.deliverables[1]?.error).toContain('EPERM')
  })

  it('reports nothing when the deployment configured no outputs', () => {
    const input = summaryInputFrom({
      run: { runId: 'run-1', steps: [] },
      catalog: [],
      gates: [],
      artifacts: [],
      steps: [],
    })
    expect(input.deliverables).toEqual([])
  })
})

describe('summaryInputFrom — a step that failed mid-execution', () => {
  it('carries the execution error, so the view can name the cause', () => {
    // An independent audit fed a real response through this mapping and found the step reaching
    // the view as `in_progress` with no field carrying the cause: the engine keeps a
    // failed-execution step `in_progress` because it is rollback-able, so status alone reads as
    // "still working". The user saw a run that had already stopped, with nothing saying why.
    const input = summaryInputFrom({
      run: {
        runId: 'run-1',
        steps: [{
          stepId: 'A2-claim',
          status: 'in_progress',
          attemptId: 1,
          kind: 'real_tool_fixture_input',
          producer: 'claim-construct@1.0.0',
          outputSlugs: [],
          artifacts: [],
          verdicts: {},
          usedRealTool: true,
          executeStatus: 'error',
          executeError: '[A2-claim] the model response did not carry ASSERTION/DIFFERENCE/EXPERIMENT/PREDICTION',
        }],
      },
      catalog: [{ id: 'A2-claim', index: 2, phase: 'A', name: 'claim', humanGate: false, gate: ['A', 'C'] }],
      gates: [],
      artifacts: [],
      steps: [{ stepId: 'A2-claim', status: 'in_progress', attempt: 1, holdReason: null }],
    })

    const step = input.steps.find(candidate => candidate.stepId === 'A2-claim')
    expect(step?.status).toBe('in_progress')
    expect(step?.executeStatus).toBe('error')
    expect(step?.executeError).toContain('did not carry ASSERTION')
  })
})

describe('loadFixtureSummary — determinism', () => {
  it('returns an equal model on repeated calls (pure)', () => {
    expect(loadFixtureSummary()).toEqual(loadFixtureSummary())
    expect(RESEARCH_FIXTURE.runId).toBe(FIXTURE_RUN_ID)
  })
})
