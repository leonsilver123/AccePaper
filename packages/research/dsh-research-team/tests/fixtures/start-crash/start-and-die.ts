// @deepseek-ai/dsh-research-team — start one study and die between its two writes.
//
// THE CRASH THE WRITE ORDER IS FOR. `startRun` writes the command's record before the run it names,
// so a process that dies between those two writes leaves a record naming a run that does not exist.
// That state can only be produced by a REAL process death: the in-process failure path runs the
// compensation (which removes the record), and a crash is exactly what does not.
//
// It dies at the deployment's own seam — the snapshot root is resolved again when the run is about
// to be written, and that resolution is where the process goes away — so nothing here reaches into
// the service's internals.
//
// argv: `--dir <snapshot root> --command <command id>`

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'

import ResearchTeamService from '../../../src/index.ts'

/** One `--name value` argument, or a thrown error naming what is missing. */
function argument(args: ReadonlyArray<string>, name: string): string {
  const at = args.indexOf(name)
  const value = at < 0 ? undefined : args[at + 1]
  if (value === undefined) throw new Error(`start-and-die: missing ${name}`)
  return value
}

const argv = process.argv.slice(2)
const root = argument(argv, '--dir')
const commandId = argument(argv, '--command')
const record = join(root, 'commands', `${commandId}.json`)

const ctx = new Context()
for (const name of ['agents', 'sessions', 'sessionPersistence', 'subagents']) ctx.provide(name, {})
ctx.provide('sessionProjections', { register: () => () => {} })
ctx.provide('tools', { guard: () => () => {}, register: () => () => {} })

const engine: { snapshotDirectory?: string } = {}
Object.defineProperty(engine, 'snapshotDirectory', {
  configurable: true,
  get: () => {
    // THE PROCESS DIES HERE. `startRun` resolves this directory once for the command's record and
    // again for the run's own write, so "the record is already there" is exactly the moment between
    // them — the window a crash between the two writes falls into.
    if (existsSync(record)) process.kill(process.pid, 'SIGKILL')
    return root
  },
})
ctx.provide('research', engine)

await ctx.plugin(ResearchTeamService, {})
const service = ctx.agentTeams as unknown as { startRun(request: { commandId: string }): Promise<unknown> }
await service.startRun({ commandId })

// UNREACHABLE when the seam works: the getter above kills this process before the run is stored. A
// fixture that got here would have produced a run instead of the crash state, and the spec that
// spawns it asserts on the exit code rather than trusting this line.
process.exit(3)
