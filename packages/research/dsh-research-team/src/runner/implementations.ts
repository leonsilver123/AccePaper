// @deepseek-ai/dsh-research-team — the implementations this runner can actually execute.
//
// THE DEFECT THIS EXISTS TO CLOSE. `B1-method` asked the model for a method FAMILY and wrote
// whatever it answered onto `method-spec` — "reinforcement-learning phase-plan policy" among the
// possibilities — while every number downstream came from `platoon-sim.ts`, which integrates
// intelligent-driver-model trajectories. The manuscript's Method section and the code that ran
// were unrelated, and nothing compared them: a claim whose text said RL was measured by IDM and
// the two were never reconciled. That is the review's J11, and it is the difference between a
// paper whose method section describes its work and one whose method section describes a
// plausible neighbouring paper.
//
// WHAT IS DECLARED HERE IS DERIVED, NOT DESCRIBED. Every parameter below is read out of the
// simulation module's own constants, so a change to the model changes this declaration in the
// same edit — there is no second copy to keep in step, which is the only reason a hand-written
// method section stays true.
//
// WHAT "SUPPORTED" MEANS. An implementation here is one this process can run to completion and
// whose outputs it can measure. A study that needs a different one has no runner yet, and the
// honest outcome is to say so rather than to describe it and measure something else.

import type { StudyPlan } from './study-plan.ts'
import type { MeasuredMetric } from './prediction-gate.ts'
import {
  DECLARED_VEHICLE_CLASSES,
  EXPERIMENT_RULE_VERSION,
  MEASURED_METRIC,
  MODEL_EQUATIONS,
  SIMULATION_INPUTS,
} from './platoon-sim.ts'

/** One parameter the implementation varies between its baseline and its variant. */
export interface VariedParameter {
  /** The vehicle-class field the two compositions differ in. */
  readonly field: string
  readonly baseline: number
  readonly variant: number
  readonly unit: string
}

/** One model equation, as the manuscript renders it and as the integration applies it. */
export interface ImplementationEquation {
  readonly name: string
  readonly latex: string
  readonly note: string
}

/**
 * One executable method.
 *
 * `parameters` and `varied` are the two things a method section must get right: the values the
 * model was run at, and the difference between the arms it compared.
 */
export interface MethodImplementation {
  readonly id: string
  /** The rule version the produced artifacts carry, so a result names the code that made it. */
  readonly version: string
  /** The algorithm, as a reader of the paper would name it. */
  readonly algorithm: string
  readonly citation: string
  /** Every fixed modelling constant the integration used, by name. */
  readonly parameters: Readonly<Record<string, number>>
  /** What the two arms differ in — the study's actual independent variable. */
  readonly varied: ReadonlyArray<VariedParameter>
  readonly equations: ReadonlyArray<ImplementationEquation>
  readonly metric: MeasuredMetric
  /** The artifact slugs this implementation fills. */
  readonly outputs: ReadonlyArray<string>
}

/** The human and autonomous car-following parameters, as the two arms differ in them. */
function variedParameters(): ReadonlyArray<VariedParameter> {
  const baseline = DECLARED_VEHICLE_CLASSES.HV
  const variant = DECLARED_VEHICLE_CLASSES.AV
  return [
    {
      field: 'reactionDelaySeconds',
      baseline: baseline.reactionDelaySeconds,
      variant: variant.reactionDelaySeconds,
      unit: 's',
    },
    {
      field: 'desiredHeadwaySeconds',
      baseline: baseline.desiredHeadwaySeconds,
      variant: variant.desiredHeadwaySeconds,
      unit: 's',
    },
    {
      field: 'maxDecelerationMps2',
      baseline: baseline.maxDecelerationMps2,
      variant: variant.maxDecelerationMps2,
      unit: 'm/s²',
    },
    {
      field: 'lookAheadHorizonSeconds',
      baseline: baseline.lookAheadHorizonSeconds,
      variant: variant.lookAheadHorizonSeconds,
      unit: 's',
    },
  ]
}

/**
 * The study's own implementation: a three-vehicle platoon integrated with IDM under a declared
 * leader disturbance, comparing a homogeneous platoon against one with an autonomous vehicle.
 */
export const IDM_PLATOON_IMPLEMENTATION: MethodImplementation = {
  id: 'idm-platoon-simulation',
  version: EXPERIMENT_RULE_VERSION,
  algorithm: 'Intelligent Driver Model car-following, three-vehicle platoon',
  citation: 'Treiber, Hennecke & Helbing (2000), Physical Review E 62(2):1805',
  parameters: { ...SIMULATION_INPUTS },
  varied: variedParameters(),
  equations: MODEL_EQUATIONS.map(equation => ({ ...equation })),
  metric: MEASURED_METRIC,
  outputs: ['mvp-results'],
}

/** Every implementation this process can run. */
export const SUPPORTED_IMPLEMENTATIONS: ReadonlyArray<MethodImplementation> = [
  IDM_PLATOON_IMPLEMENTATION,
]

/**
 * The implementation a study plan names, or undefined when it names none.
 *
 * @param plan - the study plan.
 * @returns the implementation, or undefined when the plan declares no id.
 */
export function implementationOf(plan: StudyPlan): MethodImplementation | undefined {
  return plan.implementationId === undefined
    ? undefined
    : SUPPORTED_IMPLEMENTATIONS.find(candidate => candidate.id === plan.implementationId)
}

/** What one plan's declared implementation is, and whether this runner has it. */
export interface ImplementationResolution {
  readonly ok: boolean
  readonly implementation: MethodImplementation | undefined
  readonly reason: string
}

/**
 * Resolve the implementation a plan declares.
 *
 * A plan that names an implementation this runner does not have is NOT executable, and saying so
 * is the whole point: the alternative is a method section describing one algorithm and an
 * experiment running another, which is the defect this module exists for.
 *
 * @param plan - the study plan.
 * @returns the implementation when the runner has it, otherwise the refusal naming what is
 *   missing and what is available.
 */
export function resolveImplementation(plan: StudyPlan): ImplementationResolution {
  if (plan.implementationId === undefined) {
    return {
      ok: false,
      implementation: undefined,
      reason: 'the plan names no implementation, so nothing says which code would run',
    }
  }
  const implementation = implementationOf(plan)
  if (implementation === undefined) {
    const available = SUPPORTED_IMPLEMENTATIONS.map(candidate => candidate.id).join(', ')
    return {
      ok: false,
      implementation: undefined,
      reason:
        `the plan names implementation '${plan.implementationId}', which this runner does not have`
        + ` (available: ${available}) — describing a method and measuring something else is the`
        + ' failure this refusal prevents',
    }
  }
  return {
    ok: true,
    implementation,
    reason: `implementation '${implementation.id}' at version ${implementation.version}`,
  }
}
