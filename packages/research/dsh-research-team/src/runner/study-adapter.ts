// @deepseek-ai/dsh-research-team — what a study IS, in one object the steps consume.
//
// WHY THIS EXISTS. B3, C1, D1 and E1 each knew this deployment's first study by name. The baseline
// was a platoon, the figure was a bar chart of two compositions, the table's column read
// "Minimum TTC (s)", the roadmap's nodes were a platoon's, and the fallback prose described the
// Intelligent Driver Model. A second study therefore meant every one of those four steps growing a
// branch on which study it was running — and four branches per study is how a pipeline comes to
// describe a study it is not running, which is one level up from the defect `implementations.ts`
// exists for.
//
// WHAT A STUDY HANDS ITS STEPS. One object per study, resolved once from the plan: the executable
// method (so the Method section describes the code that ran), the two arms by name, the measurement
// (so B3, C1, D1 and E1 all read the same numbers from one run), the presentation this study's paper
// carries — its figure plan, the renderer spec that draws it, its table and its diagram, all with
// values sourced from the run's own record — the provenance block every experiment artifact attaches,
// and the fallback prose for each outline section.
//
// WHAT THIS IS NOT. It does not invoke a tool, draw a chart, number a float or assemble a manuscript.
// Those are D1's and E1's work and they are the same work whatever study is being reported. The
// adapter answers "what does THIS study's paper show"; the steps answer "how is a paper built". A
// study this process can measure but has no adapter for is REFUSED rather than described by the
// nearest one.

import type {
  AblationDefinition,
  AblationExecutor,
  AblationRunRequest,
  AblationRunResult,
  FigureSpec,
  RoadmapGraph,
  ThreeLineTableModel,
} from '@deepseek-ai/dsh-research-tools'
import { ABLATION_VARIANT_KINDS, ablationRunKey } from '@deepseek-ai/dsh-research-tools'

import type { ArgumentPlan, ClaimOutcome } from './argument-plan.ts'
import type { CitationUse } from './citation-bindings.ts'
import type { MethodImplementation } from './implementations.ts'
import { SUPPORTED_IMPLEMENTATIONS } from './implementations.ts'
import type { MeasuredMetric } from './prediction-gate.ts'
import {
  DEFAULT_FIGURE_SIZE,
  sequencePresentationPlan,
  shippedPresentationPlan,
} from './presentation-plan.ts'
import type { PresentationPlan } from './presentation-plan.ts'
import type { PredictionMeasurement } from './prediction-gate.ts'
import {
  ABLATION_MODULES,
  EXPERIMENT_RULE_VERSION,
  MEASURED_METRIC,
  SIMULATION_INPUTS,
  ablationStudy,
  boundaryTest,
  comparePlatoons,
  experimentStudy,
  measureStudy,
  runPlatoon,
} from './platoon-sim.ts'
import type { PlatoonStudy } from './platoon-sim.ts'
import type { MeasuredOutcome, StudySeries } from './result-version.ts'
import {
  LATENCY_INPUTS,
  LATENCY_METRIC,
  LATENCY_RULE_VERSION,
  boundaryLatency,
  compareLatency,
  declaredTrace,
  latencyModuleAblations,
  percentileMs,
  serveCoalesced,
  serveIndividually,
} from './service-latency-sim.ts'
import { implementationForPlan } from './study-plan.ts'
import type { StudyPlan } from './study-plan.ts'

/** One arm of a study, named the way a reader and the artifacts meet it. */
export interface StudyArm {
  /** How the paper names it, e.g. `HV-AV-HV`. */
  readonly label: string
  /** The run's own identifier for it, e.g. `mixed-HV-AV-HV`. */
  readonly identity: string
}

/**
 * What one run of a study measured, in the shape every consumer reads.
 *
 * THE MEASUREMENT IS ONE OBJECT. `measured` is what the manuscript, the figure plan and the argument
 * plan report; `prediction` is what the C channel grades; both come from the SAME execution of the
 * study, so an artifact and the verdict approving it cannot be two runs that happened to agree.
 */
export interface StudyMeasurement {
  readonly measured: MeasuredOutcome
  /**
   * What the gate grades: how much better the variant is, positive in the direction a better value
   * lies, or the study's own reason that it produced nothing to compare.
   */
  readonly prediction: PredictionMeasurement
  /** The implementation version that produced the numbers. */
  readonly ruleVersion: string
  /** The sequence the measurement ran over, when it ran over one. */
  readonly series?: StudySeries
}

/** Everything D1 renders this study's floats from, all of it derived from one study. */
export interface StudyPresentation {
  /** The figures the paper plans, with every value sourced from the run's record. */
  readonly plan: PresentationPlan
  /** The spec the plan's first figure is drawn from. */
  readonly figureSpec: FigureSpec
  /** The comparison table, as the three-line-table tool's own model. */
  readonly table: ThreeLineTableModel
  readonly roadmap: RoadmapGraph
  readonly roadmapTitle: string
}

/**
 * What C3-boundary runs: the ablation, its measurement seam, and the two things it reports.
 *
 * A STUDY OWNS ITS OWN BOUNDARY. What "removing one mechanism" means, which arm is the reference, and
 * what regime the claim stops carrying into are all facts about a particular study — a platoon's
 * boundary is stop-and-go forcing, a queue's is an arrival rate above capacity. Gathering them here is
 * what lets C3 invoke the ablation tool and record its result without knowing which study it ablated.
 */
export interface StudyBoundary {
  /** The definition the ablation tool is invoked with. */
  readonly definition: AblationDefinition
  /** The executor that measures both arms for every declared repetition. */
  readonly executor: AblationExecutor
  /** What removing one mechanism at a time is worth, measured one at a time. */
  readonly modules: Readonly<Record<string, unknown>>
  /** Whether the claim's declared scope actually binds, as measured. */
  readonly probe: Readonly<Record<string, unknown>>
  /** What this particular ablation measures, for the artifact's own note. */
  readonly note: string
}

/** What one figure's presentation is asked for. */
export interface StudyPresentationInput {
  /** The run record the figure's values are read from. */
  readonly sourceSlug: string
  /** What the argument plan says the measurement did to the claim. */
  readonly outcome: ClaimOutcome
  /**
   * The claim's declared comparison, already formatted by the shared reader, e.g. `>= 20%`.
   *
   * The study owns the NOUN its diagram shows ("minimum TTC change") and the run owns the declared
   * bar; passing the formatted bar keeps one formatter for it rather than a copy per study.
   */
  readonly commitmentLabel: string
}

/**
 * What the fallback prose for one section is written from.
 *
 * The section's heading and its obligations live in the argument plan; this carries what the
 * sentences are ABOUT — the measurement, the claim and the sources — and the two helpers that keep
 * the prose pointing at the floats the draft actually carries and at the sources it cites.
 */
export interface StudyProse {
  readonly plan: StudyPlan
  readonly measured: MeasuredOutcome
  readonly argumentPlan: ArgumentPlan
  readonly citations: ReadonlyArray<CitationUse>
  /** The label of every float of one kind the draft carries, e.g. `Figure 1, Figure 2`. */
  readonly named: (kind: string) => string
  /** The sentence stating where this work sits against the sources the run reviewed. */
  readonly priorWork: string
}

/**
 * One study, as the steps consume it.
 *
 * @see the module header for why this is one object rather than a branch in each executor.
 */
export interface StudyAdapter {
  /** The executable method the Method section describes. */
  readonly implementation: MethodImplementation
  readonly arms: { readonly baseline: StudyArm; readonly variant: StudyArm }
  /**
   * The artifact brands B3 and C1 stamp, so an artifact names the code that measured it.
   *
   * A study's baseline and its experiment are produced by that study's own module, so a brand shared
   * between studies would say the platoon simulator produced a queueing measurement.
   */
  readonly producers: { readonly baseline: string; readonly mvp: string }
  /** The scenario or trace this study's numbers were produced from, named so a reader can find it. */
  readonly sourceRef: string
  /** Run both arms once and report the result in the shape every consumer reads. */
  measure(): StudyMeasurement
  /** The block every experiment artifact attaches, describing what this measurement is and is not. */
  describe(plan: StudyPlan): Record<string, unknown>
  /** The floats this study's paper carries. */
  presentation(input: StudyPresentationInput): StudyPresentation
  /**
   * The comparison table alone, for the step that renders a manuscript without re-planning floats.
   *
   * E1 assembles the paper D4 approved; it renders the same table D1 planned, and asking it to build
   * a whole presentation plan — figure, diagram and all — to get one table would make it depend on a
   * step it is not downstream of.
   *
   * @param measured - the run's own measurement.
   * @returns the table model the three-line-table tool renders.
   */
  table(measured: MeasuredOutcome): ThreeLineTableModel
  /** What C3-boundary ablates, and what it measures about this study's scope. */
  ablation(): StudyBoundary
  /**
   * One sentence stating what the measurement did to the claim, in the study's own terms.
   *
   * The NOUN belongs to the study — "the platoon minimum time-to-collision", "the 95th-percentile
   * request latency" — so the sentence does too. A shared template with the noun substituted would
   * describe the movement correctly and the quantity wrongly the first time a study measured
   * something else, which is what a hand-written method section does when the study changes.
   *
   * @param measured - the run's own measurement.
   * @param outcome - what the argument plan says it did to the claim.
   * @returns the sentence, without a trailing period.
   */
  movementSentence(measured: MeasuredOutcome, outcome: ClaimOutcome): string
  /** The fallback body for one outline section, derived from the measurement. */
  body(sectionId: string, prose: StudyProse): string
}

/** The verb a signed change takes, in the metric's own units rather than in "better" or "worse". */
function movementOf(improvementPct: number): 'rose' | 'fell' {
  return improvementPct >= 0 ? 'rose' : 'fell'
}

/** How the argument plan's verdict reads in a sentence that reports the measurement. */
function verdictClause(outcome: ClaimOutcome): string {
  return outcome === 'refuted'
    ? 'which contradicts the claim this study committed to test'
    : outcome === 'supported'
      ? 'which is the change the claim predicted'
      : 'which falls short of the change the claim predicted'
}

/** Two decimals, the precision the pipeline reports at. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

// ── The first study: an IDM platoon under a declared disturbance ────────────────

/**
 * The platoon study, as an adapter.
 *
 * @param study - the two scenarios this run measures, read from the selected Case Pack when it
 *   declares them.
 * @returns the adapter over that study.
 */
export function platoonAdapter(study: PlatoonStudy): StudyAdapter {
  // RUN ONCE AND REMEMBERED. The study is deterministic over its declared scenarios, and every
  // consumer of one adapter must read the SAME execution: measuring again per step is how the
  // baseline artifact, the figure and the verdict came to be three computations nobody compared.
  let cache: StudyMeasurement | undefined
  const measure = (): StudyMeasurement => {
    if (cache !== undefined) return cache
    const comparison = comparePlatoons(study)
    cache = {
      measured: {
        metricKey: MEASURED_METRIC.key,
        unit: MEASURED_METRIC.unit,
        direction: MEASURED_METRIC.direction,
        // THE METRIC IS THE MINIMUM TIME-TO-COLLISION, so the two arms' values ARE those numbers; the
        // band rate and the stability index are what else this implementation reported.
        baseline: round2(comparison.baseline.minTtcSeconds),
        variant: round2(comparison.variant.minTtcSeconds),
        improvementPct: round2(comparison.relativeImprovementPct),
        values: {
          baselineTtcRatePct: round2(comparison.baseline.ttcLt1_5RatePct),
          variantTtcRatePct: round2(comparison.variant.ttcLt1_5RatePct),
          stringStabilityIndex: round2(comparison.variant.stringStabilityIndex),
        },
      },
      prediction: measureStudy(study),
      ruleVersion: EXPERIMENT_RULE_VERSION,
    }
    return cache
  }
  const arms = {
    baseline: { label: 'HV-HV-HV', identity: 'homogeneous-HV-HV-HV' },
    variant: { label: 'HV-AV-HV', identity: 'mixed-HV-AV-HV' },
  }
  return {
    implementation: requireImplementation('idm-platoon-simulation'),
    arms,
    producers: { baseline: 'platoon-sim:baseline', mvp: 'platoon-sim:mvp' },
    sourceRef: 'case-pack-traffic/claim.json',
    measure,
    describe: plan => describePlatoon(plan, study),
    presentation: (input) => {
      const { measured } = measure()
      const plan = shippedPresentationPlan({
        sourceSlug: input.sourceSlug,
        // THE RECORD'S OWN KEYS, which are the metric's two arms rather than the shipped study's
        // field names: the figure reconciliation refuses values named any other way, and that refusal
        // is what a stale key looks like.
        baselineKey: 'measured.baseline',
        variantKey: 'measured.variant',
        baselineSeconds: measured.baseline,
        variantSeconds: measured.variant,
        metricUnit: MEASURED_METRIC.unit,
        outcome: input.outcome,
      })
      const figure = plan.figures[0]
      return {
        plan,
        figureSpec: {
          kind: 'bar',
          title: figure?.answers ?? 'Measured comparison',
          width: figure?.size.width ?? DEFAULT_FIGURE_SIZE.width,
          height: figure?.size.height ?? DEFAULT_FIGURE_SIZE.height,
          // THE VARIANT FIRST, the order the table is read in, so the chart and the table present one
          // comparison rather than two orderings of it.
          series: [{
            name: `minimum time-to-collision (${MEASURED_METRIC.unit})`,
            values: [measured.variant, measured.baseline],
            unit: MEASURED_METRIC.unit,
          }],
          axes: {
            xLabel: 'platoon composition',
            categories: [arms.variant.label, arms.baseline.label],
            yLabel: 'minimum time-to-collision',
            yUnit: MEASURED_METRIC.unit,
          },
          tokens: { palette: ['#1f77b4'] },
          seed: 7,
        },
        table: platoonTable(measured),
        roadmap: platoonRoadmap(`Minimum TTC change ${input.commitmentLabel}`),
        roadmapTitle: 'Adaptive Control Research Roadmap',
      }
    },
    table: platoonTable,
    movementSentence: (measured, claimOutcome) =>
      `the platoon minimum time-to-collision ${movementOf(measured.improvementPct)} by`
      + ` ${Math.abs(measured.improvementPct).toFixed(2)}%, ${verdictClause(claimOutcome)}`,
    body: (sectionId, prose) => platoonBody(sectionId, study, prose),
    ablation: () => platoonBoundary(study),
  }
}

/**
 * What C3 ablates for the platoon study: the mixed platoon against the homogeneous one.
 *
 * @param study - the study whose two platoons the arms run.
 * @returns the definition, its measurement seam, and the two reports.
 */
function platoonBoundary(study: PlatoonStudy): StudyBoundary {
  const definition: AblationDefinition = {
    baselineIdentity: 'homogeneous-HV-HV-HV',
    variantIdentity: 'mixed-HV-AV-HV',
    removedOrReplacedComponents: [
      { component: 'platoon-composition', action: 'replaced', replacement: 'mixed-HV-AV-HV' },
    ],
    dataset: { version: 'case-pack-traffic.v2', split: 'declared-scenario', seed: 20260909 },
    metric: { name: MEASURED_METRIC.key, direction: ablationDirectionOf(MEASURED_METRIC) },
    repetitions: 4,
  }
  return {
    definition,
    // BOTH ARMS ARE MEASURED by simulating the two platoons, so a boundary claim and an experiment
    // claim come from the same car-following model rather than from two.
    executor: {
      execute(request: AblationRunRequest): ReadonlyArray<AblationRunResult> {
        const results: AblationRunResult[] = []
        for (let repetition = 0; repetition < request.definition.repetitions; repetition++) {
          for (const arm of ABLATION_VARIANT_KINDS) {
            const measured = arm === 'baseline' ? runPlatoon(study.baseline) : runPlatoon(study.variant)
            results.push({
              runKey: ablationRunKey(arm, repetition),
              status: 'executed',
              measurement: measured.minTtcSeconds,
            })
          }
        }
        return results
      },
    },
    modules: platoonModuleAblations(study),
    probe: platoonBoundaryProbe(study),
    note: 'the arms were MEASURED by the platoon simulation (homogeneous vs mixed platoon) — boundary'
      + ' probing belongs to C3, not B3',
  }
}

/**
 * The measured effect of removing each of the AV's two mechanisms, one at a time.
 *
 * Each row removes exactly one mechanism and keeps the rest, so the difference against the full
 * variant is attributable to that mechanism. The numbers are measured, and the Case Pack's own mock
 * ablation figures are NOT cited here — they belong to no run.
 */
function platoonModuleAblations(study: PlatoonStudy): Record<string, unknown> {
  const full = runPlatoon(study.variant)
  const rows = ABLATION_MODULES.map((moduleRemoved) => {
    const ablated = ablationStudy(study, moduleRemoved)
    const measured = ablated === undefined ? undefined : runPlatoon(ablated.variant)
    return {
      moduleRemoved,
      measured: measured !== undefined,
      minTtcSeconds: measured?.minTtcSeconds ?? null,
      // Positive means removing the module RAISED the safety margin, i.e. the module was costing
      // margin. A reader must be able to see the sign without doing arithmetic.
      changeVsFullVariantSeconds: measured === undefined ? null : measured.minTtcSeconds - full.minTtcSeconds,
      stringStabilityIndex: measured?.stringStabilityIndex ?? null,
    }
  })
  return {
    fullVariantMinTtcSeconds: full.minTtcSeconds,
    rows,
    note: 'each row removes ONE mechanism from the variant platoon and re-simulates; the baseline platoon is untouched by an ablation',
  }
}

/**
 * The scope test the Case Pack's boundary file states, measured rather than quoted.
 *
 * The pack asserts that the claim is limited to steady free flow and that stop-and-go breaks it. That
 * is a falsifiable statement about the study, so it is checked by re-running the variant under
 * stop-and-go forcing and comparing the two margins. The result is whatever it is, and the artifact
 * reports both numbers and the ratio so a reader can see the arithmetic.
 */
function platoonBoundaryProbe(study: PlatoonStudy): Record<string, unknown> {
  const probe = boundaryTest(study)
  return {
    freeFlowMinTtcSeconds: probe.freeFlow.minTtcSeconds,
    stopAndGoMinTtcSeconds: probe.stopAndGo.minTtcSeconds,
    marginRatio: probe.marginRatio,
    scopeLimited: probe.scopeLimited,
    rule: `scope is limited to steady free flow when the stop-and-go margin falls below ${SIMULATION_INPUTS.boundaryMarginRatio.toFixed(2)}x the free-flow margin`,
    note: 'both margins are MEASURED by the same simulator under two declared forcings; the ratio is arithmetic on them and neither number is quoted from the pack',
  }
}

/** The metric's direction, in the ablation tool's own closed vocabulary. */
function ablationDirectionOf(metric: MeasuredMetric): 'higher_is_better' | 'lower_is_better' {
  return metric.direction === 'higher-is-better' ? 'higher_is_better' : 'lower_is_better'
}

const PLATOON_TABLE_TITLE = 'Platoon Minimum Time-to-Collision Comparison'

/** The platoon study's comparison table, from the run's own two numbers. */
function platoonTable(measured: MeasuredOutcome): ThreeLineTableModel {
  return {
    title: PLATOON_TABLE_TITLE,
    columns: [
      { header: 'Method', decimals: 0 },
      { header: 'Minimum TTC (s)', decimals: 2, metricDirection: 'higher-is-better' },
    ],
    rows: [
      [
        { kind: 'text', text: 'HV-AV-HV' },
        { kind: 'number', value: measured.variant },
      ],
      [
        { kind: 'text', text: 'HV-HV-HV' },
        { kind: 'number', value: measured.baseline },
      ],
    ],
  }
}

/** The platoon study's roadmap: what feeds the experiment and what the experiment produced. */
function platoonRoadmap(outcomeLabel: string): RoadmapGraph {
  return {
    nodes: [
      { id: 'baseline-input', label: 'Homogeneous platoon (HV-HV-HV)', kind: 'input' },
      { id: 'adaptive-policy', label: 'Mixed platoon (HV-AV-HV)', kind: 'process' },
      { id: 'delay-experiment', label: 'Platoon experiment (C1)', kind: 'gate' },
      { id: 'reduction-outcome', label: outcomeLabel, kind: 'output' },
    ],
    edges: [
      { from: 'baseline-input', to: 'delay-experiment', label: 'baseline' },
      { from: 'adaptive-policy', to: 'delay-experiment', label: 'variant' },
      { from: 'delay-experiment', to: 'reduction-outcome', label: 'verdict' },
    ],
  }
}

/**
 * The provenance of the platoon study's measurement, attached to every experiment artifact.
 *
 * WHICH PARAMETERS CAME FROM THE PACK AND WHICH THIS STUDY DERIVED. The pack's vehicle rows carry a
 * reaction delay, a desired headway and a deceleration limit; they carry NO look-ahead horizon, so
 * the loader derives one as the vehicle's own reaction delay. Saying "each class carries the pack's
 * declared parameters" over that derivation attributed a loader-invented number to the pack — and
 * once the horizon became a real mechanism rather than a subtraction, it was worth 0.72 s of the
 * measured effect.
 */
function describePlatoon(plan: StudyPlan, study: PlatoonStudy): Record<string, unknown> {
  return {
    source: 'declared-scenario',
    study: {
      baselineComposition: study.baseline.composition,
      variantComposition: study.variant.composition,
      initialSpeedMps: study.variant.initialSpeedMps,
      desiredSpeedMps: study.variant.desiredSpeedMps,
      initialGapM: study.variant.initialGapM,
      vehicleClasses: study.variant.vehicleClasses,
      leader: study.variant.leader,
    },
    designInputs: SIMULATION_INPUTS,
    derivedParameters: ['lookAheadHorizonSeconds (the vehicle\'s own reaction delay; the pack declares no horizon)'],
    ruleVersion: EXPERIMENT_RULE_VERSION,
    // What this measurement is and what it is NOT. An artifact that states only "an experiment ran"
    // invites the reader to assume it tested the claim; naming both is what lets them check.
    measures: plan.metric.key,
    alsoMeasured: ['ttc-lt-1.5s-rate-pct', 'mean-time-headway-seconds', 'mean-jerk-mps3', 'string-stability-index'],
    doesNotMeasure: 'field crash frequency, any external SOTA, or any quantity outside the declared simulation',
    note: 'the scenario is DECLARED by the Case Pack and the simulation inputs are declared constants;'
      + ' there is no measured dataset behind these numbers, and no parameter was fitted to the'
      + ' experiment outcome',
  }
}

/**
 * The platoon paper's fallback prose, generated FROM the experiment's own parameters.
 *
 * These sentences used to be written by hand, and the method section kept describing the design the
 * experiment had BEFORE it changed. A hand-written description of a code path is a claim that expires
 * silently, so the parameters are interpolated and the numbers come from the run's measurement.
 */
function platoonBody(sectionId: string, study: PlatoonStudy, prose: StudyProse): string {
  const { plan, measured, argumentPlan, citations, named, priorWork } = prose
  const hv = study.variant.vehicleClasses.HV
  const av = study.variant.vehicleClasses.AV
  const inputs = SIMULATION_INPUTS
  const outcome = `the platoon minimum time-to-collision ${movementOf(measured.improvementPct)} by`
    + ` ${Math.abs(measured.improvementPct).toFixed(2)}%, ${verdictClause(argumentPlan.outcome)}`
  switch (sectionId) {
    case 'abstract':
      return 'We test whether inserting a single autonomous vehicle into a three-vehicle human platoon'
        + ' changes the platoon\'s car-following risk, measured as its minimum time-to-collision, under a'
        + ' declared periodic speed disturbance. Both platoons are simulated with the Intelligent Driver'
        + ' Model at the Case Pack\'s declared vehicle parameters. This is a deterministic offline'
        + ' simulation, not field data, and it reports no crash frequency. Under the declared'
        + ` configuration ${outcome}.`
    case 'introduction':
      // THE LITERATURE POSITION IS A SENTENCE, NOT A REFERENCE LIST. This section used to state the
      // claim and the prediction and say nothing about what is already known — the quality baseline
      // reported exactly that, on this paper, as `no-literature-position`.
      return `This work targets the claim: ${plan.claim.ref}. The falsifiable prediction is:`
        + ` ${plan.claim.prediction}. ${priorWork}`
    case 'method':
      return 'Both platoons are run with the SAME car-following model — the Intelligent Driver Model'
        + ` (Treiber, Hennecke & Helbing 2000), integrated at a fixed ${inputs.stepSeconds.toFixed(2)} s`
        + ' step — and differ only in composition: the baseline is HV-HV-HV and the variant is HV-AV-HV.'
        + ' The Case Pack declares, for each class, its reaction delay, its desired headway and its'
        + ` deceleration limit: the human vehicle reacts in ${hv.reactionDelaySeconds.toFixed(2)} s and`
        + ` wants a ${hv.desiredHeadwaySeconds.toFixed(1)} s headway; the autonomous vehicle reacts in`
        + ` ${av.reactionDelaySeconds.toFixed(2)} s and wants a ${av.desiredHeadwaySeconds.toFixed(1)} s`
        + ' headway. The look-ahead horizon is NOT declared by the pack — this study derives it as'
        + ` ${av.lookAheadHorizonSeconds.toFixed(2)} s, the vehicle's own reaction delay. Reaction time`
        + ' is applied as a real delay: a follower evaluates its leader\'s state as it was that delay'
        + ' earlier, and a vehicle with a horizon extrapolates that observed state forward over it. The'
        + ` leader's speed follows a declared periodic disturbance of ±${inputs.freeFlowAmplitudeMps.toFixed(1)}`
        + ` m/s at a ${inputs.disturbancePeriodSeconds.toFixed(1)} s period, which is the perturbation the`
        + ' string-stability literature uses to test whether a disturbance grows or decays down a platoon.'
        + ` The equations this section states (${named('equation')}) are the model's own, and the`
        + ' parameters they carry are the ones the Case Pack declares.'
    case 'experiments':
      return `Both platoons were run over ${inputs.measurementSeconds.toFixed(0)} s after a`
        + ` ${inputs.warmupSeconds.toFixed(0)} s warm-up, and the minimum time-to-collision (Minderhoud &`
        + ` Bovy 2001) was read from the simulated trajectories: ${measured.baseline.toFixed(2)} s for the`
        + ` homogeneous platoon and ${measured.variant.toFixed(2)} s for the platoon carrying the`
        + ` autonomous vehicle, a change of ${measured.improvementPct.toFixed(2)}%. Neither platoon entered`
        + ` the pack's declared TTC<1.5s band (${(measured.values['baselineTtcRatePct'] ?? 0).toFixed(2)}%`
        + ` and ${(measured.values['variantTtcRatePct'] ?? 0).toFixed(2)}% of vehicle-time), which bounds`
        + ' what that band could have shown.'
    case 'results':
      return `The comparison the claim is about is drawn in ${named('figure')} and its two values are`
        + ` listed in ${named('table')}; ${named('figure 2') === '' ? 'the research roadmap' : named('figure 2')}`
        + ` shows how the study reaches it. The measurement is that ${outcome}. The claim is bounded to`
        + ' steady free flow; the boundary probe and the ablations are reported separately, and no'
        + ' published-SOTA comparison is asserted.'
    case 'conclusion':
      return `Under the declared configuration ${outcome}, measured inside the study's own car-following`
        + ' model. The scope is three vehicles on one lane under a declared disturbance with no'
        + ' stochasticity; submission remains a human act at E2.'
    case 'references':
      return citations.length === 0
        ? 'No source is cited: this run holds no reviewed judgement binding one to its statements.'
        : `The ${String(citations.length)} reviewed source(s) this paper cites, listed below.`
    default:
      return 'This section carries no generated content in this wave.'
  }
}

// ── The second study: request coalescing against tail latency ───────────────────

/**
 * The queueing study, as an adapter.
 *
 * IT SHARES NO SHAPE WITH THE FIRST ONE where the paper is concerned: a sequence figure rather than a
 * category comparison, a built trace rather than two compositions, milliseconds rather than seconds,
 * and a direction in which LOWER is better. That is the point of it — a pipeline that could only
 * report the platoon study was that study's program, not a capability.
 *
 * @returns the adapter over the declared trace.
 */
export function latencyAdapter(): StudyAdapter {
  let cache: StudyMeasurement | undefined
  const measure = (): StudyMeasurement => {
    if (cache !== undefined) return cache
    const comparison = compareLatency()
    const baseline = comparison.baseline.p95Ms
    const comparable = Number.isFinite(baseline) && baseline > 0
    cache = {
      measured: {
        metricKey: LATENCY_METRIC.key,
        unit: LATENCY_METRIC.unit,
        direction: LATENCY_METRIC.direction,
        baseline,
        variant: comparison.variant.p95Ms,
        // RAW MOVEMENT, signed in the metric's own unit: the tail FELL, so this is negative. Which way
        // a better value lies is the metric's declared direction, and the gate applies it rather than
        // reading a sign out of a field name.
        improvementPct: comparison.relativeImprovementPct,
        values: {
          baselineThroughputPerSecond: comparison.baseline.throughputPerSecond,
          variantThroughputPerSecond: comparison.variant.throughputPerSecond,
          baselineBusyMs: comparison.baseline.busyMs,
          variantBusyMs: comparison.variant.busyMs,
        },
      },
      prediction: comparable
        ? {
          isComparable: true,
          // THE GATE'S CONVENTION, not the record's: positive means the variant is better. This
          // metric's better direction is downward, so the sign is inverted HERE — once, where the
          // study hands its measurement over, rather than in every consumer of it.
          relativeImprovementPct: -comparison.relativeImprovementPct,
          armsDetail:
            `no coalescing ${baseline.toFixed(2)} ms -> coalesced`
            + ` ${comparison.variant.p95Ms.toFixed(2)} ms`,
        }
        : {
          isComparable: false,
          reason: 'the declared trace produced no positive baseline latency, so there is no tail for'
            + ' the coalesced arm to be compared against',
        },
      ruleVersion: LATENCY_RULE_VERSION,
      // THE SEQUENCE THE FIGURE PLOTS, from the same two runs the percentile came from. A profile
      // built anywhere else could disagree with the number the claim is graded on.
      series: {
        axisLabel: 'requests served',
        unit: LATENCY_METRIC.unit,
        bucket: comparison.series.bucket,
        arms: { baseline: comparison.series.baseline, variant: comparison.series.variant },
      },
    }
    return cache
  }
  const arms = {
    baseline: { label: 'no coalescing', identity: 'individual-service' },
    // ASCII ONLY, because this label reaches the figure tool, whose text fields are validated as
    // printable ASCII — and because the renderer is not where a study's vocabulary should fail.
    variant: {
      label: `coalesced (${String(LATENCY_INPUTS.coalescingWindowMs)} ms window, batch up to`
        + ` ${String(LATENCY_INPUTS.maxBatch)})`,
      identity: 'coalesced-service',
    },
  }
  const bucket = (series: StudySeries | undefined): ReadonlyArray<number> => series?.bucket ?? []
  return {
    implementation: requireImplementation('service-latency-coalescing'),
    arms,
    producers: { baseline: 'service-latency-sim:baseline', mvp: 'service-latency-sim:mvp' },
    sourceRef: `declared-trace/${LATENCY_RULE_VERSION}`,
    measure,
    describe: describeLatency,
    presentation: (input) => {
      const { measured, series } = measure()
      const axisLabel = series?.axisLabel ?? 'requests served'
      const caption = `The ${String(LATENCY_INPUTS.percentile)}th-percentile request latency of each`
        + ` ${String(bucket(series)[0] ?? LATENCY_INPUTS.requestCount)}-request window, with and without`
        + ` coalescing, measured over the study's declared arrival trace (${input.outcome}).`
      return {
        plan: sequencePresentationPlan({
          sourceSlug: input.sourceSlug,
          answers: 'does coalescing arrivals change how the request latency profile evolves along the trace',
          axisLabel,
          axisUnit: 'requests',
          arms: [
            { name: arms.baseline.label, recordKey: 'baseline', values: series?.arms['baseline'] ?? [] },
            { name: arms.variant.label, recordKey: 'variant', values: series?.arms['variant'] ?? [] },
          ],
          yLabel: `p${String(LATENCY_INPUTS.percentile)} request latency`,
          yUnit: LATENCY_METRIC.unit,
          caption,
          // A PROFILE NEEDS WIDTH: six windows over a category axis on a 480 px canvas would put the
          // tick labels on top of one another, and an unreadable chart is a chart nothing refers to.
          size: { width: 720, height: 360 },
        }),
        figureSpec: {
          kind: 'line',
          title: `p${String(LATENCY_INPUTS.percentile)} latency per ${String(bucket(series)[0] ?? '')} requests`,
          width: 720,
          height: 360,
          series: [
            { name: arms.baseline.label, values: series?.arms['baseline'] ?? [], unit: LATENCY_METRIC.unit },
            { name: arms.variant.label, values: series?.arms['variant'] ?? [], unit: LATENCY_METRIC.unit },
          ],
          axes: {
            xLabel: axisLabel,
            categories: bucket(series).map(value => String(value)),
            yLabel: `p${String(LATENCY_INPUTS.percentile)} latency`,
            yUnit: LATENCY_METRIC.unit,
          },
          legend: { position: 'top' },
          // THE SEED IS THE STUDY'S, not the run's: the same measurement drawn twice must be the same
          // picture.
          tokens: { palette: ['#1f77b4', '#d62728'] },
          seed: 11,
        },
        table: latencyTable(measured),
        roadmap: latencyRoadmap(`p${String(LATENCY_INPUTS.percentile)} latency change ${input.commitmentLabel}`),
        roadmapTitle: 'Request Coalescing Research Roadmap',
      }
    },
    table: latencyTable,
    movementSentence: (measured, claimOutcome) =>
      `the ${String(LATENCY_INPUTS.percentile)}th-percentile request latency`
      + ` ${movementOf(measured.improvementPct)} by ${Math.abs(measured.improvementPct).toFixed(2)}%,`
      + ` ${verdictClause(claimOutcome)}`,
    body: latencyBody,
    ablation: latencyBoundary,
  }
}

/**
 * What C3 ablates for the queueing study: coalescing against serving each request as it arrives.
 *
 * A DIFFERENT ABLATION BECAUSE IT IS A DIFFERENT MECHANISM. The definition replaces the service
 * policy, its executor re-serves the SAME declared trace under each, and its scope test re-runs both
 * regimes above the server's capacity — where a queue stops settling and a percentage stops
 * describing the mechanism.
 *
 * @returns the definition, its measurement seam, and the two reports.
 */
function latencyBoundary(): StudyBoundary {
  const definition: AblationDefinition = {
    baselineIdentity: 'individual-service',
    variantIdentity: 'coalesced-service',
    removedOrReplacedComponents: [
      { component: 'service-policy', action: 'replaced', replacement: 'coalesced-service' },
    ],
    dataset: { version: LATENCY_RULE_VERSION, split: 'declared-trace', seed: 20260917 },
    metric: { name: LATENCY_METRIC.key, direction: ablationDirectionOf(LATENCY_METRIC) },
    repetitions: 4,
  }
  return {
    definition,
    executor: {
      execute(request: AblationRunRequest): ReadonlyArray<AblationRunResult> {
        const trace = declaredTrace()
        // MEASURED ONCE PER ARM AND REPEATED AS THE TOOL ASKS: the simulation is deterministic, so
        // re-running it per repetition would spend work to produce the same number — which the
        // artifact's own variability block states rather than leaving to be read as sampling.
        const baseline = percentileMs(serveIndividually(trace).latenciesMs, LATENCY_INPUTS.percentile)
        const variant = percentileMs(serveCoalesced(trace).latenciesMs, LATENCY_INPUTS.percentile)
        const results: AblationRunResult[] = []
        for (let repetition = 0; repetition < request.definition.repetitions; repetition++) {
          for (const arm of ABLATION_VARIANT_KINDS) {
            results.push({
              runKey: ablationRunKey(arm, repetition),
              status: 'executed',
              measurement: arm === 'baseline' ? baseline : variant,
            })
          }
        }
        return results
      },
    },
    modules: latencyModuleAblations(),
    probe: { ...boundaryLatency() },
    note: 'the arms were MEASURED by the queue simulation (no coalescing vs coalescing over the same'
      + ' declared trace) — boundary probing belongs to C3, not B3',
  }
}

const LATENCY_TABLE_TITLE = 'Tail Latency With and Without Request Coalescing'

/** The queueing study's comparison table, from the run's own numbers. */
function latencyTable(measured: MeasuredOutcome): ThreeLineTableModel {
  return {
    title: LATENCY_TABLE_TITLE,
    columns: [
      { header: 'Service policy', decimals: 0 },
      { header: 'p95 latency (ms)', decimals: 2, metricDirection: 'lower-is-better' },
      { header: 'Throughput (req/s)', decimals: 2 },
    ],
    rows: [
      [
        { kind: 'text', text: 'no coalescing' },
        { kind: 'number', value: measured.baseline },
        { kind: 'number', value: measured.values['baselineThroughputPerSecond'] ?? 0 },
      ],
      [
        { kind: 'text', text: `coalesced (${String(LATENCY_INPUTS.coalescingWindowMs)} ms)` },
        { kind: 'number', value: measured.variant },
        { kind: 'number', value: measured.values['variantThroughputPerSecond'] ?? 0 },
      ],
    ],
  }
}

/** The queueing study's roadmap: the trace, the two policies, the experiment and what it produced. */
function latencyRoadmap(outcomeLabel: string): RoadmapGraph {
  return {
    nodes: [
      {
        id: 'trace-input',
        label: `Declared arrival trace (${String(LATENCY_INPUTS.requestCount)} requests)`,
        kind: 'input',
      },
      { id: 'individual-policy', label: 'Serve each request as it arrives', kind: 'process' },
      {
        id: 'coalescing-policy',
        label: `Coalesce arrivals within ${String(LATENCY_INPUTS.coalescingWindowMs)} ms`,
        kind: 'process',
      },
      { id: 'queue-experiment', label: 'Queue simulation (C1)', kind: 'gate' },
      { id: 'latency-outcome', label: outcomeLabel, kind: 'output' },
    ],
    edges: [
      { from: 'trace-input', to: 'individual-policy', label: 'baseline arm' },
      { from: 'trace-input', to: 'coalescing-policy', label: 'variant arm' },
      { from: 'individual-policy', to: 'queue-experiment', label: 'baseline' },
      { from: 'coalescing-policy', to: 'queue-experiment', label: 'variant' },
      { from: 'queue-experiment', to: 'latency-outcome', label: 'verdict' },
    ],
  }
}

/**
 * The provenance of the queueing study's measurement, attached to every experiment artifact.
 *
 * The trace is BUILT rather than captured, and the artifact says so: a reader who assumed a production
 * trace would be reading a finding about a real service out of a declared model.
 */
function describeLatency(plan: StudyPlan): Record<string, unknown> {
  return {
    source: 'declared-trace',
    study: {
      requestCount: LATENCY_INPUTS.requestCount,
      arrivalRatePerSecond: LATENCY_INPUTS.arrivalRatePerSecond,
      meanServiceMs: LATENCY_INPUTS.meanServiceMs,
      slowEveryNth: LATENCY_INPUTS.slowEveryNth,
      slowFactorMs: LATENCY_INPUTS.slowFactorMs,
      coalescingWindowMs: LATENCY_INPUTS.coalescingWindowMs,
      maxBatch: LATENCY_INPUTS.maxBatch,
      percentile: LATENCY_INPUTS.percentile,
    },
    designInputs: LATENCY_INPUTS,
    // NO DERIVED PARAMETER, stated rather than left out: a reader comparing this block with the
    // platoon study's has to be able to tell which study derived a value its pack did not carry.
    derivedParameters: [],
    ruleVersion: LATENCY_RULE_VERSION,
    measures: plan.metric.key,
    alsoMeasured: ['throughput-per-second', 'busy-ms'],
    doesNotMeasure: 'any real service\'s latency, any production trace, or any queueing discipline'
      + ' other than the declared single server',
    note: 'the trace is BUILT from the declared rate and spread rather than captured, and the service'
      + ' times are declared constants; there is no measured dataset behind these numbers, and no'
      + ' parameter was fitted to the experiment outcome',
  }
}

/** The queueing paper's fallback prose, generated from the study's own declared parameters. */
function latencyBody(sectionId: string, prose: StudyProse): string {
  const { plan, measured, argumentPlan, citations, named, priorWork } = prose
  const inputs = LATENCY_INPUTS
  const percentile = String(inputs.percentile)
  const outcome = `the ${percentile}th-percentile request latency`
    + ` ${movementOf(measured.improvementPct)} by ${Math.abs(measured.improvementPct).toFixed(2)}%,`
    + ` ${verdictClause(argumentPlan.outcome)}`
  switch (sectionId) {
    case 'abstract':
      return 'We test whether coalescing arrivals inside a declared window lowers the tail latency of a'
        + ` single-server service, measured as the ${percentile}th-percentile request latency over a`
        + ` declared arrival trace of ${String(inputs.requestCount)} requests. Both policies are`
        + ' simulated against the same trace. This is a deterministic offline queueing simulation, not'
        + ` a measurement of any deployed service. Under the declared configuration ${outcome}.`
    case 'introduction':
      return `This work targets the claim: ${plan.claim.ref}. The falsifiable prediction is:`
        + ` ${plan.claim.prediction}. ${priorWork}`
    case 'method':
      return `Both policies serve the SAME declared arrival trace — ${String(inputs.requestCount)}`
        + ` requests arriving at ${String(inputs.arrivalRatePerSecond)} per second, one in every`
        + ` ${String(inputs.slowEveryNth)} taking ${String(inputs.slowFactorMs)} times the mean service`
        + ' time — and differ only in whether arrivals are coalesced. The single server\'s mean service'
        // NO DERIVED RATIO IS STATED. A load factor reads well and is the kind of number the number
        // check refuses: the run never declared it and its record does not account for it, so a
        // manuscript carrying it states a quantity nobody measured.
        + ` time is ${String(inputs.meanServiceMs)} ms, and the declared arrival rate stays below the`
        + ' rate that would saturate it — so the queue settles and the comparison is about coalescing'
        + ' rather than about an overload. The'
        + ` coalesced arm batches every arrival within ${String(inputs.coalescingWindowMs)} ms of a`
        + ` batch's first request, up to ${String(inputs.maxBatch)} requests, and serves the batch for as`
        + ' long as its slowest member; every request in it is answered when that service ends. The'
        + ` equations this section states (${named('equation')}) are the queue recurrence, the latency it`
        + ' implies, the nearest-rank percentile and the coalesced service time — the four the'
        + ' simulation actually computes.'
    case 'experiments':
      return `Both arms were run over the full trace and the ${percentile}th-percentile latency was read`
        + ` by the nearest-rank rule at ${percentile}% of ${String(inputs.requestCount)} samples:`
        + ` ${measured.baseline.toFixed(2)} ms serving each request as it arrives and`
        + ` ${measured.variant.toFixed(2)} ms under coalescing, a change of`
        + ` ${measured.improvementPct.toFixed(2)}%. The server was busy`
        + ` ${(measured.values['baselineBusyMs'] ?? 0).toFixed(0)} ms and`
        + ` ${(measured.values['variantBusyMs'] ?? 0).toFixed(0)} ms respectively, which bounds how much`
        + ' of the change could come from doing less work rather than from reordering it.'
    case 'results':
      return `The profile the claim is about is drawn in ${named('figure')} and the two end-to-end`
        + ` percentiles are listed in ${named('table')}; ${named('figure 2') === '' ? 'the research roadmap' : named('figure 2')}`
        + ` shows how the study reaches it. The measurement is that ${outcome}. The claim is bounded to a`
        + ' single server under the declared trace; the boundary probe and the ablations are reported'
        + ' separately, and no published-SOTA comparison is asserted.'
    case 'conclusion':
      return `Under the declared configuration ${outcome}, measured inside the study's own queueing model.`
        + ' The scope is one server over a built trace with no stochasticity and no network effects;'
        + ' submission remains a human act at E2.'
    case 'references':
      return citations.length === 0
        ? 'No source is cited: this run holds no reviewed judgement binding one to its statements.'
        : `The ${String(citations.length)} reviewed source(s) this paper cites, listed below.`
    default:
      return 'This section carries no generated content in this wave.'
  }
}

// ── Resolution ─────────────────────────────────────────────────────────────────

/** The registered implementation with one id, or a thrown refusal when this build has none. */
function requireImplementation(id: string): MethodImplementation {
  const found = SUPPORTED_IMPLEMENTATIONS.find(candidate => candidate.id === id)
  if (found === undefined) {
    throw new Error(
      `[study-adapter] this build registers no implementation '${id}' — an adapter describes a`
      + ' registered method, and one naming an absent id would describe code that is not here',
    )
  }
  return found
}

/** The registered implementation with one id, or the refusal naming what is available. */
function resolveById(
  id: string,
): { readonly ok: true; readonly implementation: MethodImplementation } | { readonly ok: false; readonly reason: string } {
  const found = SUPPORTED_IMPLEMENTATIONS.find(candidate => candidate.id === id)
  if (found === undefined) {
    return {
      ok: false,
      reason:
        `the plan names implementation '${id}', which this build does not register`
        + ` (available: ${SUPPORTED_IMPLEMENTATIONS.map(candidate => candidate.id).join(', ')})`,
    }
  }
  return { ok: true, implementation: found }
}

/** The adapter for a plan, or why this process cannot conduct the study it declares. */
export type StudyAdapterResolution =
  | { readonly ok: true; readonly adapter: StudyAdapter }
  | { readonly ok: false; readonly reason: string }

/**
 * The adapter for the study a plan is about.
 *
 * RESOLVED FROM THE PLAN'S DECLARED METRIC, the same resolution `B1-method` uses, so the method the
 * paper describes and the measurement the run reports are chosen by one fact. A plan whose quantity
 * no implementation measures has no adapter, and that is a refusal rather than a fallback: the
 * alternative is a paper describing the study the runner happened to have.
 *
 * @param plan - the research this run carries.
 * @param study - the platoon scenarios, when the run was given them; the shipped ones otherwise.
 * @returns the adapter, or why this run cannot be conducted as the plan declares.
 */
export function studyAdapterFor(
  plan: StudyPlan,
  study: PlatoonStudy = experimentStudy(),
): StudyAdapterResolution {
  // RESOLVED THE WAY THE DRIVER RESOLVES THE PLAN: by the implementation the plan NAMES, or by the
  // quantity it declares when it names none. The two orders matter at A2, which overwrites the plan's
  // metric key with the claim's — for a claim a model derived that is an empty key, unbindable by
  // construction, and a resolution by quantity alone would then find no study and refuse a run whose
  // configuration never changed. What broke there is the claim's binding to the study, and the C
  // channel holds on that; the run does not change study underneath itself.
  const resolved = plan.implementationId === undefined
    ? implementationForPlan(plan)
    : resolveById(plan.implementationId)
  if (!resolved.ok) return { ok: false, reason: resolved.reason }
  if (resolved.implementation.id === 'idm-platoon-simulation') {
    return { ok: true, adapter: platoonAdapter(study) }
  }
  if (resolved.implementation.id === 'service-latency-coalescing') {
    return { ok: true, adapter: latencyAdapter() }
  }
  // AN IMPLEMENTATION THIS BUILD CAN MEASURE BUT NOT YET REPORT. `SUPPORTED_IMPLEMENTATIONS` says the
  // code can run it; an adapter says this pipeline can write the paper about it. Those are different
  // claims, and collapsing them is how a study gets a method section describing something else.
  return {
    ok: false,
    reason:
      `implementation '${resolved.implementation.id}' can be run but this build has no adapter that`
      + ' could present it, so its figures, table and prose would be written up as another study\'s',
  }
}

/**
 * The adapter for a plan, or a thrown refusal.
 *
 * @param plan - the research this run carries.
 * @param study - the platoon scenarios, when the run was given them.
 * @returns the adapter.
 * @throws {Error} when this build cannot conduct the plan's study.
 */
export function requireStudyAdapter(
  plan: StudyPlan,
  study: PlatoonStudy = experimentStudy(),
): StudyAdapter {
  const resolved = studyAdapterFor(plan, study)
  if (!resolved.ok) {
    throw new Error(`[study-adapter] this run cannot be conducted as its plan declares: ${resolved.reason}`)
  }
  return resolved.adapter
}
