/**
 * ResearchToolInvoker (Phase 2) — unified invocation surface for T19-B.
 *
 * The step executors depend ONLY on this interface — never on the seven tool
 * implementations directly. Two implementations exist:
 *
 *  - DirectResearchToolInvoker  : routes to the single executeResearchTool pure
 *    adapter — the research layer calls the tool function itself. Used for
 *    fixtures, unit tests and the offline internal pipeline. truthfulness =
 *    'direct_call' and provenance = 'direct'.
 *
 *  - AgentLoopResearchToolInvoker (dsh-research-cordis) : model_ready tools ONLY,
 *    through a real agent-loop minted ToolRuntime execution (truthfulness
 *    'host_tool_runtime'). pipeline_only passed to it is rejected.
 *
 * ── TWO INDEPENDENT FACTS, AND WHY THE NAMES SAY ONLY ONE ─────────────────────
 * 'direct_call' describes the CALL PATH. It says NOTHING about the data: a direct
 * call is not a fixture. The four `pipeline_only` tools are ALWAYS called directly
 * today, and they may return real records (the retrieval channel is configured
 * from cordis.yml and reaches a live catalogue where one is set). The reverse
 * holds too: a channel that runs through the host runtime may still be handed
 * fixture input.
 *
 * So neither label, alone or together, means "this conclusion is verified". What
 * the data actually was is recorded where the data enters — on the adapter and on
 * the artifact's own `corpus`/`source`/`*Source` fields — and a tool result is
 * never evidence that the claim it feeds is true.
 *
 * The four `pipeline_only` tools are called by the research layer DIRECTLY: they do
 * not enter the host's tool runtime and are not covered by its permission checks,
 * sandbox, or audit records. The research layer keeps its own input/output
 * correlation and error records; that is not the same as host-unified management,
 * and it must not be described as such. This is an ACCEPTED architecture boundary,
 * not a defect awaiting a fix (see plan/MASTER-PLAN.md § D5).
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

/**
 * How an invocation reached the tool: called directly by the research layer, or
 * through the host's tool runtime. It says nothing about the data or the conclusion.
 */
export type ResearchToolTruthfulness = 'direct_call' | 'host_tool_runtime'

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
  readonly truthfulness = 'direct_call' as const
  readonly provenance = 'direct' as const

  constructor(private readonly channelLabel = 'direct-fixture') {
    void this.channelLabel
  }

  async invoke(
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
      // Awaited: `executeResearchTool` is asynchronous because externally-backed
      // tools perform a network round trip. The await also keeps the failure path
      // honest — a rejection must land in this catch rather than escaping as an
      // unhandled rejection, which would defeat the fail-closed mapping below.
      const artifact = await executeResearchTool(toolId, input, context.deps, context.timestamp)
      return { ok: true, artifact, truthfulness: this.truthfulness, provenance: this.provenance }
    } catch (error) {
      return failure(toolId, error, this.truthfulness, this.provenance)
    }
  }
}
