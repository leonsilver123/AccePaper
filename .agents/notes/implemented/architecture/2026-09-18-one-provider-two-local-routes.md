# Agent Note: One provider, two local routes, and the states that must not be confused

Status: implemented

English | [中文](2026-09-18-one-provider-two-local-routes.zh.md)

## Problem

P18-07 needs a real library behind the evidence chain. The MCP server exposes the collection as Markdown written for a model — `- \`UA5MIGG3\` | What happens when… (2020-09) [PDF]` — and a provider built on that would parse a display decision with no contract, which is how a bibliography acquires an entry called `**Item Key:**`. The local HTTP API, by contrast, answers the same question as JSON.

Two transports raise the question this note answers: do they become two ledgers? A provider that read the roster one way and the entries another, with its own identity and its own failure states for each, would be two systems agreeing by luck — and the whole point of P18-07 is that a sentence, a citation, an evidence passage and a `.bib` entry are demonstrably about one paper.

## Decision

- **One provider, two routes, one ledger.** `src/zotero-provider.ts` reads membership over the local JSON API and bibliographic entries over the MCP client's tool, and presents one `ZoteroSource` with one identity, one version check and one set of refusals — `readBy` names which route answered each part, so a reader can tell without the rest of the record changing shape.
- **The endpoint and the library are configuration, never arguments.** A caller that could name a URL would aim this provider at anything the host can reach. The request shape is a collection key and a page cursor, both bounded by the deployment's own configuration.
- **`users/0` is a local alias, not an identity.** It is the same string on every machine and names a different library on each, so the identity is minted from the library object the API RETURNS for an item. The alias is only how the local endpoint is addressed.
- **A collection read is complete or it is not a collection.** Pages are followed to a short one — the API's own statement that there is no more — and the result reports `pagesRead`, `reported` and `complete`. A page that failed yields `collection-truncated` naming what was already read, because a bibliography missing entries looks exactly like a corpus that never had them. An empty collection is a normal `ok` result and a different value.
- **A source is read at one version or not at all.** The JSON read reports the item's `version`; the BibTeX is generated from whatever the library held when it ran. The chain reads metadata, entry, then metadata again, and repeats a bounded number of times before refusing `version-moved` — two revisions are not a snapshot, and recording them as one would pair a citation with a version that never existed at the same moment.
- **A missing tool is named, not worked around.** With no `mcp__<server>__zotero_get_item_metadata` registered the read fails `metadata-tool-missing`. Assembling an entry from the item's own fields would be presented as Zotero's with nothing recording that no generator ran.
- **The collection is the pipeline's corpus, through the seam A1 already reads.** `src/zotero-literature-adapter.ts` implements `LiteratureSearchAdapter` over the provider, so the pipeline does not learn a second way to receive literature — and the topic is matched against titles and abstracts as a LOCAL KEYWORD FILTER, which the outcome's own wording says, because a caller that read this as a search would believe the corpus had been searched rather than filtered.
- **An item that cannot be cited stops the read.** A record with no DOI cannot enter the citation identity chain. A catalogue search legitimately skips such records among thousands; a curated collection of tens is a corpus somebody assembled, so the outcome is `unavailable` naming the items and what would fix it, rather than an `ok` with fewer hits than the collection holds.
- **A passage carries where it came from and its version.** `readPassage` returns the text with the page or span it was read from, the route that read it, and a SHA-256 of that text — so a judgement made from a passage is bound to the passage the way a citation is bound to a sentence, and a later edit to the file invalidates it.
- **Every refusal is its own code.** `endpoint-unreadable`, `collection-truncated`, `metadata-tool-missing`, `bibtex-refused` (carrying the bibliographic refusals) and `version-moved`. Zotero not running arrives as `endpoint-unreadable` with the reason, so it is never read as an empty collection.

## Alternatives considered

- **One transport for both, to keep the code uniform.** Refused: the only single transport available is Markdown written for a model, and parsing it would make this provider's correctness depend on a rendering decision made elsewhere.
- **Read the roster from the MCP tool's `keys_only` output.** Refused once the JSON route was measured available: extracting keys from a Markdown list is a parser for a format with no contract, and it would fail by returning a shorter list rather than by refusing.
- **Treat the JSON and the BibTeX as one atomic snapshot.** Refused: they are two reads at two moments, and claiming atomicity would be a claim the provider cannot support. The bounded re-read and the refusal are what it can.
- **Fall back to the item's `data` fields when the metadata tool is missing.** Refused: an entry nobody generated, presented under Zotero's name.
- **Return `[]` when a page fails.** Refused: that is the confusion this unit exists to remove.

## Consequences

- **`tests/zotero-provider.spec.ts`** (12 cases) script a `fetch` and a tool registry: a two-page collection read to a short page with the cursor and page size asserted; an empty collection as a normal result; a failed second page refused as truncated; a non-list body refused; a source recorded with the returned library object and `zotero:user:1234567:UA5MIGG3`; a version that moves on every read refused; a stable version accepted; a DOI conflict refused with `bibtex-doi-mismatch`; a missing tool named; a tool failure refused as unparseable; two libraries holding one item key kept apart; and a renamed citation key leaving the source identity unchanged.
- **The live route was measured separately** — 27 items in `ILFASAAE`, `UA5MIGG3`'s BibTeX through the product's own client — and these cases do not stand in for it. Reading a collection against the real library, reading a full text or a given page, and judging a sentence against an evidence passage remain separate acceptances.
- **`tests/zotero-corpus.spec.ts`** (12 cases) holds the distribution half: a collection answered as the corpus with the identity travelling into the hit; `total` counted before the cap; an unreadable library and a truncated collection both reported `unavailable` rather than as small corpora; a corpus item without a DOI refused by name; a venue-tier filter refused; an empty collection as an ordinary `ok`; a passage recorded with its location and hash; an empty read refused; a missing tool named.
- **MEASURED LIVE, 2026-09-18, against the library the user named**: 62 tools registered through the product's own MCP client; the collection read IN FULL (28 keys, one page, `complete`); one source read at ONE version (`zotero:user:17529257:UA5MIGG3` @v3408) with its entry keyed `rocheWhatHappensWhen2020` and its authors decoded (`Thüring, Manfred`); the full text read (65,074 characters, hashed). The page route returned five validation errors from the server, which is how its argument names were found to be `item_key` and `start_page` — the call is corrected from the measured schema but has NOT been re-measured, because Zotero Desktop stopped answering partway through the run.
- **AND THAT OUTAGE IS EVIDENCE.** Mid-session the local API began refusing connections; every method reported `endpoint-unreadable` with the reason and none reported an empty corpus, which is the failure path the guidance asks for, exercised by an unplanned outage rather than by a fixture.
- **What is not here yet.** The Zotero identity is not yet bound to core's `CitationRef` or to the citation registry — the hit carries it, and nothing downstream reads that field yet. Binding it is what makes "one identity across sentence, citation and `.bib`" assertable end to end, and it is the next unit. Reading a source's page text against the live library, and judging a sentence against a passage, remain separate acceptances.

## Files

- `packages/research/dsh-research-cordis/src/zotero-provider.ts` (new), `src/zotero-literature-adapter.ts` (new), `src/tools.ts` (`LiteratureChannel` gained the `zotero` variant; `buildToolDeps` takes the adapter), `src/index.ts` (the engine builds it from the deployment's config, reading `ctx.tools` lazily because the loader starts entries concurrently).
- Specs: `packages/research/dsh-research-cordis/tests/zotero-provider.spec.ts` (new), `tests/zotero-corpus.spec.ts` (new).
