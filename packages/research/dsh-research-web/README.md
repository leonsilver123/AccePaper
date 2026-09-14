# @deepseek-ai/dsh-research-web

English | [中文](README.zh.md)

The dual-face plugin of the research workbench. The host half is deliberately inert (it performs no host registration), while the browser half mounts the `research` tab of the `conversation.view` slot as 9 panels: Summary / Pipeline / Figures / Tables / Roadmap / Gates / Adversarial / Approval / Recovery.

The panels are derived from a run summary by pure selectors in `panels.ts`, and `summary.ts` is a dependency-free view model, so both are unit-testable without Cordis. Copy goes through the `zh` / `en` dictionaries in `client/locales.ts`, following the client's locale-ownership convention.

## Known Limitations and Deferred Work

- **The real data path is connected** (2026-09-14): the workbench can start a real run through `ctx.remote.research.run({})` and render it, with the badge following the data source. The default (nothing run yet, or a failed run) is still the demo run from `fixture.ts` — a failure reports itself truthfully rather than leaving a fixture on screen pretending to be a result.
- The component **already has an injection seam**: `ResearchWorkbench` accepts three props — `summary`, `onRun`, `onApprove` (inject a summary, start a run, submit a human verdict) — and falls back to `loadFixtureSummary()` only when both `summary` and `onRun` are absent.
- **Human approval is wired to the backend** (2026-09-14): `client/approval-source.ts` sends the verdict over `ctx.connection.rpc.call('/research-approval', 'decide', ...)` to the channel `dsh-research-team` registers and the host browser-authenticates, and the panel renders only the status, attempt, and operator the backend returns; a rejection, an invalidation, or a transport failure **reports itself truthfully** and leaves the step awaiting review. When `onApprove` is absent (a deployment with no browser-authentication channel) the two buttons are **disabled** with the reason stated, rather than displaying a decision nobody made.
- The recovery panel is still a **display-only placeholder**: its button reloads the same fixture.
- **Test coverage has been completed** (B5): all 9 tabs are clicked, and every selector in `panels.ts` is imported; the host half of `src/index.ts` is a deliberately empty body (the view is mounted by the client half), so no test references it.

No invariant companion is published because the package publishes no runtime invariant entry: its host half is intentionally inert, leaving no companion to publish.

- **The run wiring is complete, but unverified by an actual browser run** (2026-09-14). The research tab can now start a real run: `ctx.remote.research.run({})` → mapping in `run-source.ts` → rendering by `ResearchWorkbench`. The host half is covered by a spec that mounts the real service, the client half by jsdom specs against a stubbed namespace, both typecheck faces and both builds pass, and the 1120 boot loads successfully. **No browser has ever driven this tab against a running Host** — so the tab stands at Integration-verified, not Runtime-verified.
- **The approval panel is likewise only Integration-verified**: its submitter is covered by jsdom specs against a stubbed Connection service, and `dsh-research-team/tests/approval.spec.ts` covers the backend checks and each invariant in §8.1; what was verified on a real socket is **the channel itself** (no cookie → 401 and the handler is not called; token exchanged for a cookie → 200 and a backend record written; forged cookie → 401), not this click in a browser.
- **The `summary` payload shape is a structural twin declared by this package.** The service compiles on the Host face and this package on the Client face, and a client bundle takes no cross-plugin value dependency, so `WireRunSnapshot` in `run-source.ts` is a **restatement** rather than an import. A field name that differs between the two sides makes the view silently empty. The host-side integration spec asserts exactly the same set of field names.
- **The MOCK badge now follows the data source** (`summary.isMock`). It used to be unconditional, so even an injected real run was still labelled "demo data"; `RunSummary.isMock` also changed from a literal `true` into a derived value.
