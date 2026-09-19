# Agent Note: The producer and the table's cells come from their source

Status: implemented

English | [中文](2026-09-19-the-producer-and-the-table-cells-come-from-their-source.zh.md)

## Problem

Two facts a reader checks were being read from a lossy copy of themselves, and both copies were in a package a journal receives.

**A step's producer was the brand it runs under.** `run-summary.md` in a real run package reported `D3-writing` as produced by the step's declared brand — the table-rendering capability it executes — for a run whose manuscript artifact recorded `proseSource: 'model'` through the deployment's configured route. The registry entry declares what a step runs UNDER; the artifact records what wrote the document, and for every step whose channel is a deployment fact the two are different strings. The row was compiled from the entry, so a model-written paper was reported as produced by a tool — the same drift the registry's brand checks exist to prevent, one level up, where they could not see it.

**The machine-readable table was a re-reading of the printed one.** `tables/<label>.csv` was parsed back out of `tables/<label>.md` through `parsePipeTable`, the documented inverse of `markdownPipeTable`. The round trip is lossy by construction — a pipe table ends a row at a newline, so the renderer folds one inside a cell to a space — which means the twin, the form a tool consumes, could not carry a character the printed form flattens. The structured model the tool returned (`columns` / `rows`) was in hand at D3 and thrown away, so the package held one table stated twice and recoverable once.

Two more gaps belonged to the same unit. `runner/staged-directory.ts` stood at 91.5% lines / 85% branches against the repository's per-file 100% gate, and the uncovered code was its rollback. And every existing integration spec for this package boots the service with `ctx.plugin(...)` over hand-provided services, which exercises behavior but not composition: an injected name, a config field, or a plugin shape that stops resolving is invisible to a suite that provides its own services.

## Decision

- **A step's producer is resolved from the artifacts it committed.** `stepProducerOf(entry, values)` in `runner/registry.ts` returns the brand the step's own artifacts carry when they all agree, and the entry's declared brand when they disagree or when the step produced nothing. `drive.ts` sets `StepOutcome.producer` through it — the same place `kind` was already resolved this way — and `package-export.ts`'s run facts resolve every row the same way, which is what `run-summary.md` renders. THE VALUES COME FROM THE STEP, never from the registry by slug: `manuscript` is republished by D4, E1 and an acceptance, and the registry keeps only the latest value, so a slug read would report D3's row with a later step's producer.
- **The structured model travels with its rendering.** The document's `table` block gained `model: ThreeLineTableModel` — the normalized model the `three-line-table` capability returned — and `composeFloats` fills it from the one place the pipe table is rendered, so a block's Markdown is a rendering of the model beside it. It travels through a republish for free: a step that rebuilds the document's prose carries its non-prose blocks verbatim.
- **Both forms are read from the model.** `tableCellsOf` (in `runner/paper-format.ts`) turns a model into the header and body cells; `markdownPipeTable` escapes those cells for the printed table and `csvRecords` quotes them for the twin. Neither form is derived from the other.
- **`parsePipeTable` is deleted.** It existed only to make one form out of the other, and its own doc said what it could not restore. A `table` block declaring no model is not carried at all rather than published as a caption over an unreadable rendering, so `PackagedTable.csvRefusal` is gone with it — there is no longer a way to have a printed table and no twin.
- **The rollback's uncovered lines are covered by injecting the failure at the file-system call**, through `vi.mock('node:fs')` in `staged-directory.spec.ts`, and the manifest-verification refusal is covered by a plan whose own entry is the manifest it is measured against. No state a caller can create makes the swap rename fail on every platform this suite runs on: the previous directory is moved aside first, so the destination is free by the time the swap runs, and both renames need the same parent and the same permissions. A lock inside the staged directory blocks the rename on Windows only — measured by hand — so a state-based test would leave those lines uncovered on the POSIX lanes. `staged-directory.ts` now stands at 100% lines, branches, functions and statements.
- **The composition has its own test.** `tests/loader-composition.spec.ts` boots a test-only `cordis.yml`, written per test, through the Loader: the real team plugin plus a stand-in engine (`tests/fixtures/loader-boot/engine-stub.ts`) whose two directories come from the configuration and whose document toolchain is the one external dependency a composition cannot supply. It asserts user-visible output — a driven run's working directory on disk, the document in it, the compiled deliverables, and the manifest that names them — and that no entry was left unloaded.

## Alternatives considered

- **Report both brands on a step's row.** Rejected: a row stating what a step would run under beside what it did run under is a row where the reader has to know which field to believe. The step's own record answers one question — what produced this — and the artifact's brand is the answer to it.
- **Carry the flattened cells (`header` / `rows`) on the block instead of the model.** Rejected: the cells are themselves a rendering — units appended to headers, spans padded with empty cells — so carrying them would put a second authority on what the table's columns are beside the model they came from, and a format that needs a column's unit, decimals or metric direction would have to re-derive it from the model anyway.
- **Keep `parsePipeTable` as the fallback for a block that carries no model.** Rejected: no step writes such a block, so the fallback would be code reachable only from a test — and it would keep alive exactly the reading that cannot serve the case it exists for.
- **Make the swap rename fail through real state.** Rejected after measuring it: on Windows an open handle inside the staged directory blocks the rename of its parent (verified on this host), but the same handle does not block it on POSIX, and the destination is cleared by the move-aside on both. A test relying on the Windows behaviour would fail the per-file gate on the Linux lanes.
- **Assert the projection through the existing `ctx.plugin(...)` suites.** Rejected: those suites are the reason the gap existed. What a Loader boot adds is not more behavior coverage but the composition itself — the injected names, the config schema, and what the service does with a deployment's directories at load.

## Consequences

- A package's step table now names the channel that produced each step, and the `llm:<provider>/<model>` a deployment's prose writer produces appears in `run-summary.md` and in `steps.json` for the step that wrote the prose. Steps that ran the offline path are unchanged, and a step that never ran still reports the brand its entry declares.
- `DocumentBlock`'s `table` variant gained a required `model`, so every consumer that pattern-matches a document's blocks sees it; the compilers render the Markdown beside it and ignore it.
- The CSV twin carries what the model states, including a character the printed table cannot draw: a cell holding a newline is quoted whole, where the printed form draws a space.
- `PackagedTable.csv` is required and `csvRefusal` is gone; `dsh-research-team`'s README in both languages no longer claims the model is uncarried.
- The document format changed for durable runs: a run persisted before this build has `table` blocks with no model, and this build's reader carries no table from them rather than publishing a caption over a rendering it cannot check.
- **Not done here**: `dsh-research-web`'s panel renders neither `stepProducerOf`'s value nor the table model; the fields are on the wire and unread by the shipped tab. `runner/project-view.ts` still reports the entry's declared brand for a step, which its own doc describes as what a step would run under.

## Files

- `packages/research/dsh-research-team/src/runner/registry.ts` — `stepProducerOf`, `pipeTableOf` reading its cells from the model, and `composeFloats` carrying the model onto the block.
- `packages/research/dsh-research-team/src/runner/{drive,package-export}.ts` — the two readers of a step's producer, and the two table forms written from the model.
- `packages/research/dsh-research-team/src/runner/{paper-format,document-compile}.ts` — `tableCellsOf`, and the `table` block's required `model`.
- `packages/research/dsh-research-team/tests/{staged-directory,step-producer,loader-composition}.spec.ts` and `tests/fixtures/loader-boot/engine-stub.ts` — the rollback, the producer a live-model run reports, and the Loader-booted composition.
