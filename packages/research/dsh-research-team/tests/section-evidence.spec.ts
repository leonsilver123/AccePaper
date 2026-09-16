/**
 * Every section is written from the run's own evidence, and a section with none is refused.
 *
 * The defect (the review's R2): `D3-writing` handed the model a context of LABELS —
 * `{ field, direction, sectionId, claimRef, figureCount, citable }` — where `citable` is a list of
 * float labels rather than the data behind them. The method spec, the measured result, the figure
 * plan and the literature records were all in the run and none of them reached the writer, so a
 * faithful model was asked to describe results it had never been shown. The only thing standing
 * between that and an invented number was the model's restraint.
 *
 * The fix has two halves, and the second is the one that holds. The request now carries the run's
 * material for that section, and a section whose required evidence is absent is NOT WRITTEN AT ALL
 * — not by the model, and not from the built-in fixture sentences either. A manuscript with a
 * silently-filled Methods section is the failure this pipeline exists to prevent, and `bodyTextFor`
 * produced exactly that: honest about being a fixture, and still a complete-looking paper.
 */

import { describe, expect, it } from 'vitest'
import { getArtifact, getStepDefinitions } from '@deepseek-ai/dsh-research-core'
import type { ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import type { LiteratureSearchAdapter, LiteratureSearchOutcome } from '@deepseek-ai/dsh-research-tools'

import { runT19B } from '../src/runner/drive.ts'
import { sectionEvidenceFor } from '../src/runner/section-evidence.ts'
import type { SectionEvidenceInput } from '../src/runner/section-evidence.ts'
import { readinessOfRun, submissionReadinessOf } from '../src/runner/submission-readiness.ts'
import { resultVersionOf } from '../src/runner/result-version.ts'
import { comparePlatoons, experimentStudy } from '../src/runner/platoon-sim.ts'
import { IDM_PLATOON_IMPLEMENTATION } from '../src/runner/implementations.ts'
import { SUPPORT_ASSESSMENTS } from '../src/runner/evidence-corpus.ts'
import { DEFAULT_PLAN } from '../src/runner/study-plan.ts'

/** A study plan's worth of evidence, as `D3-writing` assembles it from the run. */
function evidenceInput(overrides: Partial<SectionEvidenceInput> = {}): SectionEvidenceInput {
  return {
    metricKey: DEFAULT_PLAN.metric.key,
    metricLabel: DEFAULT_PLAN.metric.label,
    metricUnit: DEFAULT_PLAN.metric.unit,
    metricDirection: DEFAULT_PLAN.metric.direction,
    result: resultVersionOf(comparePlatoons(experimentStudy()), DEFAULT_PLAN.metric.key),
    method: {
      family: `${IDM_PLATOON_IMPLEMENTATION.algorithm} (${IDM_PLATOON_IMPLEMENTATION.version})`,
      steps: ['simulate the baseline', 'simulate the variant', 'compare'],
      implementation: {
        id: IDM_PLATOON_IMPLEMENTATION.id,
        version: IDM_PLATOON_IMPLEMENTATION.version,
        algorithm: IDM_PLATOON_IMPLEMENTATION.algorithm,
      },
      modelDeclaredFamily: 'a family the model declared',
    },
    figures: { figures: [{ kind: 'data-figure', label: 'Figure 1' }, { kind: 'three-line-table', label: 'Table 1' }] },
    landscape: { hits: [{ title: 'A record', venue: 'A venue', ref: { kind: 'doi', id: '10.1/a' } }] },
    assessments: SUPPORT_ASSESSMENTS,
    ...overrides,
  }
}

/** A retrieval that succeeded and found nothing: a real state, and the one that empties a section. */
function emptyAdapter(): LiteratureSearchAdapter {
  return {
    search(): Promise<LiteratureSearchOutcome> {
      return Promise.resolve({ status: 'ok', hits: [], total: 0 })
    },
  }
}

describe('a section is written from named evidence', () => {
  it('gives the Results section the numbers, the unit and the code that produced them', () => {
    const evidence = sectionEvidenceFor('results', evidenceInput())
    expect(evidence.missing).toEqual([])
    const result = evidence.supplied['result'] as Record<string, unknown>
    expect(result['baseline']).toBeGreaterThan(0)
    expect(result['variant']).toBeGreaterThan(0)
    expect(result['changePct']).toEqual(expect.any(Number))
    expect(result['unit']).toBe(DEFAULT_PLAN.metric.unit)
    // WHICH code produced the numbers. Without it a Methods section can name a version that ran
    // nothing, which is the R1a defect one level down.
    expect(result['ruleVersion']).toBe(IDM_PLATOON_IMPLEMENTATION.version)
  })

  it('gives the Method section the implementation AND the execution deviation', () => {
    const evidence = sectionEvidenceFor('method', evidenceInput())
    expect(evidence.missing).toEqual([])
    const method = evidence.supplied['method'] as Record<string, unknown>
    expect(method['implementation']).toMatchObject({ id: IDM_PLATOON_IMPLEMENTATION.id })
    // The model's own answer travels too, kept apart from the derived family, so a reviewer can see
    // a model that described a different experiment.
    expect(method['modelDeclaredFamily']).toBe('a family the model declared')
    expect(evidence.supplied['execution']).toMatchObject({
      methodVersion: IDM_PLATOON_IMPLEMENTATION.version,
      matchesMethod: true,
    })
  })

  it('says when the method and the execution DISAGREE', () => {
    // Two artifacts in one run naming different rule versions is a manuscript whose Method section
    // describes code that did not produce its numbers. The flag is what makes it visible.
    const evidence = sectionEvidenceFor('method', evidenceInput({
      result: resultVersionOf(
        comparePlatoons(experimentStudy()),
        DEFAULT_PLAN.metric.key,
        1,
        'a-rule-version-that-never-ran',
      ),
    }))
    expect(evidence.supplied['execution']).toMatchObject({
      ruleVersion: 'a-rule-version-that-never-ran',
      matchesMethod: false,
    })
  })

  it('gives the Experiments section the run accounting a reader needs to judge the numbers', () => {
    const evidence = sectionEvidenceFor('experiments', evidenceInput())
    expect(evidence.missing).toEqual([])
    expect(evidence.supplied['accounting']).toMatchObject({
      runs: 1,
      repeated: false,
      deterministic: true,
      fieldData: false,
    })
  })

  it('gives the Discussion both sides of the reviewed literature', () => {
    const evidence = sectionEvidenceFor('discussion', evidenceInput())
    expect(evidence.missing).toEqual([])
    const reviewed = evidence.supplied['reviewed-evidence'] as ReadonlyArray<Record<string, unknown>>
    // A counter-source that never reaches the writer is the same defect as one that never reaches
    // the gate: the section would be written as though the literature agreed.
    expect(reviewed.map(entry => entry['verdict'])).toContain('supports')
    expect(reviewed.map(entry => entry['verdict'])).toContain('does_not_support')
    expect(reviewed.every(entry => typeof entry['scope'] === 'string')).toBe(true)
    expect(reviewed.every(entry => String(entry['scope']).length > 0)).toBe(true)
  })
})

describe('a section with no evidence is refused, not filled', () => {
  it('refuses the Results section when the run holds no measured result', () => {
    const evidence = sectionEvidenceFor('results', evidenceInput({ result: undefined }))
    expect(evidence.missing).toEqual(['result'])
    expect(evidence.supplied['result']).toBeUndefined()
    // The figures are still there: a refusal names what is missing rather than discarding the rest.
    expect(evidence.supplied['figures']).toBeDefined()
  })

  it('refuses the Method section when the run holds no method spec', () => {
    const evidence = sectionEvidenceFor('method', evidenceInput({ method: undefined }))
    expect(evidence.missing).toEqual(['method', 'execution'])
  })

  it('refuses a section id the outline names but nothing declared requirements for', () => {
    // The outline is the plan's, so a plan may name a section this table has never heard of.
    // Writing it from whatever happens to be present is the guess this refusal replaces.
    const evidence = sectionEvidenceFor('limitations', evidenceInput())
    expect(evidence.missing).toEqual(['section-definition'])
  })

  it('refuses the References section when the retrieval returned nothing', () => {
    const evidence = sectionEvidenceFor('references', evidenceInput({ landscape: { hits: [] } }))
    expect(evidence.missing).toEqual(['records'])
  })
})

describe('the driven draft records what each section was written from', () => {
  it('writes every section of the study run, and refuses none of them', async () => {
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store)
    const draft = getArtifact(store, run.runId, 'draft') as
      | {
        refusedSections?: ReadonlyArray<string>
        sectionEvidence?: ReadonlyArray<{ sectionId: string; supplied: ReadonlyArray<string>; missing: ReadonlyArray<string> }>
      }
      | undefined
    expect(draft?.refusedSections).toEqual([])
    // The record is per section, and every section names the evidence it was written from. A draft
    // carrying only prose cannot tell a section backed by the run's measurement from one the model
    // filled in, and neither can a reviewer.
    expect(draft?.sectionEvidence?.map(entry => entry.sectionId)).toContain('results')
    const results = draft?.sectionEvidence?.find(entry => entry.sectionId === 'results')
    expect(results?.supplied).toContain('result')
    expect(results?.missing).toEqual([])
    const method = draft?.sectionEvidence?.find(entry => entry.sectionId === 'method')
    expect(method?.supplied).toContain('execution')
  })
})

describe('a refused section makes the run not ready', () => {
  const allPassed = getStepDefinitions().map(definition => ({
    stepId: definition.id,
    status: 'passed',
    humanGate: definition.humanGate,
  }))

  it('is ready only when every section had its evidence', () => {
    expect(submissionReadinessOf('production', allPassed, true, []).ready).toBe(true)
  })

  it('is not ready when a section was refused, and says which', () => {
    const readiness = submissionReadinessOf('production', allPassed, true, ['method', 'results'])
    expect(readiness.ready).toBe(false)
    expect(readiness.reason).toContain('method, results')
    // The manuscript exists and every gate closed. The hole is the reason, and nothing here may
    // report the run as finished.
    expect(readiness.manuscriptProduced).toBe(true)
    expect(readiness.profileEligible).toBe(true)
  })

  it('refuses a section end to end when the run retrieved no records at all', async () => {
    // THE FALSIFICATION. A retrieval that succeeded and found nothing is a real state — the corpus
    // is empty, so there are no references to list — and before this change D3 wrote the built-in
    // sentence describing that and produced a complete-looking paper.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, {
      evidenceProfile: 'production',
      toolDeps: { literatureAdapter: emptyAdapter() },
    })
    const draft = getArtifact(store, run.runId, 'draft') as
      | { refusedSections?: ReadonlyArray<string>; sections?: ReadonlyArray<{ id: string; bodyText: string }> }
      | undefined
    expect(draft?.refusedSections).toEqual(['references'])
    // Not filled, and not written by the model either: an empty body is the visible hole.
    expect(draft?.sections?.find(section => section.id === 'references')?.bodyText).toBe('')
    // Every other section still had its evidence, so only the one is missing.
    expect(draft?.sections?.find(section => section.id === 'results')?.bodyText).not.toBe('')

    // THE HOLE STOPS THE RUN RATHER THAN REACHING A READER. `assembleManuscript` already refused an
    // empty section body (`DSH_MANUSCRIPT_EMPTY_SECTION`), so E1 cannot format a manuscript with a
    // section D3 declined to write — the refusal propagates instead of being formatted away. That
    // guard is older than this change and this is the first time anything produced a section for it
    // to catch.
    const e1 = run.steps.find(step => step.stepId === 'E1-format')
    expect(e1?.executeError).toContain('DSH_MANUSCRIPT_EMPTY_SECTION')
    expect(getArtifact(store, run.runId, 'formatted-manuscript')).toBeUndefined()

    // And readiness reports the run it actually is: eligible, and not ready.
    const readiness = readinessOfRun(store, run.runId, 'production')
    expect(readiness.ready).toBe(false)
    expect(readiness.manuscriptProduced).toBe(false)
  })

  it('would refuse a manuscript whose draft already recorded a refused section', () => {
    // The second line of defence, and it is a line of defence rather than the mechanism: E1 above
    // is what a run actually hits. A draft that reached readiness carrying a refused section is not
    // ready whatever else is true of it.
    const allPassed = getStepDefinitions().map(definition => ({
      stepId: definition.id,
      status: 'passed',
      humanGate: definition.humanGate,
    }))
    const readiness = submissionReadinessOf('production', allPassed, true, ['references'])
    expect(readiness.ready).toBe(false)
    expect(readiness.reason).toContain('references')
  })
})

describe('the reviewer’s own verdict is what the writer is told', () => {
  it('carries the assessment’s rationale and scope, not just a verdict word', () => {
    const evidence = sectionEvidenceFor('discussion', evidenceInput())
    const reviewed = evidence.supplied['reviewed-evidence'] as ReadonlyArray<Record<string, unknown>>
    for (const entry of reviewed) {
      expect(String(entry['rationale']).length).toBeGreaterThan(80)
      expect(String(entry['scope']).length).toBeGreaterThan(80)
    }
  })
})
