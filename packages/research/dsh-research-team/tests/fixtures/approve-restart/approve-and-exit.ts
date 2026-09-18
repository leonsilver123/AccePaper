// @deepseek-ai/dsh-research-team — approve the human gate and let the process end.
//
// WHAT THIS LEAVES is an approval on disk, which the next process has to be able to read as a
// decision that still covers the manuscript it was made about. The two failure modes this guards are
// opposite: an approval that a restart forgets (the gate comes back `gated` and asks again), and one
// that outlives what it approved (a decision that keeps covering a manuscript that has since changed,
// which is the version binding the accepting transaction exists for).
//
// THE DECISION GOES THROUGH `submitApproval`, the same function the browser's endpoint calls. The
// host channel behind it is created on first use and carries this deployment's registered operator,
// so the fixture does not build one: a second creation is refused, which is the channel's own rule.
//
// argv: `--dir <snapshot root> [--profile production|evaluation] [--review-rounds N] [--verify]
//        [--venue-rules-read]`; prints one
// JSON line describing the
// decision, or exits non-zero. The profile is the DEPLOYMENT's, so it is stated here the way a
// `cordis.yml` states it: a run approved under the production profile is one whose material may be
// published, which is the difference between a draft and the package a journal receives.

import { randomUUID } from 'node:crypto'

import { Context } from '@deepseek-ai/cordis'

import ResearchTeamService from '../../../src/index.ts'
import { submitApproval } from '../../../src/approval.ts'

/** One `--name value` argument, or a thrown error naming what is missing. */
function argument(args: ReadonlyArray<string>, name: string): string {
  const at = args.indexOf(name)
  const value = at < 0 ? undefined : args[at + 1]
  if (value === undefined) throw new Error(`approve-and-exit: missing ${name}`)
  return value
}

const root = argument(process.argv.slice(2), '--dir')
/** The evidence profile this deployment runs under; absent means the shipped default. */
const profile = process.argv.includes('--profile')
  ? argument(process.argv.slice(2), '--profile')
  : undefined
/** Whether this fixture should also read the revisions it produced. */
const verify = process.argv.includes('--verify')
/** The number of complete review rounds this deployment requires; absent means the shipped default. */
const reviewRounds = process.argv.includes('--review-rounds')
  ? Number(argument(process.argv.slice(2), '--review-rounds'))
  : undefined
/**
 * The target journal's requirements, when this deployment is stating it READ the guide.
 *
 * THE CONTENT IS THIS FIXTURE'S OWN and every rule says so in its `source`: what is being exercised is
 * a deployment that has read its guide, not what any journal requires. A4 writes the record for a
 * guide nobody read — every requirement marked unknown — and a final package is refused on it.
 */
const journal = process.argv.includes('--venue-rules-read')
  ? {
    id: 'fixture-venue',
    name: 'The fixture stand-in journal',
    rules: [{
      id: 'abstract-length',
      statement: 'a stand-in rule for the abstract, stated by this fixture',
      source: 'this fixture - not a journal',
      accessedAt: '2026-09-18',
      articleType: 'the article type this fixture invents',
      verification: 'verified' as const,
      detail: 'a stand-in, so the case exercises the gate rather than a journal',
    }],
  }
  : undefined

/**
 * A reader that accepts every pending revision, attributed to somebody other than the author.
 *
 * IT READS NOTHING, and its `basis` says so — a stand-in that claimed to have judged the revision
 * would be the failure this fixture exists to avoid. What it demonstrates is the SHAPE: a pending
 * issue is settled by a reader whose name is not the author's.
 */
const standInVerifier = {
  id: 'fixture:reviewer',
  // THE ROLE, THE RULES AND THE ROUTE ARE THE VERIFIER'S TO DECLARE, and the runner refuses a
  // verifier that claims the author's role or the author's rules. What it no longer refuses is a
  // shared MODEL: the host mints the execution and the session, so a single-model deployment is a
  // decision it is allowed to make, recorded as a shared-bias note on every reading.
  role: 'revision-verifier' as const,
  instructionsVersion: 'fixture-revision-review-1',
  route: { provider: 'fixture' },
  verify() {
    return Promise.resolve({
      verdict: 'verified' as const,
      basis: 'accepted by the fixture stand-in; no reading was performed',
      // IT READ NOTHING, AND SAYS SO. A stand-in that claimed to have judged the revision would be
      // the failure this fixture exists to avoid, and a decision on an empty reading is refused — so
      // the fixture names what it looked at, which is the answer it was handed.
      evidenceRead: ['the concern and the answer, as the fixture was given them'],
    })
  },
}

const ctx = new Context()
for (const name of ['agents', 'sessions', 'sessionPersistence', 'subagents']) ctx.provide(name, {})
ctx.provide('sessionProjections', { register: () => () => {} })
ctx.provide('tools', { guard: () => () => {}, register: () => () => {} })
ctx.provide('research', {
  snapshotDirectory: root,
  ...(profile === undefined ? {} : { evidenceProfile: profile }),
  // HOW MUCH REVIEW THIS DEPLOYMENT REQUIRES, stated here because the review is EVALUATED where the
  // rounds are taken — in this process, during D4 — and recorded on the run. An export in a later
  // process reads that record; changing the policy afterwards would be a deployment claiming a
  // reading its run did not take.
  ...(reviewRounds === undefined ? {} : { reviewPolicy: { minimumRounds: reviewRounds } }),
  // A READER FOR THE REVISIONS, when this fixture is asked for one. It answers `verified` to every
  // pending issue and says so: it is a STAND-IN, not a reviewer, and the point of providing it here is
  // that a final package requires the revisions to have been READ — without one, the run leaves its
  // issues waiting and the package stays a draft however the evidence profile reads.
  ...(verify ? { resolutionVerifier: standInVerifier } : {}),
  // THE JOURNAL PROFILE, stated where the RUN is conducted rather than where it is exported: the
  // driver freezes it into the run's spec, and a later process reads what the run recorded rather than
  // re-stating the rules it wants to publish under.
  ...(journal === undefined ? {} : { journal }),
})

await ctx.plugin(ResearchTeamService, {})
const service = ctx.agentTeams as unknown as {
  startRun(request: { commandId: string }): Promise<{ runId: string }>
  runSnapshot(request: { runId: string }): Promise<{
    execution: string
    projectRevision: number
    steps: ReadonlyArray<{ stepId: string; attempt: number; status: string }>
  } | null>
}

const started = await service.startRun({ commandId: 'command-approve-and-exit' })
for (;;) {
  const snapshot = await service.runSnapshot({ runId: started.runId })
  if (snapshot === null) throw new Error('approve-and-exit: the run disappeared while it was being driven')
  if (snapshot.execution !== 'running') break
  await new Promise<void>((resolve) => { setImmediate(resolve) })
}

const before = await service.runSnapshot({ runId: started.runId })
const gate = before?.steps.find(step => step.stepId === 'E2-submit')
if (gate === undefined || gate.status !== 'gated') {
  throw new Error(`approve-and-exit: the human gate is '${gate?.status ?? 'absent'}', not waiting for a person`)
}

// The decision names the revision the reader was looking at, and the attempt they saw pending.
const decided = await submitApproval({
  runId: started.runId,
  stepId: 'E2-submit',
  attempt: gate.attempt,
  decision: 'approved',
  commandId: randomUUID(),
  expectedProjectRevision: before?.projectRevision ?? 0,
})
if (!decided.ok) throw new Error(`approve-and-exit: the decision was refused: ${JSON.stringify(decided)}`)

console.log(JSON.stringify({
  runId: started.runId,
  status: decided.value.status,
  decision: decided.value.decision,
  projectRevision: before?.projectRevision ?? 0,
  persisted: decided.value.persisted,
}))
process.exit(0)
