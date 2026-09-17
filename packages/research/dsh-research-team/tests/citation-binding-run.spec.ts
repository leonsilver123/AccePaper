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
import { getArtifact, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { runT19B } from '../src/runner/drive.ts'
import { DEFAULT_PLAN } from '../src/runner/study-plan.ts'
import { loadCasePack, planCasePackInputs } from '../src/runner/case-pack.ts'
import type { ResearchProseRequest, ResearchProseWriter } from '../src/runner/registry.ts'

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
    const manuscript = getArtifact(store, run.runId, 'formatted-manuscript') as {
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
    const draft = getArtifact(store, run.runId, 'draft') as {
      citations: ReadonlyArray<{ citeKey: string; quote: string; location: string; support: string }>
    }
    expect(draft.citations.map(citation => citation.citeKey)).toEqual(REVIEWED_KEYS)
    for (const citation of draft.citations) {
      expect(citation.quote.length, citation.citeKey).toBeGreaterThan(20)
      expect(citation.location, citation.citeKey).toContain('http')
    }
  })
})

describe('a run whose manuscript does not cite what its reference list carries', () => {
  it('is refused at assembly, naming the uncited entries', async () => {
    // THE DELIVERED PAPER'S SHAPE, refused: a reference list written beside a body that never cites
    // it. E1 is the last place both are in hand before the manuscript becomes an artifact, so the run
    // stops there — with the reason, and without publishing a manuscript that reads as sourced.
    const store: ResearchRunStore = new Map()
    // THE SAME SEED THE BROWSER RUN HAD: a caller-supplied plan and the deployment's pack. Without
    // them the run holds at A2's B gate, which is a different stop and would hide the one under test.
    const run = await runT19B(store, {
      studyPlan: DEFAULT_PLAN,
      proseWriter: writerSaying(STATED_WITHOUT_CITING),
      casePackInputs: planCasePackInputs(loadCasePack(CASE_PACK_DIR)),
    })
    const e1 = run.steps.find(step => step.stepId === 'E1-format')
    expect(e1?.status).toBe('in_progress')
    expect(e1?.executeError).toContain('citation-entry-uncited')
    // AND NOTHING WAS PUBLISHED: a run stopped here has no manuscript for a later step to read.
    expect(getArtifact(store, run.runId, 'formatted-manuscript')).toBeUndefined()
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
        'Prior work on this quantity has been reported [@cite-10.1016/j.trb.2024.999999].'
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
