# @deepseek-ai/dsh-research-tools

English | [中文](README.zh.md)

The seven tool implementations of the research pipeline (literature search / citation verification / claim construction / ablation / figure / three-line table / roadmap), plus their **closed input schemas** and the `ResearchToolInvoker` seam. This package is a pure library: it does not depend on Cordis, and registration and host wiring are owned by `dsh-research-cordis`.

`RESEARCH_TOOL_DIRECTORY` is the audit source of truth for the tools: each tool entry records `modelExposure` (`pipeline_only` or `model_ready`) together with a `reason` stating why that judgment holds. The tool functions themselves are pure; external data enters only through the adapter seam.

## Known Limitations and Deferred Work

- **All seven tools currently take fixture input**: the tool functions really execute, but the data fed to them is synthetic, so their output does not constitute a real research result. This is the honest boundary corresponding to the `real_tool_fixture_input` label in `runner/registry.ts`.
- The `citation-verify` tool **has no production consumer**: the team-side B channel goes through core's `verifyCitation` rather than this tool; it stays registered in the directory to satisfy the "seven tools" roster declaration.
- External data sources (Crossref / OpenAlex / tier tables) all go through the adapter seam; the repository ships no real credentials and no dataset whose licence is unconfirmed.

No invariant companion is published: the tool contracts are frozen by the directory entries and covered by the package's own specs, so no `./invariant` entry is published alongside it.

- **How a tool is invoked and where its data comes from are two independent facts, and the label describes only the former** (2026-09-14). `ResearchToolTruthfulness` has exactly two values: `direct_call` (the research layer calls the tool function directly) and `host_tool_runtime` (executed through the tool runtime the host agent-loop mints). **`direct_call` says nothing about what the data is** — a direct call is not automatically a fixture; by the same token, a channel that goes through the host runtime can also receive fixture input. What the data is is recorded in the adapter configuration and in the artifact's own `corpus` / `source` / `*Source` fields. **Neither label, nor the two together, means "the conclusion has been verified."** The direct calls of the four `pipeline_only` tools are an **accepted architectural boundary**; see the `dsh-research-cordis` README.
