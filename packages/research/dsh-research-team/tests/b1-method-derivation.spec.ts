/**
 * B1's method spec derives from the claim.
 *
 * The method is how a claim is made testable; while it was a constant, the spec and
 * the claim were unrelated text. These tests pin the derivation and the fail-closed
 * boundary: an incomplete spec fails the step, because a method missing its family,
 * steps, or metric cannot be implemented or measured downstream.
 */

import { describe, expect, it } from 'vitest'
import { getArtifact, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { labelledField } from '../src/runner/registry.ts'

import { runT19B } from '../src/runner/drive.ts'

interface MethodSpecShape {
  readonly family: string
  readonly steps: ReadonlyArray<string>
  readonly metric: { readonly name: string; readonly direction: string }
  readonly methodSource: 'model' | 'fixture'
}

const WELL_FORMED_METHOD = [
  'FAMILY: graph-attention policy over corridor state',
  'STEPS: build the detector graph | encode corridor state | emit a phase plan',
  'METRIC: peak-hour delay',
  'DIRECTION: lower is better',
].join('\n')

const STOP_AFTER_METHOD = 'B2-data'

/**
 * SCOPE NOTE. Only the fixture path is exercised end to end here.
 *
 * B1 sits behind A2, and A2 lands `gated` under a DERIVED claim: the C channel's
 * experiment fixture is keyed by (claimId, prediction), a derived prediction is not
 * in that table, the C gate therefore abstains, and `isInputSatisfied` requires a
 * `passed` producer to unlock A3 — so the chain stops at A2 and B1 is unreachable
 * while a writer is injected. That is the designed fail-closed behaviour, not a
 * defect in this step, and removing the coupling is P5's job (a C channel that can
 * adjudicate an arbitrary claim). B1's own model path is exercised below through
 * `labelledField`, which is the parsing contract it depends on.
 */
describe('B1 method derivation', () => {
  it('stays a labelled fixture when no writer is injected', async () => {
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, { stopBefore: STOP_AFTER_METHOD })

    const spec = getArtifact(store, run.runId, 'method-spec') as MethodSpecShape
    expect(spec.methodSource).toBe('fixture')
    expect(spec.steps.length).toBeGreaterThan(0)
    expect(spec.metric.name.length).toBeGreaterThan(0)
  })

  it('parses the four labelled lines B1 asks the model for', () => {
    expect(labelledField(WELL_FORMED_METHOD, 'FAMILY')).toBe('graph-attention policy over corridor state')
    expect(labelledField(WELL_FORMED_METHOD, 'STEPS')).toBe(
      'build the detector graph | encode corridor state | emit a phase plan',
    )
    expect(labelledField(WELL_FORMED_METHOD, 'METRIC')).toBe('peak-hour delay')
    expect(labelledField(WELL_FORMED_METHOD, 'DIRECTION')).toBe('lower is better')
  })

  it('accepts list markers and label punctuation, and rejects absent labels', () => {
    const decorated = '- FAMILY = decorated family\n* METRIC: decorated metric'
    expect(labelledField(decorated, 'FAMILY')).toBe('decorated family')
    expect(labelledField(decorated, 'METRIC')).toBe('decorated metric')
    // An absent label is undefined — the callers turn that into a failed step.
    expect(labelledField(decorated, 'DIRECTION')).toBeUndefined()
    // An empty value counts as absent, so a blank line cannot pass as a field.
    expect(labelledField('DIRECTION:   ', 'DIRECTION')).toBeUndefined()
  })
})
