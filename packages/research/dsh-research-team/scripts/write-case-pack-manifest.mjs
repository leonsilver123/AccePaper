// Writes a Case Pack's `reproducibility-manifest.json`, including `hashOfInputs`.
//
// Run from the repository root:
//   node --import tsx/esm packages/research/dsh-research-team/scripts/write-case-pack-manifest.mjs <pack-directory>
//
// WHY THIS EXISTS. The v1 traffic pack carries a `hashOfInputs` value that nothing in this
// repository can reproduce: the generator that wrote it (`case-pack-traffic.fixture-writer/v1`)
// was never part of the tree, and no documented scheme produces that value from the file bytes.
// The loader was therefore right to record it as an ASSERTION and never verify it — but a
// versioned input set whose integrity claim cannot be checked is exactly the gap an auditor
// looks for. This script defines the scheme, and the v2 pack's value is a function of it.
//
// THE SCHEME, stated so it can be re-implemented from this comment alone:
//
//   digest = SHA-256 over, for each file named in `inputFiles` IN THAT ORDER, the UTF-8 bytes
//            of the file's name, then a single newline (0x0A), then the file's UTF-8 bytes.
//            No separators, no lengths, no normalisation of line endings: the file's bytes
//            exactly as they are on disk.
//
// `verify-case-pack-manifest.mjs` recomputes it; run it after any edit to a pack file.

import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

/** The scheme's version, recorded in the manifest so a future change is visible. */
export const MANIFEST_SCHEME_VERSION = 'case-pack-manifest.v1'

/**
 * Compute the digest of the declared input files.
 *
 * @param directory - the pack directory.
 * @param inputFiles - the file names, in the order the manifest declares them.
 * @returns the lower-case hex SHA-256.
 */
export function digestOfInputs(directory, inputFiles) {
  const hash = createHash('sha256')
  for (const name of inputFiles) {
    hash.update(name, 'utf8')
    hash.update('\n', 'utf8')
    hash.update(readFileSync(join(directory, name)))
  }
  return hash.digest('hex')
}

const target = process.argv[2]
if (target === undefined) {
  console.error('usage: write-case-pack-manifest.mjs <pack-directory>')
  process.exit(2)
}
const directory = isAbsolute(target) ? target : resolve(process.cwd(), target)
const manifestPath = join(directory, 'reproducibility-manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

if (!Array.isArray(manifest.inputFiles) || manifest.inputFiles.length === 0) {
  console.error(`[manifest] ${manifestPath} declares no inputFiles`)
  process.exit(1)
}

const digest = digestOfInputs(directory, manifest.inputFiles)
const updated = {
  ...manifest,
  hashAlgorithm: 'sha256',
  hashScheme: MANIFEST_SCHEME_VERSION,
  hashOfInputs: digest,
}
writeFileSync(manifestPath, `${JSON.stringify(updated, null, 2)}\n`, 'utf8')
console.log(`[manifest] ${manifest.inputFiles.length} files -> ${digest}`)
