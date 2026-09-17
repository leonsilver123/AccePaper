/**
 * The argument plan a DRIVEN run records, and the obligations its sections discharge.
 *
 * THE TWO TASKS ARE THE CONTROL. Both are the same deterministic study — the same measurement, the
 * same −38.2% — and they differ only in what the claim committed to. One of them is refuted by its own
 * measurement and one is supported by it, so a plan that was written for one paper would oblige the
 * sections of the other to say the opposite of what happened. What the sections owe therefore has to
 * come from the run, and these tests read the run's own artifacts rather than the module's interface.
 */
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { getArtifact, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { runT19B } from '../src/runner/drive.ts'
import { loadCasePack, planCasePackInputs } from '../src/runner/case-pack.ts'
import { ARGUMENT_PLAN_VERSION } from '../src/runner/argument-plan.ts'
import { DEFAULT_PLAN } from '../src/runner/study-plan.ts'
import type { ResearchProseWriter } from '../src/runner/registry.ts'
import type { ArgumentPlan } from '../src/runner/argument-plan.ts'

/** A SECOND TASK: the same study, a claim that commits to a decrease. Synthetic, test-owned. */
const DECREASE_PACK_DIR = fileURLToPath(new URL('./fixtures/case-pack-decrease', import.meta.url))

/** The Case Pack the deployment ships, which the run under test is seeded with. */
const CASE_PACK_DIR = join(process.cwd(), 'plan/overnight/2026-09-09/case-pack-traffic')

/** The plan a driven run recorded on its draft. */
function planOfRun(store: ResearchRunStore, runId: string): ArgumentPlan {
  const draft = getArtifact(store, runId, 'draft') as { argumentPlan?: ArgumentPlan }
  if (draft.argumentPlan === undefined) throw new Error('the draft recorded no argument plan')
  return draft.argumentPlan
}

/** The section bodies a driven run assembled, by id. */
function sectionsOfRun(store: ResearchRunStore, runId: string): ReadonlyMap<string, string> {
  const draft = getArtifact(store, runId, 'draft') as {
    sections: ReadonlyArray<{ id: string; bodyText: string }>
  }
  return new Map(draft.sections.map(section => [section.id, section.bodyText]))
}

describe('the plan a run records, on the task that refutes its own claim', () => {
  it('says the measurement refuted the claim, and obliges the reporting sections to say so', async () => {
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store)
    const plan = planOfRun(store, run.runId)
    expect(plan.outcome).toBe('refuted')
    expect(plan.version).toBe(ARGUMENT_PLAN_VERSION)
    // Every section the outline declares has a contract, including the job it is for.
    const results = plan.sections.find(section => section.id === 'results')
    expect(results?.obligations.map(obligation => obligation.kind))
      .toContain('adverse-result')
    expect(results?.job.length ?? 0).toBeGreaterThan(20)
  })

  it('wrote sections that state the measurement, its direction and the contradiction', async () => {
    // WHAT THE DELIVERED PAPER'S SECTIONS DO NOT SAY. The three that report an outcome each state the
    // measured change, the direction in words, and that it contradicts the claim.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store)
    const sections = sectionsOfRun(store, run.runId)
    for (const id of ['abstract', 'results', 'conclusion']) {
      const body = sections.get(id) ?? ''
      expect(body, id).toMatch(/38\.2\d*%/)
      expect(body, id).toMatch(/fell/iu)
      expect(body, id).toMatch(/contradict/iu)
    }
  })

  it('records what each section was written from, beside the plan it was written under', async () => {
    // A LOG THAT CAN REBUILD THE DECISION: the evidence a section was supplied, the evidence it
    // required, and the plan revision it was judged against.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store)
    const draft = getArtifact(store, run.runId, 'draft') as {
      sectionEvidence: ReadonlyArray<{ sectionId: string; required: ReadonlyArray<string>; missing: ReadonlyArray<string> }>
      argumentPlan: ArgumentPlan
    }
    const results = draft.sectionEvidence.find(entry => entry.sectionId === 'results')
    expect(results?.required).toContain('result')
    expect(results?.missing).toEqual([])
    expect(draft.argumentPlan.version).toBe(ARGUMENT_PLAN_VERSION)
  })
})

describe('the same study under a claim that predicted the measurement', () => {
  it('records a supported claim, and asks its sections for the direction instead of a contradiction', async () => {
    // THE SECOND TASK FAMILY. Nothing about the study changed — the simulation, the measurement and
    // the figures are the same — and what the sections owe changed with the claim, which is the whole
    // reason the plan is derived from the run rather than written for a paper.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, {
      casePackInputs: planCasePackInputs(loadCasePack(DECREASE_PACK_DIR)),
    })
    const plan = planOfRun(store, run.runId)
    expect(plan.outcome).toBe('supported')
    const results = plan.sections.find(section => section.id === 'results')
    expect(results?.obligations.map(obligation => obligation.kind))
      .toEqual(['measured-change', 'direction-of-change'])
    // AND THE MANUSCRIPT IT ASSEMBLED SAYS SO IN ITS OWN WORDS, so the sections and the plan agree on
    // a task whose outcome is the opposite of the shipped one.
    const sections = sectionsOfRun(store, run.runId)
    expect(sections.get('results')).toMatch(/the change the claim predicted/iu)
  })
})


/**
 * A writer that answers every step in its format and writes D3 sections that report no outcome.
 *
 * It is the shape that matters: a writer that fails an earlier step never reaches the one under test,
 * so every other reply is conforming and the defect is exactly one omission — the sections state what
 * the study is about and never what it measured or what that did to the claim.
 */
function writerStatingNoOutcome(): ResearchProseWriter {
  return {
    channel: 'llm',
    write(request) {
      const text = (() => {
        switch (request.stepId) {
          case 'A2-claim':
            return [
              `ASSERTION: ${DEFAULT_PLAN.claim.assertion}`,
              `DIFFERENCE: ${DEFAULT_PLAN.claim.essentialDifference}`,
              `EXPERIMENT: ${DEFAULT_PLAN.claim.experimentToFalsify}`,
              `PREDICTION: ${DEFAULT_PLAN.claim.prediction}`,
            ].join('\n')
          case 'A3-agenda':
            return [
              'PHASES: declare the study | measure both platoons | report the boundary',
              'CONTRIBUTIONS: a measured comparison | a stated boundary | a reproducible rule version',
            ].join('\n')
          case 'B1-method':
            return [
              'FAMILY: a family the model declared',
              'STEPS: build both platoons | integrate | measure',
              `METRIC: ${DEFAULT_PLAN.metric.key}`,
              'DIRECTION: higher is better',
            ].join('\n')
          case 'D2-framework':
            return [
              `TITLE: ${DEFAULT_PLAN.title}`,
              `SECTIONS: ${DEFAULT_PLAN.outline.map(section => section.heading).join(' | ')}`,
            ].join('\n')
          case 'D4-rebuttal':
            return [
              'CONCERN: The introduction does not position the work against prior findings.',
              'SECTION: introduction',
              'RESPONSE: The position is stated in the revised draft.',
              'PATCH: NONE',
            ].join('\n')
          case 'D3-writing': {
            // THE OMISSION UNDER TEST: prose about the study that never states its measurement. The
            // citations are named, so the manuscript passes the citation check and fails on exactly
            // one thing — the outcome no section reports.
            const citations = Array.isArray(request.context['citations'])
              ? (request.context['citations'] as ReadonlyArray<{ citeKey?: unknown }>)
              : []
            const markers = citations
              .flatMap(entry => (typeof entry.citeKey === 'string' ? [`[@${entry.citeKey}]`] : []))
              .join(' ')
            return 'This section discusses the platoon and the autonomous vehicle it carries, the'
              + ` conditions both platoons were run under, and what is already known ${markers}.`
          }
          default:
            return 'The run states what it measured and nothing it did not.'
        }
      })()
      return Promise.resolve({ text, provider: 'spec', model: 'spec' })
    },
  }
}

describe('a run whose sections do not report the outcome', () => {
  it('is refused at assembly, naming the obligation and the section', async () => {
    // THE DELIVERED PAPER'S FAILURE, REFUSED: every section reads as a section, the manuscript
    // assembles, and nowhere does it state what the study measured or what that did to its claim.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, {
      studyPlan: DEFAULT_PLAN,
      proseWriter: writerStatingNoOutcome(),
      casePackInputs: planCasePackInputs(loadCasePack(CASE_PACK_DIR)),
    })
    const e1 = run.steps.find(step => step.stepId === 'E1-format')
    expect(e1?.status).toBe('in_progress')
    expect(e1?.executeError).toContain('argument-obligation-unmet')
    expect(e1?.executeError).toContain("the 'results' section owes 'states-measured-change'")
    expect(getArtifact(store, run.runId, 'formatted-manuscript')).toBeUndefined()
  })
})
