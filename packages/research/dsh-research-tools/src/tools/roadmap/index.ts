// @deepseek-ai/dsh-research-tools — T18 roadmap tool entry (pure).
//
// renderRoadmap(model, options, timestamp): structural check first (U4 leg 1:
// automatic structural validation), then deterministic render to Mermaid or
// layered SVG. VSDX export stays DEGRADED until a python `vsdx` adapter is
// available (U6/D17 allows degradation; Mermaid/SVG/PNG must not block).
// No file writes, no randomness, no external calls.

import { freezeArtifact } from '../../shared.ts'
import type { RoadmapArtifact, RoadmapGraph, RoadmapRenderOptions, RoadmapValidation } from './model.ts'
import { ROADMAP_TOOL_ID, ROADMAP_TOOL_VERSION } from './model.ts'
import { validateRoadmap } from './validate.ts'
import { renderMermaid, renderSvg } from './renderers.ts'

export * from './model.ts'
export { validateRoadmap, topoLayers } from './validate.ts'

/**
 * Validate then render a roadmap graph. Never throws on structure problems:
 * an invalid graph returns an artifact with validation.ok=false and a short
 * reason (renderers are only invoked on ok:true graphs).
 */
export function renderRoadmap(
  graph: RoadmapGraph,
  options: RoadmapRenderOptions,
  _timestamp: number,
): Readonly<RoadmapArtifact> {
  const validation: Readonly<RoadmapValidation> = validateRoadmap(graph)
  const base: Omit<RoadmapArtifact, 'content' | 'validation'> = {
    toolId: ROADMAP_TOOL_ID,
    toolVersion: ROADMAP_TOOL_VERSION,
    format: options.format,
    ...(options.title === undefined ? {} : { title: options.title }),
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
  }
  if (!validation.ok) {
    return freezeArtifact<RoadmapArtifact>({
      ...base,
      content: '',
      validation,
    })
  }
  const content = options.format === 'mermaid' ? renderMermaid(graph, options.title) : renderSvg(graph)
  return freezeArtifact<RoadmapArtifact>({
    ...base,
    content,
    validation,
  })
}
