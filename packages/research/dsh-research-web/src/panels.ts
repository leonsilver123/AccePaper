/**
 * Pure, React-free derivations for the T27–T29 research workbench panels.
 *
 * Every selector takes the same flattened {@link RunSummary} the T26 summary view
 * consumes and returns a presentation-ready slice for one sub-panel. Keeping these
 * here (no React, no `@deepseek-ai/*` runtime imports) means the panel data
 * contracts are unit-testable in isolation and the browser bundle stays pure,
 * matching the T26 model convention.
 */
import type {
  AbstentionRecord, ArtifactView, GateHistoryEntry, Phase, RunSummary, StepView,
  TrinityComponent,
} from './summary.ts'

/** Coarse artifact category the Figures/Tables panels group by. */
export type ArtifactKind = 'figure' | 'table' | 'other'

/** Canonical phase order for roadmap/pipeline projection (A → E). */
export const PHASE_ORDER: readonly Phase[] = ['A', 'B', 'C', 'D', 'E']

/**
 * Classify an artifact into a coarse kind for the Figures/Tables panels.
 * Heuristic on the slug + summary text only — the fixture/model carries no
 * explicit kind, so this keeps the split deterministic and mock-honest.
 * @param artifact - the artifact row to classify.
 * @returns `'figure'` | `'table'` | `'other'`.
 */
export function classifyArtifact(artifact: ArtifactView): ArtifactKind {
  const hay = `${artifact.slug} ${artifact.summary}`.toLowerCase()
  if (hay.includes('figure') || hay.includes('-fig') || hay.includes('chart')) {
    return 'figure'
  }
  if (hay.includes('table') || hay.includes('tabulation')) {
    return 'table'
  }
  return 'other'
}

/**
 * A step's own name, by the identifier the run records.
 *
 * THE READER IS GIVEN THE NAME, NOT THE IDENTIFIER. Every panel that has to say which step something
 * belongs to used to print the identifier — `D3-writing`, `s01` — which is the one word about a step a
 * researcher cannot read. The name comes from the run's own catalogue, so this is a lookup and not a
 * second list of steps that could drift from it.
 *
 * An identifier with no step behind it is returned as itself: a run whose projection does not carry a
 * step still has to be able to show what its artifacts say they came from.
 *
 * @param summary - the run whose catalogue to read.
 * @param stepId - the identifier to name.
 * @returns the step's name, or the identifier when the run names no step for it.
 */
export function stepNameOf(summary: RunSummary, stepId: string): string {
  const step = summary.steps.find(candidate => candidate.stepId === stepId)
  if (step === undefined) return stepId
  return step.name.trim().length > 0 ? step.name : stepId
}

/** One phase-grouped pipeline slice consumed by the Pipeline panel. */
export interface PipelinePhaseSlice {
  readonly phase: Phase
  readonly steps: ReadonlyArray<StepView>
}

/**
 * Project the run's steps as a phase-grouped pipeline in canonical A→E order.
 * Steps with no steps in a phase are omitted (the panel shows its empty state
 * only when the whole run has no steps).
 * @param summary - the flattened run summary.
 * @returns phase-grouped step rows in canonical order.
 */
export function selectPipeline(summary: RunSummary): ReadonlyArray<PipelinePhaseSlice> {
  return PHASE_ORDER
    .map(phase => ({
      phase,
      steps: summary.steps.filter(step => step.phase === phase),
    }))
    .filter(slice => slice.steps.length > 0)
}

/** One phase rollup row consumed by the Roadmap panel. */
export interface RoadmapPhaseSlice {
  readonly phase: Phase
  readonly passed: number
  readonly failed: number
  readonly gated: number
  readonly blocked: number
  readonly total: number
}

/**
 * Roll the run's steps up per phase (A→E). The Roadmap panel renders one cell
 * per phase with the four status buckets it labels; `total` backs the per-phase
 * summary line.
 * @param summary - the flattened run summary.
 * @returns one rollup row per canonical phase.
 */
export function selectRoadmap(summary: RunSummary): ReadonlyArray<RoadmapPhaseSlice> {
  return PHASE_ORDER.map((phase) => {
    const steps = summary.steps.filter(step => step.phase === phase)
    return {
      phase,
      passed: steps.filter(step => step.status === 'passed').length,
      failed: steps.filter(step => step.status === 'failed').length,
      gated: steps.filter(step => step.status === 'gated').length,
      blocked: steps.filter(step => step.status === 'blocked').length,
      total: steps.length,
    }
  })
}

/** The adversarial slice consumed by the red-team panel. */
export interface AdversarialSlice {
  /** Steps whose judgment touches trinity component A (adversarial). */
  readonly steps: ReadonlyArray<{
    readonly stepId: string
    readonly index: number
    readonly name: string
    readonly status: StepView['status']
    /** What the step is for, when the host named it: the reader's sentence, not the identifier. */
    readonly purpose?: string
  }>
  /** Component-A gate verdicts recorded on the run. */
  readonly gates: ReadonlyArray<{
    readonly stepId: string
    readonly component: TrinityComponent
    readonly outcome: GateHistoryEntry['outcome']
    readonly rationale: string
  }>
  /**
   * Artifacts produced by the adversarial-touched steps.
   *
   * IT HANDS OVER WHO PRODUCED EACH ONE rather than a sentence about it: this module is locale-free by
   * design (see the file header), so the view supplies the words. The string it used to carry was the
   * one the view composes from the producer's IDENTIFIER (`produced by s05 (attempt 1)`), which put an
   * identifier where a description belongs.
   */
  readonly artifacts: ReadonlyArray<{
    readonly slug: string
    readonly producerStepId: string
    readonly producerAttemptId: number
  }>
  /** Component-A gate-abstention freeze records. */
  readonly abstentions: ReadonlyArray<AbstentionRecord>
}

/**
 * Everything touching judgement component A (the adversarial red team): the
 * steps whose gate history includes an A verdict, the A verdicts themselves,
 * the artifacts those steps produced, and any A-abstention freezes. Never
 * silently collapses an abstention into a failure — the panel shows each freeze.
 * @param summary - the flattened run summary.
 * @returns the focused adversarial review slice.
 */
export function selectAdversarial(summary: RunSummary): AdversarialSlice {
  const adversarialStepIds = new Set(
    summary.steps
      .filter(step => step.gateOutcomes.some(outcome => outcome.component === 'A'))
      .map(step => step.stepId),
  )
  return {
    steps: summary.steps
      .filter(step => adversarialStepIds.has(step.stepId))
      .map(step => ({
        stepId: step.stepId,
        index: step.index,
        name: step.name,
        status: step.status,
        ...(step.purpose === undefined ? {} : { purpose: step.purpose }),
      })),
    gates: summary.gates
      .filter(gate => gate.component === 'A')
      .map(gate => ({
        stepId: gate.stepId,
        component: gate.component,
        outcome: gate.outcome,
        rationale: gate.rationale,
      })),
    artifacts: summary.artifacts
      .filter(artifact => adversarialStepIds.has(artifact.producerStepId))
      .map(artifact => ({
        slug: artifact.slug,
        producerStepId: artifact.producerStepId,
        producerAttemptId: artifact.producerAttemptId,
      })),
    abstentions: summary.abstentions.filter(record => record.component === 'A'),
  }
}

/**
 * Select the run's artifacts of one coarse kind (figure or table), mock-sorted
 * by slug for a stable presentation order. Invalidated rows are kept (the panel
 * renders them struck-through) so rollback state stays visible.
 * @param summary - the flattened run summary.
 * @param kind - the coarse artifact kind to present.
 * @returns the matching artifact rows.
 */
export function selectArtifacts(
  summary: RunSummary,
  kind: ArtifactKind,
): ReadonlyArray<ArtifactView> {
  return summary.artifacts
    .filter(artifact => classifyArtifact(artifact) === kind)
    .sort((a, b) => a.slug.localeCompare(b.slug))
}

/** What a reader of the run on screen should do next. */
export type NextActionKind =
  | 'not-started'
  | 'running'
  | 'awaiting-human'
  | 'blocked'
  | 'failed'
  | 'complete'

/**
 * The checklists the engine's own review runs, as it names them.
 *
 * A CLOSED UNION, so the page cannot render a check name it has no words for: the record's raw
 * identifier is kept inside {@link StepBlocker.evidence} either way, and `'unknown'` is a stated
 * answer rather than a missing one. The engine may gain a check; a page that invented a translation
 * for an identifier it does not know would be describing a question nobody asked.
 */
export type KnownCheckId = 'red-method' | 'red-stat' | 'red-citation' | 'red-claim'

const KNOWN_CHECKS: ReadonlySet<string> = new Set<KnownCheckId>([
  'red-method', 'red-stat', 'red-citation', 'red-claim',
])

/**
 * Why a step's own check refused it.
 *
 * A READER NEEDS THE REASON, NOT THE VERDICT. The word `blocked` on its own is what told a
 * researcher nothing: a real run stopped at `D3-writing` because that step left the reference list
 * empty while the outline declared it, and the page did not even report the refusal — it reported
 * the run as still working. This carries the refusing check and the finding it recorded, so the page
 * can say which question was asked and what the answer was.
 */
export interface StepBlocker {
  /** The judgement component that refused it (the trinity's A, B or C). */
  readonly component: TrinityComponent
  /** The checklist that refused, or `'unknown'` for one this build cannot name. */
  readonly check: KnownCheckId | 'unknown'
  /**
   * The finding, in the shapes this build can restate in the reader's own words.
   *
   * `empty-sections` is the shape that stopped the real run this exists for: a section the outline
   * declares whose body came out empty. Anything this build cannot restate is `other`, and the page
   * then shows the record's own sentence rather than a translation somebody made up. That is the
   * honest split: restating a finding is a claim about what the engine said, and a wrong restatement
   * is worse than the original text.
   */
  readonly finding:
    | { readonly kind: 'empty-sections'; readonly sections: ReadonlyArray<string> }
    | { readonly kind: 'other' }
  /**
   * The record's own words, verbatim.
   *
   * It is what the page shows when {@link StepBlocker.finding} is `other`, and what the reader can
   * always open to check any restatement against its source.
   */
  readonly evidence: string
}

/**
 * The next action, and the counts its sentence needs.
 *
 * A DISCRIMINATED UNION rather than one shape with optional fields: a refusal and a failure are
 * always ABOUT a step, and a page that renders "something was refused" without naming what is a page
 * that sent the reader to look through sixteen rows. The compiler enforces the difference.
 */
export type NextAction =
  | {
    readonly kind: 'not-started' | 'awaiting-human' | 'running' | 'complete'
    readonly pendingCount: number
    /** The step in flight, for `running`, when the projection names one. */
    readonly step?: StepView
  }
  | {
    readonly kind: 'blocked'
    readonly pendingCount: 0
    readonly step: StepView
    /** Absent when the run recorded no refusing verdict for this step. */
    readonly blocker?: StepBlocker
  }
  | {
    readonly kind: 'failed'
    readonly pendingCount: 0
    readonly step: StepView
  }

/** The shape the engine's own review leaves in a refusing gate verdict's evidence string. */
const FAILED_CHECK = /check\(s\) failed:\s*([a-z][a-z-]*)/u

/** The one finding this build restates, as the engine words it. */
const EMPTY_SECTIONS = /sections with an empty body:\s*([^)]+)/u

/**
 * Read a refusing gate verdict into what the page shows.
 *
 * THE RECORD IS A SENTENCE, NOT A STRUCTURE, and this is the cost stated rather than hidden: the
 * engine writes the refusal into `evidence` as prose, so every field here is read back out of that
 * prose. Two regexes, each matching one shape the engine actually emits; anything else keeps the
 * whole sentence and says so, which is why an unrecognised refusal still reaches the reader.
 *
 * @param verdict - the refusing gate history entry.
 * @returns the blocker, with the check named when the record named one.
 */
export function blockerOfVerdict(verdict: GateHistoryEntry): StepBlocker {
  const failed = FAILED_CHECK.exec(verdict.evidence)?.[1]
  const empty = EMPTY_SECTIONS.exec(verdict.evidence)?.[1]
  return {
    component: verdict.component,
    check: failed !== undefined && KNOWN_CHECKS.has(failed) ? failed as KnownCheckId : 'unknown',
    finding: empty === undefined
      ? { kind: 'other' }
      : {
        kind: 'empty-sections',
        sections: empty.split(',').map(section => section.trim()).filter(section => section.length > 0),
      },
    evidence: verdict.evidence,
  }
}

/**
 * What to do next with the run on screen.
 *
 * Ordered by what actually BLOCKS the reader. Demo data outranks everything: while the page shows the
 * bundled snapshot there is no run to act on, whatever states the demo happens to contain. A failed
 * step then outranks the rest — a run that stopped on an error is not one a person can approve.
 *
 * A BLOCKED STEP OUTRANKS A HUMAN WAIT, and this kind did not exist here before. `blocked` was absent
 * from this union, so a run whose step its own check had refused fell through to `running` — the
 * steps after it never ran, so the `pending` count was non-zero — and the page told the researcher
 * the run was still working. That is the one reading this selector must never produce: a refusal is
 * terminal until somebody changes the cause upstream, and a person told to wait for a run that has
 * already stopped waits forever.
 *
 * A human wait then outranks work still in flight, because the run cannot leave the gate without a
 * decision.
 *
 * @param summary - the flattened run summary.
 * @returns the state, the count the copy needs, and the step and blocker it is about when it is.
 */
export function selectNextAction(summary: RunSummary): NextAction {
  if (summary.isMock) return { kind: 'not-started', pendingCount: 0 }
  const failed = summary.steps.find(step => step.status === 'failed' || step.executeError !== undefined)
  if (failed !== undefined) return { kind: 'failed', pendingCount: 0, step: failed }
  const blocked = summary.steps.find(step => step.status === 'blocked')
  if (blocked !== undefined) {
    // THE VERDICT THAT REFUSED IT, not the first one ever recorded: a step driven twice has a
    // verdict per attempt, and the reader needs the one that left it blocked.
    const verdict = summary.gates
      .filter(gate => gate.stepId === blocked.stepId && gate.outcome === 'blocked')
      .at(-1)
    return {
      kind: 'blocked',
      pendingCount: 0,
      step: blocked,
      ...(verdict === undefined ? {} : { blocker: blockerOfVerdict(verdict) }),
    }
  }
  if (summary.humanPending.length > 0) {
    return { kind: 'awaiting-human', pendingCount: summary.humanPending.length }
  }
  if (summary.byStatus.pending > 0 || summary.byStatus.in_progress > 0) {
    // The step actually in flight, when the run says: a reader told only "a run is going" cannot
    // tell which of sixteen steps is taking the time. A run whose projection carries no in-flight
    // step falls back to the count-free sentence the page already had.
    const inFlight = summary.steps.find(step => step.status === 'in_progress')
    return { kind: 'running', pendingCount: 0, ...(inFlight === undefined ? {} : { step: inFlight }) }
  }
  return { kind: 'complete', pendingCount: 0 }
}

/** The recovery snapshot slice consumed by the Recovery panel. */
export interface RecoverySlice {
  readonly runId: string
  readonly status: RunSummary['status']
  readonly totalSteps: number
  readonly artifactCount: number
  readonly validArtifactCount: number
  readonly hasAbstention: boolean
  readonly hasDegradation: boolean
}

/**
 * Describe the run snapshot for the recovery panel: the identifiers the panel
 * shows plus the robustness flags (abstention freeze, degradation) that decide
 * the mock restore notes. Reads whatever `RunSummary` it is given so a
 * local-only "restore" swap re-derives immediately.
 * @param summary - the flattened run summary (current or restored mock).
 * @returns the snapshot descriptor slice.
 */
export function selectRecovery(summary: RunSummary): RecoverySlice {
  return {
    runId: summary.runId,
    status: summary.status,
    totalSteps: summary.totalSteps,
    artifactCount: summary.artifactCount,
    validArtifactCount: summary.validArtifactCount,
    hasAbstention: summary.hasAbstention,
    hasDegradation: summary.hasDegradation,
  }
}

/**
 * What the quality panel shows: the findings, what each check could say, and the questions left to a
 * reviewer.
 *
 * THE COVERAGE IS THE POINT, which is why this slice is not just the findings. An empty finding list
 * is the output of the rules that could read the manuscript, and a panel that rendered the list alone
 * would report "no findings" as "the paper is fine" — while a rule whose input the manuscript does
 * not carry never ran at all. So the panel gets the checks with their outcomes, the questions no rule
 * here answers, and the report's own summary sentence.
 *
 * @param summary - the flattened run summary.
 * @returns the quality slice, or `null` when no package reported one.
 */
export function selectQuality(summary: RunSummary): QualitySlice | null {
  const report = summary.quality
  if (report === undefined) return null
  return {
    summary: summary.qualitySummary ?? report.summary,
    findings: report.findings.map(finding => ({ ...finding })),
    checks: report.checks.map(check => ({ ...check })),
    domainReview: report.needsDomainReview.map(item => ({ ...item })),
  }
}

/** The quality panel's slice: what was found, what could be read, and what a reviewer must judge. */
export interface QualitySlice {
  /** One sentence stating what the report IS — never that the paper is good. */
  readonly summary: string
  readonly findings: ReadonlyArray<{
    readonly code: string
    readonly where: string
    readonly detail: string
    readonly evidence: string
  }>
  readonly checks: ReadonlyArray<{
    readonly code: string
    readonly asks: string
    readonly outcome: string
    readonly reason?: string
  }>
  readonly domainReview: ReadonlyArray<{ readonly id: string; readonly asks: string }>
}
