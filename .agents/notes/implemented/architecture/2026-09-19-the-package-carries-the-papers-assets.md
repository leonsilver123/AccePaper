# Agent Note: The package carries the paper's assets

Status: implemented

English | [中文](2026-09-19-the-package-carries-the-papers-assets.zh.md)

## Problem

A run package carried the manuscript, the compiled deliverables and the rendered figures, and two things a reader of a paper needs were missing.

The results table existed only as prose inside the manuscript and as a `table` document block. A reader who wanted the numbers had to find them in Markdown, and nothing offered them to a tool — a table is the one part of a paper another program is expected to read, and the package had no machine-readable form of it at all.

And a passage quoted in `citations.json` could not be checked against the document it came out of. The run records the passage, where it was read, and the attachment's own version — and stores no file, so the one operation a citation exists to make possible, opening the source and reading the words, needed the reader to go and find the PDF themselves with no way to tell whether the copy they found is the one the judgement was made from.

## Decision

- **`tables/<label>.md` and `tables/<label>.csv`.** The printed table (with its caption, as the manuscript prints it) and its machine-readable twin. Both are read out of the `table` block the document holds, through `parsePipeTable` — the documented inverse of `markdownPipeTable`, in the module that writes it — so the CSV cannot describe a different table from the one the paper prints. CSV quoting is RFC 4180: a field is quoted when it carries a comma, a quote, a carriage return or a newline, an embedded quote is doubled, and records end in `\n` (which every reader that requires `\r\n` also accepts). A table whose Markdown this package cannot read back writes no CSV, and `tables[].csvRefusal` says why rather than leaving a file missing.
- **`refs-pdf/<citeKey>.pdf`, when the deployment opted in.** `readAttachment` has existed since `f8499c83`; this unit is the path from it to a package. `dsh-research-cordis` publishes `ctx.research.referenceFiles`, and the team reads it through `hostReferenceFiles()` exactly as it reads `documentCompiler`, `figureProvider` and the bibliography writer — nothing imports the provider. The reader is asked by the identity a reading record carries, never by a path: the package mints those identities, and `readRegistrations` now also returns the item key each one was read from, so the scheme is not parsed back out of a string.
- **Nothing is read in `planRunPackage`.** It stays pure with respect to the filesystem: the caller reads (`referencePdfPlanOf`, in the service), and the exporter decides what the package may carry — the same split the bibliography already had.
- **Bytes whose version is not the version the reading record states are REFUSED**, and so are a read that returned another attachment and bytes that do not hash to what the reader stated. The file must be the one the passage behind that citation was read from, or it is not stored at all.
- **`referencePdfs: 'not-stored'` is the default and is said out loud.** An empty `refs-pdf/` and a deployment that reads no attachment files are different facts; the manifest states which one holds, and no directory is created when the answer is the second.
- **Each stored file carries `sha256`, `bytes`, `attachmentKey`, `attachmentVersion` and a `purpose`**, and the failure path carries the reader's own reason and no path — the rule the bibliography writer follows, whose `file = {…}` strip and its spec are untouched.
- **`icons/` is recorded as deferred, not built.** No producer for icons exists anywhere in this repository, and a folder nothing generates is a folder a reader has to interpret.

## Alternatives considered

- **Parse the tool's own rendering for the CSV.** Rejected: `renderThreeLineTableMarkdown` draws a fixed-width table with box-drawing rules, and a second reader of it would be a second authority on what the table says. The pipe table the document already carries is the format this repository writes AND reads.
- **Re-derive the table from the run's measurements at export time.** Rejected: D3 already decided what the paper's numbers are, and a second computation agrees with it by luck rather than by construction — the same reason `result-version` exists.
- **Carry the structured model (`columns`/`rows`) on an artifact and build the CSV from it.** The better form, and it needs `registry.ts` — which another unit held — so it is not in this change. What it would add is a character Markdown flattens: a newline inside a cell becomes a space, so a CSV cell can carry text the printed table does not. Recorded in the README's limitations rather than half-built.
- **Refuse the whole export when an attachment cannot be read.** Rejected: one library failure would take away the package a reader can still use, and the manifest can say which source has no file.
- **Store the file under the attachment key rather than the cite key.** Rejected: the reader of a package knows the citation, and the manifest entry names both, so the mapping is explicit either way — and one file per cite key is what "the file this citation rests on" means.

## Consequences

- A package now carries `tables/` and, for a deployment that opted in, `refs-pdf/`; both appear in the manifest's `files` with their digests, and `numberSources` names the run record each table's numbers came from.
- `RunPackageManifest` gained `tables` and `referencePdfs`; `RegistrationRead` gained `itemKeys`; `ctx.research` gained `referenceFiles`, and `readAttachment` finally has a consumer outside its own package.
- The drive-end export is now awaited (`exportRunPackage` is async), because reading an attachment happens before anything is written.
- `dsh-research-team` gained `runner/reference-files.ts` — the Consumer's declaration of the seam, with a shape check where the deployment-facing value arrives.
- **Not done here**: the structured table model is still thrown away at D1/D3, so a CSV cell cannot carry a character the printed Markdown flattened; and no deployment in this repository configures `sourceLibrary.attachments`, so the opt-in path is covered by specs and has not been driven against a real library.

## Files

- `packages/research/dsh-research-team/src/runner/package-export.ts` — the table and reference-file planning, `csvRecords`, `citedAttachments`, the version guard, and the manifest sections.
- `packages/research/dsh-research-team/src/runner/paper-format.ts` — `parsePipeTable`, the inverse of `markdownPipeTable`.
- `packages/research/dsh-research-team/src/runner/reference-files.ts` — the seam's structural declaration and its shape check.
- `packages/research/dsh-research-team/src/index.ts` — `hostReferenceFiles`, `referencePdfPlanOf`, and both export paths wiring the plan in.
- `packages/research/dsh-research-cordis/src/zotero-provider.ts` — `ReferenceFileReaderLike`, the twin this package offers.
- `packages/research/dsh-research-cordis/src/{index.ts,zotero-registration.ts}` — `ctx.research.referenceFiles`, and the identity-to-item-key map taken at registration.
- `packages/research/dsh-research-team/README.md` and `.zh.md` — the two folders, the opt-in, and what is deferred.
