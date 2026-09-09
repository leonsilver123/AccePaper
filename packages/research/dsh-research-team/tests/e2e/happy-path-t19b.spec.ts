// @deepseek-ai/dsh-research-team — T19-B happy-path E2E.
//
// Drives all 16 steps through the CORE engine with the T19-B executor registry
// (5 real tool functions + 10 fixture executors + the E2 human gate) and the
// genuine trinity gate channels, then asserts the truthfulness claims are
// FALSIFIABLE from the run state alone:
//
//   - each `real_tool_fixture_input` step's persisted artifact carries the real
//     tool's `__producer` / `__kind` brand (proof the tool actually ran — not
//     that the registry merely declares it);
//   - every gate verdict came from the real adjudicators via core
//     `submitGateVerdict` (single adjudication authority);
//   - the audit timeline contains ONLY core-emitted events (no duplicates from
//     the runner);
//   - E2-submit ends `gated` — never auto-approved.
//
// Reports (run snapshot JSON, run markdown, T19-A vs T19-B comparison) are
// written to `.workbuddy/tmp/e2e-out-t19b/` by report.ts.

import { describe, expect, it } from 'vitest'
import {
  getArtifact,
  getAuditHistory,
  getRunSnapshot,
  getStepDefinitions,
  isComplete,
} from '@deepseek-ai/dsh-research-core'
import type { AuditEvent, ResearchRunStore } from '@deepseek-ai/dsh-research-core'

import { runT19B } from '../../src/runner/drive.ts'
import {
  CANONICAL,
  SCENARIO,
  STEP_EXECUTOR_REGISTRY,
  TRUTHFULNESS_LEVELS,
  VERDICT_CHANNELS,
} from '../../src/runner/registry.ts'
import { countKinds, writeComparisonReport, writeRunReport } from '../../src/runner/report.ts'
import type { RunResult, StepOutcome } from '../../src/runner/types.ts'

const CORE_ORDER: ReadonlyArray<string> = getStepDefinitions().map(d => d.id)
// T19-S canonical alignment: ablation (C3) is the real-tool boundary probe;
// B3-baseline is baseline+SOTA (honest fixture); E1-format assembles the
// formatted manuscript (three-line-table is its real table sub-capability).
const REAL_TOOL_STEPS = ['A1-landscape', 'A2-claim', 'C3-boundary', 'D1-figure-map', 'E1-format']

interface Driven {
  readonly store: ResearchRunStore
  readonly run: RunResult
  readonly durationMs: number
}

let driven: Driven | undefined

/** Drive the whole pipeline exactly once and memoize (the run is deterministic). */
async function happyRun(): Promise<Driven> {
  if (driven !== undefined) return driven
  const store: ResearchRunStore = new Map()
  const t0 = Date.now()
  const run = await runT19B(store)
  driven = { store, run, durationMs: Date.now() - t0 }
  return driven
}

function outcomeOf(run: RunResult, stepId: string): StepOutcome {
  const found = run.steps.find(s => s.stepId === stepId)
  if (found === undefined) throw new Error(`happy-path: step '${stepId}' was not driven`)
  return found
}

describe('T19-B happy path — all 16 steps drive through the core engine', () => {
  it('drives every core step exactly once, in canonical order', async () => {
    const { run } = await happyRun()
    expect(run.steps.map(s => s.stepId)).toEqual(CORE_ORDER)
    expect(run.steps.length).toBe(16)
  })

  it('leaves the first 15 steps `passed` and E2-submit `gated`', async () => {
    const { run } = await happyRun()
    const nonE2 = run.steps.filter(s => s.stepId !== 'E2-submit')
    for (const s of nonE2) {
      expect(s.status, `${s.stepId} should be passed`).toBe('passed')
    }
    expect(outcomeOf(run, 'E2-submit').status).toBe('gated')
  })

  it('never auto-approves E2-submit: no approval, no completion', async () => {
    const { store, run } = await happyRun()
    const snap = getRunSnapshot(store, run.runId)
    const e2 = snap.steps['E2-submit']
    expect(e2?.status).toBe('gated')
    expect(e2?.approval).toBeUndefined()
    expect(isComplete(store, run.runId)).toBe(false)
    expect(snap.events.some(e => e.kind === 'human-approval')).toBe(false)
  })
})

describe('T19-B happy path — real tool execution is provable from the artifacts', () => {
  it('persists the real tool producer brand on every real-tool artifact', async () => {
    const { store, run } = await happyRun()
    for (const stepId of REAL_TOOL_STEPS) {
      const entry = STEP_EXECUTOR_REGISTRY.get(stepId)
      expect(entry?.kind).toBe('real_tool_fixture_input')
      const outcome = outcomeOf(run, stepId)
      expect(outcome.usedRealTool).toBe(true)
      expect(outcome.artifacts.length).toBeGreaterThan(0)
      for (const art of outcome.artifacts) {
        // The evidence comes from the PERSISTED artifact, not from the registry.
        const value = getArtifact(store, run.runId, art.slug) as Record<string, unknown>
        expect(value.__producer, `${stepId}/${art.slug}`).toBe(entry?.producer)
        expect(value.__kind).toBe('real_tool_fixture_input')
        expect(art.producedBy).toBe(entry?.producer)
      }
    }
  })

  it('brands fixture artifacts as fixture_executor (no level inflation)', async () => {
    const { store, run } = await happyRun()
    const fixtureSteps = run.steps.filter(s => s.kind === 'fixture_executor' && s.stepId !== 'E2-submit')
    expect(fixtureSteps.length).toBe(10)
    for (const s of fixtureSteps) {
      for (const art of s.artifacts) {
        const value = getArtifact(store, run.runId, art.slug) as Record<string, unknown>
        expect(value.__kind).toBe('fixture_executor')
        expect(String(value.__producer).startsWith('fixture:')).toBe(true)
      }
    }
  })

  it('writes every declared output slug into the artifact registry', async () => {
    const { store, run } = await happyRun()
    const snap = getRunSnapshot(store, run.runId)
    for (const def of getStepDefinitions()) {
      if (def.id === 'E2-submit') continue // human gate: no executor, no artifact
      for (const slug of def.outputs) {
        expect(snap.registry[slug], `${def.id} must have produced '${slug}'`).toBeDefined()
        expect(snap.registry[slug]?.producerStepId).toBe(def.id)
      }
    }
    expect(snap.registry['submission-record']).toBeUndefined()
  })

  it('reports exactly 5 real-tool steps and 0 live_external', async () => {
    const { run } = await happyRun()
    const counts = countKinds(run.steps)
    expect(counts.real_tool_fixture_input).toBe(5)
    expect(counts.fixture_executor).toBe(10)
    expect(counts.live_external).toBe(0)
    expect(counts.humanGate).toBe(1)
    const total = TRUTHFULNESS_LEVELS.reduce((n, l) => n + counts[l], 0) + counts.humanGate
    expect(total).toBe(16)
  })
})

describe('T19-S happy path — canonical BUSINESS artifacts (step semantics, not just state)', () => {
  function artifactOf(store: ResearchRunStore, runId: string, slug: string): Record<string, unknown> {
    const value = getArtifact(store, runId, slug)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`happy-path: artifact '${slug}' is missing or primitive`)
    }
    return value as Record<string, unknown>
  }

  it('A2 persists the canonical falsifiable prediction verbatim', async () => {
    const { store, run } = await happyRun()
    const p = artifactOf(store, run.runId, 'falsifiable-prediction')
    expect(p.text).toBe(CANONICAL.prediction)
    expect(p.ref).toBe(CANONICAL.claimId)
  })

  it('B3 baseline-results is a baseline protocol against fixed-time (NO ablation fields)', async () => {
    const { store, run } = await happyRun()
    const res = artifactOf(store, run.runId, 'baseline-results')
    expect((res.baseline as { identity?: unknown }).identity).toBe(SCENARIO.baselineIdentity)
    expect((res.baseline as { metric?: { name?: unknown } }).metric?.name).toBe(SCENARIO.metric)
    expect((res.preRegistered as { baselineDelaySeconds?: unknown }).baselineDelaySeconds)
      .toBe(SCENARIO.baselineDelaySeconds)
    // Regression: ablation measurement belongs to C3, never to B3.
    expect(res.aggregate).toBeUndefined()
    expect(res.ranRuns).toBeUndefined()
    const sota = artifactOf(store, run.runId, 'sota-comparison')
    expect(sota.anchoring).toBe('none')
  })

  it('C1 mvp-results supports the prediction with the fixture-consistent 9.1% reduction', async () => {
    const { store, run } = await happyRun()
    const mvp = artifactOf(store, run.runId, 'mvp-results')
    expect(mvp.claimId).toBe(CANONICAL.claimId)
    expect((mvp.outcome as { supportsPrediction?: unknown }).supportsPrediction).toBe(true)
    expect(String((mvp.outcome as { detail?: unknown }).detail)).toContain('9.1%')
    expect((mvp.observed as { reductionRate?: unknown }).reductionRate).toBe(SCENARIO.reductionRate)
  })

  it('C3 ablation-results + boundary-map prove boundary probing runs at C3', async () => {
    const { store, run } = await happyRun()
    const ab = artifactOf(store, run.runId, 'ablation-results')
    expect(ab.ranRuns as number).toBeGreaterThan(0)
    expect(ab.aggregate).toBeDefined()
    const bm = artifactOf(store, run.runId, 'boundary-map')
    expect((bm.probed as { baseline?: unknown }).baseline).toBe(SCENARIO.baselineIdentity)
    expect((bm.probed as { variant?: unknown }).variant).toBe(SCENARIO.variantIdentity)
  })

  it('D1 figure-plan wires all three canonical figure families with real render evidence', async () => {
    const { store, run } = await happyRun()
    const plan = artifactOf(store, run.runId, 'figure-plan')
    const figures = plan.figures as ReadonlyArray<Record<string, unknown>>
    expect(figures.map(f => f.kind)).toEqual(['data-figure', 'three-line-table', 'roadmap'])
    expect((figures[0] as { svgByteLength?: unknown }).svgByteLength as number).toBeGreaterThan(0)
    expect(String((figures[1] as { tableMarkdown?: unknown }).tableMarkdown)).toContain('Adaptive')
    expect((figures[2] as { validationOk?: unknown }).validationOk).toBe(true)
  })

  it('D2→D3→D4→E1 carries the SAME manuscript skeleton through outline/draft/revision/format', async () => {
    const { store, run } = await happyRun()
    const outline = artifactOf(store, run.runId, 'paper-outline')
    const draft = artifactOf(store, run.runId, 'draft')
    const revised = artifactOf(store, run.runId, 'revised-draft')
    const formatted = artifactOf(store, run.runId, 'formatted-manuscript')

    const outlineIds = (outline.sections as ReadonlyArray<{ id: string }>).map(s => s.id)
    expect(outlineIds).toContain('results')
    const draftIds = (draft.sections as ReadonlyArray<{ id: string }>).map(s => s.id)
    const revisedIds = (revised.sections as ReadonlyArray<{ id: string }>).map(s => s.id)
    expect(draftIds).toEqual(outlineIds)
    expect(revisedIds).toEqual(outlineIds)

    const manuscript = String(formatted.manuscript)
    // The E1 formatted manuscript contains the section headings from the outline…
    for (const id of ['introduction', 'method', 'experiments', 'results']) {
      const heading = (outline.sections as ReadonlyArray<{ id: string; heading: string }>)
        .find(s => s.id === id)?.heading
      expect(heading, id).toBeDefined()
      expect(manuscript).toContain(heading as string)
    }
    // …the selected venue from A4…
    expect(manuscript).toContain(SCENARIO.venueName)
    // …and the results-table rows rendered by the three-line-table sub-capability.
    expect(manuscript).toContain('Adaptive')
    expect(manuscript).toContain('Fixed-time')
    // E1 is the FORMAT STEP, not the table tool: the manuscript is strictly
    // longer than the bare table render and declares a reproducible package.
    const tableMarkdown = String(formatted.tableMarkdown)
    expect(manuscript.length).toBeGreaterThan(tableMarkdown.length)
    expect((formatted.reproduciblePackage as { files?: unknown[] }).files?.length ?? 0)
      .toBeGreaterThanOrEqual(3)
    expect(Array.isArray(formatted.sectionHeadings)).toBe(true)
  })

  it('E2-submit stays gated — the formatted manuscript is the last artifact', async () => {
    const { store, run } = await happyRun()
    expect(getArtifact(store, run.runId, 'formatted-manuscript')).toBeDefined()
    expect(getArtifact(store, run.runId, 'submission-record')).toBeUndefined()
    expect(outcomeOf(run, 'E2-submit').status).toBe('gated')
  })
})

describe('T19-B happy path — genuine trinity gate channels', () => {
  it('records a passed verdict for every gate component core declares', async () => {
    const { store, run } = await happyRun()
    const snap = getRunSnapshot(store, run.runId)
    for (const def of getStepDefinitions()) {
      const stepSnap = snap.steps[def.id]
      expect(stepSnap).toBeDefined()
      for (const comp of def.gate) {
        const verdict = stepSnap?.gateResults[comp]
        expect(verdict, `${def.id} gate ${comp}`).toBeDefined()
        expect(verdict?.outcome).toBe('passed')
        expect(verdict?.component).toBe(comp)
      }
    }
  })

  it('sources the A verdict from team judgeRound and the C verdict from adjudicateClaimSupport', async () => {
    const { store, run } = await happyRun()
    const snap = getRunSnapshot(store, run.runId)
    const a2 = snap.steps['A2-claim']
    expect(String(a2?.gateResults.A?.evidence)).toContain('team:judgeRound')
    expect(String(a2?.gateResults.A?.evidence)).toContain("adjudicate('A')")
    expect(String(a2?.gateResults.C?.evidence)).toContain('team:adjudicateClaimSupport')
    expect(String(a2?.gateResults.C?.evidence)).toContain("adjudicate('C')")
  })

  it('sources the B verdict from the T23 anchor fixture + core verifyCitation over a mock resolver', async () => {
    const { store, run } = await happyRun()
    const snap = getRunSnapshot(store, run.runId)
    const b = snap.steps['A1-landscape']?.gateResults.B
    expect(b?.outcome).toBe('passed')
    const evidence = String(b?.evidence)
    expect(evidence).toContain("core:adjudicate('B')")
    expect(evidence).toContain('anchoring=true')
    expect(evidence).toContain('T23 anchor')
    expect(evidence).toContain('MockCitationResolverAdapter')
    // Truthfulness is declared as mock_external, NEVER as real verification.
    expect(VERDICT_CHANNELS.B.kind).toBe('mock_external')
  })

  it('adjudicates the C2 A+B+C triple gate through all three real channels', async () => {
    const { store, run } = await happyRun()
    const snap = getRunSnapshot(store, run.runId)
    const c2 = snap.steps['C2-trinity-loop']
    expect(Object.keys(c2?.gateResults ?? {}).sort()).toEqual(['A', 'B', 'C'])
    expect(outcomeOf(run, 'C2-trinity-loop').verdicts).toEqual({ A: 'passed', B: 'passed', C: 'passed' })
  })

  it('holds no step at gate_abstained on the happy path', async () => {
    const { store, run } = await happyRun()
    const snap = getRunSnapshot(store, run.runId)
    for (const def of getStepDefinitions()) {
      expect(snap.steps[def.id]?.holdReason, def.id).toBeUndefined()
    }
    expect(snap.events.some(e => e.kind === 'gate-abstention')).toBe(false)
  })
})

describe('T19-B happy path — audit timeline is core-owned and duplicate-free', () => {
  it('emits exactly one step-executed event per executed step', async () => {
    const { store, run } = await happyRun()
    const snap = getRunSnapshot(store, run.runId)
    const executed = snap.events.filter(e => e.kind === 'step-executed')
    // 15 executors ran; E2-submit runs none.
    expect(executed.length).toBe(15)
    expect(executed.map(e => e.stepId)).toEqual(CORE_ORDER.filter(id => id !== 'E2-submit'))
  })

  it('emits exactly one gate-verdict event per submitted component (no runner duplicates)', async () => {
    const { store, run } = await happyRun()
    const snap = getRunSnapshot(store, run.runId)
    const expected = getStepDefinitions().reduce((n, d) => n + d.gate.length, 0)
    const verdictEvents = snap.events.filter(e => e.kind === 'gate-verdict')
    expect(verdictEvents.length).toBe(expected)
    // No runner-injected marker: the runner appends nothing of its own.
    for (const e of verdictEvents) {
      const detail = e.detail as Record<string, unknown> | undefined
      expect(detail?.t19b).toBeUndefined()
    }
  })

  it('produces a canonical event vocabulary in a monotonic order', async () => {
    const { store, run } = await happyRun()
    const snap = getRunSnapshot(store, run.runId)
    const kinds = new Set(snap.events.map((e: AuditEvent) => e.kind))
    expect(kinds.has('run-created')).toBe(true)
    expect(kinds.has('input-seeded')).toBe(true)
    expect(kinds.has('step-started')).toBe(true)
    expect(kinds.has('artifact-recorded')).toBe(true)
    expect(kinds.has('step-completed')).toBe(true)
    expect(kinds.has('rollback')).toBe(false)
    let prev = -1
    for (const e of snap.events) {
      expect(e.ts).toBeGreaterThanOrEqual(prev)
      prev = e.ts
    }
  })

  it('keeps one attempt per step (no retries needed on the happy path)', async () => {
    const { store, run } = await happyRun()
    for (const def of getStepDefinitions()) {
      const history = getAuditHistory(store, run.runId, def.id)
      expect(history.length, def.id).toBe(1)
      expect(outcomeOf(run, def.id).attemptId).toBe(1)
    }
  })
})

describe('T19-B happy path — auditable reports', () => {
  it('writes the run snapshot, run markdown and the T19-A vs T19-B comparison', async () => {
    const { store, run } = await happyRun()
    const snap = getRunSnapshot(store, run.runId)
    const { jsonPath, mdPath, jsonContent, mdContent } = writeRunReport(run, 'happy', undefined, {
      auditTimeline: snap.events,
      artifactManifest: snap.registry,
      gateHistory: Object.fromEntries(
        Object.entries(snap.steps).map(([id, s]) => [id, { status: s.status, gateResults: s.gateResults }]),
      ),
    })
    const { path: cmpPath, content: cmpContent } = writeComparisonReport(run)
    // The writers returned non-empty content + a path, proving the files were produced.
    expect(typeof jsonPath).toBe('string')
    expect(typeof mdPath).toBe('string')
    expect(typeof cmpPath).toBe('string')
    expect(jsonContent.length).toBeGreaterThan(0)
    expect(mdContent.length).toBeGreaterThan(0)
    expect(cmpContent.length).toBeGreaterThan(0)

    const md = mdContent
    expect(md).toContain('real_tool_fixture_input')
    expect(md).toContain('`live_external`: 0')
    // Honesty: a real tool over synthetic input must never be sold as real science.
    expect(md).not.toContain('真实科研验证')
    expect(md).toContain('NOT real scientific verification')

    const cmp = cmpContent
    expect(cmp).toContain('T19-A vs T19-B')
    expect(cmp).toContain('| steps with a REAL tool function executing')
    expect(cmp).toContain('NOT')

    const json = JSON.parse(jsonContent) as Record<string, unknown>
    expect((json.truthfulnessCounts as Record<string, number>).real_tool_fixture_input).toBe(5)
    expect((json.truthfulnessCounts as Record<string, number>).live_external).toBe(0)
    expect(Array.isArray(json.auditTimeline)).toBe(true)
    expect(json.artifactManifest).toBeDefined()
  })

  it('records the observed run cost for the T19-A/T19-B comparison', async () => {
    const { run, durationMs } = await happyRun()
    expect(run.steps.length).toBe(16)
    expect(durationMs).toBeGreaterThanOrEqual(0)
  })
})
