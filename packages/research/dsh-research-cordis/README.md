---
description: "The Cordis adapter that exposes the 16-step research engine as ctx.research and registers the seven research tools on the host tool runtime, for deployments running the research pipeline."
kind: "package-reference"
---

# @deepseek-ai/dsh-research-cordis

English | [中文](README.zh.md)

## Summary

`dsh-research-cordis` gives a deployment the research engine: `ctx.research` carries the 16-step state machine, its gate adjudication and its artifact registry, while the channels and directories the engine runs on — the retrieval catalogue, the citation resolver, the prose route, the document toolchain, the drawing interpreter, and where a run reads and writes — are stated once in its `Config`. It also registers the seven research tools on the host's `ctx.tools`, so a run reaches them through the host tool runtime as well as through its own executor path. Choose it when a profile must run the research pipeline; `dsh-research-tools` and `dsh-research-core` are its libraries rather than rows to mount. `evidenceProfile` decides what this deployment's evidence is allowed to be, so one package carries an offline demonstration and a submission-graded study.

## Table of Contents

- [Deployment-level configuration](#deployment-level-configuration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

The Cordis adapter for `dsh-research-core`: it exposes the 16-step engine as the `ctx.research` service and registers the seven research tools on the host's real `ctx.tools`.

This package is a **thin adapter layer**: the state machine is delegated to core, while tool registration — together with transactional rollback, revocable handles, and a module-private capability — is implemented here. The service also delegates the pure result surfaces of T07/T08/T09 (`classifyL0` / `verifyCitation` / `evaluateGate` / `getGateIntent`); those methods touch no run state.

## Deployment-level configuration

Each field represents **one** deployment-level choice, decided once by the engine and shared by the whole pipeline:

| Field | What it decides | When omitted |
|---|---|---|
| `evidenceProfile` | What this deployment's evidence is allowed to be, and whether its output may be submitted (`production` or `evaluation`) | `evaluation`: synthetic evidence is admitted, so the run's output is unsubmittable |
| `literatureSearch` / `citationResolver` | Which catalogue the retrieval and citation-identity chains read (`fixture` or `openalex`) | fixture (offline) |
| `prose` | Which provider route the text-producing steps run on | The text-producing steps emit their fixture text and call no model |
| `document` | Which document toolchain this deployment has (`executable`, optional `latexEngine`) | No compile: the run exports its Markdown manuscript and records that it was not compiled |
| `figures` | Which interpreter has a scientific plotting library (`executable`), so the floats are DRAWN rather than emitted as source | The built-in renderer draws, each float records that no library drew it, and a roadmap stays Mermaid source its compiled documents cannot carry |
| `workspace` | The absolute working directory of **every** agent session the engine creates | `process.cwd()` |
| `casePackDirectory` / `packageDirectory` / `snapshotDirectory` / `manuscriptDirectory` | Where the Case Pack, the run's reproducible package, the durable snapshot and the run's working document are written | Nothing is written for that one: no pack is loaded, no package is exported, runs are not persisted, no document is projected |

`workspace` is not optional: `{{cwd}}` is a **strict** system-prompt variable, and every shipped bundle's persona references it. A session with no working directory fails at the **prompt-assembly** stage — **before** any request reaches a provider. The `prose` row does **not** restate the directory (`ProseChannelConfig` `Omit`s it), so each deployment states it in exactly one place.

<a id="model-experience"></a>
## Model Experience

### The seven registered research tools

#### What the model sees

On a deployment that mounts this plugin, the seven definitions sit in the shared `ctx.tools` registry, so each contributes its name, description and parameter schema to the tool list a model request carries: `literature-search`, `citation-verify`, `claim-construct`, `ablation`, `figure`, `three-line-table` and `roadmap`. A description is the catalogue's summary sentence followed by one exposure sentence, and the parameters are the closed set declared here — `spec` for `figure`, and `model` plus `target` for `three-line-table`, for example.

##### Exposure sentences

```markdown
Model-callable (pure render over declared data).
Pipeline-only research tool (registered for discovery; not exposed to agents).
```

#### Token effect

Fixed. Seven definitions with one short description and a small parameter object each are paid again on every request that carries the tool list; nothing here grows with a run.

#### KV Cache effect

Prefix-stable. A registration is byte-identical for the life of the plugin and does not invalidate reuse; a version or exposure change rewrites the definition block and can invalidate reuse from the first changed token.

### The pipeline-only refusal

#### What the model sees

A call the agent loop makes to one of the four `pipeline_only` tools is denied before dispatch, and the model receives the refusal as that call's error result.

##### Pipeline-only refusal

```markdown
[<toolId>] is pipeline-only (injected-adapter/fixture input); it is registered for discovery and internal pipeline use only — not executable through the agent tool runtime
```

#### Token effect

One fixed sentence per denied call, retained in history until a compaction shadows it.

#### KV Cache effect

Append-only; the refusal follows the reusable request prefix and does not invalidate it.

### Prose and review routes

#### What the model sees

The text-producing steps and the two review seams reach a model through an agent session this package creates on the route `Config.prose` and `Config.review` name; the request carries the system prompt the composed tree contributes and the caller's own instruction, and this package adds no prompt text of its own — it decides which provider and model the session runs on.

#### Token effect

No fixed tokens come from this package. Each request costs what the composed system prompt and the caller's instruction cost, and the package decides the route rather than the text.

#### KV Cache effect

Independent per session: each call is its own model request with its own prefix, so it neither reuses nor invalidates another session's cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **A working directory holds the one document a run maintains, and it needs a document toolchain** (2026-09-19): `manuscriptDirectory` resolves the way the three directories beside it do — a DEPLOYMENT setting, because `runPipeline` is a Remote method and a request-supplied path would let a browser choose where the host writes files. Its whole purpose is to hold a document a person edits and hands back, so **a deployment that names it with no `document` is refused AT LOAD**, with the reason, rather than discovering it at the last step of the first run. **`PandocCompiler.read` is the other direction of the compile seam**: a `.tex` goes in as text and a `.docx` as bytes, and what comes back is Markdown plus what the conversion did NOT carry — a Word comment is detected by the `word/comments.xml` part the OOXML package really contains, so the loss is reported when the file has one rather than claimed for every `.docx`. A PDF and an HTML file are refused as formats that cannot be read back: one is a rendering and the other is not the document a person edits. **What is not here**: the loss list is what this reader detected, not a proof that nothing else was lost — a Word feature pandoc converts wrongly rather than dropping is not named.

- **The PDF path asks for a PDF, and a figure the compiled document cannot carry is named rather than lost** (2026-09-17, R01/R02): the PDF branch used to pass `-t latex --pdf-engine=…`, take pandoc's stdout and write it as `manuscript.pdf` — reproduced here: **exit 0, no `%PDF-` header, LaTeX text**. It now renders the LaTeX source to a file, runs the engine on THAT file, reads the `.pdf` back as BYTES (`encoding: 'base64'` on the compiled document), and refuses an engine that exited non-zero, wrote nothing, or wrote something whose first five bytes are not `%PDF-`. **A figure needs the rendering its format understands**: HTML embeds the SVG the tool drew, LaTeX has no SVG support and embeds the PNG the SAME tool produced from the same spec, and both travel with the document as assets (`assets/figure-1.png`) so the `.tex` is buildable outside the run. **A diagram is not a figure**: a Mermaid block is source, so a roadmap with no static rendering is reported as NOT EMBEDDED in both formats (`assets.dropped`) instead of being printed under a caption, and a submission carrying one is refused by `compile-asset-unembeddable`. **What is not here**: a deployment that names no drawing provider still has a roadmap whose only form is Mermaid, so its package reports that float as one its documents cannot carry.

- **A Zotero attachment's own file can be read, at one version or not at all** (2026-09-19): `src/zotero-provider.ts` gained `readAttachment(itemKey, attachmentKey)`, which returns the file's bytes with `sha256`, `size` and the attachment's `{ key, version, contentType, filename }` — everything a reader needs to show a stored copy is the copy this read produced — and **it is off unless a deployment turns it on**: `sourceLibrary.attachments` (or `literatureSearch.attachments` on the `zotero` channel) is `'none' | 'local-cache'` and **omitted is `'none'`**, under which the method refuses with `attachment-disabled` **without making a request**. **The endpoint names the file; it does not serve it** — measured against Zotero 9.0.6, `GET {apiBase}/{library}/items/{attachmentKey}/file` answers `302` with `Location: file:///…/storage/<key>/<name>.pdf` and an empty body, and following that redirect is refused by Node's HTTP layer ("URL scheme must be a HTTP(S) scheme"), so the read resolves the location and takes the bytes from **there**; a library that streams the bytes is used as it arrives, and a location that is not a file on this machine is refused rather than followed. **The one-version rule is the source rule**, applied to a file: the attachment's record is read before the bytes and again after them, and a file whose version moved in between is refused with `version-moved` — there is deliberately **no retry**, because a later version's bytes would be a coherent record of the wrong file. `sha256` is over the bytes actually returned, and **no path leaves this module**: a failure sentence names the error code (`ENOENT`) and not where this disk keeps the file, for the same reason the `.bib` rule below stands unchanged. **The `.bib` rule is untouched**: this adds no `file = {…}` field and stores no path — the bytes' location never enters an artifact, and `tests/zotero-attachment.spec.ts` (12 cases: the happy path, the version-moved refusal, a non-PDF attachment, a key the item does not hold, the streaming answer, a non-`file://` location, a file gone from local storage, a status with no location, an outage, and both spellings of `'none'`) plus one live case in `tests/zotero-live.spec.ts` cover it. **What is not here**: nothing stores the file anywhere — writing it beside a manuscript is the run's job, not the provider's — and the bytes' own `%PDF-` header is not asserted; what the read checks is the content type the library's own record states, the same rule `readPdfAttachments` already applies.

- **A returned bibliography entry is a claim about a source, and is checked as one** (2026-09-18, P18-07): the local Zotero route feeds the evidence chain — `layers/mcp`-free, no Web API key — and `src/zotero-bibliography.ts` owns the two halves that need no server: whether a returned entry is the source it claims to be, and what a source's identity is. **The identity is LIBRARY + ITEM KEY** (`zotero:<type>:<id>:<key>`), because an item key is unique only within one library and two libraries can hold the same key; the citation key is kept separate, as what the MANUSCRIPT prints and the citation registry's to assign. `checkBibtexEntry` refuses a tool failure saved as an entry, a renamed key, a wrong DOI, a different title, a disagreeing year, an empty author field and a reply carrying two entries — and repairs nothing, because a quietly fixed field is a bibliography nobody can trace back to the library. **`citation-js` parses** (`@citation-js/core@0.8.2` + `@citation-js/plugin-bibtex@0.8.2`, exact, with `src/citation-js.d.ts` declaring the consumed surface since neither ships types), which is what decodes `Th{\"u}ring` into an author named Thüring. **The `.bib` renders from the parsed structure**: the `file` field naming where one machine keeps a PDF is in the tool's reply and not among the fields the writer emits, so it is absent by construction, and the run's key travels in `citation-key` — measured, the writer IGNORES `id` and invents a label from author and title without it. **What is not here**: reading the library, reading a full text or a page, and judging a sentence against an evidence passage are separate acceptances; metadata and `.bib` succeeding does not stand in for them. **And an earlier reading of this repository was wrong**: `export_bibliography` needs a web API CSL engine and fails locally, which was read as "the local route cannot produce BibTeX" — the metadata tool's `bibtex` format is local and works.

- **The manuscript is compiled from the document model, and the toolchain is probed rather than assumed** (2026-09-17): `src/pandoc-compiler.ts` drives `pandoc` over the document E1 assembled — sections with their blocks, the figure as inline SVG, the equations as display mathematics, the citation markers replaced by the numbers the reference list assigned — and produces a SELF-CONTAINED HTML file and a LaTeX source. The equations are MathML rather than a script: `--mathjax` pulls a renderer in (1.78 MB self-contained, measured), and the plan asks for a document that reads with the network off, so the same document compiles to 14 KB and renders natively (also measured). **The formats are PROBED**: `PandocCompiler.probe` asks the executables what they are, so a deployment with pandoc and no LaTeX engine offers `html` and `latex` and refuses `pdf` with that reason rather than writing an empty file — the shipped bundle names `pandoc` and no engine, which is the state of this host. The seam is satisfied STRUCTURALLY, the way the prose channel is, so this package still does not depend on the research-team package. **The PDF leg is exercised where an engine exists**: `pdf-acceptance.spec.ts` compiles through this compiler with a real engine and reads the pages back with a real parser — page count, the first section's text on page 1 and the second's later — and the DOCX it writes is read as the OOXML package it is. The engine is a checkout-local TeX Live install and no shipped deployment names one, so the case SKIPS where there is none rather than passing silently. **What is not here**: the compile's typography is pandoc's default, not a journal template, because no journal template has been read (see the TRC checklist).

- **The compiler states the mathematics its engine cannot set, and refuses only what it cannot** (2026-09-18): a real manuscript wrote `Δ` and `−38.2` in its prose — correctly, because that is what the study computed — and pdfLaTeX refused the whole document with `Unicode character Δ (U+0394)`. `TEX_MATH` is an explicit short table of mathematical characters, and a character in it is restated as `\ensuremath{…}`; anything else is left exactly as the manuscript wrote it. **Not `$…$`**: pandoc refuses to read `$…$` as mathematics when the closing `$` is followed by a digit, so the first version produced the literal `\$-\$38.2` (measured). Only the two formats pandoc writes through LaTeX take it — HTML is UTF-8 and a DOCX is OOXML, and both set these characters out of the reader's own font. **A reference is data**: `西南交通大学学报：英文版` is the venue name OpenAlex returned, the compiler does not rewrite it, and the optional PDF leg then fails with the character NAMED (`engineFailureOf` reads the engine's log, so batch mode's silence no longer hides it) while the DOCX and LaTeX deliverables carry it verbatim. Compiling that manuscript through a real engine (TeX Live 2026, pdfTeX 1.40.29) produced an 86 KB `%PDF-1.7` whose content stream carries the prose, the minus as a mathematics glyph, the table's cells and two image objects.

- **A reviewer the deployment supplies, and what "independent" has to mean** (2026-09-18): `src/llm-reviewer.ts` implements the two seams the team package declares and no deployment had ever filled — whether a passage establishes THIS sentence, and whether a revision answers the issue it was written for. It is built on `LlmProseWriter` for its failure handling, and it decides exactly two things: the verdict and the basis. The read scope is copied from the judgement, because a verdict cannot claim a broader reading than the one that was made; the identity, both content versions, the reader's version and the timestamp are filled by the class, because a reader that could write its own provenance could certify anything. **A reply with no verdict, or with one outside the known set, THROWS** rather than defaulting — the seam exists because "nobody could read this sentence" is a different fact from "this sentence holds". **Identity is the ROUTE** (`llm:<provider>/<model>`, never a role label), so a reviewer configured on the route that wrote the answers is refused by D4's independence check instead of passing under a different name. The shipped bundle enables the assessor and leaves the verifier unnamed with its reason written down: this deployment writes its prose on the same route, so naming it would make D4 refuse every verification.

- **A failed turn is now a failed write, whatever text it emitted** (2026-09-16): the failure check sat INSIDE the zero-length branch of `LlmProseWriter.write`, so a session that died after producing a few sentences — a provider error mid-stream, a cancelled request, a tool call that never came back — returned those sentences as the step's product, and the step certified prose no turn ever finished writing. The failure is checked first now, and the message carries both the reason and how much unfinished text it refused. The failure is read from the **final** `turn/end`: an earlier turn that failed while a later one succeeded is a session that recovered, not one that failed.
- **A reference now carries a year, and this chain was missing only the provider** (2026-09-16). `LiteratureHit` had **no `year` field at all**, so `OpenAlexLiteratureAdapter` dropped the `publication_year` the catalogue had already supplied: in one real run's export, all 25 references named a venue, authors and a DOI and **not one of them carried a year**. The rendering side was ready — E1 reads `year` off each entry and `formatReference` in `paper-format.ts` renders it — and nothing upstream produced it. `LiteratureHit.year` is now optional and `toHit` reads the catalogue's field, **leaving it absent rather than inventing one** when no usable year is stated (`null`, `forthcoming`, and a five-digit number all mean "the catalogue did not say"), because an invented year is not a missing field but a wrong citation.
- This service **does not write gate results back to StepState automatically**. That is a deliberate design boundary (the service is a pure delegation layer, and the driver decides when to call `submitGateVerdict` / `completeStep`), not a contract gap — the home for `hold_abstained` is provided by core (the state machine pins an abstained step at `gated` and records `holdReason='gate_abstained'`).
- **Tool registration now waits for the `tools` service to appear (fixed 2026-09-14).** Previously the engine mounted the seven-tool plugin directly in `[Service.init]`, while the loader starts its entries **concurrently**: on a real 1120 boot, `ctx.get('tools')` measured `undefined` at engine initialization and appeared only about 50 ms later. That mount was therefore skipped permanently, and **the shipped bundle never registered a single research tool**, while a tolerant branch swallowed the skip. It now uses `ctx.inject(['tools'], …)`, so registration commits the moment the service becomes available; `ctx.research.toolsReady` is its commit-point state.
- The semantics of `requireResearchTools` were corrected accordingly: it is **not** "no tools service means you may not start" (during loading that absence cannot be distinguished from "not up yet"), but rather "the service is there, yet the registration produced no Ours — throw instead of swallowing it". The shipped bundle sets it.
- **Calls to `pipeline_only` tools do not go through the host runtime — this is an accepted architectural boundary, not a defect awaiting repair** (user ruling, 2026-09-14).
  - Four tools (`literature-search` / `citation-verify` / `claim-construct` / `ablation`) are **called directly by the research layer**. They **do not** enter the host tool runtime, so they are **not** covered by the host's permission checks, sandbox, or execution record. The research layer keeps its own input/output correlation and error records — but that **is not the same as** "uniformly managed by the host", and **must not be described that way**.
  - **This does not affect the work they do, nor whether the data is real**: these four tools execute as usual and can also handle real data (the retrieval channel is configured by `cordis.yml`; configure a live catalogue and they hit the live catalogue). What is missing is only that one layer of host-side uniform management.
  - **Two independent facts, and the label describes only one of them**: how a tool is invoked is recorded in the artifact's `invokerTruthfulness` (`direct_call` / `host_tool_runtime`); where the data came from is recorded in the adapter configuration and in the artifact's own `corpus` / `source` / `*Source` fields. **A direct call does not mean fixture; using real data does not mean the conclusion is verified** — and the two labels together still do not amount to "this conclusion was verified".
  - **When to revisit it**: when untrusted plugins, multiple users, or independent tasks genuinely need uniform permission / cancellation / timeout / audit control, start a separate host-interface extension then (the public interface of `packages/core/tools`). **Whether to connect a real model is not a reason to rework it** — those two things are independent of each other.
  - The prohibitions are unchanged: do not forge an Agent, call host private methods, deep-import internal modules, or restore agent-less pass-through.

No invariant companion is published: the adapter's effect and teardown relations are asserted by its own lifecycle and registration specs, so nothing is published as an `./invariant` companion.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
