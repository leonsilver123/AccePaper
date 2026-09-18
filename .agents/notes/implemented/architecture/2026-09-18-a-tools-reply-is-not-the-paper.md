# Agent Note: a tool's reply is not the paper, and a DOI is not a condition of citability

Status: implemented

English | [中文](2026-09-18-a-tools-reply-is-not-the-paper.zh.md)

## Problem

Two independent things had been read as evidence when neither is.

**The first is the provider's own output.** `ZoteroProvider.readPassage` accepted whatever text the MCP tool returned and hashed it as the source's words. Measured against the real library on 2026-09-18, that text is not the paper:

- `zotero_read_pdf_pages` answers `# PDF Pages 1-1 of <title>` / `**Item Key:** UA5MIGG3` / `**Total pages in PDF:** 10` / `## Page 1`, and only then the page. The envelope is the server's presentation, and hashing the reply hashes it too.
- `zotero_get_item_fulltext` answers a `*Response size: ~16K tokens…*` preamble, a `**Type:** / **Item Key:** / **Date:** / **Authors:** / **Journal:** / **DOI:** / **ISSN:** / **URL:**` header block, the rendered body, and the reference list. The 65,074-character "full text" this repository previously recorded as read is **that rendering**, not the article.
- Before its PDF extra was installed, `zotero_read_pdf_pages` answered a 205-character `PyMuPDF is required for PDF page reading. Install it with: pip install 'zotero-mcp-server[pdf]'…` notice — non-empty, naming the item, and something the old reader would have entered into the evidence chain as page 1.

The page reply carries a page number, which is exactly why it reads as clean: the guidance's rule is that page output must be checked too, because having page numbers does not mean there is no wrapping.

**The second is the DOI.** `ZoteroLiteratureAdapter` refused any collection item without one, on the reasoning that the pipeline cites by identifier. That is wrong about what a DOI is. The source's identity is the library and the item key — `zotero:user:17529257:UA5MIGG3` — which this module already mints; the DOI is an EXTERNAL identifier used for cross-checking and de-duplication. A book states an ISBN, a preprint an arXiv id, a report neither, and all three are citable in every style a journal publishes. The old rule expressed an implementation limit as an academic norm, and the fix had to say which one it was.

## Decision

- **A reply is classified, and an unclassified reply is not evidence.** `readPage` requires the reply to BE the shape the tool is measured to produce — a `# PDF Pages <a>-<b> of …` first line naming this page, exactly one `## Page <n>` marker for it, and a `**Total pages in PDF:** <n>` line — and everything after the marker is the page. The rule is positive rather than a list of preambles to strip, because a blocklist is wrong the first time the server writes a new one, and the install notice above is precisely a reply a stripper would hand on.
- **The reply is kept, and the evidence is hashed separately.** `ToolReplyAudit` holds the reply verbatim with its own SHA-256 and length; `contentSha256` is over the extracted page. Hashing the reply would make the evidence's version depend on the server's presentation.
- **The route that cannot be separated is navigation, and its type says so.** See below.
- **Every version a judgement depends on travels with the page.** `itemVersion` moves when metadata is edited, `attachment.version` when the file is replaced, `contentSha256` when the words change. None implies the others, and the guidance is explicit that an attachment change need not move the parent.
- **A page is required, and the attachment must be establishable.** The tool takes the item and picks the file, so one PDF is attributable and two are not; guessing would bind a judgement's invalidation to the wrong file while looking like a fact.
- **The namespace is whatever the record establishes.** `doi`, else `isbn`, else `arxiv`, else `unknown` carrying the run's own identity. `LiteratureRefKind` was widened to core's full `CitationIdKind` for this; a ref that could express only `doi` and `arxiv` had to drop a book.
- **A missing DOI is not a refusal; a missing title is, and it is called an implementation limit.** Nothing can name an untitled record in a reference list or check an identity against it, so the read stops and says the limit is what this adapter requires — never that the work may not be cited.

## Alternatives considered

- **Strip a fixed prefix from the full-text reply and call the rest evidence.** Rejected: the server composes that document, and this module cannot tell in general where its composition ends. A rule keyed on the measured preamble is correct until the preamble changes, and it would fail by silently including the server's prose rather than by refusing.
- **Detect the install notice by matching "PyMuPDF is required".** Rejected: a blocklist of known notices, which is the same mistake as stripping known preambles. The positive shape check refuses it without naming it.
- **Keep the DOI rule and label it an implementation limit.** Rejected: the limit is not real. The identity chain needs no DOI, the `.bib` export needs none, and the rule would have kept excluding citable works forever on the strength of a constraint that does not exist.
- **Record which attachment answered by re-reading and matching page counts.** Rejected: the tool reports the count it read, and matching it against the children would identify a file by a coincidence. Refusing says what is true.

## Consequences

- **`tests/zotero-corpus.spec.ts`** grew to 23 cases. Every reply it feeds the provider is a string the live server was measured returning, character for character — the page header, the install notice, and the out-of-range sentence **with the byte-order mark it actually carries**, which is why the parser strips one. Cases assert the page's words arrive with no `PDF Pages` / `Item Key` / `## Page` left in them, that the audit holds the whole reply and hashes to it, that the install notice is refused as `passage-unrecognized`, that a page past the end is `passage-out-of-range` naming the file's length, that two PDFs are `passage-unattributable` naming both, and that a no-DOI book cites by ISBN while a no-DOI report cites by its own identity.
- **`readPassage` is gone**, replaced by `readPage` (evidence) and `readFullText` (navigation). The split is the enforcement: `ZoteroNavigation` has no page and no content hash and carries a `notEvidence` field, so nothing that takes evidence can accept a rendering by accident.
- **MEASURED LIVE, 2026-09-18**, against the library the user named: `read_pdf_pages` for pages 1, 10 and the span 2-3 returned the page text with the header above; a page past the end returned the out-of-range sentence; a bad item key returned a 404 block; `read_pdf_pages` without `start_page` is refused by the server, which is why the argument is required. PyMuPDF was installed into the MCP server's own venv, the fix its notice names; Zotero Desktop had been restarted by then and the local API answered `200`.
- **What this does not do.** The page text still contains the PDF's own printed furniture — running heads, the journal line, the page number in the footer — because those are printed on the page and the extractor emits them in reading order. A quotation must therefore be a span a reader can find on the named page, which is what the locator is for; the extractor does not reflow the page, and this note does not claim it does.

## Files

- `packages/research/dsh-research-cordis/src/zotero-provider.ts` — `readPassage` replaced by `readPage` and `readFullText`; `ToolReplyAudit`, `ZoteroNavigation`, `ZoteroAttachment`, `pageTextOf`, `ZOTERO_READ_RULE_VERSION`, and three new failure codes.
- `packages/research/dsh-research-cordis/src/zotero-literature-adapter.ts` — the DOI rule removed; `refOf` picks the namespace the record establishes.
- `packages/research/dsh-research-tools/src/tools/literature-search/adapter.ts` — `LiteratureRefKind` widened to core's `CitationIdKind`.
- Specs: `packages/research/dsh-research-cordis/tests/zotero-corpus.spec.ts`.
