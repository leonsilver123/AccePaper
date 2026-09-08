/**
 * T19-A P4/P5 E2E — report writer.
 *
 * Produces the deliverables the task requires under `G:\AccePaper-main\.workbuddy\tmp\e2e-out\`:
 *   - `run-snapshot-<scenario>.json` : per-step status / attemptId / artifact slugs / gate
 *     history / audit timeline (one per scenario).
 *   - `e2e-report.md`               : 16-step Real-tool vs Fixture partition table + the two
 *     scenario flows + results.
 *
 * The JSON is emitted ONLY on a green run (the specs call these writers after every assertion
 * passes), so a red test never overwrites a good report. A determinism-comparable projection
 * (timestamp fields stripped) is exported for the happy-path's two-run equality check.
 */

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { GateOutcome, ResearchRunStore, StepStatus, TrinityComponent } from './imports.ts'
import { STEPS, getRunSnapshot } from './imports.ts'
import { REAL_TOOL_STEP } from './runner.ts'

/** Absolute output directory (task-mandated). Forward slashes are fine for Node on Windows. */
export const E2E_OUT_DIR = 'G:/AccePaper-main/.workbuddy/tmp/e2e-out'

/** Known timestamp-ish keys removed for the determinism comparison. */
const TIMESTAMP_KEYS = new Set(['runId', 'ts', 'recordedAt', 'producedAt', 'startedAt', 'finishedAt', 'timestamp', 'durationMs'])

export interface GateVerdictRow {
  readonly component: TrinityComponent
  readonly outcome: GateOutcome
}

export interface StepReportRow {
  readonly index: number
  readonly stepId: string
  readonly phase: string
  readonly name: string
  readonly status: StepStatus
  readonly attemptId: number
  readonly outputs: ReadonlyArray<string>
  readonly gate: ReadonlyArray<TrinityComponent>
  readonly humanGate: boolean
  readonly realTool: boolean
  readonly gateVerdicts: ReadonlyArray<GateVerdictRow>
  readonly auditKinds: ReadonlyArray<string>
}

export interface RunReport {
  readonly scenario: string
  readonly runId: string
  readonly steps: ReadonlyArray<StepReportRow>
}

/** Build a per-step report from the live run snapshot (artifact VALUES excluded — HOLE-4; only slugs). */
export function collectRunReport(store: ResearchRunStore, runId: string, scenario: string): RunReport {
  const snap = getRunSnapshot(store, runId)
  const steps: StepReportRow[] = []
  for (const step of STEPS) {
    const ss = snap.steps[step.id]
    const gateVerdicts: GateVerdictRow[] = step.gate.map((comp) => {
      const v = ss?.gateResults[comp]
      return { component: comp, outcome: (v?.outcome ?? 'pending') }
    })
    const auditKinds = snap.events
      .filter(e => e.stepId === step.id)
      .map(e => e.kind)
    steps.push({
      index: step.index,
      stepId: step.id,
      phase: step.phase,
      name: step.name,
      status: ss?.status ?? 'missing',
      attemptId: ss?.attemptId ?? 0,
      outputs: ss ? Object.keys(ss.artifacts) : [],
      gate: step.gate,
      humanGate: step.humanGate,
      realTool: step.id === REAL_TOOL_STEP,
      gateVerdicts,
      auditKinds,
    })
  }
  return { scenario, runId, steps }
}

/** Recursively drop timestamp/id fields so two runs compare equal. */
export function stripForDeterminism(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripForDeterminism)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (TIMESTAMP_KEYS.has(k)) continue
      out[k] = stripForDeterminism(v)
    }
    return out
  }
  return value
}

function ensureDir(): void {
  mkdirSync(E2E_OUT_DIR, { recursive: true })
}

/** Write `run-snapshot-<scenario>.json`. Returns the absolute path. */
export function writeRunSnapshot(scenario: string, report: RunReport): string {
  ensureDir()
  const path = join(E2E_OUT_DIR, `run-snapshot-${scenario}.json`)
  writeFileSync(path, JSON.stringify(report, null, 2), 'utf8')
  return path
}

/** Write the per-scenario Markdown fragment (`e2e-report-<scenario>.md`). */
export function writeFragment(scenario: string, markdown: string): string {
  ensureDir()
  const path = join(E2E_OUT_DIR, `e2e-report-${scenario}.md`)
  writeFileSync(path, markdown, 'utf8')
  return path
}

/** 16-step Real-tool vs Fixture partition table (shared by the combined report). */
export function partitionTableMarkdown(): string {
  const header = '| # | step | phase | gate | humanGate | engine | label |'
  const sep = '|---|------|-------|------|-----------|--------|-------|'
  const rows = STEPS.map((s) => {
    const engine = s.id === REAL_TOOL_STEP ? 'REAL' : 'FIXTURE'
    const label = s.id === REAL_TOOL_STEP ? 'figure tool (renderFigure, real SVG+PNG)' : 'deterministic synthetic artifact'
    const gate = s.gate.length === 0 ? '∅ (empty)' : s.gate.join('+')
    return `| ${s.index} | ${s.id} | ${s.phase} | ${gate} | ${s.humanGate ? 'yes' : 'no'} | ${engine} | ${label} |`
  })
  return ['### 16-step Real-tool vs Fixture partition', '',
    '> Exactly ONE step (`D1-figure-map`) integrates a REAL tool (the `renderFigure` pure function, producing byte-valid SVG+PNG). All other 15 steps emit deterministic synthetic fixtures explicitly labelled as fixtures and must NOT be mistaken for real science/literature/model output.',
    '', header, sep, ...rows].join('\n')
}

/** Read a fragment (best-effort) for the combined report. */
function readFragment(scenario: string): string {
  const path = join(E2E_OUT_DIR, `e2e-report-${scenario}.md`)
  return existsSync(path) ? readFileSync(path, 'utf8') : `_(fragment for "${scenario}" not found)_`
}

/** Assemble the single `e2e-report.md` from the two scenario fragments + the partition table. */
export function buildCombinedReport(): void {
  ensureDir()
  const parts = [
    '# T19-A P4/P5 — 16-step Mock vertical E2E report',
    '',
    `Generated ${new Date().toISOString()}`,
    '',
    partitionTableMarkdown(),
    '',
    '---',
    '',
    '## E2E-1 Happy Path',
    '',
    readFragment('happy-path'),
    '',
    '---',
    '',
    '## E2E-2 Abstained / Failure / Recovery',
    '',
    readFragment('recovery'),
    '',
  ]
  writeFileSync(join(E2E_OUT_DIR, 'e2e-report.md'), parts.join('\n'), 'utf8')
}
