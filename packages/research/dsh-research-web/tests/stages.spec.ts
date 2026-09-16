/**
 * The six-stage grouping: what it covers, and what each stage reports.
 *
 * THE COVERAGE TEST READS THE ENGINE'S OWN CATALOGUE, not a copy kept here. The web package depends
 * on no research package at runtime, so the production import would be a layering break — but a
 * second list of step ids in a fixture is a copy nothing keeps in step, and a step added to the
 * pipeline would then vanish from every stage silently. The spec imports the catalogue's source
 * module directly, which keeps the check mechanical and costs production nothing.
 */
import { describe, expect, it } from 'vitest'
import { STEPS } from '../../dsh-research-core/src/engine/steps.ts'
import { RESEARCH_FIXTURE } from './support/fixture.ts'
import { buildSummary } from '../src/loader.ts'
import {
  STAGES, bucketOf, selectProgress, selectStages, verifyStageCoverage, type StageId,
} from '../src/stages.ts'
import type { RunSummaryInput, StepStatus, StepView } from '../src/summary.ts'

/** The step ids the engine catalogues, in the catalogue's own order. */
function catalogueStepIds(): ReadonlyArray<string> {
  return STEPS.map(definition => String(definition.id))
}

/** One step of a run, in the shape the projection carries. */
function step(stepId: string, status: StepStatus, index: number): StepView {
  return {
    stepId, index, phase: stepId.slice(0, 1) as StepView['phase'], name: stepId,
    status, attempt: status === 'pending' ? 0 : 1, humanGate: false, gateOutcomes: [],
  }
}

/** A run summary carrying exactly the given steps and nothing else. */
function runOf(steps: ReadonlyArray<StepView>) {
  const input: RunSummaryInput = {
    runId: 'run_stages_spec',
    source: 'live',
    status: 'running',
    steps,
    artifacts: [],
    gates: [],
    abstentions: [],
    degradations: [],
    deliverables: [],
  }
  return buildSummary(input)
}

/** A status string from a host newer than this build, as it would arrive over the wire. */
const UNKNOWN_STATUS = 'invented-by-a-newer-host' as unknown as StepStatus

const CATALOGUED = catalogueStepIds()

describe('the stage mapping covers the pipeline', () => {
  it('reads the engine catalogue', () => {
    expect(CATALOGUED).toHaveLength(16)
    expect(CATALOGUED[0]).toBe('A1-landscape')
    expect(CATALOGUED[15]).toBe('E2-submit')
  })

  it('files every catalogued step in exactly one stage', () => {
    const coverage = verifyStageCoverage(CATALOGUED)
    expect(coverage.unmapped).toEqual([])
    expect(coverage.unknown).toEqual([])
    const filed = STAGES.flatMap(stage => [...stage.stepIds])
    expect(new Set(filed).size).toBe(filed.length)
  })

  it('reports a step the mapping does not file', () => {
    // NON-VACUITY: coverage is a comparison, not a constant. A step the pipeline gained and the
    // mapping has not been told about is what this reports.
    const coverage = verifyStageCoverage([...CATALOGUED, 'F1-forecast'])
    expect(coverage.unmapped).toEqual([{ stepId: 'F1-forecast' }])
    expect(verifyStageCoverage(CATALOGUED.slice(0, 3)).unknown).not.toEqual([])
  })

  it('keeps the stages in pipeline order', () => {
    const order = STAGES.map(stage => stage.id)
    expect(order).toEqual<ReadonlyArray<StageId>>(
      ['intake', 'literature', 'method', 'results', 'writing', 'delivery'])
    const positions = STAGES.flatMap(stage => stage.stepIds.map(id => CATALOGUED.indexOf(id)))
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
  })

  it('reports on no step in the intake group', () => {
    // The question, the material and the confirmed plan are not a seventeenth executed step, and a
    // stage that reported one would claim work the pipeline never did.
    expect(STAGES.find(stage => stage.id === 'intake')?.stepIds).toEqual([])
  })
})

describe('stage state comes from the steps own outcomes', () => {
  const statuses = (overrides: Readonly<Record<string, StepStatus>>) =>
    runOf(CATALOGUED.map((id, index) => step(id, overrides[id] ?? 'pending', index + 1)))

  it('reports a failure ahead of everything else in the stage', () => {
    const stages = selectStages(statuses({ 'C1-mvp': 'failed', 'C2-trinity-loop': 'in_progress' }))
    expect(stages.find(stage => stage.id === 'results')?.state).toBe('failed')
  })

  it('keeps a decision waiting on a person apart from progress', () => {
    const stages = selectStages(statuses({ 'E2-submit': 'gated', 'E1-format': 'passed', 'D4-rebuttal': 'passed' }))
    const delivery = stages.find(stage => stage.id === 'delivery')
    expect(delivery?.state).toBe('awaiting-human')
    expect(delivery?.counts['awaiting-human']).toBe(1)
    expect(delivery?.counts.working).toBe(0)
  })

  it('counts a status it cannot name as unknown, and blocks on it', () => {
    // Folding this into `not-started` would report a step the host advanced as untouched.
    expect(bucketOf('unknown')).toBe('unknown')
    expect(bucketOf(UNKNOWN_STATUS)).toBe('unknown')
    const stages = selectStages(statuses({ 'A1-landscape': UNKNOWN_STATUS }))
    expect(stages.find(stage => stage.id === 'literature')?.state).toBe('blocked')
    expect(stages.find(stage => stage.id === 'literature')?.counts.unknown).toBe(1)
  })

  it('calls a stage done only when every step it reports passed', () => {
    const stages = selectStages(statuses({ 'A1-landscape': 'passed', 'A2-claim': 'passed', 'A3-agenda': 'passed' }))
    expect(stages.find(stage => stage.id === 'literature')?.state).toBe('not-started')
    const all = selectStages(runOf(CATALOGUED.map((id, index) => step(id, 'passed', index + 1))))
    expect(all.filter(stage => stage.steps.length > 0).every(stage => stage.state === 'done')).toBe(true)
  })

  it('names the earliest stage still standing between the run and a later one', () => {
    const stages = selectStages(statuses({ 'A2-claim': 'in_progress', 'C1-mvp': 'in_progress' }))
    expect(stages.find(stage => stage.id === 'delivery')?.missingPrerequisites).toEqual(['literature'])
    expect(stages.find(stage => stage.id === 'literature')?.missingPrerequisites).toEqual([])
  })
})

describe('progress is counted, never estimated', () => {
  it('counts what the run did and totals what the pipeline catalogues', () => {
    const summary = runOf(CATALOGUED.map((id, index) =>
      step(id, index < 5 ? 'passed' : index === 5 ? 'gated' : 'pending', index + 1)))
    const progress = selectProgress(summary)
    expect(progress).toEqual({
      stepsPassed: 5, stepsTotal: 16, awaitingHuman: 1, failed: 0, unknown: 0,
    })
    // NO PERCENTAGE AND NO REMAINING TIME: the fields a reader could mistake for a promise are not
    // on this view at all, so no component can render one.
    expect(Object.keys(progress).sort()).toEqual(
      ['awaitingHuman', 'failed', 'stepsPassed', 'stepsTotal', 'unknown'])
  })

  it('counts the fixture run it did not invent', () => {
    const progress = selectProgress(buildSummary(RESEARCH_FIXTURE))
    expect(progress.stepsTotal).toBe(16)
    expect(progress.awaitingHuman).toBeGreaterThan(0)
  })
})
