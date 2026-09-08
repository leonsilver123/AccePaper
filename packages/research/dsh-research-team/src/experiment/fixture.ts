// @deepseek-ai/dsh-research-team — T24 experiment fixture (pure, mock-only).
//
// Deterministic mock lookup for the C-channel experiment adjudicator. Real
// experiments are NOT wired (no code-runtime / no real data) — this table is
// the ONLY allowed source of `supportsPrediction` on the mock path, and its
// verdicts are explicitly graded `mock-verified`. They are for internal
// adversarial self-checks and CI only; they must NEVER be presented as real
// experimental support (evidenceGrade stays 'mock-verified'; downstream
// adapters must block mock-only passes at the manuscript/finalization face).

export const EXPERIMENT_FIXTURE_RULE_VERSION = 'fixture-mock-v1'

export interface ExperimentFixtureOutcome {
  readonly supportsPrediction: boolean
  readonly detail: string
}

/** Deterministic mock key: `${claimRef}|${predictionRef ?? predictionText}`. */
export function experimentFixtureKey(claimRef: string, predictionText: string, predictionRef?: string): string {
  return `${claimRef}|${predictionRef ?? predictionText}`
}

// Synthetic example entries (explicitly synthetic — never real scientific
// support). Rehearses keep/refute/abstain(miss) paths for the framework.
const FIXTURE_TABLE: ReadonlyMap<string, ExperimentFixtureOutcome> = new Map([
  // keep path: the (synthetic) experiment supports the (synthetic) prediction.
  ['mock-claim-001|peak-hour delay falls by at least 8% under adaptive control', {
    supportsPrediction: true,
    detail: 'synthetic fixture: simulated signal plan shows 9.1% mean delay reduction (mock, not real data)',
  }],
  // refute path.
  ['mock-claim-002|greedy re-timing improves throughput in oversaturated grids', {
    supportsPrediction: false,
    detail: 'synthetic fixture: grid simulation shows 0.4% throughput change (mock, not real data)',
  }],
])

/** Deterministic mock lookup; undefined = no report = fail-closed (abstain). */
export function lookupExperimentFixture(key: string): ExperimentFixtureOutcome | undefined {
  return FIXTURE_TABLE.get(key)
}

export { FIXTURE_TABLE }
