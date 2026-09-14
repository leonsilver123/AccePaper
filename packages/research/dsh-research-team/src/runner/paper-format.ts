/**
 * The paper formatting layer: the shapes a reader of the exported manuscript expects and the pipeline
 * did not produce.
 *
 * WHY THIS IS A SEPARATE MODULE. The manuscript assembler takes already-rendered blocks, so every
 * defect here was a defect in what the E1 executor handed it, not in the assembler. Measured on the
 * exported package of a real run: the results table reached the manuscript as the tool's
 * box-drawing "three-line" rendering (`renderThreeLineTableMarkdown` draws rules with `─`), the
 * data figure arrived as raw inline SVG with no number and no caption, and `## References` listed
 * unnumbered strings with no in-text marker anywhere in the prose. None of that is a paper, and all
 * of it is fixed by rendering the blocks properly before assembly.
 *
 * EVERY RENDERER HERE IS PURE and its output is Markdown, so the shape of the exported artifact is
 * testable without running the pipeline.
 *
 * @module @deepseek-ai/dsh-research-team/runner/paper-format
 */

/**
 * A figure the manuscript embeds, and its caption.
 *
 * A figure is EITHER a file the package exports OR an inline diagram, never both: the data figure is
 * an SVG the package writes to `figures/`, while the roadmap is a mermaid block that has no image
 * file at all. Passing both, or neither, is refused rather than guessed at.
 */
export interface PaperFigure {
  /** Caption text, rendered as `**Figure N.** <title>`. */
  readonly title: string
  /** Package-relative path to the exported image, e.g. `figures/figure-1.svg`. */
  readonly path?: string
  /** Inline diagram source, rendered as a fenced `mermaid` block. */
  readonly mermaid?: string
  /** Optional second sentence: what the figure does not establish. */
  readonly note?: string
}

/** A table the manuscript embeds, already rendered as a Markdown pipe table. */
export interface PaperTable {
  /** Caption text, rendered as `**Table N.** <title>`. */
  readonly title: string
  /** The pipe table itself, from {@link markdownPipeTable}. */
  readonly markdown: string
  /** Optional second sentence: the source the numbers came from. */
  readonly note?: string
}

/** One numbered equation the manuscript states. */
export interface PaperEquation {
  /** Short name used in the equation's label, e.g. `IDM acceleration`. */
  readonly name: string
  /** The LaTeX body, without the `$$` delimiters. */
  readonly latex: string
  /** Optional sentence saying what the symbols are bound to in this study. */
  readonly note?: string
}

/** Escape the one character that ends a Markdown table cell. */
function escapeCell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', ' ').trim()
}

/**
 * Render a real Markdown pipe table.
 *
 * The tool's own "markdown" target is NOT this: `renderThreeLineTableMarkdown` draws a fixed-width
 * table with box-drawing rules, which a Markdown reader renders as a code block rather than as a
 * table. A pipe table is what a paper's Markdown has to carry.
 *
 * @param header - column headers, at least one, already carrying units where the study has them.
 * @param rows - body rows; a row with fewer or more cells than the header is padded or refused by
 *   the caller, not silently reshaped here.
 * @returns the pipe table, ending with exactly one newline.
 * @throws {Error} when the header is empty or any row's width differs from it.
 */
export function markdownPipeTable(
  header: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): string {
  if (header.length === 0)
    throw new Error('markdownPipeTable: the table carries no columns')
  const width = header.length
  for (const [index, row] of rows.entries()) {
    if (row.length !== width) {
      throw new Error(
        `markdownPipeTable: row ${String(index)} has ${String(row.length)} cell(s) against ${String(width)} column(s)`,
      )
    }
  }
  const line = (cells: ReadonlyArray<string>): string =>
    `| ${cells.map(escapeCell).join(' | ')} |`
  const rule = `| ${header.map(() => '---').join(' | ')} |`
  return `${[line(header), rule, ...rows.map(line)].join('\n')}\n`
}

/**
 * Render one numbered figure: the image link, then its caption.
 *
 * The link is relative to the manuscript, which the package exports beside `figures/`, so the
 * rendered document resolves the image rather than carrying an SVG the reader cannot caption.
 *
 * @param number - the figure's number within the manuscript, starting at 1.
 * @param figure - the figure to render.
 * @returns the figure block, without a trailing newline.
 */
export function figureBlock(number: number, figure: PaperFigure): string {
  const hasPath = figure.path !== undefined && figure.path.length > 0
  const hasMermaid =
    figure.mermaid !== undefined && figure.mermaid.trim().length > 0
  if (hasPath === hasMermaid) {
    throw new Error(
      `figureBlock: figure ${String(number)} must carry exactly one of \`path\` or \`mermaid\``,
    )
  }
  const label = `Figure ${String(number)}`
  const caption = `**${label}.** ${figure.title}${figure.note === undefined ? '' : ` ${figure.note}`}`
  const body = hasPath
    ? `![${label}: ${figure.title}](${figure.path})`
    : ['```mermaid', figure.mermaid?.trim(), '```'].join('\n')
  return `${body}\n\n${caption}`
}

/**
 * Render one numbered table: its caption, then the table.
 *
 * @param number - the table's number within the manuscript, starting at 1.
 * @param table - the table to render.
 * @returns the table block, without a trailing newline.
 */
export function tableBlock(number: number, table: PaperTable): string {
  const label = `Table ${String(number)}`
  const caption = `**${label}.** ${table.title}${table.note === undefined ? '' : ` ${table.note}`}`
  return `${caption}\n\n${table.markdown.trimEnd()}`
}

/**
 * Render the manuscript's equation list, one display equation per entry.
 *
 * The equations describe the model this study actually ran; they are not decoration, so each carries
 * the name it is referred to by in the prose.
 *
 * @param equations - the equations, in the order they are numbered.
 * @returns the block, without a trailing newline, or an empty string when there are none.
 */
export function equationBlock(equations: ReadonlyArray<PaperEquation>): string {
  return equations
    .map((equation, index) => {
      const label = `Equation ${String(index + 1)} — ${equation.name}`
      const note = equation.note === undefined ? '' : `\n\n${equation.note}`
      return `**${label}**\n\n$$\n${equation.latex.trim()}\n$$${note}`
    })
    .join('\n\n')
}

/**
 * Number the reference entries.
 *
 * The entries arrive as single formatted strings; numbering them is what makes an in-text marker
 * (`[2]`) mean something. The order is the order given, so a caller that sorts must sort before
 * calling, and the returned index is the number a citation uses.
 *
 * @param entries - formatted reference entries, one per source.
 * @returns the entries prefixed with their number, in the same order.
 */
export function numberedReferences(
  entries: ReadonlyArray<string>,
): ReadonlyArray<string> {
  return entries.map(
    (entry, index) => `[${String(index + 1)}] ${entry.trim()}`,
  )
}

/**
 * Format one reference from the structured record a citation resolves to.
 *
 * Built from the FIELDS, not from a pre-joined string, so a missing year or venue is visibly absent
 * rather than silently missing from a sentence that reads as complete.
 *
 * @param reference - the resolved record's fields.
 * @returns the formatted entry, without its number.
 */
export function formatReference(reference: {
  readonly authors?: ReadonlyArray<string>
  readonly title?: string
  readonly venue?: string
  readonly year?: number | string
  readonly identifier?: string
}): string {
  const authors =
    reference.authors === undefined || reference.authors.length === 0
      ? 'Unknown author'
      : reference.authors.join(', ')
  const parts = [
    `${authors}.`,
    reference.title === undefined ? 'Untitled.' : `${reference.title}.`,
  ]
  if (reference.venue !== undefined && reference.venue.length > 0)
    parts.push(`${reference.venue}.`)
  if (reference.year !== undefined) parts.push(`${String(reference.year)}.`)
  if (reference.identifier !== undefined && reference.identifier.length > 0)
    parts.push(reference.identifier)
  return parts.join(' ')
}
