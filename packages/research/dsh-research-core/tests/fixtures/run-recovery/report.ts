// Process-boundary fixture support: the writer and reader run in separate `node --import
// tsx/esm` processes and hand results back to the spec on stdout. Stdout carries exactly one
// report line, marked by REPORT_SENTINEL, so any other output a loader may print is ignored.

import type { ResearchRunStore } from '../../../src/engine/types.ts'
import { getRunSnapshot } from '../../../src/engine/state-machine.ts'
import { getArtifact } from '../../../src/engine/state-machine.ts'

/** Marks the single line of stdout the spec parses. */
export const REPORT_SENTINEL = '__RUN_RECOVERY_REPORT__'

/** Command-line options as `--name value` pairs. */
export function parseArgs(argv: ReadonlyArray<string>): Record<string, string> {
  const options: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    const value = argv[i + 1]
    if (key === undefined || value === undefined || !key.startsWith('--')) {
      throw new Error(`fixture: arguments must be --name value pairs, got ${argv.join(' ')}`)
    }
    options[key.slice(2)] = value
  }
  return options
}

/** Required option; throws rather than letting a fixture run with a missing path or scenario. */
export function requireArg(options: Record<string, string>, name: string): string {
  const value = options[name]
  if (value === undefined) throw new Error(`fixture: --${name} is required`)
  return value
}

/**
 * The observable state of a run, in a form that is identical for a live run and for the run
 * restored from its snapshot: the read-only run snapshot plus every artifact value.
 */
export interface RunProjection {
  readonly snapshot: ReturnType<typeof getRunSnapshot>
  readonly artifacts: Record<string, unknown>
}

export function projectRun(store: ResearchRunStore, runId: string): RunProjection {
  const snapshot = getRunSnapshot(store, runId)
  const artifacts: Record<string, unknown> = {}
  for (const slug of Object.keys(snapshot.registry)) {
    artifacts[slug] = getArtifact(store, runId, slug)
  }
  return { snapshot, artifacts }
}

/** The stable `code` of a thrown research/snapshot error, for cases the spec expects to fail. */
export function errorInfo(error: unknown): { errorName: string; errorCode: string } {
  const named = error as { name?: unknown; code?: unknown }
  return {
    errorName: typeof named?.name === 'string' ? named.name : typeof error,
    errorCode: typeof named?.code === 'string' ? named.code : 'NO_CODE',
  }
}

/** Print the report line the spec reads. */
export function emitReport(report: Record<string, unknown>): void {
  process.stdout.write(`${REPORT_SENTINEL} ${JSON.stringify(report)}\n`)
}
