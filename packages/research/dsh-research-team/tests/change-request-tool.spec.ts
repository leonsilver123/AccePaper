/**
 * The tool an agent records a conversation-stated requirement through.
 *
 * THE BOUNDARY IS WHAT THIS FILE IS FOR. Two facts must hold together, and each is asserted here rather
 * than trusted: the tool CAN record a change request, and it CANNOT decide anything. A reviewer reading
 * a claim like "decisions stay in the panel" needs the check that says so — a tool whose schema grew an
 * `approved` flag, or whose handler passed a smuggled one through, would be the failure this pins.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  changeRequestTool, CONVERSATION_REQUEST_SOURCE, RECORD_CHANGE_REQUEST_TOOL_ID,
  type ChangeRequestRecorder,
} from '../src/change-request-tool.ts'

/** A recorder that answers with the request it was handed, and remembers every call. */
function recorderOf(): ChangeRequestRecorder & { readonly calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = []
  return {
    calls,
    record: vi.fn((input: { runId: string; instruction: string; targets?: ReadonlyArray<string> }) => {
      calls.push({ ...input })
      return Promise.resolve({
        requestId: 'req-1',
        runId: input.runId,
        instruction: input.instruction,
        targets: [...(input.targets ?? ['results'])],
      })
    }),
  }
}

/** A tool run context, as much of it as a handler that reads no context needs. */
const exec = { signal: new AbortController().signal } as never

describe('what the tool declares', () => {
  it('declares a change request and NOTHING that could carry a decision', () => {
    const definition = changeRequestTool(recorderOf())

    expect(definition.name).toBe(RECORD_CHANGE_REQUEST_TOOL_ID)
    // THE PARAMETER SET IS THE BOUNDARY, so it is pinned as a set: run the run, what to change, and
    // which sections it is about. An `approved`, `decision`, `submit` or `reject` parameter — or any
    // other field a caller could put a verdict in — fails here.
    const properties = (definition.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(properties).sort()).toEqual(['instruction', 'runId', 'targets'])
    expect((definition.parameters as { required?: ReadonlyArray<string> }).required?.slice().sort())
      .toEqual(['instruction', 'runId'])
  })

  it('says in its own description where decisions are made instead', () => {
    const definition = changeRequestTool(recorderOf())

    // The agent that reads this description is the one who might otherwise try to approve through the
    // conversation, so the description has to name where that happens.
    expect(definition.description).toContain('DECIDES NOTHING')
    expect(definition.description).toContain('research panel')
  })
})

describe('what the tool does with a call', () => {
  it('records the request with the place it came from', async () => {
    const recorder = recorderOf()
    const definition = changeRequestTool(recorder)

    const value = await definition.execute(
      { runId: 'run-1', instruction: 'tighten the claim in the results', targets: ['results'] },
      exec,
    ) as Record<string, unknown>

    expect(recorder.calls).toEqual([
      { runId: 'run-1', instruction: 'tighten the claim in the results', targets: ['results'] },
    ])
    expect(value.requestId).toBe('req-1')
    expect(value.source).toBe(CONVERSATION_REQUEST_SOURCE)
    // AND THE ANSWER SAYS WHERE A DECISION GOES, so the agent that recorded a request is not left
    // believing it has just decided something.
    expect(value.note).toContain('research panel')
  })

  it('passes nothing but the change request, even when a caller smuggles a verdict alongside it', async () => {
    const recorder = recorderOf()
    const definition = changeRequestTool(recorder)

    // THE HANDLER IS WHAT DECIDES, and it reads three fields. A caller that adds `decision: 'approved'`
    // — or anything else — still only produces a change request, which is information: the person judges
    // the work that answers it. This is the check that the capability, not the schema, is the boundary.
    // `execute` takes unvalidated arguments, which is exactly the point: the schema is what narrows them.
    await definition.execute(
      { runId: 'run-1', instruction: 'tighten the claim', decision: 'approved', approved: true },
      exec,
    )

    expect(recorder.calls).toEqual([{ runId: 'run-1', instruction: 'tighten the claim' }])
  })

  it('refuses a call with no run or no instruction before the handler runs', async () => {
    const recorder = recorderOf()
    const definition = changeRequestTool(recorder)

    // The arguments are validated against the declared schema by `defineTool`, so a call that names no
    // run never reaches the service: what the tool does not receive, it cannot act on.
    await expect(definition.execute({ instruction: 'tighten the claim' }, exec)).rejects.toThrow()
    await expect(definition.execute({ runId: 'run-1' }, exec)).rejects.toThrow()
    expect(recorder.calls).toEqual([])
  })
})
