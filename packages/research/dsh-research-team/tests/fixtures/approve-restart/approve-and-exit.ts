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
// argv: `--dir <snapshot root> [--profile production|evaluation]`; prints one JSON line describing the
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

const ctx = new Context()
for (const name of ['agents', 'sessions', 'sessionPersistence', 'subagents']) ctx.provide(name, {})
ctx.provide('sessionProjections', { register: () => () => {} })
ctx.provide('tools', { guard: () => () => {} })
ctx.provide('research', {
  snapshotDirectory: root,
  ...(profile === undefined ? {} : { evidenceProfile: profile }),
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
