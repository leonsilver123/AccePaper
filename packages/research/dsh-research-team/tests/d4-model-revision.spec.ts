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
import { createHostApprovalChannel } from '@deepseek-ai/dsh-research-core/host'
import type { HostApprovalChannel } from '@deepseek-ai/dsh-research-core/host'

import { runT19B } from '../src/runner/drive.ts'
import type { ResolutionVerifier } from '../src/runner/resolution-verifier.ts'
import { assertWellFormed, parseReply } from '../src/runner/issue-parse.ts'
import { comparePlatoons, experimentStudy } from '../src/runner/platoon-sim.ts'
import type { ResearchProseRequest, ResearchProseWriter } from '../src/runner/registry.ts'
import { DEFAULT_PLAN } from '../src/runner/study-plan.ts'
import { loadCasePack, planCasePackInputs } from '../src/runner/case-pack.ts'
import { openIssuesOf, readinessOfRun } from '../src/runner/submission-readiness.ts'

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
  // THE PATCH NAMES THE FLOATS TOO: the revised manuscript is what the gate reads, and a results
  // section that stopped naming Figure 1 and Table 1 would be refused for carrying floats nothing
  // refers to.
  'PATCH: The comparison is drawn in Figure 1 and its two values are listed in Table 1; Figure 2'
  + ` shows how the study reaches it. The homogeneous platoon held ${BASELINE} s of`
  + ` minimum time-to-collision and the mixed platoon ${VARIANT} s, a change of ${CHANGE}%. Both are`
  + ' read from the same result record.',
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
    case 'abstract':
      // THE ABSTRACT REPORTS THE OUTCOME, so it owes the measurement, its direction and what it did to
      // the claim — the three obligations the sections that report an outcome carry.
      return 'We ask whether one autonomous vehicle changes the platoon minimum time-to-collision'
        + ` under a declared disturbance. It fell by ${CHANGE}%, contradicting the claim this study`
        + ' committed to test.'
    case 'results':
      // THE PROSE NAMES THE FLOATS THE DRAFT CARRIES — the A gate refuses a draft that carries a
      // float no sentence refers to, and the reply is what a writer following the roster produces.
      return 'The comparison the claim is about is drawn in Figure 1 and its values are listed in'
        + ` Table 1. The homogeneous platoon held ${BASELINE} s of minimum time-to-collision and the`
        + ` mixed platoon ${VARIANT} s, a change of ${CHANGE}%: the quantity fell, contradicting the`
        + ' claim this study committed to test. Figure 2 shows how the study reaches that comparison.'
    case 'conclusion':
      return 'The mixed platoon lowered the platoon minimum time-to-collision by'
        + ` ${String(Math.abs(Number(CHANGE)))}% under the declared disturbance, contradicting the`
        + ' claim this study committed to test.'
    case 'experiments':
      return 'Both platoons were run for 240 s after a 120 s warm-up under one declared disturbance.'
    case 'introduction': {
      // THE WRITER'S CONTRACT INCLUDES CITING, and this reply follows it the way a model following the
      // instruction would: every reviewed source the request lists is named by its key. The keys come
      // out of the REQUEST, not out of this test, so the reply cites what the run actually bound.
      const citations = Array.isArray(request.context['citations'])
        ? (request.context['citations'] as ReadonlyArray<{ citeKey?: unknown }>)
        : []
      const markers = citations
        .flatMap(entry => (typeof entry.citeKey === 'string' ? [`[@${entry.citeKey}]`] : []))
        .join(' ')
      return 'Prior work on this quantity is not unanimous, and the reviewed sources disagree about'
        + ` the sign of the effect ${markers}.`
    }
    case 'references':
      return 'The reviewed sources this paper cites, listed below.'
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
function stagedWriter(d4Reply: string | ReadonlyArray<string>): ResearchProseWriter {
  // A revision CYCLE asks more than once, so the writer answers round by round. A single reply is
  // returned for every round, which is what a model that ignores `openIssues` looks like.
  const d4Replies = typeof d4Reply === 'string' ? [d4Reply] : d4Reply
  let d4Round = 0
  return {
    channel: 'llm',
    write(request) {
      const text = (() => {
        switch (request.stepId) {
          case 'D4-rebuttal': {
            const reply = d4Replies[Math.min(d4Round, d4Replies.length - 1)] ?? ''
            d4Round += 1
            return reply
          }
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

/**
 * The one approval channel this file decides through.
 *
 * The host creates it once at startup and refuses a second creation, which is the behaviour under
 * test elsewhere; here it just means the tests share one.
 *
 * @returns the channel, with this deployment's single registered operator.
 */
function approvalChannel(): HostApprovalChannel {
  if (channel === undefined) {
    channel = createHostApprovalChannel('spec-secret')
    channel.registerPrincipal(OPERATOR)
  }
  return channel
}

/** The operator this deployment's host attests. */
const OPERATOR = 'human-1'

let channel: HostApprovalChannel | undefined

async function revisedRun(
  d4Reply: string | ReadonlyArray<string>,
  options: { readonly revisionRounds?: number; readonly verifier?: ResolutionVerifier } = {},
): Promise<{
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
    ...(options.revisionRounds === undefined ? {} : { revisionRounds: options.revisionRounds }),
    ...(options.verifier === undefined ? {} : { resolutionVerifier: options.verifier }),
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

describe('a revision round that leaves a concern open', () => {
  it('asks again for a concern the first round could not close', async () => {
    // A CONCERN THE MANUSCRIPT STILL CARRIES. The first round's Method patch replaces the body with
    // the text D3 already wrote, so the applier refuses it as no-diff and leaves that concern OPEN.
    // One round used to be the whole cycle: the round number was hard-coded to 1 and there was
    // nothing to try again. The second round is told what is still open and closes it.
    const sameBody = d3Section({ stepId: 'D3-writing', instruction: '', context: { sectionId: 'method' } })
    const first = [
      'CONCERN: The method section is terse.',
      'SECTION: method',
      'RESPONSE: It is restated.',
      `PATCH: ${sameBody}`,
      'CONCERN: The results section does not report the baseline value.',
      'SECTION: results',
      'RESPONSE: The baseline value is added.',
      // THE PATCH STILL DISCHARGES WHAT THE SECTION OWES: a revision of a section that reports the
      // outcome must state the measurement, its direction and what it did to the claim, or E1 refuses
      // the manuscript — a revision is not a way to drop them.
      'PATCH: The comparison is drawn in Figure 1 and its two values are listed in Table 1; Figure 2'
      + ` shows how the study reaches it. The homogeneous platoon held ${BASELINE} s of`
      + ` minimum time-to-collision and the mixed platoon ${VARIANT} s, a change of ${CHANGE}%: the`
      + ' quantity fell, contradicting the claim this study committed to test. The baseline value is'
      + " reported here as this study's own reference row.",
    ].join('\n')
    // The second round answers the ONE concern that is still open, against the body as it now is.
    const second = [
      'CONCERN: The method section is terse.',
      'SECTION: method',
      'RESPONSE: Every parameter the two vehicle classes declare is listed.',
      'PATCH: Both platoons are run with the Intelligent Driver Model at a fixed 0.02 s step, and the'
      + ' parameters each vehicle class declares are listed in the table above.',
    ].join('\n')

    const { store, runId, rebuttal } = await revisedRun([first, second])

    // NOTHING IS OPEN AND NOTHING IS CLOSED EITHER: this deployment has no verifier, so every patch
    // the two rounds applied is still waiting for a reader. A run that called this `closed` would be
    // reporting a settled review over answers nobody had read — the early stop the review named — and
    // the cycle stops for the reason that says so: asking for another round would produce the same
    // answers, and only a reader can settle what is there.
    expect(rebuttal?.['openIssues']).toEqual([])
    expect(rebuttal?.['stoppedBecause']).toBe('awaiting-verification')
    const rounds = rebuttal?.['rounds'] as ReadonlyArray<Record<string, unknown>>
    expect(rounds.map(round => round['roundId'])).toEqual(['t19s-rebuttal-1', 't19s-rebuttal-2'])
    expect(rounds[0]?.['openSections']).toEqual(['method'])
    // THE LAST ROUND'S ISSUE IS THE ONE STILL WAITING, and its id is `d4-issue-1` because a round
    // numbers its own issues from one — the ids are per round, which is why every other reader in this
    // file is asked for the round it belongs to.
    expect(rebuttal?.['awaitingVerification']).toEqual(['d4-issue-1'])

    // Every gate closed and a person approved the package — and the run is STILL NOT READY, because
    // the answers nobody read are part of what "ready" means. This is the disagreement the pipeline
    // review named: readiness and the final package were two copies of the conditions, so a run whose
    // revisions had never been read carried `submissionReady: true` in its manifest while the export
    // refused it. They are one evaluation now, and this is the case that tells them apart.
    const decide = approvalChannel()
    decide.submit(store, runId, 'E2-submit', 'approved',
      decide.mintPrincipal(runId, 'E2-submit', OPERATOR, 'evt-open-issue'))

    const readiness = readinessOfRun(store, runId, 'production')
    expect(readiness.ready).toBe(false)
    expect(readiness.reason).toContain('waiting for a reader')
  })

  it('stops when another round could not change anything, and leaves the concern open', async () => {
    // THE SAME ROUND TWICE IS NOT PROGRESS. A model that ignores the open concerns writes the same
    // reply again and the applier refuses the same patch again. A third ask would spend the budget
    // to learn nothing, so the cycle stops — and the concern stays open, which is what blocks
    // readiness.
    const sameBody = d3Section({ stepId: 'D3-writing', instruction: '', context: { sectionId: 'method' } })
    const stuck = [
      'CONCERN: The method section is terse.',
      'SECTION: method',
      'RESPONSE: It is restated.',
      `PATCH: ${sameBody}`,
    ].join('\n')

    const { store, runId, rebuttal } = await revisedRun(stuck)

    expect(rebuttal?.['stoppedBecause']).toBe('no-progress')
    const rounds = rebuttal?.['rounds'] as ReadonlyArray<Record<string, unknown>>
    expect(rounds).toHaveLength(2)
    expect(rounds[1]?.['stoppedBecause']).toBe('no-progress')
    expect((rebuttal?.['openIssues'] as ReadonlyArray<string>).length).toBeGreaterThan(0)

    const decide = approvalChannel()
    decide.submit(store, runId, 'E2-submit', 'approved',
      decide.mintPrincipal(runId, 'E2-submit', OPERATOR, 'evt-stuck-issue'))

    const readiness = readinessOfRun(store, runId, 'production')
    expect(readiness.ready).toBe(false)
    // THE SAME SENTENCE THE FINAL PACKAGE REPORTS, because it is the same check: readiness used to
    // have its own wording for this and could drift from the export's.
    expect(readiness.reason).toContain('left')
    expect(readiness.reason).toContain("on 'method'")
    expect(readiness.reason).toContain('open')
  })

  it('asks as many times as the deployment configured, and no more', async () => {
    // THE BOUND IS CONFIGURATION. A deployment that will not pay for a second attempt says so; the
    // cycle it gets is one round, and the concern stays open — which is what blocks readiness. The
    // alternative reading, a hard-coded bound, would make the same manuscript cost whatever the
    // executor's author decided.
    const sameBody = d3Section({ stepId: 'D3-writing', instruction: '', context: { sectionId: 'method' } })
    const stuck = [
      'CONCERN: The method section is terse.',
      'SECTION: method',
      'RESPONSE: It is restated.',
      `PATCH: ${sameBody}`,
    ].join('\n')

    const { rebuttal } = await revisedRun(stuck, { revisionRounds: 1 })

    const rounds = rebuttal?.['rounds'] as ReadonlyArray<Record<string, unknown>>
    expect(rounds).toHaveLength(1)
    expect(rebuttal?.['revisionRounds']).toBe(1)
    // One round, and it did not close the concern: the budget is what stopped it.
    expect(rebuttal?.['stoppedBecause']).toBe('budget')
  })

  it('reads a second time when the first round closed everything and the policy requires two', async () => {
    // THE FLOOR, ON THE PRODUCTION PATH. The first reply patches the results section and closes
    // the issue it raised; under the default policy that is ONE reading, so the cycle asks for a
    // second one instead of stopping — the early stop the review named.
    const reply = [
      'CONCERN: The results section states no comparison.',
      'SECTION: results',
      'RESPONSE: The comparison is stated.',
      'PATCH: The comparison against this study baseline is stated in Table 1.',
    ].join('\n')
    // A READER IS CONFIGURED, because that is the configuration the floor is for: with one, the first
    // round's patches are answered and the round CLOSES — and a closed first round is exactly what
    // used to end the review. Without one the issues simply wait, which is a different stop.
    const { rebuttal } = await revisedRun([reply, reply], { verifier: acceptingReviewer() })
    const rounds = rebuttal?.['rounds'] as ReadonlyArray<Record<string, unknown>>
    // TWO READINGS WERE TAKEN, not one that happened to close everything it found.
    expect(rounds.length).toBeGreaterThanOrEqual(2)
    expect(rebuttal?.['revisionRounds']).toBeGreaterThanOrEqual(2)
  })

  it('does not read a reason the applier did not give as if it had', () => {
    // The reader states what it found and nothing more: an outcome with no reason is reported as
    // one rather than invented into a plausible sentence.
    expect(openIssuesOf({ issues: [{ issueId: 'i1', sectionId: 'method', disposition: 'open' }] }))
      .toEqual([{ issueId: 'i1', sectionId: 'method', reason: 'no reason recorded' }])
    // And an outcome the round produced something for is not an open issue — whether that something
    // ANSWERS the concern is the verifier's reading, not this reader's.
    expect(openIssuesOf({ issues: [{ issueId: 'i1', disposition: 'pending-verification' }] })).toEqual([])
    expect(openIssuesOf({ issues: [{ issueId: 'i1', disposition: 'answered' }] })).toEqual([])
    expect(openIssuesOf(undefined)).toEqual([])
  })
})

describe('who counts as a second reader', () => {
  it('accepts one model holding both roles, because the EXECUTIONS are what differ', async () => {
    // THE USER'S RULING OF 2026-09-18, on the production path: "a different model may not substitute
    // for these conditions, and the same model must not be refused for being the same model". The
    // staged writer states `test-provider/test-model` and this reviewer reads on that same route, so
    // they share it — and the reading is still valid, because the host started it as its own
    // execution, in its own session, under the reviewer's own rules.
    const reply = [
      'CONCERN: The results section states no comparison.',
      'SECTION: results',
      'RESPONSE: The comparison is stated.',
      'PATCH: The comparison against this study baseline is stated in Table 1.',
    ].join(String.fromCharCode(10))
    const { rebuttal } = await revisedRun([reply, reply], { verifier: acceptingReviewer() })
    // THE ROUND WAS READ AND THE READING WAS ACCEPTED. The first round's patch was applied, a reader
    // answered it, and the cycle took a second reading because the deployment's policy requires two.
    const audit = (rebuttal?.['verificationAudit'] ?? []) as ReadonlyArray<{
      readonly issueId: string
      readonly verdict: string
      readonly evidenceRead: ReadonlyArray<string>
      readonly verifierExecutionId: string
      readonly verifierSessionId: string
      readonly verifierInstructionsVersion: string
      readonly sharesAuthorRoute: boolean
    }>
    expect(audit.length).toBeGreaterThan(0)
    expect(audit[0]?.verdict).toBe('verified')
    expect(audit[0]?.evidenceRead.length).toBeGreaterThan(0)
    // AND THE SHARED ROUTE IS ON THE RECORD, where a reader can weigh it: a single model writing and
    // reviewing is a shared-bias risk, which is a fact to state rather than a gate to close.
    expect(audit[0]?.sharesAuthorRoute).toBe(true)
    // THE CALL EVIDENCE IS THE HOST'S: an execution and a session it minted, and the reviewer's own
    // rules version — not a name the model supplied.
    expect(audit[0]?.verifierExecutionId).toMatch(/^verify-/u)
    expect(audit[0]?.verifierSessionId).toMatch(/^research-verify-/u)
    expect(audit[0]?.verifierInstructionsVersion).toBe('revision-review-1')
    // NO ROLE OR INDEPENDENCE REFUSAL WAS RAISED: the step completed and produced its artifact.
    expect(rebuttal?.['stoppedBecause']).not.toBeUndefined()
  })

  it('refuses a verifier that cannot say what it read', async () => {
    // "未读必要证据不得关闭问题." A `verified` with nothing behind it is not a reading, and the issue
    // it would have closed stays pending — the round's record shows a debt rather than a closure
    // nobody performed.
    const reply = [
      'CONCERN: The results section states no comparison.',
      'SECTION: results',
      'RESPONSE: The comparison is stated.',
      'PATCH: The comparison against this study baseline is stated in Table 1.',
    ].join(String.fromCharCode(10))
    const { rebuttal } = await revisedRun([reply, reply], {
      verifier: {
        id: 'a-reader-that-read-nothing',
        role: 'revision-verifier',
        instructionsVersion: 'revision-review-1',
        route: { provider: 'test-provider', model: 'test-model' },
        verify: input => Promise.resolve({
          verdict: 'verified' as const,
          basis: 'looks right to me',
          evidenceRead: [],
          issueId: input.issue.issueId,
        } as never),
      },
    })
    expect(rebuttal?.['awaitingVerification']).toEqual(['d4-issue-1'])
    expect(rebuttal?.['openIssues']).toEqual([])
  })
})

/**
 * A reader that accepts every pending revision, on the SAME route the staged writer uses.
 *
 * The shared route is deliberate: this deployment runs one model, and the user's ruling of 2026-09-18
 * is that this must not be refused. What makes it a second reader is that the host started it as its
 * own execution, in its own session, under the reviewer's own rules.
 */
function acceptingReviewer(): ResolutionVerifier {
  return {
    id: 'spec-reviewer',
    role: 'revision-verifier',
    instructionsVersion: 'revision-review-1',
    route: { provider: 'test-provider', model: 'test-model' },
    verify(input) {
      return Promise.resolve({
        verdict: 'verified' as const,
        basis: 'the results section now states the comparison',
        evidenceRead: ['the concern', 'the change', 'the section as it now stands'],
        issueId: input.issue.issueId,
      })
    },
  }
}

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
    // THREE PATCHES APPLIED, and every one of them now waits for a reader: applying a patch is not
    // answering the concern it was written for.
    expect(issues.map(issue => issue.disposition))
      .toEqual(['pending-verification', 'pending-verification', 'pending-verification'])

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
    // NO TEXT CHANGED, so nothing stands behind the answer but its argument — which is exactly the
    // case that must not close itself. It waits for the verifier, and it is not an open issue either.
    expect(issues[0]?.disposition).toBe('pending-verification')
    expect(rebuttal?.['patchedSections']).toEqual([])
    expect(rebuttal?.['openIssues']).toEqual([])
    expect(rebuttal?.['awaitingVerification']).toEqual(['d4-issue-1'])
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
