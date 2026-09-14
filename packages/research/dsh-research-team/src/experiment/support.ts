// @deepseek-ai/dsh-research-team — T24 C-channel experiment adjudication (pure).
//
// `adjudicateClaimSupport` turns a falsifiable prediction + an AUTHORIZED
// experiment report into a ClaimSupportRecord. Only two report sources may
// carry `supportsPrediction`: a mock-fixture lookup (must carry fixtureId) or
// a live host-injected evaluator (must name the evaluator). Raw process
// records (e.g. { exitCode: 0 }) are structurally REJECTED
// (DSH_RESEARCH_TEAM_INVALID_EXPERIMENT) — a program that "ran" is NOT
// evidence. The C outcome is still decided by the CORE `adjudicate`
// (component 'C') — this module never re-implements gate C.

import type {
  AdjudicationInput,
  AdjudicationResult,
  FalsifiablePrediction,
} from '@deepseek-ai/dsh-research-core'
import { adjudicate } from '@deepseek-ai/dsh-research-core'

import { researchTeamError } from '../types.ts'

/**
 * Whether the experiment RAN here or a fixture row answered.
 *
 * `'live'` means the experiment executed locally — NOT the truthfulness level `live_external`,
 * which `registry.ts` defines as "a real external system was reached" and reserves for a
 * deployment that wires a real catalogue. The C channel's own classification is
 * `local_computation`. The word collides; the level never does, and this is the only reading.
 */
export type ExperimentSource = 'live' | 'mock-fixture'
/**
 * How the report was obtained. NOT a level of verification.
 *
 * These were `'live-verified'` / `'mock-verified'`, which read as "externally verified" — and after
 * `live_external` was narrowed in this repository to mean "a real external system was reached", the
 * near-homonym promised something the value cannot carry. The grade is `report.source === 'live'`
 * over a literal the caller writes, so it distinguishes WHICH channel ran and says nothing about
 * whether the result was checked. It is named for that now.
 */
export type EvidenceGrade = 'locally-measured' | 'mock-measured' | 'unverified'
export type ClaimSupportVerdict = 'supported' | 'refuted' | 'undetermined'
export type ClaimSupportOutcome = 'passed' | 'failed' | 'blocked' | 'abstained'

/** An authorized experiment report. `supportsPrediction` only exists here. */
export interface ExperimentReport {
  readonly source: ExperimentSource
  readonly supportsPrediction: boolean
  readonly detail: string
  /**
   * Whether the experiment produced a DECISIVE verdict on the prediction — it ran, it
   * measured the quantity the prediction names, and it either supported or negated it.
   *
   * A decisive negation is a completed test: the claim is recorded as `refuted` and the
   * step advances. Without this the run hard-fails on a negated hypothesis, which would
   * let the pipeline run only studies that were going to succeed.
   */
  readonly decisive?: boolean
  readonly fixtureId?: string
  readonly fixtureVersion?: string
  readonly evaluator?: string
}

export interface ClaimSupportInput {
  readonly claimRef: string
  readonly prediction?: { readonly text: string; readonly ref?: string }
  readonly report?: ExperimentReport
  readonly timestamp: number
}

export interface ClaimSupportRecord {
  readonly claimRef: string
  readonly predictionRef?: string
  readonly verdict: ClaimSupportVerdict
  readonly outcome: ClaimSupportOutcome
  readonly evidenceGrade: EvidenceGrade
  readonly reasonCode: string
  readonly summary: string
  readonly fixtureId?: string
  readonly fixtureVersion?: string
  readonly evidenceRefs: readonly string[]
  readonly timestamp: number
}

function invalidExperiment(detail: string): never {
  researchTeamError('INVALID_EXPERIMENT', detail)
}

function validateReport(report: ExperimentReport): void {
  // `source` is type-checked at compile time ('live' | 'mock-fixture'); runtime
  // callers are typed, so no redundant literal comparison here (lint).
  if (typeof report.supportsPrediction !== 'boolean') {
    invalidExperiment('adjudicateClaimSupport: report.supportsPrediction must be a boolean (raw process records are rejected)')
  }
  if (typeof report.detail !== 'string' || report.detail.trim().length === 0) {
    invalidExperiment('adjudicateClaimSupport: report.detail must be a non-empty string')
  }
  if (report.source === 'mock-fixture' && (typeof report.fixtureId !== 'string' || report.fixtureId.length === 0)) {
    invalidExperiment('adjudicateClaimSupport: mock-fixture report must carry a fixtureId')
  }
  if (report.source === 'live' && (typeof report.evaluator !== 'string' || report.evaluator.length === 0)) {
    invalidExperiment('adjudicateClaimSupport: live report must name its host-injected evaluator')
  }
}

/**
 * Adjudicate one falsifiable prediction against one authorized experiment
 * report. NO DEFAULT PASS: a prediction without a report abstains; a report
 * with no prediction is blocked. Verdicts are "this prediction was supported /
 * refuted / undetermined by this experiment" — never "the claim is true".
 */
export function adjudicateClaimSupport(input: ClaimSupportInput): Readonly<ClaimSupportRecord> {
  const { claimRef, prediction, report, timestamp } = input
  if (typeof claimRef !== 'string' || claimRef.trim().length === 0) {
    invalidExperiment('adjudicateClaimSupport: claimRef must be a non-empty string')
  }
  if (prediction === undefined || typeof prediction.text !== 'string' || prediction.text.trim().length === 0) {
    return {
      claimRef,
      verdict: 'undetermined',
      outcome: 'blocked',
      evidenceGrade: 'unverified',
      reasonCode: 'NO_FALSIFIABLE_PREDICTION',
      summary: 'no falsifiable prediction was provided — nothing to adjudicate (no default pass)',
      evidenceRefs: [],
      timestamp,
    }
  }
  if (report === undefined) {
    return {
      claimRef,
      ...(prediction.ref === undefined ? {} : { predictionRef: prediction.ref }),
      verdict: 'undetermined',
      outcome: 'abstained',
      evidenceGrade: 'unverified',
      reasonCode: 'NO_EXPERIMENT_REPORT',
      summary: 'prediction present but no authorized experiment report — insufficient evidence (no default pass)',
      evidenceRefs: ['falsifiable-prediction'],
      timestamp,
    }
  }

  validateReport(report)

  const falsifiable: FalsifiablePrediction = {
    prediction: prediction.text,
    experimentResult: {
      supportsPrediction: report.supportsPrediction,
      detail: report.detail,
      ...(report.decisive === undefined ? {} : { decisive: report.decisive }),
    },
  }
  const inputA: AdjudicationInput = {
    claimId: claimRef as AdjudicationInput['claimId'],
    component: 'C',
    falsifiable,
    config: {},
    timestamp,
  }
  const result: AdjudicationResult = adjudicate(inputA)
  const grade: EvidenceGrade = report.source === 'live' ? 'locally-measured' : 'mock-measured'

  if (result.outcome === 'passed') {
    // A `passed` C outcome no longer implies the prediction was SUPPORTED: a decisive
    // negation is also `passed`, because the step's question is whether the claim met a
    // falsifiable test this study could run. The verdict is read from the REPORT, not from
    // the outcome, so a refuted prediction can never be published as a supported one.
    const negated = report.supportsPrediction === false
    return {
      claimRef,
      ...(prediction.ref === undefined ? {} : { predictionRef: prediction.ref }),
      verdict: negated ? 'refuted' : 'supported',
      outcome: 'passed',
      evidenceGrade: grade,
      reasonCode: result.reasonCode,
      summary: negated
        ? 'the experiment ran here and NEGATED the falsifiable prediction — the claim is recorded as refuted and the step advances on a decisive test'
        : 'the experiment ran here and supports the falsifiable prediction',
      ...(report.fixtureId === undefined ? {} : { fixtureId: report.fixtureId }),
      ...(report.fixtureVersion === undefined ? {} : { fixtureVersion: report.fixtureVersion }),
      evidenceRefs: result.evidenceRefs,
      timestamp,
    }
  }
  if (result.outcome === 'failed') {
    return {
      claimRef,
      ...(prediction.ref === undefined ? {} : { predictionRef: prediction.ref }),
      verdict: 'refuted',
      outcome: 'failed',
      evidenceGrade: grade,
      reasonCode: result.reasonCode,
      summary:
        'the experiment ran here and refutes the falsifiable prediction, and the caller did not '
        + 'assert the test was decisive — the step does not advance',
      ...(report.fixtureId === undefined ? {} : { fixtureId: report.fixtureId }),
      ...(report.fixtureVersion === undefined ? {} : { fixtureVersion: report.fixtureVersion }),
      evidenceRefs: result.evidenceRefs,
      timestamp,
    }
  }
  // Defensive: given the structural guarantees above the core C adjudicator
  // can only return passed|failed. If a future contract change adds a path,
  // fail loudly instead of silently upgrading an abstention.
  researchTeamError('INVALID_EXPERIMENT', `adjudicateClaimSupport: core returned unexpected outcome '${result.outcome}'`)
}
