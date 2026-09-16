/**
 * D4's model path, driven by a reply rather than by an issue built in code.
 *
 * THE GAP THIS CLOSES. Every existing test of the revision cycle constructs `RevisionIssue` values
 * in TypeScript and hands them to `applyRevision`. That checks the applier and says nothing about
 * the parser, which is the part a model actually talks to — and the parser had three silent
 * failure modes:
 *
 *   - `PATCH: NONE` and a `PATCH` line that is missing entirely produced the same value, so a
 *     malformed reply was recorded as `accepted_explanation`. The comment beside that code claimed
 *     the two were distinguishable. They were not;
 *   - an exchange missing its `SECTION` was `return`ed out of the accumulator, so a reply with
 *     three exchanges of which two were malformed produced one issue and the step PASSED;
 *   - `PATCH:` with nothing after it fell into the same branch as a missing line.
 *
 * The reply it was checking against was, in every case, one this repository wrote. The browser run
 * proved the happy path works on a real model reply — three exchanges, all three patched, three
 * sections revised and four not — and that evidence is why the shape below is what it is. What it
 * could not prove is that the parser REFUSES anything, which is what these tests are for.
 */

import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { getArtifact, getRunSnapshot, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'

import { runT19B } from '../src/runner/drive.ts'
import { assertWellFormed, parseReply } from '../src/runner/issue-parse.ts'
import { comparePlatoons, experimentStudy } from '../src/runner/platoon-sim.ts'
import type { ResearchProseRequest, ResearchProseWriter } from '../src/runner/registry.ts'
import { DEFAULT_PLAN } from '../src/runner/study-plan.ts'
import { loadCasePack, planCasePackInputs } from '../src/runner/case-pack.ts'

/** The tracked traffic pack, reused rather than duplicated (one data system, not two). */
const CASE_PACK_DIR = join(process.cwd(), 'plan/overnight/2026-09-09/case-pack-traffic')

const MEASURED = comparePlatoons(experimentStudy())
const BASELINE = (Math.round(MEASURED.baseline.minTtcSeconds * 100) / 100).toFixed(2)
const VARIANT = (Math.round(MEASURED.variant.minTtcSeconds * 100) / 100).toFixed(2)
const CHANGE = (Math.round(MEASURED.relativeImprovementPct * 100) / 100).toFixed(2)

/** The reply the real browser run produced, in the shape it produced it. */
const WELL_FORMED = [
  'CONCERN: The variant differs from the baseline in several parameters at once.',
  'SECTION: method',
  'RESPONSE: The parameters are the declared vehicle classes and are stated in full.',
  'PATCH: Both platoons are run with the Intelligent Driver Model at a fixed 0.02 s step.'
  + ' Full parameter disclosure is given for both classes.',
  'CONCERN: The conclusion may overstate the scope of the measurement.',
  'SECTION: conclusion',
  'RESPONSE: The scope sentence is tightened.',
  `PATCH: Under the declared configuration the platoon minimum time-to-collision changed by ${CHANGE}%, measured inside the study's own car-following model.`,
  'CONCERN: The results section does not report the baseline value.',
  'SECTION: results',
  'RESPONSE: The baseline value is added, keeping every sentence the section needs.',
  `PATCH: The homogeneous platoon held ${BASELINE} s of minimum time-to-collision and the mixed platoon ${VARIANT} s, a change of ${CHANGE}%. Both are read from the same result record.`,
].join('\n')

/** A reply whose second exchange never says which section it is about. */
const MALFORMED = [
  'CONCERN: The method section is too terse.',
  'SECTION: method',
  'RESPONSE: It is expanded.',
  'PATCH: The Intelligent Driver Model at a 0.02 s step, stated in full.',
  'CONCERN: The conclusion overstates the scope.',
  'RESPONSE: It is tightened.',
  'PATCH: The scope sentence now says what was measured.',
].join('\n')

/** The prose D3 asks for, section by section, in words that survive the A gate. */
function d3Section(request: ResearchProseRequest): string {
  switch (request.context['sectionId']) {
    case 'method':
      return 'Both platoons are run with the Intelligent Driver Model at a fixed 0.02 s step and'
        + ' differ only in composition: an HV-HV-HV baseline against an HV-AV-HV variant.'
    case 'results':
      return `The homogeneous platoon held ${BASELINE} s of minimum time-to-collision and the mixed`
        + ` platoon ${VARIANT} s, a change of ${CHANGE}%.`
    case 'conclusion':
      return 'The mixed platoon lowered the platoon minimum time-to-collision by'
        + ` ${String(Math.abs(Number(CHANGE)))}% under the declared disturbance.`
    case 'experiments':
      return 'Both platoons were run for 240 s after a 120 s warm-up under one declared disturbance.'
    case 'references':
      return 'The records the landscape scan retrieved, listed below.'
    default:
      return 'This section states what the run measured and nothing the run did not.'
  }
}

/**
 * A writer that answers each step in that step's own format.
 *
 * D3 is answered per section because that is how D3 asks. Driving D3 through the model path here is
 * deliberate: it had no test either, and a revision can only be tested end to end if the draft it
 * revises was written the same way the product writes one.
 */
function stagedWriter(d4Reply: string): ResearchProseWriter {
  return {
    channel: 'llm',
    write(request) {
      const text = (() => {
        switch (request.stepId) {
          case 'D4-rebuttal':
            return d4Reply
          case 'D3-writing':
            return d3Section(request)
          // Injecting a writer routes EVERY prose step through it, so the steps before D3 must be
          // answered in their own formats or the run never reaches the step under test. Each reply
          // below is what that step's instruction asks for; A2's prediction is the plan's own,
          // which the C gate has already been shown to accept.
          case 'A1-landscape':
            return 'The interaction between platoon composition and reaction delay is unresolved.'
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
          default:
            return 'The run states what it measured and nothing it did not.'
        }
      })()
      return Promise.resolve({ text, provider: 'test-provider', model: 'test-model' })
    },
  }
}

async function revisedRun(d4Reply: string): Promise<{
  store: ResearchRunStore
  runId: string
  rebuttal: Record<string, unknown> | undefined
  revised: Record<string, unknown> | undefined
  draft: Record<string, unknown> | undefined
}> {
  const store: ResearchRunStore = new Map()
  // THE SHIPPED CASE PACK, because the A channel reads the claim's declared SCOPE and DATA SOURCE
  // from it. Without a pack the model path produces claim material with those two fields empty, the
  // A gate abstains at A2, and the run never reaches D4 — which is how this test found out that a
  // model-written claim and a pack-written claim are not the same material.
  const run = await runT19B(store, {
    // THE SHAPE THE BROWSER RUN HAD: a plan the caller supplies (which is what a person confirming
    // a proposal produces) plus the deployment's pack, which supplies the claim's declared scope
    // and data source. Both are needed and for different reasons — without the pack the A channel
    // has no scope to read, and without a caller plan the pack's own claim is used instead of the
    // run's, which the C gate holds on.
    studyPlan: DEFAULT_PLAN,
    proseWriter: stagedWriter(d4Reply),
    casePackInputs: planCasePackInputs(loadCasePack(CASE_PACK_DIR)),
  })
  return {
    store,
    runId: run.runId,
    rebuttal: getArtifact(store, run.runId, 'rebuttal') as Record<string, unknown> | undefined,
    revised: getArtifact(store, run.runId, 'revised-draft') as Record<string, unknown> | undefined,
    draft: getArtifact(store, run.runId, 'draft') as Record<string, unknown> | undefined,
  }
}

describe('the reply parser tells three intentions apart', () => {
  it('reads a well-formed reply into one issue per exchange, discarding nothing', () => {
    const reply = parseReply(WELL_FORMED)
    expect(reply.discarded).toEqual([])
    expect(reply.issues).toHaveLength(3)
    expect(reply.issues.map(issue => issue.sectionId)).toEqual(['method', 'conclusion', 'results'])
    expect(reply.issues.every(issue => issue.patchState === 'replacement')).toBe(true)
  })

  it('reads PATCH: NONE as a conclusion, not as a missing line', () => {
    const reply = parseReply([
      'CONCERN: A concern the author will answer without touching the text.',
      'SECTION: results',
      'RESPONSE: The scope sentence already states this limit.',
      'PATCH: NONE',
    ].join('\n'))
    expect(reply.discarded).toEqual([])
    expect(reply.issues[0]?.patchState).toBe('declared-none')
    expect(reply.issues[0]?.patch).toBeUndefined()
  })

  it('reports a missing PATCH line rather than reading it as an acceptance', () => {
    // THE SILENT DEFAULT. Before this, an absent `PATCH` line meant `requiresTextChange: false`,
    // which the applier records as `accepted_explanation` — the run would have said the author
    // answered the concern when the reply simply did not follow the format.
    const reply = parseReply([
      'CONCERN: A concern the reply never finishes.',
      'SECTION: results',
      'RESPONSE: An answer with no statement about the text.',
    ].join('\n'))
    expect(reply.issues).toEqual([])
    expect(reply.discarded).toHaveLength(1)
    expect(reply.discarded[0]?.missing).toEqual(['PATCH'])
    expect(reply.discarded[0]?.exchange).toBe(1)
  })

  it('reports a PATCH line stated with nothing after it', () => {
    // `PATCH:` parses to the empty string. The reply meant to propose a body and did not, which is
    // malformed — it is not `NONE`, and the difference is the whole point of the value.
    const reply = parseReply([
      'CONCERN: A concern with an empty patch.',
      'SECTION: results',
      'RESPONSE: An answer.',
      'PATCH:',
    ].join('\n'))
    expect(reply.issues).toEqual([])
    expect(reply.discarded[0]?.missing).toEqual(['PATCH'])
  })

  it('reports every label a malformed exchange is missing, with its position', () => {
    const reply = parseReply(MALFORMED)
    expect(reply.issues).toHaveLength(1)
    expect(reply.issues[0]?.sectionId).toBe('method')
    expect(reply.discarded).toHaveLength(1)
    expect(reply.discarded[0]?.exchange).toBe(2)
    expect(reply.discarded[0]?.missing).toEqual(['SECTION'])
  })

  it('ignores a preamble, because introducing an answer is not malforming it', () => {
    const reply = parseReply(`Here are the exchanges this paper must answer.\n\n${WELL_FORMED}`)
    expect(reply.discarded).toEqual([])
    expect(reply.issues).toHaveLength(3)
  })

  it('refuses a reply with no exchange at all', () => {
    expect(() => assertWellFormed(parseReply('I have no comments on this manuscript.'), 'D4-rebuttal'))
      .toThrow(/no CONCERN exchange/u)
  })

  it('refuses a reply that stated only some of its exchanges, naming which', () => {
    expect(() => assertWellFormed(parseReply(MALFORMED), 'D4-rebuttal')).toThrow(
      /did not state 1 of its 2 exchanges completely[\s\S]*#2 \(missing SECTION\)/u,
    )
  })
})

describe('D4 driven by a model reply', () => {
  it('applies the three patches and marks exactly the sections they changed', async () => {
    const { rebuttal, revised, draft } = await revisedRun(WELL_FORMED)
    expect(rebuttal?.['rebuttalSource']).toBe('model')
    expect(rebuttal?.['discardedExchanges']).toEqual([])

    // THE MEASUREMENT THE REVIEW MADE, inverted: the bodies are NOT all identical, the sections
    // that changed are exactly the ones patched, and nothing else claims to have been revised.
    // SORTED, because the two lists are ordered by different things and neither is wrong:
    // `patchedSections` follows the order the reply raised its issues, and the draft's sections
    // follow the outline. Comparing them in one order would be asserting a coincidence.
    const sorted = (values: ReadonlyArray<string>): ReadonlyArray<string> => [...values].sort()
    expect(sorted(rebuttal?.['patchedSections'] as ReadonlyArray<string>))
      .toEqual(['conclusion', 'method', 'results'])
    expect(rebuttal?.['openIssues']).toEqual([])
    const issues = rebuttal?.['issues'] as ReadonlyArray<{ disposition: string }>
    expect(issues.map(issue => issue.disposition)).toEqual(['patched', 'patched', 'patched'])

    const before = draft?.['sections'] as ReadonlyArray<{ id: string; bodyText: string }>
    const after = revised?.['sections'] as ReadonlyArray<{ id: string; bodyText: string; revised: boolean }>
    const changed = after.filter((section, index) => section.bodyText !== before[index]?.bodyText)
    expect(changed.map(section => section.id)).toEqual(['method', 'results', 'conclusion'])
    expect(after.filter(section => section.revised).map(section => section.id))
      .toEqual(['method', 'results', 'conclusion'])
  })

  it('passes its own gate on the revised manuscript', async () => {
    const { store, runId } = await revisedRun(WELL_FORMED)
    const snap = getRunSnapshot(store, runId)
    expect(snap.steps['D4-rebuttal']?.status).toBe('passed')
    expect(snap.steps['D4-rebuttal']?.gateResults.A?.outcome).toBe('passed')
    // The gate read the REVISED draft, not the one D3 wrote.
    expect(String(snap.steps['D4-rebuttal']?.gateResults.A?.evidence)).toContain('revised-draft')
  })

  it('records a PATCH: NONE exchange as an explanation and applies nothing', async () => {
    const reply = [
      'CONCERN: A concern the author answers without changing the text.',
      'SECTION: results',
      'RESPONSE: The scope sentence already states this limit, so no text changes.',
      'PATCH: NONE',
    ].join('\n')
    const { rebuttal } = await revisedRun(reply)
    const issues = rebuttal?.['issues'] as ReadonlyArray<{ disposition: string; reason: string }>
    expect(issues).toHaveLength(1)
    expect(issues[0]?.disposition).toBe('accepted_explanation')
    expect(rebuttal?.['patchedSections']).toEqual([])
    expect(rebuttal?.['openIssues']).toEqual([])
  })

  it('FAILS the step on a malformed reply instead of closing an issue on nothing', async () => {
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, {
      studyPlan: DEFAULT_PLAN,
      proseWriter: stagedWriter(MALFORMED),
      casePackInputs: planCasePackInputs(loadCasePack(CASE_PACK_DIR)),
    })
    const d4 = run.steps.find(step => step.stepId === 'D4-rebuttal')
    expect(d4?.status).toBe('in_progress')
    expect(d4?.executeError).toMatch(/did not state 1 of its 2 exchanges completely/u)
    expect(d4?.executeError).toMatch(/#2 \(missing SECTION\)/u)
    // Nothing downstream was produced from a reply the pipeline could not read.
    expect(getArtifact(store, run.runId, 'revised-draft')).toBeUndefined()
    expect(getArtifact(store, run.runId, 'formatted-manuscript')).toBeUndefined()
  })
})
