// @deepseek-ai/dsh-research-team — cordis service wiring (package entry).
//
// ADAPTER LAYER (T20). The single wiring point for the research-team plugin.
// Everything above this file is deliberately host-free or thin:
//   - the pure layer (types / revision / projection fold / scope-guard decide)
//     never touches ctx;
//   - the thin adapters (journal / roster / task-board / research-guard /
//     session-events / research-projection) consume specific ctx services but
//     stay composable;
//   - THIS module owns the cordis Service, the `ctx.agentTeams` augmentation,
//     projection registration, the one global write-scope guard, and the
//     resume-recovery lifecycle hooks — so the package's host surface has a
//     single construction site (mirroring `@deepseek-ai/dsh-agent-team`).
//
// Wiring responsibilities (§3 of the frozen T20 design spec):
//   1. `super(ctx, 'agentTeams')` + `declare module '@deepseek-ai/cordis'`
//      expose the service to host plugins. This index entry is what the host
//      imports, so the module augmentations that live below it (the
//      `research/*` SessionEventMap injection in session-events.ts and the
//      `researchTeam` SessionProjectionStateMap entry in
//      research-projection.ts) are always part of a referencing program.
//   2. `researchTeamProjectionDefinition` registers the durable `researchTeam`
//      fold on the root session-projection registry for the plugin lifetime.
//   3. `installResearchGuard` registers ONE global `ctx.tools.guard` on the
//      plugin context (the root in the supported load) for the plugin
//      lifetime. The guard is deny-only and evaluates each tool call live
//      against the durable projection, so a cold-resumed member is guarded
//      before its first turn without any per-activation re-install (DEC-003).
//   4. `agent/session-start` schedules a contained recovery pass so a resumed
//      Lead reconciles provisioning-only roster rows from their independently
//      durable child Sessions.
//
// Service hooks that agent-team needs (session/event mailbox wakeups,
// agent/status activity notifications) have no counterpart here: this package
// deliberately owns no mailbox or activity subsystem (§6 "明确不做"). Journal
// commits are synchronous observers only, so no event/status observer is
// needed to keep the durable fold or the guard current.

import { mkdirSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import type {
  ResearchArtifactMetaView,
  ResearchGateVerdictView,
  ResearchProposalAnswer,
  ResearchProposalRequest,
  ResearchRunRequest,
  ResearchRunSnapshot,
  ResearchPackageExport,
  ResearchRunPersistence,
  ResearchStepCatalogEntry,
  ResearchStepStateView,
} from './types.ts'

export type {
  ResearchProposalAnswer,
  ResearchProposalEntry,
  ResearchProposalRefusal,
  ResearchProposalRequest,
  ResearchRunRequest,
  ResearchRunSnapshot,
  ResearchStepCatalogEntry,
} from './types.ts'
import {
  parseDirectionProposals,
  planFromProposal,
  proposalInstruction,
} from './runner/direction-proposals.ts'
import { MEASURED_METRIC } from './runner/platoon-sim.ts'
import { DEFAULT_PLAN, requirePlan } from './runner/study-plan.ts'
import type { StudyPlan } from './runner/study-plan.ts'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { ResearchJournal } from './journal.ts'
import { researchTeamProjectionDefinition } from './research-projection.ts'
import { installResearchGuard } from './research-guard.ts'
import { errorMessage, ResearchRoster } from './roster.ts'
import type { ResearchMembership, SpawnMemberRequest } from './roster.ts'
import { ResearchTaskBoard } from './task-board.ts'
import type { CreateResearchTaskRequest, UpdateResearchTaskRequest } from './task-board.ts'
import type { ResearchMemberView, ResearchTask, TeamMutationResult } from './types.ts'
import type { TeamTaskId } from './types.ts'
import type { SessionId } from './types.ts'
import { ResearchFleetOrchestrator } from './redteam/orchestrator.ts'
import type { RebuttalStartInput, RebuttalSubmitInput } from './redteam/orchestrator.ts'
import type { ResearchToolDeps } from '@deepseek-ai/dsh-research-tools'
import { createRunPersistence, getArtifact, getRunSnapshot, getStepDefinitions, rollback } from '@deepseek-ai/dsh-research-core'
import type { RunPersistence } from '@deepseek-ai/dsh-research-core'
import type { ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { CASE_PACK_INPUT_SLUGS, loadCasePack, planCasePackInputs } from './runner/case-pack.ts'
import { planRunPackage, writeRunPackage } from './runner/package-export.ts'
import type { CasePackRunInput } from './runner/case-pack.ts'
import { createRunContext, driveRemaining, runT19B } from './runner/drive.ts'
import { experimentStudy, studyFromPack } from './runner/platoon-sim.ts'
import { firstNonTerminalStep, materialWithCommitment, needsReleaseBeforeResume } from './runner/resume.ts'
import type { ResearchProseWriter } from './runner/registry.ts'
import type { RunResult } from './runner/types.ts'
import {
  forgetRuns,
  installApprovalEndpoint,
  rememberRun,
  type ApprovalConnectionHost,
} from './approval.ts'

// ───────────────────────────── Public re-exports ───────────────────────────
// The package entry re-exports its caller-visible brands, errors, entities,
// schemas, and request/result shapes so consumers import one specifier.

export {
  CASE_PACK_FILES,
  CASE_PACK_INPUT_SLUGS,
  CASE_PACK_SCHEMA_VERSION,
  CasePackError,
  casePackDatum,
  loadCasePack,
  planCasePackInputs,
} from './runner/case-pack.ts'
export type {
  CasePack,
  CasePackEnvelope,
  CasePackErrorCode,
  CasePackFile,
  CasePackFileName,
  CasePackRunInput,
} from './runner/case-pack.ts'
export type * from './types.ts'
export {
  DSH_RESEARCH_TEAM_ERROR_PREFIX,
  ResearchTeamError,
  TeamId,
  freezeValue,
  researchTeamError,
  sessionId,
  taskId,
} from './types.ts'
export { errorMessage, ResearchRoster } from './roster.ts'
export type { ResearchMembership, SpawnMemberRequest } from './roster.ts'
// NOTE: the human-approval surface (`./approval.ts`) is deliberately NOT re-exported from this
// entry. Its one caller is the Connection channel it registers, and keeping it off the package
// export map means the only way to decide a human gate is the authenticated route — no service
// method and no importable function can be reached from an ordinary tool call.
export { ResearchTaskBoard } from './task-board.ts'
export type { CreateResearchTaskRequest, UpdateResearchTaskRequest } from './task-board.ts'
export { researchTeamProjectionDefinition } from './research-projection.ts'
export { ResearchJournal } from './journal.ts'
// T21 red-team fleet surface: pure persona / config / rebuttal modules plus the
// orchestrator adapter. Pure modules carry zero host imports; the orchestrator
// composes the roster/journal/task-board into the Lead-driven rebuttal flow.
export { ResearchFleetOrchestrator } from './redteam/orchestrator.ts'
export type {
  RebuttalStartInput,
  RebuttalStartResult,
  RebuttalSubmitInput,
} from './redteam/orchestrator.ts'
export {
  defaultFleetPersonas,
  normalizeReadOnlyTools,
  personaByRole,
  personaCharter,
  RED_TEAM_MODEL_TIERS,
  RED_TEAM_STANCES,
  requirePersonaName,
  validatePersona,
  validatePersonas,
  validateReadOnlyTools,
} from './redteam/personas.ts'
export type {
  RedTeamModelTier,
  RedTeamPersona,
  RedTeamStance,
} from './redteam/personas.ts'
export {
  resolveFleet,
  resolveFleetRoles,
  routedModel,
  validateModelRoute,
} from './redteam/fleet-config.ts'
export type {
  RedTeamFleetConfig,
  RedTeamFleetMember,
  ResolvedRedTeamFleet,
} from './redteam/fleet-config.ts'
export {
  adjudicationVotes,
  allRolesVoted,
  castRebuttalVote,
  closeRebuttalRound,
  createRebuttalRound,
  parseRebuttalPosition,
  parseRebuttalVote,
  REBUTTAL_POSITION_VALUES,
  REBUTTAL_ROUND_STATUSES,
} from './redteam/rebuttal.ts'
export type {
  ParsedRebuttalVote,
  RebuttalPositionValue,
  RebuttalRound,
  RebuttalRoundStatus,
  RebuttalVoteInput,
} from './redteam/rebuttal.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Research-team coordination service (roster + task board + scope guard). */
    agentTeams: ResearchTeamService
  }
}

/**
 * Project one finished run into the shape the Remote boundary and the browser view consume.
 *
 * The run's own snapshot is the source: it is the only place the recorded gate verdicts
 * (with the evidence a reader checks) and the artifact metadata live. Rebuilding either
 * from {@link RunResult} would mean inventing the evidence strings.
 *
 * @param run - the driver's result.
 * @param store - the store the run populated.
 * @returns the run, the step catalogue, and the recorded verdicts, artifacts and states.
 */
function snapshotOf(
  run: RunResult,
  store: ResearchRunStore,
  packageExport: ResearchPackageExport | null = null,
  runPersistence: ResearchRunPersistence | null = null,
): ResearchRunSnapshot {
  const snapshot = getRunSnapshot(store, run.runId)
  const catalog: ReadonlyArray<ResearchStepCatalogEntry> = getStepDefinitions().map(step => ({
    id: step.id,
    index: step.index,
    phase: step.phase,
    name: step.name,
    humanGate: step.humanGate,
    gate: [...step.gate],
  }))

  const gates: ResearchGateVerdictView[] = []
  const steps: ResearchStepStateView[] = []
  for (const step of getStepDefinitions()) {
    const state = snapshot.steps[step.id]
    if (state === undefined) continue
    steps.push({
      stepId: state.stepId,
      status: state.status,
      attempt: state.attemptId,
      holdReason: state.holdReason ?? null,
    })
    for (const component of ['A', 'B', 'C'] as const) {
      const verdict = state.gateResults[component]
      if (verdict === undefined) continue
      gates.push({
        stepId: step.id,
        component: verdict.component,
        outcome: verdict.outcome,
        passed: verdict.passed,
        evidence: verdict.evidence,
        rationale: verdict.rationale,
        timestamp: verdict.timestamp,
      })
    }
  }

  const artifacts: ResearchArtifactMetaView[] = Object.values(snapshot.registry).map(meta => ({
    slug: meta.slug,
    producerStepId: meta.producerStepId,
    producerAttemptId: meta.producerAttemptId,
    producedAt: meta.producedAt,
    invalidated: meta.invalidated,
  }))

  return { run, catalog, gates, artifacts, steps, packageExport, runPersistence }
}

/** Options for one {@link ResearchTeamService.runPipeline} invocation. */
export interface ResearchPipelineOptions {
  /** Seed for the run's single seedable input (`domain-direction`). */
  readonly domainDirection?: string
  /**
   * The research this run carries. Absent means the deployment's default, with
   * {@link ResearchPipelineOptions.domainDirection} replacing that default's direction.
   *
   * IN-PROCESS CALLERS PASS THIS DIRECTLY and are trusted, the way every typed same-process
   * boundary is. A value off the wire is validated first — see
   * {@link ResearchTeamService.run}.
   */
  readonly studyPlan?: StudyPlan
  readonly signal?: AbortSignal
}


/** Deployment configuration for the research-team service. */
export interface ResearchTeamServiceConfig {
  /**
   * Write-tool allowlist whose writes are expressible as one path argument and
   * are therefore scope-checked by the global guard. Every other tool call by
   * a non-Lead member is denied. Defaults to the empty set (deny-all), which
   * is the conservative posture until the deployment configures research
   * write tools.
   */
  readonly scopeCheckedTools?: ReadonlyArray<string>
}

/** Research-team service: members, CAS tasks, and the write-scope guard. */
export class ResearchTeamService extends TypertRemoteService {
  static inject = ['agents', 'sessions', 'sessionPersistence', 'sessionProjections', 'subagents', 'tools']

  /** The tools the global guard treats as one-path scope-checkable writes. */
  private readonly scopeCheckedTools: ReadonlySet<string>
  /** Shared cancellation for recovery passes that outlive the service. */
  private readonly disposal = new AbortController()
  private readonly journal: ResearchJournal
  private readonly roster: ResearchRoster
  private readonly tasks: ResearchTaskBoard
  /** T21 red-team fleet orchestrator composing the roster/journal/task board. */
  readonly fleet: ResearchFleetOrchestrator

  constructor(ctx: Context, config: ResearchTeamServiceConfig = {}) {
    // The service key stays `agentTeams` (that is what host plugins inject); the WIRE
    // namespace is `research`, so a browser client calls `ctx.remote.research.*` rather
    // than reaching for a name that collides with the experimental agent-team package.
    super(ctx, 'agentTeams', { namespace: 'research' })
    this.scopeCheckedTools = new Set(config.scopeCheckedTools ?? [])
    // Journal commits have no cross-member waiters in this package (no mailbox
    // or activity subsystem), so the synchronous notification is intentionally
    // empty today; the journal contract keeps the seam for future observers.
    this.journal = new ResearchJournal(ctx, () => {})
    this.roster = new ResearchRoster(ctx, this.journal)
    this.tasks = new ResearchTaskBoard(this.journal)
    this.fleet = new ResearchFleetOrchestrator(ctx, this.journal, this.roster, this.tasks)

    // A resumed Lead (or member) must reconcile provisioning-only roster rows
    // before its next turn depends on them. Recovery is contained and logged,
    // never fatal to the resume path.
    ctx.on('agent/session-start', ({ agent }) => { this.scheduleRecovery(agent) })
    // Human approval needs the host's browser authentication, which only the Connection
    // service provides. It is an OPTIONAL service read with `ctx.get` (never a declared
    // injection): a deployment without a browser surface keeps every other research
    // capability and simply serves no approval endpoint, which is the honest posture —
    // an approval nobody authenticated would be worth less than none.
    ctx.inject(['connection'], (connectionCtx) => {
      const connection = connectionCtx.get('connection') as ApprovalConnectionHost | undefined
      if (connection === undefined) return
      installApprovalEndpoint(connection)
    })
    ctx.effect(() => {
      const disposers: Array<() => void> = [
        ctx.root.sessionProjections.register(researchTeamProjectionDefinition),
        installResearchGuard(ctx, this.roster, this.scopeCheckedTools),
      ]
      return () => {
        for (const dispose of disposers.reverse()) dispose()
        this.disposal.abort()
        this.roster.close()
        // The remembered runs are run state; a reloaded plugin must not keep approving
        // runs it no longer drives.
        forgetRuns()
      }
    }, 'researchTeam.runtime()')
  }

  /**
   * Resolve one exact live Agent's research-team role, throwing when it has
   * none. The Agent handle is the authority credential.
   * @param agent - exact live Agent used as the authority credential.
   * @returns its Lead, durable identity, role, and model-facing name.
   */
  membership(agent: Agent): ResearchMembership {
    return this.roster.membership(agent)
  }

  /** Resolve a caller without throwing (observers and legacy membership
   *  paths; the write-scope guard consumes the roster's three-way
   *  classification directly so unprovable lineages fail closed, P2-2).
   * @param agent - candidate exact live Agent.
   * @returns the membership, or undefined for a non-member and for a lineage
   *  this package cannot prove.
   */
  tryMembership(agent: Agent): ResearchMembership | undefined {
    return this.roster.tryMembership(agent)
  }

  /**
   * Create one named, continuable direct child of the research Lead.
   * @param caller - exact live Lead Agent (only the Lead may spawn).
   * @param request - immutable name/description/provider/context/prompt.
   * @returns the live roster view of the active member.
   */
  async spawnMember(caller: Agent, request: SpawnMemberRequest): Promise<ResearchMemberView> {
    return await this.roster.spawnMember(caller, request)
  }

  /**
   * Create one unowned pending task in the research Lead log.
   * @param caller - exact live research-team member.
   * @param request - task text, blockers, and advisory write scopes.
   * @returns the committed revision-one task snapshot.
   */
  async createTask(caller: Agent, request: CreateResearchTaskRequest): Promise<ResearchTask> {
    return await this.tasks.create(this.roster.membership(caller), request)
  }

  /**
   * Return one task snapshot, including a deleted tombstone.
   * @param caller - exact live research-team member.
   * @param id - team-local task identity; an id this team never created is refused.
   * @returns the task's whole-value snapshot at its current revision.
   */
  getTask(caller: Agent, id: TeamTaskId): ResearchTask {
    return this.tasks.get(this.roster.membership(caller), id)
  }

  /** List current non-deleted task snapshots.
   * @param caller - exact live research-team member.
   * @returns every live task snapshot; order is the board's, not an ordering contract.
   */
  listTasks(caller: Agent): ResearchTask[] {
    return this.tasks.list(this.roster.membership(caller))
  }

  /**
   * Compare-and-set one authorized task transition. Research-domain denials
   * (stale revision, unauthorized action, illegal claim…) return a typed
   * `{ ok: false, error }` envelope; unexpected failures still throw.
   * @param caller - exact live research-team member authorizing the mutation.
   * @param request - CAS intent (task id, expected revision, action).
   * @returns the committed snapshot on success, or the rejection envelope naming why the transition was refused.
   */
  async updateTask(caller: Agent, request: UpdateResearchTaskRequest): Promise<TeamMutationResult> {
    return await this.tasks.update(this.roster.membership(caller), request)
  }

  /** Read the member identity that backs one exact live Agent, if any.
   * @param memberId - durable member Session identity.
   * @returns the member's live Lead Agent, or undefined when not resolvable. */
  rootOfMember(memberId: SessionId): Agent | undefined {
    return this.roster.rootOfMember(memberId)
  }

  /** Deploy the red-team fleet personas as continuable members (T21).
   * @param caller - exact live research Lead Agent.
   * @param config - fleet config (defaults to the frozen five personas).
   * @param provider - continuation provider name ('spawn' default).
   * @returns the live member views, in deployment order.
   */
  async deployFleet(
    caller: Agent,
    config: Parameters<ResearchFleetOrchestrator['deploy']>[1] = {},
    provider: Parameters<ResearchFleetOrchestrator['deploy']>[2] = 'spawn',
  ): Promise<ReadonlyArray<ResearchMemberView>> {
    return await this.fleet.deploy(caller, config, provider)
  }

  /** Open one red-team rebuttal round over a (claim × judgment point) (T21).
   * @param caller - exact live research Lead Agent.
   * @param input - claim reference, judgment point, and optional role subset.
   * @returns the pending round plus its board tasks and delivered message ids.
   */
  startRebuttal(
    caller: Agent,
    input: RebuttalStartInput,
  ): ReturnType<ResearchFleetOrchestrator['startRebuttal']> {
    return this.fleet.startRebuttal(caller, input)
  }

  /** Commit one fleet vote returned to the research Lead (T21).
   * @param caller - exact live research Lead Agent.
   * @param input - the round, the voting member, and the returned payload.
   * @returns the updated round (submitted, or completed when the last role voted).
   */
  submitRebuttal(
    caller: Agent,
    input: RebuttalSubmitInput,
  ): ReturnType<ResearchFleetOrchestrator['submitRebuttal']> {
    return this.fleet.submitRebuttal(caller, input)
  }

  /** The gate-facing adjudication-vote projection of one round (T21).
   * @param roundId - identity of a round this service opened; an unknown id is refused.
   * @returns the round's accepted votes in cast order, with round bookkeeping dropped.
   */
  roundVotes(roundId: string): ReturnType<ResearchFleetOrchestrator['roundVotes']> {
    return this.fleet.roundVotes(roundId)
  }

  /**
   * Drive the full 16-step pipeline once and return its auditable result.
   *
   * This is the runner's production entry. Without it the driver had no caller
   * outside the tests, which is why the assembled tool dependencies could reach
   * the cordis tool surface but never a pipeline run.
   *
   * The run is REMEMBERED for the life of this plugin: `E2-submit` stops at `gated`, and the
   * only later way to move it on is an approval that must address the very store that drove it.
   * A store dropped here would leave the gate permanently undecidable.
   *
   * @param options - the run seed and a cancellation signal.
   * @returns the per-step outcomes plus the run id.
   */
  async runPipeline(options: ResearchPipelineOptions = {}): Promise<ResearchRunSnapshot> {
    const store: ResearchRunStore = new Map()
    const toolDeps = this.hostToolDeps()
    const proseWriter = this.hostProseWriter()
    const casePackInputs = this.hostCasePackInputs()
    const stepTimeoutMs = this.hostStepTimeoutMs()
    const run = await runT19B(store, {
      ...(options.domainDirection !== undefined ? { domainDirection: options.domainDirection } : {}),
      ...(options.studyPlan !== undefined ? { studyPlan: options.studyPlan } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(toolDeps !== undefined ? { toolDeps } : {}),
      ...(proseWriter !== undefined ? { proseWriter } : {}),
      ...(casePackInputs !== undefined ? { casePackInputs } : {}),
      ...(stepTimeoutMs !== undefined ? { timeoutMs: stepTimeoutMs } : {}),
    })
    // READ the stored run, then let `save` REPLACE it under its own version guard. An earlier
    // version deleted the file first and saved with `baseRevision: 0`; that made the guard pass on
    // every run (it compares against an absent file), left a window in which the predecessor was
    // gone and nothing had replaced it, and lost the stored run even when the new save then failed.
    // `save` already writes a temp file and renames over the target, so nothing needs deleting.
    // Read-then-save SERIALIZED. `save` compares the persisted revision and then writes, and two
    // runs started at once both read the same predecessor before either writes, so both pass a
    // guard that was meant to refuse one of them — which surfaced as a filesystem rename error
    // rather than the conflict it is. Chaining the two steps removes the window inside this
    // process; a cross-process race is still the store's to refuse, and now has a correct
    // revision to compare against.
    // ONE call writes both, so they cannot disagree and neither result is discarded. This used to
    // export here AND inside `recordRun`, and the second call's result (which carries an `error`
    // field when the write fails) was dropped — a package write failure left no trace.
    const { persistence, packageExport } = await this.recordRun(run, store)
    rememberRun(
      run.runId,
      store,
      () => snapshotOf(run, store, packageExport, persistence),
      // The approval persists through the SAME writer the run did, so a decision is as durable as
      // the run that produced it — and only the persistence half is wanted here. Handing the
      // decision to memory alone left the snapshot saying E2 `gated` after a person had approved
      // it, so a restart asked them to approve what they already had.
      () => this.recordRun(run, store).then(recorded => recorded.persistence),
    )
    return snapshotOf(run, store, packageExport, persistence)
  }

  /**
   * Write this run's current state to its durable snapshot, and re-export its package.
   *
   * Both halves run together because a state that reached the snapshot but not the package (or
   * the reverse) publishes two records of the same run that disagree. The read-then-save pair is
   * serialized so two writers cannot both pass the revision guard.
   *
   * @param run - the driven run.
   * @param store - the store the run populated, still live.
   * @returns the persisted revision, or the failure, or null when no directory is configured.
   */
  private async recordRun(
    run: RunResult,
    store: ResearchRunStore,
  ): Promise<{ persistence: ResearchRunPersistence | null; packageExport: ResearchPackageExport | null }> {
    const persistence = await this.serialized(async () => {
      // The predecessor read here is THIS run's earlier revision, if any — never another run's.
      const stored = await this.readStoredRun(run.runId)
      return this.persistRun(store, run, stored?.revision ?? 0)
    })
    return { persistence, packageExport: this.exportRunPackage(store, run) }
  }

  /**
   * The run persistence this deployment configured, or undefined when it configured none.
   *
   * The snapshot DIRECTORY is created here, where this option is resolved, and not by the store.
   * `mkdirSync` runs on every resolution, so the directory genuinely exists before any save: the
   * store's own contract is that it never creates it, and a deployment that pointed this at an
   * unwritable path learns so at the first save rather than at boot.
   *
   * @returns the bound persistence, or undefined when no directory is configured.
   */
  /**
   * The directory one run's snapshot lives in.
   *
   * @param runId - the run.
   * @returns the absolute directory, or undefined when the deployment configured none.
   */
  private snapshotDirectoryOf(runId: string): string | undefined {
    const research = this.ctx.get('research') as { snapshotDirectory?: string } | undefined
    return research?.snapshotDirectory === undefined
      ? undefined
      : join(research.snapshotDirectory, runId)
  }

  private hostRunPersistence(runId: string): RunPersistence | undefined {
    const directory = this.snapshotDirectoryOf(runId)
    if (directory === undefined) return undefined
    // ONE DIRECTORY PER RUN. A single shared file meant starting a run replaced whichever run was
    // stored — including one parked at E2 waiting for a person, which is the state the whole
    // approval flow exists to reach. Naming the replaced run made that visible; it did not make it
    // survivable, and "named" is not "preserved". With a directory each, a new run cannot touch
    // another run's snapshot at all.
    mkdirSync(directory, { recursive: true })
    return createRunPersistence({ dir: directory })
  }

  /**
   * The run ids that have a stored snapshot, newest first.
   *
   * @returns the run directories under the configured root, or an empty list when none is
   * configured or the root does not exist yet.
   */
  private storedRunIds(): ReadonlyArray<string> {
    const research = this.ctx.get('research') as { snapshotDirectory?: string } | undefined
    const root = research?.snapshotDirectory
    if (root === undefined) return []
    try {
      return readdirSync(root, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
    } catch (error) {
      // ABSENT means nothing is stored; UNREADABLE means the deployment cannot be told. Returning
      // an empty list for both reported a neutral "no run has a stored snapshot" about a root that
      // may hold several — the same error-degraded-to-a-neutral-statement pattern `tryLoad`
      // documents and refuses (it catches only SnapshotNotFoundError for this reason).
      if ((error as { code?: unknown }).code === 'ENOENT') return []
      throw new Error(
        '[research] the snapshot root cannot be read, so the stored runs cannot be listed: '
        + errorMessage(error),
      )
    }
  }

  /**
   * Read and discard whatever run the snapshot directory holds, reporting what it was.
   *
   * ONE run per directory is this deployment's choice, and it means a new run supersedes the
   * stored one. That supersession is a destructive act on data a person may be waiting on, so it
   * is performed here as a named step that RETURNS what it removed rather than as an inline
   * `discard()` whose effect nothing can observe.
   *
   * @returns the run that was discarded, or null when the directory held nothing.
   */
  /**
   * Serialize the read-then-save pair against other calls in this process.
   *
   * @param work - the section to run with no other persist section in flight.
   * @returns whatever the section returned.
   */
  private async serialized<T>(work: () => Promise<T>): Promise<T> {
    const run = this.persistChain.then(work, work)
    // The chain must not reject: a failure is reported through `lastPersistence`, and a rejected
    // link would make every later save reject without running.
    this.persistChain = run.then(() => undefined, () => undefined)
    return run
  }

  private async readStoredRun(runId: string): Promise<{ readonly runId: string; readonly revision: number } | null> {
    const persistence = this.hostRunPersistence(runId)
    if (persistence === undefined) return null
    try {
      const payload = await persistence.read()
      return { runId: payload.run.runId, revision: payload.revision }
    } catch {
      // Nothing readable is stored. `tryLoad` documents the same distinction: a corrupt or
      // version-incompatible snapshot is not "nothing to resume", so it is reported rather than
      // silently overwritten — `save` will refuse it and the failure surfaces there.
      return null
    }
  }

  /**
   * Persist the finished run when the deployment configured a directory.
   *
   * The snapshot is written AFTER the run, from the same store the run used, and the failure is
   * reported rather than swallowed: a caller told a run was persisted who finds no snapshot has
   * been misled. `baseRevision` is 0 because this store has never been persisted — a directory
   * that already holds a newer snapshot refuses the write instead of overwriting it.
   *
   * @param store - the run store, still live at this point.
   * @param run - the driven run.
   * @returns the persisted revision, or the failure, or null when no directory is configured.
   */
  private async persistRun(
    store: ResearchRunStore,
    run: RunResult,
    baseRevision: number,
  ): Promise<ResearchRunPersistence | null> {
    const persistence = this.hostRunPersistence(run.runId)
    if (persistence === undefined) return null
    try {
      const payload = await persistence.save(store, run.runId, { baseRevision })
      const directory = this.snapshotDirectoryOf(run.runId)
      return {
        runId: run.runId,
        revision: payload.revision,
        interrupted: [],
        ...(directory === undefined ? {} : { directory }),
      }
    } catch (error) {
      return { runId: run.runId, revision: null, interrupted: [], error: errorMessage(error) }
    }
  }

  /** Serializes the read-then-save pair; see {@link ResearchTeamService.serialized}. */
  private persistChain: Promise<void> = Promise.resolve()

  /**
   * Restore the persisted run and drive it to completion.
   *
   * The restored run executes ONLY through the capability this method supplies — the same
   * `toolDeps` and `proseWriter` a fresh run uses — because a snapshot is data and never a
   * service object. The cross-step context is rebuilt from the restored artifacts, since the
   * claim and the prediction it commits to are what the C gates read.
   *
   * @param options - a cancellation signal.
   * @returns the resumed run's snapshot.
   * @throws {Error} when no snapshot directory is configured, or nothing is persisted.
   */
  async resumeRunPipeline(options: {
    readonly runId?: string
    readonly signal?: AbortSignal
  } = {}): Promise<ResearchRunSnapshot> {
    // WHICH run. Each run has its own directory, so a resume must name one — or be unambiguous.
    const stored = this.storedRunIds()
    const runId = options.runId ?? (stored.length === 1 ? stored[0] : undefined)
    if (runId === undefined) {
      throw new Error(
        stored.length === 0
          ? '[research] no run has a stored snapshot, so there is nothing to resume'
          : `[research] ${String(stored.length)} runs have stored snapshots (${stored.join(', ')}); `
            + 'name the one to resume',
      )
    }
    const persistence = this.hostRunPersistence(runId)
    if (persistence === undefined) {
      throw new Error('[research] no snapshot directory is configured, so there is no run to resume')
    }
    const capability = { toolDeps: this.hostToolDeps(), proseWriter: this.hostProseWriter() }
    const restored = await persistence.tryLoad(capability)
    if (restored === null) {
      throw new Error('[research] no persisted run to resume in the configured snapshot directory')
    }
    const runCtx = createRunContext()
    const prediction = getArtifact(restored.store, restored.runId, 'falsifiable-prediction') as
      | { text?: unknown; ref?: unknown; metricKey?: unknown; measuredMetricKey?: unknown; claimRoute?: unknown }
      | undefined
    const claim = getArtifact(restored.store, restored.runId, 'claim') as
      | { claimId?: unknown; assertion?: unknown; falsifiability?: unknown; commitment?: unknown }
      | undefined
    if (typeof prediction?.text === 'string') runCtx.predictionText = prediction.text
    if (typeof prediction?.ref === 'string') runCtx.claimRef = prediction.ref
    if (typeof claim?.claimId === 'string') runCtx.claimId = claim.claimId
    // The metric key AND the claim's own words, or a resumed C-gated step would abstain for a
    // reason that has nothing to do with the claim: the key would be empty and the text unnamed.
    const restoredKey = prediction?.metricKey
    if (typeof restoredKey === 'string') runCtx.metricKey = restoredKey
    const restoredMetricKey = prediction?.measuredMetricKey
    if (typeof restoredMetricKey === 'string' && runCtx.metricKey === '') runCtx.metricKey = restoredMetricKey

    // The claim MATERIAL the A channel reviews, rebuilt from the artifacts the run already
    // recorded. It was never restored, so an A-gated step re-driven after A2 would review an
    // EMPTY material and hold the run for "the claim names no falsifying experiment" — a reason
    // about the claim that the claim itself contradicts. An audit registered this as a suspect
    // path; it is closed here rather than left to be discovered by a user whose resumed run
    // stalls for a reason that is not true.
    // Rebuilt by `materialFromRun`, beside the selector it has to agree with, so a spec can drive
    // it against the material a real run records. See that function for the two field-path defects
    // this replaced and why they were invisible by inspection.
    const restoredMaterial = materialWithCommitment(
      getRunSnapshot(restored.store, restored.runId).inputs,
      claim,
      prediction,
      runCtx.metricKey,
    )
    runCtx.claimMaterial = restoredMaterial.material
    if (restoredMaterial.commitment !== undefined) runCtx.commitment = restoredMaterial.commitment
    // The STUDY the experiment runs, rebuilt FROM THE RUN'S OWN PERSISTED INPUT.
    //
    // Not from the deployment's current `casePackDirectory`, which is what this did first and what
    // makes a resumed run measure a different study from the one its artifacts describe: this batch
    // itself moved that directory from `case-pack-traffic` to `case-pack-traffic-v2`, and a run
    // persisted against one would be re-measured against the other. It also made a resume FAIL
    // outright when the directory had become unreadable. The scenario block is in the snapshot, so
    // it is read from there; the deployment's directory is only the fallback for a run that
    // persisted none.
    const persistedScenario = getRunSnapshot(restored.store, restored.runId).inputs[CASE_PACK_INPUT_SLUGS.scenario]
    runCtx.study = studyFromPack(persistedScenario) ?? studyFromPack(this.hostCasePackScenario()) ?? experimentStudy()
    // The plan's CLAIM half, rebuilt from the same artifacts. Without this a resumed run would
    // write prose about the default plan's claim while its own gates had already graded the one
    // its artifacts record — the manuscript contradicting its own verdicts.
    //
    // WHAT IS NOT REBUILT, stated rather than implied: the title, the field, the retrieval
    // direction and the section skeleton. No artifact carries them, so a resumed run takes them
    // from the plan THIS deployment supplies. For the default plan that is exact; a deployment
    // that states its own plan and resumes a run started under another would use its own for
    // those four. Persisting the plan belongs with the change that lets a person supply one.
    runCtx.studyPlan = {
      ...runCtx.studyPlan,
      claim: {
        ...runCtx.studyPlan.claim,
        ...(runCtx.claimId === '' ? {} : { id: runCtx.claimId }),
        ...(runCtx.claimRef === '' ? {} : { ref: runCtx.claimRef }),
        ...(runCtx.predictionText === '' ? {} : { prediction: runCtx.predictionText }),
      },
      ...(runCtx.metricKey === ''
        ? {}
        : { metric: { ...runCtx.studyPlan.metric, key: runCtx.metricKey } }),
      ...(runCtx.commitment === undefined ? {} : { commitment: runCtx.commitment }),
    }

    // The first step that is not terminal is where the resumed run picks up: everything before
    // it is in a terminal state, so re-driving it would either be refused by the engine or, worse,
    // repeat work the snapshot already records as done.
    const from = firstNonTerminalStep(restored)
    const resumeState = getRunSnapshot(restored.store, restored.runId).steps[from]
    if (
      resumeState !== undefined
      // Every non-humanGate step the selector returns is released the same way. Keying this on
      // `holdReason` instead made the two conditions coincide only for the states core happens to
      // produce: a persisted `gated` step without that field was selected as the resume point and
      // then NOT rolled back, so `canStart` refused it and the run reported a dependency error —
      // this thread's recurring symptom. The selector already excludes the human gate, so this
      // needs no second opinion about why the step is gated.
      //
      // The decision itself lives in `resume.ts`, beside the selector it has to agree with, so a
      // spec can check the two together. It used to be a list written out here: see
      // `needsReleaseBeforeResume` for what its omission of `in_progress` cost.
      && needsReleaseBeforeResume(resumeState.status)
    ) {
      // The step stopped without completing, so it goes back to `pending` before it is driven
      // again; `startStep` refuses anything else, and the rollback also invalidates whatever the
      // stopped attempt left registered.
      rollback(restored.store, restored.runId, from)
    }
    const run = await driveRemaining(restored.store, restored.runId, runCtx, from, {
      ...(capability.toolDeps !== undefined ? { toolDeps: capability.toolDeps } : {}),
      ...(capability.proseWriter !== undefined ? { proseWriter: capability.proseWriter } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
    })
    const { persistence: persisted } = await this.recordRun(run, restored.store)
    // Remembered like a fresh run: a resumed run that reaches E2 must be approvable, and the
    // approval endpoint resolves the run through this registry. Without it the gate would refuse
    // with `research/approval-run-unknown` — a resumed run no person could ever pass.
    rememberRun(
      restored.runId,
      restored.store,
      () => snapshotOf(run, restored.store, null, persisted),
      () => this.recordRun(run, restored.store).then(recorded => recorded.persistence),
    )
    return snapshotOf(run, restored.store, null, persisted)
  }

  /**
   * Write the run's package when the deployment configured a directory.
   *
   * A failed export is REPORTED, not swallowed: a caller that was told a package exists and
   * finds none has been misled, which is worse than being told the export failed. The
   * directory comes from the deployment's config, never from the request — `runPipeline` is
   * exposed as a Remote method, so a client-supplied path would name a filesystem location.
   *
   * @param store - the run store, still live at this point.
   * @param run - the driven run.
   * @returns what was written, or the failure, or null when no directory is configured.
   */
  private exportRunPackage(store: ResearchRunStore, run: RunResult): ResearchPackageExport | null {
    const research = this.ctx.get('research') as { packageDirectory?: string } | undefined
    const root = research?.packageDirectory
    if (root === undefined) return null
    // One subdirectory per run. Writing every run into the same directory left an earlier run's
    // files beside the new manifest — a reader saw eleven files where the manifest named six, and
    // nothing said which run the other five belonged to. A package is one run's, so it gets one
    // directory.
    // `join`, not concatenation: this path is shown to the operator, and a mixed-separator path
    // reads as a bug in something they may copy.
    const directory = join(root, run.runId)
    try {
      const manifest = writeRunPackage(planRunPackage(store, run), directory)
      return {
        files: manifest.files.map(file => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 })),
        directory,
      }
    } catch (error) {
      return { files: [], error: errorMessage(error) }
    }
  }

  /**
   * {@link runPipeline}, exposed to Remote clients.
   *
   * The browser surface had no way to start a run: the driver's production entry
   * existed and nothing called it, so the research tab could only ever render the
   * bundled fixture. This is the CALLER. It returns the runner's own result rather
   * than a presentation model — the client owns that mapping, and the wire carries
   * exactly what {@link runPipeline} produced.
   *
   * The request carries no `AbortSignal`: the Gateway supplies cancellation through
   * the trailing parameter, which is the convention every other Remote method here
   * follows.
   *
   * @param request - the run seed. `domainDirection` is the runner's single
   *   seedable input; omitting it uses the driver's default.
   * @param signal - cancellation supplied by the caller.
   * @returns the per-step outcomes plus the run id, as {@link runPipeline} returns.
   */
  @Remote('run')
  run(request: ResearchRunRequest, signal?: AbortSignal): Promise<ResearchRunSnapshot> {
    // THE WIRE BOUNDARY FOR A PLAN. Everything downstream trusts it completely — the manuscript's
    // title, A1's retrieval topic, the claim the C channel grades — so a malformed one would not
    // fail where it entered; it would produce a run whose artifacts disagree with each other. A plan
    // that cannot be used is REFUSED HERE, with the reason, rather than replaced by the default:
    // silently running something else would make the run's products describe a study the caller did
    // not ask for.
    if (request.plan !== undefined) {
      const validated = requirePlan(request.plan, MEASURED_METRIC)
      if (!validated.ok) {
        return Promise.reject(new Error(`[research] the run's plan cannot be used: ${validated.reason}`))
      }
      return this.runPipeline({
        studyPlan: validated.plan,
        ...(signal !== undefined ? { signal } : {}),
      })
    }
    return this.runPipeline({
      ...(request.domainDirection !== undefined ? { domainDirection: request.domainDirection } : {}),
      ...(signal !== undefined ? { signal } : {}),
    })
  }

  /**
   * {@link ResearchTeamService.run}'s first step: what the run could be about.
   *
   * The run dialog calls this before any run exists, so a person confirms a direction and a
   * criterion rather than discovering them in a finished manuscript. Every proposal has already
   * been through the gate's own claim-level check (`direction-proposals.ts`), so what reaches a
   * person is a claim the C channel can grade — a proposal that would stall the run is refused here
   * with its reason instead of being offered and then abandoned.
   *
   * The measured quantity is not the model's to choose: this run can only measure what its study
   * measures, so it travels into the request and the instruction requires the prediction to name it.
   *
   * @param request - the field to propose within; absent or empty asks for the study's own.
   * @param signal - cancellation supplied by the caller.
   * @returns the proposals, the refusals, and which channel produced them.
   */
  @Remote('proposeDirections')
  async proposeDirections(
    request: ResearchProposalRequest,
    signal?: AbortSignal,
  ): Promise<ResearchProposalAnswer> {
    const writer = this.hostProseWriter()
    if (writer === undefined) {
      throw new Error(
        '[research] this deployment configures no prose channel, so no research direction can be '
        + 'proposed — a proposal is written, and there is nothing here to write it',
      )
    }
    const stated = (request.field ?? '').trim()
    const proposalRequest = {
      field: stated,
      metric: MEASURED_METRIC,
      skeleton: DEFAULT_PLAN.outline,
    }
    const written = await writer.write({
      stepId: 'propose-directions',
      instruction: proposalInstruction(proposalRequest),
      // The model-visible context is the request's own facts, not a UI payload: the field it is
      // proposing within and the one quantity this run can measure.
      context: {
        field: stated.length === 0 ? DEFAULT_PLAN.field : stated,
        measurableQuantity: MEASURED_METRIC.label,
        quantityKey: MEASURED_METRIC.key,
      },
      ...(signal !== undefined ? { signal } : {}),
    })
    const outcome = parseDirectionProposals(written.text, proposalRequest)
    // The person stated no field, so the plan's field is the study's own rather than an empty
    // string — a plan that reached the runner with an empty field would be refused there.
    const planField = stated.length === 0 ? DEFAULT_PLAN.field : stated
    return {
      proposals: outcome.proposals.map(proposal => ({
        plan: planFromProposal(proposal, planField, MEASURED_METRIC),
        title: proposal.title,
        direction: proposal.direction,
        claim: proposal.claim.ref,
      })),
      refusals: outcome.rejected,
      channel: writer.channel,
    }
  }

  /**
   * Tool dependencies assembled by the mounted research adapter, when present.
   * Read lazily through `ctx.get` (the documented read for an optional service) so
   * a late-mounted adapter still governs later runs, and a deployment without one
   * falls back to the fixture graph instead of failing.
   */
  private hostToolDeps(): ResearchToolDeps | undefined {
    const research = this.ctx.get('research') as { toolDeps?: ResearchToolDeps } | undefined
    return research?.toolDeps
  }

  /**
   * The real-model prose writer assembled by the mounted research adapter, when
   * configured. Read alongside {@link ResearchTeamService.hostToolDeps} so one
   * deployment decision governs both the retrieval channel and the prose channel.
   */
  /**
   * The per-step time budget this deployment configured, or undefined when it configured none.
   *
   * Read from the engine beside the channels, because the right budget follows from which
   * channels are configured: the offline prose route answers in milliseconds and the registry
   * budget fits it, while a model route needs orders of magnitude more for the same step.
   *
   * @returns the budget in milliseconds, or undefined for the registry's per-step values.
   */
  private hostStepTimeoutMs(): number | undefined {
    const research = this.ctx.get('research') as { stepTimeoutMs?: number } | undefined
    return research?.stepTimeoutMs
  }

  private hostProseWriter(): ResearchProseWriter | undefined {
    const research = this.ctx.get('research') as { proseWriter?: ResearchProseWriter } | undefined
    return research?.proseWriter
  }

  /**
   * The run inputs derived from the Case Pack this deployment selected, or undefined when
   * it selected none.
   *
   * The pack directory is a DEPLOYMENT setting carried by the research engine, never a
   * request field: `runPipeline` is exposed to Remote clients, and a client-supplied path
   * would let a browser name a filesystem location. The pack is loaded per run from the
   * directory the deployment named; a run started with no pack keeps the pipeline's own
   * seeds.
   *
   * @returns one entry per seeded slug, each carrying the file and pointer it came from.
   * @throws {CasePackError} when the deployment named a directory that is not a valid pack.
   */
  private hostCasePackInputs(): ReadonlyArray<CasePackRunInput> | undefined {
    const research = this.ctx.get('research') as { casePackDirectory?: string } | undefined
    const directory = research?.casePackDirectory
    if (directory === undefined) return undefined
    return planCasePackInputs(loadCasePack(directory))
  }

  /**
   * The scenario block of the deployment's selected Case Pack, or undefined when it selected none.
   *
   * A resumed run needs it for the same reason a fresh one does: the C channel measures the STUDY,
   * and a resumed run that fell back to the module's own scenarios would adjudicate the claim
   * against a different experiment from the one its own artifacts describe.
   *
   * @returns the pack's `case-pack-scenario` value, or undefined.
   * @throws {CasePackError} when the deployment named a directory that is not a valid pack.
   */
  private hostCasePackScenario(): unknown {
    const research = this.ctx.get('research') as { casePackDirectory?: string } | undefined
    const directory = research?.casePackDirectory
    if (directory === undefined) return undefined
    const seeded = planCasePackInputs(loadCasePack(directory))
    return seeded.find(entry => entry.slug === CASE_PACK_INPUT_SLUGS.scenario)?.value
  }

  /** Queue one contained recovery pass after publication has unwound. */
  private scheduleRecovery(agent: Agent): void {
    queueMicrotask(() => {
      if (this.disposal.signal.aborted) return
      void this.recoverFor(agent).catch((error: unknown) => {
        if (this.disposal.signal.aborted) return
        this.ctx.logger.warn(`research-team recovery for "${agent.id}" failed: ${errorMessage(error)}`)
      })
    })
  }

  /** Reconcile one resumed agent's provisioning state against durable Sessions. */
  private async recoverFor(agent: Agent): Promise<void> {
    await this.roster.recoverFor(agent, this.disposal.signal)
  }
}

export default ResearchTeamService
