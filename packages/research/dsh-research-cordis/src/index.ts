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
 * DELIBERATELY NOT IMPLEMENTED HERE, and that is a design boundary rather than a contract
 * gap: core already carries the abstention (T19 added `HoldReason = 'human_gate' |
 * 'gate_abstained'`; the state machine parks an abstained step at 'gated' with
 * holdReason='gate_abstained' and never lets it become 'passed'; the host approval channel
 * refuses human approval of a held step). What this thin adapter declines is inferring a
 * step transition from a gate outcome on the caller's behalf — the driver decides when to
 * call submitGateVerdict / completeStep. getGateIntent is the ONLY mapping surface on the
 * service and it delegates verbatim to gateToStateMachineIntent (the frozen
 * GATE_OUTCOME_TO_INTENT table) — an outcome is never reinterpreted here.
 *
 * @module @deepseek-ai/dsh-research-cordis
 */

import { isAbsolute } from 'node:path'

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { buildToolDeps, type CitationChannel, type LiteratureChannel, researchToolsPlugin } from './tools.ts'
import { createDeterministicAdapter } from './deterministic-llm.ts'
import type { DeterministicProseConfig } from './deterministic-llm.ts'
import { LlmProseWriter, type LlmProseWriterConfig } from './llm-prose-writer.ts'
import type { ResearchToolDeps } from '@deepseek-ai/dsh-research-tools'
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

/** Adapter config.
 *
 *  `requireResearchTools` decides what happens when registering the seven catalog
 *  tools FAILS (corrected 2026-09-14 against a real 1120 boot). The engine waits
 *  for the `tools` service with `ctx.inject`; if the service never appears the
 *  callback never runs, and that absence is tolerated either way — the engine stays
 *  a standalone `ctx.research` state machine. What this flag decides is the OTHER
 *  failure: the service IS present and registration did not produce Ours. With the
 *  flag set that throw propagates instead of being swallowed; unset, a registration
 *  failure is tolerated.
 *
 *  The shipped `research-app` bundle sets it. Setting it is not what makes the
 *  tools register — `ctx.inject` is — and the earlier claim that this flag made
 *  tool registration a startup requirement was wrong: the flag was unset AND the
 *  mount ran before `tools` existed, so the bundle registered no research tool at
 *  all. See `toolsReady`. */
/**
 * The `prose` row as a deployment writes it in `cordis.yml`. The session working
 * directory is deliberately absent — {@link ResearchEngine} resolves it once from
 * `Config.workspace`, so it is stated in one place per deployment instead of once
 * per row.
 */
export type ProseChannelConfig = Omit<LlmProseWriterConfig, 'cwd'>

/**
 * Which provider route the prose steps run on.
 *
 * The two variants are a deployment's choice between reaching a real model vendor and
 * running fully offline. Neither is a default: `kind` is required, because the two
 * produce artifacts that must be described differently — see
 * {@link DeterministicProseConfig} for what the deterministic route's text is and is not.
 */
export type ProseChannel =
  | ({ readonly kind: 'llm' } & ProseChannelConfig)
  | {
    readonly kind: 'deterministic'
    /** Model id requests are addressed to; defaults to the route's own id. */
    readonly model?: string
    /** Provider route to register; defaults to {@link DETERMINISTIC_PROSE_PROVIDER}. */
    readonly provider?: string
    /** Route display name. */
    readonly name?: string
    /** Body template; see {@link DEFAULT_DETERMINISTIC_TEMPLATE}. */
    readonly template?: string
  }

/** Route the deterministic prose provider registers on when a deployment names none. */
export const DETERMINISTIC_PROSE_PROVIDER = 'research-deterministic'

/** Model id the deterministic prose route offers when a deployment names none. */
export const DETERMINISTIC_PROSE_MODEL = 'deterministic-prose-v1'

export interface Config {
  readonly requireResearchTools?: boolean
  /**
   * Literature-retrieval channel for the seven research tools. `'fixture'`
   * (default) keeps the synthetic corpus, so an offline deployment behaves exactly
   * as before; `'openalex'` assembles the real catalogue adapter, and every
   * artifact then carries real records.
   *
   * Selecting a real channel is a deployment decision recorded in `cordis.yml`,
   * never a silent default — see the truthfulness vocabulary in the runner, which
   * separates fixture from live evidence.
   */
  readonly literatureSearch?: LiteratureChannel
  /**
   * Bibliographic-resolver channel for the citation identity chain. Omitted (or
   * `'fixture'`), citations resolve against the fixture; `'openalex'` resolves them
   * against the real catalogue, so a fabricated DOI becomes an authoritative
   * `not_found` (a hard block) instead of a fixture verdict.
   */
  readonly citationResolver?: CitationChannel
  /**
   * Channel for prose steps (A1 gap analysis, D2 outline, D3 writing, D4 rebuttal).
   *
   * Omitted, those steps emit their fixture text and no provider is contacted — the same
   * posture as an omitted `literatureSearch`. Otherwise `kind` selects between a real
   * provider route and the deterministic offline route.
   *
   * The session's working directory is NOT set here: this engine resolves it once
   * from {@link Config.workspace} and supplies it to the writer.
   */
  readonly prose?: ProseChannel
  /**
   * Absolute working directory for every agent session this engine creates (prose
   * writes and model-ready tool invocations). Omitted, it resolves to the
   * deployment's `process.cwd()`.
   *
   * This is the deployment's choice of where research sessions run, and it is not
   * optional in effect: `{{cwd}}` is a strict system-prompt variable that every
   * shipped bundle's persona references, so a session created without one fails at
   * prompt ASSEMBLY and its request never reaches the provider. A relative value is
   * rejected here rather than by the session layer.
   */
  readonly workspace?: string
}

/**
 * The in-memory run store — MODULE-SCOPED so it is genuinely runtime-private (RC-C). See the
 * file header for the rationale (TS `private` is runtime-erased; `#runs` is incompatible with
 * Cordis's service Proxy). Lexical access (no `this`) sidesteps the Proxy; no property/symbol
 * on the instance is enumerable, so `ctx.research.runs` is undefined. Cleared on owning-fiber
 * unload by [Service.init] (singleton service — module scope ≡ instance scope).
 */
const runs: ResearchRunStore = new Map()

/**
 * Resolve the deployment's session working directory.
 *
 * An explicit resolution step, in the owning implementation — the same posture as
 * the runner's own output-directory resolution — rather than a `?? process.cwd()`
 * buried in each call site that creates a session.
 *
 * @param configured - the deployment's `workspace` value, if it stated one.
 * @returns an absolute path.
 * @throws {Error} when the configured value is not absolute, which the session layer
 *   would otherwise reject much later and with less context.
 */
function resolveWorkspace(configured: string | undefined): string {
  const cwd = configured ?? process.cwd()
  if (!isAbsolute(cwd)) {
    throw new Error(
      `[research] \`workspace\` must be an absolute path, got "${cwd}" — every session this `
      + 'engine creates needs one because `{{cwd}}` is a strict system-prompt variable',
    )
  }
  return cwd
}

export class ResearchEngine extends Service {
  static Config: z<Config> = z.object({})

  private readonly requireResearchTools: boolean
  /**
   * Set only at the commit point: after the seven-tool plugin registered AND its
   * readiness check passed. A reader never sees it true for a registration that
   * subsequently failed, and it stays false on a host that provides no `tools`
   * service at all.
   */
  private toolsRegistered = false

  /** True once the seven research tools are registered and verified on this host. */
  get toolsReady(): boolean {
    return this.toolsRegistered
  }
  /**
   * The assembled tool dependency graph for this deployment. Public on purpose:
   * the team service reads it so that ONE retrieval-channel decision governs every
   * capability step, instead of each step carrying its own literal. It is
   * configuration data, not hidden run state, so exposing it is safe.
   */
  readonly toolDeps: ResearchToolDeps
  /**
   * The resolved absolute working directory for every session this engine creates.
   * Resolved once here (not defaulted at each call site) so the prose writer and any
   * model-ready tool invoker cannot disagree about it.
   */
  readonly sessionCwd: string
  /**
   * The real-model prose writer when `config.prose` names a route, else undefined.
   * Public for the same reason {@link ResearchEngine.toolDeps} is: the team service
   * reads it so one deployment-level choice governs every prose step.
   */
  readonly proseWriter: LlmProseWriter | undefined

  /**
   * The deterministic provider to register at load, when the deployment selected that
   * route. Registration is deferred to {@link ResearchEngine.[Service.init]} so it is an
   * effect owned by this fiber rather than a side effect of construction.
   */
  private readonly deterministicProse: DeterministicProseConfig | undefined

  /** Set at the commit point of the deterministic route's registration. */
  private proseReady = false

  /** True once the deterministic prose provider is registered on `ctx.llm`. */
  get proseRouteReady(): boolean {
    return this.proseReady
  }

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'research')
    this.requireResearchTools = config.requireResearchTools ?? false
    this.toolDeps = buildToolDeps(config.literatureSearch, config.citationResolver)
    this.sessionCwd = resolveWorkspace(config.workspace)

    const prose = config.prose
    if (prose?.kind === 'deterministic') {
      this.deterministicProse = {
        provider: prose.provider ?? DETERMINISTIC_PROSE_PROVIDER,
        model: prose.model ?? DETERMINISTIC_PROSE_MODEL,
        ...prose.name === undefined ? {} : { name: prose.name },
        ...prose.template === undefined ? {} : { template: prose.template },
      }
      this.proseWriter = new LlmProseWriter(ctx, {
        provider: this.deterministicProse.provider,
        model: this.deterministicProse.model,
        cwd: this.sessionCwd,
      })
    } else if (prose !== undefined) {
      this.proseWriter = new LlmProseWriter(ctx, {
        provider: prose.provider,
        model: prose.model,
        ...prose.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: prose.idleTimeoutMs },
        cwd: this.sessionCwd,
      })
    } else {
      this.proseWriter = undefined
    }
  }

  /** Load: register an unload effect clearing the in-memory run store (ephemeral — see C-6). */
  async [Service.init](): Promise<void> {
    this.ctx.effect(() => () => {
      runs.clear()
    }, 'research.runs')
    // Both host services this engine binds to are LOAD-ORDER DEPENDENT. The loader
    // starts its entries concurrently, so neither `ctx.get('tools')` nor
    // `ctx.get('llm')` is available while this method runs — measured on a real 1120
    // boot: both are `undefined` here and objects about 50 ms later. Reading either
    // one directly skipped its binding permanently, and the tolerant paths swallowed
    // the skip: the bundle once served a UI with NO research tools registered, and the
    // deterministic prose route failed the whole boot. `ctx.inject` is the framework's
    // own answer — the callback runs once the dependency is available, whenever that
    // turns out to be.
    //
    // When a service is ALREADY up the work settles within this load, so awaiting
    // keeps a load-time gate (`requireResearchTools` still throws out of `ctx.plugin`
    // in that case). When it is not up yet, awaiting would hang the load for as long
    // as the host takes to provide it, so the effect commits whenever it appears.
    const injectedTools = this.ctx.inject(['tools'], toolsCtx => this.mountResearchTools(toolsCtx))
    if (this.ctx.get('tools') !== undefined) await injectedTools
    if (this.deterministicProse !== undefined) {
      const injectedLlm = this.ctx.inject(['llm'], llmCtx => this.registerDeterministicProse(llmCtx))
      if (this.ctx.get('llm') !== undefined) await injectedLlm
    }
  }

  /**
   * Register the deterministic prose provider on the real `ctx.llm`, when the deployment
   * selected that route, as an effect owned by this engine's fiber.
   *
   * The `llm` service is read through `ctx.get`: this engine does not declare it as an
   * injection, and a deployment that selected the deterministic route without an LLM
   * runtime cannot serve prose at all — so its absence is reported as itself rather than
   * discovered later as a failed write.
   *
   * @throws {Error} when the deterministic route is configured but no LLM service exists.
   */
  private registerDeterministicProse(llmCtx: Context): void {
    const config = this.deterministicProse
    if (config === undefined) return
    const llm = llmCtx.get('llm') as
      | { registerAdapter: (providers: string[], adapter: unknown) => () => void }
      | undefined
    if (llm === undefined) return
    llmCtx.effect(
      () => llm.registerAdapter([config.provider], createDeterministicAdapter(config)),
      'research.prose.deterministic',
    )
    this.proseReady = true
  }

  /**
   * Mount the seven-tool plugin on a context where `tools` is available.
   *
   * Absence of the service is not a failure — this callback simply never runs, and
   * a standalone engine stays a usable `ctx.research` state machine. What IS a
   * failure is the service being present and registration not producing Ours: the
   * plugin verifies the full catalog and throws. `requireResearchTools` decides
   * whether that throw propagates (a required deployment must not run without its
   * tool surface) or is tolerated (a standalone embedding).
   *
   * @param toolsCtx - the context the `tools` inject resolved on.
   */
  private async mountResearchTools(toolsCtx: Context): Promise<void> {
    try {
      await toolsCtx.plugin(researchToolsPlugin, {
        verify: true,
        deps: this.toolDeps,
      })
      this.toolsRegistered = true
    } catch (error) {
      if (this.requireResearchTools) throw error
      // Tolerant: the engine stays functional without the tool surface.
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
  // StepState is intentionally absent — core owns that transition, including the
  // abstention case (see the header note on the abstention boundary).

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
  ): Promise<VerificationResult> {
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

/** Real literature-retrieval channel (OpenAlex). Lives here, not in the pure tool
 *  module, so the tool package keeps holding zero network code. */
export { OpenAlexLiteratureAdapter } from './openalex-adapter.ts'
export type { OpenAlexAdapterOptions } from './openalex-adapter.ts'

/** Real bibliographic resolver (OpenAlex) for the citation identity chain. */
export { OpenAlexCitationResolver } from './openalex-citation-resolver.ts'
export type { OpenAlexCitationResolverOptions } from './openalex-citation-resolver.ts'

/** Real-model prose channel for the runner's text-producing steps. */
export { LlmProseWriter, assistantTextOf, turnErrorOf } from './llm-prose-writer.ts'
export type { LlmProseWriterConfig, ProseRequestLike, ProseResultLike } from './llm-prose-writer.ts'

/** Deterministic offline provider for the prose channel (see its module header). */
export { createDeterministicAdapter, DEFAULT_DETERMINISTIC_TEMPLATE, deriveDeterministicText, digestOf } from './deterministic-llm.ts'
export type { DeterministicProseConfig } from './deterministic-llm.ts'
