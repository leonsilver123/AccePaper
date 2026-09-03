/**
 * Host trust channel for human approval — the `./host` subpath of dsh-research-core.
 *
 * The MAIN entry (`@deepseek-ai/dsh-research-core`) exports NO human-approval capability:
 * a humanGate step can reach 'gated' (via completeStep/submitGateVerdict) but NEVER 'passed'
 * through it. This module is the ONLY path to approve a humanGate step.
 *
 * LOAD-BEARING DEFENSE (code-enforced TODAY) — RC-C module-scoped store isolation:
 * `HostApprovalChannel.submit(runs, runId, stepId, decision, principal)` takes the run store
 * as its FIRST parameter (caller-supplied). The real host run store is a MODULE-SCOPED Map
 * inside the Cordis adapter (dsh-research-cordis/src/index.ts) — never exposed on
 * `ctx.research` and not obtainable by an Agent tool. So even if an Agent imports `./host`
 * and pre-empts `createHostApprovalChannel` to mint its OWN channel + principal, `submit`
 * can only approve runs in a store the Agent itself supplies (its own Map) — INERT for host
 * runs. THIS is the hard boundary; it does NOT depend on startup ordering.
 *
 * `createHostApprovalChannel(hostSecret)` is a SINGLETON — throws DSH_APPROVAL_CHANNEL_EXISTS
 * if a channel already exists. NO host/bootstrap code calls it today (repo-wide: only this
 * library + tests reference it; `DSH_APPROVAL_SECRET` appears only in comments here). The
 * intended integration is a FUTURE Host-wiring task (Interaction phase): the host mints the
 * singleton once at process startup, before session/prompt execution, with a secret from
 * `process.env.DSH_APPROVAL_SECRET` the Agent tool layer cannot observe. Once wired, the
 * singleton gate becomes a SECONDARY defense-in-depth (a pre-empting Agent's channel would
 * make the host's own mint throw, surfacing the pre-emption). It is NOT the load-bearing
 * defense today and must not be described as such.
 *
 * Production surface (the prod `./host` subpath is built from `host-prod.ts`, which re-exports
 * ONLY `createHostApprovalChannel` + the `HostApprovalChannel`/`TrustedHumanPrincipal` TYPES;
 * `_resetApprovalChannelForTests` is tree-shaken out of `lib/host.js`, and the runtime
 * `TrustedHumanPrincipal` class is not exported at runtime — an importer cannot obtain the
 * prototype, the `create()` factory, the `mintPrincipal` function, or a channel instance):
 *  - `HostApprovalChannel` instances are held by the host (module-private `activeChannel`);
 *    a late importer cannot obtain one. `submit`/`mintPrincipal` are METHODS on the instance.
 *  - `TrustedHumanPrincipal` is minted ONLY by `channel.mintPrincipal(runId, stepId,
 *    principalId, approvalEventId)`, which stamps the instance into THAT channel's
 *    module-private WeakSet. There is NO `TrustedHumanPrincipal.create()` (RC-E E2).
 *
 * Principal identity guard (RC-E E1 — replaces the prior `instanceof` check):
 *  - A module-private per-channel `WeakSet<TrustedHumanPrincipal>` records every principal
 *    minted by THIS channel. `submit` admits a principal iff `principals.has(principal)` —
 *    object identity + owning channel. WeakSet membership is UNFORGEABLE: it is not an own
 *    property of the principal (invisible to getOwnPropertyNames/getOwnPropertySymbols), and
 *    membership cannot be copied from a legitimate principal to a forged object (WeakSet.has
 *    is by object identity, never by copied properties/symbols). `Object.create(
 *    TrustedHumanPrincipal.prototype)` sets [[Prototype]] without invoking the ctor, so the
 *    prior `instanceof` returned true — but the forged object is never added to any channel's
 *    WeakSet, so it is rejected. The constructor is token-gated (a module-private Symbol),
 *    so `new TrustedHumanPrincipal(...)` from outside this module throws.
 *  - Principals are FROZEN at mint time (`Object.freeze` — runtime immutability, NOT just TS
 *    `readonly`, which is erased at runtime): `runId`/`stepId`/`principalId`/
 *    `approvalEventId` are non-writable, so post-mint mutation throws TypeError in strict
 *    mode (ESM). `submit` additionally reads each field ONCE into locals (single-snapshot)
 *    and uses those locals for the runId/stepId checks, the registry lookup, AND the
 *    `_applyHumanApproval` delegation — a getter-bearing principal returning a different
 *    value per read cannot desync the checks from the delegated values
 *    (INV-PRINCIPAL-SNAPSHOT). `submit` also verifies `principal.runId === runId &&
 *    principal.stepId === stepId` (cross-run/cross-step use rejected) and
 *    `principal.principalId ∈ channel.registry` (host-populated), then delegates to the
 *    package-private core `_applyHumanApproval` which re-checks status==='gated' (the
 *    current pending-approval step) + humanGate + approvalEventId single-use (INV-REPLAY).
 *
 * Residual (honest, §6 — NOT system-level isolation): the `./host` subpath is ESM-importable
 * and `createHostApprovalChannel` is a public export, so this is CONTRACT-LEVEL hardening.
 * An Agent that can import `./host` CAN mint its own channel + principal, but (RC-C) can
 * only approve runs in a store IT supplies — inert for host runs. TRUE enforcement against
 * same-process, same-privilege malicious code requires process-level isolation / IPC
 * identity auth / host-side unforgeable authorization (the Interaction phase, future) —
 * TypeScript/JavaScript API cannot provide it. This must not be described as completing
 * system-level security isolation.
 */

import type { ResearchRunStore, StepStatus } from './engine/types.ts'
import { ResearchError, _applyHumanApproval } from './engine/state-machine.ts'

/**
 * Module-private mint token. The sole value the TrustedHumanPrincipal constructor accepts; it
 * is a constructor PARAMETER, never stored on the instance, so it is invisible to
 * getOwnPropertySymbols on a real or forged principal. Not exported. This makes
 * `new TrustedHumanPrincipal(...)` from outside host.ts throw (RC-E E2: principals are minted
 * ONLY via HostApprovalChannel.mintPrincipal, the only other holder of this token).
 */
const MINT_TOKEN: unique symbol = Symbol('dsh-host-mint')

/**
 * Human principal record. Minted ONLY by `HostApprovalChannel.mintPrincipal` (no static
 * `create()` — RC-E E2). The canonical runtime guard is per-channel WeakSet membership
 * (object identity + owning channel — RC-E E1), NOT `instanceof`: `Object.create(
 * TrustedHumanPrincipal.prototype)` sets [[Prototype]] without invoking the ctor, so
 * `instanceof` would return true, but the forged object is never added to any channel's
 * WeakSet → rejected. `principalId` is host-attested (not an arbitrary caller string);
 * `approvalEventId` is the host-channel event id recorded as provenance (single-use per run,
 * INV-REPLAY). `runId`/`stepId` bind the principal to the specific run+step it was minted for
 * (cross-run/cross-step use rejected).
 */
export class TrustedHumanPrincipal {
  readonly principalId: string
  readonly approvalEventId: string
  readonly runId: string
  readonly stepId: string
  constructor(token: symbol, principalId: string, approvalEventId: string, runId: string, stepId: string) {
    if (token !== MINT_TOKEN) {
      throw new ResearchError('DSH_PRINCIPAL_NOT_TRUSTED', 'TrustedHumanPrincipal: direct construction is not allowed — principals are minted only via HostApprovalChannel.mintPrincipal (RC-E E2)')
    }
    this.principalId = principalId
    this.approvalEventId = approvalEventId
    this.runId = runId
    this.stepId = stepId
  }
}

/** Host approval channel: mints + submits human approvals for gated humanGate steps. */
export interface HostApprovalChannel {
  /** Register an authenticated human principal id (host-populated; Tools-read-only by boundary). */
  registerPrincipal(principalId: string): void
  /** Mint a TrustedHumanPrincipal bound to (this channel, runId, stepId). The sole principal
   *  factory (RC-E E2) — stamps the instance into this channel's WeakSet so submit admits it. */
  mintPrincipal(runId: string, stepId: string, principalId: string, approvalEventId: string): TrustedHumanPrincipal
  /** Submit a human approval for a gated humanGate step. Requires a principal minted by THIS
   *  channel (object identity — RC-E E1) bound to (runId, stepId) whose principalId is in this
   *  channel's registry. Verifies identity + channel + runId + stepId + decision + the current
   *  pending-approval step (status gated), not just type/string fields. Returns the status. */
  submit(runs: ResearchRunStore, runId: string, stepId: string, decision: 'approved' | 'rejected', principal: TrustedHumanPrincipal): StepStatus
}

let activeChannel: HostApprovalChannel | undefined

/**
 * Mint the singleton host approval channel. Intended to be called ONCE at host process startup
 * (FUTURE Host wiring — Interaction phase; NO caller exists today) with a secret from
 * `process.env.DSH_APPROVAL_SECRET` (env the Agent tool layer cannot observe). Throws
 * DSH_APPROVAL_CHANNEL_EXISTS if a channel already exists (singleton — P0-1-H1
 * defense-in-depth FOR the future host-wiring integration). This singleton gate is NOT the
 * load-bearing defense against Agent self-approval of host runs — that is RC-C module-scoped
 * store isolation (`submit` takes the run store as its first parameter; the host store is not
 * obtainable by an Agent), which is code-enforced today regardless of startup ordering.
 */
export function createHostApprovalChannel(hostSecret: string): HostApprovalChannel {
  if (activeChannel !== undefined) {
    throw new ResearchError('DSH_APPROVAL_CHANNEL_EXISTS', 'createHostApprovalChannel: an approval channel already exists (singleton — the host creates it once at startup; late creation rejected)')
  }
  if (!hostSecret) {
    throw new ResearchError('DSH_APPROVAL_SECRET_REQUIRED', 'createHostApprovalChannel: hostSecret is required (mint from process.env.DSH_APPROVAL_SECRET)')
  }
  const registry = new Set<string>()
  // Per-channel module-private principal registry (RC-E E1): the SOLE identity guard. Membership
  // is by object identity, unforgeable (not an own property; cannot be copied). A forged object
  // (Object.create(prototype) / plain object / copied-properties) is never a member → rejected.
  const principals = new WeakSet<TrustedHumanPrincipal>()
  const channel: HostApprovalChannel = {
    registerPrincipal(principalId: string): void {
      if (!principalId || principalId === 'agent') {
        throw new ResearchError('DSH_PRINCIPAL_INVALID', 'registerPrincipal: principalId cannot be empty or \'agent\'')
      }
      registry.add(principalId)
    },
    mintPrincipal(runId: string, stepId: string, principalId: string, approvalEventId: string): TrustedHumanPrincipal {
      if (!principalId || principalId === 'agent') {
        throw new ResearchError('DSH_PRINCIPAL_INVALID', 'mintPrincipal: principalId cannot be empty or \'agent\'')
      }
      if (!approvalEventId) {
        throw new ResearchError('DSH_PRINCIPAL_INVALID', 'mintPrincipal: approvalEventId is required')
      }
      const principal = new TrustedHumanPrincipal(MINT_TOKEN, principalId, approvalEventId, runId, stepId)
      // Freeze at mint time — runtime immutability, NOT just TS `readonly` (stripped at runtime).
      // runId/stepId/principalId/approvalEventId become non-writable data properties; post-mint
      // mutation throws TypeError in strict mode (ESM). Frozen BEFORE entering the WeakSet and
      // BEFORE returning, so the object is immutable before any holder can observe it.
      Object.freeze(principal)
      principals.add(principal)
      return principal
    },
    submit(runs: ResearchRunStore, runId: string, stepId: string, decision: 'approved' | 'rejected', principal: TrustedHumanPrincipal): StepStatus {
      // Single-snapshot (INV-PRINCIPAL-SNAPSHOT): read each principal field ONCE into locals.
      // The principal is frozen at mint time (Object.freeze), so these are immutable — but
      // reading once also defeats a getter-bearing principal that returns a different value per
      // read, keeping the runId/stepId/principalId/approvalEventId checks + the _applyHumanApproval
      // delegation on the SAME values (no check-vs-delegate desync).
      const pRunId = principal.runId
      const pStepId = principal.stepId
      const pPrincipalId = principal.principalId
      const pApprovalEventId = principal.approvalEventId
      // RC-E E1: object identity + owning channel. Membership is unforgeable (WeakSet.has by
      // identity, not by copied properties/symbols) — defeats Object.create(prototype), forged
      // plain objects, and copied-property principals alike.
      if (!principals.has(principal)) {
        throw new ResearchError('DSH_PRINCIPAL_NOT_TRUSTED', 'submit: principal was not minted by this channel (object-identity WeakSet check — RC-E E1; forged prototypes / plain objects / copied properties rejected)')
      }
      // RC-E E2: the principal is bound to the specific (runId, stepId) it was minted for.
      // Cross-run / cross-step use is rejected (the principal must be re-minted per approval).
      if (pRunId !== runId) {
        throw new ResearchError('DSH_PRINCIPAL_RUN_MISMATCH', `submit: principal was minted for run '${pRunId}' but submitted for run '${runId}' — re-mint a principal per (run, step) (RC-E E2)`)
      }
      if (pStepId !== stepId) {
        throw new ResearchError('DSH_PRINCIPAL_STEP_MISMATCH', `submit: principal was minted for step '${pStepId}' but submitted for step '${stepId}' — re-mint a principal per (run, step) (RC-E E2)`)
      }
      if (!registry.has(pPrincipalId)) {
        throw new ResearchError('DSH_PRINCIPAL_NOT_REGISTERED', `submit: principalId '${pPrincipalId}' is not in this channel's authenticated principal registry (P0-1-H5)`)
      }
      // _applyHumanApproval re-checks status==='gated' (the current pending-approval step —
      // INV-APPROVAL-STATE) + step.humanGate + approvalEventId single-use (INV-REPLAY).
      return _applyHumanApproval(runs, runId, stepId, decision, pPrincipalId, pApprovalEventId)
    },
  }
  activeChannel = channel
  return channel
}

/**
 * Test helper: reset the singleton between tests. ONLY reachable from the host.ts SOURCE
 * (tests import this module relatively); the production `./host` subpath is built from
 * `host-prod.ts`, which does NOT re-export this function, so it is tree-shaken out of
 * `lib/host.js` — a production importer cannot obtain it (RC-E E2). NOT for production use.
 */
export function _resetApprovalChannelForTests(): void {
  activeChannel = undefined
}
