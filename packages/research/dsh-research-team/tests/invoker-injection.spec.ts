/**
 * DriveOptions.invoker 注入面 — T34 接线验证。
 *
 * `ExecCtx.invoker` 自 T19-R1 起就是执行器的注入点(`a1Executor` 写成
 * `ctx.invoker ?? new DirectResearchToolInvoker(...)`),但 `DriveOptions` /
 * `DriveStepOptions` 此前没有该字段,驱动器无法传递,于是 capability 执行器
 * 永远走 direct_fixture 回退。
 *
 * 本 spec 锁定接线本身:注入的 invoker 必须被 capability 执行器调用,且
 * 未注入时回退路径不受影响。它不验证 LLM 通道——那是 Cordis 适配器层的事。
 */

import { describe, expect, it } from 'vitest'
import type { ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import {
  DirectResearchToolInvoker,
  type ResearchToolId,
  type ResearchToolInvoker,
  type ResearchToolInvocationContext,
} from '@deepseek-ai/dsh-research-tools'

import { runT19B } from '../src/runner/drive.ts'

/** Records which tool ids reached the injected channel, delegating the real work. */
function trackingInvoker(): { readonly invoker: ResearchToolInvoker; readonly invoked: string[] } {
  const invoked: string[] = []
  const inner = new DirectResearchToolInvoker('injected-channel')
  return {
    invoked,
    invoker: {
      truthfulness: 'cordis_tool_runtime',
      provenance: 'agent-loop-toolruntime',
      invoke: (toolId: ResearchToolId, input: unknown, context: ResearchToolInvocationContext) => {
        invoked.push(toolId)
        return inner.invoke(toolId, input, context)
      },
    },
  }
}

describe('DriveOptions.invoker 注入面(T34)', () => {
  it('capability 步骤经注入的 invoker 执行', async () => {
    const { invoker, invoked } = trackingInvoker()
    const store: ResearchRunStore = new Map()

    // A1-landscape (literature-search) 与 A2-claim (claim-construct) 是前两个
    // capability 步骤;停在 A3 之前即可覆盖它们。
    await runT19B(store, { invoker, stopBefore: 'A3-agenda' })

    expect(invoked).toContain('literature-search')
    expect(invoked).toContain('claim-construct')
  })

  it('未注入 invoker 时,capability 步骤走 direct_fixture 回退', async () => {
    const { invoked } = trackingInvoker()
    const store: ResearchRunStore = new Map()

    await runT19B(store, { stopBefore: 'A3-agenda' })

    // 没有注入 → 追踪器不应被触达(回退到执行器内部的 DirectResearchToolInvoker)。
    expect(invoked).toEqual([])
  })
})
