// @deepseek-ai/dsh-research-tools — T18 roadmap structured model (pure).
//
// A research roadmap is a directed layered graph: nodes are method/pipeline
// stages, edges are data/control flow. Rendering (Mermaid / SVG) and VSDX
// export consume THIS model — never free-form text. Model is plain data;
// validation lives in ./validate.ts; renderers in ./renderers.ts.

export const ROADMAP_TOOL_ID = 'roadmap'
export const ROADMAP_TOOL_VERSION = '0.1.2-alpha.4'
export const ROADMAP_ERROR_PREFIX = 'DSH_ROADMAP_'

export interface RoadmapNode {
  readonly id: string
  readonly label: string
  /** Optional free-placement hint; ignored by layered layout. */
  readonly kind?: 'input' | 'process' | 'output' | 'gate'
}

export interface RoadmapEdge {
  readonly from: string
  readonly to: string
  readonly label?: string
}

export interface RoadmapGraph {
  readonly nodes: readonly RoadmapNode[]
  readonly edges: readonly RoadmapEdge[]
}

export interface RoadmapRenderOptions {
  readonly format: 'mermaid' | 'svg'
  readonly title?: string
}

export interface RoadmapValidation {
  readonly ok: boolean
  readonly errors: readonly string[]
}

export interface RoadmapArtifact {
  readonly toolId: typeof ROADMAP_TOOL_ID
  readonly toolVersion: typeof ROADMAP_TOOL_VERSION
  readonly format: RoadmapRenderOptions['format']
  readonly title?: string
  readonly content: string
  readonly validation: RoadmapValidation
  readonly nodeCount: number
  readonly edgeCount: number
}
