// @deepseek-ai/dsh-research-cordis — the sources a run may cite, read from the configured library.
//
// WHAT THIS IS FOR. A run pointed at a literature library has to be able to CITE what it read there,
// and the citation registry admits a source only when it arrives with an identity, a version and the
// passage a judgement would rest on. This module reads exactly that for the items a deployment names
// as its cited sources, and hands them over in the vocabulary both packages already share.
//
// A FAILURE YIELDS NO SOURCE, NOT A WEAKER ONE. Each item is read as one source record AND one page,
// both at a version the library states; when either read fails the item contributes nothing and the
// failure is named. A caller in `zotero` mode then has fewer sources than it named — or none — which
// is the truthful outcome, and is why this returns failures beside registrations rather than
// degrading an item into something citable.
//
// AND THE PAGE IS NOT DECORATION. A registered source without the passage it was read at would be a
// bibliography entry the citation chain cannot check, which is the state this whole unit ends.

import type { SourceRegistration } from '@deepseek-ai/dsh-research-core'
import type { ZoteroPassage, ZoteroProvider, ZoteroSource } from './zotero-provider.ts'

/** One item a deployment designates as a source its runs may cite. */
export interface CitedItem {
  /** The library item to read. */
  readonly itemKey: string
  /** The page of it that the evidence for this source is read from. */
  readonly page: number
  /** The key the library's own bibliographic entry carries, which the returned entry is checked against. */
  readonly bibtexKey: string
}

/** What one designated item produced. */
export interface RegistrationRead {
  readonly registrations: ReadonlyArray<SourceRegistration>
  /** One sentence per item that could not be registered, naming the item and why. */
  readonly failures: ReadonlyArray<string>
  /**
   * The library's own item key for each registration, by the identity the registration carries.
   *
   * RECORDED WHERE BOTH ARE KNOWN. A registration names its source by the identity this package
   * minted (`zotero:<type>:<library>:<itemKey>`), and reading that source's FILE needs the bare item
   * key the local API addresses. Decoding the identity back into a key would put the scheme in two
   * places — the function that mints it and a parser that has to keep up with it — so the pair is
   * taken here, from the read that produced it.
   */
  readonly itemKeys: ReadonlyMap<string, string>
}

/**
 * One source and one page of it, as a registration.
 *
 * THE CITATION REF IS THE NAMESPACE THE ENTRY STATES. A DOI when the entry carries one, else the
 * source's own identity under `unknown` — never an empty DOI-shaped ref, which would print an
 * identifier that resolves to nothing.
 *
 * @param source - the source record and its entry, read at one version.
 * @param passage - the page read from it, at the same version.
 * @returns the registration, carrying the binding a judgement about it would rest on.
 */
export function registrationOf(source: ZoteroSource, passage: ZoteroPassage): SourceRegistration {
  const doi = source.citation.doi
  return {
    identity: source.literatureId,
    ref: doi === undefined || doi === ''
      ? { kind: 'unknown', id: source.literatureId }
      : { kind: 'doi', id: doi },
    title: source.citation.title,
    authors: source.citation.authors,
    ...(source.citation.year === undefined ? {} : { year: source.citation.year }),
    ...(source.citation.container === undefined ? {} : { venue: source.citation.container }),
    registry: 'zotero',
    acquisition: 'live-library-read',
    // THE BINDING IS THE PAGE, NOT THE SOURCE: the item's own version, the attachment's own version,
    // the locator a reader can act on, and the hash of the words as they were read. All of them, so
    // an edit to any of the three stops a judgement made from this one.
    evidence: {
      sourceIdentity: source.literatureId,
      sourceVersion: String(source.version),
      attachment: { key: passage.attachment.key, version: String(passage.attachment.version) },
      locator: passage.where,
      contentSha256: passage.contentSha256,
      route: passage.readBy,
      ruleVersion: passage.ruleVersion,
    },
  }
}

/**
 * Read the designated items as citable sources.
 *
 * @param provider - the configured library.
 * @param items - the items this deployment designates as cited sources.
 * @param signal - cancellation from the caller.
 * @returns the registrations, and one sentence per item that could not be read.
 */
export async function readRegistrations(
  provider: ZoteroProvider,
  items: ReadonlyArray<CitedItem>,
  signal?: AbortSignal,
): Promise<RegistrationRead> {
  const registrations: SourceRegistration[] = []
  const failures: string[] = []
  const itemKeys = new Map<string, string>()
  for (const item of items) {
    // THE ENTRY AND THE RECORD ARE READ AS ONE VERSION, which is what `readSource` refuses to skip;
    // the page is read after it, and the two versions are compared so a passage from one revision is
    // never registered under another.
    const source = await provider.readSource(item.itemKey, item.bibtexKey, signal)
    if (!source.ok) {
      failures.push(`'${item.itemKey}' could not be registered: [${source.failure.code}] ${source.failure.detail}`)
      continue
    }
    const passage = await provider.readPage(item.itemKey, item.page, signal)
    if (!passage.ok) {
      failures.push(`'${item.itemKey}' page ${String(item.page)} could not be read:`
        + ` [${passage.failure.code}] ${passage.failure.detail}`)
      continue
    }
    if (passage.passage.itemVersion !== source.source.version) {
      // THE LIBRARY MOVED BETWEEN THE TWO READS. Registering the pair would bind a citation to a
      // revision its evidence never came from, which is the mixture `readSource` exists to refuse.
      failures.push(`'${item.itemKey}' was at version ${String(source.source.version)} for its entry and`
        + ` ${String(passage.passage.itemVersion)} for its page ${String(item.page)}, so no single version`
        + ' of it was read as both')
      continue
    }
    const registration = registrationOf(source.source, passage.passage)
    registrations.push(registration)
    itemKeys.set(registration.identity, item.itemKey)
  }
  return { registrations, failures, itemKeys }
}
