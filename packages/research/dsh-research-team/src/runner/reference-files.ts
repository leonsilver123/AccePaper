/**
 * The reference-file seam: reading the attachment a passage was read from.
 *
 * WHY THE RUNNER NEEDS THIS AT ALL. A paper's citations rest on passages, and a passage in a file is
 * read out of that file at a version. A package that carries the manuscript and no file leaves a
 * reader unable to check any quotation against its source — the one operation a citation exists to
 * make possible. So the run stores the files, and the files come from the deployment's library.
 *
 * THE CAPABILITY IS THE DEPLOYMENT'S, AND IT IS OFF UNLESS DECLARED. Reading a file off the machine
 * the provider runs on is a decision a deployment makes rather than a caller, so the reader states
 * whether it reads at all and the package says which of the two it was. Nothing here reads a file
 * itself: this module is the Consumer's declaration of what it needs, and the Provider is whatever
 * the deployment published on the research service.
 *
 * THE IDENTITY IS THE READING RECORD'S. A file is asked for by the item identity and the attachment
 * key a reading record carries — never by a path, and never by the DOI, which names a work rather
 * than one of its files. Which item key those identities resolve to is the provider's business.
 *
 * @module @deepseek-ai/dsh-research-team/runner/reference-files
 */

/** Whether a deployment reads attachment files at all, and how. */
export type ReferenceFilePolicy = 'none' | 'local-cache'

/**
 * One attachment's bytes, as a reader returns them.
 *
 * THE VERSION TRAVELS WITH THE BYTES because they are only the file a passage was read from if the
 * file has not been replaced since. The reader establishes it; the package compares it against the
 * version the reading record states, and refuses bytes that belong to a different file.
 */
export type ReferenceFileRead =
  | {
    readonly ok: true
    /** The attachment the bytes belong to, as the library names it. */
    readonly attachmentKey: string
    /** The attachment's own version, read at the moment the bytes were taken. */
    readonly attachmentVersion: string
    /** SHA-256 over the bytes returned, lower-case hex. */
    readonly sha256: string
    /** The bytes, base64. */
    readonly base64: string
  }
  /** Nothing was read, and why. The reason naming where a machine keeps a file would be a leak. */
  | { readonly ok: false; readonly reason: string }

/**
 * A library that can hand back one attachment's bytes.
 *
 * SPELLED OUT HERE RATHER THAN IMPORTED, because the provider lives in a sibling package that this
 * one does not depend on and must not: the dependency runs one way, and the runner reaches the
 * deployment's capability through the research service.
 */
export interface ReferenceFileReader {
  /** Whether this deployment reads attachment files. `'none'` means nothing is ever requested. */
  readonly policy: ReferenceFilePolicy
  /**
   * Read one attachment's bytes.
   *
   * @param request - the item identity and attachment key a reading record carries.
   * @param signal - cancellation from the caller.
   * @returns the bytes with the version they were read at, or why none were read.
   */
  read(
    request: { readonly sourceIdentity: string; readonly attachmentKey: string },
    signal?: AbortSignal,
  ): Promise<ReferenceFileRead>
}

/**
 * Whether a value is a reader this package can call.
 *
 * CHECKED WHERE A DEPLOYMENT-FACING VALUE ARRIVES. The research service's fields are built from
 * `cordis.yml`, so what reaches here is untyped YAML's product; a reader missing a method would
 * otherwise fail at export time, after a run has spent its steps.
 *
 * @param value - the value read off the research service.
 * @returns true when it names a policy and carries a callable `read`.
 */
export function isReferenceFileReader(value: unknown): value is ReferenceFileReader {
  if (value === null || typeof value !== 'object') return false
  const candidate = value as { policy?: unknown; read?: unknown }
  return (candidate.policy === 'none' || candidate.policy === 'local-cache')
    && typeof candidate.read === 'function'
}
