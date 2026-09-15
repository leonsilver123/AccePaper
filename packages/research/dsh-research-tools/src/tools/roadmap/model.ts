// @deepseek-ai/dsh-research-tools — T18 roadmap structured model (pure).
//
// A research roadmap is a directed layered graph: nodes are method/pipeline
// stages, edges are data/control flow. Rendering (Mermaid / SVG) and VSDX
// export consume THIS model — never free-form text. Model is plain data;
// validation lives in ./validate.ts; renderers in ./renderers.ts.

/** Stable tool id of the roadmap tool, carried by every artifact it emits. */
export const ROADMAP_TOOL_ID = 'roadmap'

/** Version of this tool's model and rendering contract. Kept in lockstep with
 *  the package version (0.1.2-alpha.4 at the time of writing). */
export const ROADMAP_TOOL_VERSION = '0.1.2-alpha.4'

/** Globally unique, grep-able error-code prefix for this tool. */
export const ROADMAP_ERROR_PREFIX = 'DSH_ROADMAP_'

/** One roadmap stage: a graph-unique id, the label rendered for it, and an
 *  optional kind tag that no renderer or validator reads — it is authored
 *  metadata, so changing it changes no output. */
export interface RoadmapNode {
  readonly id: string
  readonly label: string
  /**
   * The node's role, as the caller authored it.
   *
   * IGNORED BY EVERY READER. It was documented as a placement hint, but the layered layout places
   * nodes by their edges alone and neither renderer nor the validator consults this field, so
   * changing it changes no output. It survives into the artifact unchanged, which is what lets a
   * reader compare the rendered roadmap with the caller's intent.
   */
  readonly kind?: 'input' | 'process' | 'output' | 'gate'
}

/** A directed data/control-flow edge, referencing node ids that must exist in
 *  the same graph for validation to pass. */
export interface RoadmapEdge {
  readonly from: string
  readonly to: string
  readonly label?: string
}

/** The roadmap model the validators and renderers consume: nodes plus the edges
 *  between them. Rendering reads this structure and never free-form text. */
export interface RoadmapGraph {
  readonly nodes: readonly RoadmapNode[]
  readonly edges: readonly RoadmapEdge[]
}

/** What to render and how to caption it. */
export interface RoadmapRenderOptions {
  readonly format: 'mermaid' | 'svg'
  readonly title?: string
}

/** Structural validation outcome. `errors` lists every structural fault found,
 *  so an empty array is the only signal that the graph may be rendered. */
export interface RoadmapValidation {
  readonly ok: boolean
  readonly errors: readonly string[]
}

/** The frozen result of one render: the content in the requested format, the
 *  validation it passed, and the graph's node and edge counts. An invalid graph
 *  yields `content: ''` alongside `validation.ok: false`, never a partial
 *  render. */
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
