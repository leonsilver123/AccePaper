// @deepseek-ai/dsh-research-tools — T17 three-line-table (三线表) vitest spec.
//
// Covers the frozen T17 contract:
//   - ONE structured table model (ThreeLineTableModel) with grouped headers /
//     per-column units / decimals + precision rule / footnotes / significance
//     policy and structured (never raw-string) cells incl. a unified missing
//     representation;
//   - validation before rendering (header/body column-count consistency,
//     merged-cell legality, NaN/Infinity/undefined rejection, decimal rules);
//   - faithfulness: the tool never changes/fills/infers data — renders exactly
//     the model (parsed Markdown body cells are diffed against the model);
//   - three-line style with exactly three horizontal rules and NO vertical
//     rules in BOTH Markdown and LaTeX output;
//   - the six traffic-paper anti-patterns (a)-(f), each with its own code;
//   - a NORMALIZED MODEL SNAPSHOT bound to the rendered text + meta, byte
//     determinism, deep freeze and the pure entry signature (timestamp last,
//     no Date.now()).

import { describe, expect, it } from 'vitest'
import {
  THREE_LINE_TABLE_DEFAULT_MISSING_TOKEN,
  THREE_LINE_TABLE_ERROR_PREFIX,
  THREE_LINE_TABLE_TOOL_ID,
  THREE_LINE_TABLE_TOOL_VERSION,
  ThreeLineTableError,
  renderThreeLineTable,
  renderThreeLineTableLatex,
  renderThreeLineTableMarkdown,
  runThreeLineTable,
  threeLineTableCellText,
} from '../../src/tools/three-line-table/index.ts'
import type {
  ThreeLineTableCell,
  ThreeLineTableColumn,
  ThreeLineTableModel,
} from '../../src/tools/three-line-table/index.ts'

const TS = 1_700_000_000_000
const run = renderThreeLineTable

function errorCodeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (error) {
    return error instanceof ThreeLineTableError ? error.code : undefined
  }
  return undefined
}

function codeOf(fn: () => unknown): string {
  const code = errorCodeOf(fn)
  if (code === undefined) {
    throw new Error('expected a ThreeLineTableError but none was thrown')
  }
  return code
}

/** Shallow copy of a model with one optional key removed (readonly interfaces
 *  forbid delete, so the omission goes through object-rest destructuring). */
function without(
  model: ThreeLineTableModel,
  key: keyof ThreeLineTableModel,
): ThreeLineTableModel {
  const { [key]: _removed, ...copy } = model
  return copy as unknown as ThreeLineTableModel
}

/** One valid baseline model reused as the scaffold for the renderer tests. */
function validModel(overrides: Partial<ThreeLineTableModel> = {}): ThreeLineTableModel {
  return {
    title: 'Synthetic benchmark results',
    columns: [
      { header: 'Approach' },
      { header: 'BLEU', decimals: 1 },
      { header: 'ROUGE-L', decimals: 1 },
      { header: 'Time', unit: 's', decimals: 1 },
    ],
    rows: [
      [
        { kind: 'text', text: 'Transformer-XL' },
        { kind: 'meanSd', mean: 34.2, sd: 0.4 },
        { kind: 'meanSdParen', mean: 61.5, sd: 0.3 },
        { kind: 'number', value: 12.4 },
      ],
      [
        { kind: 'text', text: 'Retrieval-Aug' },
        { kind: 'meanSd', mean: 33.8, sd: 0.5 },
        { kind: 'meanSdParen', mean: 60.9, sd: 0.2 },
        { kind: 'missing' },
      ],
      [
        { kind: 'text', text: 'Longformer' },
        { kind: 'missing' },
        { kind: 'formatted', text: '61.0' },
        { kind: 'number', value: 9.8 },
      ],
    ],
    footnotes: ['Values are synthetic.'],
    ...overrides,
  }
}

/** The canonical expected cell strings of {@link validModel} (rendered by the
 *  tool's own formatter so a rendered/parsed body diff is faithful). */
function expectedBodyCells(model: ThreeLineTableModel): string[][] {
  const missingToken =
    model.missingToken ?? THREE_LINE_TABLE_DEFAULT_MISSING_TOKEN
  return model.rows.map((row) => {
    const cells: string[] = []
    let cursor = 0
    for (const cell of row) {
      const column = model.columns[cursor] as ThreeLineTableColumn
      cells.push(threeLineTableCellText(cell, column, missingToken))
      cursor += cell.colSpan === undefined ? 1 : cell.colSpan
    }
    return cells
  })
}

/** Parse the body of a three-line Markdown render into per-cell tokens
 *  (columns are separated by runs of >= 2 spaces; our formatter never emits a
 *  double space inside a cell). */
function markdownBodyTokens(markdown: string): string[][] {
  const lines = markdown.split('\n')
  const ruleIndexes: number[] = []
  lines.forEach((line, index) => {
    if (/^─+$/u.test(line)) ruleIndexes.push(index)
  })
  expect(ruleIndexes).toHaveLength(3)
  const start = ruleIndexes[1]
  const end = ruleIndexes[2]
  if (start === undefined || end === undefined) {
    throw new Error('expected at least three rule lines')
  }
  const bodyLines = lines.slice(start + 1, end)
  return bodyLines.map(line =>
    line
      .split(/\s{2,}/u)
      .map(token => token.trim())
      .filter(token => token.length > 0),
  )
}

// ───────────────────────────── entry + envelope ─────────────────────────────

describe('entry point and artifact envelope', () => {
  it('runThreeLineTable aliases renderThreeLineTable', () => {
    expect(runThreeLineTable).toBe(renderThreeLineTable)
  })

  it('carries meta toolId / version / producedAt on both targets', () => {
    for (const target of ['markdown', 'latex'] as const) {
      const artifact = run(validModel(), target, TS)
      expect(artifact.meta.toolId).toBe(THREE_LINE_TABLE_TOOL_ID)
      expect(artifact.meta.toolId).toBe('three-line-table')
      expect(artifact.meta.version).toBe(THREE_LINE_TABLE_TOOL_VERSION)
      expect(artifact.meta.producedAt).toBe(TS)
      expect(artifact.render.target).toBe(target)
    }
  })

  it('rejects an invalid target', () => {
    expect(codeOf(() => run(validModel(), 'pdf' as never, TS))).toBe(
      `${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_TARGET`,
    )
  })

  it('rejects non-finite / non-number timestamps (no clock fallback)', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '1' as unknown as number]) {
      expect(codeOf(() => run(validModel(), 'markdown', bad))).toBe(
        `${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_TIMESTAMP`,
      )
    }
  })

  it('exposes ThreeLineTableError with a code property and prefix', () => {
    try {
      run(null as unknown as ThreeLineTableModel, 'markdown', TS)
    } catch (error) {
      expect(error).toBeInstanceOf(ThreeLineTableError)
      const typed = error as ThreeLineTableError
      expect(typed.code).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_MODEL`)
      expect(typed.message).toContain(typed.code)
      expect(typed.name).toBe('ThreeLineTableError')
      return
    }
    throw new Error('expected a throw for a null model')
  })

  it('deep-freezes the artifact: table, cells, render and meta are immutable', () => {
    const artifact = run(validModel(), 'markdown', TS)
    expect(Object.isFrozen(artifact)).toBe(true)
    expect(Object.isFrozen(artifact.meta)).toBe(true)
    expect(Object.isFrozen(artifact.render)).toBe(true)
    expect(Object.isFrozen(artifact.table)).toBe(true)
    expect(Object.isFrozen(artifact.table.columns)).toBe(true)
    expect(Object.isFrozen(artifact.table.columns[0])).toBe(true)
    expect(Object.isFrozen(artifact.table.rows)).toBe(true)
    expect(Object.isFrozen(artifact.table.rows[0])).toBe(true)
    expect(Object.isFrozen(artifact.table.rows[0]?.[0])).toBe(true)
    expect(() => {
      ;(artifact.render as { text: string }).text = 'mutated'
    }).toThrow(TypeError)
    expect(() => {
      ;(artifact.table.rows[0]?.[0] as unknown as { kind: string }).kind = 'number'
    }).toThrow(TypeError)
  })
})

// ─────────────────────────────── determinism ────────────────────────────────

describe('determinism and snapshot binding', () => {
  it('same model + target produce byte-identical renders and equal artifacts', () => {
    const first = run(validModel(), 'markdown', TS)
    const second = run(validModel(), 'markdown', TS)
    expect(second.render.text).toBe(first.render.text)
    expect(second).toEqual(first)
    expect(second.bindingHash).toBe(first.bindingHash)
    const latexFirst = run(validModel(), 'latex', TS)
    const latexSecond = run(validModel(), 'latex', TS)
    expect(latexSecond.render.text).toBe(latexFirst.render.text)
    expect(latexFirst.render.text).not.toBe(first.render.text)
  })

  it('equal models with different key orderings hash and render identically', () => {
    const headerFirst: ThreeLineTableModel = {
      title: 'Same table',
      columns: [{ header: 'X', decimals: 1 }],
      rows: [[{ kind: 'number', value: 1.2 }]],
    }
    const valueFirst: ThreeLineTableModel = {
      columns: [{ decimals: 1, header: 'X' }],
      rows: [[{ value: 1.2, kind: 'number' }]],
      title: 'Same table',
    }
    const a = run(headerFirst, 'markdown', TS)
    const b = run(valueFirst, 'markdown', TS)
    expect(b.render.text).toBe(a.render.text)
    expect(b.bindingHash).toBe(a.bindingHash)
    expect(b.table).toEqual(a.table)
  })

  it('the artifact carries a NORMALIZED MODEL SNAPSHOT bound to the rendered text', () => {
    const artifact = run(validModel(), 'markdown', TS)
    expect(artifact.table.title).toBe('Synthetic benchmark results')
    expect(artifact.table.missingToken).toBe(THREE_LINE_TABLE_DEFAULT_MISSING_TOKEN)
    expect(artifact.table.footnotes).toEqual(['Values are synthetic.'])
    expect(artifact.table.significance).toEqual({
      pLessThan: [0.05, 0.01, 0.001],
    })
    expect(typeof artifact.bindingHash).toBe('string')
    expect(artifact.bindingHash).toMatch(/^[0-9a-f]{8}$/u)
    // The render text actually contains the snapshot's missing token.
    expect(artifact.render.text).toContain(THREE_LINE_TABLE_DEFAULT_MISSING_TOKEN)
  })

  it('materializes defaults and drops vacuous empties in the snapshot', () => {
    const model = validModel({
      title: '   ',
      missingToken: 'NA',
      footnotes: ['', '  ', 'kept note'],
      groupedHeaders: [],
    })
    const artifact = run(model, 'markdown', TS)
    expect(artifact.table.title).toBeUndefined()
    expect(artifact.table.missingToken).toBe('NA')
    expect(artifact.table.footnotes).toEqual(['kept note'])
    expect(artifact.table.groupedHeaders).toBeUndefined()
    expect(artifact.render.text).toContain('NA')
  })
})

// ─────────────────────── structural validation errors ───────────────────────

describe('model structural validation', () => {
  it('rejects a null / non-object model', () => {
    expect(codeOf(() => run(null as unknown as ThreeLineTableModel, 'markdown', TS))).toBe(
      `${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_MODEL`,
    )
    expect(codeOf(() => run(42 as unknown as ThreeLineTableModel, 'markdown', TS))).toBe(
      `${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_MODEL`,
    )
  })

  it('rejects missing / empty columns', () => {
    expect(codeOf(() => run({ ...validModel(), columns: [] }, 'markdown', TS))).toBe(
      `${THREE_LINE_TABLE_ERROR_PREFIX}EMPTY_COLUMNS`,
    )
    expect(
      codeOf(() =>
        run({ ...validModel(), columns: undefined as unknown as ThreeLineTableColumn[] }, 'markdown', TS),
      ),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}EMPTY_COLUMNS`)
  })

  it('rejects a malformed groupedHeaders container', () => {
    expect(
      codeOf(() =>
        run(
          { ...validModel(), groupedHeaders: 'nope' as never },
          'markdown',
          TS,
        ),
      ),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_MODEL`)
  })

  it('rejects missing / empty rows', () => {
    expect(codeOf(() => run({ ...validModel(), rows: [] }, 'markdown', TS))).toBe(
      `${THREE_LINE_TABLE_ERROR_PREFIX}EMPTY_ROWS`,
    )
    expect(
      codeOf(() =>
        run({ ...validModel(), rows: undefined as unknown as ThreeLineTableModel['rows'] }, 'markdown', TS),
      ),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_MODEL`)
  })

  it('rejects an empty single row and a non-array row', () => {
    expect(codeOf(() => run({ ...validModel(), rows: [[]] }, 'markdown', TS))).toBe(
      `${THREE_LINE_TABLE_ERROR_PREFIX}EMPTY_ROWS`,
    )
    expect(
      codeOf(() =>
        run(
          { ...validModel(), rows: ['x' as unknown as ReadonlyArray<ThreeLineTableCell>] },
          'markdown',
          TS,
        ),
      ),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_MODEL`)
  })

  it('rejects invalid missingToken values', () => {
    for (const bad of ['', '   ', 'n a'] as const) {
      expect(codeOf(() => run({ ...validModel(), missingToken: bad }, 'markdown', TS))).toBe(
        `${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_MODEL`,
      )
    }
  })

  it('rejects an invalid significance policy', () => {
    expect(
      codeOf(() =>
        run({ ...validModel(), significance: { pLessThan: [1.5] } }, 'markdown', TS),
      ),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_MODEL`)
    expect(
      codeOf(() =>
        run(
          { ...validModel(), significance: { pLessThan: 'x' as unknown as number[] } },
          'markdown',
          TS,
        ),
      ),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_MODEL`)
  })

  it('rejects invalid column shapes', () => {
    expect(
      codeOf(() =>
        run({ ...validModel(), columns: ['x' as unknown as ThreeLineTableColumn] }, 'markdown', TS),
      ),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_MODEL`)
    expect(
      codeOf(() =>
        run(
          {
            ...validModel(),
            columns: [{ header: 'H', decimals: 1, unit: 5 as unknown as string }],
          },
          'markdown',
          TS,
        ),
      ),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_MODEL`)
  })

  it('rejects empty / non-string headers and invalid decimals / precision / scale / direction', () => {
    const withHeader = (header: unknown): ThreeLineTableModel => ({
      ...validModel(),
      columns: [{ header: header as string, decimals: 1 }, { header: 'Score', decimals: 1 }],
      rows: [
        [
          { kind: 'text', text: 'A' },
          { kind: 'number', value: 1.2 },
        ],
      ],
    })
    expect(codeOf(() => run(withHeader('   '), 'markdown', TS))).toBe(
      `${THREE_LINE_TABLE_ERROR_PREFIX}EMPTY_HEADER`,
    )
    expect(codeOf(() => run(withHeader(7), 'markdown', TS))).toBe(
      `${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_MODEL`,
    )
    const withDecimals = (decimals: unknown): ThreeLineTableModel => ({
      ...validModel(),
      columns: [{ header: 'Score', decimals: decimals as number }],
      rows: [[{ kind: 'number', value: 1.2 }]],
    })
    expect(codeOf(() => run(withDecimals(-1), 'markdown', TS))).toBe(
      `${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_DECIMALS`,
    )
    expect(codeOf(() => run(withDecimals(1.5), 'markdown', TS))).toBe(
      `${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_DECIMALS`,
    )
    expect(
      codeOf(() =>
        run(
          { ...validModel(), columns: [{ header: 'S', precisionRule: 'auto' as never }] },
          'markdown',
          TS,
        ),
      ),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_MODEL`)
    expect(
      codeOf(() =>
        run({ ...validModel(), columns: [{ header: 'S', scale: 'ppm' as never }] }, 'markdown', TS),
      ),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_MODEL`)
    expect(
      codeOf(() =>
        run(
          { ...validModel(), columns: [{ header: 'S', metricDirection: 'sideways' as never }] },
          'markdown',
          TS,
        ),
      ),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_MODEL`)
  })
})

// ─────────────────── grouped headers + merge legality ───────────────────────

describe('grouped headers and merged-cell legality', () => {
  const twoColumns = (): ThreeLineTableModel => ({
    columns: [
      { header: 'Model' },
      { header: 'Score', decimals: 1 },
    ],
    rows: [
      [
        { kind: 'text', text: 'A' },
        { kind: 'number', value: 1.2 },
      ],
    ],
  })

  it('renders a valid multi-level grouped header in markdown and latex', () => {
    const model: ThreeLineTableModel = {
      title: 'Multi-level header',
      columns: [
        { header: 'Approach' },
        { header: 'BLEU', decimals: 1 },
        { header: 'ROUGE-L', decimals: 1 },
        { header: 'Time', unit: 's', decimals: 1 },
      ],
      groupedHeaders: [
        [{ label: 'Full evaluation', span: 4 }],
        [
          { label: 'Model', span: 1 },
          { label: 'Quality', span: 2 },
          { label: 'Speed', span: 1 },
        ],
      ],
      rows: validModel().rows,
    }
    const md = run(model, 'markdown', TS).render.text
    expect(md).toContain('Full evaluation')
    expect(md).toContain('Quality')
    const latex = run(model, 'latex', TS).render.text
    expect(latex).toContain('\\multicolumn{4}{c}{Full evaluation}')
    expect(latex).toContain('\\multicolumn{2}{c}{Quality}')
  })

  it('rejects a group row whose spans do not cover the columns', () => {
    const model: ThreeLineTableModel = {
      ...twoColumns(),
      groupedHeaders: [[{ label: 'Only one', span: 1 }]],
    }
    expect(codeOf(() => run(model, 'markdown', TS))).toBe(
      `${THREE_LINE_TABLE_ERROR_PREFIX}HEADER_COLUMN_MISMATCH`,
    )
  })

  it('rejects malformed grouped header rows and spans', () => {
    expect(
      codeOf(() =>
        run(
          { ...twoColumns(), groupedHeaders: [[null as never]] },
          'markdown',
          TS,
        ),
      ),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_MODEL`)
    expect(
      codeOf(() =>
        run(
          { ...twoColumns(), groupedHeaders: [[{ label: '  ', span: 2 }]] },
          'markdown',
          TS,
        ),
      ),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}EMPTY_HEADER`)
    expect(
      codeOf(() =>
        run(
          { ...twoColumns(), groupedHeaders: [[{ label: 'Bad', span: 0 }]] },
          'markdown',
          TS,
        ),
      ),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}ILLEGAL_MERGE`)
    expect(
      codeOf(() =>
        run(
          { ...twoColumns(), groupedHeaders: [[{ label: 'Bad', span: 1.5 }]] },
          'markdown',
          TS,
        ),
      ),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}ILLEGAL_MERGE`)
  })

  it('renders a body row with a legal merged cell', () => {
    const model: ThreeLineTableModel = {
      columns: [
        { header: 'A', decimals: 1 },
        { header: 'B', decimals: 1 },
        { header: 'C', decimals: 1 },
      ],
      rows: [
        [
          { kind: 'text', text: 'spanning note across A and B', colSpan: 2 },
          { kind: 'number', value: 3.4 },
        ],
        [
          { kind: 'number', value: 1.1 },
          { kind: 'number', value: 2.2 },
          { kind: 'number', value: 3.3 },
        ],
      ],
    }
    const md = run(model, 'markdown', TS).render.text
    expect(md).toContain('spanning note across A and B')
    expect(md).toContain('2.2')
    const latex = run(model, 'latex', TS).render.text
    expect(latex).toContain('\\multicolumn{2}{c}{spanning note across A and B}')
  })

  it('rejects illegal colSpan values and column-count overruns', () => {
    const base = (): ThreeLineTableModel => ({
      columns: [
        { header: 'A', decimals: 1 },
        { header: 'B', decimals: 1 },
      ],
      rows: [
        [
          { kind: 'number', value: 1.1 },
          { kind: 'number', value: 2.2 },
        ],
      ],
    })
    expect(
      codeOf(() =>
        run(
          { ...base(), rows: [[{ kind: 'number', value: 1.1, colSpan: -1 }]] },
          'markdown',
          TS,
        ),
      ),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}ILLEGAL_MERGE`)
    expect(
      codeOf(() =>
        run(
          { ...base(), rows: [[{ kind: 'number', value: 1.1, colSpan: 3 }]] },
          'markdown',
          TS,
        ),
      ),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}ILLEGAL_MERGE`)
    expect(
      codeOf(() =>
        run(
          {
            ...base(),
            rows: [[{ kind: 'text', text: 'only one cell', colSpan: 1 }]],
          },
          'markdown',
          TS,
        ),
      ),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}BODY_COLUMN_MISMATCH`)
  })

  it('rejects non-object cells and unknown cell kinds', () => {
    const model = validModel()
    expect(
      codeOf(() =>
        run(
          { ...model, rows: [[null as unknown as ThreeLineTableCell]] },
          'markdown',
          TS,
        ),
      ),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_CELL`)
    expect(
      codeOf(() =>
        run(
          { ...model, rows: [[{ kind: 'bogus' as never, text: 'x' }]] },
          'markdown',
          TS,
        ),
      ),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_CELL`)
  })
})

// ─────────────────────────── numeric cell validation ────────────────────────

describe('numeric cell validation', () => {
  const oneColumn = (rows: ThreeLineTableCell[][]): ThreeLineTableModel => ({
    columns: [{ header: 'Score', decimals: 1 }],
    rows,
  })

  it('rejects non-finite and out-of-range scalars with INVALID_NUMBER', () => {
    const cases: Array<{ rows: ThreeLineTableCell[][]; label: string }> = [
      { label: 'NaN number', rows: [[{ kind: 'number', value: Number.NaN }]] },
      { label: 'Infinity mean', rows: [[{ kind: 'meanSd', mean: Number.POSITIVE_INFINITY, sd: 0.1 }]] },
      { label: 'undefined sd', rows: [[{ kind: 'meanSd', mean: 1.2, sd: undefined as unknown as number }]] },
      { label: 'NaN lo', rows: [[{ kind: 'ci', lo: Number.NaN, hi: 2.0 }]] },
      { label: 'lo > hi', rows: [[{ kind: 'ci', lo: 3.0, hi: 2.0 }]] },
      { label: 'NaN point', rows: [[{ kind: 'ci', lo: 1.0, hi: 2.0, point: Number.NaN }]] },
      { label: 'p outside range', rows: [[{ kind: 'pValue', value: 1.5 }]] },
      { label: 'p negative', rows: [[{ kind: 'pValue', value: -0.01 }]] },
    ]
    for (const entry of cases) {
      expect(codeOf(() => run(oneColumn(entry.rows), 'markdown', TS)), entry.label).toBe(
        `${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_NUMBER`,
      )
    }
  })

  it('rejects non-string text / formatted payloads and bad decorations', () => {
    expect(
      codeOf(() =>
        run(oneColumn([[{ kind: 'text', text: 5 as unknown as string }]]), 'markdown', TS),
      ),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_CELL`)
    expect(
      codeOf(() =>
        run(
          oneColumn([[{ kind: 'number', value: 1.2, unit: 3 as unknown as string }]]),
          'markdown',
          TS,
        ),
      ),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_CELL`)
    expect(
      codeOf(() =>
        run(
          oneColumn([[{ kind: 'number', value: 1.2, scale: 'permille' as never }]]),
          'markdown',
          TS,
        ),
      ),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_CELL`)
    expect(
      codeOf(() =>
        run(
          oneColumn([[{ kind: 'number', value: 1.2, emphasis: 'none' as never }]]),
          'markdown',
          TS,
        ),
      ),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_CELL`)
  })

  it('rejects emphasis on a non-numeric cell (nothing to compare)', () => {
    expect(
      codeOf(() =>
        run(
          oneColumn([[{ kind: 'text', text: 'n/a', emphasis: 'best' }]]),
          'markdown',
          TS,
        ),
      ),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}DIRECTION_CONTRADICTION`)
  })
})

// ─────────────────────────── cell formatting helpers ────────────────────────

describe('cell formatting (threeLineTableCellText)', () => {
  const col = (overrides: Partial<ThreeLineTableColumn> = {}): ThreeLineTableColumn => ({
    header: 'H',
    ...overrides,
  })

  it('formats every structured cell kind and the unified missing token', () => {
    expect(threeLineTableCellText({ kind: 'missing' }, col(), '–')).toBe('–')
    expect(threeLineTableCellText({ kind: 'text', text: 'name' }, col(), '–')).toBe('name')
    expect(threeLineTableCellText({ kind: 'formatted', text: '<0.001' }, col(), '–')).toBe('<0.001')
    expect(threeLineTableCellText({ kind: 'number', value: 1.234 }, col({ decimals: 2 }), '–')).toBe(
      '1.23',
    )
    expect(
      threeLineTableCellText({ kind: 'meanSd', mean: 1.2, sd: 0.3 }, col({ decimals: 1 }), '–'),
    ).toBe('1.2 ± 0.3')
    expect(
      threeLineTableCellText(
        { kind: 'meanSdParen', mean: 1.2, sd: 0.3 },
        col({ decimals: 1 }),
        '–',
      ),
    ).toBe('1.2 (0.3)')
    expect(
      threeLineTableCellText({ kind: 'ci', lo: 1.1, hi: 1.9 }, col({ decimals: 1 }), '–'),
    ).toBe('1.1–1.9')
    expect(
      threeLineTableCellText(
        { kind: 'ci', lo: 1.1, hi: 1.9, point: 1.5 },
        col({ decimals: 1 }),
        '–',
      ),
    ).toBe('1.5 (1.1–1.9)')
    expect(
      threeLineTableCellText({ kind: 'pValue', value: 0.032, stars: 1 }, col({ decimals: 3 }), '–'),
    ).toBe('0.032*')
    expect(
      threeLineTableCellText({ kind: 'pValue', value: 0.032 }, col({ decimals: 3 }), '–'),
    ).toBe('0.032')
  })

  it('honours the precision rule (fixed pads, significant trims) and integer decimals', () => {
    expect(
      threeLineTableCellText(
        { kind: 'number', value: 1.2 },
        col({ decimals: 2, precisionRule: 'fixed' }),
        '–',
      ),
    ).toBe('1.20')
    expect(
      threeLineTableCellText(
        { kind: 'number', value: 1.2 },
        col({ decimals: 2, precisionRule: 'significant' }),
        '–',
      ),
    ).toBe('1.2')
    expect(
      threeLineTableCellText({ kind: 'number', value: 12 }, col({ decimals: 0 }), '–'),
    ).toBe('12')
    expect(
      threeLineTableCellText(
        { kind: 'number', value: 12 },
        col({ decimals: 0, precisionRule: 'significant' }),
        '–',
      ),
    ).toBe('12')
    // Undeclared decimals keep the authored representation verbatim.
    expect(threeLineTableCellText({ kind: 'number', value: 0.125 }, col(), '–')).toBe('0.125')
  })
})

// ─────────────────────── render semantics (both targets) ────────────────────

describe('three-line style in both targets', () => {
  it('markdown has exactly three horizontal rules and no vertical rules', () => {
    const md = run(validModel(), 'markdown', TS).render.text
    const ruleLines = md.split('\n').filter(line => /^─+$/u.test(line))
    expect(ruleLines).toHaveLength(3)
    expect(md).not.toContain('|')
    expect(md).not.toContain('│')
  })

  it('markdown shows the title, the header + units and the footnotes', () => {
    const md = run(validModel(), 'markdown', TS).render.text
    expect(md.startsWith('Synthetic benchmark results\n')).toBe(true)
    expect(md).toContain('BLEU')
    expect(md).toContain('Time (s)')
    expect(md.endsWith('Values are synthetic.')).toBe(true)
  })

  it('latex is a booktabs table with exactly the three rules and no vertical column spec', () => {
    const latex = run(validModel(), 'latex', TS).render.text
    expect(latex).toContain('\\begin{table}')
    expect(latex).toContain('\\caption{Synthetic benchmark results}')
    expect(latex).toContain('\\toprule')
    expect(latex).toContain('\\midrule')
    expect(latex).toContain('\\bottomrule')
    expect(latex.split('\\toprule')).toHaveLength(2)
    expect(latex.split('\\midrule')).toHaveLength(2)
    expect(latex.split('\\bottomrule')).toHaveLength(2)
    expect(latex).toContain('\\begin{tabular}{cccc}')
    expect(latex).not.toContain('\\cline')
    expect(latex).not.toContain('\\cmidrule')
    // Column spec contains only alignment letters (no | vertical rules).
    expect(latex.match(/\\begin\{tabular\}\{[^}]*\}/u)?.[0]).toBe('\\begin{tabular}{cccc}')
    expect(latex).toContain('Time (s)')
    expect(latex).toContain('\\end{table}')
  })

  it('renders p-values, significance stars, CIs and missing cells in both targets', () => {
    const model: ThreeLineTableModel = {
      columns: [
        { header: 'Metric' },
        { header: 'Estimate', decimals: 2 },
        { header: 'p', decimals: 3 },
      ],
      rows: [
        [
          { kind: 'text', text: 'A' },
          { kind: 'ci', lo: 1.1, hi: 1.9 },
          { kind: 'pValue', value: 0.032, stars: 1 },
        ],
        [
          { kind: 'text', text: 'B' },
          { kind: 'ci', lo: 0.9, hi: 1.7, point: 1.3 },
          { kind: 'missing' },
        ],
      ],
    }
    const md = run(model, 'markdown', TS).render.text
    expect(md).toContain('1.10–1.90')
    expect(md).toContain('1.30 (0.90–1.70)')
    expect(md).toContain('0.032*')
    expect(md).toContain('–')
    const latex = run(model, 'latex', TS).render.text
    expect(latex).toContain('1.10--1.90')
    expect(latex).toContain('0.032*')
    expect(latex).toContain('--')
  })

  it('escapes LaTeX-special characters in captions, headers and footnotes', () => {
    const model: ThreeLineTableModel = {
      title: 'cost 100% & {n} _ v1 #1 $x$ ^2 ~ \\ ±–',
      columns: [{ header: 'Name' }, { header: 'Val', decimals: 2 }],
      rows: [
        [
          { kind: 'text', text: 'a & b 100% {c}' },
          { kind: 'number', value: 1.25 },
        ],
      ],
      footnotes: ['note _ 100% #1'],
    }
    const latex = run(model, 'latex', TS).render.text
    expect(latex).toContain('\\%')
    expect(latex).toContain('\\&')
    expect(latex).toContain('\\{')
    expect(latex).toContain('\\}')
    expect(latex).toContain('\\_')
    expect(latex).toContain('\\#')
    expect(latex).toContain('\\$')
    expect(latex).toContain('\\textasciicircum{}')
    expect(latex).toContain('\\textasciitilde{}')
    expect(latex).toContain('\\textbackslash{}')
    expect(latex).toContain('$\\pm$')
    expect(latex).toContain('--')
  })

  it('the exported pure renderers also default the missing token', () => {
    const model: ThreeLineTableModel = {
      columns: [{ header: 'X' }],
      rows: [[{ kind: 'missing' }]],
    }
    expect(renderThreeLineTableMarkdown(model)).toContain(
      THREE_LINE_TABLE_DEFAULT_MISSING_TOKEN,
    )
    expect(renderThreeLineTableLatex(model)).toContain('--')
  })

  it('renders emphasis markers bold in both targets', () => {
    const model: ThreeLineTableModel = {
      columns: [
        { header: 'Model' },
        {
          header: 'BLEU',
          decimals: 1,
          metricDirection: 'higher-is-better',
        },
      ],
      rows: [
        [
          { kind: 'text', text: 'A' },
          { kind: 'number', value: 91.2 },
        ],
        [
          { kind: 'text', text: 'B' },
          { kind: 'number', value: 93.4, emphasis: 'best' },
        ],
      ],
    }
    const md = run(model, 'markdown', TS).render.text
    expect(md).toContain('**93.4**')
    const latex = run(model, 'latex', TS).render.text
    expect(latex).toContain('\\textbf{93.4}')
  })
})

// ─────────────────────────── faithfulness (parsed md) ───────────────────────

describe('faithfulness — parsed Markdown body matches the model exactly', () => {
  it('differs the parsed body tokens against the model cell strings', () => {
    const model = validModel()
    const md = run(model, 'markdown', TS).render.text
    const parsed = markdownBodyTokens(md)
    const expected = expectedBodyCells(model)
    expect(parsed).toEqual(expected)
  })

  it('does not infer, correct or omit anything for missing values', () => {
    const model = validModel()
    const md = run(model, 'markdown', TS).render.text
    const missingCount = model.rows.flat().filter(cell => cell.kind === 'missing').length
    expect(missingCount).toBeGreaterThan(0)
    expect(md.split(THREE_LINE_TABLE_DEFAULT_MISSING_TOKEN).length - 1).toBe(missingCount)
  })

  it('renders formatted raw text verbatim (never re-formats or parses it)', () => {
    const model: ThreeLineTableModel = {
      columns: [{ header: 'V', decimals: 2 }],
      rows: [[{ kind: 'formatted', text: '12.3e4' }]],
    }
    expect(run(model, 'markdown', TS).render.text).toContain('12.3e4')
    expect(run(model, 'latex', TS).render.text).toContain('12.3e4')
  })
})

// ─────────────────── anti-pattern (a) unit mismatch ─────────────────────────

describe('anti-pattern (a) — inconsistent units inside one column', () => {
  const cellsInColumn = (cells: ThreeLineTableCell[]): ThreeLineTableModel => ({
    columns: [{ header: 'Length', unit: 'mm', decimals: 1 }],
    rows: cells.map(cell => [cell]),
  })

  it('throws UNIT_MISMATCH when a cell unit disagrees with the column unit', () => {
    const model = cellsInColumn([{ kind: 'number', value: 1.2, unit: 'cm' }])
    expect(codeOf(() => run(model, 'markdown', TS))).toBe(
      `${THREE_LINE_TABLE_ERROR_PREFIX}UNIT_MISMATCH`,
    )
  })

  it('throws UNIT_MISMATCH when a cell declares a unit but the column has none', () => {
    const model: ThreeLineTableModel = {
      columns: [{ header: 'Length', decimals: 1 }],
      rows: [[{ kind: 'number', value: 1.2, unit: 'mm' }]],
    }
    expect(codeOf(() => run(model, 'markdown', TS))).toBe(
      `${THREE_LINE_TABLE_ERROR_PREFIX}UNIT_MISMATCH`,
    )
  })

  it('accepts a consistent per-cell unit matching the column unit', () => {
    const model = cellsInColumn([
      { kind: 'number', value: 1.2, unit: 'mm' },
      { kind: 'number', value: 2.3, unit: 'mm' },
    ])
    expect(errorCodeOf(() => run(model, 'markdown', TS))).toBeUndefined()
  })
})

// ───────────────── anti-pattern (b) direction / emphasis ────────────────────

describe('anti-pattern (b) — lower-is-better column emphasised as if best', () => {
  const rmseModel = (emphasis: 'best' | undefined): ThreeLineTableModel => ({
    columns: [
      { header: 'Model' },
      { header: 'RMSE', decimals: 2, metricDirection: 'lower-is-better' },
    ],
    rows: [
      [{ kind: 'text', text: 'A' }, { kind: 'number', value: 0.31 }],
      [{ kind: 'text', text: 'B' }, { kind: 'number', value: 0.28 }],
      [
        { kind: 'text', text: 'C' },
        ...(emphasis === undefined
          ? [{ kind: 'number' as const, value: 0.39 }]
          : [{ kind: 'number' as const, value: 0.39, emphasis }]),
      ],
    ],
  })

  it('throws DIRECTION_CONTRADICTION when the emphasised cell is the max of a lower-is-better column', () => {
    expect(codeOf(() => run(rmseModel('best'), 'markdown', TS))).toBe(
      `${THREE_LINE_TABLE_ERROR_PREFIX}DIRECTION_CONTRADICTION`,
    )
  })

  it('accepts emphasis on the actual minimum of a lower-is-better column', () => {
    const model: ThreeLineTableModel = {
      columns: [
        { header: 'Model' },
        { header: 'RMSE', decimals: 2, metricDirection: 'lower-is-better' },
      ],
      rows: [
        [{ kind: 'text', text: 'A' }, { kind: 'number', value: 0.31 }],
        [{ kind: 'text', text: 'B' }, { kind: 'number', value: 0.28, emphasis: 'best' }],
      ],
    }
    expect(errorCodeOf(() => run(model, 'markdown', TS))).toBeUndefined()
  })

  it('throws DIRECTION_CONTRADICTION when emphasis exists but no metricDirection is declared', () => {
    const model: ThreeLineTableModel = {
      columns: [{ header: 'RMSE', decimals: 2 }],
      rows: [[{ kind: 'number', value: 0.28, emphasis: 'best' }]],
    }
    expect(codeOf(() => run(model, 'markdown', TS))).toBe(
      `${THREE_LINE_TABLE_ERROR_PREFIX}DIRECTION_CONTRADICTION`,
    )
  })
})

// ─────────────── anti-pattern (c) p-value / significance stars ──────────────

describe('anti-pattern (c) — significance stars contradicting the p-value', () => {
  const pColumn = (stars: number): ThreeLineTableModel => ({
    columns: [{ header: 'p', decimals: 3 }],
    rows: [[{ kind: 'pValue', value: 0.032, stars }]],
  })

  it('throws STAR_PVALUE_MISMATCH when 2 stars adorn p = 0.032', () => {
    expect(codeOf(() => run(pColumn(2), 'markdown', TS))).toBe(
      `${THREE_LINE_TABLE_ERROR_PREFIX}STAR_PVALUE_MISMATCH`,
    )
  })

  it('throws STAR_PVALUE_MISMATCH when 3 stars adorn p = 0.002 (not < 0.001)', () => {
    const model: ThreeLineTableModel = {
      columns: [{ header: 'p', decimals: 4 }],
      rows: [[{ kind: 'pValue', value: 0.002, stars: 3 }]],
    }
    expect(codeOf(() => run(model, 'markdown', TS))).toBe(
      `${THREE_LINE_TABLE_ERROR_PREFIX}STAR_PVALUE_MISMATCH`,
    )
  })

  it('accepts stars the p-value supports and rejects a custom tight policy', () => {
    const ok: ThreeLineTableModel = {
      columns: [{ header: 'p', decimals: 4 }],
      rows: [[{ kind: 'pValue', value: 0.0002, stars: 3 }]],
    }
    expect(errorCodeOf(() => run(ok, 'markdown', TS))).toBeUndefined()

    const tight: ThreeLineTableModel = {
      columns: [{ header: 'p', decimals: 4 }],
      significance: { pLessThan: [0.01, 0.001] },
      rows: [[{ kind: 'pValue', value: 0.02, stars: 1 }]],
    }
    // 0.02 only clears 0.01 in the tighter policy -> 1 star is unsupported.
    expect(codeOf(() => run(tight, 'markdown', TS))).toBe(
      `${THREE_LINE_TABLE_ERROR_PREFIX}STAR_PVALUE_MISMATCH`,
    )
  })
})

// ─────────────── anti-pattern (d) percent / raw fraction mix ────────────────

describe('anti-pattern (d) — percentages and raw decimals mixed in one column', () => {
  it('throws PERCENT_DECIMAL_MIX when cells disagree on scale', () => {
    const model: ThreeLineTableModel = {
      columns: [{ header: 'Acc', decimals: 2 }],
      rows: [
        [{ kind: 'number', value: 85, scale: 'percent' }],
        [{ kind: 'number', value: 0.85, scale: 'fraction' }],
      ],
    }
    expect(codeOf(() => run(model, 'markdown', TS))).toBe(
      `${THREE_LINE_TABLE_ERROR_PREFIX}PERCENT_DECIMAL_MIX`,
    )
  })

  it('throws PERCENT_DECIMAL_MIX when a cell overrides a declared column scale', () => {
    const model: ThreeLineTableModel = {
      columns: [{ header: 'Acc', decimals: 2, scale: 'percent' }],
      rows: [[{ kind: 'number', value: 85, scale: 'fraction' }]],
    }
    expect(codeOf(() => run(model, 'markdown', TS))).toBe(
      `${THREE_LINE_TABLE_ERROR_PREFIX}PERCENT_DECIMAL_MIX`,
    )
  })

  it('accepts a uniform percent-scaled column', () => {
    const model: ThreeLineTableModel = {
      columns: [{ header: 'Acc', decimals: 1, scale: 'percent' }],
      rows: [
        [{ kind: 'number', value: 91.2 }],
        [{ kind: 'number', value: 93.4 }],
      ],
    }
    expect(errorCodeOf(() => run(model, 'markdown', TS))).toBeUndefined()
  })
})

// ─────────────────── anti-pattern (e) chaotic decimal places ────────────────

describe('anti-pattern (e) — chaotic decimal places inside one column', () => {
  it('throws DECIMAL_CHAOS when a value exceeds the declared decimals', () => {
    const model: ThreeLineTableModel = {
      columns: [{ header: 'Score', decimals: 2 }],
      rows: [[{ kind: 'number', value: 1.234 }]],
    }
    expect(codeOf(() => run(model, 'markdown', TS))).toBe(
      `${THREE_LINE_TABLE_ERROR_PREFIX}DECIMAL_CHAOS`,
    )
  })

  it('throws DECIMAL_CHAOS when mean and sd differ in precision without a column rule', () => {
    const model: ThreeLineTableModel = {
      columns: [{ header: 'Score' }],
      rows: [[{ kind: 'meanSd', mean: 1.23, sd: 0.1 }]],
    }
    expect(codeOf(() => run(model, 'markdown', TS))).toBe(
      `${THREE_LINE_TABLE_ERROR_PREFIX}DECIMAL_CHAOS`,
    )
  })

  it('throws DECIMAL_CHAOS for a column with no declared rule and ragged values', () => {
    const model: ThreeLineTableModel = {
      columns: [{ header: 'F1' }],
      rows: [
        [{ kind: 'number', value: 0.85 }],
        [{ kind: 'number', value: 0.9 }],
      ],
    }
    expect(codeOf(() => run(model, 'markdown', TS))).toBe(
      `${THREE_LINE_TABLE_ERROR_PREFIX}DECIMAL_CHAOS`,
    )
  })

  it('accepts a uniform-precision column without a declared rule', () => {
    const model: ThreeLineTableModel = {
      columns: [{ header: 'F1' }],
      rows: [
        [{ kind: 'number', value: 0.85 }],
        [{ kind: 'number', value: 0.91 }],
      ],
    }
    expect(errorCodeOf(() => run(model, 'markdown', TS))).toBeUndefined()
  })

  it('accepts values expressed at or below the declared column decimals', () => {
    const model: ThreeLineTableModel = {
      columns: [{ header: 'Time', decimals: 2, precisionRule: 'significant' }],
      rows: [[{ kind: 'number', value: 1.2 }]],
    }
    expect(errorCodeOf(() => run(model, 'markdown', TS))).toBeUndefined()
    expect(run(model, 'markdown', TS).render.text).toContain('1.2')
  })
})

// ─────────────────── anti-pattern (f) snapshot contradiction ────────────────

describe('anti-pattern (f) — table value contradicting the bound data snapshot', () => {
  const meanSdModel = (): ThreeLineTableModel => ({
    columns: [
      { header: 'Model' },
      { header: 'Score', decimals: 3 },
    ],
    rows: [
      [{ kind: 'text', text: 'A' }, { kind: 'number', value: 0.893 }],
      [{ kind: 'text', text: 'B' }, { kind: 'meanSd', mean: 0.78, sd: 0.1 }],
    ],
    dataSnapshot: {
      source: 'synth-bind',
      values: [
        { rowIndex: 0, columnIndex: 1, part: 'value', recorded: 0.893 },
        { rowIndex: 1, columnIndex: 1, part: 'mean', recorded: 0.78 },
        { rowIndex: 1, columnIndex: 1, part: 'sd', recorded: 0.1 },
      ],
    },
  })

  it('accepts a model whose values agree with the bound snapshot', () => {
    expect(errorCodeOf(() => run(meanSdModel(), 'markdown', TS))).toBeUndefined()
  })

  it('throws SNAPSHOT_CONTRADICTION when the table result contradicts the snapshot', () => {
    const model: ThreeLineTableModel = {
      ...meanSdModel(),
      dataSnapshot: {
        source: 'synth-bind',
        values: [{ rowIndex: 0, columnIndex: 1, part: 'value', recorded: 0.782 }],
      },
    }
    expect(codeOf(() => run(model, 'markdown', TS))).toBe(
      `${THREE_LINE_TABLE_ERROR_PREFIX}SNAPSHOT_CONTRADICTION`,
    )
  })

  it('throws INVALID_SNAPSHOT for malformed / unsupported snapshot entries', () => {
    const base = meanSdModel()
    const badEntries: Array<Record<string, unknown>> = [
      { rowIndex: 99, columnIndex: 1, part: 'value', recorded: 1 },
      { rowIndex: 0, columnIndex: 9, part: 'value', recorded: 1 },
      { rowIndex: 0, columnIndex: 1, part: 'sd', recorded: 0.1 }, // number cell has no sd
      { rowIndex: 0, columnIndex: -1, part: 'value', recorded: 1 },
    ]
    for (const entry of badEntries) {
      const model: ThreeLineTableModel = {
        ...base,
        dataSnapshot: { values: [entry as never] },
      }
      expect(codeOf(() => run(model, 'markdown', TS)), JSON.stringify(entry)).toBe(
        `${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_SNAPSHOT`,
      )
    }
  })

  it('throws INVALID_SNAPSHOT for a malformed snapshot container', () => {
    const model: ThreeLineTableModel = {
      ...meanSdModel(),
      dataSnapshot: { values: 'nope' as never },
    }
    expect(codeOf(() => run(model, 'markdown', TS))).toBe(
      `${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_SNAPSHOT`,
    )
  })
})

// ─────────────── markdown export renderer + layout edge paths ───────────────

describe('markdown layout paths', () => {
  it('produces exactly three rules even when a wide merged group forces column growth', () => {
    const model: ThreeLineTableModel = {
      columns: [
        { header: 'A', decimals: 1 },
        { header: 'B', decimals: 1 },
      ],
      groupedHeaders: [[{ label: 'A very wide group label that forces extra width', span: 2 }]],
      rows: [
        [
          { kind: 'number', value: 1.1 },
          { kind: 'number', value: 2.2 },
        ],
      ],
    }
    const md = renderThreeLineTableMarkdown(model)
    expect(md).toContain('A very wide group label that forces extra width')
    const ruleLines = md.split('\n').filter(line => /^─+$/u.test(line))
    expect(ruleLines).toHaveLength(3)
    expect(md).not.toContain('|')
  })

  it('renders footnotes only when present', () => {
    const withNotes = renderThreeLineTableMarkdown(validModel())
    expect(withNotes.endsWith('Values are synthetic.')).toBe(true)
    const withoutNotes = renderThreeLineTableMarkdown(without(validModel(), 'footnotes'))
    expect(withoutNotes.endsWith('─')).toBe(true)
  })

  it('renders without a title when the title is absent', () => {
    const model = without(validModel(), 'title')
    const md = renderThreeLineTableMarkdown(model)
    expect(md.startsWith('─')).toBe(true)
    const latex = renderThreeLineTableLatex(model)
    expect(latex).not.toContain('\\caption')
  })
})

// ───────────── coverage completion: boundary and defensive branches ─────────

describe('coverage completion — boundary branches', () => {
  const singleNumeric = (
    column: ThreeLineTableColumn,
    cells: ThreeLineTableCell[],
  ): ThreeLineTableModel => ({
    columns: [column],
    rows: cells.map(cell => [cell]),
  })

  it('measures decimal places of exponent-notation values', () => {
    const model = singleNumeric({ header: 'Tiny', decimals: 8 }, [
      { kind: 'number', value: 1e-7 },
      { kind: 'number', value: 1.5e-7 },
    ])
    const md = run(model, 'markdown', TS).render.text
    expect(md).toContain('0.00000010')
    expect(md).toContain('0.00000015')
  })

  it('formats integral values under a declared 0-decimals column', () => {
    const model = singleNumeric({ header: 'Count', decimals: 0 }, [
      { kind: 'number', value: 12 },
      { kind: 'number', value: 7 },
    ])
    const md = run(model, 'markdown', TS).render.text
    expect(md).toContain('12')
    expect(md).toContain('7')
  })

  it('trims a trailing decimal point under significant precision', () => {
    const model = singleNumeric(
      { header: 'Rounded', decimals: 1, precisionRule: 'significant' },
      [{ kind: 'number', value: 1 }],
    )
    expect(run(model, 'markdown', TS).render.text).toContain('1')
  })

  it('rejects a non-object significance policy', () => {
    expect(
      codeOf(() => run({ ...validModel(), significance: 'x' as never }, 'markdown', TS)),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_MODEL`)
  })

  it('accepts p-value cells without stars or with zero stars', () => {
    const model = singleNumeric({ header: 'p', decimals: 3 }, [
      { kind: 'pValue', value: 0.9 },
      { kind: 'pValue', value: 0.032, stars: 0 },
    ])
    const md = run(model, 'markdown', TS).render.text
    expect(md).toContain('0.900')
    expect(md).toContain('0.032')
  })

  it('throws STAR_PVALUE_MISMATCH for invalid star counts', () => {
    for (const stars of [-1, 1.5]) {
      const model = singleNumeric({ header: 'p', decimals: 3 }, [
        { kind: 'pValue', value: 0.032, stars },
      ])
      expect(codeOf(() => run(model, 'markdown', TS)), String(stars)).toBe(
        `${THREE_LINE_TABLE_ERROR_PREFIX}STAR_PVALUE_MISMATCH`,
      )
    }
  })

  it('materializes a custom significance policy that passes', () => {
    const artifact = run(
      {
        columns: [{ header: 'p', decimals: 4 }],
        rows: [[{ kind: 'pValue', value: 0.0002, stars: 1 }]],
        significance: { pLessThan: [0.001] },
      },
      'markdown',
      TS,
    )
    expect(artifact.table.significance).toEqual({ pLessThan: [0.001] })
  })

  it('computes best across every numeric cell kind in a directional column', () => {
    const model: ThreeLineTableModel = {
      columns: [{ header: 'Score', decimals: 1, metricDirection: 'higher-is-better' }],
      rows: [
        [{ kind: 'number', value: 90.5 }],
        [{ kind: 'meanSd', mean: 91.5, sd: 0.5 }],
        [{ kind: 'meanSdParen', mean: 92.5, sd: 0.4 }],
        [{ kind: 'ci', lo: 92.0, hi: 93.0 }],
        [{ kind: 'ci', lo: 94.0, hi: 95.0, point: 96.0, emphasis: 'best' }],
        [{ kind: 'pValue', value: 0.9 }],
        [{ kind: 'missing' }],
        [{ kind: 'text', text: 'dash' }],
        [{ kind: 'formatted', text: '<0.01' }],
      ],
    }
    const md = run(model, 'markdown', TS).render.text
    expect(md).toContain('**96.0 (94.0–95.0)**')
  })

  it('rejects non-array and empty grouped-header rows', () => {
    const base: ThreeLineTableModel = {
      columns: [{ header: 'Model' }, { header: 'Score', decimals: 1 }],
      rows: [[{ kind: 'text', text: 'A' }, { kind: 'number', value: 1.2 }]],
    }
    expect(
      codeOf(() => run({ ...base, groupedHeaders: ['nope' as never] }, 'markdown', TS)),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_MODEL`)
    expect(
      codeOf(() => run({ ...base, groupedHeaders: [[]] }, 'markdown', TS)),
    ).toBe(`${THREE_LINE_TABLE_ERROR_PREFIX}EMPTY_HEADER`)
  })
})

describe('coverage completion — data snapshot numeric parts', () => {
  const numericMatrix = (): ThreeLineTableModel => ({
    columns: [{ header: 'Model' }, { header: 'Score', decimals: 3 }],
    rows: [
      [{ kind: 'text', text: 'n' }, { kind: 'number', value: 0.893 }],
      [{ kind: 'text', text: 'p' }, { kind: 'pValue', value: 0.032, stars: 1 }],
      [{ kind: 'text', text: 'ms' }, { kind: 'meanSd', mean: 0.78, sd: 0.1 }],
      [{ kind: 'text', text: 'msp' }, { kind: 'meanSdParen', mean: 0.5, sd: 0.05 }],
      [{ kind: 'text', text: 'ci' }, { kind: 'ci', lo: 1.1, hi: 1.9 }],
      [{ kind: 'text', text: 'cip' }, { kind: 'ci', lo: 2.1, hi: 2.7, point: 2.4 }],
    ],
  })

  it('accepts a bound snapshot covering every numeric part', () => {
    const model: ThreeLineTableModel = {
      ...numericMatrix(),
      dataSnapshot: {
        source: 'synth-matrix',
        values: [
          { rowIndex: 0, columnIndex: 1, part: 'value', recorded: 0.893 },
          { rowIndex: 1, columnIndex: 1, part: 'value', recorded: 0.032 },
          { rowIndex: 2, columnIndex: 1, part: 'mean', recorded: 0.78 },
          { rowIndex: 2, columnIndex: 1, part: 'sd', recorded: 0.1 },
          { rowIndex: 3, columnIndex: 1, part: 'mean', recorded: 0.5 },
          { rowIndex: 3, columnIndex: 1, part: 'sd', recorded: 0.05 },
          { rowIndex: 4, columnIndex: 1, part: 'lo', recorded: 1.1 },
          { rowIndex: 4, columnIndex: 1, part: 'hi', recorded: 1.9 },
          { rowIndex: 5, columnIndex: 1, part: 'lo', recorded: 2.1 },
          { rowIndex: 5, columnIndex: 1, part: 'hi', recorded: 2.7 },
          { rowIndex: 5, columnIndex: 1, part: 'point', recorded: 2.4 },
        ],
      },
    }
    expect(errorCodeOf(() => run(model, 'markdown', TS))).toBeUndefined()
  })

  it('throws SNAPSHOT_CONTRADICTION for ci point and mean parts', () => {
    const base = numericMatrix()
    for (const entry of [
      { rowIndex: 5, columnIndex: 1, part: 'point', recorded: 9.9 },
      { rowIndex: 2, columnIndex: 1, part: 'mean', recorded: 0.99 },
    ]) {
      const model: ThreeLineTableModel = { ...base, dataSnapshot: { values: [entry as never] } }
      expect(codeOf(() => run(model, 'markdown', TS)), JSON.stringify(entry)).toBe(
        `${THREE_LINE_TABLE_ERROR_PREFIX}SNAPSHOT_CONTRADICTION`,
      )
    }
  })

  it('throws INVALID_SNAPSHOT for malformed entry shapes and values', () => {
    const base = numericMatrix()
    const entries: unknown[] = [
      null,
      { rowIndex: -1, columnIndex: 1, part: 'value', recorded: 1 },
      { rowIndex: 0.5, columnIndex: 1, part: 'value', recorded: 1 },
      { rowIndex: 'x', columnIndex: 1, part: 'value', recorded: 1 },
      { rowIndex: 0, columnIndex: 1, part: 'bogus', recorded: 1 },
      { rowIndex: 0, columnIndex: 1, part: 'value', recorded: Number.NaN },
      { rowIndex: 0, columnIndex: 1, part: 'value', recorded: Number.POSITIVE_INFINITY },
      { rowIndex: 4, columnIndex: 1, part: 'point', recorded: 0.1 },
      { rowIndex: 0, columnIndex: 0, part: 'value', recorded: 1 },
      // Part/kind mismatches: the addressed cell simply does not carry the part.
      { rowIndex: 2, columnIndex: 1, part: 'value', recorded: 0.78 },
      { rowIndex: 0, columnIndex: 1, part: 'mean', recorded: 0.893 },
      { rowIndex: 4, columnIndex: 1, part: 'mean', recorded: 1.1 },
      { rowIndex: 0, columnIndex: 1, part: 'sd', recorded: 0.893 },
      { rowIndex: 5, columnIndex: 1, part: 'sd', recorded: 2.4 },
      { rowIndex: 0, columnIndex: 1, part: 'lo', recorded: 0.893 },
      { rowIndex: 2, columnIndex: 1, part: 'lo', recorded: 0.78 },
      { rowIndex: 3, columnIndex: 1, part: 'hi', recorded: 0.5 },
      { rowIndex: 2, columnIndex: 1, part: 'point', recorded: 0.78 },
    ]
    for (const entry of entries) {
      const model: ThreeLineTableModel = { ...base, dataSnapshot: { values: [entry as never] } }
      expect(codeOf(() => run(model, 'markdown', TS)), JSON.stringify(entry)).toBe(
        `${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_SNAPSHOT`,
      )
    }
  })

  it('rejects snapshot entries that address merged-cell interiors', () => {
    const merged: ThreeLineTableModel = {
      columns: [{ header: 'A' }, { header: 'B' }],
      rows: [[{ kind: 'text', text: 'across both columns', colSpan: 2 }]],
    }
    const inside: ThreeLineTableModel = {
      ...merged,
      dataSnapshot: { values: [{ rowIndex: 0, columnIndex: 1, part: 'value', recorded: 1 }] },
    }
    expect(codeOf(() => run(inside, 'markdown', TS))).toBe(
      `${THREE_LINE_TABLE_ERROR_PREFIX}INVALID_SNAPSHOT`,
    )
  })
})
