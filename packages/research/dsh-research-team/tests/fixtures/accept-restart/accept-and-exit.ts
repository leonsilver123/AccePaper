// @deepseek-ai/dsh-research-team — accept a candidate and let the process end.
//
// THE STATE THIS LEAVES is the one a restart has to be able to read: a run whose manuscript was
// published by a person, written through the accepting transaction and the run's own snapshot. The
// spec that spawns this reads it back from a NEW process, off the DISK, because an acceptance that
// only survives in the memory of the process that made it proves nothing — and the defect this
// fixture exists for was exactly that: the snapshot writer recorded the accepted manuscript, and the
// snapshot READER refused the producer a person publishes under, so the run could not be loaded at
// all once the process holding it was gone.
//
// THE WRITER IS ADDED AFTER THE DRIVE. A deployment with a prose route from the start does not reach
// the human gate — the deterministic route's text does not survive the A/B/C judgments — so the run
// is driven with none, and the route is configured afterwards, exactly as a deployment that switched
// prose on would be. The route writes text with no digits in it, which is what a revision needs to
// pass the `numbers` check: that check rejects a number the run never measured, and the default
// template carries `sha256:<digest>`.
//
// argv: `--dir <snapshot root>`; prints one JSON line describing what it accepted, or exits non-zero.

import { Context } from '@deepseek-ai/cordis'

import ResearchTeamService from '../../../src/index.ts'

/** One `--name value` argument, or a thrown error naming what is missing. */
function argument(args: ReadonlyArray<string>, name: string): string {
  const at = args.indexOf(name)
  const value = at < 0 ? undefined : args[at + 1]
  if (value === undefined) throw new Error(`accept-and-exit: missing ${name}`)
  return value
}

const root = argument(process.argv.slice(2), '--dir')

const ctx = new Context()
for (const name of ['agents', 'sessions', 'sessionPersistence', 'subagents']) ctx.provide(name, {})
ctx.provide('sessionProjections', { register: () => () => {} })
ctx.provide('tools', { guard: () => () => {} })

interface FixtureEngine {
  snapshotDirectory: string
  proseWriter?: {
    readonly channel: 'llm' | 'deterministic'
    write(request: unknown): Promise<{ text: string; provider: string; model: string }>
  }
}
const engine: FixtureEngine = { snapshotDirectory: root }
ctx.provide('research', engine)

await ctx.plugin(ResearchTeamService, {})
interface FixtureService {
  startRun(request: { commandId: string }): Promise<{ runId: string }>
  runSnapshot(request: { runId: string }): Promise<{ execution: string; projectRevision: number } | null>
  requestRevision(request: {
    requestId: string
    runId: string
    stepId: string
    instruction: string
  }): Promise<{ requestId: string; projectRevision: number; manuscriptVersion: number }>
  generateCandidate(request: CandidateRequest): Promise<{ candidates: ReadonlyArray<{ candidateId: string }> }>
  reviewCandidate(request: CandidateRequest): Promise<{
    reviews: ReadonlyArray<{ passed: boolean; findings: ReadonlyArray<{ check: string; passed: boolean }> }>
  }>
  acceptCandidate(request: CandidateRequest & {
    expectedRevision: number
    expectedManuscriptVersion: number
  }): Promise<{ acceptance?: { candidateId: string; revision: number; manuscriptVersion: number } }>
}

/** One operation on an existing request, as the Remote surface takes it. */
interface CandidateRequest {
  readonly runId: string
  readonly requestId: string
  readonly candidateId: string
}

const service = ctx.agentTeams as unknown as FixtureService


const started = await service.startRun({ commandId: 'command-accept-and-exit' })
// THE RUN REACHES ITS OWN REST, which is the human gate: every automatable step closes and E2 waits
// for a person. Nothing here decides anything.
for (;;) {
  const snapshot = await service.runSnapshot({ runId: started.runId })
  if (snapshot === null) throw new Error('accept-and-exit: the run disappeared while it was being driven')
  if (snapshot.execution !== 'running') break
  await new Promise<void>((resolve) => { setImmediate(resolve) })
}

// The prose route arrives now, and writes no digits: the `numbers` check refuses a number nothing in
// the run measured, and this fixture's point is the acceptance, not the writer.
engine.proseWriter = {
  channel: 'deterministic',
  write: () => Promise.resolve({
    text: 'This section is rewritten by the deployment\'s deterministic route; no model was called.',
    provider: 'fixture',
    model: 'fixture',
  }),
}

const request = await service.requestRevision({
  requestId: 'request-accept-and-exit',
  runId: started.runId,
  stepId: 'E2-submit',
  instruction: 'tighten the claim so it matches what was measured',
})
const generated = await service.generateCandidate({
  runId: started.runId, requestId: request.requestId, candidateId: '',
})
const candidateId = generated.candidates[0]?.candidateId ?? ''
if (candidateId === '') throw new Error('accept-and-exit: the deployment minted no candidate id')
const reviewed = await service.reviewCandidate({ runId: started.runId, requestId: request.requestId, candidateId })
const review = reviewed.reviews[0]
if (review === undefined || !review.passed) {
  throw new Error(`accept-and-exit: the candidate did not pass its review: ${JSON.stringify(review?.findings ?? [])}`)
}

const accepted = await service.acceptCandidate({
  runId: started.runId,
  requestId: request.requestId,
  candidateId,
  // THE VERSIONS THE PERSON READ, which is what the acceptance is checked against: the request
  // recorded both when it was made, so a manuscript that moved since then is refused.
  expectedRevision: request.projectRevision,
  expectedManuscriptVersion: request.manuscriptVersion,
})

// WHAT THIS PROCESS BELIEVES IT DID, printed so the spec can compare it with what the NEXT process
// reads off the disk. The acceptance above is durable state or it is nothing.
console.log(JSON.stringify({
  runId: started.runId,
  requestId: request.requestId,
  candidateId,
  acceptance: accepted.acceptance ?? null,
}))
process.exit(0)
