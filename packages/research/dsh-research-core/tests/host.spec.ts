import { afterEach, describe, expect, it } from 'vitest'
import { ResearchError, completeStep, getRunSnapshot, isComplete, recordArtifact, rollback, startStep } from '../src/engine/state-machine.ts'
import { _resetApprovalChannelForTests, createHostApprovalChannel, TrustedHumanPrincipal } from '../src/host.ts'
import type { HostApprovalChannel } from '../src/host.ts'
import { freshStore, runFullPipeline } from './helpers.ts'

afterEach(() => _resetApprovalChannelForTests())

describe('host trust channel — P0-1 (RC-E hardened: WeakSet identity + channel.mintPrincipal)', () => {
  describe('createHostApprovalChannel (singleton — P0-1-H1)', () => {
    it('#4 throws DSH_APPROVAL_CHANNEL_EXISTS on a second create (one channel in production)', () => {
      createHostApprovalChannel('secret-1')
      expect(() => createHostApprovalChannel('secret-2')).toThrow(ResearchError)
      expect(() => createHostApprovalChannel('secret-2')).toThrow(/APPROVAL_CHANNEL_EXISTS/)
    })
    it('throws on an empty hostSecret', () => {
      expect(() => createHostApprovalChannel('')).toThrow(ResearchError)
    })
  })

  describe('TrustedHumanPrincipal — minted ONLY via channel.mintPrincipal (RC-E E2; no static create)', () => {
    it('TrustedHumanPrincipal.create is NOT exported (removed — RC-E E2)', () => {
      expect((TrustedHumanPrincipal as unknown as { create?: unknown }).create).toBeUndefined()
    })
    it('registerPrincipal rejects empty and the reserved agent principalId (trust boundary)', () => {
      const channel = createHostApprovalChannel('s')
      expect(() => channel.registerPrincipal('')).toThrow(/PRINCIPAL_INVALID/)
      expect(() => channel.registerPrincipal('agent')).toThrow(/PRINCIPAL_INVALID/)
    })
    it('mintPrincipal rejects principalId agent/empty + missing approvalEventId', () => {
      const store = freshStore()
      const id = runFullPipeline(store)
      const channel = createHostApprovalChannel('s')
      channel.registerPrincipal('human-1')
      expect(() => channel.mintPrincipal(id, 'E2-submit', 'agent', 'evt-1')).toThrow(ResearchError)
      expect(() => channel.mintPrincipal(id, 'E2-submit', '', 'evt-1')).toThrow(ResearchError)
      expect(() => channel.mintPrincipal(id, 'E2-submit', 'human-1', '')).toThrow(ResearchError)
    })
    it('direct `new TrustedHumanPrincipal(...)` is rejected (token-gated ctor — RC-E E2)', () => {
      // The ctor accepts only the module-private MINT_TOKEN; any other symbol throws. So
      // principals are un-constructable outside channel.mintPrincipal (sole MINT_TOKEN holder).
      const Ctor = TrustedHumanPrincipal as unknown as {
        new (t: symbol, principalId: string, approvalEventId: string, runId: string, stepId: string): TrustedHumanPrincipal
      }
      const store = freshStore()
      const id = runFullPipeline(store)
      expect(() => new Ctor(Symbol('forged'), 'human-1', 'evt-1', id, 'E2-submit')).toThrow(ResearchError)
      expect(() => new Ctor(Symbol('forged'), 'human-1', 'evt-1', id, 'E2-submit')).toThrow(/PRINCIPAL_NOT_TRUSTED/)
    })
  })

  describe('principal identity guard — per-channel WeakSet (RC-E E1; adversarial #1/#2/#3)', () => {
    it('#1 Object.create(TrustedHumanPrincipal.prototype) is rejected (instanceof-defeat closed by WeakSet)', () => {
      // The prior instanceof guard returned true for this shape (Object.create sets [[Prototype]]
      // without invoking the ctor). The WeakSet rejects it: the forged object was never minted.
      const store = freshStore()
      const id = runFullPipeline(store) // E2 gated
      const channel = createHostApprovalChannel('s')
      channel.registerPrincipal('human-1')
      const forged = Object.create(TrustedHumanPrincipal.prototype) as TrustedHumanPrincipal
      ;(forged as { principalId: string }).principalId = 'human-1'
      ;(forged as { approvalEventId: string }).approvalEventId = 'evt-1'
      ;(forged as { runId: string }).runId = id
      ;(forged as { stepId: string }).stepId = 'E2-submit'
      expect(() => channel.submit(store, id, 'E2-submit', 'approved', forged)).toThrow(ResearchError)
      expect(() => channel.submit(store, id, 'E2-submit', 'approved', forged)).toThrow(/PRINCIPAL_NOT_TRUSTED/)
    })
    it('#2 a forged same-field plain object is rejected (WeakSet is by identity, not fields)', () => {
      const store = freshStore()
      const id = runFullPipeline(store)
      const channel = createHostApprovalChannel('s')
      channel.registerPrincipal('human-1')
      const forged = { principalId: 'human-1', approvalEventId: 'evt-1', runId: id, stepId: 'E2-submit' } as unknown as TrustedHumanPrincipal
      expect(() => channel.submit(store, id, 'E2-submit', 'approved', forged)).toThrow(ResearchError)
      expect(() => channel.submit(store, id, 'E2-submit', 'approved', forged)).toThrow(/PRINCIPAL_NOT_TRUSTED/)
    })
    it('#3 a principal whose properties/symbols are copied to a new object is rejected (membership is unforgeable)', () => {
      const store = freshStore()
      const id = runFullPipeline(store)
      const channel = createHostApprovalChannel('s')
      channel.registerPrincipal('human-1')
      const real = channel.mintPrincipal(id, 'E2-submit', 'human-1', 'evt-1')
      // Copy ALL own keys + own symbols (property-by-property) onto a fresh object sharing the
      // prototype. WeakSet.has is by object identity — the clone is a different object → rejected.
      const forged = Object.create(Object.getPrototypeOf(real)) as TrustedHumanPrincipal
      for (const key of Reflect.ownKeys(real)) {
        Object.defineProperty(forged, key, Reflect.getOwnPropertyDescriptor(real, key) as PropertyDescriptor)
      }
      expect(() => channel.submit(store, id, 'E2-submit', 'approved', forged)).toThrow(ResearchError)
      expect(() => channel.submit(store, id, 'E2-submit', 'approved', forged)).toThrow(/PRINCIPAL_NOT_TRUSTED/)
      // sanity: the real principal still works (it is a member)
      expect(channel.submit(store, id, 'E2-submit', 'approved', real)).toBe('passed')
    })
  })

  describe('principal immutability — frozen at mint (RC-E E2 single-snapshot)', () => {
    it('a minted principal is frozen — mutating runId/stepId/principalId/approvalEventId throws TypeError', () => {
      const store = freshStore()
      const id = runFullPipeline(store) // E2 gated
      const channel = createHostApprovalChannel('s')
      channel.registerPrincipal('human-1')
      const p = channel.mintPrincipal(id, 'E2-submit', 'human-1', 'evt-1')
      // Frozen at mint time (Object.freeze — runtime, NOT just TS `readonly` which is erased at
      // runtime). In strict mode (ESM) assignment to a non-writable property throws TypeError,
      // so the binding fields cannot be mutated post-mint to desync submit checks from the
      // delegated _applyHumanApproval values (INV-PRINCIPAL-SNAPSHOT).
      expect(Object.isFrozen(p)).toBe(true)
      expect(() => { (p as { runId: string }).runId = 'forged' }).toThrow(TypeError)
      expect(() => { (p as { stepId: string }).stepId = 'forged' }).toThrow(TypeError)
      expect(() => { (p as { principalId: string }).principalId = 'forged' }).toThrow(TypeError)
      expect(() => { (p as { approvalEventId: string }).approvalEventId = 'forged' }).toThrow(TypeError)
      // The principal still approves (mutation was blocked; the frozen values are intact).
      expect(channel.submit(store, id, 'E2-submit', 'approved', p)).toBe('passed')
    })
  })

  describe('submit — INV-PRINCIPAL / INV-APPROVAL-STATE / INV-REPLAY / INV-COMPLETE-ATTEMPT + cross-binding (#6)', () => {
    function channelWithPrincipal(): { channel: HostApprovalChannel } {
      const channel = createHostApprovalChannel('test-secret')
      channel.registerPrincipal('human-1')
      return { channel }
    }

    it('approved → passed; isComplete true (functional baseline)', () => {
      const store = freshStore()
      const id = runFullPipeline(store)
      expect(getRunSnapshot(store, id).steps['E2-submit']?.status).toBe('gated')
      const { channel } = channelWithPrincipal()
      const p = channel.mintPrincipal(id, 'E2-submit', 'human-1', 'evt-1')
      expect(channel.submit(store, id, 'E2-submit', 'approved', p)).toBe('passed')
      expect(isComplete(store, id, 'E2-submit')).toBe(true)
    })

    it('rejected → blocked; isComplete false; approval retained as evidence', () => {
      const store = freshStore()
      const id = runFullPipeline(store)
      const { channel } = channelWithPrincipal()
      const p = channel.mintPrincipal(id, 'E2-submit', 'human-1', 'evt-2')
      expect(channel.submit(store, id, 'E2-submit', 'rejected', p)).toBe('blocked')
      expect(isComplete(store, id, 'E2-submit')).toBe(false)
    })

    it('rejects an unregistered principalId even when minted (P0-1-H5)', () => {
      const store = freshStore()
      const id = runFullPipeline(store)
      const channel = createHostApprovalChannel('s') // no registerPrincipal
      const p = channel.mintPrincipal(id, 'E2-submit', 'human-1', 'evt-1')
      expect(() => channel.submit(store, id, 'E2-submit', 'approved', p)).toThrow(ResearchError)
      expect(() => channel.submit(store, id, 'E2-submit', 'approved', p)).toThrow(/PRINCIPAL_NOT_REGISTERED/)
    })

    it('throws unless state.status === gated (INV-APPROVAL-STATE — in_progress rejected)', () => {
      const store = freshStore()
      const id = runFullPipeline(store) // E2 gated
      rollback(store, id, 'E2-submit') // → pending (E2 has no downstream)
      startStep(store, id, 'E2-submit') // → in_progress (attempt 2)
      const { channel } = channelWithPrincipal()
      const p = channel.mintPrincipal(id, 'E2-submit', 'human-1', 'evt-1')
      expect(() => channel.submit(store, id, 'E2-submit', 'approved', p)).toThrow(ResearchError)
      expect(() => channel.submit(store, id, 'E2-submit', 'approved', p)).toThrow(/APPROVAL_BAD_STATUS/)
    })

    it('rejects replay of the same approvalEventId after rollback+rerun (INV-REPLAY — P0-1-H4)', () => {
      const store = freshStore()
      const id = runFullPipeline(store)
      const { channel } = channelWithPrincipal()
      const p = channel.mintPrincipal(id, 'E2-submit', 'human-1', 'evt-1')
      expect(channel.submit(store, id, 'E2-submit', 'approved', p)).toBe('passed')
      rollback(store, id, 'E2-submit') // → pending
      startStep(store, id, 'E2-submit') // attempt 2
      recordArtifact(store, id, 'E2-submit', 'submission-record', 'sr2')
      completeStep(store, id, 'E2-submit') // → gated (attempt 2)
      // re-mint for the SAME approvalEventId (evt-1) — already consumed → replay
      const pReplay = channel.mintPrincipal(id, 'E2-submit', 'human-1', 'evt-1')
      expect(() => channel.submit(store, id, 'E2-submit', 'approved', pReplay)).toThrow(ResearchError)
      expect(() => channel.submit(store, id, 'E2-submit', 'approved', pReplay)).toThrow(/APPROVAL_REPLAY/)
    })

    it('a fresh approvalEventId on the re-run attempt is accepted (re-approval after rollback)', () => {
      const store = freshStore()
      const id = runFullPipeline(store)
      const { channel } = channelWithPrincipal()
      const p1 = channel.mintPrincipal(id, 'E2-submit', 'human-1', 'evt-1')
      expect(channel.submit(store, id, 'E2-submit', 'approved', p1)).toBe('passed')
      rollback(store, id, 'E2-submit')
      startStep(store, id, 'E2-submit')
      recordArtifact(store, id, 'E2-submit', 'submission-record', 'sr2')
      completeStep(store, id, 'E2-submit')
      const p2 = channel.mintPrincipal(id, 'E2-submit', 'human-1', 'evt-2') // fresh event
      expect(channel.submit(store, id, 'E2-submit', 'approved', p2)).toBe('passed')
      expect(isComplete(store, id, 'E2-submit')).toBe(true)
    })

    it('#6a cross-channel: a principal minted by channelA is rejected on channelB', () => {
      const store = freshStore()
      const id = runFullPipeline(store)
      const channelA = createHostApprovalChannel('s')
      channelA.registerPrincipal('human-1')
      const pA = channelA.mintPrincipal(id, 'E2-submit', 'human-1', 'evt-1')
      _resetApprovalChannelForTests() // channelA (the object) still lives; its WeakSet is intact
      const channelB = createHostApprovalChannel('s')
      channelB.registerPrincipal('human-1')
      // pA is a member of channelA's WeakSet, NOT channelB's → identity check fails first.
      expect(() => channelB.submit(store, id, 'E2-submit', 'approved', pA)).toThrow(ResearchError)
      expect(() => channelB.submit(store, id, 'E2-submit', 'approved', pA)).toThrow(/PRINCIPAL_NOT_TRUSTED/)
    })

    it('#6b cross-run: a principal minted for run1 is rejected on run2', () => {
      const store = freshStore()
      const id1 = runFullPipeline(store, 'R1') // E2 gated on R1
      runFullPipeline(store, 'R2') // E2 gated on R2
      const { channel } = channelWithPrincipal()
      const p = channel.mintPrincipal(id1, 'E2-submit', 'human-1', 'evt-1')
      expect(() => channel.submit(store, 'R2', 'E2-submit', 'approved', p)).toThrow(ResearchError)
      expect(() => channel.submit(store, 'R2', 'E2-submit', 'approved', p)).toThrow(/PRINCIPAL_RUN_MISMATCH/)
    })

    it('#6c cross-step: a principal minted for E2-submit is rejected on E1-format', () => {
      const store = freshStore()
      const id = runFullPipeline(store) // E1-format passed, E2 gated
      const { channel } = channelWithPrincipal()
      const p = channel.mintPrincipal(id, 'E2-submit', 'human-1', 'evt-1')
      // stepId mismatch fires before the status/humanGate checks.
      expect(() => channel.submit(store, id, 'E1-format', 'approved', p)).toThrow(ResearchError)
      expect(() => channel.submit(store, id, 'E1-format', 'approved', p)).toThrow(/PRINCIPAL_STEP_MISMATCH/)
    })
  })

  describe('the host subpath is NOT reachable from the main entry', () => {
    it('the main entry does not export createHostApprovalChannel / TrustedHumanPrincipal / _applyHumanApproval', async () => {
      const core = await import('../src/index.ts') as Record<string, unknown>
      expect(core.createHostApprovalChannel).toBeUndefined()
      expect(core.TrustedHumanPrincipal).toBeUndefined()
      expect(core._applyHumanApproval).toBeUndefined()
    })
  })
})
