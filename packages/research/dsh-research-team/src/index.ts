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

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
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
  ResearchRunSummaryEntry,
  ResearchRunSaveRetry,
  ResearchRunSnapshot,
  ResearchRunStart,
  ResearchStartRequest,
  ResearchPackageExport,
  ResearchRunPersistence,
  ResearchStepCatalogEntry,
  ResearchStepStateView,
  ResearchRevisionView,
  ResearchRevisionRequest,
  ResearchCandidateRequest,
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
  ResearchRunSaveRetry,
  ResearchRunSummaryEntry,
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
import { chainDigest, EMPTY_LOG, envelopeOf, liveRunOf, readRunCursor, runCursorOf, RUN_FOLLOW_TICK_MS } from './runner/run-events.ts'
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
import type { AuditEvent, EvidenceProfile } from '@deepseek-ai/dsh-research-core'
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
  OPERATOR_PRINCIPAL_ID,
  forgetRuns,
  installApprovalEndpoint,
  rememberRun,
  type ApprovalConnectionHost,
} from './approval.ts'
import {
  buildCandidate, candidateHashOf, createRevisionRequest, readRevision, reviewCandidate,
  revisionStoreOf, sectionsOf, writeAcceptance, writeCandidate, writeReview, writeRevisionRequest,
  writeSection,
} from './manuscript-revision.ts'
import { acceptManuscriptCandidate } from '@deepseek-ai/dsh-research-core'
import type {
  RevisionCandidateRecord, RevisionReviewMaterial, RevisionStore,
} from './manuscript-revision.ts'
import type { ApprovalDecision } from './approval.ts'

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
 * @param saveFailure - why the run's last durable write did not land, when it did not.
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
  saveFailure?: string,
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
      // READ FROM THE RUN'S OWN RECORD, so every reader of this snapshot — the tab that decided, a
      // tab that reloaded, a page opened tomorrow — states the same decision with the same author
      // and time, and no tab's memory is the source of what the study did.
      approval: state.approval === undefined ? null : {
        decision: state.approval.decision,
        operator: state.approval.principalId,
        decidedAt: state.approval.timestamp,
        rationale: state.approval.rationale ?? null,
        targetRefs: state.approval.targetRefs.map(ref => ({
          artifactId: ref.artifactId, version: ref.version,
        })),
      },
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
    // A RUN WHOSE LAST WRITE FAILED IS NOT READY, whatever its gates say. Readiness is a claim
    // about material that exists and is reproducible; material the deployment could not write is
    // neither, and a reader told "ready" about it would be told to submit something nobody can
    // produce again.
    submissionReady: readiness.ready && saveFailure === undefined,
    readinessNote: saveFailure === undefined
      ? readiness.reason
      : `${readiness.reason === '' ? '' : `${readiness.reason}; `}the run's last save did not reach the disk: ${saveFailure}`,
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
  /**
   * Why the run's last checkpoint could not be written, when it could not.
   *
   * A CHECKPOINT THAT FAILED IS A RUN-LEVEL FACT, not a note the driver keeps to itself: a reader
   * watching a study advance has to be able to tell that the work it is watching is not on the
   * disk, and an operation whose result depends on durability — an approval, a publication — has to
   * be able to refuse. It is cleared by the next checkpoint that lands.
   */
  checkpointError?: string
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
      installApprovalEndpoint(connection, {
        // THE DECISION IS WHERE THE LOOP STARTS. A change request is an instruction; recording it
        // as a revision request is what gives the work that answers it something to answer, and it
        // happens here rather than in the page because the run's records are this service's.
        onDecided: receipt => this.recordRevisionRequestFor(receipt),
      })
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
      // This run has stopped driving, so its FINAL write is the last word on whether it is on
      // disk. An approval of it is refused while that write reports a failure, for the same reason
      // the projection calls it unready.
      () => persistence,
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
      // A resumed run has stopped driving by the time it can be approved, so the write this resume
      // ended with is what says whether it is on disk.
      () => persisted,
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
    return {
      runId,
      revision: this.savedRevisionOf(active),
      interrupted: [],
      ...(active.checkpointError === undefined ? {} : { error: active.checkpointError }),
      directory,
    }
  }

  /**
   * The facts about a run that can change without its log growing.
   *
   * A follow delivers a frame when its EVENTS move; these are what move without them — whether a
   * driver is on the run here, why it stopped, and whether the run's last write reached the disk.
   * A reader watching for a study to fall out of step with the disk is watching these, and a stream
   * that only reported appended events would stay silent through exactly the failure it is for.
   *
   * A run this process never drove has none of it to report: nothing here is driving it, so nothing
   * here changes it, and its durability is whatever its file says — which is where it stays.
   *
   * @param active - the run this process holds, when it holds one.
   * @param found - the restored record, when the run came off the disk.
   * @returns a value that changes exactly when one of those facts does.
   */
  private controlSignatureOf(active: ActiveRun | undefined, found: StoredRun | null): string {
    if (active === undefined) {
      return JSON.stringify(['held-on-disk', found?.persistence.revision ?? null])
    }
    return JSON.stringify([
      active.state,
      active.error ?? '',
      active.checkpointError ?? '',
      active.savedRevision,
      active.persistence?.revision ?? null,
    ])
  }

  /**
   * Project one run this process holds, from the state it holds it in.
   *
   * THE RUN'S DURABILITY IS READ ONCE AND USED TWICE: the projection renders the record, and the
   * same record's error is what makes the run unready. Reading it twice could answer the two
   * questions differently and leave a page saying "ready" about a run the deployment cannot save.
   *
   * @param active - the run this process holds.
   * @param runId - the run's id.
   * @returns the run's current projection.
   */
  private projectActive(active: ActiveRun, runId: string): ResearchRunSnapshot {
    const save = this.livePersistence(active, runId)
    return snapshotOf(
      active.store,
      runId,
      this.hostEvidenceProfile(),
      active.packageExport,
      save,
      active.state,
      active.error,
      save?.error,
    )
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
      // A FAILED START IS RETRYABLE. Nothing was begun, and the one thing the attempt may have left
      // behind — its command record, removed where it was written — is undone with this entry so
      // the id is free again.
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
      if (found !== null) return { runId: recorded.runId, persisted: true, startedAt: recorded.startedAt }
      if (recorded.runStored) {
        // The study DID begin and its record is gone: reporting success would promise a study this
        // deployment cannot produce, and starting another would be a second study for a command
        // that may already have produced results.
        return {
          runId: recorded.runId,
          persisted: false,
          persistenceError: `the run this command started ('${recorded.runId}') is no longer stored`,
          startedAt: recorded.startedAt,
        }
      }
      // A RECORD WHOSE RUN WAS NEVER STORED IS A COMMAND THAT NEVER BEGAN A STUDY, and the two
      // answers available here are each wrong for the other's case: returning the run id in the file
      // hands the caller a study this deployment does not hold, and refusing forever makes the id
      // unusable although nothing was started. Falling through carries the command out NOW, under
      // the same id — safe precisely because no study has run — and the record written below (one
      // file per command id) replaces this one, so the retry after THAT is answered with the run
      // that actually exists.
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
    const startedAt = Date.now()
    // THE RECORD LANDS BEFORE THE RUN DOES, which is the order that closes the window between them.
    // Written afterwards, a process dying between the run's first save and this write leaves a study
    // that exists with nothing naming its command — and the caller's retry, finding no record,
    // starts a SECOND one. Written first, the retry always has something to find: it is answered
    // from the record, and the only thing the window can cost is a command id that has to be
    // replaced. A record whose run is missing is reported as such rather than re-run, because a
    // study that was begun may have produced something, and starting another is not a way to find
    // out. The failed-start path removes this record again (see `removeStartCommand`).
    const commandRecord = await this.writeStartCommand({
      commandId,
      runId: prepared.runId,
      paramsDigest: digest,
      startedAt,
      // THE RUN IS NOT STORED YET, and the record says so until it is. A process that dies in
      // between leaves this file naming a run that does not exist, which is what a retry needs to
      // know to carry the command out instead of answering with a study nobody has.
      runStored: false,
    })
    // The revision the run is on disk at. It starts as the write below and moves with each
    // checkpoint, so a later writer — an approval's persistence, most of all — bases its save on
    // the revision that is actually stored rather than on zero.
    let savedRevision: number
    try {
      const persistence = this.hostRunPersistence(prepared.runId)
      if (persistence === undefined) throw new Error('no snapshot directory is configured for this deployment')
      // BEFORE the driver: a run that exists only in memory cannot be found after a reload, and a
      // start that answered success would have promised it could.
      savedRevision = (await persistence.save(store, prepared.runId, { baseRevision: 0 })).revision
    } catch (error) {
      // NOT STARTED, AND THE RECORD GOES BACK WITH IT. The caller is told the run id was not made
      // durable and nothing was begun, so a retry is safe; starting anyway would leave a study
      // running that no record names, and keeping the record would leave the id unusable — the two
      // halves of "this command did not happen" are undone together. The whole start is inside this
      // `try` because the failure arrives in two shapes — resolving the deployment's directory can
      // throw before anything is written — and a compensation that covered only one of them would
      // leave the record behind exactly when the deployment is broken.
      await this.removeStartCommand(commandRecord).catch(() => {
        // NOTHING ELSE TO DO, and nothing extra is reported: the caller is being told why its start
        // failed. A record left behind is the safe direction — the retry refuses rather than
        // starting a second study.
      })
      throw new Error(`[research] the run could not be recorded, so it was not started: ${errorMessage(error)}`)
    }
    // THE RUN EXISTS NOW, SO THE RECORD SAYS SO — outside the `try` above, because a start that has
    // already happened must not be undone by a failure to describe it: the compensation there
    // removes the record on the way out, and a run on disk with no record naming it is exactly what
    // the ordering above exists to prevent. A failure HERE is therefore swallowed rather than
    // raised: the caller would be told its start failed while its study is running, and its retry
    // would find `runStored: false` beside a stored run — which the retry resolves by answering
    // with the run, since the run existing is the stronger fact.
    await this.writeStartCommand({
      commandId,
      runId: prepared.runId,
      paramsDigest: digest,
      startedAt,
      runStored: true,
    }).catch(() => {
      // Swallowed for the reason above: the run is stored and findable, and the record is one
      // `runStored` flag behind rather than wrong. Nothing else can reach this — the write is the
      // only statement.
    })

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
      () => this.projectActive(active, prepared.runId),
      // THE STATE ONLY. A run still going has no package — exporting one here would write a
      // manifest of the steps that happen to have finished and call it the run's product. What an
      // approval at E2 needs durable is the DECISION, and the decision lives in the state.
      // `savedRevisionOf` and not a field: this is the same number the snapshot reports, so the
      // write cannot be based on a revision the reader was never shown.
      () => this.serialized(
        () => this.persistRun(store, prepared.runId, this.savedRevisionOf(active) ?? 0),
      ),
      // LIVE, because this run is still being driven: an approval of it must read the same record
      // the page is rendering, and that record moves with every checkpoint.
      () => this.livePersistence(active, prepared.runId),
    )
    // PERSIST AS THE RUN GOES, exactly as `runPipeline` does and for the same reason: a run that
    // only wrote at the end would lose every completed step — including the ones that cost model
    // calls — to a process death, and would leave a restarted process nothing to find.
    const driving: DriveOptions = {
      ...driveOpts,
      checkpointAfterStep: async (checkpointRunId: string) => {
        try {
          active.savedRevision = await this.checkpointRun(store, checkpointRunId)
          // IT LANDED, so whatever failed before is no longer the run's state.
          delete active.checkpointError
        } catch (error) {
          // RECORDED AND RETHROWN. The driver keeps its own accounting of checkpoint failures
          // (`RunResult.checkpointErrors`) and the run continues — its step has already committed —
          // but the failure also becomes the run's own reported state, which is what a reader and a
          // writer both need.
          active.checkpointError = errorMessage(error)
          throw error
        }
      },
    }
    // THE SERVICE OWNS THE DRIVER. A bare floating promise would be collected with nothing able to
    // say the run had died, and a rejection escaping a `.then` handler would be an unhandled one.
    // ONE place records what became of the run, so the query can report it.
    void this.driveInBackground(store, prepared.runId, prepared.runCtx, driving, active)

    // ALWAYS TRUE HERE: a run that could not be recorded threw above rather than reaching this, and
    // the caller of a `persisted: false` receipt is the retry path, which reads it off the record.
    return { runId: prepared.runId, persisted: true, startedAt }
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
   * Record a person's request to change the manuscript at the human gate.
   *
   * THE OTHER HALF OF A CHANGE REQUEST. The decision itself (see `approval.ts`) leaves the gate open
   * and records what was asked for; this turns that instruction into a durable request that names
   * the sections it read, each with the body hash it had, so the work that answers it can be shown
   * to answer THAT version rather than whatever the manuscript says later.
   *
   * @param request - the run, the gate step, the revision the person read, and the instruction.
   * @returns the recorded request, re-projected for the page.
   * @throws {Error} when this process holds no such run, when the run has no manuscript yet, or when
   *   the deployment keeps no durable root to record a request in.
   */
  @Remote('requestRevision')
  async requestRevision(request: ResearchRevisionRequest): Promise<ResearchRevisionView> {
    const active = this.heldRun(request.runId)
    const store = this.revisionStoreOrThrow()
    if (request.instruction.trim() === '') {
      throw new Error('[revision-instruction-empty] a request to change the manuscript must say what to change')
    }
    const sections = sectionsOf(this.manuscriptMarkdownOf(request.runId))
    if (sections.length === 0) {
      throw new Error(
        `[revision-no-manuscript] run '${request.runId}' has no manuscript yet — there is nothing to revise`,
      )
    }
    const record = createRevisionRequest({
      requestId: request.requestId,
      runId: request.runId,
      stepId: request.stepId,
      projectRevision: getRunSnapshot(active.store, request.runId).revision,
      // RECORDED HERE, AT THE MOMENT THE PERSON READ IT: an acceptance later compares against this,
      // not against whatever version the manuscript happens to be at when someone presses accept.
      manuscriptVersion: this.manuscriptVersionOf(request.runId),
      instruction: request.instruction,
      operator: OPERATOR_PRINCIPAL_ID,
      sections,
    })
    await writeRevisionRequest(store, record)
    return await this.revisionViewOf(request.runId, record.requestId)
  }

  /**
   * Write a candidate for one recorded request.
   *
   * THE WRITER IS THE DEPLOYMENT'S OWN PROSE CHANNEL, the seam D3 and D4 write through, so the
   * candidate's text carries the same provenance as the manuscript it revises. A deployment whose
   * route is the deterministic offline one gets deterministic revision text, and the candidate
   * records which channel wrote it rather than leaving a reader to assume.
   *
   * @param request - the request to answer.
   * @returns the request re-projected with its new candidate.
   * @throws {Error} when the request or its run is unknown, when the manuscript moved since the
   *   request read it, or when the writer produced no text.
   */
  @Remote('generateCandidate')
  async generateCandidate(request: ResearchCandidateRequest): Promise<ResearchRevisionView> {
    this.heldRun(request.runId)
    const store = this.revisionStoreOrThrow()
    const read = await readRevision(store, request.requestId)
    if (read.request === null) {
      throw new Error(`[revision-unknown] this deployment holds no request '${request.requestId}'`)
    }
    const writer = this.hostProseWriter()
    if (writer === undefined) {
      throw new Error(
        '[revision-no-writer] this deployment configured no prose channel, so no candidate text can be written',
      )
    }
    const current = sectionsOf(this.manuscriptMarkdownOf(request.runId))
    const byId = new Map(current.map(section => [section.sectionId, section]))
    const context = { instruction: read.request.instruction, sectionIds: read.request.sections.map(section => section.sectionId) }
    const written = new Map<string, string>()
    let provenance: RevisionCandidateRecord['writer'] | undefined
    for (const basis of read.request.sections) {
      const section = byId.get(basis.sectionId)
      if (section === undefined) continue
      const result = await writeSection(writer, read.request.instruction, section, context)
      written.set(basis.sectionId, result.text)
      provenance ??= { channel: writer.channel, provider: result.provider, model: result.model }
    }
    const candidate = buildCandidate({
      candidateId: request.candidateId,
      request: read.request,
      current,
      written,
      writer: provenance ?? { channel: writer.channel, provider: '', model: '' },
    })
    await writeCandidate(store, candidate)
    return await this.revisionViewOf(request.runId, request.requestId)
  }

  /**
   * Judge one candidate on what a pipeline can check without reading its prose.
   *
   * @param request - the candidate to review.
   * @returns the request re-projected with the review.
   * @throws {Error} when the candidate is unknown.
   */
  @Remote('reviewCandidate')
  async reviewCandidate(request: ResearchCandidateRequest): Promise<ResearchRevisionView> {
    this.heldRun(request.runId)
    const store = this.revisionStoreOrThrow()
    const read = await readRevision(store, request.requestId)
    const candidate = read.candidates.find(entry => entry.candidateId === request.candidateId)
    if (candidate === undefined) {
      throw new Error(`[revision-unknown] this deployment holds no candidate '${request.candidateId}'`)
    }
    const review = reviewCandidate(candidate, this.reviewMaterialOf(request.runId))
    await writeReview(store, request.requestId, review)
    return await this.revisionViewOf(request.runId, request.requestId)
  }

  /**
   * Publish a reviewed candidate as the run's official manuscript.
   *
   * THE LOOP'S LAST STEP, and the only one that changes the study: everything before it — the
   * request, the candidate, the diff, the review — describes work that has not been adopted. This
   * assembles the candidate's text over the manuscript the run holds, hands it to core's acceptance
   * with the versions it was written against, and writes the run so the acceptance survives a
   * restart.
   *
   * @param request - the run, the request and the candidate to accept.
   * @returns the revision as it stands after the acceptance, so the page renders backend truth.
   * @throws {Error} when this process holds no such run, when the request or candidate is unknown,
   *   or when core refuses — a manuscript that moved, a review that failed, no review at all.
   */
  @Remote('acceptCandidate')
  async acceptCandidate(request: ResearchCandidateRequest): Promise<ResearchRevisionView> {
    const active = this.heldRun(request.runId)
    const store = this.revisionStoreOrThrow()
    const read = await readRevision(store, request.requestId)
    const candidate = read.candidates.find(entry => entry.candidateId === request.candidateId)
    if (candidate === undefined) {
      throw new Error(`[revision-unknown] this deployment holds no candidate '${request.candidateId}'`)
    }
    const review = read.reviews.find(entry => entry.candidateId === candidate.candidateId)
    const current = getRunSnapshot(active.store, request.runId).registry['formatted-manuscript']
    if (current === undefined) {
      throw new Error(`[revision-no-manuscript] run '${request.runId}' has no manuscript to accept over`)
    }
    if (request.expectedRevision === undefined || request.expectedManuscriptVersion === undefined) {
      throw new Error(
        '[revision-no-expectations] an acceptance must state the run revision and the manuscript '
        + 'version the person read — without them it is a publication over whatever is there now',
      )
    }
    // THE VALUE IS ASSEMBLED HERE, from the candidate's sections over the manuscript the run holds:
    // a caller that handed over its own manuscript would be publishing whatever it liked, and the
    // version check below would be checking it against itself.
    const manuscriptValue = getArtifact(active.store, request.runId, 'formatted-manuscript')
    const assembled = this.assembledManuscript(manuscriptValue, candidate)
    const receipt = acceptManuscriptCandidate(active.store, {
      runId: request.runId,
      // THE CALLER'S EXPECTATIONS, NOT THIS PROCESS'S: a page that read revision 12 and pressed
      // accept after the study moved to 14 is accepting a manuscript it never saw, and reading the
      // current values here would make that check pass by construction.
      expectedRevision: request.expectedRevision,
      expectedManuscriptVersion: request.expectedManuscriptVersion,
      value: assembled,
      candidateHash: candidateHashOf(candidate.sections),
      operator: OPERATOR_PRINCIPAL_ID,
      requestId: request.requestId,
      candidateId: candidate.candidateId,
    }, {
      reviewed: review !== undefined,
      passed: review?.passed ?? false,
      candidateHash: review?.candidateHash ?? '',
    })
    // WRITTEN BEFORE IT IS REPORTED. An acceptance held only in this process is one a restart loses:
    // the run would come back showing the manuscript E1 wrote, with no record that a person accepted
    // another one. It goes through the SAME serialized writer every other write uses, so it cannot
    // interleave with a checkpoint. A failure here does NOT un-accept — the store holds it — so it is
    // reported beside the receipt rather than turned into a refusal that would misdescribe what
    // happened.
    await writeAcceptance(store, request.requestId, {
      requestId: request.requestId,
      candidateId: candidate.candidateId,
      operator: receipt.operator,
      revision: receipt.revision,
      manuscriptVersion: receipt.ref.version,
      acceptedAt: receipt.acceptedAt,
      // FILLED IN BELOW, once the write it describes has happened: the record is written first so a
      // crash between the two leaves an acceptance the run can still be reconciled against, and its
      // persistence fields say what that write did.
      persisted: false,
    })
    const saved = await this.serialized(
      () => this.persistRun(active.store, request.runId, getRunSnapshot(active.store, request.runId).revision),
    ).catch((error: unknown) => ({
      runId: request.runId, revision: null, interrupted: [],
      error: error instanceof Error ? error.message : String(error),
    })) ?? null
    this.noteSave(active, saved)
    const acceptance = {
      requestId: request.requestId,
      candidateId: candidate.candidateId,
      operator: receipt.operator,
      revision: receipt.revision,
      manuscriptVersion: receipt.ref.version,
      acceptedAt: receipt.acceptedAt,
      // A WRITE THAT ANSWERED NULL is a deployment with no snapshot root: the acceptance is in the
      // store and nowhere else, which is the same fact `noteSave` recorded against the run.
      persisted: saved !== null && saved.revision !== null,
      ...(saved?.error === undefined ? {} : { persistenceError: saved.error }),
    }
    await writeAcceptance(store, request.requestId, acceptance)
    return {
      ...(await this.revisionViewOf(request.runId, request.requestId)),
      acceptance,
    }
  }

  /**
   * The manuscript a candidate produces, assembled over the value the run holds.
   *
   * Every key of the E1 artifact is kept and only the manuscript text is rebuilt, so the accepted
   * version still describes the same study: a value rebuilt from the candidate alone would drop the
   * counts, the float roster and the package files, and the run's own readers would find the fields
   * they depend on missing.
   */
  private assembledManuscript(value: unknown, candidate: RevisionCandidateRecord): unknown {
    const record = typeof value === 'object' && value !== null ? { ...(value as Record<string, unknown>) } : {}
    const original = typeof record['manuscript'] === 'string' ? record['manuscript'] : ''
    // THE PART BEFORE THE FIRST SECTION IS KEPT. A manuscript opens with its title and any preamble,
    // and `sectionsOf` splits on `## ` headings — rebuilding from the sections alone would publish a
    // document that had lost its title, which is a change nobody asked for and nobody reviewed.
    const firstHeading = original.indexOf('\n## ')
    const preamble = firstHeading === -1 ? '' : original.slice(0, firstHeading)
    const sections = candidate.sections.map(section => [
      `## ${section.heading}`,
      '',
      section.bodyText,
      '',
    ].join('\n')).join('\n')
    return {
      ...record,
      manuscript: `${preamble === '' ? '' : `${preamble}\n\n`}${sections}`,
      acceptedCandidateId: candidate.candidateId,
    }
  }

  /**
   * The revisions this process holds for one run.
   *
   * @param request - the run to read.
   * @returns one view per request, newest first, each with its candidates and reviews.
   */
  @Remote('listRevisions')
  async listRevisions(request: { readonly runId: string }): Promise<ReadonlyArray<ResearchRevisionView>> {
    const store = this.revisionStoreOfDeployment()
    if (store === undefined) return []
    let directories: string[] = []
    try {
      directories = readdirSync(store.directory)
    } catch {
      // No revision directory yet is an empty history, not a failure to read one.
      directories = []
    }
    const views: ResearchRevisionView[] = []
    for (const requestId of directories) {
      const read = await readRevision(store, requestId).catch(() => null)
      if (read?.request === null || read === null) continue
      if (read.request.runId !== request.runId) continue
      views.push(await this.revisionViewOf(request.runId, requestId))
    }
    return views.sort((left, right) => right.requestedAt - left.requestedAt)
  }

  /**
   * Record the revision request a change decision asks for.
   *
   * Called with the receipt of a decision that was APPLIED, so it never reports anything to the
   * operator: the decision stands whatever happens here. What it adds is the other durable record —
   * the sections the person's instruction was about, each with the body hash it had — which is what
   * a candidate is later bound to.
   *
   * @param receipt - the applied decision.
   */
  private async recordRevisionRequestFor(receipt: ApprovalDecision): Promise<void> {
    if (receipt.decision !== 'request_changes' || receipt.request === undefined) return
    const store = this.revisionStoreOfDeployment()
    // NO DURABLE ROOT MEANS NO REVISION RECORD. Holding it in memory would ask the person to make
    // the request again after a restart, which is worse than telling them this deployment keeps none.
    if (store === undefined) return
    const sections = sectionsOf(this.manuscriptMarkdownOf(receipt.runId))
    if (sections.length === 0) return
    await writeRevisionRequest(store, createRevisionRequest({
      requestId: randomUUID(),
      runId: receipt.runId,
      stepId: receipt.stepId,
      projectRevision: receipt.snapshot?.projectRevision ?? getRunSnapshot(
        this.heldRun(receipt.runId).store, receipt.runId).revision,
      // THE VERSION THE DECISION WAS MADE AGAINST: the run's manuscript as it stands when the person
      // asked, which is what an acceptance will later be checked against.
      manuscriptVersion: this.manuscriptVersionOf(receipt.runId),
      instruction: receipt.request,
      operator: receipt.operator,
      sections,
    }))
  }

  /** The run this process holds, or a refusal naming the fact. */
  private heldRun(runId: string): ActiveRun {
    const active = this.activeRuns.get(runId)
    if (active === undefined) {
      throw new Error(`[revision-run-unknown] this process holds no run '${runId}' — a run id is not a revision credential`)
    }
    return active
  }

  /** This deployment's revision store, or a refusal saying it keeps none. */
  private revisionStoreOrThrow(): RevisionStore {
    const store = this.revisionStoreOfDeployment()
    if (store === undefined) {
      throw new Error('[revision-no-root] this deployment keeps no snapshot root, so a revision cannot be recorded')
    }
    return store
  }

  private revisionStoreOfDeployment(): RevisionStore | undefined {
    const research = this.ctx.get('research') as { snapshotDirectory?: string } | undefined
    return revisionStoreOf({ snapshotDirectory: research?.snapshotDirectory })
  }

  /** The version the run's manuscript artifact is at, or 0 when the run has none. */
  private manuscriptVersionOf(runId: string): number {
    const active = this.heldRun(runId)
    return getRunSnapshot(active.store, runId).registry['formatted-manuscript']?.ref.version ?? 0
  }

  /** The official manuscript's markdown, as the run's own artifact holds it. */
  private manuscriptMarkdownOf(runId: string): string {
    const active = this.heldRun(runId)
    const value = getArtifact(active.store, runId, 'formatted-manuscript')
    const record = typeof value === 'object' && value !== null ? (value as { manuscript?: unknown }) : undefined
    return typeof record?.manuscript === 'string' ? record.manuscript : ''
  }

  /**
   * What the checks read about one run: its own numbers, its reference labels and its headings.
   *
   * EVERY VALUE IS READ FROM THE RUN, not from the candidate and not from the instruction: a check
   * that took its expectations from the text under test would pass whatever the text said.
   */
  private reviewMaterialOf(runId: string): RevisionReviewMaterial {
    const active = this.heldRun(runId)
    const markdown = this.manuscriptMarkdownOf(runId)
    const sections = sectionsOf(markdown)
    // EVERY NUMBER THE RUN HOLDS, from its own registry rather than from the text under test: the
    // check is "this number came from somewhere in this study", and a value the candidate invented
    // is exactly what it must not find.
    const numbers = new Set<string>()
    for (const definition of getStepDefinitions()) {
      for (const slug of definition.outputs) {
        const value = getArtifact(active.store, runId, slug)
        if (value === undefined || value === null) continue
        for (const match of JSON.stringify(value).match(/-?\d+(?:\.\d+)?/g) ?? []) numbers.add(match)
      }
    }
    const labels = new Set<string>()
    for (const match of markdown.matchAll(/\[(\d+)\]/g)) labels.add(match[1] as string)
    return {
      knownNumbers: [...numbers],
      referenceLabels: [...labels],
      headings: sections.map(section => section.heading),
    }
  }

  /** One request, as the page renders it. */
  private async revisionViewOf(runId: string, requestId: string): Promise<ResearchRevisionView> {
    const store = this.revisionStoreOrThrow()
    const read = await readRevision(store, requestId)
    if (read.request === null) {
      throw new Error(`[revision-unknown] this deployment holds no request '${requestId}'`)
    }
    return {
      runId,
      requestId: read.request.requestId,
      instruction: read.request.instruction,
      operator: read.request.operator,
      projectRevision: read.request.projectRevision,
      manuscriptVersion: read.request.manuscriptVersion,
      requestedAt: read.request.requestedAt,
      sections: read.request.sections.map(section => ({ ...section })),
      targets: [...read.request.targets],
      candidates: read.candidates.map(candidate => ({
        candidateId: candidate.candidateId,
        writer: candidate.writer.channel,
        createdAt: candidate.createdAt,
        sections: candidate.sections.map(section => ({
          sectionId: section.sectionId,
          heading: section.heading,
          changed: section.changed,
          basisText: section.basisText,
          bodyText: section.bodyText,
        })),
      })),
      reviews: read.reviews.map(review => ({
        candidateId: review.candidateId,
        passed: review.passed,
        findings: review.findings.map(finding => ({ ...finding })),
      })),
      // AN ACCEPTANCE IS READ BACK, not remembered by whichever tab made it: this is what lets a page
      // that reloaded say the candidate became the manuscript.
      ...(read.acceptance === null ? {} : { acceptance: { ...read.acceptance } }),
    }
  }

  /**
   * The studies this deployment holds, newest first, for a person to pick from.
   *
   * WHY THIS EXISTS. A run id lived in the browser tab that started the study: the page remembered it
   * in session storage, so closing the page closed the only handle the deployment had ever handed out.
   * The studies themselves were on disk the whole time. This is the read that makes them findable —
   * a browser that knows nothing about any run can still open the one it wants.
   *
   * EVERY RUN IS READ, not just the ones with a stored snapshot: a run this process is driving has no
   * file of its own yet, and leaving it out would hide the study a person is most likely looking for.
   * A run that is both held and stored is reported ONCE, from the live state, because that is the
   * state its own readers see.
   *
   * @returns one entry per study, newest first.
   */
  @Remote('listRuns')
  async listRuns(): Promise<ReadonlyArray<ResearchRunSummaryEntry>> {
    const entries: ResearchRunSummaryEntry[] = []
    for (const [runId, active] of this.activeRuns) {
      entries.push({
        runId,
        execution: active.state,
        projectRevision: getRunSnapshot(active.store, runId).revision,
        stepsPassed: this.passedStepsOf(active.store, runId),
        stepsTotal: getStepDefinitions().length,
        submissionReady: this.projectActive(active, runId).submissionReady,
        ...(active.checkpointError === undefined ? {} : { saveFailure: active.checkpointError }),
        ...(active.error === undefined ? {} : { executionError: active.error }),
        interrupted: [],
      })
    }
    for (const runId of this.storedRunIds()) {
      if (this.activeRuns.has(runId)) continue
      const found = await this.findStoredRun(runId)
      if (found === null) continue
      const snapshot = snapshotOf(found.restored.store, runId, this.hostEvidenceProfile(), null, found.persistence, 'stopped')
      entries.push({
        runId,
        execution: 'stopped',
        projectRevision: found.restored.revision,
        stepsPassed: this.passedStepsOf(found.restored.store, runId),
        stepsTotal: getStepDefinitions().length,
        submissionReady: snapshot.submissionReady,
        ...(found.persistence.error === undefined ? {} : { saveFailure: found.persistence.error }),
        interrupted: found.persistence.interrupted,
      })
    }
    // A STABLE ORDER: the run's own revision cannot order two studies meaningfully, and the
    // directory listing's order is the filesystem's. Newest first, by the id when nothing else
    // distinguishes them — ids are UUIDs, so this is stable across calls and processes.
    return entries.sort((left, right) => right.runId.localeCompare(left.runId))
  }

  /**
   * How many of the pipeline's steps have passed in one run.
   *
   * @param store - the store holding the run.
   * @param runId - the run to count.
   * @returns the number of steps whose recorded status is `passed`.
   */
  private passedStepsOf(store: ResearchRunStore, runId: string): number {
    const steps = getRunSnapshot(store, runId).steps
    return getStepDefinitions().filter(definition => steps[definition.id]?.status === 'passed').length
  }

  /**
   * Write one run's CURRENT state to its snapshot again, after a write that failed.
   *
   * THE REMEDY FOR A SAVE THAT DID NOT LAND, and deliberately not a re-run: the state written here
   * is the one this process already holds, so a study that has finished stays finished — a second
   * execution would spend its model calls again and produce different numbers under the same name.
   * Only a run THIS PROCESS HOLDS can be retried, because only then is there state in memory that
   * the disk does not have; a run read back from its file is already at the state its file records.
   *
   * It RECONCILES WITH THE DISK rather than trusting a remembered number: the base revision is read
   * from the snapshot as it stands now, so a file another writer moved is not overwritten blind.
   * Each attempt moves the SNAPSHOT's revision — the write counter — and never the run's
   * `projectRevision`, which counts what the study committed: rewriting the same state commits
   * nothing, so a decision taken before the retry still names a current revision and the binding it
   * is held to is exactly what it was.
   *
   * @param request - the run whose write to retry.
   * @returns what the write did, and the run re-projected after it.
   * @throws {Error} when this process holds no such run.
   */
  @Remote('retryRunSave')
  async retryRunSave(request: ResearchRunQuery): Promise<ResearchRunSaveRetry> {
    const active = this.activeRuns.get(request.runId)
    if (active === undefined) {
      throw new Error(
        `[research] this process holds no run '${request.runId}': a save is retried with the state held in memory, and re-running a finished study is not a way to make a write succeed`,
      )
    }
    let persistence: ResearchRunPersistence | null
    try {
      // THE RECONCILING READ IS INSIDE THE TRY, because it is part of the write path: a deployment
      // whose snapshot directory cannot even be reached throws here, and that is a fact about the
      // save the caller asked for — reported as such rather than as a failure of the CALL.
      const stored = await this.readStoredRun(request.runId)
      persistence = await this.serialized(
        () => this.persistRun(active.store, request.runId, stored?.revision ?? 0),
      )
    } catch (error) {
      persistence = { runId: request.runId, revision: null, interrupted: [], error: errorMessage(error) }
    }
    this.noteSave(active, persistence)
    const persisted = persistence !== null && persistence.revision !== null
    return {
      runId: request.runId,
      persisted,
      ...(persisted
        ? {}
        : { persistenceError: persistence?.error ?? 'no snapshot directory is configured for this deployment' }),
      snapshot: this.projectActive(active, request.runId),
    }
  }

  /**
   * Record what a durable write did, on the run this process holds.
   *
   * ONE RULE, USED BY EVERY WRITER THE RUN'S READERS DEPEND ON. `livePersistence` reports this
   * record; `submissionReady` and the approval's precondition read it. A write that LANDED must stop
   * reading as a failure — otherwise a retried save would report success while the page and the
   * approval still saw the failure it just recovered from — and a write that failed must report ITS
   * reason rather than the previous one.
   *
   * @param active - the run this process holds.
   * @param persistence - what the write did, or null when no directory is configured.
   */
  private noteSave(active: ActiveRun, persistence: ResearchRunPersistence | null): void {
    if (persistence !== null) active.persistence = persistence
    if (persistence !== null && persistence.revision !== null) {
      active.savedRevision = persistence.revision
      delete active.checkpointError
      return
    }
    active.checkpointError = persistence?.error ?? 'no snapshot directory is configured for this deployment'
  }

  /**
   * Write one command's durable record.
   *
   * @param record - what the command produced.
   * @returns the file written, or undefined when this deployment records no commands.
   */
  private async writeStartCommand(record: StartCommandRecord): Promise<string | undefined> {
    const directory = this.startCommandDirectory()
    if (directory === undefined) return undefined
    mkdirSync(directory, { recursive: true })
    const target = join(directory, `${record.commandId}.json`)
    const temporary = `${target}.tmp`
    // WRITE AND RENAME, the order the run snapshots use: a reader of the final name sees a whole
    // record or none, never one a crash left half-written.
    await writeFile(temporary, JSON.stringify(record), { encoding: 'utf8' })
    await rename(temporary, target)
    return target
  }

  /**
   * Drop one command's durable record, for a start that did not happen.
   *
   * A record is written BEFORE the run it names, so that a process dying between the two leaves a
   * retry able to SEE the command instead of starting a second study. That ordering costs one thing:
   * a start that then failed for an ordinary reason — the run's snapshot could not be written — has
   * left a record naming a run nobody began. Removing it is what keeps the id retryable, and it is a
   * compensating write rather than a second source of truth: if it fails, the retry meets a record
   * whose run is missing, refuses, and asks for a new command id.
   *
   * The PATH is passed rather than re-resolved: the directory is a deployment fact read live, so a
   * root that moved between the write and this removal would otherwise send it to the wrong place
   * and leave the record it was meant to take back.
   *
   * @param target - the file {@link writeStartCommand} returned, when it wrote one.
   */
  private async removeStartCommand(target: string | undefined): Promise<void> {
    if (target === undefined) return
    await rm(target, { force: true })
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
      return this.projectActive(active, request.runId)
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
    // THE LOG'S IDENTITY IS BUILT ONCE PER SUBSCRIPTION and extended as events are appended, so a
    // reader's position is named with the history it was read from without re-hashing the log on
    // every frame. Its cost is one pass over the log per subscription, which is what opening one
    // costs anyway.
    const eventsNow = (): ReadonlyArray<AuditEvent> => liveRunOf(store, request.runId)?.events ?? []
    let identity = chainDigest(eventsNow(), EMPTY_LOG, available)
    if (request.cursor !== undefined) {
      // VALIDATED, not replayed from: a cursor naming another run, a position this run has not
      // reached, or a position in a different history of this run.
      const read = readRunCursor(request.runId, request.cursor, eventsNow())
      if (!read.ok) {
        yield { type: 'resync', reason: read.reason }
        return
      }
    }
    // THE RUN'S CONTROL STATE AS OF THE OPENING FRAME. Save health and execution ownership move
    // WITHOUT an event being appended — a checkpoint fails, a driver stops — and a reader that only
    // ever heard about appended events would be told nothing until the next step committed. It is
    // read HERE, beside the opening frame it describes: a generator's body runs as the consumer
    // pulls, so an initializer placed after the first `yield` would already be reading the state
    // that the frame after it is supposed to report.
    let control = this.controlSignatureOf(active, found)
    yield {
      type: 'snapshot',
      cursor: runCursorOf(request.runId, identity.consumed, identity.digest),
      snapshot,
    }

    let from = available
    for (;;) {
      signal.throwIfAborted()
      const events = eventsNow()
      let appended = 0
      for (let index = from; index < events.length; index += 1) {
        const event = events[index]
        // `noUncheckedIndexedAccess` is off, so the bound above is what guarantees this; a log that
        // shrank under the loop would be a different failure entirely, and skipping it silently is
        // the one thing this must not do.
        if (event === undefined) break
        // THE POSITION AFTER THIS EVENT, which is what a reader that consumes it names next: the
        // count of events consumed, carrying the chain digest of exactly those events.
        identity = chainDigest(events, identity, index + 1)
        yield {
          type: 'event',
          event: envelopeOf(
            request.runId,
            index,
            event,
            runCursorOf(request.runId, identity.consumed, identity.digest),
          ),
        }
        appended += 1
      }
      // THE STATE AFTER THOSE EVENTS, so a reader renders the projection this service owns instead
      // of replaying events into one of its own. The cursor and the projection are read in one
      // synchronous step, which is what makes them the same point in the run's history.
      if (appended > 0) {
        const at = eventsNow().length
        identity = chainDigest(eventsNow(), identity, at)
        yield {
          type: 'snapshot',
          cursor: runCursorOf(request.runId, identity.consumed, identity.digest),
          snapshot: this.projectRun(request.runId, active, found),
        }
        from = at
        control = this.controlSignatureOf(active, found)
      } else {
        from = events.length
        // A CONTROL UPDATE, DELIVERED AS A FRAME OF ITS OWN. Nothing was appended, and something the
        // reader watches for has still moved: the run's last save failed, or the driver that was on
        // it is gone. Both are facts about the run the page states, and the earlier shape of this
        // loop could only ever report them beside the NEXT event — which, for a run parked at the
        // human gate, may never come. The projection carries both, so the frame is the same kind as
        // every other one: no second vocabulary for "the state changed but nothing happened".
        const now = this.controlSignatureOf(active, found)
        if (now !== control) {
          control = now
          yield {
            type: 'snapshot',
            cursor: runCursorOf(request.runId, identity.consumed, identity.digest),
            snapshot: this.projectRun(request.runId, active, found),
          }
        }
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
          const at = eventsNow().length
          identity = chainDigest(eventsNow(), identity, at)
          yield {
            type: 'snapshot',
            cursor: runCursorOf(request.runId, identity.consumed, identity.digest),
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
    if (active !== undefined) return this.projectActive(active, runId)
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
