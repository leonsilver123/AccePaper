/**
 * Which words a judgement was about, and the three axes that must not carry one.
 *
 * THE REGRESSION THIS FILE OWNS is that the axes stay separate. A source read from a repository and a
 * source read from a running library are the same kind of thing, and the policy that decides whether
 * evidence may carry a gate must not prefer one — nor may a recorded review promote a source, because
 * a review is a statement about one passage at one version and not a rank on the work.
 */
import { describe, expect, it } from 'vitest'
import {
  admitAsEvidence, evidenceStalenessOf, isReviewStatus, isSourceAcquisition, isSourceRegistry,
} from '../../src/index.ts'
import type { EvidenceBinding, Provenance } from '../../src/index.ts'

/** A binding as a live library read produced it. */
function binding(overrides: Partial<EvidenceBinding> = {}): EvidenceBinding {
  return {
    sourceIdentity: 'zotero:user:17529257:UA5MIGG3',
    sourceVersion: '3408',
    attachment: { key: 'PU2XWW83', version: '2690' },
    locator: 'page 4 of 10 in attachment PU2XWW83',
    contentSha256: 'a'.repeat(64),
    route: 'mcp__zotero__zotero_read_pdf_pages',
    ruleVersion: 'zotero-local-read-v1',
    ...overrides,
  }
}

describe('the axes a source is described on', () => {
  it('recognises the values it declares and refuses the ones it does not', () => {
    expect(isSourceRegistry('zotero')).toBe(true)
    expect(isSourceRegistry('curated')).toBe(true)
    expect(isSourceRegistry('scihub')).toBe(false)
    expect(isSourceAcquisition('live-library-read')).toBe(true)
    expect(isSourceAcquisition('downloaded')).toBe(false)
    expect(isReviewStatus('human-reviewed')).toBe(true)
    expect(isReviewStatus('peer-reviewed')).toBe(false)
  })

  it('does not let the registry a source came from change its admission', () => {
    // THE INFERENCE THIS FORBIDS: "checked into the repository" read as "verified", and "from a live
    // library" read as "less trustworthy". Both inferences are about provenance, and the gate is
    // decided from what the value IS and how much of it was read.
    const base: Provenance = {
      sourceClass: 'literature',
      producer: 'dsh-research-cordis/zotero-provider',
      sourceAccess: 'full-text',
    }
    const fromLibrary = admitAsEvidence('production', {
      ...base, registry: 'zotero', acquisition: 'live-library-read',
    })
    const fromCorpus = admitAsEvidence('production', {
      ...base, registry: 'curated', acquisition: 'retrieved-then-checked-in',
    })
    expect(fromLibrary).toEqual(fromCorpus)
    expect(fromLibrary.disposition).toBe('admitted')
  })

  it('does not let a recorded review change an admission, in either direction', () => {
    // A REVIEW IS NOT A RANK ON THE WORK. It is a statement about one passage at one version, and the
    // only thing that may carry it is an EvidenceBinding. So a reviewed source is not thereby
    // admissible, and an unreviewed one is not thereby held.
    const base: Provenance = {
      sourceClass: 'literature', producer: 'p', sourceAccess: 'full-text',
    }
    expect(admitAsEvidence('production', { ...base, review: 'human-reviewed' }))
      .toEqual(admitAsEvidence('production', { ...base, review: 'unreviewed' }))
    // And the axes cannot rescue a class that may not carry a gate at all.
    expect(admitAsEvidence('production', {
      sourceClass: 'fixture', producer: 'p', registry: 'zotero', review: 'human-reviewed',
    }).disposition).toBe('refused')
  })
})

describe('whether a judgement is still about the words it was made from', () => {
  it('holds when nothing moved', () => {
    const staleness = evidenceStalenessOf(binding(), binding())
    expect(staleness.stale).toBe(false)
    expect(staleness.moved).toEqual([])
  })

  it('reports the source record moving on its own', () => {
    const staleness = evidenceStalenessOf(binding(), binding({ sourceVersion: '3409' }))
    expect(staleness.moved).toEqual(['source-version'])
    expect(staleness.detail).toContain('source-version')
  })

  it('reports the file being replaced while the source record stands still', () => {
    // THE CASE THE GUIDANCE NAMES: an attachment is changed and the parent item's version does not
    // necessarily follow, so a check that watched only the source record would see nothing.
    const staleness = evidenceStalenessOf(
      binding(),
      binding({ attachment: { key: 'PU2XWW83', version: '2691' } }),
    )
    expect(staleness.moved).toEqual(['attachment-version'])
  })

  it('treats gaining or losing a file as a move of the same axis', () => {
    // Otherwise reading a source whole and then reading a page of its file would compare equal.
    const gone = evidenceStalenessOf(binding(), binding({ attachment: undefined }))
    expect(gone.moved).toEqual(['attachment-version'])
    const appeared = evidenceStalenessOf(
      binding({ attachment: undefined }),
      binding(),
    )
    expect(appeared.moved).toEqual(['attachment-version'])
  })

  it('reports re-extracted words at the same versions, and the rules that extracted them', () => {
    // THE THIRD INDEPENDENT AXIS: same source, same file, different words — and the same words under
    // different extraction rules are a different reading too.
    expect(evidenceStalenessOf(binding(), binding({ contentSha256: 'b'.repeat(64) })).moved)
      .toEqual(['content'])
    expect(evidenceStalenessOf(binding(), binding({ ruleVersion: 'zotero-local-read-v2' })).moved)
      .toEqual(['rules'])
    expect(evidenceStalenessOf(binding(), binding({ route: 'mcp__zotero__zotero_get_item_fulltext' })).moved)
      .toEqual(['route'])
  })

  it('reports every axis that moved, not just the first', () => {
    const staleness = evidenceStalenessOf(binding(), binding({
      sourceVersion: '3409', contentSha256: 'c'.repeat(64), ruleVersion: 'v2',
    }))
    expect(staleness.moved).toEqual(['source-version', 'content', 'rules'])
  })

  it('calls a different source a different source rather than a stale reading', () => {
    // TWO PASSAGES OF ONE DOI ARE NOT ONE PIECE OF EVIDENCE, so the identity is the registry's and a
    // change of it is reported as what it is. A comparison keyed on the DOI would find nothing here.
    const staleness = evidenceStalenessOf(binding(), binding({
      sourceIdentity: 'zotero:user:17529257:OTHERKEY',
    }))
    expect(staleness.moved).toEqual(['source-identity'])
  })
})
