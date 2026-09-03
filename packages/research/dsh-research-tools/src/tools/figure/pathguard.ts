// @deepseek-ai/dsh-research-tools — T16 figure, pure output-path guard.
//
// The figure tool itself NEVER touches the filesystem (artifacts are
// in-memory). Any downstream stage that DOES persist a figure artifact must
// (a) route the write through an injected adapter and (b) validate the target
// path with {@link resolveFigureOutputPath} — a pure, allowlist + traversal
// guard. Rule 6: reject absolute escapes, '..', and anything outside the
// allowlisted working-directory root.
//
// Semantics (all path math is textual; nothing here performs I/O):
//  - the raw path must be a non-empty string (after trim), printable-ASCII,
//    and free of NUL / control characters;
//  - both '/' and '\\' are treated as separators (Windows-style raw paths are
//    normalized before inspection) — so '..\\evil' and '../evil' are caught by
//    the same rule;
//  - the raw path must be RELATIVE: leading '/' and Windows drive prefixes
//    ('C:') / UNC are rejected up front;
//  - every segment between separators must be neither '..' nor '.' and must not
//    reintroduce an absolute prefix;
//  - the raw path is joined onto an allowlisted root and a final containment
//    re-check asserts the resolved string stays inside that root.
//
// Failures map onto distinct FigureError codes:
//   DSH_FIGURE_PATH_INVALID            -> not a usable relative path string;
//   DSH_FIGURE_PATH_TRAVERSAL          -> '..', '.' or absolute-escape attempt;
//   DSH_FIGURE_PATH_OUTSIDE_ALLOWLIST  -> allowed shape but no allowlisted root
//                                         contains the resolved target.

export interface PathGuardOptions {
  /** Working-directory roots the target may live under. Non-empty. */
  readonly allowlistRoots: ReadonlyArray<string>
}

/** Characters we refuse anywhere in a raw path (NUL + control + unsafe). */
const FORBIDDEN_PATH_CHARS = /[\u0000-\u001f\u007f]/u

function normalizeSeparators(raw: string): string {
  return raw.replaceAll('\\', '/')
}

/** Reject windows drive/UNC/absolute-escape prefixes inside a RELATIVE path. */
function looksAbsolute(segment: string): boolean {
  return segment.length === 0 || segment === '.' || segment === '..' || /^[A-Za-z]:/.test(segment)
}

function hasForbiddenSegment(segments: ReadonlyArray<string>): boolean {
  for (const segment of segments) {
    if (segment === '..' || segment === '.') {
      return true
    }
  }
  return false
}

/**
 * Validate `rawPath` as a relative output/asset target and resolve it under one
 * of the allowlisted roots.
 * @throws {Error} with a `.code` of DSH_FIGURE_PATH_INVALID / _TRAVERSAL /
 *   _OUTSIDE_ALLOWLIST on every rejection (the thrown error is the exported
 *   FigureError class from ./index.ts, kept decoupled here via a `code`
 *   property + message so this module stays dependency-free of the error
 *   class — callers use `instanceof` on the wrapped error).
 *
 * Both arguments are declared `unknown` because this guard runs at a trust
 * boundary: it re-validates the runtime shape of everything it receives even
 * when a statically-typed caller passes a string / {@link PathGuardOptions}.
 */
export function resolveFigureOutputPath(
  rawPath: unknown,
  options: unknown,
): { readonly ok: true; readonly resolved: string; readonly root: string } {
  if (typeof rawPath !== 'string') {
    throw new FigurePathError(
      'DSH_FIGURE_PATH_INVALID',
      'resolveFigureOutputPath: rawPath must be a string',
    )
  }
  const trimmed = rawPath.trim()
  if (trimmed.length === 0) {
    throw new FigurePathError(
      'DSH_FIGURE_PATH_INVALID',
      'resolveFigureOutputPath: rawPath must be a non-empty string',
    )
  }
  if (FORBIDDEN_PATH_CHARS.test(trimmed)) {
    throw new FigurePathError(
      'DSH_FIGURE_PATH_INVALID',
      'resolveFigureOutputPath: rawPath contains control/NUL characters',
    )
  }
  if (options === null || typeof options !== 'object') {
    throw new FigurePathError(
      'DSH_FIGURE_PATH_INVALID',
      'resolveFigureOutputPath: options must be an object with a non-empty allowlistRoots array',
    )
  }
  const allowlistRoots = (options as { readonly allowlistRoots?: unknown }).allowlistRoots
  if (
    !Array.isArray(allowlistRoots) ||
    allowlistRoots.length === 0 ||
    allowlistRoots.some(root => typeof root !== 'string')
  ) {
    throw new FigurePathError(
      'DSH_FIGURE_PATH_INVALID',
      'resolveFigureOutputPath: allowlistRoots must be a non-empty array of strings',
    )
  }
  const roots = allowlistRoots as ReadonlyArray<string>

  // Normalize separators and collapse repeated ones ('a//b.png' -> 'a/b.png').
  // Leading '/' (including a collapsed UNC prefix) and drive prefixes remain
  // absolute escapes and are rejected below.
  const normalized = normalizeSeparators(trimmed).replace(/\/{2,}/gu, '/')
  if (normalized.startsWith('/')) {
    throw new FigurePathError(
      'DSH_FIGURE_PATH_TRAVERSAL',
      `resolveFigureOutputPath: absolute path escapes the allowlist ("${trimmed}")`,
    )
  }
  if (/^[A-Za-z]:/.test(normalized)) {
    throw new FigurePathError(
      'DSH_FIGURE_PATH_TRAVERSAL',
      `resolveFigureOutputPath: drive-prefixed path escapes the allowlist ("${trimmed}")`,
    )
  }
  const segments = normalized.split('/').filter(segment => segment.length > 0)
  if (hasForbiddenSegment(segments)) {
    throw new FigurePathError(
      'DSH_FIGURE_PATH_TRAVERSAL',
      `resolveFigureOutputPath: '..'/'.' segments are not allowed ("${trimmed}")`,
    )
  }
  // Any remaining segment that still parses as absolute (e.g. a re-introduced
  // 'C:name' mid-path) is an escape attempt too.
  if (segments.some(segment => looksAbsolute(segment))) {
    throw new FigurePathError(
      'DSH_FIGURE_PATH_TRAVERSAL',
      `resolveFigureOutputPath: path re-introduces an absolute prefix ("${trimmed}")`,
    )
  }

  // Path shape is clean and relative. Try each allowlisted root (first match
  // wins — deterministic order); blank entries are skipped and count as "no
  // usable root", which yields DSH_FIGURE_PATH_OUTSIDE_ALLOWLIST.
  const relative = segments.join('/')
  for (const rootRaw of roots) {
    const root = rootRaw.trim().replace(/[\\/]+$/u, '')
    if (root.length === 0) {
      continue
    }
    const resolved = `${root}/${relative}`
    // defensive: relative is never empty — leading separators are rejected and
    // '.'/'..' segments are filtered out — so resolved always starts with
    // `${root}/` and this containment re-check can never be false.
    /* v8 ignore start -- containment re-check always holds */
    if (resolved === root || resolved.startsWith(`${root}/`)) {
      return { ok: true as const, resolved, root }
    }
    /* v8 ignore stop */
  }
  throw new FigurePathError(
    'DSH_FIGURE_PATH_OUTSIDE_ALLOWLIST',
    `resolveFigureOutputPath: "${trimmed}" does not resolve under any allowlisted root`,
  )
}

export type FigurePathErrorCode =
  | 'DSH_FIGURE_PATH_INVALID'
  | 'DSH_FIGURE_PATH_TRAVERSAL'
  | 'DSH_FIGURE_PATH_OUTSIDE_ALLOWLIST'

/** Minimal self-contained path error. The tool wraps/aliases this to the
 *  public FigureError class (same `code` values) in ./index.ts. */
export class FigurePathError extends Error {
  readonly code: FigurePathErrorCode

  constructor(code: FigurePathErrorCode, message: string) {
    super(`[${code}] ${message}`)
    this.name = 'FigurePathError'
    this.code = code
  }
}
