/**
 * Demo research-run summary fixture.
 *
 * Drives the {@link ResearchView} with a realistic 16-step run snapshot so the
 * panel renders truthful, structured data instead of a blank placeholder. Every
 * field here is MOCK data: the live T19-B runner output, when wired, maps into
 * {@link RunSummaryInput} by an adapter; this fixture stands in for that output
 * for demonstration and for the unit tests (given summary JSON → derived model).
 *
 * Designed to exercise every required surface: run status, 16-step progress
 * (with `gated`/`human_gate` hold and attempt counts), artifact counts +
 * summaries, gate history with an `abstained` outcome, an abstention record,
 * degradation annotations, and an E2 human-pending step (not auto-completed).
 */
import type { RunSummaryInput } from './summary.ts'

/** The demo run id; surfaced in the header and labelled MOCK. */
export const FIXTURE_RUN_ID = 'run_demo_2026_0903_a1b2c3'

/** The flattened 16-step demo run. */
export const RESEARCH_FIXTURE: RunSummaryInput = {
  runId: FIXTURE_RUN_ID,
  status: 'degraded',
  steps: [
    {
      stepId: 's01', index: 1, phase: 'A', name: 'Problem framing', status: 'passed', attempt: 1,
      humanGate: false, gateOutcomes: [{ component: 'B', outcome: 'passed' }],
    },
    {
      stepId: 's02', index: 2, phase: 'A', name: 'Literature survey', status: 'passed', attempt: 1,
      humanGate: false, gateOutcomes: [{ component: 'B', outcome: 'passed' }],
    },
    {
      stepId: 's03', index: 3, phase: 'A', name: 'Hypothesis formalization', status: 'passed', attempt: 1,
      humanGate: false, gateOutcomes: [{ component: 'B', outcome: 'passed' }],
    },
    {
      stepId: 's04', index: 4, phase: 'A', name: 'Research design', status: 'passed', attempt: 2,
      humanGate: false, gateOutcomes: [{ component: 'B', outcome: 'passed' }],
    },
    {
      stepId: 's05', index: 5, phase: 'B', name: 'Adversarial critique (red-team)', status: 'passed', attempt: 1,
      humanGate: false, gateOutcomes: [{ component: 'A', outcome: 'passed' }],
    },
    {
      stepId: 's06', index: 6, phase: 'B', name: 'Judge vote (≥2)', status: 'passed', attempt: 1,
      humanGate: false, gateOutcomes: [{ component: 'A', outcome: 'passed' }],
    },
    {
      stepId: 's07', index: 7, phase: 'B', name: 'External anchoring', status: 'passed', attempt: 1,
      humanGate: false, gateOutcomes: [{ component: 'B', outcome: 'passed' }],
    },
    {
      // Gate abstained: component A could not reach a verdict → freeze, not failure.
      stepId: 's08', index: 8, phase: 'B', name: 'Adversarial convergence', status: 'gated', attempt: 3,
      humanGate: false, holdReason: 'gate_abstained',
      gateOutcomes: [
        { component: 'A', outcome: 'abstained' },
        { component: 'B', outcome: 'passed' },
      ],
    },
    {
      stepId: 's09', index: 9, phase: 'B', name: 'Falsifiable prediction', status: 'passed', attempt: 1,
      humanGate: false, gateOutcomes: [{ component: 'C', outcome: 'passed' }],
    },
    {
      stepId: 's10', index: 10, phase: 'C', name: 'Experiment design', status: 'passed', attempt: 1,
      humanGate: false, gateOutcomes: [{ component: 'C', outcome: 'passed' }],
    },
    {
      stepId: 's11', index: 11, phase: 'C', name: 'Experiment execution', status: 'passed', attempt: 1,
      humanGate: false, gateOutcomes: [],
    },
    {
      stepId: 's12', index: 12, phase: 'C', name: 'Experiment adjudication', status: 'passed', attempt: 2,
      humanGate: false, gateOutcomes: [{ component: 'C', outcome: 'passed' }],
    },
    {
      stepId: 's13', index: 13, phase: 'D', name: 'Figure synthesis', status: 'passed', attempt: 1,
      humanGate: false, gateOutcomes: [],
    },
    {
      stepId: 's14', index: 14, phase: 'D', name: 'Table synthesis', status: 'passed', attempt: 1,
      humanGate: false, gateOutcomes: [],
    },
    {
      // E2 human pending: humanGate held at gated, awaiting a human decision.
      // NOT auto-completed — the view must surface this prominently.
      stepId: 's15', index: 15, phase: 'E', name: 'Human verification (E2)', status: 'gated', attempt: 1,
      humanGate: true, holdReason: 'human_gate',
      gateOutcomes: [],
    },
    {
      // Final step passed but flagged with a quality degradation (not a hard fail).
      stepId: 's16', index: 16, phase: 'E', name: 'Manuscript drafting', status: 'passed', attempt: 1,
      humanGate: false, gateOutcomes: [],
    },
  ],
  artifacts: [
    {
      slug: 'problem_statement', producerStepId: 's01', producerAttemptId: 1, producedAt: 1_728_000_000_000,
      invalidated: false, summary: 'One-paragraph problem statement + scope boundaries.',
    },
    {
      slug: 'lit_review', producerStepId: 's02', producerAttemptId: 1, producedAt: 1_728_000_060_000,
      invalidated: false, summary: 'Annotated literature survey (12 sources, SOTA comparison).',
    },
    {
      slug: 'hypotheses', producerStepId: 's03', producerAttemptId: 1, producedAt: 1_728_000_120_000,
      invalidated: false, summary: 'Three ranked hypotheses with falsifiable structure.',
    },
    {
      slug: 'design_v1', producerStepId: 's04', producerAttemptId: 1, producedAt: 1_728_000_180_000,
      invalidated: true, summary: 'Initial research design (superseded by attempt 2).',
    },
    {
      slug: 'design_v2', producerStepId: 's04', producerAttemptId: 2, producedAt: 1_728_000_240_000,
      invalidated: false, summary: 'Revised design with tighter controls.',
    },
    {
      slug: 'redteam_report', producerStepId: 's05', producerAttemptId: 1, producedAt: 1_728_000_300_000,
      invalidated: false, summary: 'Red-team refutations (8 attacks, 6 refuted).',
    },
    {
      slug: 'falsifiable_pred', producerStepId: 's09', producerAttemptId: 1, producedAt: 1_728_000_540_000,
      invalidated: false, summary: 'Falsifiable prediction with measurable success criterion.',
    },
    {
      slug: 'experiment_result', producerStepId: 's12', producerAttemptId: 2, producedAt: 1_728_000_720_000,
      invalidated: false, summary: 'Experiment adjudication: prediction supported (p<0.01).',
    },
    {
      slug: 'manuscript', producerStepId: 's16', producerAttemptId: 1, producedAt: 1_728_000_960_000,
      invalidated: false, summary: 'Draft manuscript (4 sections, pending human review).',
    },
  ],
  gates: [
    {
      stepId: 's05', component: 'A', outcome: 'passed', passed: true,
      evidence: '6/8 red-team attacks refuted with counterexamples.',
      rationale: 'Adversarial convergence threshold met.', timestamp: 1_728_000_300_000,
    },
    {
      stepId: 's08', component: 'A', outcome: 'abstained', passed: false,
      evidence: 'Insufficient information to refute or accept; judge confidence below threshold.',
      rationale: 'Cannot certify adversarial convergence — frozen, not failed.', timestamp: 1_728_000_420_000,
    },
    {
      stepId: 's08', component: 'B', outcome: 'passed', passed: true,
      evidence: 'External literature corroborates the central claim.',
      rationale: 'External anchoring satisfied.', timestamp: 1_728_000_360_000,
    },
    {
      stepId: 's09', component: 'C', outcome: 'passed', passed: true,
      evidence: 'Prediction is falsifiable and pre-registered.',
      rationale: 'Falsifiability criterion satisfied.', timestamp: 1_728_000_540_000,
    },
    {
      stepId: 's12', component: 'C', outcome: 'passed', passed: true,
      evidence: 'Experiment outcome matches pre-registered success criterion.',
      rationale: 'Experiment adjudicated in favour of prediction.', timestamp: 1_728_000_720_000,
    },
  ],
  abstentions: [
    {
      runId: FIXTURE_RUN_ID, stepId: 's08', attemptId: 3, component: 'A',
      reasonCode: 'INSUFFICIENT_EVIDENCE',
      evidenceRefs: ['redteam_report', 'lit_review'],
      recordedAt: '2026-09-03T08:17:00.000Z',
    },
  ],
  degradations: [
    {
      stepId: 's16', kind: 'quality',
      message: 'Manuscript draft auto-generated at reduced length due to context budget; human expansion recommended.',
    },
    {
      kind: 'coverage',
      message: 'Step s08 adversarial convergence could not be certified; downstream confidence margin narrowed.',
    },
  ],
}
