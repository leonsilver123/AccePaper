/**
 * What a run may cite, read from the library the deployment named.
 *
 * THE FAILURE THIS PREVENTS IS A SILENT SUBSTITUTION. A run pointed at a literature library must cite
 * what that library holds; when the library cannot be read, the honest outcome is that the run has
 * NOTHING to cite. Every case below that ends in a failure asserts that no registration was produced
 * — not that a weaker one was.
 */
import { describe, expect, it } from 'vitest'
import { readRegistrations, registrationOf } from '../src/zotero-registration.ts'
import type { CitedItem } from '../src/zotero-registration.ts'
import type { ZoteroPassage, ZoteroSource } from '../src/zotero-provider.ts'

/** The item the deployment designates, as the live run used it. */
const ITEM: CitedItem = { itemKey: 'UA5MIGG3', page: 4, bibtexKey: 'rocheWhatHappensWhen2020' }

/** A source record and its entry, read at one version. */
function source(version = 3408): ZoteroSource {
  return {
    library: { type: 'user', id: '17529257', name: 'My Library' },
    itemKey: 'UA5MIGG3',
    literatureId: 'zotero:user:17529257:UA5MIGG3' as ZoteroSource['literatureId'],
    version,
    citation: {
      citationKey: 'rocheWhatHappensWhen2020',
      title: 'What happens when drivers of automated vehicles take over control in critical brake situations?',
      authors: ['Roche, Fabienne', 'Thüring, Manfred'],
      year: 2020,
      container: 'Accident Analysis and Prevention',
      volume: '144',
      page: '105588',
      doi: '10.1016/j.aap.2020.105588',
      fields: ['citationKey', 'title', 'authors', 'year', 'container', 'doi'],
    },
    readBy: { metadata: 'local-api-json', bibliography: 'mcp-bibtex' },
    ruleVersion: 'zotero-local-read-v1',
  }
}

/** One page of that source, read at the same version. */
function passage(itemVersion = 3408): ZoteroPassage {
  return {
    literatureId: 'zotero:user:17529257:UA5MIGG3' as ZoteroPassage['literatureId'],
    itemKey: 'UA5MIGG3',
    itemVersion,
    attachment: { key: 'PU2XWW83', version: 2690, filename: 'Roche 2020.pdf', contentType: 'application/pdf' },
    page: 4,
    totalPages: 10,
    where: "page 4 of 10 in attachment PU2XWW83, with the tool's 'PDF Pages' header removed",
    text: 'the criticality of the experienced situation on a single item with a graphical analog scale',
    contentSha256: 'a'.repeat(64),
    readBy: 'mcp-pdf-pages',
    ruleVersion: 'zotero-local-read-v1',
    audit: {
      tool: 'mcp__zotero__zotero_read_pdf_pages',
      raw: '# PDF Pages 4-4 of …',
      rawSha256: 'b'.repeat(64),
      rawLength: 24,
      classification: 'page-text',
    },
  }
}

describe('one source and one page of it, as a registration', () => {
  it('carries the registry identity, the entry\'s fields, and the passage a judgement would rest on', () => {
    const registration = registrationOf(source(), passage())
    expect(registration.identity).toBe('zotero:user:17529257:UA5MIGG3')
    expect(registration.ref).toEqual({ kind: 'doi', id: '10.1016/j.aap.2020.105588' })
    expect(registration.registry).toBe('zotero')
    expect(registration.acquisition).toBe('live-library-read')
    expect(registration.evidence).toEqual({
      sourceIdentity: 'zotero:user:17529257:UA5MIGG3',
      sourceVersion: '3408',
      attachment: { key: 'PU2XWW83', version: '2690' },
      locator: "page 4 of 10 in attachment PU2XWW83, with the tool's 'PDF Pages' header removed",
      contentSha256: 'a'.repeat(64),
      route: 'mcp-pdf-pages',
      ruleVersion: 'zotero-local-read-v1',
    })
  })

  it('falls back to the source\'s own identity when the entry states no DOI', () => {
    // NOT AN EMPTY DOI-SHAPED REF: a citation carrying one would print an identifier that resolves to
    // nothing, and the work is still citable under the identity its registry minted.
    const noDoi = source()
    const citation = { ...noDoi.citation }
    delete (citation as { doi?: unknown }).doi
    const registration = registrationOf({ ...noDoi, citation }, passage())
    expect(registration.ref).toEqual({ kind: 'unknown', id: 'zotero:user:17529257:UA5MIGG3' })
  })
})

describe('reading the designated items', () => {
  /** A library whose two reads answer from these values, or fail as told. */
  function library(read: Partial<Record<'source' | 'page', { readonly ok: false; readonly detail: string }>>): {
    readSource: () => Promise<unknown>
    readPage: () => Promise<unknown>
  } {
    return {
      readSource: () => Promise.resolve(read.source === undefined
        ? { ok: true, source: source() }
        : { ok: false, failure: { code: 'endpoint-unreadable', detail: read.source.detail } }),
      readPage: () => Promise.resolve(read.page === undefined
        ? { ok: true, passage: passage() }
        : { ok: false, failure: { code: 'passage-unrecognized', detail: read.page.detail } }),
    }
  }

  /** The provider shape `readRegistrations` uses, over one scripted library. */
  function providerOver(scripted: ReturnType<typeof library>): Parameters<typeof readRegistrations>[0] {
    return scripted as unknown as Parameters<typeof readRegistrations>[0]
  }

  it('registers the item when both reads answer at one version', async () => {
    const read = await readRegistrations(providerOver(library({})), [ITEM])
    expect(read.failures).toEqual([])
    expect(read.registrations.map(entry => entry.identity)).toEqual(['zotero:user:17529257:UA5MIGG3'])
  })

  it('registers nothing when the library cannot be read, and names the item', async () => {
    // THE SUBSTITUTION THIS PREVENTS. A caller in `zotero` mode gets an empty registry here, so the run
    // has nothing to cite — never the checked-in corpus, which is a bibliography nobody asked for.
    const read = await readRegistrations(
      providerOver(library({ source: { ok: false, detail: 'connect ECONNREFUSED 127.0.0.1:23119' } })),
      [ITEM],
    )
    expect(read.registrations).toEqual([])
    expect(read.failures.join(' ')).toContain('UA5MIGG3')
    expect(read.failures.join(' ')).toContain('ECONNREFUSED')
  })

  it('registers nothing when the page cannot be read, and says which page', async () => {
    // A SOURCE WITH NO EVIDENCE IS A BIBLIOGRAPHY ENTRY, NOT A CITATION. Registering it would let a
    // sentence cite a passage nobody read.
    const read = await readRegistrations(
      providerOver(library({ page: { ok: false, detail: 'the reply does not begin with the page route\'s own header' } })),
      [ITEM],
    )
    expect(read.registrations).toEqual([])
    expect(read.failures.join(' ')).toContain('page 4')
    expect(read.failures.join(' ')).toContain('passage-unrecognized')
  })

  it('refuses a pair read at two versions rather than binding a citation to a mixture', async () => {
    // THE LIBRARY MOVED BETWEEN THE TWO READS. The entry describes one revision and the page came from
    // another; registering the pair would make the citation's evidence a passage that revision never
    // had, which is the mixture `readSource` exists to refuse.
    const moved = providerOver({
      readSource: () => Promise.resolve({ ok: true, source: source(3408) }),
      readPage: () => Promise.resolve({ ok: true, passage: passage(3409) }),
    })
    const read = await readRegistrations(moved, [ITEM])
    expect(read.registrations).toEqual([])
    expect(read.failures.join(' ')).toContain('3408')
    expect(read.failures.join(' ')).toContain('3409')
  })

  it('registers the items it could read and names the ones it could not', async () => {
    // A DEPLOYMENT MAY DESIGNATE SEVERAL. One unreadable item must not silently reduce the set to the
    // ones that happened to answer.
    let call = 0
    const mixed = {
      readSource: () => {
        call += 1
        return Promise.resolve(call === 2
          ? { ok: false, failure: { code: 'version-moved', detail: 'the library is being edited under this read' } }
          : { ok: true, source: source() })
      },
      readPage: () => Promise.resolve({ ok: true, passage: passage() }),
    }
    const read = await readRegistrations(mixed as unknown as Parameters<typeof readRegistrations>[0], [
      ITEM,
      { itemKey: 'SECOND001', page: 2, bibtexKey: 'second' },
    ])
    expect(read.registrations).toHaveLength(1)
    expect(read.failures.join(' ')).toContain('SECOND001')
    expect(read.failures.join(' ')).toContain('version-moved')
  })

  it('registers nothing when the deployment designated nothing', async () => {
    const read = await readRegistrations(providerOver(library({})), [])
    expect(read.registrations).toEqual([])
    expect(read.failures).toEqual([])
  })
})
