/**
 * The identity check that decides whether a runtime claim describes the code it names.
 *
 * The property that matters most is the negative one: a timestamp is NOT identity. Copying,
 * checking out, or unzipping a build moves every mtime without changing a byte, and a build that
 * writes identical bytes is the same build. The `mtime` case below is the one that fails if anyone
 * ever swaps the digest for a timestamp comparison.
 */

import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  compareIdentities,
  identityOf,
  RESEARCH_PACKAGES,
} from './research-runtime-identity.ts'

/** A throwaway directory holding one tree, removed when the case ends. */
function tree(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-identity-'))
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

describe('the research build identity', () => {
  it('reports no difference for two identical trees', () => {
    const files = {
      'index.js': 'export const a = 1\n',
      'types/x.d.ts': 'export type X = 1\n',
    }
    const left = tree(files)
    const right = tree(files)
    try {
      expect(
        compareIdentities(identityOf(left), identityOf(right), 'pkg'),
      ).toEqual([])
      expect(identityOf(left).treeHash).toBe(identityOf(right).treeHash)
    } finally {
      rmSync(left, { recursive: true, force: true })
      rmSync(right, { recursive: true, force: true })
    }
  })

  it('names a file the installed copy does not have, and one it has extra', () => {
    const expected = tree({ 'index.js': 'a\n', 'only-in-build.js': 'b\n' })
    const installed = tree({ 'index.js': 'a\n', 'only-in-install.js': 'c\n' })
    try {
      expect(
        compareIdentities(identityOf(expected), identityOf(installed), 'pkg'),
      ).toEqual([
        { package: 'pkg', kind: 'missing', path: 'only-in-build.js' },
        { package: 'pkg', kind: 'extra', path: 'only-in-install.js' },
      ])
    } finally {
      rmSync(expected, { recursive: true, force: true })
      rmSync(installed, { recursive: true, force: true })
    }
  })

  it('names a file whose bytes differ, however small the change', () => {
    const expected = tree({ 'index.js': 'the declared threshold is 20%\n' })
    const installed = tree({ 'index.js': 'the declared threshold is 21%\n' })
    try {
      expect(
        compareIdentities(identityOf(expected), identityOf(installed), 'pkg'),
      ).toEqual([{ package: 'pkg', kind: 'changed', path: 'index.js' }])
    } finally {
      rmSync(expected, { recursive: true, force: true })
      rmSync(installed, { recursive: true, force: true })
    }
  })

  it('does NOT treat a newer timestamp as a different build', () => {
    // The case that fails if the digest is ever replaced by an mtime comparison. The two trees hold
    // identical bytes written years apart.
    const left = tree({ 'index.js': 'same bytes\n' })
    const right = tree({ 'index.js': 'same bytes\n' })
    try {
      const past = new Date('2020-01-01T00:00:00Z')
      utimesSync(join(right, 'index.js'), past, past)
      expect(
        compareIdentities(identityOf(left), identityOf(right), 'pkg'),
      ).toEqual([])
    } finally {
      rmSync(left, { recursive: true, force: true })
      rmSync(right, { recursive: true, force: true })
    }
  })

  it('identifies an empty file rather than skipping it', () => {
    // A build output that is empty in one tree and absent in the other is a difference; skipping
    // zero-byte files would report the two builds as the same.
    const expected = tree({ 'index.js': 'a\n', 'empty.js': '' })
    const installed = tree({ 'index.js': 'a\n' })
    try {
      expect(
        compareIdentities(identityOf(expected), identityOf(installed), 'pkg'),
      ).toEqual([{ package: 'pkg', kind: 'missing', path: 'empty.js' }])
    } finally {
      rmSync(expected, { recursive: true, force: true })
      rmSync(installed, { recursive: true, force: true })
    }
  })

  it('covers the packages the profile installs, bundle included', () => {
    // The bundle carries the plugin rows; omitting it would leave the app's composition unchecked.
    expect(RESEARCH_PACKAGES.map(([, name]) => name)).toEqual([
      'dsh-research-app',
      'dsh-research-core',
      'dsh-research-tools',
      'dsh-research-cordis',
      'dsh-research-team',
      'dsh-research-web',
    ])
  })
})
