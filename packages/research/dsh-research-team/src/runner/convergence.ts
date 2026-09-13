// @deepseek-ai/dsh-research-team — C2-trinity-loop convergence decision (pure).
//
// C2 is the step where the three adjudication channels of a claim meet:
//
//   A — adversarial convergence (red-team rebuttal + judge vote)
//   B — external anchoring      (citation identity resolved against a resolver)
//   C — falsifiable experiment  (prediction vs an authorized experiment report)
//
// ./verdict.ts produces one core `GateVerdict` per channel and the core gate
// adjudicates each channel on its own. What was missing was the STEP-level
// decision: given those three channel outcomes, has the claim converged far
// enough to leave C2? The C2 executor answered that with a hardcoded
// `'converged (mock dossier)'` — a default pass, exactly what this project
// forbids.
//
// This module is that decision, extracted as a pure function of the channel
// verdicts so that it can be replayed, audited, and unit-tested without a
// pipeline run. It owns no I/O, clock, or randomness: the caller supplies the
// verdicts, the function supplies the state.
//
// Rule order, most severe first; a later rule never overrides an earlier one:
//
//   1. any channel `abstained` → `held`     (an abstention is a withheld pass,
//                                            never a pass)
//   2. any channel `failed`    → `refuted`
//   3. any channel `blocked`, or any of
//      A/B/C without a verdict → `pending`  (an absent verdict is not a pass)
//   4. all three `passed`      → `converged`
//
// That order is the invariant: `converged` is reachable only through rule 4, so
// a missing, withheld, blocked, or refuted channel can never be read as
// convergence. Each rule reports the channel that decided it, in the canonical
// A→B→C order, so the same verdict set yields the same state under any input
// ordering.

/** The three gate components of C2, in canonical reporting order. */
const COMPONENTS = ['A', 'B', 'C'] as const satisfies ReadonlyArray<ChannelVerdict['component']>

/** One trinity channel's adjudication outcome for a C2 gate. */
export interface ChannelVerdict {
  /** Which of the three channels issued this verdict. */
  readonly component: 'A' | 'B' | 'C'
  /**
   * The channel's adjudication outcome. `abstained` is a withheld pass and is
   * never treated as `passed`; `blocked` asks for rework; `failed` refutes.
   */
  readonly outcome: 'passed' | 'blocked' | 'failed' | 'abstained'
}

/** The step-level convergence state of a claim at C2. */
export type ConvergenceState =
  /** Every channel passed; the claim may leave C2. */
  | { readonly kind: 'converged'; readonly basis: string }
  /**
   * Not decidable yet: at least one channel blocked, or at least one of A/B/C
   * issued no verdict. `missing` lists only the channels with no verdict at
   * all; a blocked channel has a verdict and is named in `basis` instead.
   */
  | { readonly kind: 'pending'; readonly missing: ReadonlyArray<string>; readonly basis: string }
  /** A channel refuted the claim; it cannot converge as stated. */
  | { readonly kind: 'refuted'; readonly component: 'A' | 'B' | 'C'; readonly basis: string }
  /** A channel withheld its verdict; the claim is held, not passed. */
  | { readonly kind: 'held'; readonly component: 'A' | 'B' | 'C'; readonly basis: string }

/**
 * Decide the C2 convergence state from the channel verdicts available for the
 * claim. The rules are applied in the severity order documented at the top of
 * this module; the deciding channel is the first one in A→B→C order that
 * satisfies the rule, so duplicates and input order cannot change the result.
 *
 * @param verdicts - the channel verdicts collected for the step. Channels of
 *   the same component may repeat; the most severe outcome among them decides.
 *   An empty or incomplete set is `pending`, never `converged`.
 * @returns the convergence state, with a `basis` string naming the deciding
 *   channels and the rule that fired.
 */
export function evaluateConvergence(verdicts: ReadonlyArray<ChannelVerdict>): ConvergenceState {
  const has = (component: ChannelVerdict['component'], outcome: ChannelVerdict['outcome']): boolean =>
    verdicts.some(v => v.component === component && v.outcome === outcome)

  const heldBy = COMPONENTS.find(component => has(component, 'abstained'))
  if (heldBy !== undefined) {
    return {
      kind: 'held',
      component: heldBy,
      basis: `channel ${heldBy} abstained; a withheld pass is never a pass`,
    }
  }

  const refutedBy = COMPONENTS.find(component => has(component, 'failed'))
  if (refutedBy !== undefined) {
    return {
      kind: 'refuted',
      component: refutedBy,
      basis: `channel ${refutedBy} failed`,
    }
  }

  const blocked = COMPONENTS.filter(component => has(component, 'blocked'))
  const missing = COMPONENTS.filter(component => !verdicts.some(v => v.component === component))
  if (blocked.length > 0 || missing.length > 0) {
    const reasons: string[] = []
    if (blocked.length > 0) reasons.push(`channel(s) ${blocked.join(', ')} blocked (rework required)`)
    if (missing.length > 0) reasons.push(`no verdict for channel(s) ${missing.join(', ')} (absent is not a pass)`)
    return { kind: 'pending', missing, basis: reasons.join('; ') }
  }

  return { kind: 'converged', basis: `channels ${COMPONENTS.join(', ')} all passed` }
}

/* v8 ignore next 3 -- ConvergenceState is closed; every kind is handled above. */
function assertNever(value: never): never {
  throw new Error(`unreachable convergence state: ${JSON.stringify(value)}`)
}

/**
 * Render a convergence state as one auditable line for a dossier or a log.
 *
 * @param state - a state returned by {@link evaluateConvergence}.
 * @returns a single line carrying the state kind and its basis.
 */
export function summarizeConvergence(state: ConvergenceState): string {
  switch (state.kind) {
    case 'converged':
      return `converged: ${state.basis}`
    case 'pending':
      return `pending: ${state.basis}`
    case 'refuted':
      return `refuted: ${state.basis}`
    case 'held':
      return `held: ${state.basis}`
    /* v8 ignore next 2 -- ConvergenceState is closed and every kind is handled above. */
    default:
      return assertNever(state)
  }
}
