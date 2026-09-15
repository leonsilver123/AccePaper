/**
 * The paper layer's renderers, pinned on the shapes a reader of the exported manuscript depends on.
 *
 * The cases that matter are the ones a plausible implementation gets wrong: a cell containing the
 * pipe that ends a Markdown cell, a row whose width disagrees with its header, tables and figures
 * that must not share a counter, and a reference to `Figure 1` that must not be satisfied by
 * `Figure 10`. Each was a real possibility in the code that produced the exported package this
 * module replaces.
 */

import { describe, expect, it } from 'vitest'

import {
  citedFloats,
  equationBlock,
  figureBlock,
  formatReference,
  markdownPipeTable,
  numberFloats,
  numberedReferences,
  tableBlock,
} from '../src/runner/paper-format.ts'

describe('the paper formatting layer', () => {
  it('renders a real Markdown pipe table, not the tool box-drawing one', () => {
    const table = markdownPipeTable(
      ['Method', 'Minimum TTC (s)'],
      [
        ['HV-AV-HV', '12.45'],
        ['HV-HV-HV', '19.58'],
      ],
    )
    expect(table).toBe(
      '| Method | Minimum TTC (s) |\n| --- | --- |\n| HV-AV-HV | 12.45 |\n| HV-HV-HV | 19.58 |\n',
    )
    // The box-drawing rendering the pipeline used to emit renders as a code block, not a table.
    expect(table).not.toContain('─')
  })

  it('escapes a pipe inside a cell so the table keeps its column count', () => {
    const table = markdownPipeTable(['Metric', 'Note'], [['TTC', 'a | b']])
    expect(table.split('\n')[2]).toBe('| TTC | a \\| b |')
    // What matters is that the pipe is ESCAPED: a Markdown renderer reads `\|` as cell content,
    // while the raw sequence would end the cell and shift every later column. Counting pipes would
    // not show this — the escaped form still contains one character.
    expect(table).toContain('a \\| b')
    expect(table).not.toContain('| a | b |')
  })

  it('refuses a row whose width disagrees with the header', () => {
    expect(() => markdownPipeTable(['a', 'b'], [['only-one']])).toThrow(
      /1 cell\(s\) against 2 column\(s\)/,
    )
    expect(() => markdownPipeTable([], [])).toThrow(/no columns/)
  })

  it('renders a figure under the label the plan assigned, and links the exported file', () => {
    const block = figureBlock({
      label: 'Figure 1',
      title: 'Platoon minimum TTC by composition',
      path: 'figures/figure-1.svg',
    })
    expect(block).toBe(
      '![Figure 1: Platoon minimum TTC by composition](figures/figure-1.svg)\n\n' +
        '**Figure 1.** Platoon minimum TTC by composition',
    )
  })

  it('renders an inline diagram as a mermaid figure, and refuses a figure that is both or neither', () => {
    const roadmap = figureBlock({
      label: 'Figure 2',
      title: 'Research roadmap',
      mermaid: 'flowchart LR\n  a --> b',
    })
    expect(roadmap).toContain('```mermaid\nflowchart LR\n  a --> b\n```')
    expect(roadmap).toContain('**Figure 2.** Research roadmap')
    // A figure is a file or a diagram; without that rule a caller that omits the path renders
    // `![Figure 3: t](undefined)`, which is a broken image that looks like a real one.
    expect(() => figureBlock({ label: 'Figure 3', title: 't' })).toThrow(/exactly one of/)
    expect(() =>
      figureBlock({ label: 'Figure 3', title: 't', path: 'a.svg', mermaid: 'flowchart LR' }),
    ).toThrow(/exactly one of/)
  })

  it('renders a table under its label, with the caption above it where a reader looks for it', () => {
    const block = tableBlock({
      label: 'Table 2',
      title: 'Results',
      markdown: '| a |\n| --- |\n| 1 |\n',
    })
    expect(block).toBe('**Table 2.** Results\n\n| a |\n| --- |\n| 1 |')
  })

  it('numbers equations and names each one', () => {
    const block = equationBlock([
      {
        name: 'IDM acceleration',
        latex: '\\dot{v} = a\\left[1 - (v/v_0)^\\delta\\right]',
      },
    ])
    expect(block).toContain('**Equation 1 — IDM acceleration**')
    expect(block).toContain('$$\n\\dot{v}')
    // No equation means no block, not an empty numbered heading.
    expect(equationBlock([])).toBe('')
  })

  it("numbers a plan's floats: figures and tables number independently, in plan order", () => {
    const floats = numberFloats([
      { kind: 'data-figure', title: 'Platoon minimum TTC by composition' },
      { kind: 'three-line-table', title: 'Platoon Minimum Time-to-Collision Comparison' },
      { kind: 'roadmap', title: 'Research roadmap' },
    ])
    expect(floats.map(float => float.label)).toEqual(['Figure 1', 'Table 1', 'Figure 2'])
    expect(floats[1]?.title).toBe('Platoon Minimum Time-to-Collision Comparison')
    // A kind this manuscript does not number would render a caption nothing can refer to.
    expect(() => numberFloats([{ kind: 'photograph', title: 't' }])).toThrow(
      /not a kind this manuscript numbers/,
    )
  })

  it('reports which numbered items the prose names, and which it leaves unmentioned', () => {
    const floats = [
      { label: 'Figure 1', title: 'Measured comparison' },
      { label: 'Table 1', title: 'Results' },
      { label: 'Equation 1', title: 'IDM acceleration' },
    ]
    const report = citedFloats('Table 1 reports the change; see Equation 1.', floats)
    expect(report.cited).toEqual(['Table 1', 'Equation 1'])
    expect(report.uncited).toEqual(['Figure 1'])
    // `Figure 1` inside `Figure 10` names a different float: a prefix match would report an
    // uncited figure as cited.
    expect(citedFloats('as Figure 10 shows', [floats[0]!]).uncited).toEqual(['Figure 1'])
  })

  it('numbers references so an in-text marker can mean something', () => {
    expect(numberedReferences(['A. One. Venue.', 'B. Two. Venue.'])).toEqual([
      '[1] A. One. Venue.',
      '[2] B. Two. Venue.',
    ])
  })

  it('formats a reference from its fields, and says so when a field is absent', () => {
    expect(
      formatReference({
        authors: ['I. Imagined'],
        title: 'Synthetic fault analysis',
        venue: 'Synthetic Conference B',
        identifier: 'doi:10.1000/x',
      }),
    ).toBe(
      'I. Imagined. Synthetic fault analysis. Synthetic Conference B. doi:10.1000/x',
    )
    // A record with no author says "Unknown author" rather than dropping the field and reading complete.
    expect(formatReference({ title: 'T' })).toBe('Unknown author. T.')
  })
})
