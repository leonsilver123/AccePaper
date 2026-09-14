// Recomputes a Case Pack's `hashOfInputs` and refuses when it disagrees.
//
// Run from the repository root:
//   node --import tsx/esm packages/research/dsh-research-team/scripts/verify-case-pack-manifest.mjs <pack-directory>
//
// The scheme is stated in `write-case-pack-manifest.mjs`. This script is the check half: an
// edit to any file the manifest names, without regenerating the manifest, fails here rather
// than passing silently. Exit code 0 means the pack is intact; 1 means it is not.

import { readFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

import { MANIFEST_SCHEME_VERSION, digestOfInputs } from './write-case-pack-manifest.mjs'

const target = process.argv[2] ?? 'plan/overnight/2026-09-09/case-pack-traffic-v2'
const directory = isAbsolute(target) ? target : resolve(process.cwd(), target)
const manifest = JSON.parse(readFileSync(join(directory, 'reproducibility-manifest.json'), 'utf8'))

const actual = digestOfInputs(directory, manifest.inputFiles)
if (actual !== manifest.hashOfInputs) {
  console.error(
    `[manifest] MISMATCH at ${directory}\n  declared: ${manifest.hashOfInputs}\n  computed: ${actual}\n`
    + '  Regenerate with scripts/write-case-pack-manifest.mjs after editing any pack file.',
  )
  process.exit(1)
}
console.log(`[manifest] OK (${MANIFEST_SCHEME_VERSION}) ${actual}`)
