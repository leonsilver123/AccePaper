/**
 * ResearchToolInvoker (Phase 2) — unified invocation surface for T19-B.
 *
 * The step executors depend ONLY on this interface — never on the seven tool
 * implementations directly. Two implementations exist:
 *
 *  - DirectResearchToolInvoker  : routes to the single executeResearchTool pure
 *    adapter. Used for fixtures, unit tests and the offline internal pipeline.
 *    truthfulness = 'direct_fixture' and provenance = 'direct' — it is NOT a
 *    ToolRuntime execution and never counts toward Runtime-verified gates.
 *
 *  - (future) AgentLoopResearchToolInvoker : model_ready tools ONLY, through a
 *    real agent-loop minted ToolRuntime execution (truthfulness
 *    'cordis_tool_runtime'). pipeline_only passed to it is rejected. Its
 *    implementation lands with the deterministic agent-loop harness; nothing
 *    misnamed "CordisResearchToolInvoker" will be created.
 */
import { executeResearchTool } from './execution.ts'
import { validateResearchToolInput } from './input-schema.ts'

/** Canonical tool ids (seven P2 tools). */
export type ResearchToolId =
  | 'literature-search'
  | 'citation-verify'
  | 'claim-construct'
  | 'ablation'
  | 'figure'
  | 'three-line-table'
  | 'roadmap'

/** Execution truthfulness of an invocation channel. */
export type ResearchToolTruthfulness = 'direct_fixture' | 'cordis_tool_runtime'

/** Provenance of an invocation channel (execution pathway identity). */
export type ResearchToolProvenance = 'direct' | 'agent-loop-toolruntime'

/** Stable outcome of one invocation (never throws to the caller). */
export type ResearchToolInvocationResult =
  | {
    readonly ok: true
    readonly artifact: unknown
    readonly truthfulness: ResearchToolTruthfulness
    readonly provenance: ResearchToolProvenance
  }
  | {
    readonly ok: false
    readonly code: string
    readonly message: string
    readonly truthfulness: ResearchToolTruthfulness
    readonly provenance: ResearchToolProvenance
  }

/** Invocation context (deterministic timestamps in tests/pipeline). */
export interface ResearchToolInvocationContext {
  readonly timestamp: number
  readonly deps?: import('./execution.ts').ResearchToolDeps
}

/** Unified invocation surface the T19-B registry depends on. */
export interface ResearchToolInvoker {
  readonly truthfulness: ResearchToolTruthfulness
  readonly provenance: ResearchToolProvenance
  invoke(
    toolId: ResearchToolId,
    input: unknown,
    context: ResearchToolInvocationContext,
  ): Promise<ResearchToolInvocationResult>
}

function failure(
  toolId: string,
  error: unknown,
  truthfulness: ResearchToolTruthfulness,
  provenance: ResearchToolProvenance,
): ResearchToolInvocationResult {
  const message = error instanceof Error ? error.message : String(error)
  return {
    ok: false,
    code: message.includes('RESEARCH_TOOL') ? 'RESEARCH_TOOL_EXECUTION_FAILED' : 'RESEARCH_TOOL_INPUT_REJECTED',
    message: `[${toolId}] ${message}`,
    truthfulness,
    provenance,
  }
}

/**
 * Direct (pure adapter) invoker — fixtures / unit tests / offline internal
 * pipeline. See the module header for what it is NOT.
 */
export class DirectResearchToolInvoker implements ResearchToolInvoker {
  readonly truthfulness = 'direct_fixture' as const
  readonly provenance = 'direct' as const

  constructor(private readonly channelLabel = 'direct-fixture') {
    void this.channelLabel
  }

  invoke(
    toolId: ResearchToolId,
    input: unknown,
    context: ResearchToolInvocationContext,
  ): Promise<ResearchToolInvocationResult> {
    // Fail fast on schema BEFORE touching the adapter (defensive; the adapter
    // re-validates — same strict schema, zero business calls on violation).
    const violations = validateResearchToolInput(toolId, input)
    if (violations.length > 0) {
      return Promise.resolve(failure(toolId, new Error(violations.join('; ')), this.truthfulness, this.provenance))
    }
    try {
      const artifact = executeResearchTool(toolId, input, context.deps, context.timestamp)
      return Promise.resolve({ ok: true, artifact, truthfulness: this.truthfulness, provenance: this.provenance })
    } catch (error) {
      return Promise.resolve(failure(toolId, error, this.truthfulness, this.provenance))
    }
  }
}
