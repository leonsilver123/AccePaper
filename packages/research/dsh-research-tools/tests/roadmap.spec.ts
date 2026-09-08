// @deepseek-ai/dsh-research-tools — T18 roadmap tool contract tests.

import { describe, expect, it } from 'vitest'

import { renderRoadmap, validateRoadmap, topoLayers } from '../src/tools/roadmap/index.ts'
import type { RoadmapGraph } from '../src/tools/roadmap/model.ts'

const validGraph: RoadmapGraph = {
  nodes: [
    { id: 'input', label: '文献/数据' },
    { id: 'method', label: '方法推导' },
    { id: 'mvp', label: 'MVP' },
    { id: 'out', label: '结果' },
  ],
  edges: [
    { from: 'input', to: 'method' },
    { from: 'method', to: 'mvp' },
    { from: 'mvp', to: 'out' },
  ],
}

describe('validateRoadmap — structural checks (U4 leg 1)', () => {
  it('passes a valid acyclic graph', () => {
    const v = validateRoadmap(validGraph)
    expect(v.ok).toBe(true)
    expect(v.errors).toEqual([])
  })

  it('flags duplicate node ids', () => {
    const g: RoadmapGraph = { nodes: [{ id: 'a', label: 'A' }, { id: 'a', label: 'A2' }], edges: [] }
    expect(validateRoadmap(g).ok).toBe(false)
    expect(validateRoadmap(g).errors.join()).toContain('duplicate node id')
  })

  it('flags empty labels', () => {
    const g: RoadmapGraph = { nodes: [{ id: 'a', label: '  ' }], edges: [] }
    expect(validateRoadmap(g).errors.join()).toContain('empty label')
  })

  it('flags dangling edge references and self-loops', () => {
    const g: RoadmapGraph = {
      nodes: [{ id: 'a', label: 'A' }],
      edges: [{ from: 'a', to: 'b' }, { from: 'a', to: 'a' }],
    }
    const errors = validateRoadmap(g).errors.join()
    expect(errors).toContain("target 'b' is not a node")
    expect(errors).toContain('self-loop')
  })

  it('detects a directed cycle', () => {
    const g: RoadmapGraph = {
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
    }
    expect(validateRoadmap(g).ok).toBe(false)
    expect(validateRoadmap(g).errors.join()).toContain('cycle')
  })
})

describe('topoLayers', () => {
  it('returns layers in dependency order', () => {
    const layers = topoLayers(validGraph)
    expect(layers.flat()).toHaveLength(4)
    expect(layers[0]?.[0]).toBe('input')
  })
})

describe('renderRoadmap', () => {
  it('renders Mermaid source for a valid graph', () => {
    const a = renderRoadmap(validGraph, { format: 'mermaid' }, 1)
    expect(a.validation.ok).toBe(true)
    expect(a.content).toContain('flowchart LR')
    expect(a.content).toContain('-->')
    expect(a.content).toContain('方法推导')
    expect(a.nodeCount).toBe(4)
    expect(a.edgeCount).toBe(3)
  })

  it('renders layered SVG for a valid graph', () => {
    const a = renderRoadmap(validGraph, { format: 'svg' }, 1)
    expect(a.content.startsWith('<svg')).toBe(true)
    expect(a.content).toContain('</svg>')
    expect(a.content).toContain('<rect')
    expect(a.content).toContain('<path')
  })

  it('returns ok:false and empty content for an invalid (cyclic) graph', () => {
    const g: RoadmapGraph = {
      nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
      edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
    }
    const a = renderRoadmap(g, { format: 'mermaid' }, 1)
    expect(a.validation.ok).toBe(false)
    expect(a.content).toBe('')
  })

  it('is deterministic: two renders of the same graph are identical', () => {
    const a = renderRoadmap(validGraph, { format: 'svg', title: 't' }, 1)
    const b = renderRoadmap(validGraph, { format: 'svg', title: 't' }, 1)
    expect(a.content).toBe(b.content)
  })

  it('returns a frozen artifact', () => {
    const a = renderRoadmap(validGraph, { format: 'mermaid' }, 1)
    expect(() => {
      ;(a as unknown as { content: string }).content = 'x'
    }).toThrow(TypeError)
  })

  it('escapes XML in SVG labels', () => {
    const g: RoadmapGraph = { nodes: [{ id: 'n', label: '<b>&"x"' }], edges: [] }
    const a = renderRoadmap(g, { format: 'svg' }, 1)
    expect(a.content).not.toContain('<b>')
    expect(a.content).toContain('&lt;b&gt;')
  })
})
