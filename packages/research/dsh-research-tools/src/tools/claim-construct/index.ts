// @deepseek-ai/dsh-research-tools — T14 claim-construct tool (research-pipeline
// DAG step A2 "claim构造 gate:A,C → claim").
//
// SCOPE (deliberately narrow): this tool ONLY CONSTRUCTS a claim object. It
// never asserts that the claim is supported by literature — `supportStatus` is
// frozen to the constant 'not_claimed' on every code path, so downstream stages
// can never mistake a constructed claim for a literature-verified one. Support
// is established LATER by the T08/T13 verification flows, never here.
//
// The tool is a pure construction function: no adapter, no IO, no
// state-machine interaction, no resolver/gate deciding literature support.

import { freezeArtifact } from '../../shared.ts'
import type { ToolArtifactMeta } from '../../shared.ts'
import type { ClaimId } from '@deepseek-ai/dsh-research-core'

/** Tool identity carried on every produced artifact's meta. */
export const CLAIM_CONSTRUCT_TOOL_ID = 'claim-construct'

/** Tool-level implementation version of this constructor. */
export const CLAIM_CONSTRUCT_TOOL_VERSION = '1.0.0'

/**
 * Upper bound on a constructed claim assertion's length (characters, after
 * trimming). Chosen as a sane cap that still fits multi-sentence scientific
 * claims without ever hinting at document-scale content.
 */
export const MAX_CLAIM_ASSERTION_LENGTH = 2000

/**
 * Literal frozen on every constructed claim. There is intentionally NO other
 * value this tool can assign — a claim fresh out of the constructor has not
 * been checked against literature.
 */
export const CLAIM_SUPPORT_STATUS_NOT_CLAIMED = 'not_claimed' as const

/** Structured falsifiability scaffold (all three "three questions" optional). */
export interface ClaimFalsifiability {
  /** 本质差异: what substantive difference this claim posits. */
  readonly essentialDifference?: string
  /** 改变何认知: which prior belief/cognition the claim would change. */
  readonly cognitionChange?: string
  /** 何实验证伪: which experiment could falsify the claim. */
  readonly experimentToFalsify?: string
}

export interface ClaimConstructInput {
  /** The claim's assertion (normalized: trimmed). Required, non-empty. */
  readonly assertion: string
  /**
   * Optional caller-supplied id. When omitted, the claimId is derived
   * deterministically from the trimmed assertion (slug + stable hash), so
   * identical inputs always yield the identical claimId.
   */
  readonly claimId?: string
  /** Optional structured falsifiable-prediction scaffold; null/absent allowed. */
  readonly falsifiability?: ClaimFalsifiability | null
  /** Optional free-text note on the construction context. */
  readonly note?: string | null
  /**
   * Explicit timestamp injection for determinism. Defaults to Date.now() when
   * omitted (the only non-deterministic part of the construction).
   */
  readonly now?: number
}

/** The constructed claim. `supportStatus` can only ever be 'not_claimed'. */
export interface ClaimDraft {
  readonly claimId: ClaimId
  /** Normalized (trimmed) assertion text, exactly as validated. */
  readonly assertion: string
  readonly falsifiability: Readonly<ClaimFalsifiability> | null
  /** Frozen literal — this tool NEVER claims literature support. */
  readonly supportStatus: 'not_claimed'
  readonly constructedAt: number
  readonly note?: string
}

export interface ClaimConstructArtifact {
  readonly meta: ToolArtifactMeta
  readonly claim: ClaimDraft
}

/** Brand a plain string as a ClaimId at the construction boundary. */
function asClaimId(id: string): ClaimId {
  return id as ClaimId
}

/** FNV-1a 32-bit — deterministic, dependency-free, pure. */
function stableHash(input: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Best-effort ASCII slug of the assertion; the appended hash stays unique. */
function slugify(input: string): string {
  const deAccented = input.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '')
  const slug = deAccented
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return slug === '' ? 'claim' : slug
}

function assertPlainObject(value: unknown, label: string): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`[${CLAIM_CONSTRUCT_TOOL_ID}] ${label} must be a plain object`)
  }
}

function normalizeFalsifiability(
  falsifiability: ClaimFalsifiability | null | undefined,
): Readonly<ClaimFalsifiability> | null {
  if (falsifiability === undefined || falsifiability === null) return null
  assertPlainObject(falsifiability, 'falsifiability')
  const normalized: ClaimFalsifiability = {
    ...(falsifiability.essentialDifference === undefined
      ? {}
      : { essentialDifference: falsifiability.essentialDifference }),
    ...(falsifiability.cognitionChange === undefined
      ? {}
      : { cognitionChange: falsifiability.cognitionChange }),
    ...(falsifiability.experimentToFalsify === undefined
      ? {}
      : { experimentToFalsify: falsifiability.experimentToFalsify }),
  }
  return Object.freeze(normalized)
}

function resolveClaimId(assertion: string, suppliedClaimId: string | undefined): ClaimId {
  if (suppliedClaimId !== undefined) {
    const trimmed = suppliedClaimId.trim()
    if (trimmed.length === 0) {
      throw new Error(`[${CLAIM_CONSTRUCT_TOOL_ID}] claimId must be a non-empty string when provided`)
    }
    return asClaimId(trimmed)
  }
  return asClaimId(`claim-${slugify(assertion).slice(0, 48)}-${stableHash(assertion)}`)
}

/**
 * Construct a claim object (research-pipeline DAG step A2).
 *
 * Pure: same input (including the injected `now`) always yields the same
 * frozen artifact. The artifact carries `supportStatus: 'not_claimed'` — this
 * constructor NEVER asserts literature support; verification is out of scope.
 */
export function constructClaim(input: ClaimConstructInput): ClaimConstructArtifact {
  if (typeof input !== 'object' || input === null) {
    throw new Error(`[${CLAIM_CONSTRUCT_TOOL_ID}] input must be an object`)
  }
  const assertion = input.assertion.trim()
  if (assertion.length === 0) {
    throw new Error(`[${CLAIM_CONSTRUCT_TOOL_ID}] assertion must be a non-empty string`)
  }
  if (assertion.length > MAX_CLAIM_ASSERTION_LENGTH) {
    throw new Error(
      `[${CLAIM_CONSTRUCT_TOOL_ID}] assertion exceeds ${MAX_CLAIM_ASSERTION_LENGTH} characters`,
    )
  }
  const falsifiability = normalizeFalsifiability(input.falsifiability)
  const note = input.note === undefined || input.note === null ? undefined : input.note
  const constructedAt = input.now ?? Date.now()

  const draft: ClaimDraft = {
    claimId: resolveClaimId(assertion, input.claimId),
    assertion,
    falsifiability,
    supportStatus: CLAIM_SUPPORT_STATUS_NOT_CLAIMED,
    constructedAt,
    ...(note === undefined ? {} : { note }),
  }

  const artifact: ClaimConstructArtifact = {
    meta: {
      toolId: CLAIM_CONSTRUCT_TOOL_ID,
      version: CLAIM_CONSTRUCT_TOOL_VERSION,
      producedAt: constructedAt,
    },
    claim: draft,
  }
  return freezeArtifact<ClaimConstructArtifact>(artifact)
}

/** Alias of {@link constructClaim} (T14 step entry-point naming). */
export const runClaimConstruct = constructClaim
