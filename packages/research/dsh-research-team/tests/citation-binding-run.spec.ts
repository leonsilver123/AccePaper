/**
 * The citations a driven run actually carries — the production path, not the module's own interface.
 *
 * THE DEFECT THESE HOLD SHUT is the one the delivered paper has: a reference list built from whatever
 * the search returned, twenty-five entries, and a body that cites none of them. It is invisible to a
 * unit test of the reference formatter and invisible to the pipeline's own 900 tests, because both
 * parts work — they simply never met. So the assertions here read the MANUSCRIPT a run produced.
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getArtifact, getRunSnapshot, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { runT19B } from '../src/runner/drive.ts'
import { DEFAULT_PLAN } from '../src/runner/study-plan.ts'
import { loadCasePack, planCasePackInputs } from '../src/runner/case-pack.ts'
import { FIXED_TS, STEP_EXECUTOR_REGISTRY } from '../src/runner/registry.ts'
import type { ExecCtx, ResearchProseRequest, ResearchProseWriter, RunContext } from '../src/runner/registry.ts'
import { platoonAdapter } from '../src/runner/study-adapter.ts'
import { experimentStudy } from '../src/runner/platoon-sim.ts'
import { EMPTY_CLAIM_MATERIAL } from '../src/runner/redteam-review.ts'

/** A bare step context over one run's artifacts, as the registry's own specs build them. */
function execCtx(stepId: string): ExecCtx {
  const runCtx: RunContext = {
    predictionText: '', claimId: '', claimRef: '', metricKey: '',
    claimMaterial: { ...EMPTY_CLAIM_MATERIAL },
    study: experimentStudy(), studyPlan: DEFAULT_PLAN, planSource: 'default',
    timestamp: FIXED_TS, adapter: platoonAdapter(experimentStudy()),
  }
  return {
    runId: 'citation-binding-run-spec', stepId, attemptId: 1,
    getInput: () => undefined,
    // THIS CONTEXT STANDS OVER NO RUN of its own, so it holds no artifact versions; the one case
    // below that drives E1 with a real store supplies its own reader.
    readInputRef: () => undefined,
    runCtx,
  }
}

/** The Case Pack the deployment ships, which supplies the claim's declared scope and data source. */
const CASE_PACK_DIR = join(process.cwd(), 'plan/overnight/2026-09-09/case-pack-traffic')

/** A literature position written without citing anything, which is the delivered paper's shape. */
const STATED_WITHOUT_CITING =
  'Prior work on this quantity has been reported, and the literature is not unanimous.'
  // THE FLOATS ARE NAMED, so the manuscript fails on exactly the omission under test: it states a
  // literature position and cites nothing. A draft that also carried floats its prose never named
  // would be refused earlier, by the A gate, and the refusal under test would never be reached.
  + ' The comparison is drawn in Figure 1, Figure 2 and Table 1.'

/** The reviewed sources this deployment holds, which is what a manuscript may cite. */
const REVIEWED_KEYS = [
  'cite-10.1016/j.trb.2025.103352',
  'cite-10.1109/tits.2026.3727135',
  'cite-10.1155/2017/3082781',
]

/**
 * A writer that answers every prose step in that step's own format, and D3 with prose citing nothing.
 *
 * The replies for the other steps are the shape their instructions ask for — a writer that answers A2
 * in prose never reaches D3 at all, so a draft that cites nothing has to be written by a writer that
 * is otherwise conforming. This is a model that followed every instruction except the citation one.
 */
function writerSaying(introduction: string): ResearchProseWriter {
  return {
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
            // A WELL-FORMED ROUND THAT CHANGES NOTHING, so the section under test survives into the
            // assembled manuscript unchanged. `PATCH: NONE` is the author accepting the concern as an
            // explanation, which is a recorded outcome and not a missing one.
            return [
              'CONCERN: The introduction does not position the work against prior findings.',
              'SECTION: introduction',
              'RESPONSE: The position is stated in the revised draft.',
              'PATCH: NONE',
            ].join('\n')
          case 'D3-writing':
            return introduction
          default:
            return 'The run states what it measured and nothing it did not. The comparison is drawn in'
              + ' Figure 1, Figure 2 and Table 1.'
        }
      })()
      return Promise.resolve({ text, provider: 'spec', model: 'spec' })
    },
  }
}

describe('a run that cites its sources', () => {
  it('prints the sources its sentences cite, and no others', async () => {
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store)
    const manuscript = getArtifact(store, run.runId, 'typeset') as {
      manuscript: string
      manuscriptCounts: { references: number }
      crossReferences: { cited: ReadonlyArray<string>; uncited: ReadonlyArray<string> }
    }
    const [bodyRaw, references = ''] = manuscript.manuscript.split('## References')
    const body = bodyRaw ?? ''
    // THE BODY CITES THEM: the delivered paper's body cites nothing at all, and this is the reading
    // that says whether the defect is still there.
    const cited = [...body.matchAll(/\[(\d+)\]/gu)].map(match => match[1])
    expect(new Set(cited).size).toBe(REVIEWED_KEYS.length)
    // AND THE LIST IS THE CITATIONS: three reviewed sources, not the twenty-five retrieval hits.
    const entries = references.split('\n').filter(line => /^\[\d+\]/u.test(line.trim()))
    expect(entries.length).toBe(REVIEWED_KEYS.length)
    expect(manuscript.manuscriptCounts.references).toBe(REVIEWED_KEYS.length)
  })

  it('records the binding behind every citation, with the passage it was read from', async () => {
    // A CITATION A READER CAN CHECK: the draft carries, per key, the source, the location and the
    // quoted passage, so "this paper rests on that sentence in that source" is auditable.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store)
    const draft = getArtifact(store, run.runId, 'manuscript') as {
      citations: ReadonlyArray<{ citeKey: string; quote: string; location: string; support: string }>
    }
    expect(draft.citations.map(citation => citation.citeKey)).toEqual(REVIEWED_KEYS)
    for (const citation of draft.citations) {
      expect(citation.quote.length, citation.citeKey).toBeGreaterThan(20)
      expect(citation.location, citation.citeKey).toContain('http')
    }
  })
})

describe('a run whose manuscript cites none of the sources it reviewed', () => {
  it('is refused where the prose is written, naming every source it left unused', async () => {
    // THE DELIVERED PAPER'S SHAPE, refused. It used to be refused at E1, because the reference list
    // was built from the reviewed corpus whatever the body said — so the list could exist beside a
    // body that never cited it. NOW THE LIST IS DERIVED FROM THE BINDINGS, so an uncited reviewed
    // source produces no entry, and the defect has to be refused where it happens: `D3-writing`,
    // before an artifact is written. That is earlier and it names the real problem — the paper failed
    // to state a position its own evidence establishes.
    const store: ResearchRunStore = new Map()
    // THE SAME SEED THE BROWSER RUN HAD: a caller-supplied plan and the deployment's pack. Without
    // them the run holds at A2's B gate, which is a different stop and would hide the one under test.
    const run = await runT19B(store, {
      studyPlan: DEFAULT_PLAN,
      proseWriter: writerSaying(STATED_WITHOUT_CITING),
      casePackInputs: planCasePackInputs(loadCasePack(CASE_PACK_DIR)),
    })
    const d3 = run.steps.find(step => step.stepId === 'D3-writing')
    expect(d3?.status).toBe('in_progress')
    expect(d3?.executeError).toContain('citation-source-uncited')
    for (const key of REVIEWED_KEYS) expect(d3?.executeError, key).toContain(key)
    // AND NOTHING WAS PUBLISHED: a run stopped here has no draft, so no manuscript can follow it.
    expect(getArtifact(store, run.runId, 'manuscript')).toBeUndefined()
    expect(getArtifact(store, run.runId, 'typeset')).toBeUndefined()
  })
})


describe('a run that cites a source it never reviewed', () => {
  it('is refused, because being retrieved is not being read', async () => {
    // A SOURCE ON THE SAME TOPIC IS WHAT A SEARCH RETURNS. A model that cites one of the landscape
    // scan's hits — a real DOI, a real paper, no reviewed judgement about what it establishes — is
    // refused rather than published, and it is refused on BOTH counts: the reference list does not
    // carry the key, and the run holds no judgement binding that source to a statement.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, {
      studyPlan: DEFAULT_PLAN,
      proseWriter: writerSaying(
        // THE REVIEWED SOURCES ARE ALL CITED, so the draft is not refused for leaving one unused —
        // the scenario under test is the source that was never reviewed.
        `Prior work on this quantity has been reported ${REVIEWED_KEYS.map(key => `[@${key}]`).join(' ')}`
        + ' and one further study [@cite-10.1016/j.trb.2024.999999].'
        + ' The comparison is drawn in Figure 1, Figure 2 and Table 1.',
      ),
      casePackInputs: planCasePackInputs(loadCasePack(CASE_PACK_DIR)),
    })
    const e1 = run.steps.find(step => step.stepId === 'E1-format')
    expect(e1?.status).toBe('in_progress')
    expect(e1?.executeError).toContain('citation-target-missing')
    expect(e1?.executeError).toContain('citation-unreviewed-source')
  })
})

describe('a revision that rewrites a cited sentence', () => {
  it('is refused at assembly, because the judgement was about the sentence that was there', async () => {
    // THE REVIEW'S R05, on the production path. `E1-format` assembles the REVISED draft, and the
    // bindings it carries were made against the text the DRAFT had. A step that rewrites a cited
    // sentence — which is what D4-rebuttal does — therefore leaves a judgement about a sentence nobody
    // read, and the citation is refused rather than transferring its support to the new text.
    //
    // E1 IS DRIVEN HERE WITH A REAL RUN'S ARTIFACTS AND ONE EDIT: the revised draft is the one the run
    // produced, with the introduction's cited sentence replaced by a different claim about the same
    // sources. Nothing else about the run changes, so the refusal can only come from the versions.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store)
    const revised = getArtifact(store, run.runId, 'manuscript') as {
      sections: ReadonlyArray<{ id: string; heading: string; bodyText: string }>
      citations: ReadonlyArray<{ citeKey: string }>
    }
    const firstKey = revised.citations[0]?.citeKey ?? ''
    const citing = revised.sections.find(section => section.bodyText.includes(firstKey))
    expect(citing, 'the run produced no section citing the first reviewed source').toBeDefined()

    const edited = {
      ...revised,
      sections: revised.sections.map(section => section.id === citing?.id
        // THE SAME SOURCES, A DIFFERENT CLAIM ABOUT THEM. This is the edit a rebuttal makes when it
        // strengthens a literature position, and it is exactly what a slot-based binding survives.
        ? {
          ...section,
          // THE SENTENCE THAT CARRIES THE CITATION is the one rewritten, and it keeps its citations:
          // the markers stay, the claim about them changes.
          bodyText: section.bodyText
            .split(/(?<=[.!?])\s+/u)
            .map(sentence => sentence.includes(firstKey)
              ? sentence.replace(/^[^\[]*/u, 'Earlier work settles this question ')
              : sentence)
            .join(' '),
        }
        : section),
    }
    const entry = STEP_EXECUTOR_REGISTRY.get('E1-format')
    const e1Ctx: ExecCtx = {
      ...execCtx('E1-format'),
      getInput: slug => (slug === 'manuscript' ? edited : getArtifact(store, run.runId, slug)),
      // THE HAND-EDITED MANUSCRIPT IS NOT IN THE REGISTRY, so the version E1 would record is the one
      // the run holds — which is the state this case exists to have E1 refuse.
      readInputRef: slug => getRunSnapshot(store, run.runId).registry[slug]?.ref,
    }
    await expect(entry?.executor(e1Ctx)).rejects.toThrow(/citation-statement-changed/u)
  })

  it('asks a citing sentence for the finding its source states, and no inference beyond it', async () => {
    // MEASURED ON A REAL RUN, 2026-09-19. Told only to avoid a number, a unit or a source the evidence
    // lacks, the writer stated an inference the passage never draws — the abstract asserted a higher
    // minimum time-to-collision that the cited passage, which reports the trade-off only qualitatively,
    // does not establish. The sentence assessor read the passage, answered `partial`, and D3 refused the
    // manuscript as `statement-beyond-scope`. The material clause was already there; what was missing
    // was the SCOPE of a sentence that carries a citation. The instruction is model-visible, so the
    // clause is pinned here rather than left to a reader of the prompt to notice.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, {
      studyPlan: DEFAULT_PLAN,
      // EVERY REVIEWED SOURCE IS CITED, so the draft is not refused for leaving one unused — the
      // instruction is what this case is about, and the run has to reach the request to state it.
      proseWriter: writerSaying(
        `Prior work on this quantity has been reported ${REVIEWED_KEYS.map(key => `[@${key}]`).join(' ')}.`
        + ' The comparison is drawn in Figure 1, Figure 2 and Table 1.',
      ),
      casePackInputs: planCasePackInputs(loadCasePack(CASE_PACK_DIR)),
    })
    const draft = getArtifact(store, run.runId, 'manuscript') as {
      proseRequests: ReadonlyArray<{ instruction: string | null }>
    }
    const instructions = draft.proseRequests
      .map(request => request.instruction)
      .filter((instruction): instruction is string => instruction !== null)
    expect(instructions.length).toBeGreaterThan(0)
    for (const instruction of instructions) {
      expect(instruction).toContain('states what that source establishes and nothing further')
      expect(instruction).toContain('leave it uncited')
    }
  })
})
