/**
 * The method the manuscript describes IS the code that ran.
 *
 * The defect (review J11): `B1-method` asked the model for a method FAMILY and wrote the answer
 * onto `method-spec` — a response naming "reinforcement-learning phase-plan policy" became the
 * manuscript's method — while every number downstream came from `platoon-sim.ts`, which
 * integrates intelligent-driver-model trajectories. Nothing compared the two, so a paper could
 * describe one experiment and report another, and the Method section was the one place in the
 * pipeline where free text was load-bearing.
 *
 * The fix is structural rather than a comparison: the algorithm, its parameters, the factors the
 * two arms differ in, and the equations are DECLARED by the implementation the plan names, and
 * they are read out of the simulation module's own constants. The model is left with what it can
 * legitimately contribute — the procedure steps and the metric's direction — so there is no
 * model-authored algorithm left to disagree with.
 */

import { describe, expect, it } from 'vitest'
import { getArtifact } from '@deepseek-ai/dsh-research-core'
import type { ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { runT19B } from '../src/runner/drive.ts'
import {
  IDM_PLATOON_IMPLEMENTATION,
  SUPPORTED_IMPLEMENTATIONS,
  resolveImplementation,
} from '../src/runner/implementations.ts'
import { DECLARED_VEHICLE_CLASSES, SIMULATION_INPUTS } from '../src/runner/platoon-sim.ts'
import { DEFAULT_PLAN, requirePlan } from '../src/runner/study-plan.ts'
import { MEASURED_METRIC } from '../src/runner/platoon-sim.ts'

interface MethodSpecShape {
  readonly family: string
  readonly steps: ReadonlyArray<string>
  readonly implementation: {
    readonly id: string
    readonly version: string
    readonly algorithm: string
    readonly citation: string
    readonly parameters: Readonly<Record<string, number>>
    readonly varied: ReadonlyArray<{ field: string; baseline: number; variant: number; unit: string }>
    readonly equations: ReadonlyArray<{ name: string }>
    readonly outputs: ReadonlyArray<string>
  }
}

const STOP_AFTER_METHOD = 'B2-data'

async function methodSpec(store: ResearchRunStore): Promise<MethodSpecShape> {
  const run = await runT19B(store, { stopBefore: STOP_AFTER_METHOD })
  const spec = getArtifact(store, run.runId, 'method-spec') as MethodSpecShape | undefined
  if (spec === undefined) throw new Error('fixture: method-spec was not produced')
  return spec
}

describe('the method spec carries the executed implementation', () => {
  it('declares the algorithm, not a model-authored family', async () => {
    const spec = await methodSpec(new Map())
    expect(spec.implementation.id).toBe('idm-platoon-simulation')
    expect(spec.implementation.algorithm).toBe(IDM_PLATOON_IMPLEMENTATION.algorithm)
    expect(spec.implementation.algorithm).toMatch(/Intelligent Driver Model/)
    // The old fixture literal — kept here because it is what the manuscript used to say.
    expect(spec.implementation.algorithm).not.toMatch(/reinforcement-learning/)
  })

  it('declares the parameters the integration actually used', async () => {
    const spec = await methodSpec(new Map())
    // Deep equality against the simulation's OWN constants: a hand-written parameter list that
    // drifted from the model would fail here, which is the only reason the Method section can be
    // trusted without reading the code.
    expect(spec.implementation.parameters).toEqual({ ...SIMULATION_INPUTS })
  })

  it('declares the factors the two arms differ in, from the vehicle classes', async () => {
    const spec = await methodSpec(new Map())
    const byField = new Map(spec.implementation.varied.map(entry => [entry.field, entry]))
    expect(byField.get('reactionDelaySeconds')).toMatchObject({
      baseline: DECLARED_VEHICLE_CLASSES.HV.reactionDelaySeconds,
      variant: DECLARED_VEHICLE_CLASSES.AV.reactionDelaySeconds,
    })
    expect(byField.get('lookAheadHorizonSeconds')).toMatchObject({
      baseline: DECLARED_VEHICLE_CLASSES.HV.lookAheadHorizonSeconds,
      variant: DECLARED_VEHICLE_CLASSES.AV.lookAheadHorizonSeconds,
    })
  })

  it('carries the equations the reader will see and the code applies', async () => {
    const spec = await methodSpec(new Map())
    expect(spec.implementation.equations.map(equation => equation.name)).toContain('Acceleration')
    expect(spec.implementation.equations).toEqual(IDM_PLATOON_IMPLEMENTATION.equations)
  })

  it('takes its family from the implementation, so no model answer can name the algorithm', async () => {
    const spec = await methodSpec(new Map())
    // `family` is what the manuscript's Method section renders. It is derived, not authored: the
    // model's own FAMILY line is recorded as `modelDeclaredFamily` for audit and cannot reach here.
    // The model path itself is exercised by `b1-method-derivation.spec.ts`, whose scope note
    // explains why B1 cannot be driven end to end while a writer is injected.
    expect(spec.family).toBe(`${IDM_PLATOON_IMPLEMENTATION.algorithm} (${IDM_PLATOON_IMPLEMENTATION.version})`)
  })

  it('names the version of the code that produced the result', async () => {
    const spec = await methodSpec(new Map())
    expect(spec.implementation.version).toBe(IDM_PLATOON_IMPLEMENTATION.version)
  })
})

describe('the study’s stated difference is the one the code varies', () => {
  it('describes the vehicle parameters, not a comparison that never ran', () => {
    const difference = DEFAULT_PLAN.claim.essentialDifference
    // It read "control policy is adaptive (RL) rather than fixed-time": false twice over — the
    // car-following is IDM in both arms, and the baseline is a homogeneous platoon, not a
    // fixed-time signal plan.
    expect(difference).not.toMatch(/RL|reinforcement/i)
    expect(difference).not.toMatch(/fixed-time/i)
    expect(difference).toContain(String(DECLARED_VEHICLE_CLASSES.AV.reactionDelaySeconds))
    expect(difference).toContain(String(DECLARED_VEHICLE_CLASSES.HV.reactionDelaySeconds))
  })
})

describe('a plan naming an implementation this runner lacks is refused', () => {
  it('refuses an unknown implementation id at the plan boundary', () => {
    const result = requirePlan(
      { ...DEFAULT_PLAN, implementationId: 'some-other-lab-pipeline' },
      MEASURED_METRIC,
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.reason).toContain('some-other-lab-pipeline')
    expect(result.reason).toContain('idm-platoon-simulation')
  })

  it('accepts the implementation it has', () => {
    expect(requirePlan(DEFAULT_PLAN, MEASURED_METRIC).ok).toBe(true)
  })

  it('refuses a plan that names none, when asked to resolve one', () => {
    const { implementationId: _dropped, ...withoutImplementation } = DEFAULT_PLAN
    void _dropped
    const resolved = resolveImplementation(withoutImplementation)
    expect(resolved.ok).toBe(false)
    expect(resolved.reason).toMatch(/names no implementation/)
  })

  it('refuses a non-string implementation id', () => {
    const result = requirePlan(
      { ...DEFAULT_PLAN, implementationId: 42 },
      MEASURED_METRIC,
    )
    expect(result.ok).toBe(false)
  })

  it('supports exactly the implementation whose outputs it can produce', () => {
    // "Supported" is a claim about this process: one entry, and it names the artifact it fills.
    expect(SUPPORTED_IMPLEMENTATIONS).toHaveLength(1)
    expect(IDM_PLATOON_IMPLEMENTATION.outputs).toEqual(['mvp-results'])
  })
})
