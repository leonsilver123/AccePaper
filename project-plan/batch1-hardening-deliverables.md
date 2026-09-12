# Batch 1 Contract Hardening — Deliverables Report

**Status:** IMPLEMENTED + VERIFIED (all green) + ADVERSARIALLY HARDENED (RC-E contract-level closed; residual documented).
- `5a795af` "Batch 1 Contract Hardening: trust boundary + hardened state machine" (after
  `48b5fd7` T03) — closes the 10 confirmed defects (P0-1, P0-2, P1-1..P1-8) and pins the
  trust boundary so an Agent tool calling `ctx.research` cannot forge approval, pass a gated
  step without adjudication, prematurely start a downstream step, mutate internal state, or
  leak across runs.
- `93d9064` "adversarial-verify follow-up: close 4 root-cause bypasses" — the
  adversarial-verify workflow (16 attack angles on `5a795af`) found `5a795af` STILL had
  14 confirmed bypasses collapsing to 4 root causes (RC-A/RC-B/RC-C P0; RC-D P2, flagged).
  This commit closes all 4: deep-frozen step singletons + removed public re-export +
  removed `./src/*` hatch (RC-A/B); module-scoped adapter store (RC-C, not `#runs` which is
  incompatible with Cordis's service Proxy); strengthened frozen-input guard (RC-D).
- `0e7133a` "adversarial-verify re-verify fixes: close RC-E (trust-channel
  re-arch) + RC-F (verdict TOCTOU)" — the 16-angle re-verify on `93d9064` found **2 NEW**
  confirmed bypasses (14 clean — the original 14 were closed by `93d9064`). Both close here.
  **RC-F** (P1-5 verdict-immutability TOCTOU): `submitGateVerdict` read `verdict.component`
  4× via live property access; a getter-bearing verdict returning a different component per
  read made the immutability `in`-check see a fresh component (no throw) while the storage
  key overwrote an existing verdict, flipping adjudication blocked→passed. Fix: read
  `verdict.component` ONCE into a local (gate check + immutability + storage all use it).
  **RC-E** (P0-1 trusted-principal-forge): the prior `instanceof TrustedHumanPrincipal` guard
  was defeated by `Object.create(TrustedHumanPrincipal.prototype)`; plus `create()` +
  `_resetApprovalChannelForTests()` were exported from the prod `./host` subpath. Full
  re-architecture (Option A, strictly trust-boundary hardening — no other API expanded):
  per-channel module-private **WeakSet** as the sole principal identity guard (unforgeable —
  not enumerable, not copyable); principals minted ONLY via `channel.mintPrincipal(runId,
  stepId, principalId, approvalEventId)`; `create()` removed; prod `./host` built from
  `host-prod.ts` (re-exports `createHostApprovalChannel` + the `HostApprovalChannel`/
  `TrustedHumanPrincipal` TYPES only) so `_resetApprovalChannelForTests` is tree-shaken out of
  `lib/host.js` + the runtime class is not exported (no prototype to `Object.create`);
  `submit` verifies object identity + owning channel + runId + stepId + principalId-in-registry
  + the current pending-approval step. **Contract-level closed** given host-startup-
  precedes-tool-execution; residual (same-process same-privilege) needs process isolation.
Baseline `c6731f7`. Full patch `c6731f7..0e7133a`. Date: 2026-09-03.

---

## 1. Updated full patch

Cumulative `c6731f7..0e7133a` (baseline → hardened → adversarial-verify fixes → re-verify fixes).

| Commit | Delta |
|--------|-------|
| `c6731f7..5a795af` | **26 files, 2142 insertions(+), 441 deletions(-)** — the Batch 1 Contract Hardening (closes the 10 defects; pins the trust boundary). |
| `5a795af..93d9064` | 4 root-cause fixes (RC-A/B/C/D) + 5 pinning tests — closes the 14 bypasses round-1 found on `5a795af`. |
| `93d9064..0e7133a` | **8 files, 398 insertions(+), 87 deletions(-)** — closes the 2 NEW bypasses round-2 found on `93d9064` (RC-E trust-channel re-arch + RC-F verdict read-once). |

`0e7133a` touched (RC-E/RC-F):
- `dsh-research-core/src/host.ts` — re-arch: per-channel `WeakSet` identity (RC-E E1);
  `channel.mintPrincipal(runId, stepId, principalId, approvalEventId)` (RC-E E2); `TrustedHumanPrincipal.create()`
  removed; ctor token-gated (module-private `MINT_TOKEN`); `submit` verifies identity+channel+runId+stepId+registry+pending step.
- `dsh-research-core/src/host-prod.ts` (**new**) — prod `./host` entry; re-exports
  `createHostApprovalChannel` + the `HostApprovalChannel`/`TrustedHumanPrincipal` TYPES only →
  `_resetApprovalChannelForTests` tree-shaken out of `lib/host.js` + runtime class not exported.
- `dsh-research-core/src/engine/state-machine.ts` — RC-F: `submitGateVerdict` reads `verdict.component`
  ONCE into a local (gate check + immutability + storage all use it).
- `dsh-research-core/tests/host.spec.ts` — rewritten to the `mintPrincipal` API + adversarial tests
  #1/#2/#3/#4/#6 + functional + direct-construction token-gate.
- `dsh-research-core/tests/state-machine.spec.ts` — RC-F tests #8 (getter can't overwrite) + #9
  (immutable per attempt; new-attempt re-submit); + RC-A cast fix (`as unknown as`).
- `dsh-research-core/tsdown.config.ts` — `entry: { index: 'src/index.ts', host: 'src/host-prod.ts' }`
  (object form; `host-prod.ts` → `lib/host.js`).
- `dsh-research-core/package.json` — `./host` types → `./lib/types/host-prod.d.ts`.
- `dsh-research-cordis/tests/prod-import-smoke.mjs` (**new**) — plain-Node prod import/export smoke
  (adversarial #5/#7/#10).

## 2. State transition table

In `hardening-design.md` §4 + §13.H (v2 authoritative). Legal forward edges:

```
pending ──► in_progress
in_progress ──► gated | passed | blocked | failed
gated ──► passed | blocked
(passed | blocked | failed) ──► [terminal; only rollback exits]
```

`_apply` is the **sole forward-edge mutator** (module-private; LEGAL_TRANSITIONS guard +
humanGate→passed guard). `_adjudicate` is the **sole gate adjudicator** (anyFail +
falsifiable C-fail → failed; any other fail → blocked; else humanGate→gated /
non-humanGate→passed). Terminal states are exited only by `rollback` (which cascades).

## 3. Human Approval trust boundary doc

In `hardening-design.md` §6 + §13.A (v2 authoritative); re-architected in `0e7133a` (RC-E).

- **Main entry** `@deepseek-ai/dsh-research-core` exports ONLY non-trust state-machine
  functions (`createRun, setRunInput, getRunSnapshot, canStart, startIfCan, startStep,
  recordArtifact, getArtifact, submitGateVerdict, completeStep, rollback, isComplete,
  getAuditHistory`) + 3 error classes (`ResearchError, ResearchRunError,
  ResearchValueError` — callers catch them). A humanGate step reaches `gated` but **never
  `passed`** via the main entry. `transition` + `approveHumanGate` are DROPPED from core.
- **`./host` subpath** — the prod entry is `host-prod.ts` → `lib/host.js` (re-exports ONLY
  `createHostApprovalChannel` at runtime + the `HostApprovalChannel`/`TrustedHumanPrincipal`
  TYPES). `_resetApprovalChannelForTests` is NOT re-exported → tree-shaken out of `lib/host.js`;
  the runtime `TrustedHumanPrincipal` class is not exported at runtime (no prototype to
  `Object.create`). Verified by `prod-import-smoke.mjs` (HOST runtime exports ==
  `createHostApprovalChannel` only). So an Agent importer cannot obtain: the prototype, `create()`
  (removed), `mintPrincipal` (a method on a channel INSTANCE, not a free export), `_reset…`
  (tree-shaken), or a channel instance (singleton + module-private `activeChannel`).
- **`createHostApprovalChannel(hostSecret)`** — SINGLETON (throws
  `DSH_APPROVAL_CHANNEL_EXISTS` on re-create; `hostSecret` required). **No host/bootstrap code
  calls it today** (repo-wide grep — `apps/`/`packages/host/`/harness entry have zero
  references; only the library + tests reference it; `DSH_APPROVAL_SECRET` appears only in
  `host.ts` comments). The `host.ts` comment describes the INTENDED one-call-at-startup
  integration (mint from `process.env.DSH_APPROVAL_SECRET`) as a FUTURE host-wiring task
  (Interaction phase), not implemented code. The singleton gate is defense-in-depth for that
  future integration; the ACTUAL load-bearing defense against host-run self-approval is RC-C
  (store isolation — §3.A + residual below), which IS code-enforced today.
- **Principal identity (RC-E E1)** — a module-private per-channel `WeakSet<TrustedHumanPrincipal>`
  is the SOLE identity guard. `submit` admits a principal iff `weakset.has(principal)` —
  object identity + owning channel. WeakSet membership is UNFORGEABLE: not an own property
  (invisible to `getOwnPropertyNames`/`getOwnPropertySymbols`) and not copyable from a legit
  principal (`has` is by identity, not by copied properties/symbols). `Object.create(
  TrustedHumanPrincipal.prototype)`, forged same-field plain objects, and copied-property
  principals are all rejected. The ctor is token-gated (module-private Symbol `MINT_TOKEN`) so
  `new TrustedHumanPrincipal(...)` outside `channel.mintPrincipal` throws.
- **Principal minting (RC-E E2)** — principals are minted ONLY by
  `channel.mintPrincipal(runId, stepId, principalId, approvalEventId)`, which stamps the instance
  into THIS channel's WeakSet + binds it to `(runId, stepId)`. `TrustedHumanPrincipal.create()`
  is REMOVED. `submit` verifies: object identity (WeakSet) + owning channel + `principal.runId===runId`
  + `principal.stepId===stepId` (cross-run/cross-step rejected) + `principal.principalId ∈
  channel.registry` (host-populated, P0-1-H5), then delegates to the package-private
  `_applyHumanApproval` which re-checks `status==='gated'` (the current pending-approval step,
  C-2) + `step.humanGate` + `approvalEventId ∉ run.consumedApprovals` (INV-REPLAY, P0-1-H4).
- `isComplete`: humanGate requires `approval.decision==='approved' AND
  approval.attempt_id===state.attempt_id` (INV-COMPLETE-ATTEMPT).
- **Contract-level closure + residual (honest, REFRAMED after the host-startup-order audit in
  §3.A):** the closure does NOT rest on host-startup-precedence. It rests on **RC-C (store
  isolation, code-enforced)** + **RC-E (principal forge closed)**:
  - `HostApprovalChannel.submit(runs, runId, stepId, decision, principal)` takes the run store
    `runs` as its FIRST parameter (caller-supplied). An Agent importer CANNOT obtain the host's
    store reference: in the Cordis adapter the store is a MODULE-SCOPED `const runs = new Map()`
    (`dsh-research-cordis/src/index.ts:75`), accessed lexically by every method (never via
    `this.runs`), so `ctx.research.runs` is undefined and `getOwnPropertyNames`/`Reflect.ownKeys`
    do not surface it (verified by `lifecycle.spec.ts` RC-C + round-3 `host-secret-channel`
    angle against the built lib). The pure-core functions also require a store parameter; an
    Agent that imports them supplies its OWN isolated Map.
  - Therefore even if an Agent PRE-EMPTS `createHostApprovalChannel` (gets the singleton), its
    channel can only approve runs in a store IT controls — NOT the host's module-scoped store.
    The host never observes the Agent's own-store runs, so the pre-emption is **INERT for host
    runs**; it yields only own-store self-approve (the documented residual).
  - **host-startup-precedence is NOT code-enforced** (§3.A): NO host/bootstrap code calls
    `createHostApprovalChannel` today. The host.ts comment's "host calls it ONCE at startup" is
    INTENDED integration (future host-wiring task, Interaction phase), not implemented code.
    When wired, precedence becomes a SECONDARY defense-in-depth (blocks the Agent from even
    obtaining a channel); the PRIMARY defense (RC-C, store isolation) already holds today.
  - TRUE enforcement against same-process same-privilege malicious code requires process-level
    isolation / IPC identity auth / host-side unforgeable authorization (Interaction phase,
    future) — TS/JS API cannot provide it. `0e7133a` is contract-level hardening, NOT system-
    level security isolation.

### 3.A Host startup-order evidence (audit, 2026-09-03)

Repo-wide grep for `createHostApprovalChannel`|`HostApprovalChannel`|`mintPrincipal`|
`registerPrincipal`|`DSH_APPROVAL_SECRET` across `D:/1/deepseek-harness-master1/deepseek-harness-master`:

1. **Who calls `createHostApprovalChannel`?** — NOBODY in the current codebase. References exist
   ONLY in: the library itself (`src/host.ts` definition + comments, `src/host-prod.ts`
   re-export), tests (`host.spec.ts`, `prod-import-smoke.mjs`, `lifecycle.spec.ts`,
   `state-machine.spec.ts`), and comments in `types.ts`/`state-machine.ts`/`index.ts`. No host
   bootstrap, no `apps/`, no `packages/host/`, no harness entry calls it. `_applyHumanApproval`
   (the package-private approval function) is called ONLY by `HostApprovalChannel.submit`
   (`host.ts:163`); nothing else calls it. `DSH_APPROVAL_SECRET` appears ONLY in `host.ts`
   comments (`:110`, `:118`) — no code reads `process.env.DSH_APPROVAL_SECRET`.
2. **Which lifecycle stage?** — N/A (no caller exists). The INTENDED stage is host process
   bootstrap (host.ts comment: "the host calls it ONCE at startup"), before any session/prompt
   executes. This is design intent for a future host integration, NOT implemented code.
3. **When do Agent plugins load?** — Cordis plugins/services load during APP COMPOSITION
   (`ctx.plugin(ResearchEngine, config)` registers the adapter; `[Service.init]` adds the
   unload effect). The web host entry is `apps/web/src/main.ts:6 void new AppWebEntry(el).run()`.
   Agent TOOLS execute later — at session/prompt time, when a Cordis session runs a prompt and
   dispatches tool calls. So composition precedes tool execution by construction (composition →
   session → prompt → tool dispatch).
4. **How does code guarantee Host-before-Agent?** — IT DOES NOT, for the approval channel. No
   host code calls `createHostApprovalChannel`, so there is no enforced ordering that mints the
   singleton before Agent tool code runs. `host-startup-precedence` is an UNIMPLEMENTED design
   assumption, not code-enforced. (Composition-before-tool-execution IS enforced for Cordis
   services generally, but the approval-channel mint is not part of any service's `init` today.)
5. **Is there an Agent pre-empt path (import `./host` + create the singleton first)?** — YES,
   the path EXISTS: an Agent importer can `import { createHostApprovalChannel } from
   '@deepseek-ai/dsh-research-core/host'` and call it before any host call → succeeds
   (`activeChannel === undefined` → mints the singleton). BUT it is INERT for host runs:
   `channel.submit` requires the HOST store as its first parameter, which the Agent cannot
   obtain (RC-C — module-scoped `runs`; `ctx.research.runs` undefined; pure-core functions need
   a caller-supplied store too). The pre-empted channel can only approve runs in a store the
   Agent controls — the host never observes those. So pre-emption yields own-store self-approve
   (documented residual), NOT host-run self-approve.

**Conclusion:** the RC-E contract-level closure does NOT depend on host-startup-precedence. The
load-bearing, code-enforced defense is **RC-C (store isolation)** + **RC-E (principal forge
closed)**. host-startup-precedence is a future secondary defense-in-depth (when the host wiring
lands), not a current guarantee. The `host.ts` comment ("the host calls it ONCE at startup… if an
Agent pre-empted the host, the host's own call throws + startup aborts") OVER-CLAIMS an
integration that is not implemented — flagged for a doc-accuracy fix (PROPOSED, not applied this
turn — repo code change needs authorization).

## 4. New test matrix

In `hardening-design.md` §10. Implemented suites (all green):

| Suite | Tests | Coverage |
|-------|-------|----------|
| `dsh-research-core/tests/state-machine.spec.ts` | 51 | export surface (no trust); run lifecycle (RUN_EXISTS, RUN_NOT_FOUND, INV-SEED-INPUT, H9, INV-INPUT-FROZEN); INV-DEP-PASSED; INV-OUTPUT-CONTRACT; gate adjudication (INV-GATE-COMPONENT, EMPTY_GATE, INV-VERDICT-STATUS, INV-VERDICT-IMMUTABLE, INV-ADJUDICATE-SHARED passed/failed/blocked, INV-COMPLETESTEP-EMPTY, C-7); INV-SNAPSHOT; INV-WRITE-ISOLATION; INV-VALUE-CLONEABLE; INV-CASCADE (direct/multi-hop/diamond/history/DEP-4/no-op/INV-FAILED-RERUN); INV-RUN-ISOLATION; INV-AUDIT-APPEND/EVENTS-IMMUTABLE; INV-COMPLETE-ATTEMPT; DAG; **RC-A** deep-freeze (3); **RC-D** rollback→reseed blocked; **RC-F** #8 getter can't overwrite + #9 immutable-per-attempt/new-attempt-re-submit |
| `dsh-research-core/tests/host.spec.ts` | 18 | singleton (#4); `create()` removed; `mintPrincipal` validation; direct-construction token-gate; **RC-E #1** Object.create(prototype) rejected; **#2** forged plain object rejected; **#3** copied properties/symbols rejected; **#6a/b/c** cross-channel/run/step rejected; submit approved/rejected; unregistered (P0-1-H5); INV-APPROVAL-STATE; INV-REPLAY; fresh-event re-approval; main entry does NOT export trust |
| `dsh-research-cordis/tests/lifecycle.spec.ts` | 6 | load (createRun+setRunInput+canStart); unload (fiber.dispose→undefined); error (RUN_NOT_FOUND); idempotent load→unload across fresh ctxs; exposes NO trust capability; **RC-C** `ctx.research.runs` is undefined (module-scoped store) |
| `dsh-research-cordis/tests/prod-import-smoke.mjs` (plain Node) | — (27 checks) | **#5** Agent can't obtain create/reset/mint/channel from prod exports; **#7** `_resetApprovalChannelForTests` not in prod (plain-Node load); **#10** plain-Node prod import/export smoke; HOST runtime == `createHostApprovalChannel` only; singleton second-create throws (#4) |

**Total: 75 vitest tests (69 core + 6 adapter), all passing.** Plus the plain-Node
`prod-import-smoke.mjs` (27 checks, ALL PASS) verifying the BUILT production export surface.

## 5. Verification evidence (all green — `0e7133a`)

| Check | Result |
|-------|--------|
| host aggregate `tsc -b tsconfig.host.json` | exit 0 (Core src incl `host.ts`/`host-prod.ts`/`state-machine.ts` typechecks against the hardened API; host aggregate excludes core tests) |
| core `tsc -p tsconfig.test.json` (src + tests) | exit 0 (the test typecheck unit — catches the test casts against `readonly` step fields) |
| workspace `tsdown --env.DSH_BUILD_FACE host` | exit 0; `lib/host.js` (built from `host-prod.ts`) **tree-shakes `_resetApprovalChannelForTests`** + does NOT export the runtime `TrustedHumanPrincipal` class; `lib/host.js` runtime exports == `createHostApprovalChannel` only |
| production Node import (HOST) | `lib/host.js` runtime exports: `createHostApprovalChannel` ONLY. `TrustedHumanPrincipal` = undefined (type-only), `_resetApprovalChannelForTests` = undefined (tree-shaken), `HostApprovalChannel` = undefined (type-only), `mintPrincipal`/`submit` = undefined (methods on a channel instance) |
| production Node import (MAIN) | `lib/index.js` runtime exports: 13 API funcs + 3 error classes (`ResearchError`/`ResearchRunError`/`ResearchValueError`). Trust leak: **none** |
| core + adapter vitest | 75/75 (3 files: state-machine 51 + host 18 + adapter 6) |
| plain-Node `prod-import-smoke.mjs` | ALL PASS (27 checks; #5/#7/#10 + singleton #4 + HOST runtime surface) |
| lockfile | UNCHANGED — `pnpm-lock.yaml` sha256 `f453b31d…` == `93d9064` == `5a795af` (RC fixes touched only source; frozen-install validates) |
| lefthook pre-commit | lint (oxlint) + third-party notices + whitespace + vendor manifest guard — all passed (commit `0e7133a`) |

## 6. Run isolation tests

`INV-RUN-ISOLATION` in `state-machine.spec.ts` (vitest 57/57). Run-keyed
`ResearchRunStore` (`Map<runId, RunState>`); every public method carries `runId`;
`ensureRun` throws `RUN_NOT_FOUND` (never auto-creates); `createRun` throws `RUN_EXISTS` on
collision (never clobbers). No cross-run effect through the shared store Map.

## 7. Artifact dependency tests

- `INV-DEP-PASSED` (P1-1): `canStart` requires the producer step `passed` AND its current
  attempt (`producer.attempt_id === rec.producerAttemptId`); registry invalidation wins
  over seed (DEP-8). Pinned in `state-machine.spec.ts`.
- `INV-OUTPUT-CONTRACT` (P1-2): `recordArtifact` validates `slug ∈ step.outputs`
  (`DSH_OUTPUT_NOT_DECLARED`); step must be `in_progress`; registry entry REPLACED fresh
  (`invalidated=false`, `producerAttemptId=state.attempt_id` — DEP-4, never mutate).
  Pinned in `state-machine.spec.ts`.

## 8. Rollback cascade tests

`INV-CASCADE` in `state-machine.spec.ts` (vitest 57/57). `rollback` snapshots the current
attempt into history (deep-cloned), invalidates its artifacts, then transitively
cascade-resets every dependent downstream step via `computeTransitiveDependents` (BFS +
visited Set — diamond-safe, DEP-3; full closure DEP-2; DAG asserted at module load
DEP-9). Covers: direct, multi-hop, diamond, history-preserved, DEP-4 (artifact replaced),
no-op (pending), INV-FAILED-RERUN (legal from terminal — C-3). Includes blocked/failed
downstream (C-5).

## 9. Ordinary Node production import evidence (`0e7133a`)

Run from the adapter dir (whose `node_modules` symlinks `@deepseek-ai/dsh-research-core`) —
`node packages/research/dsh-research-cordis/tests/prod-import-smoke.mjs`:

```
MAIN runtime exports: ResearchError, ResearchRunError, ResearchValueError, canStart, completeStep,
                      createRun, getArtifact, getAuditHistory, getRunSnapshot, isComplete,
                      recordArtifact, rollback, setRunInput, startIfCan, startStep, submitGateVerdict  (16 = 13 funcs + 3 error classes)
MAIN trust leak     : (none — boundary holds)
HOST runtime exports: createHostApprovalChannel  (ONLY)
HOST TrustedHumanPrincipal (runtime)        : undefined  (type-only — no prototype to Object.create)
HOST TrustedHumanPrincipal.create           : undefined  (removed — RC-E E2)
HOST _resetApprovalChannelForTests           : undefined  (tree-shaken out of lib/host.js — RC-E E2)
HOST HostApprovalChannel                     : undefined  (type-only)
HOST mintPrincipal / submit                  : undefined  (methods on a channel INSTANCE, not free exports)
second createHostApprovalChannel             : throws APPROVAL_CHANNEL_EXISTS (singleton)
EXIT=0  (prod-import-smoke: ALL PASS, 27 checks)
```

Confirms the compiled `lib/host.js` (built from `host-prod.ts`) resolves + exposes ONLY
`createHostApprovalChannel` at runtime — no prototype / `create()` / reset / mint / channel
instance reachable by an Agent importer. The main entry leaks zero trust.

## 10. Clean worktree build evidence (T04 reproduction)

✅ **PASS on `93d9064`** (the RC-A/B/C/D fixed commit). Fresh `git worktree --detach` from `93d9064`
→ `pnpm install --frozen-lockfile` → `sha256sum pnpm-lock.yaml` →
`tsc -b tsconfig.host.json` → `tsdown --env.DSH_BUILD_FACE host` → lib artifacts →
worktree removed. Background build `by7xf7834` (exit 0).

✅ **PASS on `0e7133a`** (the RC-E/RC-F hardened commit). Fresh `git worktree --detach` from
`0e7133a` → `pnpm install --frozen-lockfile` → `sha256sum pnpm-lock.yaml` →
`tsc -b tsconfig.host.json` → workspace build → in-script `lib/host.js` artifact check →
worktree removed. Background build `b0ypj0up4` (exit 0).

| Step (0e7133a evidence) | Result |
|------|--------|
| frozen install (`pnpm install --frozen-lockfile`) | exit 0 (27.2s; 2 non-fatal bin WARNs for sdk/client + python/sdk-runtime, unrelated to the research core) |
| lock hash (`sha256sum pnpm-lock.yaml`) | `f453b31d18bd857ac1e32bda657dcb4aff397a536015feb86b899c7ebc31000d` — identical across `5a795af`/`93d9064`/`0e7133a` (RC fixes touched only source) |
| host aggregate `tsc -b tsconfig.host.json` | exit 0 (`TSC_EXIT=0`) |
| workspace build (`tsdown`, `DSH_BUILD_FACE=host`) | exit 0 (`BUILD_EXIT=0`) |
| `lib/host.js` tree-shake check (in-script) | `_resetApprovalChannelForTests`: **absent** (`false`); `createHostApprovalChannel`: **present** (`true`) |
| Core lib (`dsh-research-core/lib`) | `host.js`, `index.js`, `state-machine-ZVv7w368.js` (chunk), `tsconfig.tsbuildinfo`, `types/` |
| Adapter lib (`dsh-research-cordis/lib`) | `index.js`, `tsconfig.tsbuildinfo`, `types/` |
| worktree | removed cleanly (`===WORKTREE REMOVED===`) |

Validates the NEW build config (`tsdown entry: { index, host: 'src/host-prod.ts' }` →
`lib/host.js` with `_resetApprovalChannelForTests` tree-shaken) from a fresh frozen state.
Lockfile unchanged (sha256 `f453b31d…` == `93d9064`/`5a795af`), so the frozen-install +
hardened config + fixed code all compile/build clean from a fresh checkout. The prod
`lib/host.js` exposes ONLY `createHostApprovalChannel` at runtime — no prototype / `create()` /
reset / mint / channel instance reachable by an Agent importer (confirmed by the in-script
grep here + the prod-import-smoke in §9).

| Step (93d9064 evidence) | Result |
|------|--------|
| frozen install (`pnpm install --frozen-lockfile`) | exit 0 (29.4s; 2 non-fatal bin WARNs for sdk/client + python/sdk-runtime, unrelated to the research core) |
| lock hash (`sha256sum pnpm-lock.yaml`) | `f453b31d18bd857ac1e32bda657dcb4aff397a536015feb86b899c7ebc31000d` — identical across `5a795af`/`93d9064`/`0e7133a` (RC fixes touched only source) |
| host aggregate `tsc -b tsconfig.host.json` | exit 0 |
| workspace `tsdown --env.DSH_BUILD_FACE host` | exit 0 |
| Core lib (`dsh-research-core/lib`) | `host.js`, `index.js`, state-machine chunks, `tsconfig.tsbuildinfo`, `types/` |
| Adapter lib (`dsh-research-cordis/lib`) | `index.js`, `tsconfig.tsbuildinfo`, `types/` |
| worktree | removed cleanly |

Validates the lockfile (frozen-install) + hardened build config + the fixed code all
compile/build clean from a fresh state.

## 11. Lockfile min-diff

`git diff c6731f7..5a795af -- pnpm-lock.yaml`: **24 changes, all research importer blocks**.

- Renamed `packages/research/research-core` → `packages/research/dsh-research-core`
  (importer key; devDeps unchanged).
- Added `packages/research/dsh-research-cordis` importer block (deps:
  `dsh-research-core` workspace link + `schemastery` link; devDeps: `cordis` workspace +
  `@types/node` + `typescript` + `vitest`).
- **Reverted** the unrelated `content-type@2.0.0 → 2.1.0` transitive drift
  (body-parser@2.3.0 + type-is@2.1.0 snapshots) back to baseline `c6731f7`.

Diff confined to research; no `content-type`/`body-parser`/`type-is` lines remain
(verified via `grep` on the post-edit diff: zero matches).

**`93d9064` + `0e7133a` touched ONLY source** — `pnpm-lock.yaml` UNCHANGED (sha256
`f453b31d18bd857ac1e32bda657dcb4aff397a536015feb86b899c7ebc31000d` identical across
`5a795af`/`93d9064`/`0e7133a`); `pnpm install --frozen-lockfile` validates (no drift).

## 12. Adversarial verification (extra, ultracode)

Two rounds (16 attack angles each, find→adversarial-verify; skeptic defaults REFUTED;
empirically reproduced against the built lib):

**Round 1** (workflow `wf_efef05dc-a3f`, on `5a795af`): **14 confirmed bypasses** collapsing
to 4 root causes — RC-A (mutable step singletons re-exported unfrozen; 8 angles), RC-B
(`./src/*` hatch exposed `_applyHumanApproval`; 4 angles), RC-C (adapter store
TS-private→runtime-erased `ctx.research.runs` live Map; 3 angles), RC-D (frozen-input guard
checked status not attempts; 1 angle, P2). All 4 closed by `93d9064` (deepFreeze + removed
re-export + removed `./src/*` hatch; module-scoped adapter store; guard checks attempts).
Re-verify on `93d9064` confirmed those 14 angles clean.

**Round 2** (workflow `wf_b250ec41-184`, on `93d9064`): **2 NEW confirmed bypasses** (14
clean — the original 14 stay closed). Both empirically reproduced against the built lib:
- **RC-F** (`verdict-immutability`): `submitGateVerdict` read `verdict.component` 4× via live
  property access. A getter-bearing verdict returning 'A'(gate)/'C'(immutability `in`-check →
  not in {A} → no throw)/'A'(storage key) OVERWROTE an existing A=false verdict, flipping
  adjudication blocked→passed. structuredClone invokes the getter once (data prop) so the
  deep-clone did not save it. **Fixed**: read `verdict.component` ONCE into a local at
  function entry; gate check + immutability membership + storage key all use the local. The
  getter now throws `DSH_VERDICT_ALREADY_SET` (cannot overwrite). Pinned by test #8 + #9.
- **RC-E** (`trusted-principal-forge`): the SOLE principal-type guard was
  `instanceof TrustedHumanPrincipal` (host.ts:97), defeated by
  `Object.create(TrustedHumanPrincipal.prototype)` (sets [[Prototype]] w/o invoking the ctor →
  instanceof true). Plus `TrustedHumanPrincipal.create()` + `_resetApprovalChannelForTests()`
  were both exported from the prod `./host` subpath, so an in-process Agent importer minted its
  own channel + principal + self-approved E2-submit. **Fixed** (Option A, strictly trust-
  boundary hardening — no other API expanded): per-channel module-private
  `WeakSet<TrustedHumanPrincipal>` is the SOLE identity guard (submit iff `weakset.has(principal)`
  — object identity + owning channel; membership is unforgeable: not enumerable, not copyable);
  principals minted ONLY via `channel.mintPrincipal(runId, stepId, principalId, approvalEventId)`;
  `create()` removed; ctor token-gated (module-private Symbol `MINT_TOKEN`); prod `./host` built
  from `host-prod.ts` (re-exports `createHostApprovalChannel` + types only) →
  `_resetApprovalChannelForTests` tree-shaken out of `lib/host.js` + runtime class not exported
  (no prototype); `submit` verifies identity + channel + runId + stepId + registry + pending step.
  **Contract-level closed** given host-startup-precedence (see §3 residual).

**Round 3** (workflow `wf_8c52a572-a38`, on `0e7133a`; 16 agents, 464k tokens, 211 tool calls):
**0 confirmed contract-level bypasses** — `confirmedCount:0, cleanCount:16`. All 16 angles
empirically re-verified against BOTH source AND the built lib (`lib/index.js`, `lib/host.js`,
`lib/state-machine-ZVv7w368.js` + `package.json` exports) under host-startup-precedence.

- **RC-F** (`verdict-immutability`): CLOSED. The read-once fix is confirmed present in BOTH
  source (state-machine.ts L437/446/449) and the BUILT lib
  (state-machine-ZVv7w368.js L604/609/610) — `submitGateVerdict` reads
  `const component = verdict.component` ONCE; a getter-bearing verdict returning 'A'/'C'/'A'
  cannot overwrite an existing A=false verdict (throws `DSH_VERDICT_ALREADY_SET`). The TOCTOU
  is closed in the prod build an Agent importer actually obtains, not just in source.
- **RC-E** (`trusted-principal-forge`): CLOSED at the built-lib surface. All 8 forge paths
  blocked: (1) `Object.create(prototype)` — `TrustedHumanPrincipal` has no runtime binding in
  prod (type-only export erased at build); (2) forged same-field plain object → WeakSet
  identity check fails; (3) copied properties/symbols → membership unforgeable; (4)
  `new TrustedHumanPrincipal(...)` → ctor not exported + requires module-private `MINT_TOKEN`
  (lib/host.js L10, never stored on instances, not exported); (5) host's existing channel →
  `activeChannel` module-private `let` (L35), never returned; (6) reset →
  `_resetApprovalChannelForTests` tree-shaken out of `lib/host.js` (absent); (7) own channel →
  `createHostApprovalChannel` throws `DSH_APPROVAL_CHANNEL_EXISTS` under host-startup-precedence;
  (8) `mintPrincipal` → method on a channel instance, no instance obtainable;
  `TrustedHumanPrincipal.create()` removed (absent from source + lib). Submit guard chain
  (identity → runId → stepId → registry → pending step) sound; no forged object passes the
  first (identity) check. `lib/index.js` = 13 funcs + 3 error classes only; `lib/host.js`
  sole runtime export = `createHostApprovalChannel` (L70); `state-machine-*.js` chunks not in
  `exports`/`files` → not importable; `_applyHumanApproval` (alias `i`) not re-exported.
- **Documented architectural residual** (`real=false`, NOT a contract-level bypass; reported
  by 3 angles — `trusted-principal-forge` / `host-secret-channel` / `replay-attack`): the only
  self-approve path is the Agent creating its OWN channel via `createHostApprovalChannel` before
  the host / with no host process (so `activeChannel` is still undefined). Same-process
  same-privilege malicious code cannot be truly isolated via a TS/JS API; true enforcement needs
  process isolation / IPC identity auth (Interaction phase, future). Under host-startup-
  precedence every contract-level path is blocked, so this is NOT counted as a bypass. Two
  further angles (`canstart-producer-not-passed`, `recordartifact-contract`) note the general
  prototype-pollution residual (raw `Object.prototype`/`Array.prototype` mutation) — same
  process-isolation limitation, not contract-level, not RC-E/RC-F-specific.

**10 adversarial pinning tests** (host.spec.ts + state-machine.spec.ts +
dsh-research-cordis/tests/prod-import-smoke.mjs): #1 Object.create(prototype) rejected;
#2 forged same-field plain object rejected; #3 copied properties/symbols rejected; #4 second
channel creation fails; #5 Agent can't obtain create/reset/mint/channel from prod exports;
#6 cross-channel/run/step principal use rejected; #7 reset not in prod (plain-Node load);
#8 RC-F getter can't overwrite an existing verdict; #9 same-component verdict immutable per
attempt + new-attempt re-submit; #10 plain-Node prod import/export smoke. + direct-construction
(token-gate) + functional (approved/rejected/unregistered/bad-status/replay/re-approval).

---

## Out of scope (NOT done — per ruling)

- **P2** — not entered (batch1 under review).
- **T02** — blocked (key rotation pending; placeholder `sk-xxx` only; real key never written
  to any file/code/log).
- **B-PICK** — stays open (T03 error-code fix ≠ root-cause proof).
- **webworker-runtime** — NOT modified (its `noExternal: [/.*/]` deprecation stays).
- **No new third-party dependencies** (koffi/playwright/ws are pre-existing declared
  devDeps; `node:crypto` builtin — used `globalThis.crypto`, no import).

## Residual / honest limitations

- The `./host` subpath is ESM-importable; the singleton + host-secret-in-env +
  host-startup-precedence is the runtime defense-in-depth (documented in §6/§13.A). TRUE
  enforcement that an in-process Agent cannot mint requires process-level isolation (the
  Interaction phase, future).
- `HostApprovalChannel.submit(runs, …)` takes the run store as a parameter (the host,
  when it composes `ResearchEngine` in a future phase, supplies the store). For P1.6 (not
  run/composed) this is the contract-level API; tests mint a channel + pass a store directly.
