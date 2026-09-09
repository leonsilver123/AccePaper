#!/usr/bin/env node
/**
 * Reproducibility consistency check (Phase 1.1-R track D).
 *
 * Verifies that the research-cordis package.json dependencies, the pnpm-lock
 * importer, and the workspace link targets agree, so a fresh frozen install
 * reproduces the same resolution WITHOUT any manual node_modules Junction.
 *
 * Usage: node scripts/repro-check.mjs
 * Exit code 0 = consistent; 1 = a mismatch (fix before claiming clean install).
 *
 * NOTE: this is a SAFETY CHECK only — it does not run pnpm or modify the lock.
 * pnpm itself remains environment-blocked (corepack shim broken, no pnpm
 * binary); while that lasts, Clean-install verified stays CONDITIONAL.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG_ROOT = join(HERE, '..')
const REPO_ROOT = join(PKG_ROOT, '..', '..', '..')

const cordisPkg = JSON.parse(readFileSync(join(PKG_ROOT, 'package.json'), 'utf8'))
const lock = readFileSync(join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8')

const errors = []

// 1. Every workspace dependency of dsh-research-cordis must appear in the
//    lockfile importer block with a `link:` target whose relative path matches
//    the actual workspace package location.
const importer = `  packages/research/dsh-research-cordis:`
const start = lock.indexOf(importer)
if (start < 0) {
  errors.push('lockfile importer block for packages/research/dsh-research-cordis not found')
} else {
  const block = lock.slice(start, lock.length)
  const lines = block.split('\n')
  const findLinkTarget = (name) => {
    const needle = `'${name}':`
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === needle || lines[i].trim().startsWith(needle)) {
        for (let j = i + 1; j < Math.min(i + 5, lines.length); j++) {
          const m = lines[j].match(/version: (link:\S+)/)
          if (m) return m[1].slice('link:'.length)
        }
      }
    }
    return null
  }
  const dependencies = cordisPkg.dependencies ?? {}
  for (const [name, specifier] of Object.entries(dependencies)) {
    if (specifier !== 'workspace:^') continue
    const linkTarget = findLinkTarget(name)
    if (linkTarget === null) {
      errors.push(`lockfile importer missing workspace dependency '${name}'`)
      continue
    }
    // Verify the link target directory actually contains the package manifest.
    const resolved = join(REPO_ROOT, 'packages/research/dsh-research-cordis', linkTarget)
    let ok = false
    try {
      const targetPkg = JSON.parse(readFileSync(join(resolved, 'package.json'), 'utf8'))
      ok = targetPkg.name === name
    } catch {
      ok = false
    }
    if (!ok) errors.push(`lockfile link for '${name}' -> ${linkTarget} does not resolve to package '${name}'`)
  }
}

// 2. package.json exports must expose the patch + package manifest used by the
//    cordis loader / consumer smoke.
if (cordisPkg.exports?.['./package.json'] === undefined) {
  errors.push('cordis package.json does not export ./package.json for consumer smoke')
}

if (errors.length > 0) {
  console.error('[repro-check] MISMATCHES:')
  for (const e of errors) console.error('  - ' + e)
  console.error(`
Expected commands once pnpm is available (run from a CLEAN directory, no Junction):
  pnpm install --frozen-lockfile
  pnpm --filter @deepseek-ai/dsh-research-cordis typecheck
  pnpm --filter @deepseek-ai/dsh-research-cordis test
  pnpm --filter @deepseek-ai/dsh-research-cordis pack
  # consumer smoke: unpack the tarball into a scratch dir and import its main.
`)
  process.exit(1)
}
console.log('[repro-check] package.json / lockfile importer / workspace links consistent')
