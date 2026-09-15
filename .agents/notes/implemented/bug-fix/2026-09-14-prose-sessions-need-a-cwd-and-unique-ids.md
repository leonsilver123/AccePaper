# Agent Note: Prose sessions need a working directory, and ids that survive a restart

Status: implemented

English | [中文](2026-09-14-prose-sessions-need-a-cwd-and-unique-ids.zh.md)

## Problem

`LlmProseWriter` is the channel that turns a prose step (A1 gap analysis, D2 outline, D3 writing, D4 rebuttal) into text produced by a model. It creates an agent through `ctx.agentLoop.create` and reads the assistant text back out of that agent's session. A deployment configures it with a provider route; the shipped `research-app` bundle does.

It had never been executed. Driving it on a real boot produced, in order, four distinct defects that all reported as **one** string — `the model produced no text (no default pass)`.

1. **Unresolved service read.** The writer read `ctx.agentLoop` through the property proxy. That proxy resolves only for a context that declares `agentLoop` in its `inject`; the writer is constructed by the research engine, which does not. The read threw before any request existed.

2. **No working directory.** `agentLoop.create(id, options, meta)` takes the session's creation metadata as its **third** argument, and `meta.cwd` is the only source of the `{{cwd}}` system-prompt variable (`ctx.systemPrompt.variable('cwd', c => c.agent?.session.header.cwd)`). The writer, and the agent-loop tool invoker beside it, passed two arguments. `{{cwd}}` is a **strict** variable and every shipped bundle's persona references it, so prompt assembly threw `prompt variable "{{cwd}}" has no value for this assembly (section "deployment:persona")` and **the request never reached the provider** — no `assistant/*` event was ever emitted.

3. **Session id collisions.** The session id was `research-prose-${counter}`, a per-process counter that restarts at zero on every boot. Sessions are persisted, so on the second run the store rejected the id: `session "research-prose-0" is already persisted at a different cwd`. Where the working directory happened to match, the outcome would have been worse than an error — the write would have resumed a previous run's session and pulled its assistant text into this step's product.

4. **The masking itself.** Every one of the above left the session with no assistant text, and the writer reported all three as "the model produced no text". A neutral phrase covering an unresolved service, an assembly failure, and an id collision is what kept this channel undiagnosed.

Two contracts were also wrong at the edges: the writer attached its abort listener only after several awaits, so a signal that arrived already aborted was silently ignored and the write ran to completion against a cancelled request; and it had no way to tell "the provider failed" from "the model replied with nothing".

## Decision

- Both session-creating call sites pass an absolute `cwd`, and it is **required** in their configs rather than defaulted at the call site. `ResearchEngine` resolves it once, from a new `workspace` config field, through an explicit `resolveWorkspace` step that rejects a relative path with a clearer error than the session layer would produce. `Config.prose` is typed `ProseChannelConfig = Omit<LlmProseWriterConfig, 'cwd'>` so a deployment states the directory once per deployment, not once per row.
- Session ids carry a `randomUUID()`. A counter cannot be safe against a persisted store.
- The writer checks `request.signal?.aborted` **before** its first await, and rejects.
- A write that produced no text now distinguishes the two outcomes: a turn that ended in error is reported with **its own message** (`turnErrorOf` reads `turn/end`'s `reason.error`), and only a turn that ended normally with no text is reported as producing none.
- `AgentLoopResearchToolInvoker` — same two defects, no production caller yet — takes the same required `cwd` and the same unique session id.

## Admission and ownership

`ResearchEngine` owns the working directory because it already owns the other deployment-level choices (`toolDeps`, `proseWriter`); one value governs every session the engine creates, so the writer and a future invoker cannot disagree. The writer owns the failure taxonomy: it is the only component that reads the session events back.

The prose channel is **not** claimed to be Runtime-verified by this note. On this host the request now reaches the provider layer and stops there, reported verbatim as `llm-deepseek: no API key for provider route "deepseek-official"` — which is the correct posture for a deployment with no credential. Producing text requires the deterministic offline route tracked in `plan/PRODUCT-CLOSURE-EXECUTION.md` as P1c.

## Alternatives considered

**Derive `cwd` from `process.cwd()` inside each call site.** Rejected: it hides the deployment's choice inside the operation that happens to need it, which is the pattern the repository's explicit-over-implicit rule names (`dsh-shell`'s request/spec split is the template).

**Make `cwd` optional and default it later.** Rejected: the failure it prevents is a prompt-assembly throw, and a missing value is exactly the case that must fail loud.

**Keep the counter and clear persisted prose sessions at boot.** Rejected: it couples the writer to a cleanup step it does not own, and a crash between the two reintroduces the collision.

**Report every empty result as an error with the last turn's reason, whatever it is.** Rejected: a turn that ends normally carrying no text is a real, distinct outcome (the model replied with only a tool call, or with nothing) and naming it as a provider failure would misattribute it.

## Consequences

- A deployment that configures `prose` but runs under a persona that references `{{cwd}}` now works without further configuration, because the engine supplies the directory.
- Every prose write is a fresh session, so a restarted process cannot resume last run's prose.
- Failures from this channel name their own cause, which is what let defects 3 and 4 be seen at all: each fix moved the reported error one layer deeper instead of ending in the same neutral sentence.
- The package's spec harness now mounts a persona that references `{{cwd}}` on purpose, so the missing-directory regression fails a test rather than a boot. It asserts that the request **reached the adapter**, not merely that text came back — the assertion whose absence hid the original bug.
