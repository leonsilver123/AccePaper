/**
 * The sources a run may cite, from the registry it configured, and what the support gate does with
 * them.
 *
 * THE TWO FAILURES THIS FILE EXISTS FOR. First: a run pointed at a literature library must cite what
 * that library holds, and a library that could not be read must leave it with NOTHING to cite rather
 * than with the checked-in corpus — a substitution the delivered paper cannot show. Second: a
 * sentence bound to a source the run read during THIS run must be assessed like any other, so an
 * unread sentence is refused rather than inheriting the claim's verdict.
 *
 * The registration values below are the ones the live acceptance read from the real library on
 * 2026-09-18 (`zotero:user:17529257:UA5MIGG3`, item version 3408, attachment `PU2XWW83` version 2690,
 * page 4 of 10). They are recorded here rather than fetched because this file is about what the
 * runner does with a registration, and the reading itself is `zotero-live.spec.ts` in the package that
 * owns the library.
 */
import { describe, expect, it } from 'vitest'
import type { SourceRegistration } from '@deepseek-ai/dsh-research-core'
import {
  citeKeyOf, checkCitationUse, locateStatements, reviewedSources, sourcesForMode,
} from '../src/runner/citation-bindings.ts'
import { checkStatementSupport } from '../src/runner/statement-support.ts'
import type { StatementAssessment } from '../src/runner/statement-support.ts'
import type { SourceJudgement } from '../src/runner/citation-bindings.ts'

/** The source the live run read out of the configured library. */
const REGISTRATION: SourceRegistration = {
  identity: 'zotero:user:17529257:UA5MIGG3',
  ref: { kind: 'doi', id: '10.1016/j.aap.2020.105588' },
  title: 'What happens when drivers of automated vehicles take over control in critical brake situations?',
  authors: ['Roche, Fabienne', 'Thüring, Manfred', 'Trukenbrod, Anna K.'],
  year: 2020,
  venue: 'Accident Analysis and Prevention',
  registry: 'zotero',
  acquisition: 'live-library-read',
  evidence: {
    sourceIdentity: 'zotero:user:17529257:UA5MIGG3',
    sourceVersion: '3408',
    attachment: { key: 'PU2XWW83', version: '2690' },
    locator: "page 4 of 10 in attachment PU2XWW83, with the tool's 'PDF Pages' header removed",
    contentSha256: 'a'.repeat(64),
    route: 'mcp-pdf-pages',
    ruleVersion: 'zotero-local-read-v1',
  },
}

const CITE_KEY = 'cite-zotero:user:17529257:UA5MIGG3'

describe('which registry a run draws its citable sources from', () => {
  it('answers a zotero run with the library and nothing else', () => {
    const sources = sourcesForMode('zotero', [REGISTRATION])
    expect([...sources.keys()]).toEqual([REGISTRATION.identity])
    const record = sources.get(REGISTRATION.identity)
    expect(record?.registry).toBe('zotero')
    expect(record?.acquisition).toBe('live-library-read')
    expect(record?.evidence?.attachment).toEqual({ key: 'PU2XWW83', version: '2690' })
    expect(citeKeyOf(record ?? { id: '' })).toBe(CITE_KEY)
  })

  it('leaves a zotero run with NOTHING when its library could not be read', () => {
    // THE SUBSTITUTION THIS PREVENTS, and the reason `sourcesForMode` takes the registrations rather
    // than reading a corpus: an empty list here means the run has nothing to cite, and the checked-in
    // sources are absent from the map rather than standing in for them.
    const sources = sourcesForMode('zotero', [])
    expect(sources.size).toBe(0)
    expect(sources.has('10.1109/tits.2026.3727135')).toBe(false)
  })

  it('answers a curated run with the checked-in corpus and nothing from a library', () => {
    const sources = sourcesForMode('curated', [REGISTRATION])
    expect(sources.has(REGISTRATION.identity)).toBe(false)
    expect(sources.size).toBe(reviewedSources().size)
  })

  it('answers a combined run with both, each carrying its own registry', () => {
    // NOT A MERGE: every record says where it came from, so the bibliography can state it.
    const sources = sourcesForMode('combined', [REGISTRATION])
    expect(sources.has(REGISTRATION.identity)).toBe(true)
    expect(sources.size).toBe(reviewedSources().size + 1)
    expect(sources.get(REGISTRATION.identity)?.registry).toBe('zotero')
    expect(sources.get('10.1109/tits.2026.3727135')?.registry).toBe('curated')
  })

  it('does not let a registration overwrite a curated record of the same id', () => {
    const collision: SourceRegistration = { ...REGISTRATION, identity: '10.1109/tits.2026.3727135' }
    const sources = sourcesForMode('combined', [collision])
    expect(sources.size).toBe(reviewedSources().size)
    expect(sources.get('10.1109/tits.2026.3727135')?.registry).toBe('curated')
  })
})

describe('the support gate over a source this run read', () => {
  /** The judgement a run holds about the registered source, made from the passage it read. */
  const judgement: SourceJudgement = {
    literatureRef: REGISTRATION.identity,
    citeKey: CITE_KEY,
    location: REGISTRATION.evidence?.locator ?? '',
    quote: 'the criticality of the experienced situation on a single item with a graphical analog scale',
    quoteSha256: REGISTRATION.evidence?.contentSha256 ?? '',
    support: 'supported',
    readScope: 'full-text',
    access: 'read',
    accessNote: '',
    judgedBy: 'the live reading of the configured library',
  }

  /** One sentence citing the registered source. */
  const body = `The takeover was judged critical on a single scale [@${CITE_KEY}].`

  /** An assessment of that sentence, made on the passage the judgement quotes. */
  function assessed(statementId: string, textSha256: string): StatementAssessment {
    return {
      statementId,
      statementSha256: textSha256,
      citeKey: CITE_KEY,
      quoteSha256: judgement.quoteSha256,
      assessorVersion: 'a-reader-1',
      support: 'supported',
      readScope: 'full-text',
      basis: 'the passage states the scale the sentence reports',
      judgedBy: 'a-reader',
      judgedAt: '2026-09-18T00:00:00.000Z',
    }
  }

  it('passes a sentence assessed against the passage that was read', () => {
    const statements = locateStatements([{ id: 'discussion', bodyText: body }])
    const first = statements[0]
    expect(first).toBeDefined()
    if (first === undefined) return
    expect(checkStatementSupport([assessed(first.statementId, first.textSha256)], statements, [judgement]))
      .toEqual([])
  })

  it('refuses a sentence nobody assessed, rather than inheriting the claim\'s verdict', () => {
    // THE INHERITANCE THIS ENDS. The judgement above is `supported`, and it is about the CLAIM the
    // source was retrieved for — not about this sentence. Printing the citation without a reading of
    // the sentence is what the gate refuses.
    const statements = locateStatements([{ id: 'discussion', bodyText: body }])
    const refusals = checkStatementSupport([], statements, [judgement])
    expect(refusals.map(refusal => refusal.code)).toEqual(['statement-unassessed'])
    expect(refusals[0]?.citeKey).toBe(CITE_KEY)
  })

  it('refuses a sentence assessed on a passage the source no longer holds', () => {
    // THE EVIDENCE MOVED, NOT THE SENTENCE. A `.bib` and a citation whose passage was replaced leave a
    // verdict resting on words nobody read, which is refused exactly as a rewritten sentence is.
    const statements = locateStatements([{ id: 'discussion', bodyText: body }])
    const first = statements[0]
    if (first === undefined) return
    const elsewhere = { ...judgement, quoteSha256: 'b'.repeat(64) }
    const refusals = checkStatementSupport([assessed(first.statementId, first.textSha256)], statements, [elsewhere])
    expect(refusals[0]?.code).toBe('statement-unassessed')
    expect(refusals[0]?.detail).toContain('evidence that has changed')
  })

  it('refuses a sentence rewritten since it was assessed', () => {
    const statements = locateStatements([{ id: 'discussion', bodyText: body }])
    const first = statements[0]
    if (first === undefined) return
    const refusals = checkStatementSupport([assessed(first.statementId, 'c'.repeat(64))], statements, [judgement])
    expect(refusals[0]?.code).toBe('statement-unassessed')
    expect(refusals[0]?.detail).toContain('rewritten')
  })
})

describe('a citation of a source this run read', () => {
  it('quotes from the passage the registration recorded, and is refused without one', () => {
    // WHERE THE PASSAGE LIVES. `checkCitationUse` reads the JUDGEMENT's quote, not the source's
    // binding: what a citation rests on is the passage somebody read, and the binding is what says
    // where that passage was, at which versions. The registered source is what supplies the locator,
    // so a judgement built from it is checkable — and one with no quote is refused as a citation
    // that establishes nothing.
    const sources = sourcesForMode('zotero', [REGISTRATION])
    const record = sources.get(REGISTRATION.identity)
    expect(record).toBeDefined()
    if (record === undefined) return
    const binding = record.evidence
    expect(binding?.locator).toContain('page 4 of 10')
    const judgement: SourceJudgement = {
      literatureRef: record.id,
      citeKey: citeKeyOf(record),
      location: binding?.locator ?? '',
      quote: 'the criticality of the experienced situation on a single item with a graphical analog scale',
      quoteSha256: binding?.contentSha256 ?? '',
      support: 'supported',
      readScope: 'full-text',
      access: 'read',
      accessNote: '',
      judgedBy: 'the live reading',
    }
    expect(checkCitationUse(judgement, record)).toEqual([])
    expect(checkCitationUse({ ...judgement, quote: '   ' }, record).map(refusal => refusal.code))
      .toEqual(['citation-no-passage'])
  })

  it('is still refused when the source was corrected, whatever its evidence says', () => {
    // THE IDENTITY CHECKS STILL RUN. Registering a source binds its passage; it does not exempt the
    // record from a retraction the catalogue states.
    const sources = sourcesForMode('zotero', [REGISTRATION])
    const record = sources.get(REGISTRATION.identity)
    if (record === undefined) return
    const retracted = {
      ...record,
      correction: { kind: 'retracted' as const, note: 'the catalogue marks it retracted' },
    }
    const judgement: SourceJudgement = {
      literatureRef: record.id,
      citeKey: citeKeyOf(record),
      location: record.evidence?.locator ?? '',
      quote: 'a passage',
      quoteSha256: record.evidence?.contentSha256 ?? '',
      support: 'supported',
      readScope: 'full-text',
      access: 'read',
      accessNote: '',
      judgedBy: 'the live reading',
    }
    expect(checkCitationUse(judgement, retracted).map(refusal => refusal.code))
      .toEqual(['citation-source-retracted'])
  })
})
