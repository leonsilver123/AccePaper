# Agent Note: what a run searches and what it may cite are two questions

Status: implemented

English | [中文](2026-09-19-what-a-run-searches-and-what-it-may-cite.zh.md)

## Problem

One field answered both. `literatureSearch` decided what A1 searched for its landscape AND which sources the manuscript could cite, so a deployment that pointed a run at a curated library for CITATION also replaced its SEARCH source with that library.

Measured 2026-09-19 on a real run. The library was a 27-item collection of take-over studies; the study's question was about platoon time-to-collision. A1 passes its topic as a research DIRECTION — a sentence — and the Zotero adapter's filter required every word of it to appear in a title or abstract. Nothing matched. An empty result is an ordinary `ok` by design, so A1 **passed**, and the emptiness surfaced four steps later: `ledger: []` and `citations: []` in the run package, a draft with no citations, a references section the pipeline refused to write rather than invent, and D3 blocked by its red-team check.

Everyone involved read that as a content problem — the collection is about the wrong topic — and it half was. But the collection was named for citation, not for search, and there was no way to say so.

## Decision

- **`sourceLibrary` is its own configuration.** It names the library a run cites from — endpoint, local library path, MCP namespace, the designated items, the registry mode, the tool wait — and it is independent of `literatureSearch`.
- **The fields are shared, not duplicated.** `LiteratureChannel`'s `zotero` variant is `{ kind, collectionKey } & SourceLibraryConfig`, so a deployment that genuinely wants the collection AS its landscape source states it once and gets both.
- **The old behaviour still works.** With no `sourceLibrary`, a `literatureSearch.kind: 'zotero'` run resolves its library from the channel exactly as before; nothing about the existing path changed.
- **The failure semantics are unchanged.** A library that cannot be read still yields NO citable sources and never falls back to the checked-in corpus.

## Alternatives considered

- **Loosen the Zotero adapter's topic filter so the collection stops coming back empty.** Rejected as the wrong fix for this deployment: the collection is not about the study's question, so a looser filter returns take-over papers as the landscape for a platoon-TTC study. That is a wrong corpus rather than a small one, and the filter is not what made the configuration unable to say what it meant. (The filter's own strictness is still worth revisiting on its own merits — a research direction is not a keyword list — but not as a substitute for this.)
- **Keep one field and add a boolean for "also search it".** Rejected: the two questions have different answers more often than not, and a boolean makes one of them the exception.
- **Default `sourceLibrary` from `literatureSearch` when absent.** Taken, and it is what keeps every existing deployment working; the point is that naming a library explicitly no longer drags the search source with it.

## Consequences

- **`tests/zotero-source-readiness.spec.ts`** gained the case that pins the separation: a run whose `literatureSearch` is OpenAlex and whose `sourceLibrary` is the Zotero collection still registers the designated source, with no failures.
- **MEASURED, 2026-09-19, on the real profile:** `literatureSearch = {"kind":"openalex"}` beside `sourceLibrary` naming the collection, and the deployed engine reports `registrationFailures: []` with one source registered — `zotero:user:17529257:UA5MIGG3`, evidence at item version 3408, page 4 of 10 in attachment `PU2XWW83`, hash `cd53a50e…`.
- **What this does not do.** It does not make the take-over collection a literature source for a platoon study, and it does not fix the Zotero adapter's topic filter for deployments that DO search a collection. Those are separate, and the second is now a defect with no excuse: a research direction is a sentence, and a filter that demands every word of it will always match nothing.

## Files

- `packages/research/dsh-research-cordis/src/tools.ts` — `SourceLibraryConfig` extracted; the `zotero` channel variant is `{ kind, collectionKey } & SourceLibraryConfig`.
- `packages/research/dsh-research-cordis/src/index.ts` — `Config.sourceLibrary`, resolved once into the provider, the registrations, the registry mode and the tool wait.
- `packages/research/dsh-research-cordis/tests/zotero-source-readiness.spec.ts` — the separation case.
