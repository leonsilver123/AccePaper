/**
 * T19-A P4/P5 E2E — deterministic executor fixtures.
 *
 * One {@link StepExecutor} per step. Every step EXCEPT `D1-figure-map` produces a
 * deterministic synthetic artifact explicitly labelled as a FIXTURE — it must NOT
 * be mistaken for real science / literature / model output. `D1-figure-map` is the
 * designated REAL-TOOL integration point: it calls the real `renderFigure` pure tool
 * and returns a `figure-plan` whose content is derived from the real, byte-valid SVG/PNG
 * the tool produced.
 *
 * Fault injectors (`throwingExecutor`, `slowExecutor`) are used only by the recovery
 * scenario to simulate executor failure / timeout; they are never part of the happy path.
 */

import type { StepDefinition, StepExecutor } from '../helpers/imports.ts'
import { renderFigure, STEP_BY_ID } from '../helpers/imports.ts'

/** Fixed timestamp injected into the real figure tool + fixture verdicts so two E2E
 *  runs are byte-for-byte deterministic (renderFigure(preview-spec, FIXED_TS) is stable). */
export const FIXED_TS = 1_700_000_000_000

/** Build a deterministic synthetic fixture artifact for one declared output slug.
 *  Content is unambiguously NOT real research output. */
function fixtureArtifact(stepId: string, slug: string): Record<string, unknown> {
  return {
    fixture: true,
    stepId,
    slug,
    note: 'synthetic E2E fixture artifact — NOT real literature/science/model output',
  }
}

/** Default executor for any non-real step: emits every declared output as a labelled fixture. */
function fixtureExecutor(step: StepDefinition): StepExecutor {
  return () => {
    const out: Record<string, unknown> = {}
    for (const slug of step.outputs) {
      out[slug] = fixtureArtifact(step.id, slug)
    }
    return out
  }
}

/** REAL-TOOL executor for `D1-figure-map`: renders a small deterministic figure via the
 *  real `renderFigure` pure tool and returns a `figure-plan` whose provenance proves the
 *  real tool ran (byte lengths + a short SVG preview of the REAL output). */
function figureMapExecutor(): StepExecutor {
  return () => {
    const artifact = renderFigure(
      {
        kind: 'bar',
        title: 'Fixture Convergence Trace',
        width: 320,
        height: 240,
        series: [{ name: 'ablation', values: [3, 7, 5, 9, 6] }],
        tokens: { palette: ['#1f77b4', '#ff7f0e', '#2ca02c'] },
        seed: 7,
      },
      FIXED_TS,
    )
    return {
      'figure-plan': {
        source: 'REAL-figure-tool',
        svgByteLength: artifact.svg.byteLength,
        pngByteLength: artifact.png.byteLength,
        svgPreview: String(artifact.svg.content).slice(0, 80),
        note: 'figure-plan derived from a REAL renderFigure SVG+PNG artifact',
      },
    }
  }
}

/** Map of every step id → its default (happy-path) executor. */
export const FIXTURE_EXECUTORS: ReadonlyMap<string, StepExecutor> = new Map(
  [...STEP_BY_ID.values()].map(step => [step.id, step.id === 'D1-figure-map' ? figureMapExecutor() : fixtureExecutor(step)]),
)

/** Executor that throws synchronously — simulates a tool crash (no artifact must be written). */
export function throwingExecutor(reason: string): StepExecutor {
  return () => {
    throw new Error(`E2E-fixture-executor-failure: ${reason}`)
  }
}

/** Executor that resolves only after `delayMs` — used with a smaller `timeoutMs` to
 *  exercise the pipeline's deterministic timeout (no hang) recovery path. */
export function slowExecutor(delayMs: number): StepExecutor {
  return () =>
    new Promise<Record<string, unknown>>((resolve) => {
      setTimeout(() => resolve({ delayed: true }), delayMs)
    })
}
