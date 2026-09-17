/**
 * A citation is judged against a VERSION of a sentence, not against a slot.
 *
 * THE REVIEW'S R05 IS THE REASON THIS FILE EXISTS. `CitationUse.statementId` documented the property
 * ("a revision that rewrites the sentence can invalidate the citation that supported it") and the
 * value it was given was the constant `introduction:prior-work` — a slot every draft shared — so a
 * revision changed the text under the slot and the judgement followed it silently. A citation then
 * asserted support for a sentence nobody had read.
 *
 * WHAT IS SEPARATED HERE, and each is a different question: the NODE's identity (which survives a
 * revision), the CONTENT VERSION (which does not), the EVIDENCE VERSION (which changes when the
 * source does), and the JUDGEMENT (which is about one pair of those versions). A binding that
 * disagrees with either version is refused, and re-binding is NOT the remedy — a judgement is a
 * reading somebody made, and only another reading can replace it.
 */
import { describe, expect, it } from 'vitest'
import { getArtifact, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { runT19B } from '../src/runner/drive.ts'
import {
  bindJudgements, checkStatementBindings, judgementsFor, locateStatements,
} from '../src/runner/citation-bindings.ts'
import type { CitationUse, SourceJudgement, Statement } from '../src/runner/citation-bindings.ts'
import { DEFAULT_PLAN } from '../src/runner/study-plan.ts'
import type { FigureProvider } from '../src/runner/figure-provider.ts'

// The judgements are keyed by the CLAIM, as the plan states it — not by the claim's id.
const CLAIM = DEFAULT_PLAN.claim.ref

/** A sentence that cites a reviewed source, as the writer emits one. */
const CITING = 'Prior work on this quantity is not unanimous '
  + '[@cite-10.1016/j.trb.2025.103352] and [@cite-10.1109/tits.2026.3727135].'

/** The same node, rewritten: same sources, different claim about them. */
const REWRITTEN = 'Earlier work settles this question '
  + '[@cite-10.1016/j.trb.2025.103352] and [@cite-10.1109/tits.2026.3727135].'

function sectionsWith(introduction: string): ReadonlyArray<{ id: string; bodyText: string }> {
  return [
    { id: 'introduction', bodyText: introduction },
    { id: 'results', bodyText: 'The boundary is reported elsewhere [@cite-10.1155/2017/3082781].' },
  ]
}

/** The judgements this deployment's reviewed corpus holds for the shipped claim. */
function judgements(): ReadonlyArray<SourceJudgement> {
  return judgementsFor(CLAIM)
}

function bound(statements: ReadonlyArray<Statement>): ReadonlyArray<CitationUse> {
  return bindJudgements(judgements(), statements).uses
}

describe('a statement is a node with an identity and a version of its text', () => {
  it('mints a stable id and a content version for each cited sentence', () => {
    const statements = locateStatements(sectionsWith(CITING))
    // ONE STATEMENT PER CITED SENTENCE, named by section and position, with the hash of its text.
    expect(statements.map(statement => statement.statementId)).toEqual([
      'stmt-introduction-1', 'stmt-results-1',
    ])
    for (const statement of statements) expect(statement.textSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(statements[0]?.textSha256).not.toBe(statements[1]?.textSha256)
  })

  it('keeps the node and changes the version when the sentence is rewritten', () => {
    // THE PROPERTY THE WHOLE MODEL RESTS ON. The id names the NODE, so a reader comparing two drafts
    // sees that this node's text changed — an id derived from the text would read as one statement
    // deleted and another created, which is a different fact.
    const before = locateStatements(sectionsWith(CITING))[0]
    const after = locateStatements(sectionsWith(REWRITTEN))[0]
    expect(after?.statementId).toBe(before?.statementId)
    expect(after?.textSha256).not.toBe(before?.textSha256)
    expect(after?.text).toBe(REWRITTEN)
  })

  it('does not renumber statements when an UNCITED sentence is inserted', () => {
    // A statement's position is its position AMONG CITED SENTENCES, so prose that gains a sentence
    // about something else does not shift every binding after it.
    const withExtra = 'An uncited remark sits here. ' + CITING
    expect(locateStatements(sectionsWith(withExtra))[0]?.statementId).toBe('stmt-introduction-1')
  })
})

describe('a judgement is attached to a statement, never inherited by one', () => {
  it('records the content version and the evidence version it was made about', () => {
    const statements = locateStatements(sectionsWith(CITING))
    const uses = bound(statements)
    expect(uses.map(use => use.citeKey)).toEqual([
      'cite-10.1016/j.trb.2025.103352', 'cite-10.1109/tits.2026.3727135',
      'cite-10.1155/2017/3082781',
    ])
    const byId = new Map(statements.map(statement => [statement.statementId, statement]))
    for (const use of uses) {
      // THE CONTENT VERSION is the version of THE SENTENCE THAT CITES IT, as it stood at this moment —
      // each binding carries its own, so a rewrite of one sentence invalidates only its own citations.
      expect(use.statementSha256).toBe(byId.get(use.statementId)?.textSha256)
      // THE EVIDENCE VERSION is the passage's, also as it stands.
      expect(use.quoteSha256).toMatch(/^[0-9a-f]{64}$/u)
      expect(use.quote.length).toBeGreaterThan(20)
    }
    expect(uses[2]?.statementId).toBe('stmt-results-1')
  })

  it('reports the reviewed sources no sentence cited, rather than binding them anywhere', () => {
    const bound_ = bindJudgements(judgements(), locateStatements([
      { id: 'introduction', bodyText: CITING },
    ]))
    // Two of the three reviewed sources are named here and the third is not; it produced no binding at
    // all, which is what makes "the paper never stated a position it holds" detectable.
    expect(bound_.uncited.map(judgement => judgement.citeKey)).toEqual(['cite-10.1155/2017/3082781'])
  })
})

describe('a judgement that no longer matches what is there is refused', () => {
  it('passes while the sentence and the passage are the ones it was made about', () => {
    const statements = locateStatements(sectionsWith(CITING))
    expect(checkStatementBindings(bound(statements), statements, judgements())).toEqual([])
  })

  it('refuses a judgement about a sentence that has been rewritten', () => {
    // THE BODY EDIT. Nothing about the sources changed; the sentence did. The binding still names the
    // node, so a reader can see WHICH statement drifted, and it carries the version nobody has read.
    const uses = bound(locateStatements(sectionsWith(CITING)))
    const refusals = checkStatementBindings(uses, locateStatements(sectionsWith(REWRITTEN)), judgements())
    expect(refusals.map(refusal => refusal.code)).toEqual([
      'citation-statement-changed',
      'citation-statement-changed',
    ])
    expect(refusals[0]?.detail).toContain('rewritten')
    expect(refusals[0]?.detail).toContain('re-read')
    // AND THE REFUSAL NAMES THE NODE, so a reader knows which sentence to look at.
    expect(refusals[0]?.detail).toContain('stmt-introduction-1')
  })

  it('refuses a judgement whose sentence is gone', () => {
    const uses = bound(locateStatements(sectionsWith(CITING)))
    const refusals = checkStatementBindings(uses, locateStatements(sectionsWith('Nothing is cited here.')), judgements())
    expect(refusals.map(refusal => refusal.code))
      .toEqual(['citation-statement-missing', 'citation-statement-missing'])
  })

  it('refuses a judgement whose passage is not the passage the source now holds', () => {
    // THE EVIDENCE EDIT, and it is a different fact from a body edit: nobody touched the manuscript,
    // and the corpus corrected the excerpt. A judgement about the old excerpt establishes nothing
    // about the new one, so the citation is refused until somebody reads it again.
    const statements = locateStatements(sectionsWith(CITING))
    const corrected = judgements().map(judgement =>
      judgement.citeKey === 'cite-10.1016/j.trb.2025.103352'
        ? { ...judgement, quote: 'a corrected excerpt', quoteSha256: 'f'.repeat(64) }
        : judgement)
    const refusals = checkStatementBindings(bound(statements), statements, corrected)
    expect(refusals.map(refusal => refusal.code)).toEqual(['citation-evidence-changed'])
    expect(refusals[0]?.detail).toContain('the evidence')
  })
})

describe('what a section was asked for is part of the run', () => {
  it('records the request, the evidence and the versions behind every section', async () => {
    // THE REVIEW'S R05③, on the path R05① needs it for. A judgement refused because a passage changed
    // is only actionable if the run says WHICH request was answered with a sentence resting on that
    // passage, and what the model was shown when it wrote it. The transcript of the request is the
    // record; the session log is not, so a run read back from disk carries it.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store)
    const draft = getArtifact(store, run.runId, 'draft') as {
      proseRequests: ReadonlyArray<{
        sectionId: string
        channel: string
        instruction: string | null
        evidenceSupplied: ReadonlyArray<string>
        evidenceRequired: ReadonlyArray<string>
        citations: ReadonlyArray<{ citeKey: string; evidenceVersion: string | null }>
      }>
      proseRequestVersion: string
    }
    expect(draft.proseRequestVersion).toBe('prose-request-v1')
    const ids = draft.proseRequests.map(entry => entry.sectionId)
    expect(ids).toContain('introduction')
    expect(ids.length).toBeGreaterThan(1)
    for (const request of draft.proseRequests) {
      // THE EVIDENCE NAMES are the section's own requirements, so a reader can tell a section that was
      // asked for material the run does not hold from one that was written from what it holds.
      expect(Array.isArray(request.evidenceSupplied)).toBe(true)
      expect(Array.isArray(request.evidenceRequired)).toBe(true)
      // EVERY CITED SOURCE CARRIES THE VERSION OF THE PASSAGE the sentence was written against, which
      // is what a later `citation-evidence-changed` refusal points back at.
      for (const citation of request.citations) {
        expect(citation.citeKey).toMatch(/^cite-/u)
        expect(citation.evidenceVersion).toMatch(/^[0-9a-f]{64}$/u)
      }
    }
    // NO MODEL WAS CALLED on the shipped offline run, and the record says that rather than inventing
    // an instruction: "asked nothing" and "the record lost the request" are different facts.
    expect(draft.proseRequests.every(request => request.channel === 'fixture')).toBe(true)
    expect(draft.proseRequests.every(request => request.instruction === null)).toBe(true)
  })
})

describe('a deployment that named a drawing provider gets its figures', () => {
  it('draws the chart and the diagram through it, and the floats say which library drew them', async () => {
    // THE SEAM'S PRODUCTION CONSUMER. The built-in renderer is deterministic and dependency-free, which
    // is why it ships, and it is not a plotting library: a deployment that has one names it, and the
    // floats must then be ITS output — with the diagram drawn too, because a roadmap left as mermaid
    // source is a float the compiled document cannot carry.
    const drawn: string[] = []
    const provider: FigureProvider = {
      id: 'spec-provider',
      toolVersion: '1.2.3',
      renderFigure: (spec) => {
        drawn.push(`figure:${spec.kind ?? 'bar'}`)
        return Promise.resolve({
          svg: '<svg id="provider-figure"/>',
          pngBase64: 'iVBORw0KGgoAAAA',
          width: spec.width,
          height: spec.height,
          tool: 'spec-provider',
          toolVersion: '1.2.3',
        })
      },
      renderDiagram: (graph) => {
        drawn.push(`diagram:${String(graph.nodes.length)}`)
        return Promise.resolve({
          svg: '<svg id="provider-diagram"/>',
          pngBase64: 'iVBORw0KGgoBBBB',
          width: 640,
          height: 360,
          tool: 'spec-provider',
          toolVersion: '1.2.3',
        })
      },
    }
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, { figureProvider: provider })
    const figures = (getArtifact(store, run.runId, 'figure-plan') as {
      figures: ReadonlyArray<Record<string, unknown>>
    }).figures
    const chart = figures.find(entry => entry.kind === 'data-figure')
    const diagram = figures.find(entry => entry.kind === 'roadmap')
    // THE PROVIDER DREW BOTH, and both carry its markup rather than the built-in renderer's.
    expect(drawn).toContain('figure:bar')
    expect(drawn.some(entry => entry.startsWith('diagram:'))).toBe(true)
    expect(String(chart?.svg)).toContain('provider-figure')
    expect(String(chart?.pngBase64)).toBe('iVBORw0KGgoAAAA')
    expect(chart?.drawnBy).toBe('spec-provider')
    expect(chart?.drawnByVersion).toBe('1.2.3')
    expect(diagram?.diagramDrawn).toBe(true)
    expect(String(diagram?.svg)).toContain('provider-diagram')
    expect(diagram?.drawnBy).toBe('spec-provider')
  })

  it('draws with the built-in renderer when the deployment named none, and says so', async () => {
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store)
    const figures = (getArtifact(store, run.runId, 'figure-plan') as {
      figures: ReadonlyArray<Record<string, unknown>>
    }).figures
    const chart = figures.find(entry => entry.kind === 'data-figure')
    const diagram = figures.find(entry => entry.kind === 'roadmap')
    // WHICH ONE DREW IT IS ON THE FLOAT, so a reader comparing two packages can tell a figure a
    // plotting library drew from one a test fixture drew — and the diagram records that nothing drew
    // it as a picture, which is the honest state rather than a dropped float nobody names.
    expect(String(chart?.drawnBy)).toContain('figure')
    expect(diagram?.diagramDrawn).toBe(false)
    expect(diagram?.svg).toBeUndefined()
  })
})
