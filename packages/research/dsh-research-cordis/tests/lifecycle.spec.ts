import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { ResearchEngine } from '../src/index.ts'

// P1.6 v2 thin Cordis adapter over the hardened dsh-research-core. Covers the lifecycle seams
// (load / unload / error / idempotency) + the trust-boundary guarantee that the Agent-callable
// service surface exposes NO human-approval capability. State-machine behavior itself is pinned
// by dsh-research-core's own suite; these exercise the adapter wiring only.

describe('ResearchEngine Cordis adapter (P1.6 v2)', () => {
  it('loads: ctx.plugin registers ctx.research + delegates to the pure core (runId-keyed)', async () => {
    const ctx = new Context()
    await ctx.plugin(ResearchEngine)
    expect(ctx.research).toBeInstanceOf(ResearchEngine)
    const runId = ctx.research.createRun()
    ctx.research.setRunInput(runId, 'domain-direction', 'ML')
    expect(ctx.research.canStart(runId, 'A1-landscape')).toBe(true)
  })

  it('unloads: disposing the fiber unregisters ctx.research (cleanup effect runs)', async () => {
    const ctx = new Context()
    await ctx.plugin(ResearchEngine)
    expect(ctx.research).toBeInstanceOf(ResearchEngine)
    await ctx.fiber.dispose()
    expect(ctx.research as ResearchEngine | undefined).toBeUndefined()
  })

  it('propagates core errors: startStep on a missing run throws RUN_NOT_FOUND (never auto-creates)', async () => {
    const ctx = new Context()
    await ctx.plugin(ResearchEngine)
    expect(() => ctx.research.startStep('ghost', 'A1-landscape')).toThrow(/RUN_NOT_FOUND/)
  })

  it('idempotent load→unload across fresh contexts (no throw, fresh state each cycle)', async () => {
    for (let i = 0; i < 2; i++) {
      const ctx = new Context()
      await ctx.plugin(ResearchEngine)
      expect(ctx.research).toBeInstanceOf(ResearchEngine)
      const runId = ctx.research.createRun()
      // fresh run, no seed → A1 cannot start (proves the new ctx's store is empty, not leaked)
      expect(ctx.research.canStart(runId, 'A1-landscape')).toBe(false)
      await ctx.fiber.dispose()
      expect(ctx.research as ResearchEngine | undefined).toBeUndefined()
    }
  })

  it('exposes NO trust capability on the service surface (transition / approveHumanGate / submitHumanApproval absent)', async () => {
    const ctx = new Context()
    await ctx.plugin(ResearchEngine)
    const r = ctx.research as unknown as Record<string, unknown>
    expect(r.transition).toBeUndefined()
    expect(r.approveHumanGate).toBeUndefined()
    expect(r.submitHumanApproval).toBeUndefined()
    expect(r.createHostApprovalChannel).toBeUndefined()
  })

  it('RC-C: the run store is runtime-private — ctx.research.runs is undefined (TS private ≠ runtime-private)', async () => {
    const ctx = new Context()
    await ctx.plugin(ResearchEngine)
    const r = ctx.research as unknown as Record<string, unknown>
    // TS `private` is compile-time-only (runtime-erased to a plain property); the ES private
    // field `#runs` is genuinely runtime-inaccessible, so `ctx.research.runs` is undefined.
    expect(r.runs).toBeUndefined()
    // sanity: the service still delegates correctly to the (now-inaccessible) store
    const runId = ctx.research.createRun()
    ctx.research.setRunInput(runId, 'domain-direction', 'ML')
    expect(ctx.research.canStart(runId, 'A1-landscape')).toBe(true)
  })
})
