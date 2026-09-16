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

import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import type {
  ResearchArtifactMetaView,
  ResearchGateVerdictView,
  ResearchProposalAnswer,
  ResearchProposalRequest,
  ResearchRunExecution,
  ResearchRunFollowRequest,
  ResearchRunFrame,
  ResearchRunQuery,
  ResearchRunRequest,
  ResearchRunSnapshot,
  ResearchRunStart,
  ResearchStartRequest,
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
  ResearchRunCursor,
  ResearchRunExecution,
  ResearchRunFollowRequest,
  ResearchRunFrame,
  RunEventEnvelope,
  ResearchRunQuery,
  ResearchRunRequest,
  ResearchRunSnapshot,
  ResearchRunStart,
  ResearchStartRequest,
  ResearchStepCatalogEntry,
} from './types.ts'
import {
  parseDirectionProposals,
  planFromProposal,
  proposalInstruction,
} from './runner/direction-proposals.ts'
import { MEASURED_METRIC } from './runner/platoon-sim.ts'
import { readinessOfRun } from './runner/submission-readiness.ts'
import { stepProjectionsOf } from './runner/project-view.ts'
import { envelopeOf, liveRunOf, readRunCursor, runCursorOf, RUN_FOLLOW_TICK_MS } from './runner/run-events.ts'
import { requireCommandId, startCommandDigest, type StartCommandRecord } from './runner/start-commands.ts'
import type { DriveOptions } from './runner/types.ts'
import { driveRun, prepareRun } from './runner/drive.ts'
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
import {
  DEFAULT_EVIDENCE_PROFILE,
  isEvidenceProfile,
  createRunPersistence,
  getArtifact,
  getRunSnapshot,
  getStepDefinitions,
  rollback,
} from '@deepseek-ai/dsh-research-core'
import type { EvidenceProfile } from '@deepseek-ai/dsh-research-core'
import type { RestoredRun, RunPersistence } from '@deepseek-ai/dsh-research-core'
import type { ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { CASE_PACK_INPUT_SLUGS, loadCasePack, planCasePackInputs } from './runner/case-pack.ts'
import { planRunPackage, writeRunPackage } from './runner/package-export.ts'
import type { CasePackRunInput } from './runner/case-pack.ts'
import { createRunContext, driveRemaining, runT19B } from './runner/drive.ts'
import { experimentStudy, studyFromPack } from './runner/platoon-sim.ts'
import { firstNonTerminalStep, materialWithCommitment, needsReleaseBeforeResume } from './runner/resume.ts'
import type { ResearchProseWriter, RunContext } from './runner/registry.ts'
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
 * @param store - the store the run populated.
 * @param runId - the run to project.
 * @param evidenceProfile - the profile this deployment declared.
 * @param packageExport - what the run exported, when it finished.
 * @param runPersistence - what the run left on disk, or what it has written so far.
 * @param execution - whether a driver is on the run in THIS process.
 * @param executionError - why the driver stopped with a failure, when it did.
 * @returns the run, the step catalogue, and the recorded verdicts, artifacts and states.
 */
function snapshotOf(
  store: ResearchRunStore,
  runId: string,
  evidenceProfile: EvidenceProfile,
  packageExport: ResearchPackageExport | null = null,
  runPersistence: ResearchRunPersistence | null = null,
  execution: ResearchRunExecution = 'stopped',
  executionError?: string,
): ResearchRunSnapshot {
  const snapshot = getRunSnapshot(store, runId)
  const readiness = readinessOfRun(store, runId, evidenceProfile)
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

  return {
    run: { runId, steps: stepProjectionsOf(store, runId) },
    // A driver that THREW is a run-level fact: the steps say how far the study got, and this says
    // that whatever was going to continue it is gone. Reporting only the steps leaves a reader
    // waiting on a run nothing is driving.
    ...(executionError === undefined ? {} : { executionError }),
    projectRevision: snapshot.revision,
    catalog,
    gates,
    artifacts,
    steps,
    evidenceProfile,
    profileEligible: readiness.profileEligible,
    submissionReady: readiness.ready,
    readinessNote: readiness.reason,
    execution,
    packageExport,
    runPersistence,
  }
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

/**
 * Refuse a command id that has already been used for a different study.
 *
 * @param commandId - the id both sends used.
 * @param recorded - what the first send asked for.
 * @param asked - what this send asks for.
 * @throws {Error} when they differ.
 */
function requireSameCommand(commandId: string, recorded: string, asked: string): void {
  if (recorded !== asked) {
    throw new Error(
      `[research] command '${commandId}' was already sent with different research; `
      + 'a retry re-sends the same request, and a second study needs a second command id',
    )
  }
}

/** A run restored from this deployment's own records. */
interface StoredRun {
  readonly restored: RestoredRun<null>
  readonly persistence: ResearchRunPersistence
}

/**
 * The store a restored run lives in.
 *
 * @param found - the restored record, which the caller has already established is non-null.
 * @returns the store holding exactly that run.
 */
function findStoredStore(found: StoredRun | null): ResearchRunStore {
  if (found === null) throw new Error('[research] no run was restored to read events from')
  return found.restored.store
}

/** Wait one follow interval. */
async function waitForRead(): Promise<void> {
  await new Promise<void>((resolve) => { setTimeout(resolve, RUN_FOLLOW_TICK_MS) })
}

/**
 * One run this process holds, and whether it still has a driver on it.
 *
 * `state` is a PROCESS fact, never a durable one: it says whether a driver is on the run here and
 * now, which is exactly what a query must answer after a restart and what no stored record can.
 */
interface ActiveRun {
  readonly store: ResearchRunStore
  state: ResearchRunExecution
  error?: string
  /**
   * The revision of the last durable write, or null when none has landed yet.
   *
   * A run checkpointed mid-flight and a run whose checkpoints all failed are both "running"; what
   * a reader deciding whether to close the page needs is whether anything is on disk, and that is
   * this number rather than the process's own opinion of its health.
   */
  savedRevision: number | null
  /** What the run's export produced, once it finished. Null while it has not. */
  packageExport: ResearchPackageExport | null
  /** What the last durable write reported, once the run finished. Null while it has not. */
  persistence: ResearchRunPersistence | null
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
    const evidenceProfile = this.hostEvidenceProfile()
    const revisionRounds = this.hostRevisionRounds()
    const run = await runT19B(store, {
      evidenceProfile,
      ...(revisionRounds !== undefined ? { revisionRounds } : {}),
      ...(options.domainDirection !== undefined ? { domainDirection: options.domainDirection } : {}),
      ...(options.studyPlan !== undefined ? { studyPlan: options.studyPlan } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      ...(toolDeps !== undefined ? { toolDeps } : {}),
      ...(proseWriter !== undefined ? { proseWriter } : {}),
      ...(casePackInputs !== undefined ? { casePackInputs } : {}),
      ...(stepTimeoutMs !== undefined ? { timeoutMs: stepTimeoutMs } : {}),
      // Persist as the run goes. Saving only when it finished lost every completed step to a
      // process death — including the steps that cost model calls — and the snapshot store's own
      // lock cannot compensate for a checkpoint that never happened.
      checkpointAfterStep: async (checkpointRunId: string) => { await this.checkpointRun(store, checkpointRunId) },
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
      () => snapshotOf(store, run.runId, evidenceProfile, packageExport, persistence),
      // The approval persists through the SAME writer the run did, so a decision is as durable as
      // the run that produced it — and only the persistence half is wanted here. Handing the
      // decision to memory alone left the snapshot saying E2 `gated` after a person had approved
      // it, so a restart asked them to approve what they already had.
      () => this.recordRun(run, store).then(recorded => recorded.persistence),
    )
    return snapshotOf(store, run.runId, evidenceProfile, packageExport, persistence)
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
      return this.persistRun(store, run.runId, stored?.revision ?? 0)
    })
    return { persistence, packageExport: this.exportRunPackage(store, run) }
  }

  /**
   * The evidence profile this deployment declared, or the demo default when it declared none.
   *
   * Read off the research engine the way the snapshot and package directories are, because it is
   * a deployment fact recorded in `cordis.yml` and never a request field: `runPipeline` is
   * reachable from a browser, and a client must not be able to promote its own run to production.
   *
   * @returns the declared profile, or {@link DEFAULT_EVIDENCE_PROFILE}.
   */
  private hostEvidenceProfile(): EvidenceProfile {
    const research = this.ctx.get('research') as { evidenceProfile?: EvidenceProfile } | undefined
    return research?.evidenceProfile ?? DEFAULT_EVIDENCE_PROFILE
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
   * The id is a parameter and not a `RunResult`, because the state of a run that has not finished
   * is exactly what a mid-run approval has to persist — and reaching for a drive result to get an
   * id is how a half-executed run ends up described by a fabricated one.
   *
   * @param store - the run store, still live at this point.
   * @param runId - the run to write.
   * @param baseRevision - the revision this state is derived from.
   * @returns the persisted revision, or the failure, or null when no directory is configured.
   */
  private async persistRun(
    store: ResearchRunStore,
    runId: string,
    baseRevision: number,
  ): Promise<ResearchRunPersistence | null> {
    const persistence = this.hostRunPersistence(runId)
    if (persistence === undefined) return null
    try {
      const payload = await persistence.save(store, runId, { baseRevision })
      const directory = this.snapshotDirectoryOf(runId)
      return {
        runId,
        revision: payload.revision,
        interrupted: [],
        ...(directory === undefined ? {} : { directory }),
      }
    } catch (error) {
      return { runId, revision: null, interrupted: [], error: errorMessage(error) }
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
    // The plan the run was DRIVEN with, read back from the run's own record of it. This used to
    // take the title, the field, the retrieval direction and the section skeleton from the plan
    // THIS deployment supplies, because no artifact carries them — so a resume after a deployment
    // changed its plan (or after one deployment resumed another's run) wrote a manuscript about a
    // study its own gates had not graded. `setRunSpec` records the resolved configuration before
    // the first step; a record that fails to parse falls back to the deployment's plan and SAYS so
    // in the returned snapshot's spec, rather than resolving silently.
    const recordedSpec = getRunSnapshot(restored.store, restored.runId).spec
    const recordedPlan = requirePlan(recordedSpec['studyPlan'], MEASURED_METRIC)
    if (recordedPlan.ok) runCtx.studyPlan = recordedPlan.plan
    // The plan's CLAIM half is then overlaid from the artifacts, which are the authority for what
    // the gates actually graded: a run whose claim was re-derived mid-flight would otherwise have
    // its gates' verdicts describe one claim and its prose another.
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
    // The profile the run was driven under, from its own record; the deployment's current one is
    // the fallback for a record that carries none, and is never a silent promotion of an
    // evaluation run to production.
    const recordedProfile = recordedSpec['evidenceProfile']
    const evidenceProfile = isEvidenceProfile(recordedProfile)
      ? recordedProfile
      : this.hostEvidenceProfile()
    const recordedTimeout = recordedSpec['stepTimeoutMs']
    const recordedTimeoutMs = typeof recordedTimeout === 'number' && Number.isFinite(recordedTimeout) && recordedTimeout > 0
      ? recordedTimeout
      : undefined
    const run = await driveRemaining(restored.store, restored.runId, runCtx, from, {
      evidenceProfile,
      // The budget the run was started with, for the same reason as the plan: the registry's
      // per-step value fits the offline channels, and a run driven through a model route that
      // resumed under the registry budget would record `timeout` on its first long step.
      ...(recordedTimeoutMs === undefined ? {} : { timeoutMs: recordedTimeoutMs }),
      ...(capability.toolDeps !== undefined ? { toolDeps: capability.toolDeps } : {}),
      ...(capability.proseWriter !== undefined ? { proseWriter: capability.proseWriter } : {}),
      ...(options.signal !== undefined ? { signal: options.signal } : {}),
      checkpointAfterStep: async (checkpointRunId: string) => { await this.checkpointRun(restored.store, checkpointRunId) },
    })
    const { persistence: persisted } = await this.recordRun(run, restored.store)
    // Remembered like a fresh run: a resumed run that reaches E2 must be approvable, and the
    // approval endpoint resolves the run through this registry. Without it the gate would refuse
    // with `research/approval-run-unknown` — a resumed run no person could ever pass.
    rememberRun(
      restored.runId,
      restored.store,
      () => snapshotOf(restored.store, restored.runId, evidenceProfile, null, persisted),
      () => this.recordRun(run, restored.store).then(recorded => recorded.persistence),
    )
    return snapshotOf(restored.store, restored.runId, evidenceProfile, null, persisted)
  }

  /**
   * Write the run's current state to its durable snapshot, mid-run.
   *
   * The snapshot only: the reproducible package is a finished run's product, and re-exporting it
   * after every step would write a directory of partial artifacts sixteen times over. What a
   * checkpoint is for is the state — which steps committed, at which attempts and revisions — so a
   * process that dies mid-run resumes instead of starting over.
   *
   * A failure is thrown to the caller (the driver's checkpoint hook), which records it and lets
   * the run continue. The revision guard is the store's, not this method's: a conflicting save is
   * a real signal and must not be papered over by retrying blind.
   *
   * @param store - the run store, still live at this point.
   * @param runId - the run to checkpoint.
   * @returns the revision written, or null when this deployment configures no directory.
   */
  private async checkpointRun(store: ResearchRunStore, runId: string): Promise<number | null> {
    const persistence = this.hostRunPersistence(runId)
    if (persistence === undefined) return null
    return await this.serialized(async () => {
      const stored = await this.readStoredRun(runId)
      const payload = await persistence.save(store, runId, { baseRevision: stored?.revision ?? 0 })
      return payload.revision
    })
  }

  /**
   * The save state of a run this process is still driving.
   *
   * Built from the run's own checkpoints rather than from a file read on every query: a client
   * polling a live run asks this far more often than the run writes. `revision: null` therefore
   * means "nothing has landed YET", and the directory says where it will land — which is the whole
   * answer for a reader deciding whether a page reload would lose their study.
   *
   * @param active - the run this process holds.
   * @param runId - the run's id.
   * @returns what can be said about its durable state now, or null when none is configured.
   */
  private livePersistence(active: ActiveRun, runId: string): ResearchRunPersistence | null {
    if (active.persistence !== null) return active.persistence
    const directory = this.snapshotDirectoryOf(runId)
    if (directory === undefined) return null
    return { runId, revision: this.savedRevisionOf(active), interrupted: [], directory }
  }

  /**
   * The revision this run is on disk at, as this process last learned it.
   *
   * ONE RULE, USED BY EVERY WRITER AND BY THE REPORT. A browser run found what two copies of this
   * number cost: the report read the finished write's revision while the approval's persistence read
   * the last CHECKPOINT's, so an approval at E2 was applied and then refused — "the persisted
   * snapshot is at revision 18 but this write is based on revision 17" — and the decision stayed in
   * memory and off the disk. The final write's record is the authority once the run has ended;
   * before that, the last checkpoint's.
   *
   * @param active - the run this process holds.
   * @returns the revision to base the next write on, or null when none has landed.
   */
  private savedRevisionOf(active: ActiveRun): number | null {
    return active.persistence?.revision ?? active.savedRevision
  }

  /**
   * Locate a run this process did NOT start, from its durable record.
   *
   * THIS IS RESTART RECOVERY. A process that came up after the one driving a study has no
   * in-memory run and no driver — but the run's checkpoints are on disk, and reading them is what
   * lets the query answer "here is the run, it is stopped here, these steps were in flight" instead
   * of `null`, which a reader would take for "this run never existed".
   *
   * `tryLoad` distinguishes the two absences the answer depends on: no snapshot file at all is
   * `null` (nothing to find), while a corrupt or version-incompatible one THROWS — reporting a
   * damaged record as an absent run is the same error-degraded-to-a-neutral-statement pattern the
   * store itself refuses.
   *
   * @param runId - the run to find.
   * @returns the restored record, or null when this deployment stores no such run.
   */
  private async findStoredRun(runId: string): Promise<StoredRun | null> {
    const directory = this.snapshotDirectoryOf(runId)
    // A QUERY MUST NOT CREATE. `hostRunPersistence` makes the directory, which is right when a run
    // is being started and wrong here: asking about a run id that was never used would leave an
    // empty directory named after it, for the recovery listing to find and fail to load.
    if (directory === undefined || !existsSync(directory)) return null
    const persistence = this.hostRunPersistence(runId)
    if (persistence === undefined) return null
    const restored = await persistence.tryLoad(null)
    if (restored === null) return null
    return {
      restored,
      persistence: {
        runId,
        revision: restored.revision,
        // WHAT WAS IN FLIGHT when the snapshot was taken. A resumed run rolls these back and
        // re-executes them, so a reader told "stopped" is also told what stopping cost.
        interrupted: restored.interrupted.map(step => step.stepId),
        ...(directory === undefined ? {} : { directory }),
      },
    }
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
      const manifest = writeRunPackage(planRunPackage(store, run, this.hostEvidenceProfile()), directory)
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
  /** Runs this process is executing or has executed, by id. */
  private readonly activeRuns = new Map<string, ActiveRun>()

  /**
   * The answer each start command produced.
   *
   * In memory, and that is the honest boundary: across a restart a retried command meets a service
   * that holds no such run, and the caller is told so rather than being handed a second study. The
   * durable form of this is the run record itself, which `runSnapshot` reads.
   */
  private readonly startCommands = new Map<
    string,
    { readonly digest: string; readonly started: Promise<ResearchRunStart> }
  >()

  /**
   * The deployment's own drive options.
   *
   * Extracted so {@link startRun} and {@link runPipeline} cannot drift: a run started through one
   * entry and a run started through the other must be the same study under the same configuration,
   * and two hand-written option lists is how they stop being.
   *
   * @returns the resolved tool deps, prose writer, case pack, timeout, profile and revision bound.
   */
  private driveOptions(): DriveOptions {
    const toolDeps = this.hostToolDeps()
    const proseWriter = this.hostProseWriter()
    const casePackInputs = this.hostCasePackInputs()
    const stepTimeoutMs = this.hostStepTimeoutMs()
    const revisionRounds = this.hostRevisionRounds()
    return {
      evidenceProfile: this.hostEvidenceProfile(),
      ...(toolDeps !== undefined ? { toolDeps } : {}),
      ...(proseWriter !== undefined ? { proseWriter } : {}),
      ...(casePackInputs !== undefined ? { casePackInputs } : {}),
      ...(stepTimeoutMs !== undefined ? { timeoutMs: stepTimeoutMs } : {}),
      ...(revisionRounds !== undefined ? { revisionRounds } : {}),
    }
  }

  /**
   * ONE RUN PER COMMAND, AND THE ID COMES BACK BEFORE THE WORK DOES.
   *
   * {@link run} waits for the whole study; a person who pressed a button has nothing to look at
   * until it ends, and a page reload loses the only handle they had. This method creates the run,
   * freezes its resolved configuration, writes it to disk, and hands back the id — then drives it
   * in the background, owned by this service.
   *
   * The order is the guarantee: the id returned is THE run's id, and by the time a caller has it,
   * the run is on disk (or `persisted: false` says it is not). A failure to save does not return
   * success and does not start anything.
   *
   * A command that is still running when this returns is NOT cancelled by the caller's interest
   * ending: the driver is this service's, so a closed page does not stop a study.
   *
   * @param request - the command id, plus the same seed {@link run} takes.
   * @returns the run id and whether it is on disk.
   */
  @Remote('startRun')
  async startRun(request: ResearchStartRequest): Promise<ResearchRunStart> {
    // A RETRY READS THE FIRST ANSWER. The caller could not read the response — a timeout, a reload
    // — and sends the same command again; creating a second run for it would spend a second study.
    // The id names the COMMAND, so one id is one run however many times it is sent, and a caller
    // that wants a second study sends a second id.
    const commandId = requireCommandId(request.commandId)
    const digest = startCommandDigest(request)
    const known = this.startCommands.get(commandId)
    if (known !== undefined) {
      // A SECOND STUDY WEARING THE FIRST ONE'S IDENTITY. Answering it with the first run would run
      // something the caller did not ask for, so it is refused instead.
      requireSameCommand(commandId, known.digest, digest)
      return await known.started
    }
    // THE REGISTRATION HAPPENS BEFORE ANY `await`. `startCommandOnce` runs synchronously up to its
    // first one, so a second call — which cannot run until this synchronous block finishes — finds
    // this promise and waits for its answer rather than creating a run of its own.
    const started = this.startCommandOnce(commandId, digest, request)
    this.startCommands.set(commandId, { digest, started })
    try {
      return await started
    } catch (error) {
      // A FAILED START IS RETRYABLE. Nothing was recorded, so the id is free again.
      this.startCommands.delete(commandId)
      throw error
    }
  }

  /**
   * The one start behind one command id: the recorded answer, or a new run.
   *
   * @param commandId - the id, already validated.
   * @param digest - what the command asked for.
   * @param request - the command.
   * @returns the receipt.
   */
  private async startCommandOnce(
    commandId: string,
    digest: string,
    request: ResearchStartRequest,
  ): Promise<ResearchRunStart> {
    // ACROSS A RESTART THE RECORD IS THE ONLY WITNESS. A caller whose response was lost asks again
    // in a process that never heard of the command; without this it would be handed a second study.
    const recorded = await this.readStartCommand(commandId)
    if (recorded !== null) {
      requireSameCommand(commandId, recorded.paramsDigest, digest)
      const found = await this.findStoredRun(recorded.runId)
      if (found === null) {
        // The command is known and the run it named is not: reporting success would promise a study
        // this deployment cannot produce, so it says which of the two is missing.
        return {
          runId: recorded.runId,
          persisted: false,
          persistenceError: `the run this command started ('${recorded.runId}') is no longer stored`,
          startedAt: recorded.startedAt,
        }
      }
      return { runId: recorded.runId, persisted: true, startedAt: recorded.startedAt }
    }

    const seed: DriveOptions = request.plan !== undefined
      ? (() => {
        const validated = requirePlan(request.plan, MEASURED_METRIC)
        if (!validated.ok) {
          throw new Error(`[research] the run's plan cannot be used: ${validated.reason}`)
        }
        return { studyPlan: validated.plan }
      })()
      : (request.domainDirection !== undefined ? { domainDirection: request.domainDirection } : {})
    const driveOpts: DriveOptions = { ...this.driveOptions(), ...seed }

    const store: ResearchRunStore = new Map()
    const prepared = prepareRun(store, driveOpts)
    const persistence = this.hostRunPersistence(prepared.runId)
    let persisted = false
    let persistenceError: string | undefined
    // The revision the run is on disk at. It starts as the write below and moves with each
    // checkpoint, so a later writer — an approval's persistence, most of all — bases its save on
    // the revision that is actually stored rather than on zero.
    let savedRevision: number | null = null
    if (persistence === undefined) {
      persistenceError = 'no snapshot directory is configured for this deployment'
    } else {
      try {
        // BEFORE the driver: a run that exists only in memory cannot be found after a reload, and
        // a start that answered success would have promised it could.
        savedRevision = (await persistence.save(store, prepared.runId, { baseRevision: 0 })).revision
        persisted = true
      } catch (error) {
        persistenceError = error instanceof Error ? error.message : String(error)
      }
    }
    if (!persisted) {
      // NOT STARTED. The caller is told the run id was not made durable and nothing was begun, so
      // a retry is safe; starting anyway would leave a study running that no record names.
      throw new Error(`[research] the run could not be recorded, so it was not started: ${String(persistenceError)}`)
    }

    const active: ActiveRun = {
      store,
      state: 'running',
      savedRevision,
      packageExport: null,
      persistence: null,
    }
    this.activeRuns.set(prepared.runId, active)
    rememberRun(
      prepared.runId,
      store,
      () => snapshotOf(
        store,
        prepared.runId,
        this.hostEvidenceProfile(),
        active.packageExport,
        this.livePersistence(active, prepared.runId),
        active.state,
        active.error,
      ),
      // THE STATE ONLY. A run still going has no package — exporting one here would write a
      // manifest of the steps that happen to have finished and call it the run's product. What an
      // approval at E2 needs durable is the DECISION, and the decision lives in the state.
      // `savedRevisionOf` and not a field: this is the same number the snapshot reports, so the
      // write cannot be based on a revision the reader was never shown.
      () => this.serialized(
        () => this.persistRun(store, prepared.runId, this.savedRevisionOf(active) ?? 0),
      ),
    )
    // PERSIST AS THE RUN GOES, exactly as `runPipeline` does and for the same reason: a run that
    // only wrote at the end would lose every completed step — including the ones that cost model
    // calls — to a process death, and would leave a restarted process nothing to find.
    const driving: DriveOptions = {
      ...driveOpts,
      checkpointAfterStep: async (checkpointRunId: string) => {
        active.savedRevision = await this.checkpointRun(store, checkpointRunId)
      },
    }
    // THE SERVICE OWNS THE DRIVER. A bare floating promise would be collected with nothing able to
    // say the run had died, and a rejection escaping a `.then` handler would be an unhandled one.
    // ONE place records what became of the run, so the query can report it.
    void this.driveInBackground(store, prepared.runId, prepared.runCtx, driving, active)

    const started: ResearchRunStart = {
      runId: prepared.runId,
      persisted,
      startedAt: Date.now(),
    }
    // THE COMMAND IS RECORDED BEFORE THE DRIVER STARTS, beside the run it names. A restart reads it
    // to answer the retry; a record that cannot be written is a start that cannot be recovered, so
    // it fails here rather than leaving a caller with an id nothing can look up.
    await this.writeStartCommand({
      commandId,
      runId: prepared.runId,
      paramsDigest: digest,
      startedAt: started.startedAt,
    })
    return started
  }

  /**
   * The directory the start-command records live in, or undefined when none is configured.
   *
   * @returns the absolute directory, or undefined.
   */
  private startCommandDirectory(): string | undefined {
    const research = this.ctx.get('research') as { snapshotDirectory?: string } | undefined
    return research?.snapshotDirectory === undefined
      ? undefined
      : join(research.snapshotDirectory, 'commands')
  }

  /**
   * Read one command's durable record, or null when this deployment holds none.
   *
   * @param commandId - the command to look up.
   * @returns the record, or null.
   */
  private async readStartCommand(commandId: string): Promise<StartCommandRecord | null> {
    const directory = this.startCommandDirectory()
    if (directory === undefined) return null
    try {
      return JSON.parse(await readFile(join(directory, `${commandId}.json`), 'utf8')) as StartCommandRecord
    } catch (error) {
      // ABSENT means this command was never sent here; UNREADABLE means the deployment cannot be
      // told. Treating the second as the first is how a retry becomes a second study.
      if ((error as { code?: unknown }).code === 'ENOENT') return null
      throw new Error(`[research] the start command '${commandId}' cannot be read: ${errorMessage(error)}`)
    }
  }

  /**
   * Write one command's durable record.
   *
   * @param record - what the command produced.
   */
  private async writeStartCommand(record: StartCommandRecord): Promise<void> {
    const directory = this.startCommandDirectory()
    if (directory === undefined) return
    mkdirSync(directory, { recursive: true })
    const target = join(directory, `${record.commandId}.json`)
    const temporary = `${target}.tmp`
    // WRITE AND RENAME, the order the run snapshots use: a reader of the final name sees a whole
    // record or none, never one a crash left half-written.
    await writeFile(temporary, JSON.stringify(record), { encoding: 'utf8' })
    await rename(temporary, target)
  }

  /**
   * Drive a started run to its end, and record what became of it.
   *
   * Everything after the driver — persisting the finished state and exporting the package — is in
   * the same `try` as the driver, because a rejection that escaped a `.then` handler would be an
   * unhandled one, and the run would be left reading `running` with nothing driving it. The export
   * is a FINISHED run's product, so it is written here rather than at every checkpoint.
   *
   * Both halves of {@link recordRun} report their own failures, so the `catch` is for the
   * unexpected: the run's outcome is unknown to this process at that point, and `failed` with the
   * message is what can honestly be said about it.
   *
   * @param store - the run's store, live until this returns.
   * @param runId - the run.
   * @param runCtx - the run's shared context, as {@link prepareRun} built it.
   * @param opts - the options the run was prepared with, plus its checkpoint hook.
   * @param active - what this process holds about the run, updated in place.
   */
  private async driveInBackground(
    store: ResearchRunStore,
    runId: string,
    runCtx: RunContext,
    opts: DriveOptions,
    active: ActiveRun,
  ): Promise<void> {
    try {
      const run = await driveRun(store, runId, runCtx, opts)
      const recorded = await this.recordRun(run, store)
      active.persistence = recorded.persistence
      active.packageExport = recorded.packageExport
      // THE FINAL WRITE MOVED THE FILE PAST THE LAST CHECKPOINT. An approval's persistence is based
      // on this number, and leaving it at the checkpoint's revision is how a browser run's approval
      // at E2 was APPLIED and then refused — "the persisted snapshot is at revision 18 but this
      // write is based on revision 17" — leaving the decision in memory and off the disk.
      active.savedRevision = recorded.persistence?.revision ?? active.savedRevision
      active.state = 'stopped'
    } catch (error) {
      active.state = 'failed'
      active.error = error instanceof Error ? error.message : String(error)
    }
  }

  /**
   * Read one run as it stands.
   *
   * Three answers, and they are three different facts:
   *   - a run this process is driving: its live projection, `execution: 'running'`;
   *   - a run this process drove to an end: the same projection, `execution: 'stopped'` (or
   *     `'failed'`, with `executionError`), and its exported package;
   *   - a run this process never held but whose checkpoints are on disk — the case a RESTART
   *     creates: the record is restored and reported as `stopped`, with the steps that were in
   *     flight named. What it is NOT reported as is `running`: nothing here is driving it, and a
   *     stale `running` read back from a record written by a process that is gone is the lie this
   *     field exists to prevent.
   *
   * `null` therefore means what it says: this deployment has no such run — not in memory, not on
   * disk.
   *
   * @param request - the run to read.
   * @returns the run's current projection, or null when this deployment holds no such run.
   */
  @Remote('runSnapshot')
  async runSnapshot(request: ResearchRunQuery): Promise<ResearchRunSnapshot | null> {
    const active = this.activeRuns.get(request.runId)
    if (active !== undefined) {
      return snapshotOf(
        active.store,
        request.runId,
        this.hostEvidenceProfile(),
        active.packageExport,
        this.livePersistence(active, request.runId),
        active.state,
        active.error,
      )
    }
    const found = await this.findStoredRun(request.runId)
    if (found === null) return null
    return snapshotOf(
      found.restored.store,
      request.runId,
      this.hostEvidenceProfile(),
      null,
      found.persistence,
      'stopped',
    )
  }

  /**
   * Follow one run: an opening snapshot, then the events appended after it.
   *
   * THE OTHER HALF OF A RUN BEING READABLE WHILE IT RUNS. {@link runSnapshot} answers "what is this
   * run doing" and has no position to resume from; this answers "what has happened", in order, from
   * a cursor the caller can name again. The opening frame is the consistent point §7.2 of the plan
   * asks for: its cursor IS the position its snapshot was read at, and because the run's log only
   * grows, that snapshot already contains the effect of every event up to it. A caller that
   * reconnects is therefore handed a state that includes what it missed rather than being asked to
   * replay it, and the frames after it are exactly the events appended since.
   *
   * READ-ONLY, deliberately: §7.2 puts version-sensitive commands on the authenticated unary path,
   * so a stream a page can open is not a way to write.
   *
   * @param request - the run to follow, and the caller's last position when it holds one.
   * @param signal - cancellation for the subscription.
   * @returns the opening snapshot, then one frame per appended event.
   */
  @Remote({ mode: 'stream' })
  followRun(request: ResearchRunFollowRequest, signal: AbortSignal): AsyncIterable<ResearchRunFrame> {
    return this.runFrames(request, signal)
  }

  /**
   * The frames one follow yields.
   *
   * @param request - the run to follow and the caller's last position.
   * @param signal - cancellation for the subscription.
   * @returns the opening snapshot, then one frame per appended event.
   */
  private async * runFrames(
    request: ResearchRunFollowRequest,
    signal: AbortSignal,
  ): AsyncGenerator<ResearchRunFrame> {
    const active = this.activeRuns.get(request.runId)
    const found = active === undefined ? await this.findStoredRun(request.runId) : null
    if (active === undefined && found === null) {
      // A RUN THIS DEPLOYMENT DOES NOT HOLD IS NOT A STREAM TO OPEN. Naming it is the honest answer;
      // an empty stream would read exactly like a run that has done nothing.
      throw new Error(`[research] this deployment holds no run '${request.runId}'`)
    }
    const store = active !== undefined ? active.store : findStoredStore(found)
    const snapshot = this.projectRun(request.runId, active, found)
    const available = liveRunOf(store, request.runId)?.events.length ?? 0
    if (request.cursor !== undefined) {
      // VALIDATED, not replayed from: a cursor naming another run, or a position this run has not
      // reached, means the caller's window is not this run's history.
      const read = readRunCursor(request.runId, request.cursor, available)
      if (!read.ok) {
        yield { type: 'resync', reason: read.reason }
        return
      }
    }
    yield { type: 'snapshot', cursor: runCursorOf(request.runId, available), snapshot }

    let from = available
    for (;;) {
      signal.throwIfAborted()
      const events = liveRunOf(store, request.runId)?.events ?? []
      let appended = 0
      for (let index = from; index < events.length; index += 1) {
        const event = events[index]
        // `noUncheckedIndexedAccess` is off, so the bound above is what guarantees this; a log that
        // shrank under the loop would be a different failure entirely, and skipping it silently is
        // the one thing this must not do.
        if (event === undefined) break
        yield { type: 'event', event: envelopeOf(request.runId, index, event) }
        appended += 1
      }
      // THE STATE AFTER THOSE EVENTS, so a reader renders the projection this service owns instead
      // of replaying events into one of its own. The cursor and the projection are read in one
      // synchronous step, which is what makes them the same point in the run's history.
      if (appended > 0) {
        const at = liveRunOf(store, request.runId)?.events.length ?? 0
        yield { type: 'snapshot', cursor: runCursorOf(request.runId, at), snapshot: this.projectRun(request.runId, active, found) }
        from = at
      } else {
        from = events.length
      }
      // NOTHING IS DRIVING IT ANY MORE and its tail is delivered: this run has said everything it
      // will say in this process. A later decision appends more, and a caller that wants it opens a
      // new follow — which is also what keeps a browser connection from being held open for the
      // hours a person may take to decide.
      if (active === undefined || active.state !== 'running') {
        // AND THE LAST FRAME SAYS SO. The run's own state moved AFTER the batch that finished it, so
        // the snapshot beside that batch can still say `running` — and since this stream ends here,
        // a follower would be left reading `running` about a run with no driver, with no next frame
        // to correct it. A run this process never drove needs no such frame: its opening snapshot
        // was already read at this position and already says `stopped`.
        if (active !== undefined) {
          const at = liveRunOf(store, request.runId)?.events.length ?? 0
          yield {
            type: 'snapshot',
            cursor: runCursorOf(request.runId, at),
            snapshot: this.projectRun(request.runId, active, found),
          }
        }
        return
      }
      await waitForRead()
    }
  }

  /**
   * One run's projection, from whichever record this process holds for it.
   *
   * @param runId - the run to project.
   * @param active - the in-memory record, when this process is driving or drove it.
   * @param found - the restored record, when it came off the disk instead.
   * @returns the run's current projection.
   */
  private projectRun(
    runId: string,
    active: ActiveRun | undefined,
    found: StoredRun | null,
  ): ResearchRunSnapshot {
    if (active !== undefined) {
      return snapshotOf(
        active.store,
        runId,
        this.hostEvidenceProfile(),
        active.packageExport,
        this.livePersistence(active, runId),
        active.state,
        active.error,
      )
    }
    if (found === null) throw new Error(`[research] this deployment holds no run '${runId}'`)
    return snapshotOf(found.restored.store, runId, this.hostEvidenceProfile(), null, found.persistence, 'stopped')
  }

  /**
   * Drive one study to its end and answer with the run's projection.
   *
   * The synchronous entry point: it is what an in-process caller uses, and what the browser used
   * before {@link startRun} existed. It answers when the study is over, so a caller that wants to
   * show progress while it works wants {@link startRun} instead.
   *
   * @param request - the plan this run carries, or the deployment's default.
   * @param signal - cancellation for the whole study.
   * @returns the finished run's projection.
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

  /**
   * How many revision rounds the deployment allows `D4-rebuttal`.
   *
   * Read from the research engine's own configuration, the same way the step budget is: how many
   * times it is worth asking a model to fix a manuscript is a deployment's decision, and the
   * executor ships a default for deployments that make none.
   *
   * @returns the configured bound, or undefined for the executor's default.
   */
  private hostRevisionRounds(): number | undefined {
    const research = this.ctx.get('research') as { revisionRounds?: number } | undefined
    return research?.revisionRounds
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
