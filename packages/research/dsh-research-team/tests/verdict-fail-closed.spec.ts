// @deepseek-ai/dsh-research-team — T19-S P2-1 regression: the C gate must be
// FAIL-CLOSED when there is no experiment report, exactly like the C1-mvp
// executor that feeds it.
//
// Background (independent T19-S audit, P2-1): `verdictC` used to fabricate a
// keep-path report (`supportsPrediction: true`) whenever the experiment fixture
// lookup missed, while `c1Executor` (registry.ts) throws on the very same miss —
// an asymmetry that handed the C gate a default pass. Both sides now fail closed:
// no experiment ⇒ no adjudication ⇒ `abstained`, core holds the step.

import { describe, expect, it } from 'vitest'
import { getStepDefinitionById } from '@deepseek-ai/dsh-research-core'
import type { StepDefinition } from '@deepseek-ai/dsh-research-core'

import { createRunContext } from '../src/runner/drive.ts'
import { buildStepVerdicts } from '../src/runner/verdict.ts'
import type { VerdictBuildCtx } from '../src/runner/types.ts'

const C2: StepDefinition | undefined = getStepDefinitionById('C2-trinity-loop')

describe('T19-S — C-channel fail-closed symmetry with C1-mvp', () => {
  it('abstains when the experiment fixture row is missing (no default pass)', () => {
    if (C2 === undefined) throw new Error('verdict-fail-closed: C2-trinity-loop is not a core step')
    const runCtx = createRunContext()
    runCtx.claimId = 'mock-claim-999'
    runCtx.claimRef = 'missing row'
    runCtx.predictionText = 'no such experiment row'
    const ctx: VerdictBuildCtx = { step: C2, attemptId: 1, runCtx, abstain: new Set() }

    const built = buildStepVerdicts(ctx)
    const c = built.find(v => v.component === 'C')
    expect(c).toBeDefined()
    expect(c?.outcome).toBe('abstained')
    expect(c?.passed).toBe(false)
    expect(String(c?.evidence)).toContain('no experiment fixture row')
    expect(String(c?.evidence)).toContain('fail-closed')
    // The miss must NOT be smuggled in as support.
    expect(String(c?.evidence)).not.toContain('exp-fixture-synthetic')
  })

  it('still adjudicates to `passed` when the fixture row exists (happy path sanity)', () => {
    if (C2 === undefined) throw new Error('verdict-fail-closed: C2-trinity-loop is not a core step')
    const runCtx = createRunContext()
    const ctx: VerdictBuildCtx = { step: C2, attemptId: 1, runCtx, abstain: new Set() }

    const built = buildStepVerdicts(ctx)
    const c = built.find(v => v.component === 'C')
    expect(c?.outcome).toBe('passed')
    // The real fixture row is used, not a synthetic fallback.
    expect(String(c?.evidence)).toContain('mock_external experiment')
  })
})
