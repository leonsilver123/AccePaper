/**
 * The tool an agent calls to record a change the person asked for in the conversation.
 *
 * WHY THE CONVERSATION NEEDS A DOOR AT ALL. A person hands a research run its requirements by talking —
 * "tighten the results section", "the claim is stronger than the measurement" — and until now the only
 * way for that to reach the run was for them to type it into the panel's own controls. The agent could
 * understand the request and had nowhere to put it.
 *
 * WHAT THIS TOOL CANNOT DO, and the difference is the point. It records a CHANGE REQUEST, which is
 * information: something the person wants changed, which the run answers with a candidate the person
 * still has to judge. It cannot approve, reject or submit anything. Those are decisions, `approval.ts`
 * owns them, they travel the host's authenticated browser channel, and they carry the operator's name.
 * A tool that could take a decision would let a model attribute one to a person who never made it.
 *
 * THE SCHEMA IS THE BOUNDARY, not the handler's good behaviour. There is no `decision` parameter, no
 * `approved` flag, and no field a caller could smuggle one through: an approval cannot be expressed
 * here at all, because `defineTool` validates the arguments against this schema before the handler
 * runs.
 *
 * WHAT IT CLAIMS ABOUT THE PERSON, exactly. The record it writes is stamped `conversation`, and the
 * panel says "the agent recorded this from the conversation (not something you confirmed here)" — a
 * claim about what the agent did, never one about what the person said. The agent can mishear; the
 * record must not overwrite that possibility with the person's voice.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'

/** The tool id an agent calls to record a change the person asked for in the conversation. */
export const RECORD_CHANGE_REQUEST_TOOL_ID = 'record-change-request'

/** Where the record says a conversation-sourced request came from. */
export const CONVERSATION_REQUEST_SOURCE = 'conversation'

/** What the tool does with one accepted call. */
export interface ChangeRequestRecorder {
  /**
   * Record the request against the run, stamped with the place it came from.
   * @param input - the run, what to change, and which sections it is about.
   * @returns the recorded request, as the run's records hold it.
   */
  readonly record: (input: {
    readonly runId: string
    readonly instruction: string
    readonly targets?: ReadonlyArray<string>
  }) => Promise<{
    readonly requestId: string
    readonly runId: string
    readonly instruction: string
    readonly targets: ReadonlyArray<string>
  }>
}

/**
 * Render one JSON answer as text, the way every research tool answers.
 * @param _args - the accepted arguments; unused, the value is what a reader wants.
 * @param value - the tool's canonical value.
 * @returns one text content block.
 */
function jsonTextRender(_args: unknown, value: unknown): { type: 'text'; text: string }[] {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

/**
 * Build the tool definition.
 * @param recorder - the service call that records the request against a run.
 * @returns the definition to register on `ctx.tools`.
 */
export function changeRequestTool(recorder: ChangeRequestRecorder): ToolDefinition {
  return defineTool({
    name: RECORD_CHANGE_REQUEST_TOOL_ID,
    description: [
      'Record a change the person asked for in the conversation, as a request against a research run.',
      'Name the run, say what to change in their own words, and optionally name the manuscript sections',
      'it is about. The request is recorded durably and appears in the research panel, marked as',
      'recorded by the agent from the conversation.',
      'THIS TOOL DECIDES NOTHING. Approving, rejecting and submitting are the person\'s own decisions,',
      'made in the research panel over the host\'s authenticated channel; there is no argument here',
      'that expresses one, so a decision cannot be taken through this tool at all. Recording a change',
      'request is information, and the person still judges the work that answers it.',
    ].join(' '),
    parameters: {
      runId: {
        type: 'string',
        required: true,
        description: 'The run the request belongs to, as the research panel names it.',
      },
      instruction: {
        type: 'string',
        required: true,
        description: 'What to change, in the person\'s own words as they said it.',
      },
      targets: {
        type: 'array',
        items: { type: 'string' },
        description:
          'The manuscript sections the request is about; omit it when it is about the whole manuscript.',
      },
    },
    output: { schema: { type: 'json' }, render: jsonTextRender },
    timeoutMs: 10_000,
    execute: async (args) => {
      // The declared schema types all three, so nothing is coerced here: a value the schema rejects
      // never reaches this handler, and a value it accepts arrives as the type it was declared.
      const recorded = await recorder.record({
        runId: args.runId,
        instruction: args.instruction,
        ...(args.targets === undefined ? {} : { targets: [...args.targets] }),
      })
      return {
        requestId: recorded.requestId,
        runId: recorded.runId,
        instruction: recorded.instruction,
        targets: [...recorded.targets],
        source: CONVERSATION_REQUEST_SOURCE,
        note: 'Recorded from the conversation. Approving or rejecting this run is the person\'s own '
          + 'decision and happens in the research panel, not here.',
      }
    },
  })
}
