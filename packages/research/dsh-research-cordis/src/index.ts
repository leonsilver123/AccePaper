/**
 * Thin Cordis adapter wrapping the pure dsh-research-core v2 hardened state machine.
 *
 * Registers `ctx.research` — a {@link ResearchEngine} service delegating every operation to
 * the pure core (no state-machine logic is duplicated here). The Service base registers the
 * instance on `ctx` (auto-unregister on owning-fiber unload); `[Service.init]` adds an unload
 * effect clearing the run store.
 *
 * The in-memory run store is MODULE-SCOPED (RC-C), not an instance field: TS `private` is
 * compile-time-only (runtime-erased to a plain property — `ctx.research.runs` returned the live
 * Map, letting an Agent tool mutate RunState/StepState directly), and an ES `#runs` private
 * field is incompatible with Cordis's service Proxy (the method's `this` is the Proxy, which
 * did not declare `#runs` — "Cannot read private member from an object whose class did not
 * declare it"). A module-scoped const is lexical — no property/symbol on the instance is
 * enumerable, so `ctx.research.runs` is undefined and no live internal reference escapes the
 * API boundary. ResearchEngine is a singleton service (one store per app/realm), so module
 * scope is equivalent to instance scope; cleared on owning-fiber unload by [Service.init].
 *
 * v2 changes: every method carries `runId` (INV-RUN-ISOLATION); returns are the core's
 * deep-cloned snapshots (INV-SNAPSHOT). NO human-approval capability is exposed on this
 * service surface — `submitHumanApproval`/`TrustedHumanPrincipal` live in the host trust
 * channel (`@deepseek-ai/dsh-research-core/host`), NOT on `ctx.research`, so an Agent tool
 * calling `ctx.research` cannot pass a humanGate step to 'passed'. `transition` and
 * `approveHumanGate` are DROPPED (INV-NO-RAW-TRANSITION, INV-NO-LEGACY-APPROVE).
 *
 * The "name / inject / Config / apply" three-piece is satisfied by the cordis class-plugin
 * convention: `name` via `super(ctx, 'research')`, `Config` as a static schema, and `apply`
 * via `ctx.plugin(ResearchEngine, config)` → constructor + `[Service.init]`.
 *
 * I1 (T10-R thin adapter, batch 2 wave-1): the service additionally delegates the PURE
 * T07/T08/T09 result surface — classifyL0 / verifyCitation / evaluateGate (= adjudicate) /
 * getGateIntent. These methods mirror the core signatures, return the core's deep-cloned +
 * frozen results, and touch NO run state. Gate-outcome → StepState AUTO-WIRING IS
 * DELIBERATELY NOT IMPLEMENTED HERE: the batch-1 status enum (pending / in_progress /
 * gated / passed / blocked / failed) has no home for the frozen intent 'hold_abstained'
 * (abstained must NEVER become passed), so that contract gap is left to a dedicated design
 * decision instead of an ad-hoc mapping in this file. getGateIntent is the ONLY mapping
 * surface on the service and it delegates verbatim to gateToStateMachineIntent (the frozen
 * GATE_OUTCOME_TO_INTENT table) — an outcome is never reinterpreted here.
 *
 * @module @deepseek-ai/dsh-research-cordis
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { researchToolsPlugin } from './tools.ts'
import {
  adjudicate,
  canStart,
  classifyL0,
  completeStep,
  createRun,
  gateToStateMachineIntent,
  getArtifact,
  getAuditHistory,
  getRunSnapshot,
  isComplete,
  recordArtifact,
  rollback,
  setRunInput,
  startIfCan,
  startStep,
  submitGateVerdict,
  verifyCitation,
} from '@deepseek-ai/dsh-research-core'
import type {
  AdjudicationInput,
  AdjudicationResult,
  AuditEntry,
  CitationEvidence,
  CitationId,
  CitationRef,
  CitationResolverAdapter,
  ClaimId,
  GateVerdict,
  L0Classification,
  L0RoutingAdapter,
  L0SourceInput,
  ResearchRunStore,
  RunSnapshot,
  StateMachineGateIntent,
  StepSnapshot,
  StepStatus,
  VerificationResult,
  VerifyCitationOptions,
} from '@deepseek-ai/dsh-research-core'

declare module '@deepseek-ai/cordis' {
  interface Context {
    research: ResearchEngine
  }
}

/** Adapter config. `requireResearchTools` turns tool registration into a
 *  STARTUP REQUIREMENT (research-bundle / T30 mode): if the host lacks the
 *  `tools` service, or fewer than the seven catalog tools can be registered and
 *  verified, the engine load FAILS loudly instead of silently degrading. When
 *  unset/false the engine remains a standalone ctx.research state machine. */
export interface Config {
  readonly requireResearchTools?: boolean
}

/**
 * The in-memory run store — MODULE-SCOPED so it is genuinely runtime-private (RC-C). See the
 * file header for the rationale (TS `private` is runtime-erased; `#runs` is incompatible with
 * Cordis's service Proxy). Lexical access (no `this`) sidesteps the Proxy; no property/symbol
 * on the instance is enumerable, so `ctx.research.runs` is undefined. Cleared on owning-fiber
 * unload by [Service.init] (singleton service — module scope ≡ instance scope).
 */
const runs: ResearchRunStore = new Map()

export class ResearchEngine extends Service {
  static Config: z<Config> = z.object({})

  private readonly requireResearchTools: boolean

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'research')
    this.requireResearchTools = config.requireResearchTools ?? false
  }

  /** Load: register an unload effect clearing the in-memory run store (ephemeral — see C-6). */
  async [Service.init](): Promise<void> {
    this.ctx.effect(() => () => {
      runs.clear()
    }, 'research.runs')
    // T13-R: when the host provides the `tools` service (full bundle / web
    // profile), register the seven research tools on ctx.tools at plugin start
    // (defineTool + ctx.tools.register, fixture deps injected, exposure guards
    // wired). The registration rides a nested plugin that DECLARES the `tools`
    // inject (cordis refuses ctx.tools reads without an inject declaration).
    //  - standalone (`requireResearchTools` unset): absence of a tools service
    //    is tolerated — the engine loads as a pure ctx.research state machine;
    //  - T30/research-bundle (`requireResearchTools: true`): the nested plugin
    //    is a STARTUP REQUIREMENT. Cordis silently skips a nested plugin whose
    //    inject is unmet (it does not reject), so a missing tools service is
    //    detected through the registration marker — the engine load FAILS
    //    loudly rather than booting a research bundle without its tools.
    if (this.requireResearchTools) {
      await this.mountResearchTools()
    } else {
      await this.mountResearchToolsTolerant()
    }
  }

  /** Required registration path (research-bundle / T30 mode). */
  private async mountResearchTools(): Promise<void> {
    let ready = false
    await this.ctx.plugin(researchToolsPlugin, { verify: true, onReady: () => { ready = true } })
    // `ready` is only flipped by the plugin's onReady callback (which runs on a
    // context that may be an isolate), so control-flow analysis cannot see it.
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    if (!ready) {
      throw new Error(
        '[research-cordis] requireResearchTools: the seven research tools could not be '
        + 'registered (tools service absent or registration failed) — refusing to boot a '
        + 'research bundle without its tool surface',
      )
    }
  }

  /**
   * Tolerant registration path (standalone engines): attempt to register the
   * research tools; any absence of the tools service is silently tolerated.
   */
  private async mountResearchToolsTolerant(): Promise<void> {
    try {
      await this.ctx.plugin(researchToolsPlugin, { verify: true })
    } catch {
      // No `tools` service: registration skipped, engine stays functional.
    }
  }

  createRun(runId?: string): string {
    return createRun(runs, runId)
  }

  setRunInput(runId: string, slug: string, value: unknown): void {
    setRunInput(runs, runId, slug, value)
  }

  getRunSnapshot(runId: string): RunSnapshot {
    return getRunSnapshot(runs, runId)
  }

  getArtifact(runId: string, slug: string): unknown {
    return getArtifact(runs, runId, slug)
  }

  canStart(runId: string, stepId: string): boolean {
    return canStart(runs, runId, stepId)
  }

  startStep(runId: string, stepId: string): StepSnapshot {
    return startStep(runs, runId, stepId)
  }

  startIfCan(runId: string, stepId: string): StepSnapshot | null {
    return startIfCan(runs, runId, stepId)
  }

  recordArtifact(runId: string, stepId: string, outputSlug: string, value: unknown): void {
    recordArtifact(runs, runId, stepId, outputSlug, value)
  }

  submitGateVerdict(runId: string, stepId: string, verdict: GateVerdict): StepStatus {
    return submitGateVerdict(runs, runId, stepId, verdict)
  }

  completeStep(runId: string, stepId: string): StepStatus {
    return completeStep(runs, runId, stepId)
  }

  rollback(runId: string, stepId: string): void {
    rollback(runs, runId, stepId)
  }

  isComplete(runId: string, stepId: string): boolean {
    return isComplete(runs, runId, stepId)
  }

  getAuditHistory(runId: string, stepId: string): AuditEntry[] {
    return getAuditHistory(runs, runId, stepId)
  }

  // ── T10-R thin result surface (batch 2 wave-1 I1) ─────────────────────────
  // PURE delegation of T07/T08/T09 to the core functions. These methods take NO
  // runId, touch NO run store, and perform NO state transition: the core does
  // the clone + freeze at its own boundary, so each return is a frozen snapshot
  // with no live reference back to caller state. Auto-wiring gate outcomes to
  // StepState is intentionally absent (see the header note on the
  // hold_abstained contract gap).

  /** T07 — L0 routing: delegate to the pure router. The adapter is
   *  caller-supplied (core ships mockL0Adapter as a fixture). */
  classifyL0(source: L0SourceInput, adapter: L0RoutingAdapter): L0Classification {
    return classifyL0(source, adapter)
  }

  /** T08 — citation identity verification: full thin pass-through of the core
   *  signature (claim / citation / ref / evidence / resolver / timestamp /
   *  options). Resolver contact rules (#6 short-circuit, fabrication
   *  discrimination) are enforced entirely inside core. */
  verifyCitation(
    claimId: ClaimId,
    citationId: CitationId,
    ref: CitationRef,
    evidence: CitationEvidence,
    resolverAdapter: CitationResolverAdapter,
    timestamp: number,
    options: VerifyCitationOptions,
  ): VerificationResult {
    return verifyCitation(claimId, citationId, ref, evidence, resolverAdapter, timestamp, options)
  }

  /** T09 — pure gate adjudication under the T10-R name. Returns the frozen
   *  {@link AdjudicationResult}; performs NO state transition (auto-wiring a
   *  gate outcome to StepState is deliberately deferred). */
  evaluateGate(input: AdjudicationInput): AdjudicationResult {
    return adjudicate(input)
  }

  /** T09 — canonical-name alias of {@link evaluateGate}. */
  adjudicate(input: AdjudicationInput): AdjudicationResult {
    return adjudicate(input)
  }

  /** Single interpretation point for a gate outcome: delegates verbatim to the
   *  frozen core helper gateToStateMachineIntent (GATE_OUTCOME_TO_INTENT in
   *  contracts.ts). This service NEVER reinterprets an outcome — abstained
   *  maps to 'hold_abstained', never to pass. */
  getGateIntent(result: AdjudicationResult): StateMachineGateIntent {
    return gateToStateMachineIntent(result.outcome)
  }
}

export default ResearchEngine
