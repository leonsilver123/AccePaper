// @deepseek-ai/dsh-research-team — E1-format manuscript assembly (pure).
//
// E1-format is step 15 of the 16-step pipeline: it turns the parts the previous
// steps produced (title, section bodies, rendered figure Markdown, reference
// entries) into ONE submittable Markdown manuscript. The step's other capability,
// the three-line results table, is rendered elsewhere and reaches this module as
// already-rendered figure Markdown — assembly is what happens here.
//
// The module is a pure function of its input:
//  - no I/O, no network, no clock, no randomness, no module-level mutable state;
//  - the caller's objects are never mutated or retained (every emitted field is a
//    primitive copied out of the input, so nothing can alias back into it);
//  - the returned record is a `structuredClone` that is then recursively frozen,
//    so a caller cannot edit an assembled manuscript after the fact.
//
// FAIL LOUD (a shell is not a manuscript). Assembly REFUSES rather than emitting
// a document that looks complete:
//  - a blank title, no sections at all, or a section with a blank id / heading /
//    body carries no content and is rejected;
//  - duplicate section ids are rejected, because a repeated id makes a section
//    unaddressable for every downstream step that cites it;
//  - a blank figure / reference entry is rejected for the same reason a blank
//    section body is: it would render an empty block inside a non-empty section.
// Every refusal throws an `Error` whose message starts with `[<code>]`, where the
// code is one of the stable `DSH_MANUSCRIPT_*` values declared below.
//
// The counts on the result are COMPUTED here from the input, never accepted from
// the caller: a manuscript that reports its own section count could overstate what
// was assembled, which is exactly the claim a reviewer checks it against.

/** Stable error codes this module raises. Each thrown message is `[<code>] …`. */
const ERROR_CODES = {
  /** The title is absent or blank after trimming. */
  emptyTitle: 'DSH_MANUSCRIPT_EMPTY_TITLE',
  /** The section list is empty. */
  noSections: 'DSH_MANUSCRIPT_NO_SECTIONS',
  /** A section's id, heading, or body text is blank after trimming. */
  emptySection: 'DSH_MANUSCRIPT_EMPTY_SECTION',
  /** Two sections carry the same id. */
  duplicateSectionId: 'DSH_MANUSCRIPT_DUPLICATE_SECTION_ID',
  /** A figure entry is blank after trimming. */
  emptyFigure: 'DSH_MANUSCRIPT_EMPTY_FIGURE',
  /** A reference entry is blank after trimming. */
  emptyReference: 'DSH_MANUSCRIPT_EMPTY_REFERENCE',
} as const

/** Heading text of the figure section (used only when figures exist). */
const FIGURES_HEADING = 'Figures'

/** Heading text of the reference section (used only when references exist). */
const REFERENCES_HEADING = 'References'

/** One assembled section of the manuscript, in the order the caller supplied it. */
export interface ManuscriptSection {
  /** Stable section identity; must be non-blank and unique within one manuscript. */
  readonly id: string
  /** Section title, rendered as a level-2 Markdown heading. */
  readonly heading: string
  /** Section prose, rendered verbatim below the heading (line breaks preserved). */
  readonly bodyText: string
}

/** The manuscript parts, as produced by the preceding pipeline steps. */
export interface ManuscriptInput {
  /** Manuscript title, rendered as the single level-1 heading. */
  readonly title: string
  /** Sections in the order they must appear in the manuscript. */
  readonly sections: ReadonlyArray<ManuscriptSection>
  /** Already-rendered figure Markdown; each entry becomes one block. */
  readonly figures: ReadonlyArray<string>
  /** Reference entries; each entry becomes one block. */
  readonly references: ReadonlyArray<string>
}

/** The assembled manuscript plus what it was assembled from. */
export interface AssembledManuscript {
  /** The complete manuscript Markdown, ending with exactly one newline. */
  readonly markdown: string
  /** Number of sections taken from `sections` (excludes Figures/References). */
  readonly sectionCount: number
  /** Number of figure blocks taken from `figures`. */
  readonly figureCount: number
  /** Number of reference entries taken from `references`. */
  readonly referenceCount: number
  /** One-line audit note: what was assembled, and on what terms. */
  readonly basis: string
}

/** Recursively freeze a value, returning it with its type unchanged. */
function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key])
  }
  return Object.freeze(value) as T
}

/** Throw the module's coded error for one refusal. */
function refuse(code: string, message: string): never {
  throw new Error(`[${code}] ${message}`)
}

/** The trimmed text of a field that must carry content. */
function requiredText(value: string, code: string, subject: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0) refuse(code, `${subject} is empty`)
  return trimmed
}

/** Validate every section and return its trimmed rendering fields, in order. */
function validatedSections(
  sections: ReadonlyArray<ManuscriptSection>,
): ReadonlyArray<{ readonly id: string; readonly heading: string; readonly bodyText: string }> {
  const seenIds = new Set<string>()
  return sections.map((section) => {
    const id = requiredText(section.id, ERROR_CODES.emptySection, 'a section id')
    const heading = requiredText(
      section.heading,
      ERROR_CODES.emptySection,
      `the heading of section '${id}'`,
    )
    const bodyText = requiredText(
      section.bodyText,
      ERROR_CODES.emptySection,
      `the body text of section '${id}'`,
    )
    if (seenIds.has(id)) {
      refuse(
        ERROR_CODES.duplicateSectionId,
        `section id '${id}' appears more than once — a repeated id makes a section unaddressable downstream`,
      )
    }
    seenIds.add(id)
    return { id, heading, bodyText }
  })
}

/** Validate a trailing block list (figures or references) and return its entries. */
function validatedEntries(
  entries: ReadonlyArray<string>,
  code: string,
  subject: string,
): ReadonlyArray<string> {
  return entries.map((entry, index) => requiredText(entry, code, `${subject} ${String(index + 1)}`))
}

/**
 * Assemble the manuscript parts into one submittable Markdown document.
 *
 * Output structure: `# <title>`, one `## <heading>` block per section, then a
 * `## Figures` block when figures were supplied, then a `## References` block when
 * references were supplied. A trailing section is omitted entirely when its list is
 * empty, so an empty list never yields an empty heading. Every field is trimmed at
 * its outer edges; inner line breaks (table rows, Markdown hard breaks) are kept.
 *
 * @param input - the title, ordered sections, rendered figures, and reference entries.
 * @returns the frozen manuscript Markdown, the computed part counts, and the audit basis.
 * @throws Error with a `DSH_MANUSCRIPT_*` code when the input is not a manuscript:
 *   a blank title, an empty section list, a section with a blank id / heading /
 *   body, a duplicate section id, or a blank figure / reference entry.
 */
export function assembleManuscript(input: ManuscriptInput): AssembledManuscript {
  const title = requiredText(input.title, ERROR_CODES.emptyTitle, 'the manuscript title')
  if (input.sections.length === 0) {
    refuse(ERROR_CODES.noSections, 'the manuscript carries no sections')
  }
  const sections = validatedSections(input.sections)
  const figures = validatedEntries(input.figures, ERROR_CODES.emptyFigure, 'figure entry')
  const references = validatedEntries(input.references, ERROR_CODES.emptyReference, 'reference entry')

  const blocks: string[] = [`# ${title}`]
  for (const section of sections) {
    blocks.push(`## ${section.heading}\n\n${section.bodyText}`)
  }
  if (figures.length > 0) {
    blocks.push(`## ${FIGURES_HEADING}\n\n${figures.join('\n\n')}`)
  }
  if (references.length > 0) {
    blocks.push(`## ${REFERENCES_HEADING}\n\n${references.join('\n\n')}`)
  }

  const assembled: AssembledManuscript = {
    markdown: `${blocks.join('\n\n')}\n`,
    // Counted here, not read from the input: the report of what was assembled is
    // derived from the arrays that were actually rendered above.
    sectionCount: sections.length,
    figureCount: figures.length,
    referenceCount: references.length,
    basis:
      `E1-format assembled ${String(sections.length)} section(s), ${String(figures.length)} figure(s) `
      + `and ${String(references.length)} reference(s) into one Markdown manuscript; counts are computed from `
      + 'the assembled arrays, and a trailing section is emitted only when its list is non-empty',
  }
  return deepFreeze(structuredClone(assembled))
}
