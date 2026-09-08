// @deepseek-ai/dsh-research-team — T19-B E2E reporting.
//
// Writes the runner's auditable outputs to `.workbuddy/tmp/e2e-out-t19b/` (outside
// the version-controlled tree):
//   - run-snapshot-{happy,recovery}.json  (machine-readable StepOutcome[] + audit)
//   - e2e-report-t19b-{happy,recovery}.md (human-readable run summary)
//   - t19a-vs-t19b.md                     (T19-A vs T19-B comparison)
//
// TRUTHFULNESS DISCIPLINE (frozen): the report uses the 4-level vocabulary and
// never upgrades a level in prose.
//   - `real_tool_fixture_input` = the real tool FUNCTION ran; its INPUT was a
//     synthetic fixture. This is NOT real scientific verification and the report
//     must never describe it as such.
//   - `fixture_executor`        = the whole executor is a fixture.
//   - `mock_external`           = real adaptation logic over a SIMULATED external
//     system (the B gate channel).
//   - `live_external`           = a real external system. MUST be 0 this wave.
//
// Every non-fixture step is reported with its producer + per-artifact
// `__producer` evidence so a reviewer can verify from the report alone which
// executor actually ran — no claim rests on the registry's existence.

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { STEP_EXECUTOR_REGISTRY, TRUTHFULNESS_LEVELS, VERDICT_CHANNELS } from './registry.ts'
import type { Truthfulness } from './registry.ts'
import type { RunResult, StepOutcome } from './types.ts'

const DEFAULT_OUT_DIR = '.workbuddy/tmp/e2e-out-t19b'

function outDirOf(override?: string): string {
  return override ? resolve(override) : resolve(process.cwd(), DEFAULT_OUT_DIR)
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true })
}

/** T19-A baseline facts (from the frozen T19-A e2e: 1 real tool + 15 fixtures). */
const T19A = {
  realToolCount: 1,
  realToolSteps: ['D1-figure-map'] as ReadonlyArray<string>,
  fixtureCount: 15,
  mockExternalCount: 0,
  note:
    'T19-A: exactly 1 real tool call (renderFigure on D1-figure-map) + 15 deterministic ' +
    'fixture executors; all gate verdicts are fixture-labelled; E2-submit stops gated.',
} as const

/** Per-level step counts for one run (4-level vocabulary + the E2 human gate). */
export interface KindCounts {
  readonly real_tool_fixture_input: number
  readonly fixture_executor: number
  readonly mock_external: number
  readonly live_external: number
  readonly humanGate: number
}

export function countKinds(steps: ReadonlyArray<StepOutcome>): KindCounts {
  const counts: Record<string, number> = {
    real_tool_fixture_input: 0,
    fixture_executor: 0,
    mock_external: 0,
    live_external: 0,
    humanGate: 0,
  }
  for (const s of steps) {
    counts[s.kind] = (counts[s.kind] ?? 0) + 1
  }
  return counts as unknown as KindCounts
}

/** Steps whose executor is `real_tool_fixture_input`, with the tool that ran. */
export function realToolSteps(steps: ReadonlyArray<StepOutcome>): ReadonlyArray<StepOutcome> {
  return steps.filter(s => s.kind === 'real_tool_fixture_input')
}

function stepTableMarkdown(steps: ReadonlyArray<StepOutcome>): string {
  const rows = steps
    .map((s) => {
      const produced = s.artifacts.map(a => `${a.slug}←${a.producedBy}`).join('; ')
      const verdicts = Object.entries(s.verdicts)
        .map(([c, o]) => `${c}:${o}`)
        .join(' ')
      const entry = STEP_EXECUTOR_REGISTRY.get(s.stepId)
      const gate = entry?.gateRequirement.humanGate === true
        ? 'human'
        : (entry?.gateRequirement.components.join('+') || '—')
      return `| ${s.stepId} | ${s.kind} | ${s.producer} | ${gate} | ${s.status} | ${produced || '—'} | ${verdicts || '—'} |`
    })
    .join('\n')
  return [
    '| step | truthfulness | producer | gate | status | artifact evidence (`__producer`) | verdicts |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    rows,
  ].join('\n')
}

/** Registry declaration table (stepId → every registered field). */
export function registryTableMarkdown(): string {
  const rows: string[] = []
  for (const entry of STEP_EXECUTOR_REGISTRY.values()) {
    const inputs = entry.inputSchema.map(i => `${i.slug}(${i.source})`).join('; ') || '—'
    const outputs = entry.outputSchema.map(o => `${o.slug}:${o.artifactType}`).join('; ') || '—'
    rows.push(
      `| ${entry.stepId} | ${entry.kind} | ${entry.producer} | ${inputs} | ${outputs} | ` +
        `${entry.timeoutMs} | ${entry.gateRequirement.description} | ${entry.recoveryPolicy} |`,
    )
  }
  return [
    '| step | truthfulness | producer | input schema | output schema : artifact type | timeout(ms) | gate requirement | recovery policy |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    rows.join('\n'),
  ].join('\n')
}

/** Per-step classification basis (why each step carries its truthfulness level). */
export function basisListMarkdown(): string {
  const lines: string[] = []
  for (const entry of STEP_EXECUTOR_REGISTRY.values()) {
    lines.push(`- **${entry.stepId}** (\`${entry.kind}\`): ${entry.basis}`)
  }
  return lines.join('\n')
}

function truthfulnessLegend(): string {
  return [
    '| level | meaning |',
    '| --- | --- |',
    '| `real_tool_fixture_input` | the REAL tool function executed; its INPUT was a synthetic fixture. NOT real scientific verification. |',
    '| `fixture_executor` | the whole executor is a deterministic fixture — no tool exists for this step yet. |',
    '| `mock_external` | REAL adaptation logic executed against a SIMULATED external system. |',
    '| `live_external` | a real external system. MUST be 0 in this wave. |',
  ].join('\n')
}

function gateChannelTable(): string {
  const rows = (['A', 'B', 'C'] as const).map(
    c => `| ${c} | \`${VERDICT_CHANNELS[c].kind}\` | ${VERDICT_CHANNELS[c].basis} |`,
  )
  return ['| channel | truthfulness | basis |', '| --- | --- | --- |', ...rows].join('\n')
}

function renderRunMarkdown(run: RunResult, mode: string): string {
  const counts = countKinds(run.steps)
  const reals = realToolSteps(run.steps)
  return [
    `# T19-B E2E report (${mode})`,
    '',
    `- runId: \`${run.runId}\``,
    `- steps driven: ${run.steps.length}/${STEP_EXECUTOR_REGISTRY.size}`,
    '',
    '## Truthfulness counts',
    '',
    ...TRUTHFULNESS_LEVELS.map(l => `- \`${l}\`: ${counts[l]}`),
    `- \`humanGate\` (E2-submit, no executor): ${counts.humanGate}`,
    '',
    truthfulnessLegend(),
    '',
    `**Real tool functions executed (${reals.length}):** ` +
      (reals.map(s => `${s.stepId}→${s.producer}`).join(', ') || '—'),
    '',
    '## Per-step execution',
    '',
    stepTableMarkdown(run.steps),
    '',
    '## Gate channel truthfulness',
    '',
    gateChannelTable(),
    '',
    '## Classification basis',
    '',
    basisListMarkdown(),
    '',
    '## Discipline checks',
    '',
    '- `live_external` count MUST be 0 (no real external system was contacted).',
    '- E2-submit status MUST be `gated` (human gate; never auto-approved by the driver).',
    '- `abstained` verdicts are preserved verbatim — core holds the step at `gated`',
    '  (`holdReason=gate_abstained`); the runner never coerces them to `passed`.',
    '- Every artifact of a non-fixture step carries `__producer` equal to the registry producer.',
    '- All gate adjudication goes through core `submitGateVerdict` → `_adjudicate`; the runner',
    '  re-implements no gate logic and adds no audit event of its own.',
    '',
  ].join('\n')
}

/** Write the JSON snapshot + markdown summary for one run mode. Returns the paths and contents. */
export function writeRunReport(
  run: RunResult,
  mode: 'happy' | 'recovery',
  outDirOverride?: string,
  extra?: Readonly<Record<string, unknown>>,
): { jsonPath: string; mdPath: string; jsonContent: string; mdContent: string } {
  const dir = outDirOf(outDirOverride)
  ensureDir(dir)
  const jsonPath = resolve(dir, `run-snapshot-${mode}.json`)
  const mdPath = resolve(dir, `e2e-report-t19b-${mode}.md`)
  const jsonContent = JSON.stringify(
    {
      runId: run.runId,
      mode,
      truthfulnessCounts: countKinds(run.steps),
      steps: run.steps,
      ...(extra ?? {}),
    },
    null,
    2,
  )
  const mdContent = renderRunMarkdown(run, mode)
  writeFileSync(jsonPath, jsonContent)
  writeFileSync(mdPath, mdContent)
  return { jsonPath, mdPath, jsonContent, mdContent }
}

/**
 * Write the T19-A vs T19-B comparison report. `t19bRun` is the happy-path run.
 */
export function writeComparisonReport(
  t19bRun: RunResult,
  outDirOverride?: string,
): { path: string; content: string } {
  const dir = outDirOf(outDirOverride)
  ensureDir(dir)
  const counts = countKinds(t19bRun.steps)
  const reals = realToolSteps(t19bRun.steps)

  const lines = [
    '# T19-A vs T19-B — real executor integration',
    '',
    '> Honesty note: `real_tool_fixture_input` means the real tool FUNCTION executed over a',
    '> SYNTHETIC input. It is evidence that the code path is wired and runs — it is NOT',
    '> evidence of real scientific verification, real literature, or a real model run.',
    '> `live_external` is 0 in both waves: no real external system was contacted.',
    '',
    '## Headline',
    '',
    '| metric | T19-A | T19-B |',
    '| --- | --- | --- |',
    `| steps with a REAL tool function executing (\`real_tool_fixture_input\`) | ${T19A.realToolCount} | ${counts.real_tool_fixture_input} |`,
    `| \`fixture_executor\` steps | ${T19A.fixtureCount} | ${counts.fixture_executor} |`,
    `| \`mock_external\` executor steps | ${T19A.mockExternalCount} | ${counts.mock_external} |`,
    `| \`live_external\` steps | 0 | ${counts.live_external} |`,
    `| E2-submit human gate (no executor) | 1 | ${counts.humanGate} |`,
    '| E2-submit final status | gated (stop) | gated (stop) |',
    // (kept as a template literal because oxlint quotes rule applies to quotes only)
    '',
    `- T19-A real-tool steps: ${T19A.realToolSteps.join(', ')}`,
    `- T19-B real-tool steps (${reals.length}): ` +
      (reals.map(s => `${s.stepId}→${s.producer}`).join(', ') || '—'),
    '',
    truthfulnessLegend(),
    '',
    '## Registry declaration (T19-B, all 16 steps)',
    '',
    registryTableMarkdown(),
    '',
    '## Per-step execution (T19-B happy path)',
    '',
    stepTableMarkdown(t19bRun.steps),
    '',
    '## Gate / audit differences',
    '',
    '- T19-A gate verdicts are fixture-labelled (`evidence: fixture:...`). T19-B builds every',
    '  verdict with the genuine adjudicators:',
    '',
    gateChannelTable(),
    '',
    '- T19-B keeps the single core gate-adjudication source (`submitGateVerdict` → `_adjudicate`);',
    '  no gate logic is re-implemented in the runner, no outcome is reinterpreted, no StepStatus is added.',
    '- The audit trail is written exclusively by core (`step-executed` from `runStep`;',
    '  `gate-verdict` / `gate-abstention` / `step-completed` from `submitGateVerdict` /',
    '  `completeStep`). The runner appends nothing, so there are no duplicate events.',
    '- `abstained` verdicts hold the step at `gated` (holdReason=`gate_abstained`); they are never',
    '  auto-promoted to passed.',
    '',
    '## Failure / abstain / rollback contract (preserved)',
    '',
    '- Executor throw / timeout / cancellation leaves the step `in_progress` with NO artifact',
    '  written (rollback-able); core `runStep` records the failure exactly once.',
    '- An undeclared output slug is rejected at the write boundary — all-or-nothing, zero artifacts.',
    '- An abstained gate component holds the step at `gated`; resolution requires rollback + a new',
    '  attempt with better evidence (never an in-place re-submit).',
    '- E2-submit is a human gate and stops at `gated`; approval is out of scope for the automated run.',
    '',
    '## Classification basis (T19-B, per step)',
    '',
    basisListMarkdown(),
    '',
    '## T19-A note',
    '',
    T19A.note,
    '',
  ].join('\n')

  const path = resolve(dir, 't19a-vs-t19b.md')
  writeFileSync(path, lines)
  return { path, content: lines }
}

export type { Truthfulness }
