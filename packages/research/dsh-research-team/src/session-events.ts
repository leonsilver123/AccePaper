// @deepseek-ai/dsh-research-team — Session event map augmentation + payload validation.
//
// ADAPTER LAYER (T20). Pure layer types (`types.ts`) deliberately stay host-free:
// the `SessionEventMap` `declare module` augmentation that wires the
// `research/*` whole-value events (member/task/rev/rebuttal) into the core
// session event vocabulary lives HERE (mirroring agent-team `types.ts`). This
// file is also the one runtime validation seam: every payload that reaches the
// durable Lead log — and every payload folded by the host projection — passes
// one of the exported zod schemas below, so a corrupt/legacy payload fails
// loudly at the log boundary instead of silently poisoning the fold.
//
// Event-wire shapes (§2 of the frozen design spec + T21 spec §3):
//   'research/member'    { version: 1; teamId; member }    — whole member snapshot
//   'research/task'      { version: 1; teamId; task }      — whole task snapshot
//   'research/rev'       { version: 1; teamId; rev }       — artifact CAS revision
//   'research/rebuttal'  { version: 1; teamId; rebuttal }  — accepted fleet vote
//
// The core `SessionEventMap[T]` data is the pure event payload (the map key
// already carries the discriminant), so each augmentation entry is the pure
// event Omitted of its `type` field.

import { z } from 'zod'
import type { SessionEvent, SessionEventMap } from '@deepseek-ai/dsh-session'
import { ResearchTeamError, TeamId, sessionId, taskId } from './types.ts'
import type {
  ResearchEvent,
  ResearchMember,
  ResearchMemberEvent,
  ResearchRebuttal,
  ResearchRebuttalEvent,
  ResearchRev,
  ResearchRevEvent,
  ResearchTask,
  ResearchTaskEvent,
} from './types.ts'

/** The research-domain event discriminants injected into `SessionEventMap`. */
export type ResearchEventType =
  | 'research/member'
  | 'research/task'
  | 'research/rev'
  | 'research/rebuttal'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Whole member lifecycle value, stored only in the research Lead Session log. */
    'research/member': Omit<ResearchMemberEvent, 'type'>
    /** Whole task snapshot (revision embedded), stored only in the Lead log. */
    'research/task': Omit<ResearchTaskEvent, 'type'>
    /** Compare-and-set revision record for one shared artifact head. */
    'research/rev': Omit<ResearchRevEvent, 'type'>
    /** One accepted fleet rebuttal vote, recorded only by the research Lead. */
    'research/rebuttal': Omit<ResearchRebuttalEvent, 'type'>
  }
}

// ─────────────────────────── Branded id schemas ────────────────────────────
// zod re-brands raw persisted strings through the same pure brand functions
// the rest of the package uses, so decoded records are interchangeable with
// in-memory domain values.

const teamIdSchema = z.string().min(1).transform(value => TeamId(value))
const sessionIdSchema = z.string().min(1).transform(value => sessionId(value))
const teamTaskIdSchema = z.string().min(1).transform(value => taskId(value))

const nonNegativeIntSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

// ───────────────────────────── Snapshot schemas ────────────────────────────

/** Whole research-member snapshot ({@link ResearchMember}). */
export const researchMemberSnapshotSchema = z.object({
  id: sessionIdSchema,
  name: z.string().min(1),
  description: z.string(),
  provider: z.string().min(1),
  context: z.enum(['fresh', 'fork']),
  phase: z.enum(['provisioning', 'active', 'failed']),
  error: z.string().optional(),
}).strict() as z.ZodType<ResearchMember>

/** Whole research-task snapshot ({@link ResearchTask}). */
export const researchTaskSnapshotSchema = z.object({
  id: teamTaskIdSchema,
  revision: nonNegativeIntSchema,
  subject: z.string(),
  description: z.string(),
  status: z.enum(['pending', 'in_progress', 'completed', 'deleted']),
  ownerId: sessionIdSchema.optional(),
  blockedBy: z.array(teamTaskIdSchema),
  writeScopes: z.array(z.string()),
}).strict() as z.ZodType<ResearchTask>

/** One compare-and-set artifact revision ({@link ResearchRev}). */
export const researchRevSnapshotSchema = z.object({
  artifactId: z.string().min(1),
  revision: nonNegativeIntSchema,
  prevRevision: nonNegativeIntSchema,
  kind: z.enum(['file', 'claim', 'section']),
  path: z.string(),
  hash: z.string().optional(),
}).strict() as z.ZodType<ResearchRev>

/** One accepted fleet rebuttal vote ({@link ResearchRebuttal}). */
export const researchRebuttalSnapshotSchema = z.object({
  roundId: z.string().min(1),
  claimRef: z.string().min(1),
  gate: z.string().min(1),
  voterRole: z.string().min(1),
  voterId: sessionIdSchema,
  position: z.enum(['support', 'refute', 'abstain']),
  rationale: z.string().min(1),
  modelFamily: z.string().optional(),
}).strict() as z.ZodType<ResearchRebuttal>

// ───────────────────────────── Event payload schemas ───────────────────────

const researchMemberEventSchema = z.object({
  version: z.literal(1),
  teamId: teamIdSchema,
  member: researchMemberSnapshotSchema,
}).strict() as z.ZodType<SessionEventMap['research/member']>

const researchTaskEventSchema = z.object({
  version: z.literal(1),
  teamId: teamIdSchema,
  task: researchTaskSnapshotSchema,
}).strict() as z.ZodType<SessionEventMap['research/task']>

const researchRevEventSchema = z.object({
  version: z.literal(1),
  teamId: teamIdSchema,
  rev: researchRevSnapshotSchema,
}).strict() as z.ZodType<SessionEventMap['research/rev']>

const researchRebuttalEventSchema = z.object({
  version: z.literal(1),
  teamId: teamIdSchema,
  rebuttal: researchRebuttalSnapshotSchema,
}).strict() as z.ZodType<SessionEventMap['research/rebuttal']>

/** Schema selected by one research event type (validation + decode). */
const payloadSchemaFor = {
  'research/member': researchMemberEventSchema,
  'research/task': researchTaskEventSchema,
  'research/rev': researchRevEventSchema,
  'research/rebuttal': researchRebuttalEventSchema,
} satisfies Record<ResearchEventType, z.ZodType>

/** Whether one core session event carries a research-domain payload. */
export function isResearchEvent(
  event: SessionEvent,
): event is SessionEvent<ResearchEventType> {
  return event.type === 'research/member'
    || event.type === 'research/task'
    || event.type === 'research/rev'
    || event.type === 'research/rebuttal'
}

/** Decode one persisted research payload, preserving the schema failure as cause. */
function parsePersisted<T>(type: ResearchEventType, schema: z.ZodType<T>, value: unknown): T {
  try {
    return schema.parse(value)
  } catch (error: unknown) {
    throw new ResearchTeamError(
      'DSH_RESEARCH_TEAM_INVALID_EVENT',
      `persisted ${type} payload is invalid`,
      error,
    )
  }
}

/**
 * Bridge one core session event into the pure fold vocabulary. Non-research
 * events return `undefined`; malformed research payloads throw
 * {@link DSH_RESEARCH_TEAM_INVALID_EVENT}.
 */
export function researchEventFromSession(event: SessionEvent): ResearchEvent | undefined {
  if (!isResearchEvent(event)) return undefined
  switch (event.type) {
    case 'research/member': {
      const payload = parsePersisted(event.type, researchMemberEventSchema, event.data)
      return { type: event.type, ...payload }
    }
    case 'research/task': {
      const payload = parsePersisted(event.type, researchTaskEventSchema, event.data)
      return { type: event.type, ...payload }
    }
    case 'research/rev': {
      const payload = parsePersisted(event.type, researchRevEventSchema, event.data)
      return { type: event.type, ...payload }
    }
    case 'research/rebuttal': {
      const payload = parsePersisted(event.type, researchRebuttalEventSchema, event.data)
      return { type: event.type, ...payload }
    }
    // v8 ignore next 2 -- ResearchEventType is closed; every variant handled above.
    default:
      return undefined
  }
}

/**
 * Validate one event payload before it is appended to the durable Lead log.
 * Returns the canonical (re-branded) payload, throwing
 * {@link DSH_RESEARCH_TEAM_INVALID_EVENT} when the payload is malformed.
 */
export function validateResearchEventPayload<T extends ResearchEventType>(
  type: T,
  data: SessionEventMap[T],
): SessionEventMap[T] {
  try {
    return payloadSchemaFor[type].parse(data) as SessionEventMap[T]
  } catch (error: unknown) {
    throw new ResearchTeamError(
      'DSH_RESEARCH_TEAM_INVALID_EVENT',
      `${type} payload is invalid`,
      error,
    )
  }
}
