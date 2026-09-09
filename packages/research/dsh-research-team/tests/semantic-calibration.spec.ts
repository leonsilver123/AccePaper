// T19 semantic calibration (A3/R2) — vitest spec.
//
// Proves every canonical step carries an explicit RESEARCH task distinct from
// any tool id (tools are capabilities, never steps), and that the static
// channel breakdown is complete (16 rows, E2=human).

import { describe, expect, it } from 'vitest'
import {
  PIPELINE_STEPS,
  invocationChannelSummary,
  perStepInvocationChannels,
  SEMANTIC_TASKS,
  STEP_CAPABILITIES,
  assertSemanticTasksHonest,
  stepChannelBreakdown,
} from '../src/runner/registry.ts'

describe('T19 semantic calibration (semanticTask ≠ tool)', () => {
  it('covers exactly the 16 canonical steps with a non-empty research task', () => {
    expect(Object.keys(SEMANTIC_TASKS).sort()).toEqual(PIPELINE_STEPS.map(step => step.id).sort())
    for (const task of Object.values(SEMANTIC_TASKS)) {
      expect(task.trim().length).toBeGreaterThan(10)
    }
  })

  it('passes the honesty assertion (no step id equals a capability tool id)', () => {
    expect(() => { assertSemanticTasksHonest() }).not.toThrow()
    const stepIds = new Set(PIPELINE_STEPS.map(step => step.id))
    const toolIds = new Set<string>()
    for (const caps of Object.values(STEP_CAPABILITIES)) {
      for (const cap of caps) toolIds.add(cap.toolId)
    }
    for (const id of stepIds) {
      expect(toolIds.has(id), `step '${id}' must not collide with a tool id`).toBe(false)
    }
  })

  it('the 16-step research semantics forbid tool-as-step substitution', () => {
    // Guard the canonical red lines textually: agenda ≠ keyword, B3 ≠ ablation,
    // D3 ≠ figure, E1 ≠ table.
    const agenda = SEMANTIC_TASKS['A3-agenda']
    expect(agenda).toMatch(/议程/)
    expect(SEMANTIC_TASKS['B3-baseline']).not.toMatch(/消融/)
    expect(SEMANTIC_TASKS['D3-writing']).not.toMatch(/画图|渲染/)
    expect(SEMANTIC_TASKS['E1-format']).not.toMatch(/^表格/)
  })

  it('channel breakdown is complete with E2 human and model-ready-capable D1', () => {
    const breakdown = stepChannelBreakdown()
    expect(breakdown).toHaveLength(16)
    expect(breakdown.map(row => row.stepId).sort()).toEqual(PIPELINE_STEPS.map(s => s.id).sort())
    expect(breakdown.find(row => row.stepId === 'E2-submit')?.channel).toBe('human')
    expect(breakdown.find(row => row.stepId === 'D1-figure-map')?.channel).toContain('model-ready')
  })
})

describe('R3 per-step invocation channel (planned vs actual)', () => {
  it('e2e-default ACTUAL channel mix: 5 direct (incl D1), 10 fixture, 1 human, 0 agent-loop', () => {
    const summary = invocationChannelSummary()
    const byName = Object.fromEntries(summary.map(stat => [stat.channel, stat]))
    expect(byName.direct.count).toBe(5) // A1 A2 C3 D1 E1 all default Direct in E2E
    expect(byName.fixture.count).toBe(10)
    expect(byName.human.count).toBe(1)
    expect(byName['agent-loop']).toBeUndefined()
    expect([...byName.direct.stepIds, ...byName.fixture.stepIds, ...byName.human.stepIds]).toHaveLength(16)
  })

  it('separates PLANNED (agent-loop-capable D1) from ACTUAL (direct with fallbackReason)', () => {
    const rows = perStepInvocationChannels('e2e-default')
    const d1 = rows.find(row => row.stepId === 'D1-figure-map')!
    expect(d1.plannedChannel).toBe('agent-loop')
    expect(d1.actualChannel).toBe('direct')
    expect(d1.invokerKind).toBe('DirectResearchToolInvoker')
    expect(d1.toolRuntimeExecutionId).toBeUndefined()
    expect(d1.truthfulness).toBe('real_tool_fixture_input')
    expect(d1.fallbackReason).toMatch(/no AgentLoop invoker injected/)
    // no step may claim an actual agent-loop channel in default E2E
    expect(rows.some(row => row.actualChannel === 'agent-loop')).toBe(false)
  })

  it('agent-loop-injected mode records D1 as actual agent-loop with an execution id', () => {
    const rows = perStepInvocationChannels('agent-loop-injected')
    const d1 = rows.find(row => row.stepId === 'D1-figure-map')!
    expect(d1.actualChannel).toBe('agent-loop')
    expect(d1.invokerKind).toBe('AgentLoopResearchToolInvoker')
    expect(d1.toolRuntimeExecutionId).toBe('minted-by-agent-loop')
  })
})
