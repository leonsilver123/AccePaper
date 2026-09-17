// Verify one written package against the manifest that names it.
//
// WHAT IT ANSWERS. "Is this directory the package its manifest describes?" — every entry present,
// the stated number of bytes, the stated digest. A package is copied, trimmed, merged with another
// export or read as documentation often enough that the question comes up about directories this
// repository did not write, so the check takes a directory rather than a run.
//
// HAND-INVOKED, like `dsh-research-cordis/scripts/repro-check.mjs`: its input is a directory on disk
// that no test owns. The comparison itself is `checkPackagedFiles`, which the package's own spec
// covers; this is the runner for directories that live outside the test tree.
//
// Run: node --import tsx/esm packages/research/dsh-research-team/scripts/verify-package-directory.mjs <package-directory>

import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { checkPackagedFiles } from '../src/runner/package-export.ts'

const directory = resolve(process.argv[2] ?? '')
if (directory === '' || process.argv[2] === undefined) {
  console.error('usage: verify-package-directory.mjs <package-directory>')
  process.exit(2)
}

const manifest = JSON.parse(readFileSync(join(directory, 'run-manifest.json'), 'utf8'))
const checks = checkPackagedFiles(directory, manifest)
const bad = checks.filter(check => check.status !== 'ok')

console.log(`manifest: run ${manifest.runId} at revision ${String(manifest.projectRevision)}, generated ${manifest.generatedAt}`)
if (manifest.state !== undefined) {
  const failed = (manifest.checks ?? []).filter(check => !check.passed).map(check => check.code)
  console.log(`state: ${manifest.state}${failed.length === 0 ? '' : ` (unmet: ${failed.join(', ')})`}`)
}
for (const check of checks) {
  const detail = check.status === 'ok'
    ? `${String(check.expectedBytes)} B`
    : `expected ${String(check.expectedBytes)} B / ${check.expectedSha256.slice(0, 12)}…, found `
      + `${check.observedBytes === undefined ? 'nothing' : `${String(check.observedBytes)} B / ${String(check.observedSha256).slice(0, 12)}…`}`
  console.log(`${check.status === 'ok' ? '  ok  ' : ' FAIL '} ${check.path} — ${check.status}: ${detail}`)
}

// WHAT THE MANIFEST NAMES BUT THE DIRECTORY MAY NOT HOLD. A manifest lists the files the export
// wrote; a directory that also carries files the manifest does not name is a different fact (a
// reading copy beside the package, say) and is reported rather than treated as a failure.
const named = new Set(checks.map(check => check.path))
const extra = listFiles(directory).filter(path => path !== 'run-manifest.json' && !named.has(path))

console.log(
  `
${String(checks.length - bad.length)}/${String(checks.length)} files verify`
  + (extra.length === 0 ? '' : `; ${String(extra.length)} file(s) are here that the manifest does not name: ${extra.join(', ')}`),
)
process.exit(bad.length === 0 ? 0 : 1)

/**
 * Every file under a directory, as package-relative paths.
 *
 * @param root - the package root.
 * @param prefix - the subdirectory being walked, relative to the root.
 * @returns one path per file.
 */
function listFiles(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    return entry.isDirectory() ? listFiles(root, path) : [path]
  })
}
