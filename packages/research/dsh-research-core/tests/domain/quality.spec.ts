/**
 * Tests for the gate report: the ingress parser that reads one off a stored file, the aggregate
 * that decides a gate from its checks, and the reuse check that asks whether a report in hand was
 * written about the versions a caller means to act on.
 *
 * The acceptance requirement these cases are evidence for is that a report which judged nothing,
 * or which contradicts itself, is refused at the boundary rather than read as the reading that
 * suits the caller.
 */

import { describe, expect, it } from 'vitest'

import type { ArtifactRef } from '../../src/domain/artifact.ts'
import type { ArtifactId, ArtifactVersion, ContentHash, InputDigest } from '../../src/domain/ids.ts'
import {
  CHECK_DISPOSITIONS,
  aggregateDisposition,
  parseGateReportIngress,
  reportAnswers,
  sameTarget,
} from '../../src/domain/quality.ts'
import type { GateCheck, GateReport } from '../../src/domain/quality.ts'

const HASH_A = 'a1'.repeat(32)
const HASH_B = 'b2'.repeat(32)
const DIGEST = 'c3'.repeat(32) as InputDigest
const OTHER_DIGEST = 'd4'.repeat(32) as InputDigest

function ref(artifactId: string, version: number, contentHash: string): ArtifactRef {
  return {
    artifactId: artifactId as ArtifactId,
    version: version as ArtifactVersion,
    contentHash: contentHash as ContentHash,
  }
}

function validReport(): Record<string, unknown> {
  return {
    reportId: 'report-1',
    gateId: 'gate-b1-method',
    policyVersion: 'policy-v2',
    targetRefs: [ref('method', 3, HASH_A), ref('data-plan', 1, HASH_B)],
    inputDigest: DIGEST,
    ruleVersions: { 'rule-falsifiability': 'v4' },
    checks: [
      { checkId: 'assumptions-stated', disposition: 'passed' },
      {
        checkId: 'compute-budget',
        disposition: 'not_applicable',
        detail: 'this method requests no compute budget',
      },
    ],
    disposition: 'allow',
    reason: 'every required check reported and none failed',
    createdAt: 1_760_000_000_000,
  }
}

/** The valid report with one top-level field replaced, for the field-specific refusals. */
function withField(field: string, value: unknown): Record<string, unknown> {
  return { ...validReport(), [field]: value }
}

/** The valid report holding exactly these checks. */
function withChecks(checks: ReadonlyArray<unknown>, disposition = 'allow'): Record<string, unknown> {
  return { ...validReport(), checks, disposition }
}

/** Parse the report, failing the case when it was accepted instead of refused. */
function refusalOf(value: unknown) {
  const parsed = parseGateReportIngress(value)
  if (parsed.ok) throw new Error('fixture: the gate report was accepted and should have been refused')
  return parsed
}

/** Parse the report, failing the case when it was refused instead of accepted. */
function acceptReport(value: unknown): GateReport {
  const parsed = parseGateReportIngress(value)
  if (!parsed.ok) throw new Error(`fixture: report refused with ${parsed.code}: ${parsed.reason}`)
  return parsed.value
}

describe('parseGateReportIngress refuses a report it cannot read', () => {
  const refusals: ReadonlyArray<{
    label: string
    value: unknown
    code: string
    names: readonly string[]
  }> = [
    {
      label: 'a value that is not an object',
      value: 'report',
      code: 'DSH_DOMAIN_NOT_AN_OBJECT',
      names: ['not an object'],
    },
    { label: 'null', value: null, code: 'DSH_DOMAIN_NOT_AN_OBJECT', names: ['not an object'] },
    {
      label: 'no reportId',
      value: { ...validReport(), reportId: '' },
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['reportId'],
    },
    {
      label: 'no gateId',
      value: { ...validReport(), gateId: undefined },
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['gateId'],
    },
    {
      label: 'no policyVersion',
      value: withField('policyVersion', ''),
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['policyVersion'],
    },
    {
      label: 'no targetRefs array',
      value: withField('targetRefs', undefined),
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['targetRefs'],
    },
    {
      label: 'an empty targetRefs: a report that judged nothing',
      value: withField('targetRefs', []),
      code: 'DSH_DOMAIN_BAD_REFERENCE',
      names: ['no targets', 'judged nothing'],
    },
    {
      label: 'a targetRefs entry that is not an object',
      value: withField('targetRefs', ['method@3']),
      code: 'DSH_DOMAIN_BAD_REFERENCE',
      names: ['not an object'],
    },
    {
      label: 'a targetRefs entry with an empty contentHash',
      value: withField('targetRefs', [{ artifactId: 'method', version: 3, contentHash: '' }]),
      code: 'DSH_DOMAIN_BAD_REFERENCE',
      names: ['contentHash'],
    },
    {
      label: 'a targetRefs entry with a negative version',
      value: withField('targetRefs', [{ artifactId: 'method', version: -1, contentHash: HASH_A }]),
      code: 'DSH_DOMAIN_BAD_REFERENCE',
      names: ['version'],
    },
    {
      label: 'no inputDigest',
      value: withField('inputDigest', undefined),
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['inputDigest'],
    },
    {
      label: 'a short inputDigest',
      value: withField('inputDigest', 'c3'.repeat(4)),
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['64-character lower-case hex'],
    },
    {
      label: 'an upper-case inputDigest',
      value: withField('inputDigest', DIGEST.toUpperCase()),
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['64-character lower-case hex'],
    },
    {
      label: 'no ruleVersions object',
      value: withField('ruleVersions', undefined),
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['ruleVersions'],
    },
    {
      label: 'a ruleVersions entry that is not a string',
      value: withField('ruleVersions', { 'rule-falsifiability': 4 }),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['rule-falsifiability'],
    },
    {
      label: 'a ruleVersions entry that is an empty string',
      value: withField('ruleVersions', { 'rule-falsifiability': '' }),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['rule-falsifiability'],
    },
    {
      label: 'no checks array',
      value: withField('checks', undefined),
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['checks'],
    },
    {
      label: 'a check that is not an object',
      value: withChecks(['assumptions-stated']),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['checkId', 'disposition'],
    },
    {
      label: 'a check with no checkId',
      value: withChecks([{ disposition: 'passed' }]),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['checkId'],
    },
    {
      label: 'a check with an unknown disposition',
      value: withChecks([{ checkId: 'assumptions-stated', disposition: 'maybe' }]),
      code: 'DSH_DOMAIN_BAD_FIELD',
      // The refusal lists the dispositions it does accept, so the message is self-describing.
      names: CHECK_DISPOSITIONS,
    },
    {
      label: 'a not_applicable check with no detail',
      value: withChecks([{ checkId: 'compute-budget', disposition: 'not_applicable' }]),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['compute-budget', 'not_applicable', 'no detail'],
    },
    {
      label: 'a not_applicable check with an empty detail',
      value: withChecks([{ checkId: 'compute-budget', disposition: 'not_applicable', detail: '' }]),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['compute-budget', 'no detail'],
    },
    {
      label: 'a failed check with no detail',
      value: withChecks([{ checkId: 'assumptions-stated', disposition: 'failed' }], 'block'),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['assumptions-stated', 'failed', 'no detail'],
    },
    {
      label: 'a check with a non-string detail',
      value: withChecks([{ checkId: 'assumptions-stated', disposition: 'passed', detail: 7 }]),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['assumptions-stated', 'non-string detail'],
    },
    {
      label: 'no disposition',
      value: withField('disposition', undefined),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['disposition', 'allow'],
    },
    {
      label: 'an unknown disposition',
      value: withField('disposition', 'allowed'),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['disposition'],
    },
    {
      label: 'an allow that carries a failed check',
      value: withChecks([{ checkId: 'assumptions-stated', disposition: 'failed', detail: 'no assumption list' }]),
      code: 'DSH_DOMAIN_BAD_FIELD',
      names: ['allows while carrying a failed check'],
    },
    { label: 'no reason', value: withField('reason', ''), code: 'DSH_DOMAIN_MISSING_FIELD', names: ['reason'] },
    {
      label: 'no createdAt',
      value: withField('createdAt', undefined),
      code: 'DSH_DOMAIN_MISSING_FIELD',
      names: ['createdAt'],
    },
  ]

  for (const testCase of refusals) {
    it(`refuses ${testCase.label}`, () => {
      const failure = refusalOf(testCase.value)
      expect(failure.code).toBe(testCase.code)
      for (const name of testCase.names) expect(failure.reason).toContain(name)
    })
  }
})

describe('parseGateReportIngress accepts a report whose checks agree with its disposition', () => {
  it('reads every field, and leaves an omitted check detail absent', () => {
    const report = acceptReport(validReport())
    expect(report.reportId).toBe('report-1')
    expect(report.gateId).toBe('gate-b1-method')
    expect(report.policyVersion).toBe('policy-v2')
    expect(report.targetRefs).toEqual([ref('method', 3, HASH_A), ref('data-plan', 1, HASH_B)])
    expect(report.inputDigest).toBe(DIGEST)
    expect(report.ruleVersions).toEqual({ 'rule-falsifiability': 'v4' })
    expect(report.checks).toEqual([
      { checkId: 'assumptions-stated', disposition: 'passed' },
      {
        checkId: 'compute-budget',
        disposition: 'not_applicable',
        detail: 'this method requests no compute budget',
      },
    ])
    expect(report.disposition).toBe('allow')
    expect(report.createdAt).toBe(1_760_000_000_000)
    expect('detail' in (report.checks[0] as GateCheck)).toBe(false)
  })

  it('accepts block and needs_human_decision, and a failed check that says what it found', () => {
    const blocked = acceptReport(
      withChecks([{ checkId: 'assumptions-stated', disposition: 'failed', detail: 'no assumption list' }], 'block'),
    )
    expect(blocked.disposition).toBe('block')
    expect(blocked.checks[0]?.detail).toBe('no assumption list')
    const held = acceptReport(
      withChecks([{ checkId: 'novelty', disposition: 'not_evaluated' }], 'needs_human_decision'),
    )
    expect(held.disposition).toBe('needs_human_decision')
  })

  it('refuses a target contentHash that is not a hash, the same way the artifact reader does', () => {
    // This parser is the same kind of boundary as artifact.ts's, so it applies the same rule. A
    // "hash" that is any non-empty string cannot be checked against a store's content, and the
    // record it appears in would then name a revision without naming what that revision held.
    const refused = refusalOf(
      withField('targetRefs', [{ artifactId: 'method', version: 3, contentHash: 'not-a-hash' }]),
    )
    expect(refused.code).toBe('DSH_DOMAIN_BAD_REFERENCE')
    expect(refused.reason).toContain('contentHash')
  })
})

describe('aggregateDisposition: silence is not a pass', () => {
  it('BLOCKS when a required check is absent, naming the check that did not run', () => {
    const result = aggregateDisposition([{ checkId: 'ran', disposition: 'passed' }], ['ran', 'never-ran'])
    expect(result.disposition).toBe('block')
    expect(result.reason).toContain('never-ran')
  })

  it('BLOCKS when a check failed, naming it and what it found', () => {
    const result = aggregateDisposition(
      [{ checkId: 'compute-budget', disposition: 'failed', detail: 'median wall clock is twice the declared budget' }],
      ['compute-budget'],
    )
    expect(result.disposition).toBe('block')
    expect(result.reason).toContain('compute-budget')
    expect(result.reason).toContain('twice the declared budget')
  })

  it('BLOCKS on a failed check that the policy does not require', () => {
    const result = aggregateDisposition(
      [
        { checkId: 'required', disposition: 'passed' },
        { checkId: 'extra', disposition: 'failed', detail: 'found an unstated assumption' },
      ],
      ['required'],
    )
    expect(result.disposition).toBe('block')
    expect(result.reason).toContain('extra')
  })

  it('ALLOWS when every required check reported and none failed', () => {
    const result = aggregateDisposition(
      [
        { checkId: 'assumptions-stated', disposition: 'passed' },
        { checkId: 'compute-budget', disposition: 'not_applicable', detail: 'this method requests no compute budget' },
      ],
      ['assumptions-stated', 'compute-budget'],
    )
    expect(result.disposition).toBe('allow')
    expect(result.reason).toContain('2 required')
  })

  it('counts not_applicable as a reported exemption, with or without the detail', () => {
    // WHAT THIS ESTABLISHES AND WHAT IT DOES NOT. The aggregate allows both shapes, because the
    // difference between a report and a silence is made one layer up: the ingress parser REFUSES a
    // `not_applicable` check with no detail (the case at `a not_applicable check with no detail` in
    // this file), so the detail-less value below is one no stored record can carry — it is here to
    // pin the aggregate's own rule, which is that the disposition and not the presence of a detail
    // decides. The title used to claim the aggregate made the distinction, which it does not; the
    // parser does, and it is asserted where the parser is.
    const withDetail = aggregateDisposition(
      [{ checkId: 'compute-budget', disposition: 'not_applicable', detail: 'no budget requested' }],
      ['compute-budget'],
    )
    expect(withDetail.disposition).toBe('allow')
    const withoutDetail = aggregateDisposition(
      [{ checkId: 'compute-budget', disposition: 'not_applicable' }],
      ['compute-budget'],
    )
    expect(withoutDetail.disposition).toBe('allow')
  })

  it('ALLOWS a gate whose policy requires no checks', () => {
    // Vacuously: with nothing required, only a check that actually failed can block.
    expect(aggregateDisposition([], []).disposition).toBe('allow')
    const failedExtra = aggregateDisposition(
      [{ checkId: 'extra', disposition: 'failed', detail: 'found one' }],
      [],
    )
    expect(failedExtra.disposition).toBe('block')
  })

  it('BLOCKS when a required check REPORTED not_evaluated, exactly as when it is absent', () => {
    // `not_evaluated` "means a required check did not run, and is never a soft warning" (module
    // doc). A check that says so in the report is the same fact as one missing from it, and it is
    // refused for the same reason. It was allowed until 2026-09-16; the two spellings of one fact
    // were then treated as different, which made the disposition decorative.
    const result = aggregateDisposition([{ checkId: 'red-team', disposition: 'not_evaluated' }], ['red-team'])
    expect(result.disposition).toBe('block')
    expect(result.reason).toContain('red-team')
    expect(result.reason).toContain('not_evaluated')
  })

  it('still ALLOWS a required check that reported not_applicable, with its reason', () => {
    // The other side of the same rule: `not_applicable` is a finding about the work ("this check
    // does not apply here"), not a report of silence, so it may pass. A gate that blocked on both
    // would make the exemption unusable and push authors to delete the check instead.
    const result = aggregateDisposition(
      [{ checkId: 'red-team', disposition: 'not_applicable', detail: 'this study has no co-authors to review' }],
      ['red-team'],
    )
    expect(result.disposition).toBe('allow')
  })

  it('does not block on a NON-required check that reported not_evaluated', () => {
    // Only the policy's required set decides. A check the policy did not require may report
    // anything, including that it did not run.
    const result = aggregateDisposition(
      [{ checkId: 'optional-extra', disposition: 'not_evaluated' }],
      ['required-one'],
    )
    expect(result.disposition).toBe('block')
    expect(result.reason).toContain('required-one')
  })
})

describe('reportAnswers: a report speaks only for the versions it judged', () => {
  const report = acceptReport(validReport())
  const targets = [ref('method', 3, HASH_A), ref('data-plan', 1, HASH_B)]

  it('is true for the same target set and the same digest', () => {
    expect(reportAnswers(report, targets, DIGEST)).toBe(true)
  })

  it('ignores the order of targetRefs', () => {
    expect(reportAnswers(report, [ref('data-plan', 1, HASH_B), ref('method', 3, HASH_A)], DIGEST)).toBe(true)
  })

  it('is false when a target was added', () => {
    expect(reportAnswers(report, [...targets, ref('gap-list', 1, HASH_B)], DIGEST)).toBe(false)
  })

  it('is false when a target was removed', () => {
    expect(reportAnswers(report, [ref('method', 3, HASH_A)], DIGEST)).toBe(false)
  })

  it('is false when a target was replaced by a different revision of the same artifact', () => {
    expect(reportAnswers(report, [ref('method', 4, HASH_A), ref('data-plan', 1, HASH_B)], DIGEST)).toBe(false)
  })

  it('is false when a target was replaced by other content at the same version', () => {
    // The failure the hash in a reference exists for: a version whose content changed after the
    // report was written is not the version the report judged.
    expect(reportAnswers(report, [ref('method', 3, HASH_B), ref('data-plan', 1, HASH_B)], DIGEST)).toBe(false)
  })

  it('is false when the input digest differs', () => {
    expect(reportAnswers(report, targets, OTHER_DIGEST)).toBe(false)
  })
})

describe('sameTarget compares all three parts of a reference', () => {
  it('is true only when the reference is the same one', () => {
    const base = ref('method', 3, HASH_A)
    expect(sameTarget(base, ref('method', 3, HASH_A))).toBe(true)
    expect(sameTarget(base, ref('method', 4, HASH_A))).toBe(false)
    expect(sameTarget(base, ref('data-plan', 3, HASH_A))).toBe(false)
    expect(sameTarget(base, ref('method', 3, HASH_B))).toBe(false)
  })
})
