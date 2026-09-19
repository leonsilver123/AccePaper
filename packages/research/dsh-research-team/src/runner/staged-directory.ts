// @deepseek-ai/dsh-research-team — the staged write every directory this package publishes uses.
//
// WHY THIS IS EXTRACTED. Two directories this package writes are read by people and by later tools:
// a run's reproducible package, and the run's working directory — the document and its assets that
// a person edits and hands back. Both are a DIRECTORY PLUS A MANIFEST, and both are only the thing
// they claim to be while every entry in the manifest still matches the file beside it. Writing files
// in place makes a half-finished write indistinguishable from a finished one: the reader who opens
// the directory after a failure finds a manifest from the previous write sitting beside files from
// the failed one, and nothing on disk says which entries are which.
//
// So the discipline is one implementation: the files go into a staging directory, the staged
// directory is checked against its own manifest, and only then does it replace what was there. A
// failure anywhere before the swap leaves the previous directory exactly as it was.
//
// WHAT A CALLER SUPPLIES. The files as content; the manifest's name; and how the manifest is
// rendered FROM WHAT WAS WRITTEN — the last of these is what keeps a manifest from naming a file
// that failed, so the callback receives the written entries rather than being asked to guess them.

import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** One file a directory will contain, as content rather than as a name. */
export interface StagedFile {
  /** Path relative to the directory root, with forward slashes. */
  readonly path: string
  readonly content: string
  /**
   * How {@link content} is encoded.
   *
   * A compiled figure or a PDF is BYTES, and writing base64 text where a PNG belongs produces a file
   * that looks written and is not the asset. `base64` means the writer decodes; `utf8` (the default)
   * means it encodes.
   */
  readonly encoding?: 'utf8' | 'base64'
}

/** One written file, with what was checked about it after the write. */
export interface WrittenFile {
  readonly path: string
  readonly bytes: number
  /** SHA-256 of the written bytes, lower-case hex. */
  readonly sha256: string
}

/** One file's state against what a manifest says about it. */
export interface WrittenFileCheck {
  readonly path: string
  /** `ok` means present, the stated number of bytes, and the stated digest. */
  readonly status: 'ok' | 'missing' | 'bytes-differ' | 'digest-differs'
  readonly expectedBytes: number
  readonly expectedSha256: string
  /** What is on disk now; absent when the file is not there at all. */
  readonly observedBytes?: number
  readonly observedSha256?: string
}

/** What one staged write produced. */
export interface StagedDirectoryWrite<Manifest> {
  /** The manifest as it was written, with its `files` naming what landed. */
  readonly manifest: Manifest
  /** The files, in the order they were written. */
  readonly files: ReadonlyArray<WrittenFile>
}

/**
 * Create a completed staging directory in place, and publish it only once it is complete.
 *
 * STAGED, VERIFIED, THEN SWAPPED IN. Every file is written, then re-read through `statSync` so a
 * zero-byte or unreadable file is reported here rather than discovered by whoever opens the
 * directory. The manifest is written LAST, so a manifest that exists means the files it names were
 * written.
 *
 * @param request - the files, the manifest's name, and how the manifest is rendered.
 * @param directory - the directory root; created when absent, replaced when it is already there.
 * @returns the manifest as written, with every file's byte count and digest filled in.
 * @throws {Error} when a written file is empty, when the staged directory does not verify, or when
 *   the swap itself fails — in which case the previous directory is put back.
 */
export function writeStagedDirectory<Manifest>(
  request: {
    readonly files: ReadonlyArray<StagedFile>
    /** The manifest's file name inside the directory root. */
    readonly manifestName: string
    /**
     * Render the manifest from what the write produced.
     *
     * Called AFTER every file has landed and been measured, so a manifest cannot name a file that
     * failed. It returns both the value the caller keeps and the text that is written, from one
     * call, so the two cannot describe different manifests.
     */
    readonly manifest: (files: ReadonlyArray<WrittenFile>) => { readonly value: Manifest; readonly text: string }
  },
  directory: string,
): StagedDirectoryWrite<Manifest> {
  const staging = `${directory}.staging-${randomUUID().slice(0, 8)}`
  try {
    const files = writeFiles(request.files, staging)
    const rendered = request.manifest(files)
    writeFileSync(join(staging, request.manifestName), rendered.text, 'utf8')
    const failed = checkWrittenFiles(staging, files).filter(check => check.status !== 'ok')
    if (failed.length > 0) {
      throw new Error(
        '[staged-directory] the staged directory does not match its own manifest: '
        + failed.map(check => `${check.path} (${check.status})`).join(', '),
      )
    }
    publish(staging, directory)
    return { manifest: rendered.value, files }
  } catch (error) {
    rmSync(staging, { recursive: true, force: true })
    throw error
  }
}

/** Write every file of a staged directory, and measure each one as it landed. */
function writeFiles(files: ReadonlyArray<StagedFile>, directory: string): ReadonlyArray<WrittenFile> {
  mkdirSync(directory, { recursive: true })
  // TWO FILES AT ONE PATH IS ONE DIRECTORY THAT CANNOT BE WHAT ITS MANIFEST SAYS, whichever of the
  // two landed last: the first entry's digest describes bytes that are gone. Refused here, where the
  // plan is still the caller's, rather than reported later as drift in a directory nobody edited.
  const seen = new Set<string>()
  for (const file of files) {
    if (seen.has(file.path)) {
      throw new Error(`[staged-directory] '${file.path}' is listed twice — one file has one content`)
    }
    seen.add(file.path)
  }
  const written: WrittenFile[] = []
  for (const file of files) {
    const target = join(directory, file.path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : file.content)
    const size = statSync(target).size
    if (size === 0) {
      throw new Error(`[staged-directory] ${file.path} was written empty — refusing to publish a directory with a hole in it`)
    }
    // THE DIGEST IS OVER THE BYTES THAT LANDED, read back from disk rather than recomputed from the
    // string: a base64 asset and its digest must describe the same file, and hashing the encoded form
    // here would make every asset's digest wrong.
    written.push({ path: file.path, bytes: size, sha256: createHash('sha256').update(readFileSync(target)).digest('hex') })
  }
  return written
}

/**
 * Move a completed staging directory into place, keeping the directory that was there.
 *
 * THE OLD ONE IS MOVED ASIDE, NOT DELETED: a rename that fails — a lock, a full disk — is followed
 * by putting it back, so the failure mode is "the directory is the one from before" rather than
 * "there is no directory".
 *
 * @param staging - the verified directory.
 * @param directory - where it belongs.
 */
function publish(staging: string, directory: string): void {
  const superseded = `${directory}.superseded-${randomUUID().slice(0, 8)}`
  const replacing = existsSync(directory)
  if (replacing) renameSync(directory, superseded)
  try {
    renameSync(staging, directory)
  } catch (error) {
    if (replacing) renameSync(superseded, directory)
    throw error
  }
  if (replacing) rmSync(superseded, { recursive: true, force: true })
}

/**
 * Compare a written directory on disk with the manifest that names it.
 *
 * WHY THIS IS CODE AND NOT A READING DISCIPLINE. A manifest lists byte counts and digests, and a
 * directory is only what it says it is while those still hold — a file edited, a file dropped when
 * the directory was copied somewhere tidier, or a manifest carried beside files from another write
 * all produce a directory that READS like the thing and verifies as nothing. One pass over the
 * manifest makes "verify this" one call rather than a habit.
 *
 * A file whose bytes differ but whose length matches is reported as a DIGEST difference and never as
 * ok: the byte count is the cheap check, and the digest is the one that means something.
 *
 * @param directory - the root the manifest's paths are relative to.
 * @param files - the manifest's own entries, which are what is checked.
 * @returns one entry per manifest entry, in the manifest's order.
 */
export function checkWrittenFiles(
  directory: string,
  files: ReadonlyArray<WrittenFile>,
): ReadonlyArray<WrittenFileCheck> {
  return files.map((file) => {
    const target = join(directory, file.path)
    if (statSync(target, { throwIfNoEntry: false })?.isFile() !== true) {
      return { path: file.path, status: 'missing', expectedBytes: file.bytes, expectedSha256: file.sha256 }
    }
    const bytes = readFileSync(target)
    const digest = createHash('sha256').update(bytes).digest('hex')
    const observed = { observedBytes: bytes.length, observedSha256: digest }
    if (digest === file.sha256) {
      return { path: file.path, status: 'ok', expectedBytes: file.bytes, expectedSha256: file.sha256, ...observed }
    }
    return {
      path: file.path,
      status: bytes.length === file.bytes ? 'digest-differs' : 'bytes-differ',
      expectedBytes: file.bytes,
      expectedSha256: file.sha256,
      ...observed,
    }
  })
}
