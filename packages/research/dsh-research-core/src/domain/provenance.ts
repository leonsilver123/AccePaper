/**
 * Where a value came from, and whether that is enough for the gate it is offered to.
 *
 * The research pipeline mixes six kinds of value in one artifact graph, and they are not
 * interchangeable: a fixture proves the program ran, a simulation can be a legitimate research
 * result, a catalogue record is a real paper, and model text is neither. Before this module the
 * distinction existed only inside producer strings such as `__kind: 'fixture'`, which every
 * consumer had to know how to read, and which nothing enforced. `evidenceProfile` is the one
 * place that decides, so a deployment cannot pass a synthetic anchor to a gate that is meant to
 * certify real evidence.
 *
 * TWO AXES, kept apart because they fail differently:
 *  - `sourceClass` is what the value IS. A fixture in a production gate is a refusal: the
 *    evidence cannot carry the claim at all.
 *  - `sourceAccess` is how much of a source was actually read. A real paper whose abstract was
 *    read but whose full text was not is not refuted evidence — it is evidence still being
 *    gathered, and it holds.
 *
 * Nothing here is a quality ranking, and no class is a claim that the value is correct. A
 * `production` admission says the class may carry a gate, not that it supports the claim; the
 * gate makes that decision from the evidence itself.
 *
 * THREE FURTHER AXES WERE SEPARATED ON 2026-09-18, and this module decides none of them:
 * {@link Provenance.registry} (where a source was read from), {@link Provenance.acquisition} (how its
 * record entered the run) and {@link Provenance.review} (what review it has had). They are separate
 * because each was being inferred from another: "checked into the repository" was being read as
 * "verified", and "read from a live library" as "less trustworthy". Neither inference holds. What a
 * source IS and how much of it was read carry the gate, exactly as before; the other three travel for
 * the audit and for deciding what a review was about.
 */

import type { ReviewStatus, SourceAcquisition, SourceRegistry } from './evidence-binding.ts'

/** What produced a value. The six classes are closed: a producer that fits none of them has no
 *  honest class to declare, and inventing a seventh silently is what this union prevents. */
export type SourceClass =
  | 'fixture'
  | 'simulation'
  | 'imported'
  | 'measured'
  | 'literature'
  | 'model_generated'

/** Every {@link SourceClass}, in the order the vocabulary is documented. */
export const SOURCE_CLASSES: readonly SourceClass[] = [
  'fixture',
  'simulation',
  'imported',
  'measured',
  'literature',
  'model_generated',
]

/**
 * Whether a value is one of the declared source classes.
 *
 * @param value - any value read from an artifact, a config field, or a wire payload.
 * @returns true when the value names a source class.
 */
export function isSourceClass(value: unknown): value is SourceClass {
  return typeof value === 'string' && (SOURCE_CLASSES as ReadonlyArray<string>).includes(value)
}

/**
 * How much of a source was read.
 *
 * `full-text` is the only level at which a source can support a claim about what it says:
 * an abstract states what a paper is roughly about, not what it concludes about this claim.
 * `none` means the source was never reached, and is the honest value for a record known only
 * by its metadata.
 */
export type SourceAccess = 'full-text' | 'abstract-only' | 'metadata-only' | 'none'

/** Every {@link SourceAccess}, most complete first. */
export const SOURCE_ACCESS_LEVELS: readonly SourceAccess[] = [
  'full-text',
  'abstract-only',
  'metadata-only',
  'none',
]

/**
 * Whether a value names a source-access level.
 *
 * @param value - any value read from an artifact, a config field, or a wire payload.
 * @returns true when the value names an access level.
 */
export function isSourceAccess(value: unknown): value is SourceAccess {
  return typeof value === 'string' && (SOURCE_ACCESS_LEVELS as ReadonlyArray<string>).includes(value)
}

/**
 * A producer's own statement about a value it made.
 *
 * `sourceAccess` is absent when the question does not apply — a simulated measurement was not
 * read from anywhere, so stating an access level for it would be noise. It is present, and
 * below `full-text`, for a literature record that was found but not read through.
 */
export interface Provenance {
  readonly sourceClass: SourceClass
  /** What made the value: a module, an adapter, or a person. Free text, for audit. */
  readonly producer: string
  /** The rule or implementation version that produced it, when the producer has one. */
  readonly ruleVersion?: string
  /** How much of the source was read; absent when the value was not read from a source. */
  readonly sourceAccess?: SourceAccess
  /**
   * Which registry the source was read from; absent when the value was not read from one.
   *
   * A REGISTRY, NOT A TRUST LEVEL, and {@link admitAsEvidence} never reads it. Being read from a
   * version-controlled corpus and being read from a running literature library are two ways of
   * obtaining the same kind of thing, and a policy that preferred one would be asserting what nobody
   * checked: a checked-in excerpt is a copy somebody made, and a library entry is what its catalogue
   * says. Both are `literature`, and whether either supports a claim is what the gate decides.
   */
  readonly registry?: SourceRegistry
  /**
   * How the record entered the run; absent when it did not enter from a source.
   *
   * Kept apart from {@link Provenance.registry} because they vary independently and answer different
   * questions: a run's reader needs to know whether the sources were re-read THIS run, and the
   * registry's name does not say that.
   */
  readonly acquisition?: SourceAcquisition
  /**
   * What review the value has had. NOT read by {@link admitAsEvidence} either: a review is a
   * statement about specific content at a specific version, so it travels as an
   * {@link EvidenceBinding} beside the value rather than as a rank on it.
   */
  readonly review?: ReviewStatus
  readonly note?: string
}

/**
 * What a deployment's evidence is allowed to be.
 *
 * `production` admits only classes that may carry a claim into a submission and refuses the rest
 * rather than substituting something that passes. `evaluation` admits everything, because
 * exercising the pipeline is what it is for, and marks its entire output unsubmittable — the
 * permission to run and the permission to publish are separate, and this is where they are kept
 * separate.
 */
export type EvidenceProfile = 'production' | 'evaluation'

/** Every {@link EvidenceProfile}. */
export const EVIDENCE_PROFILES: readonly EvidenceProfile[] = ['production', 'evaluation']

/**
 * Whether a value names an evidence profile.
 *
 * @param value - the value a deployment declared, or any wire value.
 * @returns true when the value names a profile.
 */
export function isEvidenceProfile(value: unknown): value is EvidenceProfile {
  return typeof value === 'string' && (EVIDENCE_PROFILES as ReadonlyArray<string>).includes(value)
}

/**
 * The profile a run has when nobody declared one: the demo run.
 *
 * An undeclared run executes and is stamped unsubmittable, so the permissive default cannot
 * become a published claim — the freedom it grants is the freedom to run, never to submit.
 * `production` is reachable only by stating it, which is what puts a deployment on record as
 * claiming its evidence can carry a submission.
 */
export const DEFAULT_EVIDENCE_PROFILE: EvidenceProfile = 'evaluation'

/** Source classes that may carry a gate under the `production` profile. */
const PRODUCTION_ADMISSIBLE: ReadonlySet<SourceClass> = new Set<SourceClass>([
  'simulation',
  'imported',
  'measured',
  'literature',
])

/** What an admission decided, and why. `pending` is not a softer `refused`: a pending value is
 *  evidence still being gathered, and the correct end for it is a hold that can later be
 *  released, never a block that would report a claim as contradicted. */
export type EvidenceDisposition = 'admitted' | 'pending' | 'refused'

/** Codes an {@link EvidenceAdmission} carries. Stable strings, so a caller branches on the code
 *  and a reader sees the same words in the audit trail as in the source. */
export type EvidenceAdmissionCode =
  | 'DSH_EVIDENCE_ADMITTED'
  | 'DSH_EVIDENCE_PENDING_SOURCE_ACCESS'
  | 'DSH_EVIDENCE_NOT_PRODUCTION_GRADE'

/** The outcome of offering one provenance to one profile. */
export interface EvidenceAdmission {
  readonly disposition: EvidenceDisposition
  readonly code: EvidenceAdmissionCode
  readonly reason: string
}

function admission(
  disposition: EvidenceDisposition,
  code: EvidenceAdmissionCode,
  reason: string,
): EvidenceAdmission {
  return { disposition, code, reason }
}

/**
 * Decide whether one value's provenance may carry a gate under one profile.
 *
 * The checks are ordered so the more fundamental refusal wins: a fixture is refused in
 * `production` whatever its access level says, because "a synthetic record whose text we read"
 * is still synthetic. Only after the class is admitted does access decide between admitted and
 * pending.
 *
 * @param profile - the profile the run declares.
 * @param provenance - the producer's statement about the value.
 * @returns the disposition. `admitted` may carry the gate; `pending` must hold it, because the
 *   evidence is not yet gathered; `refused` must not carry it at all, and the caller reports the
 *   refusal rather than substituting a value that would pass.
 */
export function admitAsEvidence(profile: EvidenceProfile, provenance: Provenance): EvidenceAdmission {
  if (profile === 'evaluation') {
    return admission(
      'admitted',
      'DSH_EVIDENCE_ADMITTED',
      `evaluation profile: '${provenance.sourceClass}' evidence from '${provenance.producer}' is admitted so the`
      + ' pipeline can be exercised; this profile is not submittable',
    )
  }
  if (!PRODUCTION_ADMISSIBLE.has(provenance.sourceClass)) {
    return admission(
      'refused',
      'DSH_EVIDENCE_NOT_PRODUCTION_GRADE',
      `production profile refuses '${provenance.sourceClass}' evidence from '${provenance.producer}':`
      + ` only ${[...PRODUCTION_ADMISSIBLE].join(', ')} may carry a production gate, and a`
      + ` '${provenance.sourceClass}' value shows the program ran without showing the claim is supported`,
    )
  }
  const access = provenance.sourceAccess
  if (access !== undefined && access !== 'full-text') {
    return admission(
      'pending',
      'DSH_EVIDENCE_PENDING_SOURCE_ACCESS',
      `production profile holds '${provenance.producer}' at source access '${access}': the source was`
      + ' located but not read through, so whether it supports the claim is not yet established'
      + ' (full text is the level at which a source says what it concludes about this claim)',
    )
  }
  const accessNote = access === undefined ? '' : ` with source access '${access}'`
  return admission(
    'admitted',
    'DSH_EVIDENCE_ADMITTED',
    `production profile admits '${provenance.sourceClass}' evidence from '${provenance.producer}'${accessNote}`,
  )
}

/** Whether a profile's evidence may EVER carry a submission, and the sentence that says why. */
export interface EvidenceEligibility {
  readonly eligible: boolean
  readonly reason: string
}

/**
 * Whether evidence produced under one profile is eligible to carry a submission at all.
 *
 * ELIGIBILITY, not readiness. It is a property of the PROFILE — what a deployment is on record as
 * claiming about its evidence — and says nothing about any particular run: a production run that
 * stopped at its first step is eligible and nowhere near submittable.
 *
 * This function was named `submittabilityOf` and its field `submittable` until 2026-09-16, and a
 * production run blocked at A1 was exported with `submittable: true`, because the name promised a
 * fact about the run that the function never computed. Whether a RUN is ready is decided from the
 * run's own state (`submissionReadinessOf` in `@deepseek-ai/dsh-research-team`).
 *
 * @param profile - the profile the run declares.
 * @returns the decision and its reason.
 */
export function evidenceEligibilityOf(profile: EvidenceProfile): EvidenceEligibility {
  return profile === 'production'
    ? {
      eligible: true,
      reason: 'production profile: gates are decided from evidence classes that may carry a submission',
    }
    : {
      eligible: false,
      reason:
          'evaluation profile: synthetic evidence is admitted so the pipeline can be exercised, so no'
          + ' output of this run may be submitted',
    }
}
