/**
 * E1-format manuscript assembly.
 *
 * These tests do not check that a template was filled in. They check the two things
 * the step is answerable for: that the assembled Markdown carries every part in the
 * order the parts were given, and that assembly REFUSES an input that is not a
 * manuscript (blank title, no sections, a blank section field, a duplicate section
 * id, a blank figure or reference entry). The refusal cases are load-bearing: a
 * formatter that accepts a shell produces a document that looks submittable and
 * states nothing, which is the failure this module exists to prevent.
 */

import { describe, expect, it } from 'vitest'
import { assembleManuscript } from '../src/runner/manuscript.ts'
import type { ManuscriptInput, ManuscriptSection } from '../src/runner/manuscript.ts'

function section(id: string, heading: string, bodyText: string): ManuscriptSection {
  return { id, heading, bodyText }
}

const SECTIONS: ReadonlyArray<ManuscriptSection> = [
  section('abstract', 'Abstract', 'We compare adaptive control against a fixed-time baseline.'),
  section('results', 'Results', 'Peak-hour delay fell by 9.1% in the simulation.'),
]

const FIGURES: ReadonlyArray<string> = [
  '![Figure 1](figures/figure-1.svg)\n\nSynthetic delay comparison.',
]

const REFERENCES: ReadonlyArray<string> = ['[1] S. Smith. Adaptive Signal Control. 2020.']

/** A complete manuscript input; `overrides` replace one part at a time. */
function input(overrides: Partial<ManuscriptInput> = {}): ManuscriptInput {
  return {
    title: 'Adaptive Signal Control Reduces Peak-Hour Delay',
    sections: SECTIONS,
    figures: FIGURES,
    references: REFERENCES,
    ...overrides,
  }
}

/** Assert that `run` fails with exactly the given stable error code. */
function expectCode(run: () => unknown, code: string): void {
  expect(run).toThrowError(new RegExp(`^\\[${code}\\] `))
}

/** The full document one complete input must assemble to. */
const EXPECTED_MARKDOWN = `# Adaptive Signal Control Reduces Peak-Hour Delay

## Abstract

We compare adaptive control against a fixed-time baseline.

## Results

Peak-hour delay fell by 9.1% in the simulation.

## Figures

![Figure 1](figures/figure-1.svg)

Synthetic delay comparison.

## References

[1] S. Smith. Adaptive Signal Control. 2020.
`

describe('E1-format manuscript assembly', () => {
  it('assembles title, sections, figures and references into one document', () => {
    expect(assembleManuscript(input()).markdown).toBe(EXPECTED_MARKDOWN)
  })

  it('reports counts computed from the arrays it assembled', () => {
    const result = assembleManuscript(input())

    expect(result.sectionCount).toBe(SECTIONS.length)
    expect(result.figureCount).toBe(FIGURES.length)
    expect(result.referenceCount).toBe(REFERENCES.length)
  })

  it('ignores counts supplied by the caller', () => {
    // The counts are the module's own claim about what it rendered; an input that
    // carries its own numbers must not be able to overstate the assembled document.
    const tampered = { ...input(), sectionCount: 99, figureCount: 99, referenceCount: 99 }
    const result = assembleManuscript(tampered as unknown as ManuscriptInput)

    expect(result.sectionCount).toBe(SECTIONS.length)
    expect(result.figureCount).toBe(FIGURES.length)
    expect(result.referenceCount).toBe(REFERENCES.length)
  })

  it('keeps the caller’s section order, with figures then references last', () => {
    const { markdown } = assembleManuscript(input())
    const positions = ['## Abstract', '## Results', '## Figures', '## References'].map(heading =>
      markdown.indexOf(heading),
    )

    for (const position of positions) expect(position).toBeGreaterThan(-1)
    const sorted = [...positions].sort((a, b) => a - b)
    expect(positions).toEqual(sorted)
  })

  it('trims outer whitespace but keeps line breaks inside a section body', () => {
    const { markdown } = assembleManuscript(
      input({
        sections: [section('results', '  Results  ', '  first line\n\nsecond line  ')],
        figures: [],
        references: [],
      }),
    )

    expect(markdown).toContain('## Results\n\nfirst line\n\nsecond line')
    expect(markdown).not.toContain('  Results')
  })

  it('states a one-line audit basis naming what was assembled', () => {
    const { basis } = assembleManuscript(input())

    expect(basis).not.toContain('\n')
    expect(basis).toContain('2 section(s)')
    expect(basis).toContain('1 figure(s)')
    expect(basis).toContain('1 reference(s)')
  })

  it('omits the Figures and References sections when both lists are empty', () => {
    const result = assembleManuscript(input({ figures: [], references: [] }))

    expect(result.figureCount).toBe(0)
    expect(result.referenceCount).toBe(0)
    expect(result.markdown).not.toContain('## Figures')
    expect(result.markdown).not.toContain('## References')
  })

  it('emits only the non-empty trailing section', () => {
    const withFigures = assembleManuscript(input({ references: [] }))
    const withReferences = assembleManuscript(input({ figures: [] }))

    expect(withFigures.markdown).toContain('## Figures')
    expect(withFigures.markdown).not.toContain('## References')
    expect(withReferences.markdown).toContain('## References')
    expect(withReferences.markdown).not.toContain('## Figures')
  })

  it('returns a frozen record that cannot be edited after assembly', () => {
    const result = assembleManuscript(input())

    expect(Object.isFrozen(result)).toBe(true)
    expect(Reflect.set(result, 'markdown', 'tampered')).toBe(false)
    expect(() => {
      (result as { markdown: string }).markdown = 'tampered'
    }).toThrow(TypeError)
    expect(result.markdown).toBe(EXPECTED_MARKDOWN)
  })

  it('returns a fresh record per call and leaves its input untouched', () => {
    const source = input()
    Object.freeze(source.sections)
    Object.freeze(source.figures)
    Object.freeze(source.references)

    const first = assembleManuscript(source)
    const second = assembleManuscript(source)

    expect(first).not.toBe(second)
    expect(first.markdown).toBe(second.markdown)
    expect(source.sections).toHaveLength(SECTIONS.length)
    expect(source.figures).toHaveLength(FIGURES.length)
    expect(source.references).toHaveLength(REFERENCES.length)
    expect(source.title).toBe('Adaptive Signal Control Reduces Peak-Hour Delay')
  })

  it('rejects a blank or whitespace-only title', () => {
    expectCode(() => assembleManuscript(input({ title: '' })), 'DSH_MANUSCRIPT_EMPTY_TITLE')
    expectCode(() => assembleManuscript(input({ title: '   ' })), 'DSH_MANUSCRIPT_EMPTY_TITLE')
  })

  it('rejects an input with no sections', () => {
    expectCode(() => assembleManuscript(input({ sections: [] })), 'DSH_MANUSCRIPT_NO_SECTIONS')
  })

  it('rejects a section with a blank id', () => {
    expectCode(
      () => assembleManuscript(input({ sections: [section('  ', 'Abstract', 'Body.')] })),
      'DSH_MANUSCRIPT_EMPTY_SECTION',
    )
  })

  it('rejects a section with a blank heading', () => {
    expectCode(
      () => assembleManuscript(input({ sections: [section('abstract', '', 'Body.')] })),
      'DSH_MANUSCRIPT_EMPTY_SECTION',
    )
  })

  it('rejects a section with blank body text', () => {
    expectCode(
      () => assembleManuscript(input({ sections: [section('abstract', 'Abstract', ' \n ')] })),
      'DSH_MANUSCRIPT_EMPTY_SECTION',
    )
  })

  it('rejects a duplicate section id even when the repeats are not adjacent', () => {
    expectCode(
      () =>
        assembleManuscript(
          input({
            sections: [
              section('results', 'Results', 'First body.'),
              section('abstract', 'Abstract', 'Second body.'),
              section('results', 'Results again', 'Third body.'),
            ],
          }),
        ),
      'DSH_MANUSCRIPT_DUPLICATE_SECTION_ID',
    )
  })

  it('rejects a blank figure entry', () => {
    expectCode(
      () => assembleManuscript(input({ figures: ['![Figure 1](figure-1.svg)', '  '] })),
      'DSH_MANUSCRIPT_EMPTY_FIGURE',
    )
  })

  it('rejects a blank reference entry', () => {
    expectCode(
      () => assembleManuscript(input({ references: ['', '[1] S. Smith. 2020.'] })),
      'DSH_MANUSCRIPT_EMPTY_REFERENCE',
    )
  })
})
