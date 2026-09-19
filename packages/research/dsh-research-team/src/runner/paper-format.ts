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
 * THE NUMBERING LIVES HERE TOO, and for the same reason: a caption's number and an in-text
 * reference to it are one fact. The figure plan numbers its floats through {@link numberFloats} and
 * hands those labels to both the prose channel (which may then cite `Figure 1`) and the assembler
 * (which renders the captions through {@link figureBlock} / {@link tableBlock}), and
 * {@link citedFloats} reports which of them a manuscript's prose actually names.
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
  /** The figure's number in the manuscript, e.g. `Figure 1`, from {@link numberFloats}. */
  readonly label: string
  /** Caption text, rendered as `**<label>.** <title>`. */
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
  /** The table's number in the manuscript, e.g. `Table 1`, from {@link numberFloats}. */
  readonly label: string
  /** Caption text, rendered as `**<label>.** <title>`. */
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

/**
 * One float the figure plan declares, in the order the plan lists it.
 *
 * The kind is the PLAN's vocabulary (`data-figure`, `roadmap`, `three-line-table`), because that
 * is what the plan carries; {@link numberFloats} maps it to the label a manuscript uses.
 */
export interface PlannedFloat {
  /** The plan's kind for this float. */
  readonly kind: string
  /** The float's caption title, as the reader will meet it. */
  readonly title: string
}

/** One numbered item the manuscript's prose can refer to. */
export interface CitableFloat {
  /** The label as the prose writes it, e.g. `Figure 1`. */
  readonly label: string
  /** What it carries, so a writer can tell whether the section is about it. */
  readonly title: string
}

/** Which citable items the prose refers to, and which it leaves unmentioned. */
export interface CrossReferenceReport {
  /** Labels the section bodies mention. */
  readonly cited: ReadonlyArray<string>
  /** Labels no section body mentions. */
  readonly uncited: ReadonlyArray<string>
}

/** Plan kinds a manuscript numbers as figures, in the order they take numbers. */
const FIGURE_KINDS: ReadonlyArray<string> = ['data-figure', 'roadmap']

/** Plan kinds a manuscript numbers as tables. */
const TABLE_KINDS: ReadonlyArray<string> = ['three-line-table']

/**
 * Number a plan's floats the way the manuscript does.
 *
 * FIGURES AND TABLES NUMBER INDEPENDENTLY: a paper's Table 1 does not become Table 3 because two
 * figures came before it. The numbering is a pure function of the plan and its order, so two
 * callers that pass the same plan get the same labels without sharing a counter.
 *
 * The entry the plan declared is carried through, so a caller keeps its payload and gains the
 * label rather than having to match two lists up afterwards.
 *
 * @param floats - the plan's floats, in plan order.
 * @returns one labelled float per input, in the same order.
 * @throws {Error} when a float's kind is not one this manuscript numbers — an unnumbered float
 *   would render a caption no cross-reference can name.
 */
export function numberFloats<T extends PlannedFloat>(
  floats: ReadonlyArray<T>,
): ReadonlyArray<T & { readonly label: string }> {
  let figureCount = 0
  let tableCount = 0
  return floats.map((float) => {
    if (FIGURE_KINDS.includes(float.kind)) {
      figureCount += 1
      return { ...float, label: `Figure ${String(figureCount)}` }
    }
    if (TABLE_KINDS.includes(float.kind)) {
      tableCount += 1
      return { ...float, label: `Table ${String(tableCount)}` }
    }
    throw new Error(
      `numberFloats: \`${float.kind}\` is not a kind this manuscript numbers — expected one of `
      + [...FIGURE_KINDS, ...TABLE_KINDS].join(', '),
    )
  })
}

/**
 * The number an equation carries, as the prose cites it.
 *
 * One place decides it: {@link equationBlock} renders the label this returns, and
 * {@link citableFloats} offers the same string to the prose channel.
 *
 * @param index - the equation's position in the list, starting at 0.
 * @returns the label, e.g. `Equation 2`.
 */
export function equationNumber(index: number): string {
  return `Equation ${String(index + 1)}`
}

/** A literal string as a regular expression that matches exactly it. */
function literalPattern(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/**
 * Split the citable items by whether the prose refers to them.
 *
 * A CAPTION IS NOT A REFERENCE. This reads the section bodies — the prose a writer produced — and
 * never the caption block the assembler renders, so a float whose caption the manuscript prints is
 * still reported here as uncited until a sentence points at it.
 *
 * @param prose - the manuscript's section bodies, joined.
 * @param floats - the citable items.
 * @returns the labels the prose mentions, and the labels it does not.
 */
export function citedFloats(
  prose: string,
  floats: ReadonlyArray<CitableFloat>,
): CrossReferenceReport {
  const cited: string[] = []
  const uncited: string[] = []
  for (const float of floats) {
    // `Figure 1` inside `Figure 10` names a different float, so a trailing digit refuses a match.
    const pattern = new RegExp(`${literalPattern(float.label)}(?![0-9])`, 'u')
    if (pattern.test(prose)) cited.push(float.label)
    else uncited.push(float.label)
  }
  return { cited, uncited }
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

/** A pipe table read back into the cells it was written from. */
export interface ParsedPipeTable {
  readonly header: ReadonlyArray<string>
  readonly rows: ReadonlyArray<ReadonlyArray<string>>
}

/**
 * Read a pipe table back into its header and body rows.
 *
 * THE INVERSE OF {@link markdownPipeTable}, AND ONLY OF IT. This reads the format this module writes,
 * which is what lets a caller render a table's machine-readable twin without a second authority on
 * what the paper prints — a Markdown table written by another tool may carry alignment markers,
 * padding or escapes this writer never emits, and anything this reader does not fully recognize is
 * REFUSED rather than partly understood.
 *
 * The escaping is invertible because the writer escapes every `|` exactly once: splitting on the
 * exact separator `" | "` cannot hit an escaped pipe, and removing one backslash from each `\|`
 * restores the original for any number of backslashes before it.
 *
 * WHAT IS NOT RECOVERABLE, and is not guessed at: the writer folds a newline inside a cell to a space
 * and trims the cell, so a reader that needs those characters must read them where they are still
 * whole. The caller is told the table's cells, not the text a cell was rendered from.
 *
 * @param markdown - a pipe table as {@link markdownPipeTable} wrote it.
 * @returns the header cells and the body rows, or undefined when the text is not one of those tables.
 */
export function parsePipeTable(markdown: string): ParsedPipeTable | undefined {
  const lines = markdown.replace(/\n+$/u, '').split('\n')
  const first = lines[0]
  const second = lines[1]
  if (first === undefined || second === undefined) return undefined
  const cellsOf = (line: string): ReadonlyArray<string> | undefined => {
    if (!line.startsWith('| ') || !line.endsWith(' |')) return undefined
    return line.slice(2, -2).split(' | ').map(cell => cell.replaceAll('\\|', '|'))
  }
  const header = cellsOf(first)
  // THE RULE IS PART OF THE FORMAT, not decoration: without it the text is a paragraph of pipes, and
  // accepting it would report a table a Markdown reader does not draw as one.
  const rule = cellsOf(second)
  if (header === undefined || rule === undefined) return undefined
  if (rule.length !== header.length || rule.some(cell => cell !== '---')) return undefined
  const rows: Array<ReadonlyArray<string>> = []
  for (const line of lines.slice(2)) {
    const cells = cellsOf(line)
    if (cells === undefined || cells.length !== header.length) return undefined
    rows.push(cells)
  }
  return { header, rows }
}

/**
 * Render one numbered figure: the image link, then its caption.
 *
 * The link is relative to the manuscript, which the package exports beside `figures/`, so the
 * rendered document resolves the image rather than carrying an SVG the reader cannot caption.
 *
 * @param figure - the figure to render, carrying the label {@link numberFloats} gave it.
 * @returns the figure block, without a trailing newline.
 */
export function figureBlock(figure: PaperFigure): string {
  const hasPath = figure.path !== undefined && figure.path.length > 0
  const hasMermaid =
    figure.mermaid !== undefined && figure.mermaid.trim().length > 0
  if (hasPath === hasMermaid) {
    throw new Error(
      `figureBlock: ${figure.label} must carry exactly one of \`path\` or \`mermaid\``,
    )
  }
  const caption = `**${figure.label}.** ${figure.title}${figure.note === undefined ? '' : ` ${figure.note}`}`
  const body = hasPath
    ? `![${figure.label}: ${figure.title}](${figure.path})`
    : ['```mermaid', figure.mermaid?.trim(), '```'].join('\n')
  return `${body}\n\n${caption}`
}

/**
 * Render one numbered table: its caption, then the table.
 *
 * @param table - the table to render, carrying the label {@link numberFloats} gave it.
 * @returns the table block, without a trailing newline.
 */
export function tableBlock(table: PaperTable): string {
  const caption = `**${table.label}.** ${table.title}${table.note === undefined ? '' : ` ${table.note}`}`
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
      const label = `${equationNumber(index)} — ${equation.name}`
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
