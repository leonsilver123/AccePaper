---
description: "The seven research-pipeline tool implementations with their closed input schemas and the ResearchToolInvoker seam, for the adapter that registers them on a host."
kind: "package-reference"
---

# @deepseek-ai/dsh-research-tools

English | [中文](README.zh.md)

## Summary

The seven research-pipeline tools — literature search, citation verification, claim construction, ablation, figure, three-line table and roadmap — each a pure function with a closed input schema and a frozen artifact as its answer. A host supplies the corpus through an injected adapter, so one tool runs over a fixture corpus or a live catalogue without a code change, and `ResearchToolInvoker` is the seam a host executes one through. Registration on `ctx.tools` belongs to `dsh-research-cordis`, so this package depends on no Cordis and exposes no `ctx` surface of its own. Each tool states its model exposure and the reason for that judgment in `RESEARCH_TOOL_DIRECTORY`.

## Table of Contents

- [The tool directory](#the-tool-directory)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="the-tool-directory"></a>
## The tool directory

The seven tool implementations of the research pipeline (literature search / citation verification / claim construction / ablation / figure / three-line table / roadmap), plus their **closed input schemas** and the `ResearchToolInvoker` seam. This package is a pure library: it does not depend on Cordis, and registration and host wiring are owned by `dsh-research-cordis`.

`RESEARCH_TOOL_DIRECTORY` is the audit source of truth for the tools: each tool entry records `modelExposure` (`pipeline_only` or `model_ready`) together with a `reason` stating why that judgment holds. The tool functions themselves are pure; external data enters only through the adapter seam.

<a id="model-experience"></a>
## Model Experience

### Research tool directory entries

#### What the model sees

The directory supplies the name and the opening sentence of the description of every research tool definition a host registers: `literature-search`, `citation-verify`, `claim-construct`, `ablation`, `figure`, `three-line-table` and `roadmap`. The three entries whose exposure is `model_ready` open with these sentences.

##### Model-callable entry summaries

```markdown
Deterministic SVG + real-byte PNG data-figure render over a declared spec.
One structured model rendered as GitHub Markdown (3 rules) or LaTeX booktabs.
Phase-layered roadmap figure render (figure family of D1).
```

#### Token effect

Fixed. Seven tool names and one summary sentence each travel with the tool definitions on every request that carries them, and the directory adds no text as a run advances.

#### KV Cache effect

Prefix-stable. The names and summaries are byte-identical for a given directory revision and do not invalidate reuse; a change to a `summary` or a `toolId` replaces part of the tool-definition prefix and can invalidate reuse from the first changed token.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **`LiteratureHit` carries a year now** (2026-09-16): it had **no `year` field**, so no adapter could hand over the year its source had already stated, while everything downstream was ready to read one. The field is optional, and **absent means "the source did not say"** — an adapter must not fill it with a placeholder, because an invented year makes an unplaceable reference look complete. The synthetic corpus states one too, so the renderer's year branch is exercised by the fixture and not only by the live catalogue.
- **All seven tools currently take fixture input**: the tool functions really execute, but the data fed to them is synthetic, so their output does not constitute a real research result. This is the honest boundary corresponding to the `real_tool_fixture_input` label in `runner/registry.ts`.
- The `citation-verify` tool **has no production consumer**: the team-side B channel goes through core's `verifyCitation` rather than this tool; it stays registered in the directory to satisfy the "seven tools" roster declaration.
- External data sources (Crossref / OpenAlex / tier tables) all go through the adapter seam; the repository ships no real credentials and no dataset whose licence is unconfirmed.

No invariant companion is published: the tool contracts are frozen by the directory entries and covered by the package's own specs, so no `./invariant` entry is published alongside it.

- **How a tool is invoked and where its data comes from are two independent facts, and the label describes only the former** (2026-09-14). `ResearchToolTruthfulness` has exactly two values: `direct_call` (the research layer calls the tool function directly) and `host_tool_runtime` (executed through the tool runtime the host agent-loop mints). **`direct_call` says nothing about what the data is** — a direct call is not automatically a fixture; by the same token, a channel that goes through the host runtime can also receive fixture input. What the data is is recorded in the adapter configuration and in the artifact's own `corpus` / `source` / `*Source` fields. **Neither label, nor the two together, means "the conclusion has been verified."** The direct calls of the four `pipeline_only` tools are an **accepted architectural boundary**; see the `dsh-research-cordis` README.

-----

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
