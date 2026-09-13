/**
 * T34 — 16 步单步可运行验证(plan WBS T34 / 质量阶梯②)。
 *
 * plan 的验收判据是"每步可独立调用 + 产出 artifact"。本 spec 不调用
 * `runT19B` 的整体循环,而是**逐次单独调用 `driveStep`**,从而把"单步可运行"
 * 与"整链可运行"分开验证——前者失败而后者通过正是 plan 要防的情形。
 *
 * 诚实边界:`kind === 'real_tool_fixture_input'` 表示该步的工具实现是真的被
 * 执行了,但**输入来自 fixture**;`fixture_executor` 表示返回硬编码数据。两者
 * 都产出结构合法的 artifact,但都不构成"真实科研产出"。本 spec 只锁定
 * "单步可调用 + 产出 artifact + 依赖顺序正确",不声称任何科研有效性。
 */

import { describe, expect, it } from 'vitest'
import {
  createRun,
  getArtifact,
  getStepDefinitions,
  setRunInput,
  type ResearchRunStore,
} from '@deepseek-ai/dsh-research-core'

import { createRunContext, driveStep } from '../src/runner/drive.ts'
import { FIXED_TS } from '../src/runner/registry.ts'
import type { StepOutcome } from '../src/runner/types.ts'

const DOMAIN_DIRECTION = 'adaptive traffic signal control research program'

interface StepRow {
  readonly stepId: string
  readonly kind: StepOutcome['kind']
  readonly status: string
  readonly outputSlugs: ReadonlyArray<string>
}

/** Drive all 16 steps one at a time, recording each step's own outcome. */
async function driveEveryStepIndividually(): Promise<StepRow[]> {
  const store: ResearchRunStore = new Map()
  const runCtx = createRunContext(FIXED_TS)
  const runId = createRun(store)
  setRunInput(store, runId, 'domain-direction', DOMAIN_DIRECTION)

  const rows: StepRow[] = []
  for (const step of getStepDefinitions()) {
    const outcome = await driveStep(store, runId, step.id, { runCtx })
    rows.push({
      stepId: step.id,
      kind: outcome.kind,
      status: outcome.status,
      outputSlugs: outcome.outputSlugs,
    })
  }
  return rows
}

describe('T34 — 16 步单步可运行验证', () => {
  it('每一步都可独立调用并返回结果(无死锁、无依赖越序)', async () => {
    const rows = await driveEveryStepIndividually()

    expect(rows).toHaveLength(16)
    // 每步都返回了确定状态;没有步骤停在 pending(即没有依赖死锁)。
    expect(rows.every(r => r.status !== 'pending')).toBe(true)
  })

  it('除人工门 E2 外,每一步都产出至少一个 artifact', async () => {
    const rows = await driveEveryStepIndividually()
    const producers = rows.filter(r => r.stepId !== 'E2-submit')

    expect(producers).toHaveLength(15)
    for (const row of producers) {
      expect(row.outputSlugs.length, `${row.stepId} 未产出 artifact`).toBeGreaterThan(0)
    }
  })

  it('E2-submit 停在人工门(不得被自动通过)', async () => {
    const rows = await driveEveryStepIndividually()
    const e2 = rows.find(r => r.stepId === 'E2-submit')

    expect(e2?.kind).toBe('humanGate')
    expect(e2?.status).toBe('gated')
    expect(e2?.outputSlugs).toEqual([])
  })

  it('每一步的 artifact 都真实写入 registry(可经 getArtifact 取回)', async () => {
    const store: ResearchRunStore = new Map()
    const runCtx = createRunContext(FIXED_TS)
    const runId = createRun(store)
    setRunInput(store, runId, 'domain-direction', DOMAIN_DIRECTION)

    for (const step of getStepDefinitions()) {
      const outcome = await driveStep(store, runId, step.id, { runCtx })
      for (const slug of outcome.outputSlugs) {
        expect(getArtifact(store, runId, slug), `${step.id}/${slug} 未落库`).toBeDefined()
      }
    }
  })

  it('汇总:真实工具步骤与 fixture 步骤的边界如实分离', async () => {
    const rows = await driveEveryStepIndividually()
    const realTool = rows.filter(r => r.kind === 'real_tool_fixture_input').map(r => r.stepId)
    const localComputation = rows.filter(r => r.kind === 'local_computation').map(r => r.stepId)
    const fixture = rows.filter(r => r.kind === 'fixture_executor').map(r => r.stepId)
    const humanGate = rows.filter(r => r.kind === 'humanGate').map(r => r.stepId)

    // 与 registry 的声明一致:5 步真的执行了目录里的工具函数 / 3 步用本包自己的代码
    // 算出真实测量(无工具、无外部系统)/ 7 步 fixture / 1 人工门。
    // `real_tool_fixture_input` 的含义是"工具函数执行了",报告把它印成
    // "Real tool functions executed" —— 所以本地计算不能挂在这个等级下。
    expect(realTool).toEqual(['A1-landscape', 'A2-claim', 'C3-boundary', 'D1-figure-map', 'E1-format'])
    expect(localComputation).toEqual(['B2-data', 'B3-baseline', 'C1-mvp', 'C2-trinity-loop'])
    expect(fixture).toHaveLength(6)
    expect(humanGate).toEqual(['E2-submit'])
  })
})
