/**
 * Which words a judgement was made about, and what has to move for it to stop being about them.
 *
 * WHY ONE RECORD AND NOT SIX FIELDS ON SIX OBJECTS. A judgement about a sentence rests on a passage,
 * and that passage has an identity (which source), a version (which revision of the source), a place
 * (which page or other locator), a text (which words), a route (how they were retrieved) and rules
 * (what governed the retrieval and the extraction). Spread across whichever objects happen to carry
 * them, no reader can say which combination a judgement was made against, and nothing has an
 * obligation to compare on the way back in.
 *
 * THE IDENTITY IS THE REGISTRY'S, NOT THE DOI. A DOI names a WORK, and a work has several
 * attachments, several passages and several readings; a review of one of them is a statement about
 * that one, and keying evidence by the DOI is how a judgement made about one passage comes to be
 * read as a judgement about another. Where a registry has its own identity — a library and an item
 * key — that identity is what this record holds, and the DOI travels beside it for cross-checking.
 *
 * EVERY AXIS PARTICIPATES IN INVALIDATION, and none of them implies another. An attachment can be
 * replaced without the source record moving; a source record can be edited without the file
 * changing; a file can be re-extracted into different words under the same versions. So a reading is
 * compared against the one it was made from on all of them, and any that moved makes it stale.
 */

/** The registry a source was read from. A REGISTRY, not a level of trust. */
export type SourceRegistry =
  /** A live literature library, read during the run. */
  | 'zotero'
  /** The sources checked into this repository, read once and recorded. */
  | 'curated'

/** Every {@link SourceRegistry}. */
export const SOURCE_REGISTRIES: readonly SourceRegistry[] = ['zotero', 'curated']

/**
 * Whether a value names a source registry.
 *
 * @param value - a config field, or any wire value.
 * @returns true when the value names a registry.
 */
export function isSourceRegistry(value: unknown): value is SourceRegistry {
  return typeof value === 'string' && (SOURCE_REGISTRIES as ReadonlyArray<string>).includes(value)
}

/**
 * How a source's record entered a run.
 *
 * SEPARATE FROM {@link SourceRegistry} BECAUSE THEY VARY INDEPENDENTLY. A checked-in corpus is
 * retrieved by hand and then committed; a live library is read while the run is going. Neither is
 * more trustworthy for being one or the other, and a reader who wants to know whether a run re-read
 * its sources needs this fact rather than the registry's name.
 */
export type SourceAcquisition =
  /** Read from a running library during this run. */
  | 'live-library-read'
  /** Retrieved separately, then checked in; the run reads the recorded copy, not the source. */
  | 'retrieved-then-checked-in'

/** Every {@link SourceAcquisition}. */
export const SOURCE_ACQUISITIONS: readonly SourceAcquisition[] = [
  'live-library-read',
  'retrieved-then-checked-in',
]

/**
 * Whether a value names an acquisition method.
 *
 * @param value - a config field, or any wire value.
 * @returns true when the value names one.
 */
export function isSourceAcquisition(value: unknown): value is SourceAcquisition {
  return typeof value === 'string' && (SOURCE_ACQUISITIONS as ReadonlyArray<string>).includes(value)
}

/**
 * What review a source, or a judgement about it, has had.
 *
 * `unreviewed` IS NOT A DEFECT. It is the state of every source that was read and not yet judged, and
 * the repository's evidence policy decides what may carry a gate from the source class and the access
 * level — never from this. A review is a statement about specific content at a specific version, so
 * {@link EvidenceBinding} is what says which one it was about.
 */
export type ReviewStatus =
  /** Nobody has recorded a judgement about this source's evidence. */
  | 'unreviewed'
  /** A person, or a model whose answer a person confirmed, recorded one. */
  | 'human-reviewed'

/** Every {@link ReviewStatus}. */
export const REVIEW_STATUSES: readonly ReviewStatus[] = ['unreviewed', 'human-reviewed']

/**
 * Whether a value names a review status.
 *
 * @param value - a config field, or any wire value.
 * @returns true when the value names one.
 */
export function isReviewStatus(value: unknown): value is ReviewStatus {
  return typeof value === 'string' && (REVIEW_STATUSES as ReadonlyArray<string>).includes(value)
}

/**
 * Which registry a run draws its citable sources from.
 *
 * THE RUN SAYS WHICH, AND THE DEFAULT IS THE NARROW ONE. Two registries may both hold sources for one
 * run, and merging them by default would make a source's origin unrecoverable exactly where it
 * matters — in the reference list. `combined` is available and is the only mode that draws on both,
 * and it does so by REGISTERING EACH SOURCE WITH ITS OWN ORIGIN rather than by pooling two lists.
 *
 * A ZOTERO MODE THAT CANNOT READ ITS LIBRARY HAS NO SOURCES. It does not fall back to the
 * checked-in corpus: a run configured to cite what a library holds, and which silently cites what a
 * repository holds instead, has published a bibliography nobody asked for.
 */
export type SourceRegistryMode =
  /** Only sources read from the configured literature library. */
  | 'zotero'
  /** Only the sources checked into this repository. */
  | 'curated'
  /** Both, each source carrying the registry it came from. */
  | 'combined'

/** Every {@link SourceRegistryMode}. */
export const SOURCE_REGISTRY_MODES: readonly SourceRegistryMode[] = ['zotero', 'curated', 'combined']

/**
 * Whether a value names a registry mode.
 *
 * @param value - a config field, or any wire value.
 * @returns true when the value names one.
 */
export function isSourceRegistryMode(value: unknown): value is SourceRegistryMode {
  return typeof value === 'string' && (SOURCE_REGISTRY_MODES as ReadonlyArray<string>).includes(value)
}

/**
 * One source a deployment's registry offers, in the vocabulary both the reader and the registry share.
 *
 * WHY THIS IS DATA AND NOT A CLASS. The package that READS a library and the package that REGISTERS
 * what may be cited are siblings: neither imports the other, so the value they exchange lives in the
 * module both already depend on. It says what the source is and which registry it came from; whether
 * it supports anything is decided elsewhere, from the evidence.
 */
export interface SourceRegistration {
  /** The identity the registry minted; never a DOI, which names a work and not a record. */
  readonly identity: string
  /** The external identifier the record states, in its own namespace. */
  readonly ref: { readonly kind: string; readonly id: string }
  readonly title: string
  readonly authors: ReadonlyArray<string>
  /** The publication year the record states. NEVER inferred from another field. */
  readonly year?: number
  readonly venue?: string
  /** Where this record was read from. */
  readonly registry: SourceRegistry
  /** How it entered the run. */
  readonly acquisition: SourceAcquisition
  /** The passage a judgement about this source would rest on, when one was read. */
  readonly evidence?: EvidenceBinding
}

/** A file a piece of evidence was read out of, and that file's own version. */
export interface EvidenceAttachment {
  /** The registry's key for the file. */
  readonly key: string
  /** The registry's version for THAT FILE. It moves when the file is replaced, which need not move
   *  the source's own record. */
  readonly version: string
}

/**
 * One piece of read evidence: which source, which version, where in it, which words, how it was got.
 *
 * `locator` IS WHAT MAKES A QUOTATION CHECKABLE. A page, a section, a line range or a timestamp — in
 * the words the source's own tools use — so a reader can go to the place rather than to the document.
 */
export interface EvidenceBinding {
  /**
   * The identity the REGISTRY minted for the source, never the DOI.
   *
   * A work's DOI is shared by every attachment and every passage of it; a reading is of one passage,
   * so keying evidence by the DOI is what lets one reading be mistaken for another.
   */
  readonly sourceIdentity: string
  /** The registry's version for the source at the read. */
  readonly sourceVersion: string
  /** The file the words came from, when the source is a file rather than a page of text. */
  readonly attachment?: EvidenceAttachment
  /** Where in the source the words are, in the words the reading tool used. */
  readonly locator: string
  /** SHA-256 over the evidence text as read — not over the tool's reply, which is not the evidence. */
  readonly contentSha256: string
  /** How the words were retrieved, e.g. the tool or endpoint that answered. */
  readonly route: string
  /** Which revision of the retrieval and extraction rules produced them. */
  readonly ruleVersion: string
}

/** Which part of a binding moved. */
export type EvidenceAxis =
  /** A different source entirely. */
  | 'source-identity'
  /** The source's own record was edited. */
  | 'source-version'
  /** The file was replaced. */
  | 'attachment-version'
  /** The words read are not the words that are there now. */
  | 'content'
  /** A different route read them. */
  | 'route'
  /** Different rules extracted them. */
  | 'rules'

/** Whether a binding still describes the evidence, and which axes say it does not. */
export interface EvidenceStaleness {
  readonly stale: boolean
  readonly moved: ReadonlyArray<EvidenceAxis>
  /** A sentence naming what moved, for the audit trail. */
  readonly detail: string
}

/**
 * Compare a binding a judgement was made from against the evidence as it is now.
 *
 * ANY MOVED AXIS MAKES IT STALE, because none of them implies another: an attachment replaced without
 * its parent item moving still puts different words behind the same citation, and a re-extraction
 * under unchanged versions does too. Reporting WHICH axes moved rather than one boolean is what lets
 * a reader tell "the source was edited" from "the file was replaced", which call for different
 * responses.
 *
 * @param binding - the binding recorded when the judgement was made.
 * @param observed - the same source's binding as it is now.
 * @returns whether the evidence changed, which axes moved, and a sentence saying so.
 */
export function evidenceStalenessOf(
  binding: EvidenceBinding,
  observed: EvidenceBinding,
): EvidenceStaleness {
  const moved: EvidenceAxis[] = []
  if (binding.sourceIdentity !== observed.sourceIdentity) moved.push('source-identity')
  if (binding.sourceVersion !== observed.sourceVersion) moved.push('source-version')
  if (attachmentVersionOf(binding) !== attachmentVersionOf(observed)) moved.push('attachment-version')
  if (binding.contentSha256 !== observed.contentSha256) moved.push('content')
  if (binding.route !== observed.route) moved.push('route')
  if (binding.ruleVersion !== observed.ruleVersion) moved.push('rules')
  if (moved.length === 0) {
    return { stale: false, moved, detail: `'${binding.sourceIdentity}' is unchanged at ${binding.locator}` }
  }
  return {
    stale: true,
    moved,
    detail: `'${binding.sourceIdentity}' at ${binding.locator} no longer matches the reading the judgement`
      + ` was made from: ${moved.join(', ')}`,
  }
}

/**
 * One attachment's version, or `none` when the binding has no attachment.
 *
 * A source that gained or lost a file is a move like any other, so the absent case has its own value
 * rather than being skipped — otherwise reading a source as a whole text and then as a page of a file
 * would compare equal.
 *
 * @param binding - the binding.
 * @returns the version, or `none`.
 */
function attachmentVersionOf(binding: EvidenceBinding): string {
  return binding.attachment === undefined
    ? 'none'
    : `${binding.attachment.key}@${binding.attachment.version}`
}
