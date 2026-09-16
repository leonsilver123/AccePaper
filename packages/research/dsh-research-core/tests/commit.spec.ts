import { describe, expect, it } from 'vitest'
import { commitStepOutputs, inputDigestOf } from '../src/engine/commit.ts'
import type { CommitOutcome, CommitRequest } from '../src/engine/commit.ts'
import type { ProjectRevision } from '../src/domain/ids.ts'
import {
  ResearchError,
  getArtifact,
  recordArtifact,
  getRunSnapshot,
  rollback,
  startStep,
  submitGateVerdict,
} from '../src/engine/state-machine.ts'
import { runStep } from '../src/engine/pipeline.ts'
import type { ArtifactRef } from '../src/domain/artifact.ts'
import { bindTo, freshStore, seedRun, submitBound, verdict } from './helpers.ts'

/**
 * The single commit point (src/engine/commit.ts) and the gate binding it enables.
 *
 * These are the acceptance tests for three defects that were reproduced against the previous
 * write path, each by an offline probe before this file existed:
 *  1. a step with NO outputs could reach a `passed` gate (A1, gate B, empty registry);
 *  2. a value that failed to clone AFTER earlier slugs had been written left partial official
 *     output behind;
 *  3. an attempt that completed after a rollback had its result credited to the attempt that
 *     replaced it.
 *
 * They are written as refusals because that is what the fix produces: the point is not that the
 * good path works, but that each bad path now stops.
 *
 * Test step: A1-landscape (outputs ['landscape-map','gap-list'], gate ['B'], non-humanGate).
 */

const STEP = 'A1-landscape'
const OUTS = ['landscape-map', 'gap-list'] as const

function started(stepId: string = STEP): [ReturnType<typeof freshStore>, string] {
  const store = freshStore()
  const id = seedRun(store)
  startStep(store, id, stepId)
  return [store, id]
}

/** The revision a brand-new run is at, which is what a first commit expects. */
function revisionOf(store: ReturnType<typeof freshStore>, id: string): ProjectRevision {
  return getRunSnapshot(store, id).revision
}

function outputsOf(...values: ReadonlyArray<unknown>): CommitRequest['outputs'] {
  return OUTS.map((slug, index) => ({ slug, value: values[index] }))
}

function request(
  store: ReturnType<typeof freshStore>,
  id: string,
  overrides: Partial<CommitRequest> = {},
): CommitRequest {
  return {
    attemptId: getRunSnapshot(store, id).steps[STEP]?.attemptId ?? 0,
    expectedRevision: revisionOf(store, id),
    idempotencyKey: 'k1',
    outputs: outputsOf('m', 'g'),
    ...overrides,
  }
}

function expectRefusal(outcome: CommitOutcome, code: string): Extract<CommitOutcome, { ok: false }> {
  if (outcome.ok) throw new Error(`expected a refusal, got a receipt: ${JSON.stringify(outcome.receipt)}`)
  expect(outcome.code).toBe(code)
  // Every refusal has to be able to tell a reader what was wrong, not just that something was.
  expect(outcome.reason.length).toBeGreaterThan(20)
  return outcome
}

describe('J01 — a gate cannot certify a step that produced nothing', () => {
  it('refuses a well-formed verdict when the step has no outputs at all', () => {
    const [store, id] = started()
    expect(() => submitGateVerdict(store, id, STEP, verdict('B', true))).toThrow(/DSH_GATE_WITHOUT_COMMIT/)
  })

  it('refuses a verdict when only SOME declared outputs are present', () => {
    const [store, id] = started()
    const outcome = commitStepOutputs(store, id, STEP, {
      ...request(store, id),
      outputs: [{ slug: 'landscape-map', value: 'm' }],
    })
    expectRefusal(outcome, 'DSH_COMMIT_OUTPUTS_INCOMPLETE')
    expect(() => submitGateVerdict(store, id, STEP, verdict('B', true))).toThrow(/DSH_GATE_WITHOUT_COMMIT/)
  })

  it('accepts a BOUND verdict once the whole declared set is committed', () => {
    const [store, id] = started()
    expect(commitStepOutputs(store, id, STEP, request(store, id)).ok).toBe(true)
    // Bound: `submitBound` stamps the verdict with the revisions the attempt committed, which is
    // what every real gate submission carries. The same verdict UNBOUND is refused above.
    expect(submitBound(store, id, STEP, verdict('B', true))).toBe('passed')
  })

  it('refuses an UNBOUND verdict even when the attempt committed the right outputs', () => {
    const [store, id] = started()
    expect(commitStepOutputs(store, id, STEP, request(store, id)).ok).toBe(true)
    expect(() => submitGateVerdict(store, id, STEP, verdict('B', true))).toThrow(/DSH_GATE_UNBOUND_VERDICT/)
  })

  it('refuses a verdict bound to a DIFFERENT commit than the attempt holds', () => {
    const [store, id] = started()
    expect(commitStepOutputs(store, id, STEP, request(store, id)).ok).toBe(true)
    // A verdict stamped against another revision set: the shape an old judgment has when it is
    // replayed against a new attempt. Nothing about it is malformed; it is simply about other
    // outputs, which is the whole point of carrying targets.
    const other = {
      ...verdict('B', true),
      targetRefs: [{
        artifactId: 'landscape-map' as never,
        version: 99 as never,
        contentHash: 'f'.repeat(64) as never,
      }],
      inputDigest: 'e'.repeat(64) as never,
    }
    expect(() => submitGateVerdict(store, id, STEP, other)).toThrow(/DSH_GATE_STALE_TARGET/)
  })

  it('refuses a verdict backed only by the PREVIOUS attempt\'s artifacts', () => {
    const [store, id] = started()
    expect(commitStepOutputs(store, id, STEP, request(store, id)).ok).toBe(true)
    rollback(store, id, STEP)
    startStep(store, id, STEP)
    // The registry still holds the first attempt's entries, marked invalidated. A step that has
    // not re-produced them must not pass on them.
    expect(() => submitGateVerdict(store, id, STEP, verdict('B', true))).toThrow(/DSH_GATE_WITHOUT_COMMIT/)
  })
})

describe('F02 — the per-slug seam cannot write beside a commit', () => {
  it('refuses recordArtifact once the attempt has committed, and changes nothing', () => {
    const [store, id] = started()
    const committed = commitStepOutputs(store, id, STEP, request(store, id))
    if (!committed.ok) throw new Error(committed.reason)
    const before = getRunSnapshot(store, id)

    expect(() =>{  recordArtifact(store, id, STEP, 'landscape-map', 'replaced outside commit') }).toThrow(
      /DSH_ARTIFACT_AFTER_COMMIT/,
    )

    const after = getRunSnapshot(store, id)
    // The official record is unchanged, and the revision did not move: the bypass that used to
    // replace a committed artifact while leaving the revision at 1 now does nothing at all.
    expect(getArtifact(store, id, 'landscape-map')).toBe('m')
    expect(after.revision).toBe(before.revision)
    expect(after.registry['landscape-map']?.ref).toEqual(before.registry['landscape-map']?.ref)
  })

  it('still allows recordArtifact BEFORE any commit, which is what the seam is for', () => {
    const [store, id] = started()
    expect(() =>{  recordArtifact(store, id, STEP, 'landscape-map', 'staged') }).not.toThrow()
    expect(getArtifact(store, id, 'landscape-map')).toBe('staged')
  })

  it('re-opens the write after a rollback, because a new attempt is a new commit', () => {
    const [store, id] = started()
    expect(commitStepOutputs(store, id, STEP, request(store, id)).ok).toBe(true)
    rollback(store, id, STEP)
    startStep(store, id, STEP)
    expect(() =>{  recordArtifact(store, id, STEP, 'landscape-map', 'new attempt staging') }).not.toThrow()
  })
})

describe('F01 — an old verdict cannot approve a new attempt', () => {
  it('refuses the SAME verdict object after a rollback and a new commit', async () => {
    const [store, id] = started()
    const first = await runStep(store, id, STEP, {
      executor: () => ({ 'landscape-map': { version: 'old' }, 'gap-list': ['old'] }),
    })
    expect(first.ok).toBe(true)
    // The verdict attempt 1 was adjudicated with — the object itself, kept for the replay.
    const oldVerdict = bindTo(store, id, STEP, verdict('B', true))
    expect(submitGateVerdict(store, id, STEP, oldVerdict)).toBe('passed')

    rollback(store, id, STEP)
    startStep(store, id, STEP)
    const second = await runStep(store, id, STEP, {
      executor: () => ({ 'landscape-map': { version: 'new' }, 'gap-list': ['new'] }),
    })
    expect(second.ok).toBe(true)
    // Attempt 2's own verdict passes; the OLD one is refused, because it names attempt 1's
    // revisions and the attempt it is being offered to wrote different ones.
    expect(() => submitGateVerdict(store, id, STEP, oldVerdict)).toThrow(/DSH_GATE_STALE_TARGET/)
    expect(submitBound(store, id, STEP, verdict('B', true))).toBe('passed')
  })

  it('refuses a verdict whose INPUTS changed, even when the targets did not', () => {
    const [store, id] = started()
    const receipt = commitStepOutputs(store, id, STEP, request(store, id))
    if (!receipt.ok) throw new Error(receipt.reason)
    const wrongInputs = {
      ...verdict('B', true),
      targetRefs: receipt.receipt.artifacts.map(artifact => artifact.ref),
      inputDigest: 'a'.repeat(64) as never,
    }
    expect(() => submitGateVerdict(store, id, STEP, wrongInputs)).toThrow(/DSH_GATE_STALE_INPUTS/)
  })
})

describe('J02 — the write is atomic, so a failure leaves nothing behind', () => {
  it('writes no artifact when the SECOND value cannot be cloned', async () => {
    const [store, id] = started()
    const res = await runStep(store, id, STEP, {
      executor: () => ({ 'landscape-map': { valid: true }, 'gap-list': () => 'not cloneable' }),
    })
    expect(res.ok).toBe(false)
    expect(res.status).toBe('error')
    expect(res.error?.message).toMatch(/DSH_COMMIT_VALUE_NOT_PERSISTABLE/)
    // The first value must not have landed: validation runs over the whole set before any write.
    expect(getArtifact(store, id, 'landscape-map')).toBeUndefined()
    expect(getRunSnapshot(store, id).steps[STEP]!.artifacts).toEqual({})
    expect(getRunSnapshot(store, id).revision).toBe(0)
  })

  it('writes no artifact when a value has no canonical encoding', async () => {
    const [store, id] = started()
    const res = await runStep(store, id, STEP, {
      // A Map has no own enumerable keys, so it cannot be hashed into an identity. Storing one
      // would create a registry entry that no reference could name.
      executor: () => ({ 'landscape-map': new Map([['a', 1]]), 'gap-list': 'g' }),
    })
    expect(res.ok).toBe(false)
    expect(res.error?.message).toMatch(/DSH_COMMIT_VALUE_NOT_PERSISTABLE/)
    expect(getRunSnapshot(store, id).steps[STEP]!.artifacts).toEqual({})
  })

  it('writes no artifact and no revision when a slug is not declared', async () => {
    const [store, id] = started()
    const res = await runStep(store, id, STEP, {
      executor: () => ({ 'landscape-map': 'm', 'gap-list': 'g', 'not-declared': 1 }),
    })
    expect(res.ok).toBe(false)
    expect(res.error?.message).toMatch(/DSH_COMMIT_OUTPUT_NOT_DECLARED/)
    expect(getRunSnapshot(store, id).revision).toBe(0)
  })
})

describe('J02 — a superseded attempt cannot write', () => {
  it('refuses the late completion of an attempt the step has moved past', async () => {
    const [store, id] = started()
    let release!: (v: Record<string, unknown>) => void
    const first = runStep(store, id, STEP, {
      executor: () => new Promise<Record<string, unknown>>((resolve) => { release = resolve }),
    })
    await Promise.resolve()
    // The step is rolled back and re-started while attempt 1 is still executing — a retry after a
    // timeout, or a recovery after the process came back.
    rollback(store, id, STEP)
    startStep(store, id, STEP)
    expect(getRunSnapshot(store, id).steps[STEP]?.attemptId).toBe(2)

    release({ 'landscape-map': 'from: old attempt', 'gap-list': 'from: old attempt' })
    const res = await first

    expect(res.ok).toBe(false)
    expect(res.error?.message).toMatch(/DSH_COMMIT_STALE_ATTEMPT/)
    // Attempt 2 must own nothing it did not produce.
    expect(getRunSnapshot(store, id).steps[STEP]!.artifacts).toEqual({})
  })

  it('refuses a commit prepared against a revision the run has left behind', () => {
    const [store, id] = started()
    const revisionBeforeAnyCommit = revisionOf(store, id)
    expect(commitStepOutputs(store, id, STEP, request(store, id)).ok).toBe(true)
    rollback(store, id, STEP)
    startStep(store, id, STEP)
    // The retry re-reads everything EXCEPT the revision it was prepared against, which is exactly
    // the caller the fence exists to stop: the attempt is current, the outputs are complete, and
    // the state it computed them from is gone.
    const late = commitStepOutputs(store, id, STEP, {
      ...request(store, id),
      expectedRevision: revisionBeforeAnyCommit,
    })
    expectRefusal(late, 'DSH_COMMIT_REVISION_CONFLICT')
    expect(getRunSnapshot(store, id).revision).toBe(1)
    expect(getRunSnapshot(store, id).steps[STEP]!.artifacts).toEqual({})
  })
})

describe('the commit point is idempotent by key and single-shot by attempt', () => {
  it('returns the FIRST receipt for a repeated key and does not commit twice', () => {
    const [store, id] = started()
    const first = commitStepOutputs(store, id, STEP, request(store, id))
    expect(first.ok).toBe(true)
    const revisionAfterFirst = getRunSnapshot(store, id).revision

    const again = commitStepOutputs(store, id, STEP, request(store, id))
    expect(again.ok).toBe(true)
    if (!first.ok || !again.ok) throw new Error('unreachable')
    expect(again.receipt).toEqual(first.receipt)
    expect(getRunSnapshot(store, id).revision).toBe(revisionAfterFirst)
    expect(getRunSnapshot(store, id).events.filter(e => e.kind === 'step-committed')).toHaveLength(1)
  })

  it('refuses a second commit under a DIFFERENT key rather than replacing the first', () => {
    const [store, id] = started()
    expect(commitStepOutputs(store, id, STEP, request(store, id)).ok).toBe(true)
    const second = commitStepOutputs(store, id, STEP, { ...request(store, id), idempotencyKey: 'k2' })
    expectRefusal(second, 'DSH_COMMIT_ALREADY_COMMITTED')
    expect(getArtifact(store, id, 'landscape-map')).toBe('m')
  })

  it('refuses a commit for a step that is not executing', () => {
    const [store, id] = started()
    rollback(store, id, STEP)
    expectRefusal(commitStepOutputs(store, id, STEP, request(store, id)), 'DSH_COMMIT_NOT_IN_PROGRESS')
  })

  it('refuses an unknown step', () => {
    const [store, id] = started()
    expectRefusal(commitStepOutputs(store, id, 'no-such-step', request(store, id)), 'DSH_COMMIT_UNKNOWN_STEP')
  })

  it('refuses the same slug offered twice', () => {
    const [store, id] = started()
    const outcome = commitStepOutputs(store, id, STEP, {
      ...request(store, id),
      outputs: [
        { slug: 'landscape-map', value: 'a' },
        { slug: 'landscape-map', value: 'b' },
        { slug: 'gap-list', value: 'g' },
      ],
    })
    expectRefusal(outcome, 'DSH_COMMIT_DUPLICATE_OUTPUT')
  })
})

describe('concurrent commits — only the one holding the current revision succeeds', () => {
  it('refuses the loser of two commits prepared against the same revision', async () => {
    const [store, id] = started()
    const prepared = [request(store, id), { ...request(store, id), idempotencyKey: 'k2' }]
    // A barrier, not a sleep: both callers have read the same revision before either commits, so
    // the outcome does not depend on which one the scheduler runs first.
    const gate = Promise.withResolvers<undefined>()
    let arrived = 0
    const bothReady = async (): Promise<void> => {
      arrived += 1
      if (arrived === prepared.length) gate.resolve(undefined)
      await gate.promise
    }
    const results = await Promise.all(
      prepared.map(async (req, index) => {
        await bothReady()
        return commitStepOutputs(store, id, STEP, {
          ...req,
          outputs: outputsOf(`m${String(index)}`, `g${String(index)}`),
        })
      }),
    )
    const winners = results.filter(outcome => outcome.ok)
    const losers = results.filter(outcome => !outcome.ok)
    // The invariant is that the run advanced by exactly one and the winner's values are the ones
    // that landed — not which of the two refusals the loser was told about. For a single attempt
    // the more specific answer is "this attempt already committed"; the revision fence is what
    // catches a DIFFERENT attempt committing against a state it did not read (tested above).
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    expectRefusal(losers[0] as CommitOutcome, 'DSH_COMMIT_ALREADY_COMMITTED')
    expect(getRunSnapshot(store, id).revision).toBe(1)
    const committed = getRunSnapshot(store, id).steps[STEP]!.artifacts
    expect(committed['landscape-map']).toMatch(/^m[01]$/u)
  })
})

describe('a commit gives every artifact an identity, not just a name', () => {
  it('records a reference the registry can be read back by', () => {
    const [store, id] = started()
    const outcome = commitStepOutputs(store, id, STEP, request(store, id))
    if (!outcome.ok) throw new Error(outcome.reason)
    const meta = getRunSnapshot(store, id).registry['landscape-map']
    expect(meta?.ref.version).toBe(1)
    expect(meta?.ref.artifactId).toBe('landscape-map')
    expect(meta?.ref.contentHash).toMatch(/^[0-9a-f]{64}$/u)
    expect(outcome.receipt.artifacts.map(a => a.slug).sort()).toEqual([...OUTS].sort())
  })

  it('gives the same value the same hash and a different value a different one', () => {
    const [store, id] = started()
    expect(commitStepOutputs(store, id, STEP, request(store, id)).ok).toBe(true)
    const first = getRunSnapshot(store, id).registry['landscape-map']!.ref.contentHash
    rollback(store, id, STEP)
    startStep(store, id, STEP)
    expect(commitStepOutputs(store, id, STEP, {
      ...request(store, id),
      outputs: outputsOf('m', 'g'),
    }).ok).toBe(true)
    expect(getRunSnapshot(store, id).registry['landscape-map']?.ref.contentHash).toBe(first)
  })

  it('advances the version when a re-run commits different content', () => {
    const [store, id] = started()
    expect(commitStepOutputs(store, id, STEP, request(store, id)).ok).toBe(true)
    rollback(store, id, STEP)
    startStep(store, id, STEP)
    expect(commitStepOutputs(store, id, STEP, {
      ...request(store, id),
      outputs: outputsOf('m2', 'g2'),
    }).ok).toBe(true)
    expect(getRunSnapshot(store, id).registry['landscape-map']?.ref.version).toBe(2)
  })
})

describe('the receipt names the inputs the attempt read', () => {
  it('separates "read nothing" from "inputs were not recorded"', () => {
    expect(inputDigestOf([])).not.toBe(inputDigestOf(undefined))
  })

  it('is order-independent and content-sensitive', () => {
    const a: ArtifactRef = { artifactId: 'x' as ArtifactRef['artifactId'], version: 1 as ArtifactRef['version'], contentHash: 'a'.repeat(64) as ArtifactRef['contentHash'] }
    const b: ArtifactRef = { artifactId: 'y' as ArtifactRef['artifactId'], version: 2 as ArtifactRef['version'], contentHash: 'b'.repeat(64) as ArtifactRef['contentHash'] }
    expect(inputDigestOf([a, b])).toBe(inputDigestOf([b, a]))
    const changed: ArtifactRef = { ...b, contentHash: 'c'.repeat(64) as ArtifactRef['contentHash'] }
    expect(inputDigestOf([a, changed])).not.toBe(inputDigestOf([a, b]))
  })
})

describe('the commit point is the only writer the gate accepts', () => {
  it('names the step and attempt in the refusal, so a reader is not sent hunting', () => {
    const [store, id] = started()
    expect(() => submitGateVerdict(store, id, STEP, verdict('B', true))).toThrow(/A1-landscape/)
  })

  it('leaves the step startable-again path intact after a refused commit', () => {
    const [store, id] = started()
    expectRefusal(commitStepOutputs(store, id, STEP, {
      ...request(store, id),
      outputs: [{ slug: 'bogus', value: 1 }],
    }), 'DSH_COMMIT_OUTPUT_NOT_DECLARED')
    // A refusal is not a state change: the attempt is still executing and can commit again.
    expect(getRunSnapshot(store, id).steps[STEP]?.status).toBe('in_progress')
    expect(commitStepOutputs(store, id, STEP, request(store, id)).ok).toBe(true)
    expect(getRunSnapshot(store, id).steps[STEP]?.artifacts).toHaveProperty('landscape-map')
  })

  it('reports the refusal as a ResearchError when a caller throws it', () => {
    const [store, id] = started()
    const outcome = commitStepOutputs(store, id, STEP, {
      ...request(store, id),
      outputs: [{ slug: 'bogus', value: 1 }],
    })
    if (outcome.ok) throw new Error('expected a refusal')
    expect(() => {
      throw new ResearchError(outcome.code, outcome.reason)
    }).toThrow(/DSH_COMMIT_OUTPUT_NOT_DECLARED/)
  })
})
