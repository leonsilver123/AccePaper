// @deepseek-ai/dsh-research-team — where a resumed run picks up.
//
// Split out of the Cordis service entry so it can be tested directly. It had no test file and two
// silent regressions because it lived inside a service that takes six injected services to mount,
// which is a strong incentive not to write the test at all.

import { getRunSnapshot, getStepDefinitions } from '@deepseek-ai/dsh-research-core'
import type { RestoredRun, StepStatus } from '@deepseek-ai/dsh-research-core'

import type { ClaimMaterial } from './redteam-review.ts'
import { commitmentFrom } from './prediction-gate.ts'
import type { PredictionCommitment } from './prediction-gate.ts'

/**
 * The first step of a restored run that is not in a terminal state.
 *
 * A resumed run picks up here: the steps before it are settled, and re-driving one would either
 * be refused by the engine's own guards or repeat work the snapshot already records as done.
 *
 * `gated` means two different things and only one of them is settled:
 *   - E2's HUMAN GATE awaits a person. A resume cannot drive it and must not try.
 *   - an ABSTAINED HOLD on any other step is not settled at all. Core documents exactly one
 *     release for it (`DSH_ABSTENTION_REQUIRES_ROLLBACK`: rollback, then a new attempt), so a
 *     resume is the only way such a run ever moves again — and treating it as done made the
 *     abstained run, which is this system's most honest outcome, the one run recovery could
 *     never touch. It reported that as "every step is terminal" while fourteen steps had no
 *     recorded state at all.
 *
 * @param restored - the restored run and the facts about its interrupted steps.
 * @returns the step id to resume from.
 * @throws {Error} when every step the run has recorded is settled, naming what it found.
 */
export function firstNonTerminalStep(restored: RestoredRun): string {
  const state = getRunSnapshot(restored.store, restored.runId).steps
  const recorded: string[] = []
  for (const step of getStepDefinitions()) {
    const current = state[step.id]
    // A step with NO record has not run, and the steps run in this order — so it is the resume
    // point. Skipping it made the most resumable state there is (a settled prefix and an
    // unstarted remainder) report "no step left to resume", which is what a snapshot taken
    // mid-drive looks like.
    if (current === undefined) return step.id
    recorded.push(`${step.id}=${current.status}`)
    if (current.status === 'passed') continue
    // A held abstention is resumable; the human gate is not. `humanGate` comes from core, so the
    // distinction is the engine's, not a list of step ids kept here.
    if (current.status === 'gated') {
      if (!step.humanGate) return step.id
      continue
    }
    return step.id
  }
  throw new Error(
    `[research] run ${restored.runId} has no step left to resume — every recorded step is settled `
    + `(${recorded.join(', ') || 'no step has a recorded state'})`,
  )
}

/**
 * Whether a step the selector returned must be rolled back before it is driven again.
 *
 * THE INVARIANT. `firstNonTerminalStep` returns a step that is neither `passed` nor a held human
 * gate, and `driveRemaining` starts it with `startStep`, which accepts ONLY a `pending` step. So
 * every step the selector can return must be released back to `pending` first, and the condition
 * that decides this has to agree with the selector — not merely overlap with it.
 *
 * It did not agree. The release condition listed `failed`, `blocked` and `gated` and omitted
 * `in_progress`, which is exactly the state a step is left in when its EXECUTOR throws — a model
 * writer error or a tool timeout, the most ordinary interruptions there are. An independent audit
 * reproduced it by failing the C1 executor: the selector returned C1-mvp, the release condition
 * declined it, and `startStep` refused with "its status is 'in_progress', and only a 'pending'
 * step can start". The run was permanently stuck, and the error it reported was an engine error
 * rather than a recovery outcome.
 *
 * `pending` is the one status that needs no release — the step is already where `startStep` wants
 * it — so anything else the selector returns must be rolled back. That is the whole rule, and
 * stating it as "not pending" rather than as a list is what keeps it from drifting out of step
 * with the selector again: a new status added to the engine falls on the releasing side by
 * default, which is the side that lets a run recover.
 *
 * @param status - the status of the step the selector returned.
 * @returns true when the step must be rolled back before it is driven again.
 */
export function needsReleaseBeforeResume(status: StepStatus): boolean {
  return status !== 'pending'
}

/** Read a plain record, or undefined for anything else. */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

/**
 * Rebuild the claim material a resumed run reviews, from the run's OWN records.
 *
 * THE RULE, and it is the same one the study is restored by: read the run's PERSISTED INPUTS and
 * its own ARTIFACTS, never the deployment's current configuration and never a path the value does
 * not live at. Both halves of that rule were broken here and both were found by audit rather than
 * by reading:
 *   - `essentialDifference`, `experimentToFalsify` and `truthfulness` were read off the `claim`
 *     artifact at paths it does not have (they are under `claim.falsifiability` and the
 *     prediction's `claimRoute`), so they were permanently empty and the resumed review reported
 *     five things about a claim that were false;
 *   - `scope`, `dataSource` and `declaredSources` were left empty under a comment claiming they
 *     were "not on disk to restore", which was false — they are in
 *     `inputs['case-pack-claim']`, beside the scenario.
 * Neither was visible by inspection. This function exists so a spec can compare the rebuild against
 * the material the run was actually given, which is what would have caught both immediately.
 *
 * Every field names where it comes from. A field that is genuinely absent stays empty and the
 * review then reports a GAP — and a gap is not evidence about the claim.
 *
 * @param inputs - the run's persisted inputs, as `getRunSnapshot(store, runId).inputs`.
 * @param claim - the run's `claim` artifact.
 * @param prediction - the run's `falsifiable-prediction` artifact.
 * @param metricKey - the quantity the run's claim declared.
 * @returns the material, field for field.
 */
export function materialFromRun(
  inputs: Readonly<Record<string, unknown>>,
  claim: unknown,
  prediction: unknown,
  metricKey: string,
): ClaimMaterial {
  const pack = asRecord(inputs['case-pack-claim'])
  const claimRecord = asRecord(claim)
  const predictionRecord = asRecord(prediction)
  const falsifiability = asRecord(claimRecord?.['falsifiability'])
  const route = asRecord(predictionRecord?.['claimRoute'])
  const text = (value: unknown): string => (typeof value === 'string' ? value : '')
  return {
    // From the pack's claim block, which is a run INPUT.
    assertion: text(claimRecord?.['assertion']),
    scope: text(pack?.['scope']),
    dataSource: text(pack?.['dataSource']),
    declaredSources: Array.isArray(pack?.['declaredSources'])
      ? (pack['declaredSources'] as ReadonlyArray<string>)
      : [],
    // From the artifacts the run wrote.
    prediction: text(predictionRecord?.['text']),
    experimentToFalsify: text(falsifiability?.['experimentToFalsify']),
    essentialDifference: text(falsifiability?.['essentialDifference']),
    metricKey,
    truthfulness: text(route?.['truthfulness']),
    measuredMetricKey: text(predictionRecord?.['measuredMetricKey']),
  }
}

/** The material with its declared commitment, when the claim artifact carries a valid one. */
export function materialWithCommitment(
  inputs: Readonly<Record<string, unknown>>,
  claim: unknown,
  prediction: unknown,
  metricKey: string,
): { readonly material: ClaimMaterial; readonly commitment: PredictionCommitment | undefined } {
  const material = materialFromRun(inputs, claim, prediction, metricKey)
  const commitment = commitmentFrom(asRecord(claim)?.['commitment'])
  return {
    material: commitment === undefined ? material : { ...material, commitment },
    commitment,
  }
}
