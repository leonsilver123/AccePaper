// @deepseek-ai/dsh-research-team — what each manuscript section is written FROM.
//
// THE DEFECT THIS EXISTS TO CLOSE. `D3-writing` handed the model a context of LABELS:
// `{ field, direction, sectionId, claimRef, figureCount, citable }`. The last is a list of float
// labels — "Figure 1", "Table 1" — not the data behind them. Meanwhile the run held the method
// spec, the measured result, the figure plan and the literature records, and none of them reached
// the writer. A faithful model could therefore not write a true Results section: it was asked to
// describe results it was never shown, and the only thing standing between that and an invented
// number was the model's own restraint.
//
// WHAT THIS IS. One pure function from a section id to the evidence that section is written from,
// plus the evidence it cannot be written without. The second half is the enforcement: a section
// whose required evidence is absent is REFUSED rather than filled. `bodyTextFor` — the built-in
// sentence generator — is honest about being a fixture, but the manuscript it produces still reads
// as a complete paper, and a complete-looking paper with an unevidenced Methods section is the
// failure mode this whole pipeline exists to prevent.
//
// WHAT IT IS NOT. A model. It selects and shapes run data; it writes nothing and judges nothing.
// Whether the supplied evidence is enough for a good section is a reviewer's question.

import type { SupportAssessment } from './evidence-corpus.ts'
import { contractFor } from './argument-plan.ts'
import { readResultVersion } from './result-version.ts'

/** The run data one section is written from. */
export interface SectionEvidenceInput {
  /** The quantity the study measures, as the claim binds it. */
  readonly metricKey: string
  readonly metricLabel: string
  /** The unit a section must state beside a value; see `MeasuredMetric.unit`. */
  readonly metricUnit: string
  /** Whether a larger value is better, so a section cannot state a direction the metric denies. */
  readonly metricDirection: 'higher-is-better' | 'lower-is-better'
  /** The run's measured result record, read at `C1-mvp`. */
  readonly result: unknown
  /** The `method-spec` artifact: what the manuscript's Method section must describe. */
  readonly method: unknown
  /** The `figure-plan` artifact: the floats a section may cite. */
  readonly figures: unknown
  /** The `landscape-map` artifact: the records the retrieval returned. */
  readonly landscape: unknown
  /** Every reviewed judgement for this claim version, adjudicated or not. */
  readonly assessments: ReadonlyArray<SupportAssessment>
}

/** One section's evidence, and whether it is enough to write the section at all. */
export interface SectionEvidence {
  readonly sectionId: string
  /** The run data this section is written from, keyed by evidence name. */
  readonly supplied: Readonly<Record<string, unknown>>
  /** The evidence names this section cannot be written without. */
  readonly required: ReadonlyArray<string>
  /** The required names the run does not hold. Non-empty means the section is refused. */
  readonly missing: ReadonlyArray<string>
}

/**
 * A section the outline names but the argument plan does not declare: refuse it rather than guess.
 *
 * The requirements themselves live on the section's CONTRACT (`argument-plan.ts`), beside the
 * obligations they serve — one entry per section rather than two tables that can drift apart. This
 * module reads them and reports what is missing; it does not hold them.
 */
const UNKNOWN_SECTION = { evidence: ['section-definition'] } as const

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

/**
 * The evidence one section is written from, and the evidence it is missing.
 *
 * A name appears in `supplied` only when the run holds a value for it; `missing` is the difference
 * between `required` and what the run holds, in the order the section declares them. An unknown
 * section id is refused rather than written from whatever happens to be present — the outline is
 * the plan's, and a section this table does not know is one whose requirements nobody declared.
 *
 * @param sectionId - the outline's section id.
 * @param input - the run data available to the section.
 * @returns the section's evidence and its missing names.
 */
export function sectionEvidenceFor(sectionId: string, input: SectionEvidenceInput): SectionEvidence {
  const rule = { evidence: contractFor(sectionId)?.evidence ?? UNKNOWN_SECTION.evidence }
  const supplied: Record<string, unknown> = {}

  const claim = { metricKey: input.metricKey, metricLabel: input.metricLabel, direction: input.metricDirection }
  if (input.metricKey !== '') supplied['claim'] = claim

  const record = readResultVersion(input.result)
  if (record !== undefined) {
    supplied['result'] = {
      metricKey: record.metricKey,
      metricLabel: input.metricLabel,
      direction: input.metricDirection,
      // The numbers, with the unit the study declares, so a section cannot state one without the
      // other.
      unit: input.metricUnit,
      baseline: record.measured.baseline,
      variant: record.measured.variant,
      changePct: record.measured.improvementPct,
      // WHATEVER ELSE THIS IMPLEMENTATION MEASURED, spread under its own names: a section that may
      // state the band rate does so because the study reported one, not because this file knows the
      // shipped study's field list.
      ...record.measured.values,
      // WHICH code produced them. A Methods section that names a different version from this one
      // describes an experiment nobody ran, which is what this field is here to make visible.
      ruleVersion: record.ruleVersion,
    }
  }

  const method = asRecord(input.method)
  if (method !== undefined) {
    supplied['method'] = {
      family: method['family'],
      steps: method['steps'],
      implementation: method['implementation'],
      // The family the MODEL declared, kept apart from the one the manuscript states. A reviewer
      // comparing them can see a model that described a different experiment.
      modelDeclaredFamily: method['modelDeclaredFamily'],
    }
  }

  // WHAT RAN, VERSUS WHAT THE METHOD SAYS RAN. The deviation is the whole point of this entry: two
  // artifacts in one run naming different rule versions is a manuscript whose Method section
  // describes code that did not produce its numbers. It needs BOTH halves, so a method spec that
  // names no version leaves the entry absent and the section that requires it is refused — the
  // alternative is a comparison against nothing, which always reads as agreement.
  const implementation = asRecord(method?.['implementation'])
  const declaredVersion = typeof implementation?.['version'] === 'string' ? implementation['version'] : undefined
  if (record !== undefined && declaredVersion !== undefined) {
    supplied['execution'] = {
      ruleVersion: record.ruleVersion,
      methodVersion: declaredVersion,
      matchesMethod: declaredVersion === record.ruleVersion,
    }
  }

  if (record !== undefined) {
    // The accounting a reader needs to judge the numbers: one deterministic integration, no
    // repeats, no field data. A section that omits this invites the reader to assume a sample.
    supplied['accounting'] = {
      runs: 1,
      repeated: false,
      deterministic: true,
      source: record.source,
      fieldData: false,
    }
  }

  const figures = asRecord(input.figures)
  const roster = Array.isArray(figures?.['figures']) ? (figures['figures'] as ReadonlyArray<unknown>) : undefined
  const labels = roster
    ?.map(entry => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== undefined)
    .map(entry => ({ label: entry['label'] ?? entry['title'], kind: entry['kind'] }))
  if (labels !== undefined && labels.length > 0) supplied['figures'] = labels

  const landscape = asRecord(input.landscape)
  const hits = Array.isArray(landscape?.['hits']) ? (landscape['hits'] as ReadonlyArray<unknown>) : undefined
  const records = hits
    ?.map(entry => asRecord(entry))
    .filter((entry): entry is Record<string, unknown> => entry !== undefined)
    .map((entry) => {
      const ref = asRecord(entry['ref'])
      return { title: entry['title'], venue: entry['venue'], identifier: ref?.['id'] ?? null }
    })
  if (records !== undefined && records.length > 0) supplied['records'] = records

  // The reviewed sources, split the way a Discussion needs them: the ones a reviewer found speak
  // for the claim and the ones that do not. A counter-source that never reaches the writer is the
  // same defect as one that never reaches the gate.
  if (input.assessments.length > 0) {
    supplied['reviewed-evidence'] = input.assessments.map(assessment => ({
      doi: assessment.sourceDoi,
      verdict: assessment.verdict,
      rationale: assessment.rationale,
      scope: assessment.scope,
    }))
  }

  const missing = rule.evidence.filter((name: string) => supplied[name] === undefined)
  return { sectionId, supplied, required: rule.evidence, missing }
}
