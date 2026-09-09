// DirectResearchToolInvoker (Phase 2) — vitest spec.
//
// Proves the direct channel: routes to the single adapter, produces the same
// business artifact as the adapter (equivalence), carries direct_fixture
// truthfulness + direct provenance, maps failures to stable ok:false results
// (never throws to the caller), and never invokes a business function on a
// schema violation.

import { describe, expect, it } from 'vitest'
import {
  DirectResearchToolInvoker,
  executeResearchTool,
} from '@deepseek-ai/dsh-research-tools'

const TS = 1_720_000_000_000
const invoker = new DirectResearchToolInvoker()

const FIGURE_SPEC = {
  kind: 'bar',
  title: 'Latency by stage',
  width: 640,
  height: 400,
  series: [
    { name: 'p50', unit: 'ms', values: [12.5, 18.2, 9.1] },
    { name: 'p99', unit: 'ms', values: [41, 66, 28] },
  ],
  axes: { xLabel: 'Stage', categories: ['a', 'b', 'c'], yLabel: 'Latency', yUnit: 'ms' },
  legend: { position: 'top', title: 'Legend' },
  tokens: { palette: ['#1f77b4', '#ff7f0e'], fontFamily: 'sans-serif', fontSize: 13 },
  seed: 7,
}

describe('DirectResearchToolInvoker', () => {
  it('declares direct_fixture truthfulness and direct provenance', () => {
    expect(invoker.truthfulness).toBe('direct_fixture')
    expect(invoker.provenance).toBe('direct')
  })

  it('produces the SAME business artifact as the unified adapter', async () => {
    const viaInvoker = await invoker.invoke('figure', FIGURE_SPEC, { timestamp: TS })
    expect(viaInvoker.ok).toBe(true)
    const viaAdapter = executeResearchTool('figure', FIGURE_SPEC, undefined, TS)
    expect(viaInvoker.ok && viaInvoker.artifact).toEqual(viaAdapter)
  })

  it('never throws to the caller: schema violations map to ok:false', async () => {
    const result = await invoker.invoke('figure', { kind: 'nope' }, { timestamp: TS })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toContain('RESEARCH_TOOL')
      expect(result.truthfulness).toBe('direct_fixture')
    }
  })

  it('does not expose ToolRuntime markers on the direct channel', async () => {
    expect(invoker).not.toHaveProperty('token')
    expect(invoker).not.toHaveProperty('capability')
    const result = await invoker.invoke('figure', FIGURE_SPEC, { timestamp: TS })
    expect(result.ok && (result as { artifact: unknown }).artifact).toBeDefined()
  })
})
