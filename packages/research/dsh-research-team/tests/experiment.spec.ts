// @deepseek-ai/dsh-research-team — T24 experiment adjudication (pure) tests.

import { describe, expect, it } from 'vitest'

import { experimentFixtureKey, lookupExperimentFixture, EXPERIMENT_FIXTURE_RULE_VERSION } from '../src/experiment/fixture.ts'
import { adjudicateClaimSupport } from '../src/experiment/support.ts'
import type { ExperimentReport } from '../src/experiment/support.ts'

function baseInput(overrides?: { claimRef?: string; prediction?: { text: string; ref?: string }; report?: ExperimentReport }) {
  return {
    claimRef: overrides?.claimRef ?? 'mock-claim-001',
    ...(overrides?.prediction === undefined
      ? { prediction: { text: 'peak-hour delay falls by at least 8% under adaptive control' } }
      : overrides.prediction === null
        ? {}
        : { prediction: overrides.prediction }),
    ...(overrides?.report === undefined ? {} : { report: overrides.report }),
    timestamp: 5,
  }
}

describe('adjudicateClaimSupport — C-channel (no default pass)', () => {
  it('blocks (undetermined) when no falsifiable prediction is provided', () => {
    const r = adjudicateClaimSupport({ claimRef: 'mock-claim-001', timestamp: 5 })
    expect(r.verdict).toBe('undetermined')
    expect(r.outcome).toBe('blocked')
    expect(r.evidenceGrade).toBe('unverified')
    expect(r.reasonCode).toBe('NO_FALSIFIABLE_PREDICTION')
  })

  it('abstains (undetermined) when a prediction exists but no experiment report', () => {
    const r = adjudicateClaimSupport(baseInput())
    expect(r.verdict).toBe('undetermined')
    expect(r.outcome).toBe('abstained')
    expect(r.reasonCode).toBe('NO_EXPERIMENT_REPORT')
  })

  it('is supported (mock-verified) when the mock fixture supports the prediction', () => {
    const report: ExperimentReport = {
      source: 'mock-fixture',
      supportsPrediction: true,
      detail: 'synthetic fixture',
      fixtureId: 'mock-claim-001|peak-hour delay falls by at least 8% under adaptive control',
      fixtureVersion: EXPERIMENT_FIXTURE_RULE_VERSION,
    }
    const r = adjudicateClaimSupport(baseInput({ report }))
    expect(r.verdict).toBe('supported')
    expect(r.outcome).toBe('passed')
    expect(r.evidenceGrade).toBe('mock-verified')
    expect(r.fixtureId).toBe(report.fixtureId)
  })

  it('is refuted (mock-verified) when the mock fixture refutes the prediction', () => {
    const report: ExperimentReport = {
      source: 'mock-fixture',
      supportsPrediction: false,
      detail: 'synthetic fixture',
      fixtureId: 'mock-claim-002|greedy re-timing improves throughput in oversaturated grids',
    }
    const r = adjudicateClaimSupport({
      claimRef: 'mock-claim-002',
      prediction: { text: 'greedy re-timing improves throughput in oversaturated grids' },
      report,
      timestamp: 5,
    })
    expect(r.verdict).toBe('refuted')
    expect(r.outcome).toBe('failed')
    expect(r.evidenceGrade).toBe('mock-verified')
  })

  it('is supported (live-verified) on the live path when an evaluator is named', () => {
    const report: ExperimentReport = {
      source: 'live',
      supportsPrediction: true,
      detail: 'evaluated against observation file o-42',
      evaluator: 'host-evaluator/verifier-v1',
    }
    const r = adjudicateClaimSupport(baseInput({ report }))
    expect(r.verdict).toBe('supported')
    expect(r.evidenceGrade).toBe('live-verified')
    expect(r.evaluator).toBeUndefined()
  })

  it('rejects a raw process record (exitCode only) as INVALID_EXPERIMENT', () => {
    const raw = { exitCode: 0, stdout: 'ok' } as unknown as ExperimentReport
    expect(() => adjudicateClaimSupport(baseInput({ report: raw }))).toThrow(/INVALID_EXPERIMENT/)
  })

  it('rejects a live report without an evaluator', () => {
    const report = { source: 'live', supportsPrediction: true, detail: 'd' } as ExperimentReport
    expect(() => adjudicateClaimSupport(baseInput({ report }))).toThrow(/INVALID_EXPERIMENT/)
  })

  it('rejects a mock-fixture report without a fixtureId', () => {
    const report = { source: 'mock-fixture', supportsPrediction: true, detail: 'd' } as ExperimentReport
    expect(() => adjudicateClaimSupport(baseInput({ report }))).toThrow(/INVALID_EXPERIMENT/)
  })

  it('rejects a non-boolean supportsPrediction', () => {
    const report = { source: 'mock-fixture', supportsPrediction: 'yes', detail: 'd', fixtureId: 'f1' } as unknown as ExperimentReport
    expect(() => adjudicateClaimSupport(baseInput({ report }))).toThrow(/INVALID_EXPERIMENT/)
  })

  it('rejects an empty detail', () => {
    const report = { source: 'mock-fixture', supportsPrediction: true, detail: '   ', fixtureId: 'f1' } as ExperimentReport
    expect(() => adjudicateClaimSupport(baseInput({ report }))).toThrow(/INVALID_EXPERIMENT/)
  })

  it('rejects an empty claimRef', () => {
    expect(() => adjudicateClaimSupport({ claimRef: '  ', prediction: { text: 'p' }, report: { source: 'mock-fixture', supportsPrediction: true, detail: 'd', fixtureId: 'f1' }, timestamp: 5 })).toThrow(/INVALID_EXPERIMENT/)
  })
})

describe('experiment fixture lookup', () => {
  it('builds a deterministic key from claim + prediction text', () => {
    expect(experimentFixtureKey('c', 'p')).toBe('c|p')
    expect(experimentFixtureKey('c', 'p', 'r')).toBe('c|r')
  })

  it('hits and misses deterministically', () => {
    expect(lookupExperimentFixture('mock-claim-001|peak-hour delay falls by at least 8% under adaptive control')?.supportsPrediction).toBe(true)
    expect(lookupExperimentFixture('missing|anything')).toBeUndefined()
  })

  it('exposes the rule version', () => {
    expect(EXPERIMENT_FIXTURE_RULE_VERSION).toBe('fixture-mock-v1')
  })
})
