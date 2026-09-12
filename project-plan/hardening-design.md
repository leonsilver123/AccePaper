# Batch 1 Contract Hardening — Design Spec v1

Status: DESIGN (pre-implementation). Author: 主 Agent. Date: 2026-09-03.
Baseline: `c6731f7`. Current HEAD: `3a18b25`. Ruling: 批次1 不通过; authorized: state-machine P0/P1 fix + Core exports + lockfile drift cleanup + lifecycle idempotency tests + T04 clean worktree; NOT authorized: webworker-runtime, P2, close B-PICK, T02.

## 0. Confirmed defects (all verified against actual source)

| ID | Defect | Source locus |
|----|--------|-------------|
| P0-1 | human approval forgeable by any non-'agent' actor string | state-machine.ts:261 |
| P0-2 | public methods return mutable internal `StepState` refs | state-machine.ts:92 `return state`; :285-287 getAuditHistory live refs |
| P1-1 | downstream canStart ignores upstream `passed` (only checks `slug in other.artifacts`) | state-machine.ts:69-78 |
| P1-2 | recordArtifact doesn't validate slug ∈ step.outputs | state-machine.ts:96-102 |
| P1-3 | public `transition()` lets caller move to gated/passed/blocked/failed w/o verdicts | adapter index.ts:96-98; core state-machine.ts:31-38,171-190 |
| P1-4 | submitGateVerdict doesn't validate component ∈ step.gate; empty-gate parked via fabricated verdict | state-machine.ts:120,122-134 |
| P1-5 | run_id is decoration; one shared `StepStore` for all runs | adapter index.ts:70; no runId on any API |
| P1-6 | no legal initial-input entry; tests inject fake `T0` producer manually | state-machine.ts (none); tests:22-35,57-61,73 |
| P1-7 | rollback doesn't cascade; downstream `passed`/`in_progress` stay | state-machine.ts:202-224 (resets only self) |
| P1-8 | audit history returns mutable refs (artifacts/gateResults/approval) | state-machine.ts:207-214,282-290 |

## 1. New data model

### 1.1 Run store
```ts
export type ResearchRunStore = Map<string, RunState>

export interface RunState {
  readonly runId: string
  inputs: Record<string, unknown>                         // seeded T0 inputs (domain-direction, …)
  steps: StepStore                                        // Map<stepId, StepState>
  registry: Record<string, ArtifactRecord>                // slug → current valid artifact
  events: AuditEvent[]                                   // append-only run audit log
}

export interface ArtifactRecord {
  readonly slug: string
  readonly producerStepId: string
  readonly producerAttemptId: number
  readonly value: unknown
  readonly producedAt: number
  invalidated: boolean                                   // true when producer rolled back / cascade
}

export interface AuditEvent {
  readonly kind: 'run-created' | 'input-seeded' | 'step-started' | 'artifact-recorded'
    | 'gate-verdict' | 'step-completed' | 'human-approval' | 'rollback'
  readonly runId: string
  readonly stepId?: string
  readonly attemptId?: number
  readonly ts: number
  readonly detail?: unknown
}
```

### 1.2 Trusted human principal (P0-1)
```ts
 declare const __principalBrand: unique symbol
export class TrustedHumanPrincipal {
  readonly [__principalBrand] = true
  private constructor(readonly principalId: string, readonly approvalEventId: string) {}
  static create(principalId: string, approvalEventId: string): TrustedHumanPrincipal {
    if (!principalId || principalId === 'agent')
      throw new Error('TrustedHumanPrincipal: principalId cannot be empty or "agent"')
    if (!approvalEventId) throw new Error('TrustedHumanPrincipal: approvalEventId required')
    return new TrustedHumanPrincipal(principalId, approvalEventId)
  }
}
```
- Compile-time brand + private ctor ⇒ callers cannot `new` or `as` into a valid instance.
- Core's `submitHumanApproval` does `instanceof TrustedHumanPrincipal` (runtime) + re-validates principalId ≠ 'agent'.
- ApprovalRecord becomes **internal/audit-only**: built by core from the principal; `actor: string` removed, replaced by `principalId` + `approvalEventId` sourced from the trusted instance. Exported as `Readonly<…>` snapshot type, never constructable by callers.
- **Trust boundary**: in production, `TrustedHumanPrincipal.create` is invoked ONLY by the authenticated interaction/approval channel (host context), NEVER by an Agent Tool. The Agent Tool surface does not accept a `principal`/`actor` parameter — it routes through that channel. Until real Interaction lands, tests use `TrustedHumanPrincipal.create('human-1','evt-1')` directly. (Documented in §6.)

### 1.3 Snapshot types (P0-2, P1-8)
All public returns are **deep-cloned** (breaks refs). Types use `Readonly`:
```ts
export interface StepSnapshot { readonly stepId; readonly status; readonly attempts; readonly attemptId;
  readonly artifacts: Readonly<Record<string, unknown>>; readonly gateResults: Readonly<…>;
  readonly approval?: Readonly<ApprovalRecord>; readonly startedAt?; readonly finishedAt? }
export interface RunSnapshot { readonly runId; readonly inputs: Readonly<…>; readonly steps: Readonly<Record<string, StepSnapshot>>;
  readonly registry: Readonly<Record<string, Readonly<ArtifactRecord>>>; readonly events: ReadonlyArray<Readonly<AuditEvent>> }
export type AuditEntry = Readonly<AttemptRecord | CurrentAttemptSnapshot>  // deep-cloned on return
```

## 2. Public API (every method carries runId)

Core pure functions over `ResearchRunStore`:
```
createRun(store, runId?) → string                       // creates empty RunState; gen id if absent
setRunInput(store, runId, slug, value) → void           // P1-6: slug ∈ SEEDABLE_INPUTS
getRunSnapshot(store, runId) → RunSnapshot             // deep clone; read-only
canStart(store, runId, stepId) → boolean               // P1-1: upstream must be passed+current attempt
startStep(store, runId, stepId) → StepSnapshot          // returns CLONE; advances attempt
recordArtifact(store, runId, stepId, slug, value) → void // P1-2: slug ∈ step.outputs; updates registry
submitGateVerdict(store, runId, stepId, verdict) → StepStatus // P1-4: component ∈ step.gate; throws on empty gate
completeStep(store, runId, stepId) → StepStatus         // P1-4: empty-gate finalize (non-humanGate→passed, humanGate→gated)
submitHumanApproval(store, runId, stepId, decision, principal) → StepStatus // P0-1: trusted principal
rollback(store, runId, stepId) → void                   // P1-7: cascade-invalidate downstream
isComplete(store, runId, stepId) → boolean
getAuditHistory(store, runId, stepId) → AuditEntry[]    // P1-8: deep-cloned
```
- **No public `transition()`** (P1-3). An internal `_apply(state, to)` is used by the above actions only.
- `SEEDABLE_INPUTS = ['domain-direction']` (the T0 human direction input; extensible).

## 3. Invariants (one per defect; each pinned by a test)

- **INV-PRINCIPAL (P0-1)**: `submitHumanApproval` rejects non-`TrustedHumanPrincipal` instances and any principalId 'agent'/empty. No `actor` string accepted anywhere.
- **INV-SNAPSHOT (P0-2)**: `startStep`/`getRunSnapshot`/`getAuditHistory` return deep clones; mutating a return value does NOT change internal state.
- **INV-DEP-PASSED (P1-1)**: `canStart` requires each input slug to be a non-invalidated artifact whose producer step is `passed` at the current `attempt_id` (or a seeded run input). An in_progress upstream that merely called `recordArtifact` does NOT unlock downstream.
- **INV-OUTPUT-CONTRACT (P1-2)**: `recordArtifact` throws unless `slug ∈ step.outputs`. Unknown slug, another step's output slug, duplicate/override strategies tested.
- **INV-NO-RAW-TRANSITION (P1-3)**: `transition` is not exported / not on the adapter. States gated/passed/blocked/failed are reachable only via `submitGateVerdict`/`completeStep`/`submitHumanApproval`/`rollback`.
- **INV-GATE-COMPONENT (P1-4)**: `submitGateVerdict` throws unless `component ∈ step.gate`; throws on empty-gate steps (use `completeStep`). No fabricated verdict can park an empty-gate step.
- **INV-RUN-ISOLATION (P1-5)**: `ResearchRunStore` keyed by runId; two runs share no step state; an artifact recorded in run R1 is invisible to run R2's `canStart`.
- **INV-SEED-INPUT (P1-6)**: `setRunInput` throws unless `slug ∈ SEEDABLE_INPUTS`; `createRun`+`setRunInput('domain-direction',…)` lets A1 `canStart` from empty state — no fake `T0` step.
- **INV-CASCADE (P1-7)**: `rollback(S)` snapshots S + transitively resets every dependent downstream step that is in_progress/gated/passed back to `pending` (history preserved), and marks all their produced artifacts `invalidated`. A downstream that was `passed` is invalidated (not silently left passed).
- **INV-HISTORY-IMMUTABLE (P1-8)**: `getAuditHistory` returns deep clones; rollback snapshots are deep-cloned at snapshot time; mutating a returned history entry does not affect the internal history.

## 4. State transition table

| from | action | to | guard |
|------|--------|----|-------|
| (none) | createRun | run exists | — |
| pending | startStep | in_progress | canStart (inputs satisfied) |
| in_progress | recordArtifact | in_progress | slug ∈ step.outputs |
| in_progress | submitGateVerdict (last comp, all-pass, non-humanGate) | passed | component ∈ step.gate |
| in_progress | submitGateVerdict (last comp, all-pass, humanGate) | gated | component ∈ step.gate |
| in_progress | submitGateVerdict (cFail on falsifiable C) | failed | component ∈ step.gate |
| in_progress | submitGateVerdict (other fail) | blocked | component ∈ step.gate |
| in_progress | completeStep (empty gate, non-humanGate) | passed | gate.length===0 |
| in_progress | completeStep (empty gate, humanGate) | gated | gate.length===0 |
| in_progress | completeStep (non-empty, all in) | passed/blocked/failed | all components present |
| gated | submitHumanApproval(approved) | passed | humanGate + trusted principal |
| gated | submitHumanApproval(rejected) | blocked | humanGate + trusted principal |
| any non-terminal | rollback | pending (+ cascade downstream → pending) | — |
| pending/in_progress/gated | (no-op if not startable) | unchanged | — |

Illegal edges (e.g. passed→in_progress, pending→passed directly) throw. Terminal states (passed/blocked/failed) are only exited by rollback.

## 5. Adapter (`dsh-research-cordis`) changes

- `private readonly runs: ResearchRunStore = new Map()` (replaces single `store`).
- Exposes: `createRun`, `setRunInput`, `getRunSnapshot`, `canStart`, `startStep`, `recordArtifact`, `submitGateVerdict`, `completeStep`, `submitHumanApproval`, `rollback`, `isComplete`, `getAuditHistory` — all `(runId, …)` first; all returning snapshot/clone types.
- **Removes** `transition` and the old `approveHumanGate(stepId, approval)` (replaced by `submitHumanApproval(runId, stepId, decision, principal: TrustedHumanPrincipal)`).
- `[Service.init]` registers an unload effect clearing `this.runs`.
- Tests: load/unload/error (existing) + **idempotent load→unload→load→unload** (authorized) + **production Node import** of dsh-research-core (authorized; verifies `lib/index.js` resolves).

## 6. Trust boundary (Human Approval) — deliverable

1. The ONLY constructor of a human approval is `TrustedHumanPrincipal.create(principalId, approvalEventId)`, called by the authenticated interaction channel (host context), not by Agent Tools.
2. Core's `submitHumanApproval` accepts a `TrustedHumanPrincipal` (instanceof + principalId re-check) + binds `run_id`/`step_id`/`attempt_id`/`principalId`/`approvalEventId`/`timestamp` internally. No caller-supplied `actor` exists in the type system.
3. The Agent Tool surface (future Tools phase) MUST NOT declare a parameter that yields a `TrustedHumanPrincipal` or an `actor` string; it MUST route human-approval requests through the authenticated channel. This is a Tool-surface contract enforced at Tools-land time (not in P1.6 scope).
4. Until real Interaction lands, tests construct `TrustedHumanPrincipal.create('human-1','evt-1')` directly. This factory is exported for tests/adapter only; the "not exposed to Agent Tool" guarantee is the Tool-surface responsibility (§6.3).
5. Forged-actor tests: `actor`/principalId strings 'human-1','user','Human','system','agent','' all rejected when not carried by a `TrustedHumanPrincipal` instance.

## 7. Build / exports fix (§三.1)

- `tsdown.config.ts`: REMOVE `exclude: ['packages/research/dsh-research-core']` ⇒ Core enters workspace build ⇒ emits `lib/index.js`.
- `dsh-research-core/package.json`: `main: "./lib/index.js"`; `exports."."` → `{ types: "./lib/types/index.d.ts", default: "./lib/index.js" }`; keep `"./src/*": "./src/*"` (source overlay for dev tsconfig paths). Remove `"default": "./src/index.ts"`.
- Core type decls: ensure `lib/types/index.d.ts` emitted (tsc -p Core, or host reference — TBD at impl, must not depend on webworker-runtime).
- Verification: `node -e "import('@deepseek-ai/dsh-research-core').then(m => console.log(typeof m.canStart))"` prints `function` from a normal Node production import (no tsx loader). Adapter `from '@deepseek-ai/dsh-research-core'` resolves to `lib/index.js`.

## 8. Lockfile drift cleanup (§三.2)

- Baseline `c6731f7` had `content-type@2.0.0` (L13284) which vanished in HEAD (replaced by `2.1.0` resolution); body-parser/type-is resolutions shifted.
- Restore those unrelated entries from `c6731f7:pnpm-lock.yaml`; keep ONLY the dsh-research-core + dsh-research-cordis workspace registrations + their necessary links.
- Deliverable: `git diff c6731f7..HEAD -- pnpm-lock.yaml` confined to research packages + workspace links (documented min-diff).

## 9. T03 error code fix (§三.3)

- `win32-dialog-bindings.ts`: `DSH_NATIVE_BINARY_MISSING` → `DSH_NATIVE_DLL_LOAD_FAILED`; add `readonly dllName?: string` field.
- After `await import('koffi')`, verify the imported module has a callable `load` function (shape check); a missing/odd module shape throws `DSH_NATIVE_KOFFI_IMPORT_FAILED` with a clearer message (not misreported as DLL missing).
- `loadDll` throws `DSH_NATIVE_DLL_LOAD_FAILED` carrying `dllName`. Tests updated for the new code/field. B-PICK stays OPEN.

## 10. Test matrix (replaces 23-test suite + adds invariant tests)

Per invariant (§3): a positive (contract holds) + negative (bypass rejected) test. Categories:
- INV-PRINCIPAL: 6 forged-actor strings rejected; trusted principal approved/rejected.
- INV-SNAPSHOT: mutate returned startStep/getRunSnapshot/getAuditHistory ⇒ internal unchanged.
- INV-DEP-PASSED: upstream in_progress with recorded artifact ⇒ downstream canStart false; upstream passed ⇒ true.
- INV-OUTPUT-CONTRACT: unknown slug / other step's slug / duplicate override.
- INV-NO-RAW-TRANSITION: `transition` not exported (compile fail) / not on adapter.
- INV-GATE-COMPONENT: verdict for undeclared component throws; empty-gate submitGateVerdict throws; completeStep parks humanGate / passes non-humanGate.
- INV-RUN-ISOLATION: two runs, artifact in R1 invisible to R2.
- INV-SEED-INPUT: setRunInput rejects non-seedable slug; createRun+seed ⇒ A1 canStart.
- INV-CASCADE: rollback passed upstream ⇒ downstream passed→pending + artifacts invalidated + history preserved.
- INV-HISTORY-IMMUTABLE: mutate returned history entry ⇒ internal history unchanged.
- Adapter lifecycle: load/unload/error + idempotent load→unload→load→unload + production import.
- T03: new error code + dllName + koffi shape check.

## 11. Sequencing (commit group)

1. Core types + state-machine rewrite (types.ts, state-machine.ts, steps.ts SEEDABLE_INPUTS, index.ts re-exports).
2. Core tests rewrite (state-machine.spec.ts) — full invariant matrix.
3. Core build/exports (tsdown.config.ts exclude removal; package.json; lib/types emit).
4. Adapter rewrite (index.ts) + tests (lifecycle.spec.ts) incl. idempotency + production import.
5. T03 error code (win32-dialog-bindings.ts + tests).
6. Lockfile drift cleanup (pnpm-lock.yaml).
7. Build verify: tsc -b host; tsdown; vitest core + adapter + T03; production Node import; clean git worktree frozen-install + build.
8. Deliverables: full patch `c6731f7..HEAD`; state transition table (§4); trust boundary (§6); min lockfile diff (§8); evidence.

## 12. Out of scope (NOT touched)

- webworker-runtime `noExternal` deprecation (NOT authorized).
- directory-picker-auto / runtime降级 (resolve.ts:50 unchanged).
- P2 / Tools / Team / Web / Bundle / AgentLoop / new third-party deps.
- T02 (key rotation; still blocked).
- B-PICK (stays OPEN; T03 error code ≠ root-cause proof).

---

## 13. v2 — critic-driven revisions (authoritative; supersedes conflicting v1 text)

6 independent design critics (workflow `wf_7b10722e-9c1`) found 2 blockers + ~18 majors. Resolutions:

### A. Trust boundary (P0-1) — revised
- **Main entry** `@deepseek-ai/dsh-research-core` exports ONLY non-trust state-machine functions: `createRun, setRunInput, getRunSnapshot, canStart, startIfCan, startStep, recordArtifact, getArtifact, submitGateVerdict, completeStep, rollback, isComplete, getAuditHistory`. A humanGate step reaches 'gated' but **never 'passed'** via the main entry.
- `approveHumanGate` + `transition` **DROPPED** from core (INV-NO-LEGACY-APPROVE, INV-NO-RAW-TRANSITION). Pinned with tests like transition removal.
- **`./host` subpath** (`src/host.ts` → `lib/host.js`) exports the trust capability: `createHostApprovalChannel(hostSecret)` (**SINGLETON** — throws if already created; host calls once at startup with a secret from `process.env.DSH_APPROVAL_SECRET` the Agent cannot observe), `HostApprovalChannel` (`.registerPrincipal(principalId)` host-populated registry + `.submit(runs, runId, stepId, decision, principal)`), `TrustedHumanPrincipal` (private ctor, static `create(principalId, approvalEventId)` for tests).
- `HostApprovalChannel.submit` guards: channel instance required (Agent can't obtain — singleton + instance held privately); `principal instanceof TrustedHumanPrincipal` (canonical prototype check, P0-1-H6); `principal.principalId ∈ channel.registry` (P0-1-H5); principalId ≠ 'agent'/empty; `state.status==='gated'` (INV-APPROVAL-STATE, C-2); `step.humanGate`; `principal.approvalEventId ∉ run.consumedApprovals` (INV-REPLAY, P0-1-H4 — single-use per run,step); binds `{run_id, step_id, attempt_id, principalId, approval_event_id, timestamp}`; gated→passed(approved)/blocked(rejected); adds approvalEventId to consumedApprovals; pushes 'human-approval' event.
- `isComplete`: humanGate requires `approval.decision==='approved' AND approval.attempt_id===state.attempt_id` (INV-COMPLETE-ATTEMPT, H8).
- **Residual (honest)**: the `./host` subpath is ESM-importable; the singleton + host-secret-in-env + host-startup-precedes-tool-execution is the runtime defense-in-depth. TRUE enforcement that an Agent process cannot mint requires process-level isolation (the Interaction phase, future). For P1.6 (not run/composed) this is the contract-level hardening; documented in §6.

### B. Write-path isolation (P0-2 write direction) — NEW (HOLE-1/H1)
- All caller-supplied values (`setRunInput`, `recordArtifact`, `submitGateVerdict` evidence/rationale, `TrustedHumanPrincipal` fields, `AuditEvent.detail`) are **deep-cloned at write time** (INV-WRITE-ISOLATION) via `cloneValue(x)`.
- `cloneValue` = structuredClone try/catch → `ResearchValueError('DSH_VALUE_NOT_CLONEABLE')` on failure (HOLE-2/H6). Node≥17 floor pinned in `engines` (HOLE-7).

### C. Read-path isolation (P0-2 read)
- `getRunSnapshot` returns metadata + registry index (**no artifact values**) + steps (no artifact values) + events (cloned). `getArtifact(runId, slug)` clones the value on demand (HOLE-4). `startStep` returns `StepSnapshot` (clone). `getAuditHistory` returns deep-cloned entries (INV-SNAPSHOT, INV-HISTORY-IMMUTABLE). Returned clones are runtime-mutable; "read-only" is compile-time + clone-isolation, documented (HOLE-5).

### D. Audit log (C-1, HOLE-3, H7)
- Each mutator (`createRun, setRunInput, startStep, startIfCan, recordArtifact, submitGateVerdict, completeStep, HostApprovalChannel.submit, rollback`) pushes an `AuditEvent` (INV-AUDIT-APPEND). `detail` is JSON-serializable + cloned at append (INV-EVENTS-IMMUTABLE). events array append-only (no splice/pop). `AttemptRecord` fields `Readonly` (H5).

### E. Run lifecycle (C-2,C-6,C-11,H2,H3,H4,H9,H10,DEP-7,DEP-8)
- `createRun(store, runId?)`: throw `RUN_EXISTS` on explicit collision; `crypto.randomUUID()` if absent (H3); never auto-create on miss. `setRunInput`: slug ∈ SEEDABLE_INPUTS; value ≠ undefined/null (H9); **throw if run started** (any step non-pending) (INV-INPUT-FROZEN, H4); clone. All `(store, runId,…)` methods throw `RUN_NOT_FOUND`; never auto-create RunState (H10). `SEEDABLE_INPUTS=['domain-direction']` permanent-by-contract (DEP-7); invariant no SEEDABLE slug in any `step.outputs` (DEP-8); canStart: registry invalidation wins over seed (DEP-8). `startIfCan` atomic check+transition (C-9); core mutators synchronous. ResearchEngine root-scoped; runs ephemeral across unload (C-6 documented).

### F. canStart (P1-1, DEP-1)
- Input satisfied by: seed present AND (no registry record OR record not invalidated); ELSE registry[slug] non-invalidated + producer `passed` + producer.attempt_id===producerAttemptId. Complete cascade + DAG assertion is the primary guarantee (DEP-1).

### G. recordArtifact (P1-2, DEP-4, C-8)
- slug ∈ step.outputs; step in_progress; clone value; **REPLACE** registry entry (fresh ArtifactRecord, invalidated=false, producerAttemptId=state.attempt_id) (DEP-4 — never mutate); push 'artifact-recorded' event (C-8).

### H. Gate adjudication (P1-3, P1-4, gate H1-H6)
- `submitGateVerdict`: component ∈ step.gate (INV-GATE-COMPONENT); throw if gate.length===0 (use completeStep); throw unless status===in_progress (INV-VERDICT-STATUS, H3); throw if component already has verdict (INV-VERDICT-IMMUTABLE, H6); store (cloned); auto-adjudicate on last verdict via shared `_adjudicate` (INV-SOLE-ADJUDICATOR, INV-ADJUDICATE-SHARED, H2/H4).
- `completeStep`: throw unless gate.length===0 (INV-COMPLETESTEP-EMPTY, H1); throw unless status===in_progress (C-7); non-humanGate→passed, humanGate→gated.
- `_adjudicate(state, step)`: anyFail && falsifiable!==null && !gateResults['C']?.passed → failed; anyFail → blocked; else humanGate→gated / non-humanGate→passed.
- `_apply(state, step, to)`: module-private; LEGAL_TRANSITIONS guard + humanGate→passed guard (INV-APPLY-GUARDS, H5).

### I. Cascade (P1-7, DEP-1..9, C-4, C-5)
- `computeTransitiveDependents(stepId)`: BFS with visited Set (DEP-3); full closure (DEP-2); DAG assertion at module load (DEP-9).
- `rollback`: no-op if absent/pending (DEP-6); legal from terminal too (C-3, INV-FAILED-RERUN); snapshot S (clone)→S.history; invalidate S's artifacts; for each dependent (visited, once): snapshot (clone)→dependent.history, reset to pending, invalidate artifacts, push 'rollback' event. Includes blocked/failed downstream (C-5).

### J. T03 — DONE (`48b5fd7`); lockfile + build/exports as v1 §7/§8.
