/**
 * Runtime build identity for the research packages: which build a running app is actually serving.
 *
 * WHY CONTENT HASHES AND NOT TIMESTAMPS. The browser verification drives the profile's *installed*
 * copy of the research packages, and refreshing that copy is a separate manual step. Skipping it
 * leaves the verification passing 20/20 against the PREVIOUS commit's build, which was observed: a
 * report claimed a run covered a commit whose code the installed copy did not contain. An mtime
 * cannot catch that — copying, checking out, or unzipping all move a file's timestamp without
 * changing its bytes, and a build that writes identical bytes is still the same build. The identity
 * used here is the SET OF RELATIVE PATHS and each file's SHA-256.
 *
 * FOUR IDENTITIES, one comparison. `--print` reports the WORKTREE identity (what the source tree
 * built) plus the git commit it was built from. `--check` compares it against the INSTALLED identity
 * of a profile, which is the copy the app loads. A caller that records "verified against build X"
 * takes X from `--print`, so the claim is mechanically traceable instead of remembered.
 *
 * Usage:
 *   tsx scripts/research-runtime-identity.ts --print [--json]
 *   tsx scripts/research-runtime-identity.ts --check --profile <profileDir> [--json]
 *
 * `--check` exits non-zero on any difference and names it (missing / extra / changed), because a
 * stale install is not a warning: it invalidates every runtime claim made on top of it.
 *
 * @module scripts/research-runtime-identity
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

/** One package's build output: every file's digest, and one digest over the whole set. */
export interface PackageIdentity {
  /** Repository-relative paths mapped to their SHA-256, sorted by path. */
  readonly files: Readonly<Record<string, string>>
  /** SHA-256 over the sorted `path:digest` lines, so one string identifies the whole build. */
  readonly treeHash: string
}

/** The research packages the profile installs, as `<workspace path>` → `<installed package name>`. */
export const RESEARCH_PACKAGES: ReadonlyArray<readonly [string, string]> = [
  ['packages/bundle/research-app', 'dsh-research-app'],
  ['packages/research/dsh-research-core', 'dsh-research-core'],
  ['packages/research/dsh-research-tools', 'dsh-research-tools'],
  ['packages/research/dsh-research-cordis', 'dsh-research-cordis'],
  ['packages/research/dsh-research-team', 'dsh-research-team'],
  ['packages/research/dsh-research-web', 'dsh-research-web'],
]

/** One difference between the expected build and the installed copy. */
export interface IdentityDifference {
  readonly package: string
  readonly kind: 'missing' | 'extra' | 'changed'
  readonly path: string
}

/**
 * Collect every file under `dir` with its SHA-256.
 *
 * Symlinks are skipped: the packages' `lib/` holds build output, and following a link would report
 * the target's bytes under the link's path, which is not what the app loads.
 *
 * @param dir - absolute directory to walk.
 * @param root - absolute path the reported paths are relative to (defaults to `dir`).
 * @returns the file digests and the digest over their sorted `path:digest` lines.
 */
export function identityOf(dir: string, root: string = dir): PackageIdentity {
  const files: Record<string, string> = {}
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort(
      (a, b) => (a.name < b.name ? -1 : 1),
    )) {
      const full = join(current, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        walk(full)
        continue
      }
      // Anything that is not a regular file (a socket, a device) is not part of the build output and
      // has no bytes to identify. An empty file does, and is hashed like any other.
      if (!entry.isFile()) continue
      const rel = relative(root, full).split(sep).join('/')
      files[rel] = createHash('sha256')
        .update(readFileSync(full))
        .digest('hex')
    }
  }
  walk(dir)
  const lines = Object.keys(files)
    .sort()
    .map(path => `${path}:${files[path]}`)
  return {
    files,
    treeHash: createHash('sha256').update(lines.join('\n')).digest('hex'),
  }
}

/**
 * Compare the expected build of one package against the copy a profile installed.
 *
 * @param expected - identity of the worktree's build output.
 * @param installed - identity of the installed copy.
 * @param name - the package name, used in the reported differences.
 * @returns every difference, empty when the two are the same build.
 */
export function compareIdentities(
  expected: PackageIdentity,
  installed: PackageIdentity,
  name: string,
): ReadonlyArray<IdentityDifference> {
  const differences: IdentityDifference[] = []
  for (const path of Object.keys(expected.files).sort()) {
    const actual = installed.files[path]
    if (actual === undefined)
      differences.push({ package: name, kind: 'missing', path })
    else if (actual !== expected.files[path])
      differences.push({ package: name, kind: 'changed', path })
  }
  for (const path of Object.keys(installed.files).sort()) {
    if (expected.files[path] === undefined)
      differences.push({ package: name, kind: 'extra', path })
  }
  return differences
}

/** Where the profile keeps the installed packages, given its root. */
function installedDir(profileDir: string, packageName: string): string {
  return join(profileDir, 'node_modules', '@deepseek-ai', packageName, 'lib')
}

/** The commit the worktree is on, or a marker when git cannot answer. */
function headCommit(root: string): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
  } catch {
    return 'unknown'
  }
}

function main(): void {
  const args = process.argv.slice(2)
  const json = args.includes('--json')
  const root = resolve(import.meta.dirname, '..')
  const profileIndex = args.indexOf('--profile')
  const profileDir =
    profileIndex === -1 ? undefined : resolve(args[profileIndex + 1] ?? '')

  const built = RESEARCH_PACKAGES.map(([workspace, name]) => ({
    workspace,
    name,
    identity: identityOf(join(root, workspace, 'lib')),
  }))

  if (args.includes('--print')) {
    const report = {
      commit: headCommit(root),
      packages: Object.fromEntries(
        built.map(b => [
          b.name,
          {
            treeHash: b.identity.treeHash,
            files: Object.keys(b.identity.files).length,
          },
        ]),
      ),
    }
    if (json) console.log(JSON.stringify(report, null, 2))
    else {
      console.log(`research build identity  commit ${report.commit}`)
      for (const [name, value] of Object.entries(report.packages)) {
        console.log(
          `  ${name.padEnd(22)} ${value.treeHash.slice(0, 16)}…  ${String(value.files)} file(s)`,
        )
      }
    }
    return
  }

  if (!args.includes('--check') || profileDir === undefined) {
    console.error(
      'usage: --print [--json] | --check --profile <profileDir> [--json]',
    )
    process.exit(2)
  }

  const differences: IdentityDifference[] = []
  for (const entry of built) {
    differences.push(
      ...compareIdentities(
        entry.identity,
        identityOf(installedDir(profileDir, entry.name)),
        entry.name,
      ),
    )
  }

  const report = {
    profile: profileDir,
    commit: headCommit(root),
    packages: Object.fromEntries(
      built.map(b => [b.name, { treeHash: b.identity.treeHash, files: Object.keys(b.identity.files).length }]),
    ),
    differences,
  }
  if (json) {
    // Pure JSON on stdout: a caller parses this, so nothing else may share the stream.
    console.log(JSON.stringify(report, null, 2))
    process.exit(differences.length === 0 ? 0 : 1)
  }
  if (differences.length === 0) {
    console.log(
      `research-runtime-identity: the installed copy IS this build (${String(built.length)} packages, commit ${headCommit(root)})`,
    )
    return
  }
  console.error(
    'research-runtime-identity: the installed copy is NOT this build — a runtime claim made now would describe the wrong code.',
  )
  for (const difference of differences.slice(0, 40)) {
    console.error(
      `  ${difference.kind.padEnd(8)} ${difference.package}  ${difference.path}`,
    )
  }
  if (differences.length > 40)
    console.error(`  … ${String(differences.length - 40)} more`)
  console.error(
    '  run: node .workbuddy/tmp/refresh-profile-install.mjs   (after rebuilding lib/)',
  )
  process.exit(1)
}

if (import.meta.main) main()
