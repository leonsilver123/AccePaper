/**
 * A commit receipt for the specs that build gate verdicts directly.
 *
 * `VerdictBuildCtx.commit` is how a verdict acquires the artifact revisions it was decided about.
 * A spec that drives `buildStepVerdicts` without going through `runStep` therefore needs one, and
 * this builds the smallest well-formed receipt rather than each spec inventing hashes — the
 * verdict's TARGETS are what the specs assert about, and the values only have to be stable and
 * shaped like the real thing.
 *
 * It is not a substitute for the real receipt anywhere the gate is reached: a spec that submits a
 * verdict goes through `commitStepOutputs`, so the receipt it passes is the run's own.
 */

import type { ArtifactRef } from '@deepseek-ai/dsh-research-core'
import type { CommitReceipt } from '@deepseek-ai/dsh-research-core'

/** A 64-character lower-case hex digest derived from a label, so two labels differ. */
function hashOf(label: string): string {
  const seed = label.padEnd(64, '0').slice(0, 64)
  return seed.replace(/[^0-9a-f]/gu, 'a')
}

/**
 * A well-formed commit receipt for one step's declared outputs.
 *
 * @param stepId - the step the receipt belongs to.
 * @param slugs - the artifact slugs, in the order the step declares them.
 * @param attemptId - the attempt the receipt is for; defaults to the first.
 * @returns the receipt.
 */
export function receiptFor(stepId: string, slugs: ReadonlyArray<string>, attemptId = 1): CommitReceipt {
  const artifacts = slugs.map((slug, index) => {
    const ref: ArtifactRef = {
      artifactId: slug as ArtifactRef['artifactId'],
      version: (index + 1) as ArtifactRef['version'],
      contentHash: hashOf(slug) as ArtifactRef['contentHash'],
    }
    return { slug, ref }
  })
  return {
    stepId,
    attemptId,
    revision: attemptId as CommitReceipt['revision'],
    idempotencyKey: `${stepId}#${String(attemptId)}`,
    artifacts,
    inputDigest: hashOf(`${stepId}-inputs`) as CommitReceipt['inputDigest'],
    committedAt: 1,
  }
}
