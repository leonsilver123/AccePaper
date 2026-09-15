/**
 * The gate report: what was checked, against which exact versions, under which rules, and what
 * the checks found.
 *
 * A report is bound to versions in three ways and all three are load-bearing. `targetRefs` says
 * which artifact revisions were judged, `inputDigest` says which inputs the judging attempt read,
 * and `ruleVersions` says which rules did the judging. A report that named none of them could be
 * replayed against a rewritten manuscript, which is the failure this type exists to make
 * impossible: `reportAnswers` is the check a caller runs before reusing one.
 *
 * THREE DISPOSITIONS, NOT TWO. `not_evaluated` means a required check did not run, and is never
 * a soft warning: a check that was never executed has found nothing, and treating its silence as
 * low risk is how a gate reports safety it did not establish. `not_applicable` means the check
 * does not apply to this work and must say why. Only `passed` and `failed` are findings.
 */

import type { ArtifactRef } from './artifact.ts'
import { artifactRefKey, sameArtifactRef } from './artifact.ts'
import type { GateReportId, InputDigest } from './ids.ts'
import { DOMAIN_ERROR_PREFIX } from './ids.ts'
import type { Parsed } from './ingress.ts'
import {
  accept,
  arrayField,
  asRecord,
  countField,
  isContentHash,
  isInputDigest,
  numberField,
  refuse,
  stringField,
} from './ingress.ts'

/** What one check found, or why it did not. */
export type CheckDisposition = 'passed' | 'failed' | 'not_evaluated' | 'not_applicable'

/** Every {@link CheckDisposition}. */
export const CHECK_DISPOSITIONS: readonly CheckDisposition[] = [
  'passed',
  'failed',
  'not_evaluated',
  'not_applicable',
]

/** What a whole report decided. `needs_human_decision` is a reviewer's recorded judgment about a
 *  dispute the rules cannot settle; this module never synthesizes it. */
export type GateDisposition = 'allow' | 'block' | 'needs_human_decision'

/** One check's outcome. */
export interface GateCheck {
  readonly checkId: string
  readonly disposition: CheckDisposition
  /** Required for `not_applicable` (which rule exempts it) and for `failed` (what was found). */
  readonly detail?: string
}

/** One gate's verdict over one set of target versions. */
export interface GateReport {
  readonly reportId: GateReportId
  readonly gateId: string
  readonly policyVersion: string
  readonly targetRefs: ReadonlyArray<ArtifactRef>
  readonly inputDigest: InputDigest
  /** Rule id to its version, for every rule that decided a check. */
  readonly ruleVersions: Readonly<Record<string, string>>
  readonly checks: ReadonlyArray<GateCheck>
  readonly disposition: GateDisposition
  /** Why the disposition is what it is, in one sentence. */
  readonly reason: string
  readonly createdAt: number
}

/** The decision {@link aggregateDisposition} reaches. It never escalates: an escalation is a
 *  reviewer's recorded judgment, and inventing one here would put a human decision in a
 *  deterministic function's mouth. */
export interface GateAggregate {
  readonly disposition: 'allow' | 'block'
  readonly reason: string
}

/**
 * Decide a gate from its checks, requiring every check the policy declares.
 *
 * A required check that is absent is not the same as one that passed, and a check that ran as
 * `not_applicable` is not absent either — it reported, with a reason.
 *
 * `not_evaluated` IS the same as absent, and saying so is the point of this function. A check
 * that reported `not_evaluated` has told the gate it did not run; reading that as anything but a
 * block would make the distinction between the two dispositions decorative, which is the failure
 * the dispositions exist to prevent. `not_applicable` is the one that may pass, because it is a
 * finding about the work ("this check does not apply here") rather than a report of silence.
 *
 * @param checks - the checks that ran.
 * @param requiredCheckIds - the check ids this gate's policy requires.
 * @returns the decision. `allow` requires every required check to have reported a finding, and
 *   none of them to have failed.
 */
export function aggregateDisposition(
  checks: ReadonlyArray<GateCheck>,
  requiredCheckIds: ReadonlyArray<string>,
): GateAggregate {
  const byId = new Map<string, GateCheck>()
  for (const check of checks) byId.set(check.checkId, check)
  const missing = requiredCheckIds.filter(id => !byId.has(id))
  if (missing.length > 0) {
    return {
      disposition: 'block',
      reason: `required check(s) did not run: ${missing.join(', ')} — a check that was never executed has found nothing, and its silence is not a pass`,
    }
  }
  // A required check that REPORTED `not_evaluated` is the same fact as one that is absent, and
  // it is refused for the same reason. It was allowed here until 2026-09-16, which made this
  // function accept a report whose own checks said they had not run.
  const unevaluated = requiredCheckIds.filter(id => byId.get(id)?.disposition === 'not_evaluated')
  if (unevaluated.length > 0) {
    return {
      disposition: 'block',
      reason: `required check(s) reported not_evaluated: ${unevaluated.join(', ')} — a check that did not run has found nothing, whether it is absent from the report or says so in it`,
    }
  }
  const failed = checks.filter(check => check.disposition === 'failed')
  if (failed.length > 0) {
    return {
      disposition: 'block',
      reason: `check(s) failed: ${failed.map(check => `${check.checkId}${check.detail === undefined ? '' : ` (${check.detail})`}`).join('; ')}`,
    }
  }
  return { disposition: 'allow', reason: `every required check reported a finding and none failed (${requiredCheckIds.length} required)` }
}

/**
 * Whether a report was written about exactly these targets, over exactly these inputs.
 *
 * This is the question a caller asks before reusing an old report, and it is deliberately strict:
 * a report about a superset of today's targets is not a report about today's targets, and a report
 * whose inputs have changed cannot speak for the current attempt.
 *
 * @param report - the report in hand.
 * @param targetRefs - the versions the caller means to act on.
 * @param inputDigest - the digest of the inputs the caller's attempt read.
 * @returns true only when the target sets are equal and the digests agree.
 */
export function reportAnswers(
  report: GateReport,
  targetRefs: ReadonlyArray<ArtifactRef>,
  inputDigest: InputDigest,
): boolean {
  if (report.inputDigest !== inputDigest) return false
  if (report.targetRefs.length !== targetRefs.length) return false
  const wanted = new Set(targetRefs.map(artifactRefKey))
  return report.targetRefs.every(ref => wanted.has(artifactRefKey(ref)))
}

/**
 * Whether two references name the same revision, exposed here so a quality check does not have to
 * reach into the artifact module for a comparison it makes on every report.
 *
 * @param a - one reference.
 * @param b - the other.
 * @returns true when they are the same reference.
 */
export function sameTarget(a: ArtifactRef, b: ArtifactRef): boolean {
  return sameArtifactRef(a, b)
}

function parseRefArray(raw: ReadonlyArray<unknown>): Parsed<ArtifactRef[]> {
  const refs: ArtifactRef[] = []
  for (const entry of raw) {
    const record = asRecord(entry)
    if (record === undefined) {
      return refuse(`${DOMAIN_ERROR_PREFIX}BAD_REFERENCE`, 'gate report target reference is not an object')
    }
    const artifactId = stringField(record, 'artifactId')
    const version = countField(record, 'version')
    const contentHash = record['contentHash']
    // The same strictness the artifact reader applies to the same field: a "hash" that is any
    // non-empty string cannot be checked against the store's content, so a report carrying one
    // could not be verified against the revision it names.
    if (artifactId === undefined || version === undefined || !isContentHash(contentHash)) {
      return refuse(
        `${DOMAIN_ERROR_PREFIX}BAD_REFERENCE`,
        'gate report target reference needs a non-empty artifactId, a non-negative integer version, and a 64-character lower-case hex contentHash',
      )
    }
    refs.push({
      artifactId: artifactId as ArtifactRef['artifactId'],
      version: version as ArtifactRef['version'],
      contentHash,
    })
  }
  return accept(refs)
}

/**
 * Read one gate report off an untyped boundary.
 *
 * @param value - the value read from a stored record or a report file.
 * @returns the report, or the refusal naming the first thing wrong with it. A report with no
 *   targets, or one whose checks contradict its disposition, is refused rather than trusted.
 */
export function parseGateReportIngress(value: unknown): Parsed<GateReport> {
  const record = asRecord(value)
  if (record === undefined) {
    return refuse(`${DOMAIN_ERROR_PREFIX}NOT_AN_OBJECT`, 'gate report is not an object')
  }
  const reportId = stringField(record, 'reportId')
  if (reportId === undefined) return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "gate report has no non-empty 'reportId'")
  const gateId = stringField(record, 'gateId')
  if (gateId === undefined) return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "gate report has no non-empty 'gateId'")
  const policyVersion = stringField(record, 'policyVersion')
  if (policyVersion === undefined) return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "gate report has no non-empty 'policyVersion'")
  const rawTargets = arrayField(record, 'targetRefs')
  if (rawTargets === undefined) return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "gate report has no 'targetRefs' array")
  if (rawTargets.length === 0) {
    return refuse(
      `${DOMAIN_ERROR_PREFIX}BAD_REFERENCE`,
      'gate report has no targets: a report that judged nothing cannot say anything about a version',
    )
  }
  const targets = parseRefArray(rawTargets)
  if (!targets.ok) return targets
  const inputDigest = record['inputDigest']
  if (!isInputDigest(inputDigest)) {
    return refuse(
      `${DOMAIN_ERROR_PREFIX}MISSING_FIELD`,
      "gate report has no 64-character lower-case hex 'inputDigest': without it the report cannot be told from one written about other inputs",
    )
  }
  const ruleVersionsRecord = asRecord(record['ruleVersions'])
  if (ruleVersionsRecord === undefined) {
    return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "gate report has no 'ruleVersions' object")
  }
  const ruleVersions: Record<string, string> = {}
  for (const [rule, version] of Object.entries(ruleVersionsRecord)) {
    if (typeof version !== 'string' || version.length === 0) {
      return refuse(`${DOMAIN_ERROR_PREFIX}BAD_FIELD`, `gate report ruleVersions['${rule}'] is not a non-empty version string`)
    }
    ruleVersions[rule] = version
  }
  const rawChecks = arrayField(record, 'checks')
  if (rawChecks === undefined) return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "gate report has no 'checks' array")
  const checks: GateCheck[] = []
  for (const raw of rawChecks) {
    const checkRecord = asRecord(raw)
    const checkId = checkRecord === undefined ? undefined : stringField(checkRecord, 'checkId')
    const disposition = checkRecord === undefined ? undefined : checkRecord['disposition']
    if (checkRecord === undefined || checkId === undefined || typeof disposition !== 'string' || !(CHECK_DISPOSITIONS as ReadonlyArray<string>).includes(disposition)) {
      return refuse(
        `${DOMAIN_ERROR_PREFIX}BAD_FIELD`,
        `a gate report check needs a non-empty checkId and a disposition from ${CHECK_DISPOSITIONS.join(', ')}`,
      )
    }
    const detail = checkRecord['detail']
    if (detail !== undefined && typeof detail !== 'string') {
      return refuse(`${DOMAIN_ERROR_PREFIX}BAD_FIELD`, `gate report check '${checkId}' has a non-string detail`)
    }
    if ((disposition === 'not_applicable' || disposition === 'failed') && (detail === undefined || detail.length === 0)) {
      return refuse(
        `${DOMAIN_ERROR_PREFIX}BAD_FIELD`,
        `gate report check '${checkId}' is '${disposition}' with no detail: an exemption and a failure each have to say what they are`,
      )
    }
    checks.push({ checkId, disposition: disposition as CheckDisposition, ...(detail !== undefined ? { detail } : {}) })
  }
  const disposition = record['disposition']
  if (disposition !== 'allow' && disposition !== 'block' && disposition !== 'needs_human_decision') {
    return refuse(`${DOMAIN_ERROR_PREFIX}BAD_FIELD`, "gate report has no usable 'disposition' (expected allow, block, or needs_human_decision)")
  }
  if (disposition === 'allow' && checks.some(check => check.disposition === 'failed')) {
    return refuse(
      `${DOMAIN_ERROR_PREFIX}BAD_FIELD`,
      'gate report allows while carrying a failed check — a report that contradicts itself is refused rather than read as the reading that suits the caller',
    )
  }
  const reason = stringField(record, 'reason')
  if (reason === undefined) return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "gate report has no non-empty 'reason'")
  const createdAt = numberField(record, 'createdAt')
  if (createdAt === undefined) return refuse(`${DOMAIN_ERROR_PREFIX}MISSING_FIELD`, "gate report has no finite 'createdAt'")
  return accept({
    reportId: reportId as GateReportId,
    gateId,
    policyVersion,
    targetRefs: targets.value,
    inputDigest,
    ruleVersions,
    checks,
    disposition,
    reason,
    createdAt,
  })
}
