/**
 * T19-A P4/P5 E2E — gate-verdict fixture strategy (`verdictFactory`).
 *
 * The driver does NOT adjudicate: it only feeds each step's gate components into the
 * core `submitGateVerdict`, which internally calls the singular `_adjudicate`. The verdict
 * VALUES come from an injected `VerdictFactory` so scenarios can drive any outcome
 * (all-pass, or one component abstaining to trigger the `gate_abstained` hold).
 *
 * Every fixture verdict is explicitly labelled `fixture` in its `evidence`/`rationale` so
 * no one mistakes the E2E verdicts for real trinity-gate judgments.
 */

import type { GateOutcome, GateVerdict, TrinityComponent } from '../helpers/imports.ts'
import { FIXED_TS } from './executors.ts'

/** Context a verdict factory receives per (step, component, attempt). */
export interface VerdictContext {
  readonly runId: string
  readonly stepId: string
  readonly component: TrinityComponent
  readonly attemptId: number
}

/** Injected fixture strategy — produces one {@link GateVerdict} per component. */
export type VerdictFactory = (ctx: VerdictContext) => GateVerdict

function verdictOf(component: TrinityComponent, outcome: GateOutcome, note: string): GateVerdict {
  return {
    component,
    outcome,
    passed: outcome === 'passed',
    evidence: `fixture:${note}`,
    rationale: `fixture verdict (${outcome}) for ${component}`,
    timestamp: FIXED_TS,
  }
}

/** All components pass — the happy-path strategy (real trinity adjudication still runs in core). */
export function passedVerdictFactory(): VerdictFactory {
  return ({ component }) => verdictOf(component, 'passed', 'all components pass (fixture)')
}

/** One designated component abstains (evidence insufficient); the rest pass. This drives the
 *  `gate_abstained` hold (`gated` + `holdReason='gate_abstained'` + `gate-abstention` audit). */
export function abstainComponentFactory(target: TrinityComponent, reason: string): VerdictFactory {
  return ({ component }) =>
    component === target
      ? verdictOf(component, 'abstained', `citation evidence insufficient — ${reason}`)
      : verdictOf(component, 'passed', 'pass (fixture)')
}
