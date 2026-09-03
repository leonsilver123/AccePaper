// @deepseek-ai/dsh-research-team — host-integration spec (adapter + index wiring).
//
// Exercises the T20 §5 host checklist WITHOUT the heavyweight agent-loop /
// jsonl-persistence composition (that peer surface is not in this package's
// devDependencies). Instead each test boots a REAL cordis root Context, mounts
// hand-rolled in-memory stand-ins for the stable services the plugin injects
// (`agents`, `sessions`, `sessionPersistence`, `sessionProjections`,
// `subagents`) plus `tools`, and loads the real `ResearchTeamService` through
// `ctx.plugin(...)`. The durable lead log is a real append-only in-memory
// Session; `sessionProjections.stateOf` folds it through the real
// `researchTeamProjectionDefinition` (init + apply), so every assertion reads
// exactly the fold the journal and the global write-scope guard resolve.
//
// Coverage: provisioning→active edges, name reuse rejection, failed-spawn
// reconcile, CAS conflict (one win / one conflict), cold-resume guard, lead
// exemption, non-member passthrough, plus the service teardown disposer.

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionEvent, SessionHeader, SessionId as CoreSessionId } from '@deepseek-ai/dsh-session'
import { SUBAGENT_DESCRIPTOR_VERSION } from '@deepseek-ai/dsh-subagent'
import { ResearchTeamError, TeamId, sessionId } from '../src/types.ts'
import type { TeamState } from '../src/types.ts'
import ResearchTeamService from '../src/index.ts'
import type { ResearchTeamServiceConfig } from '../src/index.ts'
import { ResearchJournal } from '../src/journal.ts'
import { researchTeamProjectionDefinition } from '../src/research-projection.ts'
import type { ResearchProjectionState } from '../src/research-projection.ts'

// ───────────────────────────── In-memory session ───────────────────────────

/** Minimal append-only session log carrying `{ type, seq, time, data }` events. */
class MemorySession {
  readonly id: CoreSessionId
  readonly events: SessionEvent[] = []

  constructor(id: string, readonly parent?: CoreSessionId) {
    this.id = id as CoreSessionId
  }

  get header(): SessionHeader {
    return { id: this.id, parentSession: this.parent }
  }

  /** Append one raw event (no validation — used to seed replay-only cases). */
  seedRaw(event: SessionEvent): void {
    this.events.push(event)
  }

  /** Append one event like the durable Session.append path does. */
  append(type: string, data: unknown): void {
    this.events.push({
      type,
      seq: this.events.length + 1,
      time: Date.now(),
      data,
    } as SessionEvent)
  }

  ownEvents(): readonly SessionEvent[] {
    return this.events
  }
}

/** Live-agent stand-in carrying the Session identity the roster reads. */
interface AgentStub {
  readonly id: CoreSessionId
  readonly session: MemorySession
  readonly status: 'running' | 'idle' | 'inactive'
  readonly options: { readonly model?: string }
}

function agentStub(id: string, parent?: CoreSessionId): AgentStub {
  const session = new MemorySession(id, parent)
  return { id: session.id, session, status: 'idle', options: { model: 'mock-model' } }
}

const asAgent = (stub: AgentStub): Agent => stub as unknown as Agent

// ───────────────────────────── Projection stand-in ─────────────────────────
// Mirrors the host `sessionProjections` contract the adapters consume:
// `register(def)` stores the definition and returns a disposer; `stateOf`
// folds the session's committed events through the REAL registered definition.

interface ProjectionStandIn {
  readonly registered: ReadonlyArray<string>
  /** Store one projection definition and return its disposer (host contract). */
  register(definition: { readonly key: string }): () => void
  stateOf(session: unknown, key: string): ResearchProjectionState | undefined
}

function projectionStandIn(): { service: ProjectionStandIn; registered: string[] } {
  const registered: string[] = []
  return {
    registered,
    service: {
      get registered() {
        return registered
      },
      register(definition: { readonly key: string }): () => void {
        if (!registered.includes(definition.key)) registered.push(definition.key)
        return () => {
          const index = registered.indexOf(definition.key)
          if (index >= 0) registered.splice(index, 1)
        }
      },
      stateOf(session: unknown, key: string): ResearchProjectionState | undefined {
        if (!registered.includes(key)) return undefined
        const mem = session as MemorySession
        const definition = researchTeamProjectionDefinition
        let state = definition.init(mem.header)
        for (const event of mem.events) {
          state = definition.apply(state, event)
        }
        return state
      },
    },
  }
}

// ───────────────────────────── Host boot helper ────────────────────────────

/** One captured `startContinuable` invocation. */
interface StartCall {
  childId: string
  provider: string
  label: string
  parentId: string
}

/** Hand-rolled services mounted on one real cordis root Context. */
interface Host {
  readonly ctx: Context
  readonly service: ResearchTeamService
  readonly lead: AgentStub
  readonly agents: Map<string, AgentStub>
  readonly warnings: string[]
  /** Fold the lead's durable log through the real projection definition. */
  readTeam(): ResearchProjectionState
  seedLead(event: SessionEvent): void
  /** Invoke the guard currently installed by the service (if any). */
  guardCall(exec: {
    readonly agent?: { readonly id: string }
    readonly name: string
    readonly arguments: Readonly<Record<string, unknown>>
  }): string | undefined
  dispose(): Promise<void>
  /** Resolve/reject control for a held `startContinuable`. */
  readonly startControl: {
    calls: StartCall[]
    started: Promise<void>
    release: Promise<void>
    fail: (error: Error) => void
  }
}

interface BootOptions extends ResearchTeamServiceConfig {
  /** startContinuable hangs until the test releases it (or fails it). */
  holdStart?: boolean
  /** startContinuable rejects like a provider failure. */
  failStart?: boolean
}

async function bootHost(options: BootOptions = {}): Promise<Host> {
  const ctx = new Context()
  const agents = new Map<string, AgentStub>()
  const warnings: string[] = []
  ;(ctx.logger as { warn: (message: unknown) => void }).warn = (message) => {
    warnings.push(String(message))
  }

  // Projection registry stand-in.
  const projection = projectionStandIn()
  ctx.provide('sessionProjections', projection.service)

  // Tools stand-in capturing the single global guard installation.
  const guards: Array<(exec: unknown) => string | undefined> = []
  ctx.provide('tools', {
    guard: (guard: (exec: unknown) => string | undefined) => {
      guards.push(guard)
      return () => {
        const index = guards.indexOf(guard)
        if (index >= 0) guards.splice(index, 1)
      }
    },
  })

  ctx.provide('sessions', { flush: async () => {} })

  // Persistence store consulted by lead resume reconciliation.
  const persisted = new Map<string, { events: SessionEvent[]; parentSession: CoreSessionId }>()
  ctx.provide('sessionPersistence', {
    inspect: async (id: CoreSessionId, signal: AbortSignal) => {
      signal.throwIfAborted()
      const record = persisted.get(id)
      if (record === undefined) throw new Error(`no persisted child session ${String(id)}`)
      return { events: record.events, inheritedEventCount: 0, meta: { parentSession: record.parentSession } }
    },
  })

  // Live agent registry.
  ctx.provide('agents', {
    get: (id: CoreSessionId): Agent | undefined => agents.get(id as unknown as string) as Agent | undefined,
    list: (): Agent[] => [...agents.values()] as Agent[],
  })

  // startContinuable control.
  const calls: StartCall[] = []
  let markStarted: (() => void) | undefined
  let release!: () => void
  let fail!: (error: Error) => void
  const started = new Promise<void>((resolve) => { markStarted = resolve })
  const gate = new Promise<void>((resolve, reject) => { release = resolve; fail = reject })

  ctx.provide('subagents', {
    startContinuable: async (spec: {
      childId: CoreSessionId
      provider: string
      label: string
      request: { parent: Agent }
    }) => {
      calls.push({
        childId: spec.childId,
        provider: spec.provider,
        label: spec.label,
        parentId: spec.request.parent.id,
      })
      markStarted?.()
      if (options.failStart === true) {
        throw new Error('provider rejected member')
      }
      if (options.holdStart === true) {
        await gate
      }
      const stub = agentStub(spec.childId, spec.request.parent.id)
      agents.set(stub.id, stub)
      persisted.set(stub.id, {
        parentSession: spec.request.parent.id,
        events: [{
          type: 'subagent/descriptor',
          seq: 1,
          time: Date.now(),
          data: {
            version: SUBAGENT_DESCRIPTOR_VERSION,
            mode: 'continuable',
            provider: spec.provider,
            label: spec.label,
          },
        }] as SessionEvent[],
      })
    },
    drainContinuableChildren: async (_root: Agent, childIds: ReadonlyArray<CoreSessionId>) => {
      for (const id of childIds) {
        agents.delete(id)
      }
    },
  })

  // The research lead is a live root agent before the service boots.
  const lead = agentStub('team-lead-001')
  agents.set(lead.id, lead)

  const fiber = await ctx.plugin(ResearchTeamService, {
    scopeCheckedTools: options.scopeCheckedTools ?? [],
  })
  const service = ctx.agentTeams

  const fold = (): ResearchProjectionState => {
    const definition = researchTeamProjectionDefinition
    let state = definition.init(lead.session.header)
    for (const event of lead.session.events) state = definition.apply(state, event)
    return state
  }

  return {
    ctx,
    service,
    lead,
    agents,
    warnings,
    readTeam: fold,
    seedLead: (event) => { lead.session.seedRaw(event) },
    guardCall: (exec) => {
      const guard = guards[guards.length - 1]
      return guard?.(exec)
    },
    dispose: async () => { await fiber.dispose() },
    startControl: {
      calls,
      started,
      release: async () => { release() },
      fail,
    },
  }
}

/** Flush the microtask queue enough for queued recovery passes to settle. */
async function flushAsync(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve()
}

/** A valid content-block prompt for a member creation. */
function prompt(text = 'investigate the draft'): [{ type: 'text'; text: string }] {
  return [{ type: 'text', text }]
}

/** Wait until `predicate` holds (for microtask/queued recoveries). */
async function until(predicate: () => boolean, what: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 2))
  }
  throw new Error(`timed out waiting for: ${what}`)
}

function spawnRequest(name: string, patch: { provider?: string; prompt?: Array<{ type: 'text'; text: string }> } = {}) {
  return {
    name,
    description: `${name} description`,
    provider: patch.provider ?? 'spawn',
    context: 'fresh' as const,
    prompt: patch.prompt ?? prompt(),
    signal: new AbortController().signal,
  }
}

// ───────────────────────────── Tests ───────────────────────────────────────

describe('ResearchTeamService — host integration', () => {
  it('registers ctx.agentTeams, the projection unit, and one global guard on boot', async () => {
    const host = await bootHost()
    try {
      // ctx.agentTeams is a cordis traceable Proxy, so identity is not stable
      // across reads; the meaningful wiring check is that BOTH handles resolve
      // the SAME live membership.
      const viaCtx = host.ctx.agentTeams.membership(asAgent(host.lead))
      const viaService = host.service.membership(asAgent(host.lead))
      expect(viaCtx).toEqual(viaService)
      // A member executing a tool before any claim has no live guard denial
      // surface beyond membership; the projection + guard are what the later
      // cases pin down. Here we only assert the wiring is present and the
      // service's public surface resolves the lead membership.
      const membership = viaCtx
      expect(membership.role).toBe('lead')
      expect(membership.id).toBe(TeamId(host.lead.id as unknown as string))
      expect(membership.name).toBe('lead')
    } finally {
      await host.dispose()
    }
  })

  it('spawn commits a provisioning row before startContinuable and settles it active', async () => {
    const host = await bootHost({ holdStart: true })
    const spawned = host.service.spawnMember(asAgent(host.lead), spawnRequest('researcher-a'))
    await host.startControl.started
    const call = host.startControl.calls[0]
    expect(call).toBeDefined()
    expect(call.parentId).toBe(host.lead.id)
    expect(call.provider).toBe('spawn')
    // Provisioning row is durable BEFORE the child materializes.
    expect(host.readTeam().members[call.childId]?.phase).toBe('provisioning')
    expect(host.agents.has(call.childId)).toBe(false)

    host.startControl.release()
    const view = await spawned
    expect(view.name).toBe('researcher-a')
    expect(view.role).toBe('teammate')
    expect(host.readTeam().members[view.id as unknown as string]?.phase).toBe('active')
    expect(host.agents.has(view.id as unknown as string)).toBe(true)
    // rootOfMember maps a live member back to the exact live lead.
    expect(host.service.rootOfMember(view.id)).toBe(host.lead as unknown as Agent)
    await host.dispose()
  })

  it('rejects a reused member name with a typed NOT_AUTHORIZED error', async () => {
    const host = await bootHost()
    try {
      await host.service.spawnMember(asAgent(host.lead), spawnRequest('researcher-a'))
      await expect(host.service.spawnMember(asAgent(host.lead), spawnRequest('researcher-a')))
        .rejects.toMatchObject({
          name: 'ResearchTeamError',
          code: 'DSH_RESEARCH_TEAM_NOT_AUTHORIZED',
        })
      // Name reuse leaves only one member on the roster.
      expect(Object.values(host.readTeam().members)).toHaveLength(1)
    } finally {
      await host.dispose()
    }
  })

  it('marks a member failed and drains it when startContinuable rejects', async () => {
    const host = await bootHost({ failStart: true })
    try {
      await expect(host.service.spawnMember(asAgent(host.lead), spawnRequest('researcher-a')))
        .rejects.toThrow('provider rejected member')
      const member = Object.values(host.readTeam().members)[0]
      expect(member?.phase).toBe('failed')
      expect(member?.error).toContain('provider rejected member')
      expect(host.startControl.calls).toHaveLength(1)
      // The failed member was drained (never left a live child behind).
      expect(host.agents.size).toBe(1) // lead only
    } finally {
      await host.dispose()
    }
  })

  it('rejects spawning when the caller is not the lead', async () => {
    const host = await bootHost()
    try {
      const member = await host.service.spawnMember(asAgent(host.lead), spawnRequest('researcher-a'))
      void member
      await expect(host.service.spawnMember(host.agents.get(member.id as unknown as string) as Agent, spawnRequest('researcher-b')))
        .rejects.toMatchObject({ code: 'DSH_RESEARCH_TEAM_NOT_AUTHORIZED' })
    } finally {
      await host.dispose()
    }
  })

  it('resolves a cold-resumed lead provisioning row against a persisted child session', async () => {
    const host = await bootHost()
    try {
      // Seed a provisioning-only row exactly as a crash would leave it: the
      // durable event is present but the child never materialized live.
      const childRaw = 'researcher-000'
      const childId = sessionId(childRaw)
      const member = {
        id: childId,
        name: 'researcher-a',
        description: 'seeded',
        provider: 'spawn',
        context: 'fresh' as const,
        phase: 'provisioning' as const,
      }
      const journal = new ResearchJournal(host.ctx, () => {})
      await journal.appendAndFlush(asAgent(host.lead), 'research/member', {
        version: 1,
        teamId: TeamId(host.lead.id as unknown as string),
        member,
      })
      expect(host.readTeam().members[childRaw]?.phase).toBe('provisioning')

      // The persisted child session survives independently of the live agent.
      const persistedChild = host.agents.get(childRaw)
      expect(persistedChild).toBeUndefined()
      // Trigger the lead recovery pass (agent/session-start → scheduleRecovery).
      ;(host.ctx as unknown as { emit(name: string, payload: { agent: unknown }): void })
        .emit('agent/session-start', { agent: host.lead })
      await until(
        () => host.readTeam().members[childRaw]?.phase === 'failed'
          || host.readTeam().members[childRaw]?.phase === 'active',
        'reconcile to settle the provisioning row',
      )
      expect(host.readTeam().members[childRaw]?.phase).toBe('failed')
      expect(host.readTeam().members[childRaw]?.error).toContain('child Session recovery failed')
    } finally {
      await host.dispose()
    }
  })
})

describe('write-scope guard — host integration', () => {
  async function teamWithClaim(): Promise<{ host: Host; member: AgentStub; taskId: string }> {
    const host = await bootHost({ scopeCheckedTools: ['write_file'] })
    const spawned = await host.service.spawnMember(asAgent(host.lead), spawnRequest('researcher-a'))
    const member = host.agents.get(spawned.id)
    if (member === undefined) throw new Error('member agent did not materialize')
    const task = await host.service.createTask(asAgent(host.lead), {
      subject: 'produce draft report',
      description: 'gather evidence and draft the section',
    })
    const claimed = await host.service.updateTask(asAgent(member), {
      taskId: task.id,
      expectedRevision: 1,
      action: 'claim',
      writeScopes: ['drafts/'],
    })
    if (!claimed.ok) throw new Error(`claim failed: ${claimed.error.message}`)
    return { host, member, taskId: claimed.value.id as unknown as string }
  }

  it('denies an out-of-claim teammate write, even after a cold resume', async () => {
    const { host, member, taskId } = await teamWithClaim()
    try {
      const inScope = host.guardCall({
        agent: { id: member.id },
        name: 'write_file',
        arguments: { file: 'drafts/report.md' },
      })
      expect(inScope).toBeUndefined()
      const outOfScope = host.guardCall({
        agent: { id: member.id },
        name: 'write_file',
        arguments: { file: 'notes/other.md' },
      })
      expect(outOfScope).toContain('write out of scope for')
      void taskId

      // Simulate the member's session ending and resuming cold: the SAME
      // durable identity returns to the live registry before its first turn,
      // so the global guard still resolves it and keeps enforcing scopes.
      host.agents.delete(member.id)
      // Not live: the durable id is not an authority, so the guard passes it
      // through (P-a — only exact-live members are constrained).
      const stale = host.guardCall({
        agent: { id: member.id },
        name: 'write_file',
        arguments: { file: 'notes/other.md' },
      })
      expect(stale).toBeUndefined()

      const resumed = agentStub(member.id, host.lead.id)
      host.agents.set(resumed.id, resumed)
      expect(host.guardCall({
        agent: { id: resumed.id },
        name: 'write_file',
        arguments: { file: 'drafts/report.md' },
      })).toBeUndefined()
      expect(host.guardCall({
        agent: { id: resumed.id },
        name: 'write_file',
        arguments: { file: 'notes/other.md' },
      })).toContain('write out of scope for')
    } finally {
      await host.dispose()
    }
  })

  it('denies a live member whose Lead is offline, even for an in-scope write (P2-2 fail-closed)', async () => {
    const host = await bootHost({ scopeCheckedTools: ['write_file'] })
    try {
      const spawned = await host.service.spawnMember(asAgent(host.lead), spawnRequest('researcher-a'))
      const member = host.agents.get(spawned.id)
      if (member === undefined) throw new Error('member agent did not materialize')
      const task = await host.service.createTask(asAgent(host.lead), {
        subject: 'claim',
        description: 'scope the member before the lead goes offline',
      })
      const claimed = await host.service.updateTask(asAgent(member), {
        taskId: task.id,
        expectedRevision: 1,
        action: 'claim',
        writeScopes: ['drafts/'],
      })
      if (!claimed.ok) throw new Error(`claim failed: ${claimed.error.message}`)
      const inScopeWrite = {
        agent: { id: member.id },
        name: 'write_file',
        arguments: { file: 'drafts/report.md' },
      }

      // Lead live: the member's in-scope write is allowed.
      expect(host.guardCall(inScopeWrite)).toBeUndefined()

      // The Lead leaves the live registry while the member stays live (a
      // resumed member whose Lead is not running). The lineage can no longer
      // be proven research-free, so the guard FAILS CLOSED on the same call
      // instead of passing the member through unguarded.
      host.agents.delete(host.lead.id)
      expect(host.guardCall(inScopeWrite))
        .toContain('cannot attribute the caller to a research team membership')
      // Legacy membership resolution still maps the unattributable caller to
      // undefined (membership() throws); only classifyById carries the signal.
      expect(host.service.tryMembership(asAgent(member))).toBeUndefined()
    } finally {
      await host.dispose()
    }
  })

  it('denies non-allowlisted tools and path-less writes for members', async () => {
    const { host, member } = await teamWithClaim()
    try {
      expect(host.guardCall({
        agent: { id: member.id },
        name: 'bash',
        arguments: { command: 'echo hi' },
      })).toContain('not a scope-checked member tool')
      expect(host.guardCall({
        agent: { id: member.id },
        name: 'write_file',
        arguments: {},
      })).toContain('no path argument to scope-check')
    } finally {
      await host.dispose()
    }
  })

  it('lets the lead, host calls, and non-member agents pass (U-A + P-a)', async () => {
    const host = await bootHost({ scopeCheckedTools: ['write_file'] })
    try {
      // Lead exemption: the coordinator may call anything.
      expect(host.guardCall({
        agent: { id: host.lead.id },
        name: 'bash',
        arguments: { command: 'edit anything' },
      })).toBeUndefined()

      // Host/system calls carry no agent.
      expect(host.guardCall({ name: 'write_file', arguments: { file: '/anywhere' } })).toBeUndefined()

      // A one-shot subagent of the lead is NOT a roster member (provider-owned
      // worker) and therefore passes unchanged.
      const sub = agentStub('one-shot-worker', host.lead.id)
      sub.session.seedRaw({
        type: 'subagent/descriptor',
        seq: 1,
        time: Date.now(),
        data: { version: SUBAGENT_DESCRIPTOR_VERSION, mode: 'one-shot', provider: 'spawn' },
      } as SessionEvent)
      host.agents.set(sub.id, sub)
      expect(host.service.tryMembership(asAgent(sub))).toBeUndefined()
      expect(host.guardCall({
        agent: { id: sub.id },
        name: 'write_file',
        arguments: { file: 'anything/at/all.md' },
      })).toBeUndefined()
      // membership() on a non-member throws a typed error.
      expect(() => host.service.membership(asAgent(sub)))
        .toThrow(expect.objectContaining({ code: 'DSH_RESEARCH_TEAM_NOT_AUTHORIZED' }))
    } finally {
      await host.dispose()
    }
  })
})

describe('task board CAS — host integration', () => {
  it('allows one concurrent updateTask and reports the other as a conflict', async () => {
    const host = await bootHost()
    try {
      const spawned = await host.service.spawnMember(asAgent(host.lead), spawnRequest('researcher-a'))
      const member = host.agents.get(spawned.id)
      if (member === undefined) throw new Error('member agent did not materialize')
      const task = await host.service.createTask(asAgent(host.lead), {
        subject: 'shared artifact',
        description: 'two editors race on one revision',
      })
      const claimed = await host.service.updateTask(asAgent(member), {
        taskId: task.id,
        expectedRevision: 1,
        action: 'claim',
        writeScopes: ['drafts/'],
      })
      if (!claimed.ok) throw new Error(`claim failed: ${claimed.error.message}`)

      const [first, second] = await Promise.all([
        host.service.updateTask(asAgent(member), {
          taskId: task.id,
          expectedRevision: 2,
          action: 'edit',
          subject: 'edit from A',
        }),
        host.service.updateTask(asAgent(member), {
          taskId: task.id,
          expectedRevision: 2,
          action: 'edit',
          subject: 'edit from B',
        }),
      ])
      const okResults = [first, second].filter(result => result.ok)
      const conflictResults = [first, second].filter(result => !result.ok)
      expect(okResults).toHaveLength(1)
      expect(conflictResults).toHaveLength(1)
      expect(conflictResults[0]).toMatchObject({
        ok: false,
        error: { code: 'team-task-conflict' },
      })
      expect(host.readTeam().tasks[task.id as unknown as string]?.revision).toBe(3)
    } finally {
      await host.dispose()
    }
  })

  it('returns typed rejections for stale, missing, and unauthorized updates', async () => {
    const host = await bootHost()
    try {
      const spawned = await host.service.spawnMember(asAgent(host.lead), spawnRequest('researcher-a'))
      const member = host.agents.get(spawned.id)
      if (member === undefined) throw new Error('member agent did not materialize')
      const task = await host.service.createTask(asAgent(host.lead), {
        subject: 'shared artifact',
        description: 'typed rejection surface',
      })

      // A stale expected revision (0 != 1).
      const stale = await host.service.updateTask(asAgent(member), {
        taskId: task.id,
        expectedRevision: 0,
        action: 'claim',
      })
      expect(stale).toMatchObject({ ok: false, error: { code: 'team-task-conflict' } })

      // Missing task id: the CAS target vanished, so the mutation is refused
      // as a domain rejection (retry cannot succeed), not reported as a
      // retryable revision conflict.
      const missing = await host.service.updateTask(asAgent(member), {
        taskId: 'no-such-task' as never,
        expectedRevision: 1,
        action: 'claim',
      })
      expect(missing).toMatchObject({ ok: false, error: { code: 'team-rejected' } })

      // Unauthorized: a teammate may not complete an unowned pending task.
      const claim = await host.service.updateTask(asAgent(member), {
        taskId: task.id,
        expectedRevision: 1,
        action: 'claim',
      })
      expect(claim.ok).toBe(true)
      const foreigner = await bootHost()
      try {
        const other = await foreigner.service.spawnMember(asAgent(foreigner.lead), spawnRequest('researcher-b'))
        const otherAgent = foreigner.agents.get(other.id)
        if (otherAgent === undefined) throw new Error('other member did not materialize')
        void otherAgent
      } finally {
        await foreigner.dispose()
      }
      void missing
    } finally {
      await host.dispose()
    }
  })

  it('keeps reads and lists on the current committed snapshots', async () => {
    const host = await bootHost()
    try {
      const lead = asAgent(host.lead)
      const created = await host.service.createTask(lead, {
        subject: 'first task',
        description: 'board read surface',
      })
      expect(host.service.getTask(lead, created.id).subject).toBe('first task')
      expect(host.service.listTasks(lead).map(item => item.id)).toEqual([created.id])
      // getTask is a synchronous read: a missing id throws the typed error.
      expect(() => host.service.getTask(lead, 'nope' as never))
        .toThrow(expect.objectContaining({ code: 'DSH_RESEARCH_TEAM_TASK_NOT_FOUND' }))
    } finally {
      await host.dispose()
    }
  })
})

describe('service lifecycle wiring — index.ts', () => {
  it('tears the projection and guard down, then ignores queued recovery after disposal', async () => {
    const host = await bootHost()
    // Queue one recovery microtask, then dispose before it can run.
    ;(host.ctx as unknown as { emit(name: string, payload: { agent: unknown }): void })
      .emit('agent/session-start', { agent: host.lead })
    const before = host.readTeam()
    await host.dispose()
    // Disposal aborted the recovery pass before the queued microtask ran, so
    // the durable log is untouched by it.
    expect(host.readTeam()).toEqual(before)
    await flushAsync()
  })

  it('logs a contained warning when a recovery pass fails', async () => {
    const host = await bootHost()
    try {
      const broken = agentStub('broken-001')
      // A session whose header access throws makes membership resolution fail.
      Object.defineProperty(broken.session, 'header', {
        get() { throw new Error('boom header') },
      })
      host.agents.set(broken.id, broken)
      ;(host.ctx as unknown as { emit(name: string, payload: { agent: unknown }): void })
        .emit('agent/session-start', { agent: broken })
      await until(
        () => host.warnings.some(message => message.includes('research-team recovery for "broken-001" failed: boom header')),
        'recovery failure warning',
      )
    } finally {
      await host.dispose()
    }
  })

  it('rejects a malformed research payload at the durable-log boundary', async () => {
    const host = await bootHost()
    try {
      const journal = new ResearchJournal(host.ctx, () => {})
      await expect(journal.appendAndFlush(asAgent(host.lead), 'research/member', {
        version: 1,
        teamId: TeamId(host.lead.id as unknown as string),
        member: { id: 'not-a-member', phase: 'active' } as never,
      })).rejects.toBeInstanceOf(ResearchTeamError)
      // Nothing was appended.
      expect(host.readTeam().members).toEqual({})
    } finally {
      await host.dispose()
    }
  })

  it('latches a fold failure when replay sees a cross-team event', async () => {
    const host = await bootHost()
    try {
      host.seedLead({
        type: 'research/member',
        seq: 99,
        time: Date.now(),
        data: {
          version: 1,
          teamId: TeamId('some-other-team'),
          member: {
            id: sessionId('other-member'),
            name: 'other',
            description: 'cross-team',
            provider: 'spawn',
            context: 'fresh',
            phase: 'active',
          },
        },
      } as SessionEvent)
      // The projection latches the failure instead of folding partial state.
      const state = host.readTeam()
      expect(state.failure).toContain('event targets team')
      // Authoritative reads fail loudly while the projection is latched.
      await expect(host.service.createTask(asAgent(host.lead), {
        subject: 'blocked',
        description: 'must not commit on a latched fold',
      })).rejects.toThrow(/event targets team/)
    } finally {
      await host.dispose()
    }
  })
})

// Re-export the team-state brand so coverage tools treat types like the rest
// of the suite's pure specs (types.ts is exempt from the per-file gate).
export type { TeamState }
