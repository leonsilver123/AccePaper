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

import { isAbsolute, resolve } from 'node:path'

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { buildToolDeps, type CitationChannel, type LiteratureChannel, researchToolsPlugin } from './tools.ts'
import type { SourceLibraryConfig } from './tools.ts'
import { createDeterministicAdapter } from './deterministic-llm.ts'
import type { DeterministicProseConfig } from './deterministic-llm.ts'
import { LlmProseWriter, type LlmProseWriterConfig } from './llm-prose-writer.ts'
import { LlmReviewer, type LlmReviewerConfig } from './llm-reviewer.ts'
import { MatplotlibProvider } from './matplotlib-provider.ts'
import type { SourceRegistration, SourceRegistryMode } from '@deepseek-ai/dsh-research-core'
import { CitationJsBibliographyWriter } from './bibliography-writer.ts'
import { readRegistrations } from './zotero-registration.ts'
import type { CitedItem } from './zotero-registration.ts'
import { ZoteroProvider, resolveAttachmentPolicy } from './zotero-provider.ts'
import type { ReferenceFileReaderLike } from './zotero-provider.ts'
import { ZoteroLiteratureAdapter } from './zotero-literature-adapter.ts'
import { PandocCompiler } from './pandoc-compiler.ts'
import type { ResearchToolDeps } from '@deepseek-ai/dsh-research-tools'
import {
  adjudicate,
  canStart,
  classifyL0,
  completeStep,
  createRun,
  DEFAULT_EVIDENCE_PROFILE,
  EVIDENCE_PROFILES,
  gateToStateMachineIntent,
  getArtifact,
  getAuditHistory,
  getRunSnapshot,
  isComplete,
  isEvidenceProfile,
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
  EvidenceProfile,
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
  | {
    /** Send on a real provider route, configured by the fields this variant carries. */
    readonly kind: 'llm'
  } & ProseChannelConfig
  | {
    /** Answer in-process through the deterministic route, which calls no model at all. */
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

/**
 * The review rules a deployment that states none is held to.
 *
 * A DEFAULT HERE IS NOT A CLAIM ABOUT THE RULES: it names the version so a verification can say which
 * instructions it was taken under, and the alternative — an absent version — is what the runner
 * refuses, because two roles are distinct tasks by their instructions. A deployment that changes what
 * it asks its reviewer to do states its own version.
 */
export const DEFAULT_REVIEW_INSTRUCTIONS_VERSION = 'revision-review-1'

/**
 * How long the registration waits when the deployment names no window.
 *
 * BOUNDED, because the wait is for a signal that may never come: a deployment that mounts no Zotero
 * server must end up reporting `metadata-tool-missing` rather than hanging the boot. A deployment
 * whose servers start slowly raises it through `literatureSearch.sourceToolWaitMs`.
 */
const DEFAULT_SOURCE_TOOL_WAIT_MS = 30_000

/** How often the registration looks for those tools while it waits. */
const MCP_TOOL_POLL_MS = 250

/** Route the deterministic prose provider registers on when a deployment names none. */
export const DETERMINISTIC_PROSE_PROVIDER = 'research-deterministic'

/** Model id the deterministic prose route offers when a deployment names none. */
export const DETERMINISTIC_PROSE_MODEL = 'deterministic-prose-v1'

/**
 * Deployment configuration for the research engine: which retrieval and prose channels this
 * deployment reaches, and where a run's products are written.
 *
 * Every field is a DEPLOYMENT decision recorded in `cordis.yml`, never a request parameter. The
 * channels decide what counts as evidence (fixture records versus catalogue records), and the
 * directories decide where `runPipeline` writes — a Remote client can invoke that method, so it
 * must not be able to choose either.
 */
export interface Config {
  /**
   * What happens when registering the seven catalogue tools FAILS (corrected 2026-09-14 against a
   * real 1120 boot).
   *
   * The engine waits for the `tools` service with `ctx.inject`; if the service never appears the
   * callback never runs, and that absence is tolerated either way — the engine stays a standalone
   * `ctx.research` state machine. What this flag decides is the OTHER failure: the service IS
   * present and registration did not produce Ours. With the flag set that throw propagates instead
   * of being swallowed; unset, a registration failure is tolerated.
   *
   * The shipped `research-app` bundle sets it. Setting it is not what makes the tools register —
   * `ctx.inject` is — and the earlier claim that this flag made tool registration a startup
   * requirement was wrong: the flag was unset AND the mount ran before `tools` existed, so the
   * bundle registered no research tool at all. See `toolsReady`.
   */
  readonly requireResearchTools?: boolean
  /**
   * What this deployment's evidence is allowed to be: `'production'` or `'evaluation'`.
   *
   * A DEPLOYMENT claim recorded in `cordis.yml`, never a request parameter, and the two values put
   * the deployment on record differently. `'production'` states that this deployment's evidence can
   * carry a submission: only simulated, imported, measured and literature values whose source was
   * read in full may carry a gate, and a fixture is REFUSED rather than replaced by a value that
   * would pass. `'evaluation'` admits every class so the pipeline can be exercised, and marks its
   * ENTIRE output unsubmittable — the permission to run and the permission to publish are separate,
   * and this field is where they are kept separate.
   *
   * Omitted, it resolves to {@link DEFAULT_EVIDENCE_PROFILE} (`'evaluation'`), so an undeclared run
   * can be driven and can never be submitted; `'production'` is reachable only by stating it. A
   * value naming no profile is rejected at load rather than silently resolved.
   */
  readonly evidenceProfile?: EvidenceProfile
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
   * The library whose sources a run may cite, when this deployment cites from one.
   *
   * INDEPENDENT OF {@link Config.literatureSearch}. That field says what A1 searches for the
   * landscape; this one says what the manuscript may cite. Setting them from one switch made pointing
   * a run at a curated library for CITATION also replace its SEARCH source, which emptied the corpus
   * of a run that was configured correctly — see {@link SourceLibraryConfig}.
   *
   * A deployment that also wants the library AS its landscape source sets
   * `literatureSearch.kind: 'zotero'` and may leave this absent: the channel's own fields supply it.
   */
  readonly sourceLibrary?: SourceLibraryConfig
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
   * The document toolchain this deployment has, when it has one.
   *
   * ABSENT BY DEFAULT, and that is the honest default: whether a machine has `pandoc` (and a LaTeX
   * engine behind it) is a fact about the machine, so a deployment states it. A run under a
   * deployment that names none still exports its manuscript as Markdown and records on the artifact
   * that it was not compiled — which is a different fact from a compile that failed.
   *
   * The formats the compiler offers are PROBED from the executables named here, so a deployment
   * without a LaTeX engine refuses `pdf` instead of producing an empty file.
   */
  readonly document?: DocumentChannel
  /**
   * The drawing capability this deployment has, when it has one.
   *
   * ABSENT MEANS THE BUILT-IN RENDERER, and every float records which one drew it, so a package's
   * figures can be traced to the library that produced them rather than to a guess about the machine.
   */
  readonly figures?: FigureChannel
  /**
   * Directory of the Case Pack this deployment runs against.
   *
   * A DEPLOYMENT setting, deliberately not a request parameter: `runPipeline` is exposed
   * as a Remote method, and letting a client name a filesystem path would hand it the
   * deployment's disk. Omitted, runs use the pipeline's built-in seeds and no pack.
   *
   * Relative paths resolve against {@link Config.workspace}. The engine only CARRIES this
   * value: the loader lives in `dsh-research-team`, which the runner-side service reads it
   * with, because this adapter must not depend on the team package (dependencies run
   * `core` ← `tools` ← {`cordis`, `team`}).
   */
  readonly casePackDirectory?: string
  /**
   * Directory the run's reproducible package is written to. Omitted, no package is written.
   *
   * Also a DEPLOYMENT setting for the same reason as {@link Config.casePackDirectory}: the
   * export runs inside `runPipeline`, which Remote clients can invoke, so a request-supplied
   * path would let a browser choose where the host writes files.
   *
   * Relative paths resolve against {@link Config.workspace}.
   */
  readonly packageDirectory?: string
  /**
   * Directory holding the durable run snapshot. Omitted, runs are not persisted.
   *
   * A DEPLOYMENT setting for the same reason as the two above. The directory must exist: the
   * snapshot store never creates it, so a missing one surfaces at the first save rather than
   * being papered over, and the runner-side service creates it at startup where it resolves
   * this option.
   *
   * Relative paths resolve against {@link Config.workspace}.
   */
  readonly snapshotDirectory?: string
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
  /**
   * Milliseconds one step may run before the driver aborts it, applied to every step.
   *
   * A DEPLOYMENT setting, because the right budget is a property of the channels the deployment
   * configured and not of the step: the offline prose route answers in milliseconds, while a
   * model route takes seconds to minutes for the same step. The registry declares a per-step
   * budget for the offline case, and this overrides it for the whole run when set. Omitted, the
   * registry budget applies unchanged.
   *
   * A step that exceeds it does NOT fail with an error: the driver records `timeout` and leaves
   * the step `in_progress`, so a budget set too low looks like a run that stopped for no stated
   * reason. Set it from the slowest channel the deployment reaches.
   */
  readonly stepTimeoutMs?: number
  /**
   * How many revision rounds `D4-rebuttal` may ask the author for.
   *
   * Omitted, the executor's own default applies. Set it to bound what one run may spend on a
   * manuscript that will not converge: a round that closes nothing is retried until this bound or
   * until the same sections are still open, whichever comes first.
   */
  readonly revisionRounds?: number
  /**
   * The reader-side channel: who decides the two judgements this pipeline refuses to make itself.
   *
   * ABSENT BY DEFAULT, for the same reason the prose channel is: whether a deployment's reviewer can
   * read a sentence against a passage, and a revision against the issue it answers, is a fact about
   * that deployment. A deployment that names none is not silently un-reviewed — the run records that
   * its sentences were not assessed and its revisions were not verified, which is a state a reader can
   * see, and `checkFinalPackage` refuses the package a journal would receive.
   *
   * ONE MODEL MAY HOLD BOTH ROLES. What D4 requires is that the two executions differ — different
   * execution identity, different session, their own rules — because those are what make the reading
   * stand apart from the revision. Whether they share a provider and model is RECORDED on every
   * verification as a shared-bias note; it is not a refusal, and a deployment that runs on one model
   * is making a decision it is allowed to make.
   */
  readonly review?: ReviewChannel
}

/**
 * The reader-side channel: who decides the two judgements the pipeline refuses to make itself.
 */
export interface ReviewChannel {
  /** The reader that judges one citing sentence against the source it cites. */
  readonly assessor?: Omit<LlmReviewerConfig, 'instructionsVersion'>
  /** The reader that decides whether a revision answers the issue it was written for. */
  readonly verifier?: LlmReviewerConfig
  /**
   * How many COMPLETE readings a manuscript must have had before it may be published.
   *
   * Omitted, the runner's own default applies (two). A deployment that requires one reading is making
   * a decision it is allowed to make, and one that requires two must not be satisfied by one — which
   * is why this is a policy the run carries rather than a number the review cycle counts against.
   */
  readonly minimumRounds?: number
}

/**
 * The drawing capability a deployment names, when it has one.
 *
 * ABSENT BY DEFAULT, for the same reason the document toolchain is: whether a machine has a scientific
 * plotting library is a fact about the machine. A run under a deployment that names none draws its
 * floats with the built-in renderer and says so on each float — a different fact from a figure that
 * failed to draw.
 */
export interface FigureChannel {
  /** The Python interpreter that has matplotlib — a virtual environment's, usually. */
  readonly executable: string
  readonly timeoutMs?: number
  /** The canvas the charts are drawn on, in pixels. */
  readonly width?: number
  readonly height?: number
}

/**
 * The document toolchain a deployment has: the executables, named rather than looked up.
 *
 * A CHANNEL like the prose and literature channels, and absent by default for the same reason: a
 * machine's toolchain is not something a deployment can assume, so it is stated or it is not had.
 */
export interface DocumentChannel {
  /** The pandoc executable. */
  readonly executable: string
  /** The LaTeX engine, when the deployment has one. Absent means this deployment cannot produce PDF. */
  readonly latexEngine?: string
  /** Time limit for one compile, milliseconds. */
  readonly timeoutMs?: number
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
 * Resolve the deployment's Case Pack directory against its workspace.
 *
 * @param configured - the deployment's `casePackDirectory`, if it named one.
 * @param workspace - the resolved session working directory.
 * @returns an absolute path, or undefined when no pack was configured.
 */
function resolveCasePackDirectory(configured: string | undefined, workspace: string): string | undefined {
  if (configured === undefined) return undefined
  return isAbsolute(configured) ? configured : resolve(workspace, configured)
}

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

/**
 * Resolve the deployment's evidence profile.
 *
 * An explicit resolution step in the owning implementation, like {@link resolveWorkspace}. The
 * value arrives from `cordis.yml` as untyped YAML, so it is checked here even though `Config`
 * declares the union: a typo must fail the load, not leave a deployment running under a profile it
 * did not choose.
 *
 * @param declared - the profile the deployment stated, if it stated one.
 * @returns the declared profile, or {@link DEFAULT_EVIDENCE_PROFILE} when none was declared.
 * @throws {Error} when the value names no profile, naming the field and the accepted values.
 */
function resolveEvidenceProfile(declared: unknown): EvidenceProfile {
  if (declared === undefined) return DEFAULT_EVIDENCE_PROFILE
  if (!isEvidenceProfile(declared)) {
    throw new Error(
      `[research] \`evidenceProfile\` must be one of ${EVIDENCE_PROFILES.join(' | ')}, got ${JSON.stringify(declared)}`,
    )
  }
  return declared
}

/**
 * The research engine service (`ctx.research`): the run store the 16-step pipeline drives, the
 * seven-tool surface registered on `ctx.tools`, and the deployment's retrieval and prose channels.
 *
 * The store methods below are what the driver advances a run with. The thin result surface
 * (T07/T08/T09) delegates to `dsh-research-core` without touching the store or performing any
 * state transition, so those calls are pure reads of core's own functions.
 */
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
   * The Case Pack directory this deployment names, resolved to an absolute path, or
   * undefined when it names none. Public for the same reason {@link ResearchEngine.toolDeps}
   * is: the runner-side service reads it, so one deployment decision governs which pack a
   * run is driven by. The engine does not read the pack — only carry where it is.
   */
  readonly casePackDirectory: string | undefined
  /**
   * Resolved directory the run package is written to, or undefined when the deployment
   * configured none. Read by the runner-side service, which performs the export.
   */
  readonly packageDirectory: string | undefined
  /**
   * Resolved directory holding the durable run snapshot, or undefined when the deployment
   * configured none. Read by the runner-side service, which performs the save and restore.
   */
  readonly snapshotDirectory: string | undefined
  /**
   * The real-model prose writer when `config.prose` names a route, else undefined.
   * Public for the same reason {@link ResearchEngine.toolDeps} is: the team service
   * reads it so one deployment-level choice governs every prose step.
   */
  readonly proseWriter: LlmProseWriter | undefined
  /**
   * The document compiler this deployment has, or undefined when it named none.
   *
   * Public for the same reason {@link ResearchEngine.proseWriter} is: the team service reads it and
   * hands it to the step that compiles, so one deployment-level choice governs every run.
   *
   * Not `readonly`: the probe that fills it is asynchronous, so the field starts undefined and the
   * deployment's own formats are known once the executables have answered.
   */
  documentCompiler: PandocCompiler | undefined
  /**
   * The drawing capability this deployment has, or undefined when it named none.
   *
   * Public for the same reason the compiler is: the team service reads it and hands it to the step
   * that draws the floats, so one deployment-level choice governs every figure of every run. Absent
   * means the built-in renderer draws them and each float records which one drew it.
   *
   * Not `readonly`: the probe is asynchronous, so the field starts undefined and the deployment's
   * library is known once the interpreter has answered.
   */
  figureProvider: MatplotlibProvider | undefined
  /**
   * Milliseconds one step may run, when the deployment names a budget, else undefined.
   * Public for the same reason {@link ResearchEngine.toolDeps} is: the runner-side service
   * reads it so one deployment decision governs every step of every run.
   */
  readonly stepTimeoutMs: number | undefined
  /**
   * How many revision rounds the deployment allows, when it names a bound, else undefined.
   * Public for the same reason {@link ResearchEngine.stepTimeoutMs} is: the runner-side service
   * reads it so one deployment decision governs how far a revision cycle may go.
   */
  readonly revisionRounds: number | undefined
  /**
   * What this deployment's evidence is allowed to be, resolved from {@link Config.evidenceProfile}.
   * Public for the same reason {@link ResearchEngine.toolDeps} is: the runner-side service reads it
   * so ONE deployment-level claim governs whether evidence may carry a gate and whether the run's
   * output may be submitted.
   */
  readonly evidenceProfile: EvidenceProfile
  /**
   * The sentence-level reviewer this deployment named, or undefined when it named none.
   *
   * Public for the same reason {@link ResearchEngine.proseWriter} is: the runner-side service reads it
   * and hands it to the steps that assess, so one deployment-level choice governs whether a sentence's
   * citation was read against that sentence. Undefined is a state the run records — sentences not
   * assessed — rather than a check that quietly does not happen.
   */
  readonly statementAssessor: LlmReviewer | undefined
  /**
   * The `.bib` renderer this deployment supplies.
   *
   * Public for the same reason {@link ResearchEngine.statementAssessor} is: the runner-side service
   * reads it and writes the package's bibliography with it. It is always present — a run whose
   * citations cannot be rendered has no file to hand a journal, which is a gap a reader should not
   * have to discover from an absent file.
   */
  readonly bibliographyWriter = new CitationJsBibliographyWriter()
  /**
   * Which registry this run draws its citable sources from.
   *
   * `zotero` when this deployment configured a library, `curated` otherwise. The runner-side service
   * reads it to decide whether a citation may name a source read during this run.
   */
  readonly sourceRegistryMode: SourceRegistryMode
  /**
   * The sources this deployment's library offered, once they have been read.
   *
   * EMPTY UNTIL {@link ResearchEngine.sourceRegistration} SETTLES, and empty forever when the library
   * could not be read — a run in `zotero` mode then has nothing to cite rather than the checked-in
   * corpus, which is the failure the configuration demands.
   */
  registeredSources: ReadonlyArray<SourceRegistration> = []
  /** One sentence per designated item that could not be registered. */
  registrationFailures: ReadonlyArray<string> = []
  /**
   * The registration read, so a caller can wait for the sources before starting a run.
   *
   * A RUN THAT BEGAN BEFORE THIS SETTLED would bind its sentences against an empty registry and
   * record them as uncited. Undefined when this deployment configured no library to read.
   */
  sourceRegistration: Promise<void> | undefined
  /**
   * The revision verifier this deployment named, or undefined when it named none.
   *
   * Public for the same reason {@link ResearchEngine.statementAssessor} is: the service reads it and
   * hands it to D4, which leaves every issue `pending-verification` when it is absent — a debt a
   * reader can see, rather than a concern that closed because a patch applied.
   */
  readonly resolutionVerifier: LlmReviewer | undefined
  /**
   * How much review this deployment requires, when it says, else undefined so the runner's default
   * applies. Public for the same reason {@link ResearchEngine.revisionRounds} is.
   */
  readonly reviewPolicy: { readonly minimumRounds: number } | undefined
  /**
   * The deployment's library, as a reader of the files a passage was read from.
   *
   * PUBLIC FOR THE SAME REASON {@link ResearchEngine.bibliographyWriter} IS: the runner-side service
   * stores the reference files a package carries, and it may not import this package — the two are
   * siblings. It is asked for a file by the ITEM IDENTITY AND ATTACHMENT KEY a reading record
   * carries, never by a path, and it resolves that identity to the library's own item key here so
   * the identity scheme stays in the package that mints it.
   *
   * UNDEFINED WHEN NO LIBRARY WAS CONFIGURED, and `policy` is `'none'` when the deployment did not
   * opt into reading attachment files — under which nothing is requested at all and the package
   * records that the deployment stores no reference files.
   */
  readonly referenceFiles: ReferenceFileReaderLike | undefined

  /**
   * The deterministic provider to register at load, when the deployment selected that
   * route. Registration is deferred to {@link ResearchEngine.[Service.init]} so it is an
   * effect owned by this fiber rather than a side effect of construction.
   */
  private readonly deterministicProse: DeterministicProseConfig | undefined

  /** The configured library, when this deployment named one; the registration read uses it. */
  private readonly zoteroProvider: ZoteroProvider | undefined
  /** The items this deployment designates as cited sources. Empty when it named no library. */
  private readonly citedItems: ReadonlyArray<CitedItem>
  /** The MCP namespace the library's tools are registered under, when a library was configured. */
  private readonly zoteroServerName: string | undefined
  /** How long the registration waits for those tools, from the deployment's own configuration. */
  private readonly sourceToolWaitMs: number
  /**
   * The library's own item key for each registered source identity.
   *
   * THE IDENTITY IS MINTED HERE AND RESOLVED HERE. A reading record names a source by the identity
   * this package minted for it (`zotero:<type>:<library>:<itemKey>`); reading that source's file
   * needs the bare item key the local API addresses. Decoding the identity string back into a key
   * would put one copy of the scheme in the minting function and another in a parser that has to keep
   * up with it, so the pair is recorded where both are known: the registration read.
   */
  private readonly referenceItemKeys = new Map<string, string>()

  /** Set at the commit point of the deterministic route's registration. */
  private proseReady = false

  /** True once the deterministic prose provider is registered on `ctx.llm`. */
  get proseRouteReady(): boolean {
    return this.proseReady
  }

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'research')
    this.requireResearchTools = config.requireResearchTools ?? false
    // THE ZOTERO CORPUS, WHEN THE DEPLOYMENT NAMES ONE. The provider is built here because it needs
    // two host services the pure assembler has no access to: `fetch` for the local JSON API and the
    // `tools` registry for the MCP metadata route. The registry is read LAZILY — the loader starts
    // entries concurrently, so `tools` may not exist yet when this constructor runs, and a port that
    // resolved it once would be permanently undefined.
    // THE LIBRARY IS KEPT, not only wrapped: the registration read below needs the provider itself
    // to read the metadata and the page of each designated item, which the adapter does not expose.
    const channel = config.literatureSearch
    // ONE LIBRARY, TWO WAYS TO NAME IT. A deployment that names `sourceLibrary` gets the provider and
    // the registrations from it whether or not the search channel is Zotero; one that only sets
    // `literatureSearch.kind: 'zotero'` keeps the fields it already states there.
    const library: SourceLibraryConfig | undefined = config.sourceLibrary
      ?? (channel?.kind === 'zotero' ? channel : undefined)
    const zotero = library === undefined
      ? undefined
      : new ZoteroProvider(
        {
          apiBase: library.apiBase,
          localLibraryPath: library.localLibraryPath,
          mcpServerName: library.mcpServerName,
          ...(library.timeoutMs === undefined ? {} : { timeoutMs: library.timeoutMs }),
          ...(library.pageSize === undefined ? {} : { pageSize: library.pageSize }),
          // PASSED THROUGH, NOT RESOLVED HERE. The policy is the provider's own setting and its
          // constructor is where it is validated, so a value naming no policy fails THIS load rather
          // than leaving a run under a policy the deployment did not choose.
          ...(library.attachments === undefined ? {} : { attachments: library.attachments }),
        },
        // THE INIT IS FORWARDED WHOLE. The attachment route is read with its redirect visible — on a
        // real library the redirect IS the answer — so a wrapper that kept only the signal would make
        // this HTTP layer follow a `file://` location and fail.
        (url, init) => fetch(url, init),
        // READ LAZILY: the loader starts entries concurrently, so `tools` may not exist yet when this
        // constructor runs, and a port that resolved it once would be permanently undefined.
        {
          get: (name: string) => (ctx.get('tools') as {
            get?: (toolName: string) => { execute(args: unknown, exec: { readonly signal: AbortSignal }): Promise<unknown> } | undefined
          } | undefined)?.get?.(name),
        },
      )
    this.sourceRegistryMode = library?.sourceRegistryMode ?? (library === undefined ? 'curated' : 'zotero')
    this.zoteroProvider = zotero
    this.referenceFiles = zotero === undefined
      ? undefined
      : {
        policy: resolveAttachmentPolicy(library?.attachments),
        read: async (request, signal) => {
          const itemKey = this.referenceItemKeys.get(request.sourceIdentity)
          if (itemKey === undefined) {
            return {
              ok: false,
              reason: `no item of the configured library was registered as '${request.sourceIdentity}',`
                + ` so the file '${request.attachmentKey}' was not read`,
            }
          }
          const read = await zotero.readAttachment(itemKey, request.attachmentKey, signal)
          if (!read.ok) return { ok: false, reason: `[${read.failure.code}] ${read.failure.detail}` }
          return {
            ok: true,
            attachmentKey: read.file.attachment.key,
            attachmentVersion: String(read.file.attachment.version),
            sha256: read.file.sha256,
            base64: Buffer.from(read.file.bytes).toString('base64'),
          }
        },
      }
    this.citedItems = library?.citedItems ?? []
    this.zoteroServerName = library?.mcpServerName
    this.sourceToolWaitMs = library?.sourceToolWaitMs ?? DEFAULT_SOURCE_TOOL_WAIT_MS
    this.toolDeps = buildToolDeps(
      channel,
      config.citationResolver,
      zotero === undefined || channel?.kind !== 'zotero'
        ? undefined
        : new ZoteroLiteratureAdapter(zotero, {
          collectionKey: channel.collectionKey,
          ...(library?.fallbackVenue === undefined ? {} : { fallbackVenue: library.fallbackVenue }),
        }),
    )
    this.sessionCwd = resolveWorkspace(config.workspace)
    this.casePackDirectory = resolveCasePackDirectory(config.casePackDirectory, this.sessionCwd)
    this.packageDirectory = resolveCasePackDirectory(config.packageDirectory, this.sessionCwd)
    this.snapshotDirectory = resolveCasePackDirectory(config.snapshotDirectory, this.sessionCwd)
    this.stepTimeoutMs = config.stepTimeoutMs
    this.revisionRounds = config.revisionRounds
    // Refused here, where the value enters, rather than at the step it would abort: a bound below
    // one is a misconfiguration that reads as "the revision cycle did not run".
    if (this.revisionRounds !== undefined && (!Number.isSafeInteger(this.revisionRounds) || this.revisionRounds < 1)) {
      throw new Error(
        `[research] \`revisionRounds\` must be a positive integer, got ${String(this.revisionRounds)}`,
      )
    }
    // Refused here, where the value enters, rather than at the first step it would abort: a
    // zero or negative budget is a misconfiguration that reads as "the run stopped for no reason".
    if (this.stepTimeoutMs !== undefined && (!Number.isFinite(this.stepTimeoutMs) || this.stepTimeoutMs <= 0)) {
      throw new Error(
        `[research] \`stepTimeoutMs\` must be a positive finite number of milliseconds, got ${String(this.stepTimeoutMs)}`,
      )
    }
    this.evidenceProfile = resolveEvidenceProfile(config.evidenceProfile)

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
      }, 'deterministic')
    } else if (prose !== undefined) {
      this.proseWriter = new LlmProseWriter(ctx, {
        provider: prose.provider,
        model: prose.model,
        ...prose.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: prose.idleTimeoutMs },
        cwd: this.sessionCwd,
      }, 'llm')
    } else {
      this.proseWriter = undefined
    }
    // THE READER-SIDE CHANNEL. Built here from the same `sessionCwd` the prose writer uses, so a
    // reviewer session runs where the deployment said rather than wherever the process happens to be.
    // The route is what the verification's independence is decided on, so a deployment that points
    // this at its prose route gets a refused verification rather than a nominal one — see
    // {@link Config.review}.
    const review = config.review
    const reviewerFor = (row: (Omit<LlmReviewerConfig, 'instructionsVersion'> & { readonly instructionsVersion?: string }) | undefined): LlmReviewer | undefined =>
      row === undefined
        ? undefined
        : new LlmReviewer(ctx, {
          // THE VERIFIER MUST STATE ITS RULES; the assessor's are already versioned by
          // `policyVersion`, and its verdicts are cached against that.
          instructionsVersion: row.instructionsVersion ?? DEFAULT_REVIEW_INSTRUCTIONS_VERSION,
          ...row,
          cwd: this.sessionCwd,
        })
    this.statementAssessor = reviewerFor(review?.assessor)
    this.resolutionVerifier = reviewerFor(review?.verifier)
    // REFUSED HERE, where the value enters, rather than where the review cycle would read it: a floor
    // below one is a misconfiguration that reads as "the manuscript needed no reading at all".
    const minimumRounds = review?.minimumRounds
    if (minimumRounds !== undefined && (!Number.isSafeInteger(minimumRounds) || minimumRounds < 1)) {
      throw new Error(
        `[research] \`review.minimumRounds\` must be a positive integer, got ${String(minimumRounds)}`,
      )
    }
    this.reviewPolicy = minimumRounds === undefined ? undefined : { minimumRounds }
    // THE PROBE DECIDES WHAT THIS DEPLOYMENT CAN PRODUCE. It runs once, here, so a machine without a
    // LaTeX engine is known before any run asks for a PDF — and the absence is a property of the
    // deployment rather than a compile that fails later.
    this.figureProvider = undefined
    if (config.figures !== undefined) {
      const figures = config.figures
      void MatplotlibProvider.probe({
        executable: figures.executable,
        ...(figures.timeoutMs === undefined ? {} : { timeoutMs: figures.timeoutMs }),
        ...(figures.width === undefined ? {} : { width: figures.width }),
        ...(figures.height === undefined ? {} : { height: figures.height }),
      }).then((provider) => { this.figureProvider = provider })
    }
    this.documentCompiler = undefined
    if (config.document !== undefined) {
      const document = config.document
      void PandocCompiler.probe({
        executable: document.executable,
        ...(document.latexEngine === undefined ? {} : { latexEngine: document.latexEngine }),
        ...(document.timeoutMs === undefined ? {} : { timeoutMs: document.timeoutMs }),
      }).then((compiler) => { this.documentCompiler = compiler })
    }
  }

  /** Load: register an unload effect clearing the in-memory run store (ephemeral — see C-6). */
  /**
   * Read the items this deployment designated as citable sources, once.
   *
   * A FAILURE IS RECORDED, NOT THROWN. A library that is not running is a fact about the machine the
   * run is on, and a load that threw for it would make the deployment unusable whenever Zotero is
   * closed; what must not happen is a run CITING the checked-in corpus instead, which is why the
   * registry mode and the source set travel separately and `zotero` mode yields only what is here.
   *
   * @returns nothing; the sources and the failures are published on this instance.
   */
  private async readConfiguredSources(): Promise<void> {
    if (this.zoteroProvider === undefined || this.citedItems.length === 0) return
    await this.awaitClientTools()
    const read = await readRegistrations(this.zoteroProvider, this.citedItems)
    this.registeredSources = read.registrations
    this.registrationFailures = read.failures
    // WHAT EACH IDENTITY WAS READ FROM, so a file can later be asked for by the identity a reading
    // record carries without anyone decoding it back into an item key.
    this.referenceItemKeys.clear()
    for (const [identity, itemKey] of read.itemKeys) this.referenceItemKeys.set(identity, itemKey)
  }

  /**
   * Wait until the MCP client has registered the tools the library route calls.
   *
   * THE TWO FACTS THIS KEEPS APART. "The client is still starting" and "this deployment mounts no such
   * server" both look like a missing tool, and the registration used to report the second for the
   * first: measured on a real 1120 boot (2026-09-18), the engine read the library the moment `tools`
   * existed, the Zotero server — which spawns a process and answers `tools/list` over stdio — had not
   * finished, and every designated item came back `metadata-tool-missing`. The deployment was
   * configured correctly and reported itself as misconfigured.
   *
   * `tools/change` IS THE SIGNAL: the runtime emits it when a tool is registered, so this waits for
   * the names it needs rather than for a number of milliseconds to pass. When the wait runs out the
   * tools really are absent and the refusal that follows is the true one.
   *
   * @returns once the tools are present, or once the wait has run out.
   */
  private async awaitClientTools(): Promise<void> {
    const server = this.zoteroServerName
    if (server === undefined) return
    const names = [
      `mcp__${server}__zotero_get_item_metadata`,
      `mcp__${server}__zotero_read_pdf_pages`,
    ]
    const present = (): boolean => {
      const tools = this.ctx.get('tools') as { get?: (name: string) => unknown } | undefined
      return tools?.get !== undefined && names.every(name => tools.get?.(name) !== undefined)
    }
    // POLLED RATHER THAN SUBSCRIBED. The runtime does emit `tools/change`, and subscribing would be
    // the better shape — but that event is declared on Cordis's `Events` by the tools package, and a
    // TYPE-ONLY import of it pulls that package's whole source tree into this program (measured: the
    // build fails with `not under rootDir`). Polling a service this package already reads needs no
    // cross-package declaration, and the deadline is what keeps a missing server from hanging boot.
    const deadline = Date.now() + this.sourceToolWaitMs
    while (!present() && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, MCP_TOOL_POLL_MS))
    }
  }

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
    const injectedTools = this.ctx.inject(['tools'], async (toolsCtx) => {
      // THE TOOL SURFACE FIRST, AND ITS PROMISE RETURNED: this callback's result is what `inject`
      // waits on, so a body that mounted the tools and returned nothing would leave the load
      // reporting success before the seven tools existed.
      await this.mountResearchTools(toolsCtx)
      // AND THE DESIGNATED SOURCES, read here because this callback runs once `tools` exists — the
      // registration needs the MCP client's metadata tool, which is registered onto that same
      // service, and reading it from the constructor would find no tool and report the whole library
      // as unreadable. The promise is published rather than awaited: a host that takes a while to
      // provide `tools` must not hold up the load, and a run waits on it explicitly.
      this.sourceRegistration ??= this.readConfiguredSources()
    })
    if (this.ctx.get('tools') !== undefined) await injectedTools
    if (this.deterministicProse !== undefined) {
      const injectedLlm = this.ctx.inject(['llm'], (llmCtx) => { this.registerDeterministicProse(llmCtx) })
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
   * A host that provides NO `llm` service leaves `proseRouteReady` false and is not an error
   * here, for the reason the tool registration beside it is not one: at load time "not up yet" and
   * "never" are indistinguishable, and this callback simply never runs. The deployment learns the
   * route is absent from `proseRouteReady`, and a prose write fails loudly rather than falling
   * back to fixture text. (This JSDoc previously claimed a `@throws` the code does not have.)
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

  /**
   * Create a run in this engine's store.
   *
   * @param runId - the identity to create; omitted, the core mints one.
   * @returns the run's id.
   * @throws Error with a `RUN_EXISTS` code when a run of that id is already stored — the core
   *   refuses to clobber an existing run's state and audit log.
   */
  createRun(runId?: string): string {
    return createRun(runs, runId)
  }

  /**
   * Seed one input of a run before the step that declares it starts.
   *
   * @param runId - the run to seed.
   * @param slug - the input's slug, which must be one the pipeline declares seedable.
   * @param value - the input value, which must not be null or undefined.
   */
  setRunInput(runId: string, slug: string, value: unknown): void {
    setRunInput(runs, runId, slug, value)
  }

  /**
   * Read one run's current state.
   *
   * @param runId - the run to read.
   * @returns a frozen snapshot of every step, the artifact registry, and the audit events.
   */
  getRunSnapshot(runId: string): RunSnapshot {
    return getRunSnapshot(runs, runId)
  }

  /**
   * Read one artifact a run produced.
   *
   * @param runId - the run that produced it.
   * @param slug - the artifact's slug.
   * @returns a clone of the artifact's value, or undefined when the run never recorded it or it was
   *   invalidated by a rollback.
   */
  getArtifact(runId: string, slug: string): unknown {
    return getArtifact(runs, runId, slug)
  }

  /**
   * Whether a step may start now: it is still pending and every input it declares is satisfied.
   *
   * @param runId - the run to read.
   * @param stepId - the step to check.
   * @returns true when the step can start; false for an unknown step id or an unsatisfied input.
   */
  canStart(runId: string, stepId: string): boolean {
    return canStart(runs, runId, stepId)
  }

  /**
   * Start one attempt on a step.
   *
   * @param runId - the run to advance.
   * @param stepId - the step to start.
   * @returns the step's state after the transition.
   * @throws Error when the step is unknown, already started, or missing an input.
   */
  startStep(runId: string, stepId: string): StepSnapshot {
    return startStep(runs, runId, stepId)
  }

  /**
   * Start a step only when {@link ResearchEngine.canStart} allows it.
   *
   * @param runId - the run to advance.
   * @param stepId - the step to start.
   * @returns the step's state after the transition, or null when the step cannot start.
   */
  startIfCan(runId: string, stepId: string): StepSnapshot | null {
    return startIfCan(runs, runId, stepId)
  }

  /**
   * Record one output a running step produced.
   *
   * @param runId - the run to record into.
   * @param stepId - the step producing the output; it must be in progress.
   * @param outputSlug - the output's slug, which the step must declare.
   * @param value - the artifact value, which the core clones before storing.
   */
  recordArtifact(runId: string, stepId: string, outputSlug: string, value: unknown): void {
    recordArtifact(runs, runId, stepId, outputSlug, value)
  }

  /**
   * Record one judgment component's verdict on a gated step, and advance the step accordingly.
   *
   * @param runId - the run to advance.
   * @param stepId - the gated step the verdict is about.
   * @param verdict - the component, its outcome, and the evidence it was reached on.
   * @returns the step's status after the verdict; the last component to report decides it.
   * @throws Error when the step declares an empty gate — such a step is finalized by
   *   {@link ResearchEngine.completeStep} instead.
   */
  submitGateVerdict(runId: string, stepId: string, verdict: GateVerdict): StepStatus {
    return submitGateVerdict(runs, runId, stepId, verdict)
  }

  /**
   * Finalize a step that declares no gate.
   *
   * @param runId - the run to advance.
   * @param stepId - the step to finalize.
   * @returns the step's status after the transition.
   * @throws Error when the step declares a gate, which means its verdicts must be submitted
   *   individually.
   */
  completeStep(runId: string, stepId: string): StepStatus {
    return completeStep(runs, runId, stepId)
  }

  /**
   * Roll one step back, invalidating the artifacts it produced and everything depending on them.
   *
   * @param runId - the run to roll back in.
   * @param stepId - the step to return to pending; a step already pending is left alone.
   */
  rollback(runId: string, stepId: string): void {
    rollback(runs, runId, stepId)
  }

  /**
   * Whether a step has passed and, for a human-gated step, been approved.
   *
   * @param runId - the run to read.
   * @param stepId - the step to check.
   * @returns true when the step is complete on both counts.
   */
  isComplete(runId: string, stepId: string): boolean {
    return isComplete(runs, runId, stepId)
  }

  /**
   * Read one step's audit trail: every transition recorded against it, oldest first.
   *
   * @param runId - the run to read.
   * @param stepId - the step whose history is wanted.
   * @returns the step's audit entries.
   */
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

  /**
   * T07 — L0 routing: delegate to the pure router.
   *
   * @param source - the declared source to classify.
   * @param adapter - the routing adapter; caller-supplied, because core ships `mockL0Adapter` as a
   *   fixture only.
   * @returns the tier the adapter routed the source to.
   */
  classifyL0(source: L0SourceInput, adapter: L0RoutingAdapter): L0Classification {
    return classifyL0(source, adapter)
  }

  /** T08 — citation identity verification: full thin pass-through of the core
   *  signature. Resolver contact rules (#6 short-circuit, fabrication
   *  discrimination) are enforced entirely inside core.
   * @param claimId - the claim the citation is attached to.
   * @param citationId - the citation's identity within that claim.
   * @param ref - the reference as the claim states it, which is what gets resolved.
   * @param evidence - the evidence the citation was recorded with.
   * @param resolverAdapter - the resolver this deployment configured; the fixture adapter answers
   *    without contacting a catalogue.
   * @param timestamp - the run's fixed timestamp, so a verdict is reproducible.
   * @param options - resolver options, e.g. whether a fabricated identifier short-circuits.
   * @returns the verification result, carrying the verdict and the record it was reached on.
   */
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
   *  gate outcome to StepState is deliberately deferred).
   * @param input - the declaration, the measurement, and the channel verdicts to adjudicate.
   * @returns the frozen adjudication: the outcome and the evidence it rests on.
   */
  evaluateGate(input: AdjudicationInput): AdjudicationResult {
    return adjudicate(input)
  }

  /** T09 — canonical-name alias of {@link evaluateGate}.
   * @param input - the declaration, the measurement, and the channel verdicts to adjudicate.
   * @returns the frozen adjudication, identical to {@link ResearchEngine.evaluateGate}'s.
   */
  adjudicate(input: AdjudicationInput): AdjudicationResult {
    return adjudicate(input)
  }

  /** Single interpretation point for a gate outcome: delegates verbatim to the
   *  frozen core helper gateToStateMachineIntent (GATE_OUTCOME_TO_INTENT in
   *  contracts.ts). This service NEVER reinterprets an outcome — abstained
   *  maps to 'hold_abstained', never to pass.
   * @param result - the adjudication whose outcome is being interpreted.
   * @returns the state-machine intent that outcome maps to.
   */
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
