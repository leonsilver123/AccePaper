/**
 * The bounded convergence path at D3: refuse, feed the reading back, write again, judge again.
 *
 * WHY THESE CASES EXIST. Refusal at D3 is the normal case — the evidence often does not establish what
 * the writer wanted to say — so a pipeline that ends the run on the first refusal cannot report the
 * runs where the writer simply wrote the wrong sentence. What is added is rounds, and what these cases
 * hold shut is that the rounds are a way to CONVERGE and not a way to pass: the last round is read by
 * the check the first one was, the last one being refused still stops the run with the reader's own
 * words, and the artifact carries what each round was told and what it changed.
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getArtifact, getRunSnapshot, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { runT19B } from '../src/runner/drive.ts'
import { DEFAULT_PLAN } from '../src/runner/study-plan.ts'
import { loadCasePack, planCasePackInputs } from '../src/runner/case-pack.ts'
import type { ResearchProseRequest, ResearchProseWriter } from '../src/runner/registry.ts'
import type { StatementAssessment, StatementSupportAssessor } from '../src/runner/statement-support.ts'

/** The Case Pack the deployment ships, which supplies the claim's declared scope and data source. */
const CASE_PACK_DIR = join(process.cwd(), 'plan/overnight/2026-09-09/case-pack-traffic')

/** The reviewer's reason, which the writer has to be shown verbatim. */
const BASIS = 'The passage only concerns the reaction-time lag (a first-order lag) and the critical lag'
  + ' value above which safe CCC gains do not exist, saying nothing about a gap-to-closing-speed ratio.'

/**
 * What the writer first wrote: the study's own metric, carrying a citation for a source read about
 * something else. This is the sentence a real run produced on 2026-09-20, and the shape the assessor
 * refused.
 */
const DECORATED = 'The quantity at stake is the smallest gap-to-closing-speed ratio reached by any'
  + ' follower over the measurement window [@cite-10.1109/tits.2026.3727135]. The comparison is drawn'
  + ' in Figure 1, Figure 2 and Table 1.'

/** What it wrote once told: the same citation, in a sentence the passage does establish. */
const CORRECTED = 'Prior work reports that vehicle reaction time enters as a first-order lag and that'
  + ' safe gains cease above a critical value of that lag [@cite-10.1109/tits.2026.3727135]. The'
  + ' comparison is drawn in Figure 1, Figure 2 and Table 1.'

/** An assessor that refuses the decorated sentence and accepts anything else. */
function refusingAssessor(): { readonly assessor: StatementSupportAssessor; readonly asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    assessor: {
      id: 'spec-assessor',
      policyVersion: 'v1',
      assess(input) {
        asked.push(input.statement.statementId)
        const refused = input.statement.text.includes('gap-to-closing-speed ratio')
        return Promise.resolve({
          statementId: input.statement.statementId,
          statementSha256: input.statement.textSha256,
          citeKey: input.judgement.citeKey,
          quoteSha256: input.judgement.quoteSha256,
          assessorVersion: 'spec-assessor@v1',
          support: refused ? 'unrelated' : 'supported',
          readScope: 'full-text',
          basis: refused ? BASIS : 'the passage states it',
          judgedBy: 'spec-assessor',
          judgedAt: '2026-09-20T00:00:00.000Z',
        } satisfies StatementAssessment)
      },
    },
  }
}

/**
 * A writer that answers every prose step in that step's own format, and D3 with what a case says.
 *
 * The request's own context carries `round`, so a case can make the writer answer the first round and
 * the rewrite differently — which is what a converging run looks like from outside.
 */
function writerOver(bodies: (round: number) => string): {
  readonly writer: ResearchProseWriter
  readonly instructions: string[]
} {
  const instructions: string[] = []
  return {
    instructions,
    writer: {
      channel: 'llm',
      write(request: ResearchProseRequest) {
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
              return 'PHASES: declare | measure | report'
                + '\nCONTRIBUTIONS: a measured comparison | a stated boundary'
            case 'B1-method':
              return [
                'FAMILY: a family the model declared',
                'STEPS: build both platoons | integrate | measure',
                `METRIC: ${DEFAULT_PLAN.metric.key}`,
                'DIRECTION: higher is better',
              ].join('\n')
            case 'D2-framework':
              return `TITLE: ${DEFAULT_PLAN.title}\nSECTIONS: ${DEFAULT_PLAN.outline.map(s => s.heading).join(' | ')}`
            case 'D4-rebuttal':
              return [
                'CONCERN: The introduction does not position the work against prior findings.',
                'SECTION: introduction',
                'RESPONSE: The position is stated in the revised draft.',
                'PATCH: NONE',
              ].join('\n')
            case 'D3-writing': {
              instructions.push(request.instruction)
              return bodies(Number(request.context.round ?? 1))
            }
            default:
              return 'The run states what it measured and nothing it did not. The comparison is drawn'
                + ' in Figure 1, Figure 2 and Table 1.'
          }
        })()
        return Promise.resolve({ text, provider: 'spec', model: 'spec' })
      },
    },
  }
}

/** The draft D3 committed, which is where the rewrite record lives. */
function draftOf(store: ResearchRunStore, runId: string): {
  proseRounds: ReadonlyArray<{
    round: number
    wrote: ReadonlyArray<string>
    readAgain: boolean
    told: { refusals: ReadonlyArray<string>; uncitedSources: ReadonlyArray<string> } | null
    changed: ReadonlyArray<{ sectionId: string; beforeSha256: string; afterSha256: string; changed: boolean }>
    refusedAfter: ReadonlyArray<{ code: string; statementId: string; citeKey: string }>
    stoppedBecause?: string
  }>
  proseRequests: ReadonlyArray<{ round: number; sectionId: string; instruction: string }>
  sections: ReadonlyArray<{ id: string; bodyText: string }>
} {
  return getRunSnapshot(store, runId).steps['D3-writing']?.artifacts['manuscript'] as ReturnType<typeof draftOf>
}

/**
 * One run whose writer never converges, with the bound a case states.
 *
 * THE BODY CHANGES EVERY ROUND AND STAYS REFUSED, which is what makes the budget observable: a writer
 * that repeated itself would be stopped by the no-progress test instead, and the two stops are
 * different facts about a run.
 *
 * @param extra - the drive options the case under test needs, `proseRounds` among them.
 * @returns how the run ended and how many rewrite requests its writer was asked for.
 */
async function writerCalls(extra: Record<string, unknown>): Promise<{
  readonly rewrites: number
  readonly error: string
}> {
  const store: ResearchRunStore = new Map()
  const { assessor } = refusingAssessor()
  const { writer, instructions } = writerOver(round =>
    `The quantity at stake, as this draft states it in round ${String(round)}, is the smallest`
    + ' gap-to-closing-speed ratio reached by any follower over the measurement window'
    + ' [@cite-10.1109/tits.2026.3727135]. The comparison is drawn in Figure 1 and Table 1.')
  const run = await runT19B(store, options({
    statementAssessor: assessor,
    proseWriter: writer,
    ...extra,
  }))
  const d3 = run.steps.find(step => step.stepId === 'D3-writing')
  return {
    rewrites: instructions.filter(text => text.includes('Rewrite the')).length,
    error: d3?.executeError ?? '',
  }
}

const options = (extra: Record<string, unknown>): Record<string, unknown> => ({
  studyPlan: DEFAULT_PLAN,
  casePackInputs: planCasePackInputs(loadCasePack(CASE_PACK_DIR)),
  ...extra,
})

describe('a run whose first draft is refused and whose rewrite is not', () => {
  it('converges, records what the round was told, and publishes the rewritten manuscript', async () => {
    const store: ResearchRunStore = new Map()
    const { assessor } = refusingAssessor()
    const { writer, instructions } = writerOver(round => round > 1 ? CORRECTED : DECORATED)
    const run = await runT19B(store, options({
      statementAssessor: assessor,
      proseWriter: writer,
    }))
    // THE RUN CONVERGED, which is the whole point: the reader refused the first version and the
    // manuscript the run published is the second one.
    const d3 = run.steps.find(step => step.stepId === 'D3-writing')
    expect(d3?.executeError).toBeUndefined()
    expect(d3?.status).toBe('passed')
    const draft = draftOf(store, run.runId)
    // EVERY SECTION THE READING COVERS CAME BACK WITH THE CORRECTED SENTENCE, and none still carries
    // the one the reading refused. `references` is not one of those sections: `locateStatements`
    // skips it, so it is not a section whose sentences are read, and this loop rewrites what the
    // reading refused. That is the reading's scope and not the loop's, and it is stated here rather
    // than filtered silently.
    const written = draft.sections.filter(section => section.bodyText.length > 0 && section.id !== 'references')
    expect(written.length).toBeGreaterThan(0)
    expect(written.every(section => section.bodyText.includes('first-order lag'))).toBe(true)
    expect(written.some(section => section.bodyText.includes('gap-to-closing-speed'))).toBe(false)
    // WHAT THE ROUND WAS TOLD IS THE READING'S OWN SENTENCE, verbatim: a writer answered in different
    // words than it is judged in is being judged by rules it was never shown.
    const rewrite = draft.proseRounds.find(round => round.readAgain)
    expect(rewrite).toBeDefined()
    expect(rewrite?.told?.refusals.join('\n')).toContain(BASIS.replace(/\.$/u, ''))
    // AND THE FIRST ROUND'S OWN RECORD SAYS WHY IT WAS REFUSED, by the reading's own code, per
    // sentence: a later reader of the draft can see both what the reading found and what the writer
    // was told, without going near a log.
    const refusedFirst = draft.proseRounds[0]?.refusedAfter ?? []
    expect(refusedFirst.length).toBeGreaterThan(0)
    expect(new Set(refusedFirst.map(entry => entry.code))).toEqual(new Set(['statement-unrelated']))
    expect(refusedFirst[0]?.statementId).toMatch(/^stmt-/u)
    // AND WHAT IT CHANGED, by section: the body that carried the refused sentence is not the body that
    // came back, and the record says both versions by hash.
    const changed = rewrite?.changed.filter(entry => entry.changed) ?? []
    expect(changed.length).toBeGreaterThan(0)
    for (const entry of changed) {
      expect(entry.beforeSha256).not.toBe(entry.afterSha256)
      expect(entry.beforeSha256).toMatch(/^[0-9a-f]{64}$/u)
    }
    expect(rewrite?.refusedAfter).toEqual([])
    expect(rewrite?.stoppedBecause).toBe('converged')
    // THE FIRST ROUND'S INSTRUCTION CARRIES NO REVISION PART and the rewrite's does: two rounds are
    // two requests, and the record keeps both.
    const rounds = new Set(draft.proseRequests.map(request => request.round))
    expect(rounds.has(1)).toBe(true)
    expect(rounds.has(2)).toBe(true)
    expect(instructions.some(text => text.includes('Rewrite the'))).toBe(true)
    expect(instructions.every(text => text.includes('Rewrite the') || !text.includes('was read, and this is what that reading found'))).toBe(true)
  })
})

describe('a run whose rewrite is refused too', () => {
  it('stops with the reading\'s own words, and says the budget ran out rather than that it converged', async () => {
    // NOTHING IS WEAKENED BY THE ROUNDS. The writer is given every round it is allowed, writes the
    // same refused sentence each time, and the run ends exactly where it ended before the loop
    // existed — with the assessor's reason, verbatim.
    const store: ResearchRunStore = new Map()
    const { assessor } = refusingAssessor()
    const { writer } = writerOver(() => DECORATED)
    const run = await runT19B(store, options({
      statementAssessor: assessor,
      proseWriter: writer,
    }))
    const d3 = run.steps.find(step => step.stepId === 'D3-writing')
    expect(d3?.status).toBe('in_progress')
    expect(d3?.executeError).toContain('statement-unrelated')
    // THE ASSESSOR'S REASON, VERBATIM — the same sentence the run reported before the loop existed.
    expect(d3?.executeError).toContain(BASIS)
    expect(getArtifact(store, run.runId, 'manuscript')).toBeUndefined()
    // AND THE ROUNDS THAT WERE SPENT ARE ON THE RECORD. The draft is not committed, so the record of
    // the attempt is the step's own account of it: the refusals it fed back are in the instructions
    // the writer was given, which is what `executeError` is joined from.
    expect(d3?.executeError).toContain('gap-to-closing-speed ratio')
  })

  it('spends its budget and stops, rather than asking the same question forever', async () => {
    // THE BOUND IS CONFIGURATION AND IT IS A BOUND. The writer here returns a DIFFERENT refused body
    // every round, so the loop's own no-progress test cannot stop it and the budget is the only thing
    // that does: one rewrite round buys half the requests two rewrite rounds do.
    const one = await writerCalls({ proseRounds: 1 })
    const two = await writerCalls({ proseRounds: 2 })
    expect(one.rewrites).toBeGreaterThan(0)
    expect(two.rewrites).toBe(one.rewrites * 2)
    // AND BOTH RUNS STOPPED, refused for the same reason: the bound decides how many times the writer
    // is asked, and nothing about whether the manuscript passes.
    expect(one.error).toContain('statement-unrelated')
    expect(two.error).toContain('statement-unrelated')
  })

  it('writes once and reads once when the deployment allows no rewrite at all', async () => {
    // `proseRounds: 0` IS THE STEP BEFORE THE LOOP EXISTED, and it is reachable: a deployment that
    // does not want to pay for a second write says so, and gets one write, one reading, and the
    // reader's refusal when it comes.
    const store: ResearchRunStore = new Map()
    const { assessor, asked } = refusingAssessor()
    const { writer, instructions } = writerOver(() => DECORATED)
    const run = await runT19B(store, options({
      statementAssessor: assessor,
      proseWriter: writer,
      proseRounds: 0,
    }))
    const d3 = run.steps.find(step => step.stepId === 'D3-writing')
    expect(d3?.executeError).toContain('statement-unrelated')
    expect(instructions.filter(text => text.includes('Rewrite the')).length).toBe(0)
    // ONE READING PER CITING SENTENCE, and no second reading of the same sentence: nothing was
    // rewritten, so nothing has to be read again.
    expect(new Set(asked).size).toBe(asked.length)
  })
})
