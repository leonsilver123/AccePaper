// @deepseek-ai/dsh-research-team — where a resumed run picks up.
//
// Split out of the Cordis service entry so it can be tested directly. It had no test file and two
// silent regressions because it lived inside a service that takes six injected services to mount,
// which is a strong incentive not to write the test at all.

import { getRunSnapshot, getStepDefinitions } from '@deepseek-ai/dsh-research-core'
import type { RestoredRun } from '@deepseek-ai/dsh-research-core'

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
