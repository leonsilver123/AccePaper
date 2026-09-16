/**
 * An approval binds a revision, not a step name.
 *
 * THE DEFECT THIS EXISTS TO CLOSE. `ApprovalRecord` held `{run_id, step_id, attempt_id, principalId,
 * approval_event_id, decision, rationale, timestamp}` and no content of any kind. A person approved
 * the manuscript in front of them, and the record said only that attempt N of `E2-submit` might
 * proceed — so a manuscript that moved afterwards (a later step, a recovery from another snapshot, a
 * hand) was still covered by a decision made about a different document. The same file already
 * compared byte-for-byte in `submitGateVerdict`; the approval path compared nothing.
 *
 * Approvals now freeze the refs of the step's inputs, from the run's own registry rather than from
 * the caller, and `approvalStalenessOf` compares them with what the registry holds now.
 */

import { describe, expect, it } from 'vitest'
import { approvalStalenessOf, getRunSnapshot } from '../src/index.ts'
import { _resetApprovalChannelForTests, createHostApprovalChannel } from '../src/host.ts'
import type { RunState } from '../src/engine/types.ts'
import { freshStore, runFullPipeline } from './helpers.ts'

/** A run driven to E2 and approved through the host channel, as a live approval arrives. */
function approvedRun(): { store: ReturnType<typeof freshStore>; id: string } {
  const store = freshStore()
  const id = runFullPipeline(store)
  expect(getRunSnapshot(store, id).steps['E2-submit']?.status).toBe('gated')
  _resetApprovalChannelForTests()
  const channel = createHostApprovalChannel('spec-secret')
  channel.registerPrincipal('human-1')
  const principal = channel.mintPrincipal(id, 'E2-submit', 'human-1', 'evt-1')
  channel.submit(store, id, 'E2-submit', 'approved', principal)
  expect(getRunSnapshot(store, id).steps['E2-submit']?.status).toBe('passed')
  return { store, id }
}

/** The live run state, which is what a write outside the pipeline would reach. */
function liveRun(store: ReturnType<typeof freshStore>, id: string): RunState {
  const run = store.get(id)
  if (run === undefined) throw new Error('spec: the run vanished')
  return run
}

describe('an approval covers the revision it was given for', () => {
  it('records the inputs it binds, taken from the run rather than from the caller', () => {
    const { store, id } = approvedRun()
    const approval = liveRun(store, id).steps.get('E2-submit')?.approval
    expect(approval?.targetRefs).toHaveLength(1)
    expect(approval?.targetRefs[0]?.artifactId).toBe('formatted-manuscript')
    // The ref is the registry's own, so a reader can look it up.
    expect(approval?.targetRefs[0]).toEqual(liveRun(store, id).registry['formatted-manuscript']?.ref)
  })

  it('reports nothing while the inputs still hold the revision that was approved', () => {
    const { store, id } = approvedRun()
    expect(approvalStalenessOf(store, id, 'E2-submit')).toBeUndefined()
  })

  it('reports the revision that moved, naming both hashes', () => {
    // THE CASE THE OLD RECORD COULD NOT SEE. The manuscript is replaced after the decision — which
    // a recovery from a different snapshot does without touching the approval it restores — and the
    // approval would have kept reading as a decision about the new one.
    const { store, id } = approvedRun()
    const run = liveRun(store, id)
    const before = run.registry['formatted-manuscript']?.ref
    if (before === undefined) throw new Error('spec: no manuscript')
    run.registry['formatted-manuscript'] = {
      ...run.registry['formatted-manuscript']!,
      ref: { ...before, version: (before.version + 1) as typeof before.version, contentHash: 'a'.repeat(64) as typeof before.contentHash },
    }

    const stale = approvalStalenessOf(store, id, 'E2-submit')
    expect(stale).toMatch(/'formatted-manuscript' moved from version/u)
    expect(stale).toContain(before.contentHash.slice(0, 12))
    expect(stale).toContain('a'.repeat(12))
  })

  it('reports a revision whose CONTENT changed at the same version number', () => {
    const { store, id } = approvedRun()
    const run = liveRun(store, id)
    const before = run.registry['formatted-manuscript']!.ref
    run.registry['formatted-manuscript'] = {
      ...run.registry['formatted-manuscript']!,
      ref: { ...before, contentHash: 'b'.repeat(64) as typeof before.contentHash },
    }

    expect(approvalStalenessOf(store, id, 'E2-submit')).toMatch(/moved from version/u)
  })

  it('reports an input that disappeared rather than passing it over', () => {
    const { store, id } = approvedRun()
    const run = liveRun(store, id)
    delete run.registry['formatted-manuscript']
    expect(approvalStalenessOf(store, id, 'E2-submit')).toMatch(/is gone from the run/u)
  })

  it('says nothing about a step that was never approved', () => {
    // Whether a step NEEDS an approval is readiness's question. This answers only "does the
    // decision still describe what is there", and a step with no decision has nothing to describe.
    const store = freshStore()
    const id = runFullPipeline(store)
    expect(approvalStalenessOf(store, id, 'E2-submit')).toBeUndefined()
  })
})
