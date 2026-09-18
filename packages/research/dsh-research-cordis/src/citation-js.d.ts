/**
 * Declarations for `@citation-js/core` and `@citation-js/plugin-bibtex`, neither of which ships types.
 *
 * WHAT IS DECLARED HERE IS EXACTLY WHAT THIS PACKAGE CONSUMES, and nothing more: the parser, the
 * output formatter, and the shape of one parsed entry as far as the checks read it. A broader
 * declaration would be a description of a library this repository does not own, drifting from the
 * installed version with nothing to notice; a narrower one would push `any` into the checks, which is
 * where the wrong field name would go unnoticed.
 *
 * THE PARSED ENTRY IS AN OPEN RECORD ON PURPOSE. `citation-js` maps a BibTeX entry into CSL-JSON, and
 * a field this file has not seen before is data rather than an error — the checks below read the
 * fields they name and report the ones a citation needs.
 */

declare module '@citation-js/core' {
  /** One parsed entry, as CSL-JSON with the citation key kept on `id`. */
  export interface ParsedEntry {
    readonly id?: string
    readonly type?: string
    readonly title?: string
    readonly author?: ReadonlyArray<{
      readonly given?: string
      readonly family?: string
      /** Present instead of `given`/`family` for an institutional author. */
      readonly literal?: string
      readonly sequence?: string
    }>
    readonly issued?: { readonly 'date-parts'?: ReadonlyArray<ReadonlyArray<number>> }
    readonly 'container-title'?: string
    readonly volume?: string
    readonly issue?: string
    readonly page?: string
    readonly DOI?: string
    readonly ISSN?: string
    readonly [field: string]: unknown
  }

  /** A parsed bibliography. */
  export class Cite {
    /**
     * @param input - BibTeX text, or data already in CSL-JSON.
     */
    constructor(input: string | ReadonlyArray<unknown>)
    /** The parsed entries. */
    readonly data: ReadonlyArray<ParsedEntry>
  }

  export const plugins: {
    readonly output: {
      /**
       * @param name - the registered output format, e.g. `'bibtex'`.
       * @param data - the entries to render.
       * @returns the rendered bibliography.
       */
      format(name: string, data: ReadonlyArray<unknown>): string
    }
  }
}

declare module '@citation-js/plugin-bibtex' {
  // Imported for its side effect: registering the BibTeX input and output formats with the core.
  const plugin: unknown
  export default plugin
}
