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
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkWrittenFiles, writeStagedDirectory } from '../src/runner/staged-directory.ts'

/**
 * The next rename onto this path fails, once.
 *
 * THE SWAP IS INJECTED AT THE FILE-SYSTEM CALL because no state a caller can create makes it fail on
 * every platform this suite runs on: the previous directory is moved aside first, so the destination
 * is free by the time the swap runs, and the two renames need the same parent and the same
 * permissions. A lock inside the staged directory blocks the rename on Windows only — verified by
 * hand — so a real-state test would leave the rollback uncovered on the POSIX lanes. What is under
 * test is the response to the failure, and this is where the real one arrives from.
 */
const swap = vi.hoisted(() => ({ failTo: '' }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    renameSync(from: Parameters<typeof actual.renameSync>[0], to: Parameters<typeof actual.renameSync>[1]): void {
      if (swap.failTo !== '' && String(to) === swap.failTo) {
        swap.failTo = ''
        throw Object.assign(new Error('simulated EPERM on the swap'), { code: 'EPERM' })
      }
      actual.renameSync(from, to)
    },
  }
})

const roots: string[] = []

/** A fresh directory under the OS temporary directory. */
function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-staged-'))
  roots.push(root)
  return root
}

afterEach(() => {
  // The injected failure is one-shot and cleared by the rename that consumed it; clearing it here too
  // keeps a case that threw before its swap from arming the next one.
  swap.failTo = ''
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

  it('puts the directory that was there back when the swap itself fails', () => {
    // THE SWAP IS THE ONE STEP THAT CANNOT BE UNDONE BY DELETING SOMETHING. The previous directory has
    // already been moved aside, so a rename that fails here would otherwise leave NO directory at all
    // — and the rollback's job is that the failure mode is "the directory is the one from before".
    const root = workspace()
    const target = join(root, 'out')
    const published = writeStagedDirectory(plan([{ path: 'manuscript.md', content: '# kept\n' }]), target)

    swap.failTo = target
    expect(() => writeStagedDirectory(plan([{ path: 'manuscript.md', content: '# replaced\n' }]), target))
      .toThrow(/simulated EPERM on the swap/u)
    swap.failTo = ''

    // THE DIRECTORY ON DISK IS STILL THE ONE THAT WAS PUBLISHED, entry by entry.
    expect(readFileSync(join(target, 'manuscript.md'), 'utf8')).toBe('# kept\n')
    expect(checkWrittenFiles(target, published.files).filter(check => check.status !== 'ok')).toEqual([])
    expect(readdirSync(root).filter(name => name.includes('staging-') || name.includes('superseded-'))).toEqual([])
  })

  it('has nothing to put back when the swap fails and the directory was never there', () => {
    // THE OTHER SIDE OF THE SAME ROLLBACK: there is no previous directory, so nothing is restored and
    // the target stays absent rather than being created by the failure.
    const root = workspace()
    const target = join(root, 'out')

    swap.failTo = target
    expect(() => writeStagedDirectory(plan([{ path: 'manuscript.md', content: '# first\n' }]), target))
      .toThrow(/simulated EPERM on the swap/u)
    swap.failTo = ''

    expect(existsSync(target)).toBe(false)
    expect(readdirSync(root).filter(name => name.includes('staging-') || name.includes('superseded-'))).toEqual([])
  })

  it('refuses the directory it staged when the manifest it wrote does not describe what landed', () => {
    // THE MANIFEST IS WRITTEN LAST, so an entry naming the manifest itself is the one plan that
    // overwrites the bytes its own digest was taken over — which is exactly the check's subject: a
    // staged directory whose entries no longer match the manifest beside them is not published.
    const root = workspace()
    const target = join(root, 'out')
    expect(() => writeStagedDirectory(plan([{ path: 'manifest.json', content: '{}\n' }]), target))
      .toThrow(/does not match its own manifest: manifest\.json \(/u)
    expect(existsSync(target)).toBe(false)
    expect(readdirSync(root).filter(name => name.includes('staging-'))).toEqual([])
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
