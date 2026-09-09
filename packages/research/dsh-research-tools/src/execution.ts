/**
 * Unified research-tool execution adapter (T13-R phase 1).
 *
 * ONE dispatch map from tool id to its canonical pure function, with injected
 * (fixture) dependencies resolved through a single `deps` bundle. Every consumer
 * — the cordis `ctx.tools` handlers registered by dsh-research-cordis, and the
 * step executors in dsh-research-team (migrated in a later phase) — calls this
 * same adapter, so there is exactly one execution path per tool and the tool
 * behavior can never diverge between the registry and the pipeline.
 *
 * Business input stays serializable (the model-facing JSON schema on the cordis
 * side describes these fields); adapters / executors are NEVER part of the
 * model input — they are injected here (fixture defaults) or by the caller.
 */
import { createMockAblationExecutor, runAblation } from './tools/ablation/index.ts'
import type { AblationDefinition, AblationExecutor } from './tools/ablation/index.ts'
import { verifyCitationTool } from './tools/citation-verify/index.ts'
import type {
  CitationVerifyToolDeps, CitationVerifyToolInput,
} from './tools/citation-verify/index.ts'
import { constructClaim } from './tools/claim-construct/index.ts'
import type { ClaimConstructInput } from './tools/claim-construct/index.ts'
import { renderFigure } from './tools/figure/index.ts'
import type { FigureSpec } from './tools/figure/index.ts'
import { mockLiteratureSearchAdapter, runLiteratureSearch } from './tools/literature-search/index.ts'
import type { LiteratureSearchAdapter } from './tools/literature-search/index.ts'
import { renderRoadmap } from './tools/roadmap/index.ts'
import type { RoadmapGraph, RoadmapRenderOptions } from './tools/roadmap/index.ts'
import { renderThreeLineTable } from './tools/three-line-table/index.ts'
import type { ThreeLineTableModel, ThreeLineTableTarget } from './tools/three-line-table/index.ts'
import { validateResearchToolInput } from './input-schema.ts'

/** Injected dependencies for the tools whose real input is an adapter/executor. */
export interface ResearchToolDeps {
  /** Literature corpus adapter (fixture mock by default). */
  readonly literatureAdapter?: LiteratureSearchAdapter
  /** Ablation experiment executor (fixture mock by default). */
  readonly ablationExecutor?: AblationExecutor
  /** Citation resolver dependency (REQUIRED for citation-verify). */
  readonly citationDeps?: CitationVerifyToolDeps
}

/** Raised on an unknown tool id or a structurally invalid business input. */
export class ResearchToolExecutionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResearchToolExecutionError'
  }
}

function requireDepsField(
  deps: ResearchToolDeps | undefined,
  key: keyof ResearchToolDeps,
  toolId: string,
): unknown {
  const value = deps?.[key]
  if (value === undefined) {
    throw new ResearchToolExecutionError(
      `[${toolId}] requires an injected '${key}' dependency (fixture/service closure)`,
    )
  }
  return value
}

/**
 * Execute one registered research tool through the single dispatch map.
 * @param toolId - canonical tool id (RESEARCH_TOOL_DIRECTORY entry).
 * @param input - serializable business input for the tool.
 * @param deps - injected adapters/executors; fixture defaults where safe.
 * @param timestamp - epoch ms (deterministic in tests).
 * @returns the canonical tool artifact (same shape as a direct pure-function call).
 */
export function executeResearchTool(
  toolId: string,
  input: unknown,
  deps?: ResearchToolDeps,
  timestamp: number = Date.now(),
): unknown {
  // Strict per-tool schema runs FIRST: an invalid input must never reach a
  // business function (zero calls on failure).
  const violations = validateResearchToolInput(toolId, input)
  if (violations.length > 0) {
    throw new ResearchToolExecutionError(
      `[${toolId}] input rejected by strict schema:\n- ${violations.join('\n- ')}`,
    )
  }
  switch (toolId) {
    case 'literature-search': {
      const record = input as Record<string, unknown>
      const adapter = deps?.literatureAdapter ?? mockLiteratureSearchAdapter
      return runLiteratureSearch({ topic: String(record.topic) }, adapter, timestamp)
    }
    case 'citation-verify': {
      const depsField = requireDepsField(deps, 'citationDeps', toolId) as CitationVerifyToolDeps
      return verifyCitationTool(input as CitationVerifyToolInput, depsField)
    }
    case 'claim-construct': {
      return constructClaim(input as ClaimConstructInput)
    }
    case 'ablation': {
      const record = input as Record<string, unknown>
      const executor = deps?.ablationExecutor ?? createMockAblationExecutor()
      return runAblation(record.definition as AblationDefinition, executor, timestamp)
    }
    case 'figure': {
      return renderFigure(input as FigureSpec, timestamp)
    }
    case 'three-line-table': {
      const record = input as Record<string, unknown>
      return renderThreeLineTable(
        record.model as ThreeLineTableModel,
        record.target as ThreeLineTableTarget,
        timestamp,
      )
    }
    case 'roadmap': {
      const record = input as Record<string, unknown>
      return renderRoadmap(
        record.graph as RoadmapGraph,
        (record.options ?? {}) as RoadmapRenderOptions,
        timestamp,
      )
    }
    default:
      throw new ResearchToolExecutionError(`unknown research tool id '${toolId}'`)
  }
}
