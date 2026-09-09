/**
 * RESEARCH_TOOL_DIRECTORY — the single auditable registration surface for the
 * seven P2 research tools (T12–T18).
 *
 * Task #13 scope decision (honest gap, not ceremony): the tools in this package
 * are PURE, fixture-driven functions consumed by the pipeline executors in
 * `dsh-research-team` (real_tool_fixture_input / fixture_executor semantics —
 * audited through T19-S). They are NOT yet exposed on the model-facing
 * `ctx.tools` agent surface, for three concrete reasons recorded per entry:
 *
 *   1. No runtime consumer: the step drive layer (`drive.ts`) and every executor
 *      call these functions directly; nothing reads `ctx.tools` today, so a full
 *      cordis `defineTool` + `ctx.tools.register` wiring would be ceremonial
 *      dead code (it would also drag the huge model-facing schema/render
 *      contract onto functions whose real inputs are injected adapters).
 *   2. Input reality: `literature-search` / `citation-verify` / `ablation` take
 *      injected adapters or executors (fixture in this wave) — an agent call
 *      cannot supply them; `claim-construct` is bound to the canonical fixture
 *      scenario. Agent-callable form requires the live-gateway wave (J6), which
 *      is not part of this offline segment.
 *   3. Forward bridge: when the model-exposable wave lands, this directory is
 *      the registry those `defineTool` wrappers enumerate from — one tool row,
 *      one canonical function set, one exposure verdict with a reason.
 *
 * This file is cordis-free by design (the package is a pure library, not a
 * Cordis plugin); the directory is the durable, auditable "registered tool"
 * truth source the executors' STEP_CAPABILITIES map can be checked against.
 */
import {
  ABLATION_TOOL_ID,
  ABLATION_TOOL_VERSION,
} from './tools/ablation/index.ts'
import {
  CITATION_VERIFY_TOOL_ID,
  CITATION_VERIFY_TOOL_VERSION,
} from './tools/citation-verify/index.ts'
import {
  CLAIM_CONSTRUCT_TOOL_ID,
  CLAIM_CONSTRUCT_TOOL_VERSION,
} from './tools/claim-construct/index.ts'
import {
  FIGURE_TOOL_ID,
  FIGURE_TOOL_VERSION,
} from './tools/figure/index.ts'
import {
  LITERATURE_SEARCH_TOOL_ID,
  LITERATURE_SEARCH_TOOL_VERSION,
} from './tools/literature-search/index.ts'
import {
  ROADMAP_TOOL_ID,
  ROADMAP_TOOL_VERSION,
} from './tools/roadmap/index.ts'
import {
  THREE_LINE_TABLE_TOOL_ID,
  THREE_LINE_TABLE_TOOL_VERSION,
} from './tools/three-line-table/index.ts'

/**
 * Whether a tool is safe to expose on the model-facing `ctx.tools` agent
 * surface TODAY (offline, fixture-only wave):
 *  - `pipeline_only` : its real input is an injected adapter/executor or it is
 *    bound to the canonical fixture scenario → only the step pipeline calls it.
 *  - `model_ready`   : pure render over declared data → a future defineTool
 *    wrapper can bridge it to the agent loop without a live gateway.
 */
export type ModelExposure = 'pipeline_only' | 'model_ready'

/** One registered research tool row (metadata + exposure verdict). */
export interface ResearchToolDirectoryEntry {
  /** Canonical tool id (identical to the exported *_TOOL_ID const). */
  readonly toolId: string
  /** Display name of the tool. */
  readonly name: string
  /** Tool version (identical to the exported *_TOOL_VERSION const). */
  readonly version: string
  /** One-line description of the tool's capability. */
  readonly summary: string
  /** Canonical exported functions that implement the tool (documentation refs). */
  readonly canonicalFunctions: ReadonlyArray<string>
  /** Steps in the canonical pipeline that consume this tool (from STEP_CAPABILITIES). */
  readonly consumedBySteps: ReadonlyArray<string>
  /** Model-facing exposure verdict for this wave. */
  readonly modelExposure: ModelExposure
  /** WHY the verdict holds — every non-obvious row must justify itself. */
  readonly reason: string
}

/**
 * The seven P2 research tools, in canonical batch order (T12–T18). The
 * `toolId`/`version` fields are the exported constants themselves, so a row can
 * never drift from the function it documents.
 */
export const RESEARCH_TOOL_DIRECTORY: ReadonlyArray<ResearchToolDirectoryEntry> = [
  {
    toolId: LITERATURE_SEARCH_TOOL_ID,
    name: 'literature-search',
    version: LITERATURE_SEARCH_TOOL_VERSION,
    summary: 'Landscape retrieval over an injected corpus adapter (synthetic fixture this wave).',
    canonicalFunctions: ['runLiteratureSearch', 'mockLiteratureSearchAdapter'],
    consumedBySteps: ['A1-landscape', 'B3-baseline'],
    modelExposure: 'pipeline_only',
    reason: 'runLiteratureSearch takes an injected corpus adapter; an agent call cannot supply it without the live gateway (J6). B3-SOTA sub-task is wired:false (off-domain corpus) — see STEP_CAPABILITIES.',
  },
  {
    toolId: CITATION_VERIFY_TOOL_ID,
    name: 'citation-verify',
    version: CITATION_VERIFY_TOOL_VERSION,
    summary: 'Thin delegation over core verifyCitation with a resolver dependency (mock_external in gates).',
    canonicalFunctions: ['verifyCitationTool'],
    consumedBySteps: [],
    modelExposure: 'pipeline_only',
    reason: 'Gate channel (mock_external) rather than a step executor tool; requires a citation resolver in deps — agent-callable form waits for the live resolver wave.',
  },
  {
    toolId: CLAIM_CONSTRUCT_TOOL_ID,
    name: 'claim-construct',
    version: CLAIM_CONSTRUCT_TOOL_VERSION,
    summary: 'Claim + falsifiable-prediction construction over the canonical research scenario.',
    canonicalFunctions: ['constructClaim', 'runClaimConstruct'],
    consumedBySteps: ['A2-claim'],
    modelExposure: 'pipeline_only',
    reason: 'Bound to the canonical fixture scenario (fixed claim id/assertion/falsifiability in the A2 executor); an agent call would only replay the canned fixture.',
  },
  {
    toolId: ABLATION_TOOL_ID,
    name: 'ablation',
    version: ABLATION_TOOL_VERSION,
    summary: 'Boundary probing: records planned/executed/failed ablation runs over an injected executor.',
    canonicalFunctions: ['runAblation', 'createMockAblationExecutor'],
    consumedBySteps: ['C3-boundary'],
    modelExposure: 'pipeline_only',
    reason: 'runAblation takes an injected experiment executor (fixture this wave) and emits measurements only — never a delta/conclusion; agent exposure needs the real experiment runner wave.',
  },
  {
    toolId: FIGURE_TOOL_ID,
    name: 'figure',
    version: FIGURE_TOOL_VERSION,
    summary: 'Deterministic SVG + real-byte PNG data-figure render over a declared spec.',
    canonicalFunctions: ['renderFigure'],
    consumedBySteps: ['D1-figure-map'],
    modelExposure: 'model_ready',
    reason: 'Pure render over declared data with zero third-party runtime deps; a defineTool wrapper can bridge it to the agent loop without any gateway.',
  },
  {
    toolId: THREE_LINE_TABLE_TOOL_ID,
    name: 'three-line-table',
    version: THREE_LINE_TABLE_TOOL_VERSION,
    summary: 'One structured model rendered as GitHub Markdown (3 rules) or LaTeX booktabs.',
    canonicalFunctions: ['renderThreeLineTable'],
    consumedBySteps: ['D1-figure-map', 'E1-format'],
    modelExposure: 'model_ready',
    reason: 'Pure render over a declared table model; directly bridgeable to the agent loop.',
  },
  {
    toolId: ROADMAP_TOOL_ID,
    name: 'roadmap',
    version: ROADMAP_TOOL_VERSION,
    summary: 'Phase-layered roadmap figure render (figure family of D1).',
    canonicalFunctions: ['renderRoadmap'],
    consumedBySteps: ['D1-figure-map'],
    modelExposure: 'model_ready',
    reason: 'Pure render over a declared roadmap graph; directly bridgeable to the agent loop.',
  },
]

/** Lookup one directory row by canonical tool id. */
export function getResearchToolDirectoryEntry(toolId: string): ResearchToolDirectoryEntry | undefined {
  return RESEARCH_TOOL_DIRECTORY.find(entry => entry.toolId === toolId)
}

/** Tool ids of the tools an agent loop could call today without a live gateway. */
export function modelReadyToolIds(): ReadonlyArray<string> {
  return RESEARCH_TOOL_DIRECTORY
    .filter(entry => entry.modelExposure === 'model_ready')
    .map(entry => entry.toolId)
}

/** Honesty gate: every row that is not fully exposed must carry a reason. */
export function assertDirectoryHonest(): void {
  for (const entry of RESEARCH_TOOL_DIRECTORY) {
    if (entry.modelExposure !== 'model_ready' && entry.reason.trim().length === 0) {
      throw new Error(`RESEARCH_TOOL_DIRECTORY: '${entry.toolId}' is not model_ready but has no reason`)
    }
  }
}
