// @deepseek-ai/dsh-research-tools — T17 three-line table (三线表) tool.
//
// SCOPE (deliberately narrow): establish ONE structured table model
// ({@link ThreeLineTableModel}) and render it as a three-line (booktabs-style)
// table in exactly two pure string formats — GitHub-style plain-text Markdown
// with exactly three horizontal rules and LaTeX/BOOKTABS — WITHOUT vertical
// rules in either output.
//
// The tool is a pure constructor/renderer in the same spirit as T14
// claim-construct: no adapter, no IO, no network, no clock (the epoch-ms
// timestamp is caller-injected and REQUIRED as the last argument — there is
// NO Date.now() fallback), and no state-machine advancement. The returned
// artifact is deeply frozen via {@link freezeArtifact}.
//
// FAITHFULNESS: this tool NEVER changes, fills in, or infers data. It does not
// round values it would alter (a numeric scalar whose authored precision
// exceeds the column's declared decimals is REJECTED, never silently rounded),
// and it never derives significance markers from p-values — stars are authored
// on cells and only CROSS-CHECKED for agreement with the cell's own p-value
// under a declared significance policy (conventional 0.05/0.01/0.001 by
// default). Renders exactly the model; the artifact binds the rendered text
// to a NORMALIZED MODEL SNAPSHOT via a deterministic canonical hash.
//
// ANTI-PATTERN DETECTION (traffic-paper counter-examples; each is a validator
// check with its own error code, see {@link ThreeLineTableErrorCode}):
//   (a) inconsistent units across cells of one column   -> UNIT_MISMATCH
//   (b) lower-is-better metric highlighted as if the max were best
//       (emphasis metadata contradicting metricDirection) -> DIRECTION_CONTRADICTION
//   (c) significance stars contradicting the cell p-value -> STAR_PVALUE_MISMATCH
//   (d) percentages and raw fractions mixed in one column -> PERCENT_DECIMAL_MIX
//   (e) chaotic decimal places inside one column          -> DECIMAL_CHAOS
//   (f) a table value contradicting the bound data snapshot
//                                                         -> SNAPSHOT_CONTRADICTION

import { freezeArtifact } from '../../shared.ts'
import type { ToolArtifactMeta } from '../../shared.ts'

/** Stable tool id carried on every produced artifact's meta. */
export const THREE_LINE_TABLE_TOOL_ID = 'three-line-table'

/** Version of this tool's artifact schema / implementation. Kept in lockstep
 *  with the package version (0.1.2-alpha.4 at the time of writing). */
export const THREE_LINE_TABLE_TOOL_VERSION = '0.1.2-alpha.4'

/** Globally unique, grep-able error-code prefix for this tool. */
export const THREE_LINE_TABLE_ERROR_PREFIX = 'DSH_THREE_LINE_TABLE_'

/** Unified missing-value representation (rendered for every missing cell).
 *  Model-wide: one table may configure a single token; it is never silently
 *  omitted and never varies cell-to-cell. */
export const THREE_LINE_TABLE_DEFAULT_MISSING_TOKEN = '–'

/** Conventional significance cut-offs for star markers (1..3 stars). A cell
 *  may override the thresholds through {@link ThreeLineTableSignificance}. */
export const THREE_LINE_TABLE_DEFAULT_SIGNIFICANCE: Readonly<ThreeLineTableSignificance> =
  Object.freeze({
    pLessThan: Object.freeze([0.05, 0.01, 0.001]),
  })

// ────────────────────────── Public type surface ─────────────────────────────

export type ThreeLineTableTarget = 'markdown' | 'latex'

/** How a numeric column's values compare ("which end is better"). Purely
 *  caller-declared semantics — never inferred from the numbers. */
export type ThreeLineTableMetricDirection = 'higher-is-better' | 'lower-is-better'

/** How a column's decimals are displayed once the authored precision is known
 *  to be consistent with the column rule. */
export type ThreeLineTablePrecisionRule = 'fixed' | 'significant'

/** Numeric scale of a ratio-style column / cell. Detects mixing percentages
 *  with raw fractions inside one column. */
export type ThreeLineTableCellScale = 'percent' | 'fraction'

/** Emphasis markers rendered bold; only 'best' is understood. */
export type ThreeLineTableCellEmphasis = 'best'

export interface ThreeLineTableSignificance {
  /** p-value thresholds for 1..N significance stars (ascending order is
   *  conventional but the count check is order-independent). */
  readonly pLessThan: ReadonlyArray<number>
}

/** Optional decorations shared by every cell kind (unit / scale / emphasis /
 *  column span for merged cells). All are authored metadata — the tool only
 *  validates and re-renders them. */
export interface ThreeLineTableCellCommon {
  /** Number of leaf columns this cell occupies when merged (>= 1). */
  readonly colSpan?: number
  /** Per-cell unit override. Must agree with the owning column unit. */
  readonly unit?: string
  /** Per-cell numeric scale override. Must not mix with the column scale. */
  readonly scale?: ThreeLineTableCellScale
  /** Emphasis marker (rendered bold). Validated against metricDirection. */
  readonly emphasis?: ThreeLineTableCellEmphasis
}

export interface ThreeLineMissingCell extends ThreeLineTableCellCommon {
  readonly kind: 'missing'
}

export interface ThreeLineTextCell extends ThreeLineTableCellCommon {
  readonly kind: 'text'
  readonly text: string
}

export interface ThreeLineFormattedCell extends ThreeLineTableCellCommon {
  readonly kind: 'formatted'
  /** Already-formatted string rendered verbatim (never re-formatted). */
  readonly text: string
}

export interface ThreeLineNumberCell extends ThreeLineTableCellCommon {
  readonly kind: 'number'
  readonly value: number
}

export interface ThreeLineMeanSdCell extends ThreeLineTableCellCommon {
  readonly kind: 'meanSd'
  /** Rendered as "mean ± sd". */
  readonly mean: number
  readonly sd: number
}

export interface ThreeLineMeanSdParenCell extends ThreeLineTableCellCommon {
  readonly kind: 'meanSdParen'
  /** Rendered as "mean (sd)". */
  readonly mean: number
  readonly sd: number
}

export interface ThreeLineConfidenceIntervalCell extends ThreeLineTableCellCommon {
  readonly kind: 'ci'
  /** Rendered as "lo–hi", or "point (lo–hi)" when a point estimate is given. */
  readonly lo: number
  readonly hi: number
  readonly point?: number
}

export interface ThreeLinePValueCell extends ThreeLineTableCellCommon {
  readonly kind: 'pValue'
  readonly value: number
  /** Authored significance stars (0..thresholds). Cross-checked against the
   *  p-value under {@link ThreeLineTableSignificance}. */
  readonly stars?: number
}

export type ThreeLineTableCell =
  | ThreeLineMissingCell
  | ThreeLineTextCell
  | ThreeLineFormattedCell
  | ThreeLineNumberCell
  | ThreeLineMeanSdCell
  | ThreeLineMeanSdParenCell
  | ThreeLineConfidenceIntervalCell
  | ThreeLinePValueCell

/** One leaf column of the table. Leaf headers form the bottom header row. */
export interface ThreeLineTableColumn {
  /** Column header text (bottom header row). Must be non-empty. */
  readonly header: string
  /** Per-column unit, rendered next to the header, e.g. "Accuracy (%)". */
  readonly unit?: string
  /** Uniform fractional-digit rule for this column's numeric scalars. */
  readonly decimals?: number
  /** 'fixed' pads to `decimals`; 'significant' trims authored trailing zeros. */
  readonly precisionRule?: ThreeLineTablePrecisionRule
  /** Column-level numeric scale ('percent' | 'fraction'). */
  readonly scale?: ThreeLineTableCellScale
  /** True semantics of the column's values (which end is better). */
  readonly metricDirection?: ThreeLineTableMetricDirection
}

/** One cell of an optional GROUPED header row above the leaf header row. A
 *  group row is a partition of the leaf columns (its spans must add up to the
 *  number of columns — no gaps, no overlaps). */
export interface ThreeLineTableGroupedHeaderCell {
  readonly label: string
  readonly span: number
}

/** A row of grouped headers. Multiple group rows give a multi-level header. */
export type ThreeLineTableGroupedHeaderRow = ReadonlyArray<ThreeLineTableGroupedHeaderCell>

export type ThreeLineTableSnapshotPart = 'value' | 'mean' | 'sd' | 'lo' | 'hi' | 'point'

/** One bound data-snapshot record. Addresses a cell by row index / leaf column
 *  index and asserts the model's scalar equals the snapshot's recorded value. */
export interface ThreeLineTableSnapshotValue {
  readonly rowIndex: number
  readonly columnIndex: number
  readonly part: ThreeLineTableSnapshotPart
  readonly recorded: number
}

export interface ThreeLineTableDataSnapshot {
  /** Free-text provenance of the bound snapshot (audit only). */
  readonly source?: string
  readonly values: ReadonlyArray<ThreeLineTableSnapshotValue>
}

/** The one structured table model established by T17. Cells are structured
 *  (never raw strings) and missing values use ONE unified token. */
export interface ThreeLineTableModel {
  /** Optional caption/title (printed above the table). */
  readonly title?: string
  /** Unified missing-value token. Defaults to {@link
   *  THREE_LINE_TABLE_DEFAULT_MISSING_TOKEN}. */
  readonly missingToken?: string
  /** Leaf columns (>= 1). Their headers are the bottom header row. */
  readonly columns: ReadonlyArray<ThreeLineTableColumn>
  /** Optional GROUPED header rows (top-most first) for multi-level headers. */
  readonly groupedHeaders?: ReadonlyArray<ThreeLineTableGroupedHeaderRow>
  /** Body rows. Each row's cells (incl. merged colSpan cells) must exactly
   *  cover the leaf columns. */
  readonly rows: ReadonlyArray<ReadonlyArray<ThreeLineTableCell>>
  /** Table footnotes (rendered verbatim under the bottom rule). */
  readonly footnotes?: ReadonlyArray<string>
  /** Significance thresholds used to cross-check authored stars. Defaults to
   *  {@link THREE_LINE_TABLE_DEFAULT_SIGNIFICANCE}. */
  readonly significance?: ThreeLineTableSignificance
  /** Optional bound data snapshot cross-checked against every cell value. */
  readonly dataSnapshot?: ThreeLineTableDataSnapshot
}

export interface ThreeLineTableRender {
  readonly target: ThreeLineTableTarget
  /** Byte-deterministic rendered text (same model + target always identical). */
  readonly text: string
}

export interface ThreeLineTableArtifact {
  readonly meta: ToolArtifactMeta
  /** NORMALIZED MODEL SNAPSHOT (deeply frozen) — the exact model the rendered
   *  text was produced from, with effective defaults materialized. */
  readonly table: ThreeLineTableModel
  /** Deterministic canonical hash over the normalized snapshot + target, so a
   *  rendered text can be audited against the snapshot it came from. */
  readonly bindingHash: string
  readonly render: ThreeLineTableRender
}

/** Error-code suffixes; combined with {@link THREE_LINE_TABLE_ERROR_PREFIX}. */
export type ThreeLineTableErrorCodeSuffix =
  | 'INVALID_MODEL'
  | 'INVALID_TARGET'
  | 'INVALID_TIMESTAMP'
  | 'EMPTY_COLUMNS'
  | 'EMPTY_HEADER'
  | 'EMPTY_ROWS'
  | 'INVALID_CELL'
  | 'INVALID_NUMBER'
  | 'INVALID_DECIMALS'
  | 'HEADER_COLUMN_MISMATCH'
  | 'BODY_COLUMN_MISMATCH'
  | 'ILLEGAL_MERGE'
  | 'UNIT_MISMATCH'
  | 'DIRECTION_CONTRADICTION'
  | 'STAR_PVALUE_MISMATCH'
  | 'PERCENT_DECIMAL_MIX'
  | 'DECIMAL_CHAOS'
  | 'INVALID_SNAPSHOT'
  | 'SNAPSHOT_CONTRADICTION'

/** Globally unique error codes thrown by {@link renderThreeLineTable}. */
export type ThreeLineTableErrorCode =
  `${typeof THREE_LINE_TABLE_ERROR_PREFIX}${ThreeLineTableErrorCodeSuffix}`

/** Error thrown on invalid model / target / timestamp / model semantics. */
export class ThreeLineTableError extends Error {
  readonly code: ThreeLineTableErrorCode

  constructor(code: ThreeLineTableErrorCode, message: string) {
    super(`[${code}] ${message}`)
    this.name = 'ThreeLineTableError'
    this.code = code
  }
}

// ────────────────────────────── Small helpers ───────────────────────────────

function throwTableError(code: ThreeLineTableErrorCodeSuffix, detail: string): never {
  throw new ThreeLineTableError(
    `${THREE_LINE_TABLE_ERROR_PREFIX}${code}`,
    `renderThreeLineTable: ${detail}`,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Number of digits after the decimal point needed to represent `value`.
 *  Handles exponent notation (e.g. 1.5e-7 => 8) and integral values (=> 0). */
function decimalPlacesOf(value: number): number {
  const text = String(value)
  const lower = text.toLowerCase()
  const eIndex = lower.indexOf('e')
  const mantissa = eIndex === -1 ? text : text.slice(0, eIndex)
  const exponent = eIndex === -1 ? 0 : Number.parseInt(text.slice(eIndex + 1), 10)
  const dot = mantissa.indexOf('.')
  let decimals = dot === -1 ? 0 : mantissa.length - dot - 1
  decimals -= exponent
  return decimals > 0 ? decimals : 0
}

/** Format one scalar under a column's declared precision rule. Callers must
 *  have validated authored precision first (see DECIMAL_CHAOS), so this never
 *  rounds away a meaningful digit. */
function formatScalar(value: number, column: ThreeLineTableColumn): string {
  const decimals = column.decimals
  if (decimals === undefined) return String(value)
  const fixed = value.toFixed(decimals)
  if (column.precisionRule !== 'significant') return fixed
  if (!fixed.includes('.')) return fixed
  let trimmed = fixed.replace(/0+$/u, '')
  if (trimmed.endsWith('.')) trimmed = trimmed.slice(0, -1)
  return trimmed
}

/** Leaf-header display text: the header plus its unit in parentheses. */
function headerDisplay(column: ThreeLineTableColumn): string {
  return column.unit === undefined ? column.header : `${column.header} (${column.unit})`
}

/** All numeric scalars carried by a cell (empty for text/missing/formatted). */
function cellScalars(cell: ThreeLineTableCell): ReadonlyArray<number> {
  switch (cell.kind) {
    case 'number':
      return [cell.value]
    case 'meanSd':
    case 'meanSdParen':
      return [cell.mean, cell.sd]
    case 'ci':
      return cell.point === undefined ? [cell.lo, cell.hi] : [cell.point, cell.lo, cell.hi]
    case 'pValue':
      return [cell.value]
    case 'missing':
    case 'text':
    case 'formatted':
      return []
  }
}

/** Primary comparable scalar of a numeric cell (mean for mean±sd; the point
 *  estimate (or lo) for a confidence interval; the value otherwise). */
function cellPrimaryScalar(cell: ThreeLineTableCell): number | undefined {
  switch (cell.kind) {
    case 'number':
    case 'pValue':
      return cell.value
    case 'meanSd':
    case 'meanSdParen':
      return cell.mean
    case 'ci':
      return cell.point === undefined ? cell.lo : cell.point
    case 'missing':
    case 'text':
    case 'formatted':
      return undefined
  }
}

/** How many significance stars a p-value may legitimately carry under a
 *  policy (number of thresholds the p-value clears). */
function significanceStarLimit(
  pValue: number,
  significance: Readonly<ThreeLineTableSignificance>,
): number {
  let limit = 0
  for (const threshold of significance.pLessThan) {
    if (pValue < threshold) limit += 1
  }
  return limit
}

function requireFiniteNumber(value: unknown, label: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throwTableError('INVALID_NUMBER', `${label} must be a finite number (got ${String(value)})`)
  }
}

/** Canonical JSON (keys sorted recursively) so that equal models hash equal
 *  regardless of object key insertion order. */
function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(part => canonicalStringify(part)).join(',')}]`
  }
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const parts: string[] = []
    for (const key of Object.keys(record).sort()) {
      parts.push(`${JSON.stringify(key)}:${canonicalStringify(record[key])}`)
    }
    return `{${parts.join(',')}}`
  }
  return JSON.stringify(value)
}

/** Deterministic dependency-free FNV-1a (32-bit) hex digest. */
function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function escapeLatex(text: string): string {
  let out = ''
  for (const char of text) {
    switch (char) {
      case '\\': out += '\\textbackslash{}'; break
      case '{': out += '\\{'; break
      case '}': out += '\\}'; break
      case '#': out += '\\#'; break
      case '%': out += '\\%'; break
      case '&': out += '\\&'; break
      case '$': out += '\\$'; break
      case '_': out += '\\_'; break
      case '^': out += '\\textasciicircum{}'; break
      case '~': out += '\\textasciitilde{}'; break
      case '±': out += '$\\pm$'; break
      case '–': out += '--'; break
      default: out += char; break
    }
  }
  return out
}

// ──────────────────────── Cell display text (both targets) ──────────────────

/** Build the plain logical text of a cell (before emphasis/bold decoration and
 *  target-specific escaping). Numeric cells follow the owning column's
 *  decimals / precisionRule; formatted and text cells are verbatim. */
export function threeLineTableCellText(
  cell: ThreeLineTableCell,
  column: ThreeLineTableColumn,
  missingToken: string,
): string {
  const fmt = (value: number): string => formatScalar(value, column)
  switch (cell.kind) {
    case 'missing':
      return missingToken
    case 'text':
    case 'formatted':
      return cell.text
    case 'number':
      return fmt(cell.value)
    case 'meanSd':
      return `${fmt(cell.mean)} ± ${fmt(cell.sd)}`
    case 'meanSdParen':
      return `${fmt(cell.mean)} (${fmt(cell.sd)})`
    case 'ci': {
      const interval = `${fmt(cell.lo)}–${fmt(cell.hi)}`
      return cell.point === undefined ? interval : `${fmt(cell.point)} (${interval})`
    }
    case 'pValue':
      return cell.stars === undefined || cell.stars === 0
        ? fmt(cell.value)
        : `${fmt(cell.value)}${'*'.repeat(cell.stars)}`
  }
}

// ───────────────────────────── Model validation ─────────────────────────────

/** Basic structural validation: shape of the model, columns, grouped headers,
 *  rows container, missing token and significance policy. */
function validateModelStructure(model: ThreeLineTableModel): void {
  // Field reads go through a raw record view so that a caller who supplied an
  // out-of-shape model (cast to the interface) is still rejected at runtime —
  // the declared types can never be trusted at this boundary.
  const rawModel = model as unknown as Record<string, unknown>
  if (!isRecord(rawModel)) {
    throwTableError('INVALID_MODEL', 'model must be a non-null plain object')
  }
  const rawColumns = rawModel.columns
  if (!Array.isArray(rawColumns) || rawColumns.length === 0) {
    throwTableError('EMPTY_COLUMNS', 'model.columns must be a non-empty array')
  }
  // Re-assert a typed element list: Array.isArray narrows to any[], and the
  // unknown[] view keeps the per-column runtime checks meaningful below.
  const columns = rawColumns as ReadonlyArray<unknown>
  const groupedHeaders = rawModel.groupedHeaders
  if (groupedHeaders !== undefined && !Array.isArray(groupedHeaders)) {
    throwTableError('INVALID_MODEL', 'model.groupedHeaders must be an array of header rows')
  }
  const rows = rawModel.rows
  if (!Array.isArray(rows)) {
    throwTableError('INVALID_MODEL', 'model.rows must be an array of rows')
  }
  if (rows.length === 0) {
    throwTableError('EMPTY_ROWS', 'model.rows must contain at least one row')
  }
  const missingToken = rawModel.missingToken
  if (missingToken !== undefined) {
    if (
      typeof missingToken !== 'string' ||
      missingToken.trim().length === 0 ||
      /\s/u.test(missingToken)
    ) {
      throwTableError(
        'INVALID_MODEL',
        'model.missingToken must be a non-empty token without whitespace',
      )
    }
  }
  const significance = rawModel.significance
  if (significance !== undefined) {
    if (!isRecord(significance) || !Array.isArray(significance.pLessThan)) {
      throwTableError(
        'INVALID_MODEL',
        'model.significance must be an object with a pLessThan array',
      )
    }
    for (const threshold of significance.pLessThan) {
      if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold <= 0 || threshold > 1) {
        throwTableError(
          'INVALID_MODEL',
          'model.significance.pLessThan thresholds must be finite numbers in (0, 1]',
        )
      }
    }
  }
  for (const rawColumn of columns) {
    if (!isRecord(rawColumn)) {
      throwTableError('INVALID_MODEL', 'every column must be a plain object')
    }
    const header = rawColumn.header
    if (typeof header !== 'string') {
      throwTableError('INVALID_MODEL', 'every column header must be a string')
    }
    if (header.trim().length === 0) {
      throwTableError('EMPTY_HEADER', 'every column header must be non-empty after trimming')
    }
    const decimals = rawColumn.decimals
    if (decimals !== undefined && (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0)) {
      throwTableError('INVALID_DECIMALS', `column "${header}" decimals must be a non-negative integer`)
    }
    const precisionRule = rawColumn.precisionRule
    if (precisionRule !== undefined && precisionRule !== 'fixed' && precisionRule !== 'significant') {
      throwTableError('INVALID_MODEL', `column "${header}" precisionRule must be fixed or significant`)
    }
    const scale = rawColumn.scale
    if (scale !== undefined && scale !== 'percent' && scale !== 'fraction') {
      throwTableError('INVALID_MODEL', `column "${header}" scale must be percent or fraction`)
    }
    const direction = rawColumn.metricDirection
    if (direction !== undefined && direction !== 'higher-is-better' && direction !== 'lower-is-better') {
      throwTableError('INVALID_MODEL', `column "${header}" metricDirection is invalid`)
    }
    const unit = rawColumn.unit
    if (unit !== undefined && typeof unit !== 'string') {
      throwTableError('INVALID_MODEL', `column "${header}" unit must be a string`)
    }
  }
}

/** Validate grouped-header rows (each row must partition the leaf columns:
 *  non-negative spans that add up to the column count). */
function validateGroupedHeaders(model: ThreeLineTableModel): void {
  const columns = model.columns
  if (model.groupedHeaders === undefined) return
  model.groupedHeaders.forEach((row, rowIndex) => {
    const rawRow = row as unknown
    if (!Array.isArray(rawRow)) {
      throwTableError('INVALID_MODEL', `groupedHeaders row ${rowIndex} must be an array`)
    }
    if (rawRow.length === 0) {
      throwTableError('EMPTY_HEADER', `groupedHeaders row ${rowIndex} must not be empty`)
    }
    // Array.isArray narrows to any[]; the unknown[] view keeps the per-group
    // runtime field checks below meaningful for out-of-shape grouped rows.
    const groups = rawRow as ReadonlyArray<unknown>
    let covered = 0
    groups.forEach((rawGroup, groupIndex) => {
      if (!isRecord(rawGroup)) {
        throwTableError('INVALID_MODEL', `groupedHeaders[${rowIndex}][${groupIndex}] must be an object`)
      }
      const label = rawGroup.label
      if (typeof label !== 'string' || label.trim().length === 0) {
        throwTableError('EMPTY_HEADER', `groupedHeaders[${rowIndex}][${groupIndex}] label must be non-empty`)
      }
      const span = rawGroup.span
      if (typeof span !== 'number' || !Number.isInteger(span) || span < 1) {
        throwTableError('ILLEGAL_MERGE', `groupedHeaders[${rowIndex}][${groupIndex}] span must be a positive integer`)
      }
      covered += span
    })
    if (covered !== columns.length) {
      throwTableError(
        'HEADER_COLUMN_MISMATCH',
        `groupedHeaders row ${rowIndex} spans ${covered} columns but the table has ${columns.length}`,
      )
    }
  })
}

/** Validate cell shapes and row/column width consistency (merged-cell
 *  legality is enforced here: spans are positive integers and may not overrun
 *  the column count; every row must cover exactly the leaf columns). */
function validateRows(model: ThreeLineTableModel): void {
  const columnCount = model.columns.length
  model.rows.forEach((row, rowIndex) => {
    const rawRow = row as unknown
    if (!Array.isArray(rawRow)) {
      throwTableError('INVALID_MODEL', `row ${rowIndex} must be an array of cells`)
    }
    if (rawRow.length === 0) {
      throwTableError('EMPTY_ROWS', `row ${rowIndex} must contain at least one cell`)
    }
    // Array.isArray narrows to any[]; the unknown[] view keeps the per-cell
    // runtime field checks below meaningful for out-of-shape rows.
    const cells = rawRow as ReadonlyArray<unknown>
    let cursor = 0
    cells.forEach((rawCell, cellIndex) => {
      if (!isRecord(rawCell)) {
        throwTableError('INVALID_CELL', `row ${rowIndex} cell ${cellIndex} must be an object`)
      }
      const kind = rawCell.kind
      if (kind !== 'missing' && kind !== 'text' && kind !== 'formatted' && kind !== 'number' &&
          kind !== 'meanSd' && kind !== 'meanSdParen' && kind !== 'ci' && kind !== 'pValue') {
        throwTableError('INVALID_CELL', `row ${rowIndex} cell ${cellIndex} has unknown kind ${String(kind)}`)
      }
      const span = rawCell.colSpan === undefined ? 1 : rawCell.colSpan
      if (typeof span !== 'number' || !Number.isInteger(span) || span < 1) {
        throwTableError('ILLEGAL_MERGE', `row ${rowIndex} cell ${cellIndex} colSpan must be a positive integer`)
      }
      if (cursor + span > columnCount) {
        throwTableError(
          'ILLEGAL_MERGE',
          `row ${rowIndex} cell ${cellIndex} merges past the ${columnCount} table columns`,
        )
      }
      cursor += span
    })
    if (cursor !== columnCount) {
      throwTableError(
        'BODY_COLUMN_MISMATCH',
        `row ${rowIndex} covers ${cursor} columns but the table has ${columnCount}`,
      )
    }
  })
}

/** Validate every cell's numeric payload (finite numbers, legal ranges). */
function validateCellNumbers(model: ThreeLineTableModel): void {
  model.rows.forEach((row, rowIndex) => {
    row.forEach((cell, cellIndex) => {
      const where = `row ${rowIndex} cell ${cellIndex}`
      switch (cell.kind) {
        case 'missing':
          break
        case 'text':
        case 'formatted':
          if (typeof cell.text !== 'string') {
            throwTableError('INVALID_CELL', `${where} (${cell.kind}) text must be a string`)
          }
          break
        case 'number':
          requireFiniteNumber(cell.value, `${where} value`)
          break
        case 'meanSd':
        case 'meanSdParen':
          requireFiniteNumber(cell.mean, `${where} mean`)
          requireFiniteNumber(cell.sd, `${where} sd`)
          break
        case 'ci':
          requireFiniteNumber(cell.lo, `${where} lo`)
          requireFiniteNumber(cell.hi, `${where} hi`)
          if (cell.point !== undefined) requireFiniteNumber(cell.point, `${where} point`)
          if (cell.lo > cell.hi) {
            throwTableError('INVALID_NUMBER', `${where} confidence interval lo must not exceed hi`)
          }
          break
        case 'pValue':
          requireFiniteNumber(cell.value, `${where} value`)
          if (cell.value < 0 || cell.value > 1) {
            throwTableError('INVALID_NUMBER', `${where} p-value must lie in [0, 1]`)
          }
          break
      }
      // Read the common decorations through a record view: at this boundary
      // the caller may still have authored out-of-union values (e.g. a scale
      // string that is neither 'percent' nor 'fraction'), so the comparisons
      // below must stay meaningful against unknown rather than the declared
      // literal unions.
      const rawCell = cell as unknown as Record<string, unknown>
      const unit = rawCell.unit
      if (unit !== undefined && typeof unit !== 'string') {
        throwTableError('INVALID_CELL', `${where} unit must be a string`)
      }
      const scale = rawCell.scale
      if (scale !== undefined && scale !== 'percent' && scale !== 'fraction') {
        throwTableError('INVALID_CELL', `${where} scale must be percent or fraction`)
      }
      const emphasis = rawCell.emphasis
      if (emphasis !== undefined && emphasis !== 'best') {
        throwTableError('INVALID_CELL', `${where} emphasis must be 'best' when present`)
      }
      if (emphasis !== undefined && cellScalars(cell).length === 0) {
        throwTableError(
          'DIRECTION_CONTRADICTION',
          `${where} emphasizes 'best' on a non-numeric cell (nothing to compare)`,
        )
      }
    })
  })
}

/** Column-level semantics: unit consistency (a), emphasis/direction (b),
 *  p-value/star agreement (c), percent/fraction mixing (d) and decimal-place
 *  consistency (e). Operates on non-merged cells that belong to one column. */
function validateColumnSemantics(model: ThreeLineTableModel): void {
  const columnCount = model.columns.length
  const leafCellsByColumn: Array<Array<ThreeLineTableCell>> = Array.from(
    { length: columnCount },
    () => [],
  )
  model.rows.forEach((row) => {
    let cursor = 0
    row.forEach((cell) => {
      const span = cell.colSpan === undefined ? 1 : cell.colSpan
      if (span === 1 && cursor < columnCount) {
        leafCellsByColumn[cursor]?.push(cell)
      }
      cursor += span
    })
  })

  const significance =
    model.significance === undefined
      ? THREE_LINE_TABLE_DEFAULT_SIGNIFICANCE
      : model.significance

  model.columns.forEach((column, columnIndex) => {
    // leafCellsByColumn is pre-sized to model.columns.length and columnIndex
    // iterates the same array, so the right side of `?? []` is unreachable
    // (kept only to satisfy noUncheckedIndexedAccess).
    /* v8 ignore next 1 */
    const cells = leafCellsByColumn[columnIndex] ?? []
    const where = `column "${column.header}"`

    // (a) unit consistency across cells of one column.
    const declaredUnit = column.unit
    for (const cell of cells) {
      if (cell.unit === undefined) continue
      if (declaredUnit === undefined || cell.unit !== declaredUnit) {
        throwTableError(
          'UNIT_MISMATCH',
          `${where} cell unit "${cell.unit}" disagrees with the column unit ${
            declaredUnit === undefined ? '(undeclared)' : `"${declaredUnit}"`
          }`,
        )
      }
    }

    // (d) percent / raw-fraction mixing inside one column.
    const scales = new Set<string>()
    if (column.scale !== undefined) scales.add(column.scale)
    for (const cell of cells) {
      if (cell.scale !== undefined && cellScalars(cell).length > 0) scales.add(cell.scale)
    }
    if (scales.has('percent') && scales.has('fraction')) {
      throwTableError(
        'PERCENT_DECIMAL_MIX',
        `${where} mixes percentage and raw-fraction scales in one column`,
      )
    }

    // (e) chaotic / inconsistent decimal places inside one column. Every
    // scalar authored in this column is tracked individually so that ragged
    // precision is caught both across cells AND inside one composite cell
    // (e.g. a "1.23 ± 0.1" mean±sd mixes two- and one-decimal scalars).
    const decimals = column.decimals
    const scalarDecimals: number[] = []
    for (const cell of cells) {
      for (const scalar of cellScalars(cell)) {
        const dp = decimalPlacesOf(scalar)
        scalarDecimals.push(dp)
        if (decimals !== undefined && dp > decimals) {
          throwTableError(
            'DECIMAL_CHAOS',
            `${where} value ${String(scalar)} needs ${dp} decimal places but the column declares ${decimals}`,
          )
        }
      }
    }
    if (decimals === undefined && scalarDecimals.length > 1) {
      const first = scalarDecimals[0]
      if (first !== undefined && scalarDecimals.some(dp => dp !== first)) {
        throwTableError(
          'DECIMAL_CHAOS',
          `${where} has no declared decimals yet mixes ${scalarDecimals.join(', ')} decimal places across its values`,
        )
      }
    }

    // (b) emphasis metadata must not contradict the column's metric direction.
    const direction = column.metricDirection
    const emphasized = cells.filter(cell => cell.emphasis === 'best')
    if (emphasized.length > 0) {
      if (direction === undefined) {
        throwTableError(
          'DIRECTION_CONTRADICTION',
          `${where} emphasizes 'best' cells but declares no metricDirection`,
        )
      }
      let best: number | undefined
      for (const cell of cells) {
        const primary = cellPrimaryScalar(cell)
        if (primary === undefined) continue
        if (best === undefined) {
          best = primary
          continue
        }
        best = direction === 'higher-is-better' ? Math.max(best, primary) : Math.min(best, primary)
      }
      // Unreachable: an emphasized cell must itself be numeric (validateCellNumbers
      // already throws DIRECTION_CONTRADICTION for emphasis on a non-numeric cell),
      // so the best-searching loop always finds at least the emphasized cell's
      // scalar before this point.
      /* v8 ignore next 5 */
      if (best === undefined) {
        throwTableError(
          'DIRECTION_CONTRADICTION',
          `${where} emphasizes 'best' but no numeric cell provides a comparable value`,
        )
      }
      for (const cell of emphasized) {
        if (cellPrimaryScalar(cell) !== best) {
          throwTableError(
            'DIRECTION_CONTRADICTION',
            `${where} marks value ${String(cellPrimaryScalar(cell))} as best, but the column is ${direction} (best is ${String(best)})`,
          )
        }
      }
    }

    // (c) authored significance stars must agree with the cell's p-value.
    for (const cell of cells) {
      if (cell.kind !== 'pValue') continue
      const stars = cell.stars
      if (stars === undefined || stars === 0) continue
      if (!Number.isInteger(stars) || stars < 0) {
        throwTableError('STAR_PVALUE_MISMATCH', `${where} p-value cell carries an invalid star count`)
      }
      const limit = significanceStarLimit(cell.value, significance)
      if (stars > limit) {
        throwTableError(
          'STAR_PVALUE_MISMATCH',
          `${where} p-value ${String(cell.value)} carries ${String(stars)} star(s) but only supports ${String(limit)}`,
        )
      }
    }
  })
}

/** Validate the bound data snapshot against the model's own scalars (f). */
function validateSnapshot(model: ThreeLineTableModel): void {
  const snapshot = model.dataSnapshot
  if (snapshot === undefined) return
  const rawSnapshot = snapshot as unknown as Record<string, unknown>
  if (!isRecord(rawSnapshot) || !Array.isArray(rawSnapshot.values)) {
    throwTableError('INVALID_SNAPSHOT', 'dataSnapshot must be an object with a values array')
  }
  const values = rawSnapshot.values as ReadonlyArray<unknown>
  values.forEach((rawEntry, index) => {
    const where = `dataSnapshot.values[${index}]`
    if (!isRecord(rawEntry)) {
      throwTableError('INVALID_SNAPSHOT', `${where} must be an object`)
    }
    const rowIndex = rawEntry.rowIndex
    if (typeof rowIndex !== 'number' || !Number.isInteger(rowIndex) || rowIndex < 0) {
      throwTableError('INVALID_SNAPSHOT', `${where} rowIndex must be a non-negative integer`)
    }
    const columnIndex = rawEntry.columnIndex
    if (
      typeof columnIndex !== 'number' ||
      !Number.isInteger(columnIndex) ||
      columnIndex < 0 ||
      columnIndex >= model.columns.length
    ) {
      throwTableError('INVALID_SNAPSHOT', `${where} columnIndex is out of range`)
    }
    const part = rawEntry.part
    if (
      part !== 'value' &&
      part !== 'mean' &&
      part !== 'sd' &&
      part !== 'lo' &&
      part !== 'hi' &&
      part !== 'point'
    ) {
      throwTableError('INVALID_SNAPSHOT', `${where} part is invalid`)
    }
    const recorded = rawEntry.recorded
    if (typeof recorded !== 'number' || !Number.isFinite(recorded)) {
      throwTableError('INVALID_SNAPSHOT', `${where} recorded must be a finite number`)
    }
    const row = model.rows[rowIndex]
    if (row === undefined) {
      throwTableError('INVALID_SNAPSHOT', `${where} rowIndex is out of range`)
    }
    let scalar: number | undefined
    let found = false
    let cursor = 0
    const col = columnIndex
    const requestedPart = part
    for (const cell of row) {
      const span = cell.colSpan === undefined ? 1 : cell.colSpan
      if (col >= cursor && col < cursor + span) {
        if (col !== cursor) {
          throwTableError(
            'INVALID_SNAPSHOT',
            `${where} targets inside a merged cell (use its start column)`,
          )
        }
        if (requestedPart === 'value') {
          if (cell.kind === 'number' || cell.kind === 'pValue') {
            scalar = cell.value
            found = true
          }
        } else if (requestedPart === 'mean') {
          if (cell.kind === 'meanSd' || cell.kind === 'meanSdParen') {
            scalar = cell.mean
            found = true
          }
        } else if (requestedPart === 'sd') {
          if (cell.kind === 'meanSd' || cell.kind === 'meanSdParen') {
            scalar = cell.sd
            found = true
          }
        // Unreachable else-side: validateSnapshot constrains part to
        // value/mean/sd/lo/hi/point before resolution, so when this point is
        // reached the requested part is guaranteed to be lo, hi or point.
        /* v8 ignore start -- resolved part is lo/hi/point */
        } else {
          if (cell.kind === 'ci') {
            scalar =
              requestedPart === 'lo' ? cell.lo : requestedPart === 'hi' ? cell.hi : cell.point
            found = requestedPart === 'point' ? scalar !== undefined : true
          }
        }
        /* v8 ignore stop */
        break
      }
      cursor += span
    }
    if (!found || scalar === undefined) {
      throwTableError(
        'INVALID_SNAPSHOT',
        `${where} requests part "${requestedPart}" which the addressed cell does not carry`,
      )
    }
    if (scalar !== recorded) {
      throwTableError(
        'SNAPSHOT_CONTRADICTION',
        `table row ${String(rowIndex)} col ${String(col)} part "${requestedPart}" holds ${String(scalar)} but the bound snapshot recorded ${String(recorded)}`,
      )
    }
  })
}

/** Normalize the validated model into a snapshot object: materialize effective
 *  defaults (missing token, significance policy) and drop vacuous empties so
 *  that equal models produce equal snapshots. The snapshot is the exact model
 *  the rendered text is produced from (the artifact later deep-freezes it). */
function materializeSnapshot(model: ThreeLineTableModel): ThreeLineTableModel {
  const withTitle =
    model.title !== undefined && model.title.trim().length > 0 ? { title: model.title } : {}
  const groupedHeaders =
    model.groupedHeaders !== undefined && model.groupedHeaders.length > 0
      ? model.groupedHeaders
      : undefined
  const withGroups = groupedHeaders === undefined ? {} : { groupedHeaders }
  const footnotes =
    model.footnotes === undefined ? undefined : model.footnotes.filter(text => text.trim().length > 0)
  const withFootnotes = footnotes === undefined || footnotes.length === 0 ? {} : { footnotes }
  const withSnapshot = model.dataSnapshot === undefined ? {} : { dataSnapshot: model.dataSnapshot }
  return {
    ...withTitle,
    missingToken:
      model.missingToken === undefined ? THREE_LINE_TABLE_DEFAULT_MISSING_TOKEN : model.missingToken,
    columns: model.columns,
    ...withGroups,
    rows: model.rows,
    ...withFootnotes,
    significance:
      model.significance === undefined
        ? THREE_LINE_TABLE_DEFAULT_SIGNIFICANCE
        : model.significance,
    ...withSnapshot,
  }
}

function validateModel(model: ThreeLineTableModel): void {
  validateModelStructure(model)
  validateGroupedHeaders(model)
  validateRows(model)
  validateCellNumbers(model)
  validateColumnSemantics(model)
  validateSnapshot(model)
}

// ───────────────────── Markdown (three-line, no verticals) ──────────────────

interface PlacedSpan {
  readonly start: number
  readonly count: number
  readonly text: string
  readonly centered: boolean
}

function regionWidth(widths: number[], start: number, count: number): number {
  let total = 2 * (count - 1)
  for (let index = start; index < start + count; index++) {
    total += widths[index] as number
  }
  return total
}

function cellMdText(cell: ThreeLineTableCell, column: ThreeLineTableColumn, missingToken: string): string {
  const plain = threeLineTableCellText(cell, column, missingToken)
  return cell.emphasis === 'best' ? `**${plain}**` : plain
}

function bodyPlacedSpans(model: ThreeLineTableModel, missingToken: string): PlacedSpan[][] {
  const rowSpans: PlacedSpan[][] = []
  for (const row of model.rows) {
    const spans: PlacedSpan[] = []
    let cursor = 0
    for (const cell of row) {
      const span = cell.colSpan === undefined ? 1 : cell.colSpan
      const column = model.columns[cursor] as ThreeLineTableColumn
      spans.push({
        start: cursor,
        count: span,
        text: cellMdText(cell, column, missingToken),
        centered: false,
      })
      cursor += span
    }
    rowSpans.push(spans)
  }
  return rowSpans
}

function leafPlacedSpans(model: ThreeLineTableModel): PlacedSpan[] {
  const spans: PlacedSpan[] = []
  model.columns.forEach((column, index) => {
    spans.push({ start: index, count: 1, text: headerDisplay(column), centered: true })
  })
  return spans
}

/** Fit fixed display widths so every header/cell region fits its text. */
function fitWidths(
  columnCount: number,
  regions: ReadonlyArray<PlacedSpan>,
): { widths: number[]; offsets: number[]; total: number } {
  const widths: number[] = new Array<number>(columnCount).fill(0)
  for (const region of regions) {
    if (region.count !== 1) continue
    const width = widths[region.start] as number
    if (region.text.length > width) widths[region.start] = region.text.length
  }
  let changed = true
  while (changed) {
    changed = false
    for (const region of regions) {
      if (region.count === 1) continue
      const current = regionWidth(widths, region.start, region.count)
      if (current < region.text.length) {
        const add = Math.ceil((region.text.length - current) / region.count)
        for (let index = region.start; index < region.start + region.count; index++) {
          widths[index] = (widths[index] as number) + add
        }
        changed = true
      }
    }
  }
  const offsets: number[] = []
  let running = 0
  for (let index = 0; index < columnCount; index++) {
    offsets.push(running)
    running += (widths[index] as number) + 2
  }
  const total = running - 2
  return { widths, offsets, total }
}

function renderMdLine(
  widths: number[],
  offsets: number[],
  total: number,
  spans: ReadonlyArray<PlacedSpan>,
): string {
  const chars: string[] = new Array<string>(total).fill(' ')
  for (const span of spans) {
    const startAt = offsets[span.start] as number
    const width = regionWidth(widths, span.start, span.count)
    // Layout guarantees every region is wide enough for its (possibly
    // centered) text, so the placement always stays inside the line.
    const position = span.centered
      ? startAt + Math.floor((width - span.text.length) / 2)
      : startAt
    for (let index = 0; index < span.text.length; index++) {
      chars[position + index] = span.text.charAt(index)
    }
  }
  return chars.join('')
}

/** Render the model as a three-line plain-text Markdown table (exactly three
 *  horizontal rules: top, header-bottom, bottom; no vertical rules anywhere). */
export function renderThreeLineTableMarkdown(model: ThreeLineTableModel): string {
  const missingToken =
    model.missingToken ?? THREE_LINE_TABLE_DEFAULT_MISSING_TOKEN
  const columnCount = model.columns.length
  const regions: PlacedSpan[] = []
  if (model.groupedHeaders !== undefined) {
    for (const row of model.groupedHeaders) {
      let cursor = 0
      for (const group of row) {
        regions.push({ start: cursor, count: group.span, text: group.label, centered: true })
        cursor += group.span
      }
    }
  }
  const leafSpans = leafPlacedSpans(model)
  for (const span of leafSpans) regions.push(span)
  const bodyRowSpans = bodyPlacedSpans(model, missingToken)
  for (const spans of bodyRowSpans) {
    for (const span of spans) regions.push(span)
  }

  const { widths, offsets, total } = fitWidths(columnCount, regions)
  const rule = '─'.repeat(total)
  const lines: string[] = []
  if (model.title !== undefined) {
    lines.push(model.title)
    lines.push('')
  }
  lines.push(rule)
  if (model.groupedHeaders !== undefined) {
    for (const row of model.groupedHeaders) {
      lines.push(renderMdLine(widths, offsets, total, groupRowToPlaced(row)))
    }
  }
  lines.push(renderMdLine(widths, offsets, total, leafSpans))
  lines.push(rule)
  for (const spans of bodyRowSpans) {
    lines.push(renderMdLine(widths, offsets, total, spans))
  }
  lines.push(rule)
  if (model.footnotes !== undefined) {
    lines.push('')
    for (const footnote of model.footnotes) lines.push(footnote)
  }
  return lines.join('\n')
}

function groupRowToPlaced(row: ThreeLineTableGroupedHeaderRow): PlacedSpan[] {
  const spans: PlacedSpan[] = []
  let cursor = 0
  for (const group of row) {
    spans.push({ start: cursor, count: group.span, text: group.label, centered: true })
    cursor += group.span
  }
  return spans
}

// ─────────────────────── LaTeX (booktabs, three rules) ──────────────────────

function latexCell(cell: ThreeLineTableCell, column: ThreeLineTableColumn, missingToken: string): string {
  const plain = threeLineTableCellText(cell, column, missingToken)
  const escaped = escapeLatex(plain)
  return cell.emphasis === 'best' ? `\\textbf{${escaped}}` : escaped
}

/** Render the model as a LaTeX booktabs three-line table. Exactly three
 *  horizontal rules (\toprule / \midrule / \bottomrule) and no vertical rules
 *  (no `|` in the column spec). */
export function renderThreeLineTableLatex(model: ThreeLineTableModel): string {
  const missingToken =
    model.missingToken ?? THREE_LINE_TABLE_DEFAULT_MISSING_TOKEN
  const columnCount = model.columns.length
  const columnSpec = 'c'.repeat(columnCount)
  const pieces: string[] = ['\\begin{table}']
  if (model.title !== undefined) pieces.push(`\\caption{${escapeLatex(model.title)}}`)
  pieces.push(`\\begin{tabular}{${columnSpec}}`)
  pieces.push('\\toprule')

  if (model.groupedHeaders !== undefined) {
    for (const row of model.groupedHeaders) {
      const entries: string[] = []
      for (const group of row) {
        entries.push(`\\multicolumn{${group.span}}{c}{${escapeLatex(group.label)}}`)
      }
      pieces.push(`${entries.join(' & ')} \\\\`)
    }
  }

  const leafEntries: string[] = []
  for (const column of model.columns) {
    leafEntries.push(escapeLatex(headerDisplay(column)))
  }
  pieces.push(`${leafEntries.join(' & ')} \\\\`)
  pieces.push('\\midrule')

  for (const row of model.rows) {
    const entries: string[] = []
    let cursor = 0
    for (const cell of row) {
      const span = cell.colSpan === undefined ? 1 : cell.colSpan
      const column = model.columns[cursor] as ThreeLineTableColumn
      const text = latexCell(cell, column, missingToken)
      entries.push(span === 1 ? text : `\\multicolumn{${span}}{c}{${text}}`)
      cursor += span
    }
    pieces.push(`${entries.join(' & ')} \\\\`)
  }

  pieces.push('\\bottomrule')
  pieces.push('\\end{tabular}')
  if (model.footnotes !== undefined) {
    pieces.push('')
    for (const footnote of model.footnotes) pieces.push(escapeLatex(footnote))
  }
  pieces.push('\\end{table}')
  return pieces.join('\n')
}

// ─────────────────────────────── Entry point ────────────────────────────────

function validateTarget(target: ThreeLineTableTarget): void {
  // Read through an unknown view: the caller may pass a runtime string that is
  // neither 'markdown' nor 'latex' (the typed union only exists statically).
  const rawTarget: unknown = target
  if (rawTarget !== 'markdown' && rawTarget !== 'latex') {
    throwTableError('INVALID_TARGET', `target must be 'markdown' or 'latex' (got ${String(rawTarget)})`)
  }
}

function validateTimestamp(timestamp: number): void {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    throwTableError(
      'INVALID_TIMESTAMP',
      `timestamp must be a finite epoch-ms number (got ${String(timestamp)})`,
    )
  }
}

/**
 * Render one structured {@link ThreeLineTableModel} as a three-line table in
 * the requested pure-string target.
 *
 * PURE + DETERMINISTIC: the model is validated (never auto-corrected),
 * normalized into a snapshot, and rendered with no external formatter, no IO
 * and no clock — the epoch-ms `timestamp` is caller-injected (REQUIRED) and
 * lands in meta.producedAt. The same model + target always produce a
 * byte-identical render and an equal frozen artifact.
 *
 * @param model the structured table model to render.
 * @param target 'markdown' (three-line plain text) or 'latex' (booktabs).
 * @param timestamp caller-injected epoch-ms timestamp (auditable).
 * @throws {ThreeLineTableError} on invalid input or on detection of any of the
 *   six traffic-paper anti-patterns (see module header).
 */
export function renderThreeLineTable(
  model: ThreeLineTableModel,
  target: ThreeLineTableTarget,
  timestamp: number,
): ThreeLineTableArtifact {
  validateTarget(target)
  validateTimestamp(timestamp)
  validateModel(model)
  const table = materializeSnapshot(model)
  const text =
    target === 'markdown'
      ? renderThreeLineTableMarkdown(table)
      : renderThreeLineTableLatex(table)
  const bindingHash = fnv1aHex(`${canonicalStringify(table)}\u0000${target}`)
  const artifact: ThreeLineTableArtifact = {
    meta: {
      toolId: THREE_LINE_TABLE_TOOL_ID,
      version: THREE_LINE_TABLE_TOOL_VERSION,
      producedAt: timestamp,
    },
    table,
    bindingHash,
    render: { target, text },
  }
  return freezeArtifact<ThreeLineTableArtifact>(artifact)
}

/** Alias of {@link renderThreeLineTable} (T17 step entry-point naming). */
export const runThreeLineTable = renderThreeLineTable
