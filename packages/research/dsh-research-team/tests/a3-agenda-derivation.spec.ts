/**
 * A3-agenda derives the agenda and the contribution list from the claim.
 *
 * The step used to be pure fixture with no path to a model at all. These tests
 * drive A3's own executor rather than a whole run, so a change in what A3 does is
 * what fails them — not a change in any upstream step. They pin both halves: the
 * offline path stays deterministic and labelled, and the writer path fails closed
 * on an incomplete or empty answer rather than emitting structure that only looks
 * like an agenda.
 */

import { describe, expect, it } from 'vitest'

import { STEP_EXECUTOR_REGISTRY } from '../src/runner/registry.ts'
import type { ExecCtx, ResearchProseRequest, ResearchProseWriter } from '../src/runner/registry.ts'
import { EMPTY_CLAIM_MATERIAL } from '../src/runner/redteam-review.ts'
import { experimentStudy } from '../src/runner/platoon-sim.ts'
import { DEFAULT_PLAN } from '../src/runner/study-plan.ts'
import { platoonAdapter } from '../src/runner/study-adapter.ts'

interface AgendaShape {
  readonly phases: ReadonlyArray<string>
  readonly plan: ReadonlyArray<string>
  readonly agendaSource: 'model' | 'fixture'
  readonly agendaRoute: { readonly producer: string }
}

interface ContributionListShape {
  readonly contributions: ReadonlyArray<{ readonly id: string; readonly claim: string }>
  readonly agendaSource: 'model' | 'fixture'
}

/** A writer that answers with fixed text and records the request it was handed. */
function answeringWith(text: string): {
  readonly writer: ResearchProseWriter
  readonly seen: ResearchProseRequest[]
} {
  const seen: ResearchProseRequest[] = []
  return {
    seen,
    writer: {
      // This stub stands in for a model-backed route, so it declares that channel: the runner
      // now labels an artifact from the channel, and a stub that declares none cannot be labelled.
      channel: 'llm',
      async write(request) {
        seen.push(request)
        return { text, provider: 'test-provider', model: 'test-model' }
      },
    },
  }
}

function executorOf(stepId: string) {
  const entry = STEP_EXECUTOR_REGISTRY.get(stepId)
  if (entry === undefined) throw new Error(`no registry entry for '${stepId}'`)
  return entry.executor
}

function ctxFor(writer?: ResearchProseWriter): ExecCtx {
  return {
    runId: 'run-a3-spec',
    stepId: 'A3-agenda',
    attemptId: 1,
    getInput: (slug: string) =>
      slug === 'claim' ? { claimRef: 'claim-1', assertion: 'adaptive control cuts delay' } : undefined,
    readInputRef: () => undefined,
    runCtx: {
      predictionText: '',
      claimId: '',
      claimRef: '',
      metricKey: '',
      claimMaterial: { ...EMPTY_CLAIM_MATERIAL },
      study: experimentStudy(),
      studyPlan: DEFAULT_PLAN,
      planSource: 'default',
      timestamp: 1_700_000_000_000,
      // THE STUDY THE RUN IS CONDUCTED AS: a context built by hand resolves it here, exactly as
      // `createRunContext` does for a driven run, because every step reports the study through it.
      adapter: platoonAdapter(experimentStudy()),
    },
    ...(writer !== undefined ? { proseWriter: writer } : {}),
  }
}

/** The two artifacts A3 owns, off one executor call. */
async function runA3(writer?: ResearchProseWriter): Promise<{ agenda: AgendaShape; list: ContributionListShape }> {
  const out = await executorOf('A3-agenda')(ctxFor(writer))
  return {
    agenda: out.agenda as AgendaShape,
    list: out['contribution-list'] as ContributionListShape,
  }
}

describe('A3 agenda derivation', () => {
  it('stays a labelled fixture when no writer is injected', async () => {
    const { agenda, list } = await runA3()

    expect(agenda.agendaSource).toBe('fixture')
    expect(list.agendaSource).toBe('fixture')
    expect(agenda.phases.length).toBeGreaterThan(0)
    expect(list.contributions.length).toBeGreaterThan(0)
    // The route says which path ran, without claiming a model call.
    expect(agenda.agendaRoute.producer).toContain('built-in fixture text')
  })

  it('derives the phases and the contributions from the model response', async () => {
    const { writer, seen } = answeringWith(
      'PHASES: frame the gap | build the experiment | iterate | argue | ship\n'
      + 'CONTRIBUTIONS: a measured delay comparison || an open dataset and its provenance',
    )
    const { agenda, list } = await runA3(writer)

    expect(agenda.agendaSource).toBe('model')
    expect(agenda.phases).toEqual([
      'frame the gap',
      'build the experiment',
      'iterate',
      'argue',
      'ship',
    ])
    // AGAINST THE MODEL'S OWN STAGES, not against `agenda.phases`: the executor assigns both fields
    // from the one parsed list on this branch, so `plan === phases` restated the assignment and could
    // not fail. What the field is for is told apart by the FIXTURE branch, where `phases` is the five
    // canonical stages and `plan` is the pipeline sentence — so a model path that left the fixture's
    // plan in place would pass the old assertion whenever the two happened to be equal, and its
    // failure would be about a coincidence rather than about the derivation.
    expect(agenda.plan).toEqual([
      'frame the gap',
      'build the experiment',
      'iterate',
      'argue',
      'ship',
    ])
    expect(agenda.plan).not.toEqual(['A 定位', 'B 构造', 'C 迭代', 'D 论证', 'E 落地'])
    expect(agenda.agendaRoute.producer).toContain('test-provider/test-model')

    expect(list.contributions.map(c => c.claim)).toEqual([
      'a measured delay comparison',
      'an open dataset and its provenance',
    ])
    // Ids are assigned by position, so a consumer can address an entry.
    expect(list.contributions.map(c => c.id)).toEqual(['c1', 'c2'])

    // The writer saw the claim it was asked to derive from.
    expect(seen[0]?.stepId).toBe('A3-agenda')
    expect((seen[0]?.context as { claim?: unknown }).claim).toBeDefined()
  })

  it('fails closed on a response that is missing a block', async () => {
    const { writer } = answeringWith('PHASES: only phases here')

    await expect(runA3(writer)).rejects.toThrow(/NO DEFAULT PASS/)
  })

  it('fails closed on a response whose blocks are empty', async () => {
    const { writer } = answeringWith('PHASES:   \nCONTRIBUTIONS:   ')

    await expect(runA3(writer)).rejects.toThrow(/NO DEFAULT PASS/)
  })

  it('derives a single contribution when only one is offered', async () => {
    const { writer } = answeringWith('PHASES: one | two\nCONTRIBUTIONS: the only contribution')
    const { list } = await runA3(writer)

    expect(list.contributions).toHaveLength(1)
    expect(list.contributions[0]?.id).toBe('c1')
  })
})
