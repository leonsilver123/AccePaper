# @deepseek-ai/dsh-research-cordis

English | [中文](README.zh.md)

The Cordis adapter for `dsh-research-core`: it exposes the 16-step engine as the `ctx.research` service and registers the seven research tools on the host's real `ctx.tools`.

This package is a **thin adapter layer**: the state machine is delegated to core, while tool registration — together with transactional rollback, revocable handles, and a module-private capability — is implemented here. The service also delegates the pure result surfaces of T07/T08/T09 (`classifyL0` / `verifyCitation` / `evaluateGate` / `getGateIntent`); those methods touch no run state.

## Deployment-level configuration

Each of the four fields represents **one** deployment-level choice, decided once by the engine and shared by the whole pipeline:

| Field | What it decides | When omitted |
|---|---|---|
| `evidenceProfile` | What this deployment's evidence is allowed to be, and whether its output may be submitted (`production` or `evaluation`) | `evaluation`: synthetic evidence is admitted, so the run's output is unsubmittable |
| `literatureSearch` / `citationResolver` | Which catalogue the retrieval and citation-identity chains read (`fixture` or `openalex`) | fixture (offline) |
| `prose` | Which provider route the text-producing steps run on | The text-producing steps emit their fixture text and call no model |
| `workspace` | The absolute working directory of **every** agent session the engine creates | `process.cwd()` |

`workspace` is not optional: `{{cwd}}` is a **strict** system-prompt variable, and every shipped bundle's persona references it. A session with no working directory fails at the **prompt-assembly** stage — **before** any request reaches a provider. The `prose` row does **not** restate the directory (`ProseChannelConfig` `Omit`s it), so each deployment states it in exactly one place.

## Known Limitations and Deferred Work

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
