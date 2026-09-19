/**
 * The staged write, exercised directly.
 *
 * THE ASSERTIONS MOVED HERE FROM THE PACKAGE EXPORT. They used to be reachable only through
 * `writeRunPackage`, which meant the discipline they pin — stage, verify, swap, and put the previous
 * directory back on a failed swap — was stated once for the package and not at all for the second
 * caller. They are about this function, so they live with it; `package-export.spec.ts` keeps the
 * cases that are about what a PACKAGE contains.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { checkWrittenFiles, writeStagedDirectory } from '../src/runner/staged-directory.ts'

const roots: string[] = []

/** A fresh directory under the OS temporary directory. */
function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-staged-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A plan whose manifest is the file list plus a fixed note. */
function plan(files: ReadonlyArray<{ path: string; content: string; encoding?: 'utf8' | 'base64' }>) {
  return {
    files,
    manifestName: 'manifest.json',
    manifest: (written: ReadonlyArray<{ path: string; bytes: number; sha256: string }>) => ({
      value: { note: 'a test directory', files: written },
      text: `${JSON.stringify({ note: 'a test directory', files: written }, null, 2)}\n`,
    }),
  }
}

describe('a staged directory is written, verified, then swapped in', () => {
  it('writes every file, names it with its digest, and leaves nothing beside it', () => {
    const root = workspace()
    const target = join(root, 'out')
    const result = writeStagedDirectory(plan([
      { path: 'manuscript.md', content: '# Title\n' },
      { path: 'figures/figure-1.svg', content: '<svg/>\n' },
      { path: 'assets/figure-1.png', content: Buffer.from('png').toString('base64'), encoding: 'base64' },
    ]), target)
    expect(result.files.map(file => file.path)).toEqual([
      'manuscript.md', 'figures/figure-1.svg', 'assets/figure-1.png',
    ])
    expect(readFileSync(join(target, 'manuscript.md'), 'utf8')).toBe('# Title\n')
    expect(readFileSync(join(target, 'assets/figure-1.png'), 'utf8')).toBe('png')
    expect(result.manifest).toEqual({ note: 'a test directory', files: result.files })
    // NOTHING WAS LEFT BESIDE IT: no staging directory, no superseded copy.
    expect(readdirSync(root).filter(name => name.includes('staging-') || name.includes('superseded-'))).toEqual([])
    expect(existsSync(join(target, 'manifest.json'))).toBe(true)
  })

  it('replaces the directory that was there, keeping no copy of the one it replaced', () => {
    const root = workspace()
    const target = join(root, 'out')
    writeStagedDirectory(plan([{ path: 'a.txt', content: 'first\n' }]), target)
    writeStagedDirectory(plan([{ path: 'b.txt', content: 'second\n' }]), target)
    expect(readdirSync(target).sort()).toEqual(['b.txt', 'manifest.json'])
  })
})

describe('a failed write leaves the directory that was there', () => {
  it('puts the published directory back, and leaves no half-written one behind', () => {
    const root = workspace()
    const target = join(root, 'out')
    const published = writeStagedDirectory(plan([{ path: 'manuscript.md', content: '# kept\n' }]), target)
    // A PLAN WHOSE SWAP MUST FAIL: an empty file is refused after it lands, before the swap.
    expect(() => writeStagedDirectory(plan([
      { path: 'manuscript.md', content: '# replaced\n' },
      { path: 'empty.txt', content: '' },
    ]), target)).toThrow(/written empty/u)
    expect(readFileSync(join(target, 'manuscript.md'), 'utf8')).toBe('# kept\n')
    expect(checkWrittenFiles(target, published.files).filter(check => check.status !== 'ok')).toEqual([])
    expect(readdirSync(root).filter(name => name.includes('staging-') || name.includes('superseded-'))).toEqual([])
  })

  it('refuses a file that lands empty, naming it', () => {
    const root = workspace()
    expect(() => writeStagedDirectory(plan([{ path: 'manuscript.md', content: '' }]), join(root, 'out')))
      .toThrow(/manuscript\.md was written empty/u)
    expect(existsSync(join(root, 'out'))).toBe(false)
  })
})

describe('verify this directory against its manifest is one call', () => {
  it('checks every file: present, the stated bytes, the stated digest', () => {
    const root = workspace()
    const target = join(root, 'out')
    const written = writeStagedDirectory(plan([{ path: 'manuscript.md', content: '# Title\n' }]), target).files
    expect(checkWrittenFiles(target, written)).toEqual([{
      path: 'manuscript.md',
      status: 'ok',
      expectedBytes: 8,
      expectedSha256: written[0]?.sha256,
      observedBytes: 8,
      observedSha256: written[0]?.sha256,
    }])
  })

  it('reports a file that is gone, one that changed length, and one changed without changing length', () => {
    const root = workspace()
    const target = join(root, 'out')
    const written = writeStagedDirectory(plan([
      { path: 'gone.txt', content: 'aaaaaaaa\n' },
      { path: 'truncated.txt', content: 'bbbbbbbb\n' },
      { path: 'edited.txt', content: 'cccccccc\n' },
    ]), target).files
    rmSync(join(target, 'gone.txt'))
    writeFileSync(join(target, 'truncated.txt'), 'bbbb\n')
    writeFileSync(join(target, 'edited.txt'), 'cccccccc\n'.replace('c', 'd'))
    const byPath = new Map(checkWrittenFiles(target, written).map(check => [check.path, check.status]))
    expect(byPath.get('gone.txt')).toBe('missing')
    expect(byPath.get('truncated.txt')).toBe('bytes-differ')
    // SAME LENGTH, DIFFERENT BYTES, and the digest is what says so.
    expect(byPath.get('edited.txt')).toBe('digest-differs')
  })
})

describe('a directory this reader cannot verify', () => {
  it('reports every manifest entry, in the manifest order', () => {
    const root = workspace()
    const checks = checkWrittenFiles(join(root, 'never-written'), [
      { path: 'b.txt', bytes: 1, sha256: 'x' },
      { path: 'a.txt', bytes: 1, sha256: 'y' },
    ])
    expect(checks.map(check => [check.path, check.status])).toEqual([
      ['b.txt', 'missing'], ['a.txt', 'missing'],
    ])
  })
})

describe('a plan that would put two contents in one file', () => {
  it('is refused, naming the path', () => {
    const root = workspace()
    expect(() => writeStagedDirectory(plan([
      { path: 'manuscript.md', content: 'one\n' },
      { path: 'manuscript.md', content: 'two\n' },
    ]), join(root, 'out'))).toThrow(/'manuscript\.md' is listed twice/u)
    expect(existsSync(join(root, 'out'))).toBe(false)
  })
})
