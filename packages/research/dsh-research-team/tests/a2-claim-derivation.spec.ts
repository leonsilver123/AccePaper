/**
 * A2's claim derives from A1's gap.
 *
 * A claim is an ANSWER to a gap; while both were constants, "answering" was a
 * coincidence of the fixture text. These tests pin the derivation: the writer sees
 * A1's gaps, its labelled fields become the claim and the falsifiable prediction,
 * and a response missing any required field fails the step — because the C gate
 * hard-requires a falsifiable prediction and must never be handed a claim that
 * cannot be adjudicated.
 */

import { describe, expect, it } from 'vitest'
import { getArtifact, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import type { ResearchProseRequest, ResearchProseWriter } from '../src/runner/registry.ts'

import { runT19B } from '../src/runner/drive.ts'

interface ClaimShape {
  readonly assertion: string
  readonly claimSource: 'model' | 'fixture'
}

/** Writer answering with a caller-supplied response body. */
function writerReturning(text: string): {
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

const WELL_FORMED = [
  'ASSERTION: Graph attention over detector histories cuts peak-hour delay by at least 12%.',
  'DIFFERENCE: the policy conditions on an explicit corridor graph rather than per-intersection state',
  'EXPERIMENT: measure peak-hour delay against a fixed-time baseline on the same corridor',
  'PREDICTION: peak-hour delay falls by at least 12% relative to baseline',
].join('\n')

/**
 * Stop after A2. A2 itself lands `gated` under a derived claim: the C channel's
 * experiment fixture is keyed by (claimId, prediction), and a derived prediction is
 * absent from that table, so the C gate abstains and the step holds rather than
 * passing. That is the designed fail-closed behaviour, and it is also the coupling
 * P5 removes — these tests therefore assert A2's ARTIFACTS, not its status.
 */
const STOP_AFTER_CLAIM = 'A3-agenda'

describe('A2 claim derivation', () => {
  it('stays a labelled fixture when no writer is injected', async () => {
    const store: ResearchRunStore = new Map()
    // No writer means no C-channel dependency on a derived prediction, so the run
    // proceeds normally; read the artifact from a completed prefix.
    const run = await runT19B(store, { stopBefore: 'A3-agenda' })

    const claim = getArtifact(store, run.runId, 'claim') as ClaimShape
    expect(claim.claimSource).toBe('fixture')
    expect(claim.assertion.length).toBeGreaterThan(0)
  })

  it("turns the model's labelled fields into the claim, and shows it A1's gaps", async () => {
    const { writer, seen } = writerReturning(WELL_FORMED)
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, { proseWriter: writer, stopBefore: STOP_AFTER_CLAIM })

    const claim = getArtifact(store, run.runId, 'claim') as ClaimShape
    expect(claim.claimSource).toBe('model')
    expect(claim.assertion).toBe('Graph attention over detector histories cuts peak-hour delay by at least 12%.')

    const prediction = getArtifact(store, run.runId, 'falsifiable-prediction') as {
      text: string
      claimSource: 'model' | 'fixture'
    }
    expect(prediction.claimSource).toBe('model')
    expect(prediction.text).toBe('peak-hour delay falls by at least 12% relative to baseline')

    // The claim is a response to the gap: the writer must have received A1's gaps.
    // (A1 also uses the writer, so select A2's request by step id rather than order.)
    const request = seen.find(entry => entry.stepId === 'A2-claim')
    const gaps = (request?.context as { gaps?: unknown } | undefined)?.gaps
    expect(Array.isArray(gaps)).toBe(true)
    expect((gaps as unknown[]).length).toBeGreaterThan(0)
  })

  it('accepts list markers and label punctuation around the fields', async () => {
    const { writer } = writerReturning([
      '- ASSERTION = a claim with an equals sign',
      '* DIFFERENCE: a difference',
      '1. EXPERIMENT: an experiment',
      '• PREDICTION: a prediction',
    ].join('\n'))
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, { proseWriter: writer, stopBefore: STOP_AFTER_CLAIM })

    const claim = getArtifact(store, run.runId, 'claim') as ClaimShape
    expect(claim.claimSource).toBe('model')
    expect(claim.assertion).toBe('a claim with an equals sign')
  })

  it('fails the step when the response lacks a required field', async () => {
    // No PREDICTION line: a claim without a falsifiable prediction cannot be
    // adjudicated, so the step must fail rather than emit one.
    const { writer } = writerReturning([
      'ASSERTION: a claim',
      'DIFFERENCE: a difference',
      'EXPERIMENT: an experiment',
    ].join('\n'))
    const store: ResearchRunStore = new Map()

    const run = await runT19B(store, { proseWriter: writer, stopBefore: STOP_AFTER_CLAIM })
    const a2 = run.steps.find(step => step.stepId === 'A2-claim')

    // The step fails: it stays rollback-able with no artifacts, rather than emitting
    // a claim that no gate could adjudicate.
    expect(a2?.status).toBe('in_progress')
    expect(a2?.outputSlugs).toEqual([])
  })
})
