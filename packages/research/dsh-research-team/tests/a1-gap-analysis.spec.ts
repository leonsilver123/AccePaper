/**
 * A1's gap analysis derives from the retrieved literature.
 *
 * The gap list is A1's whole reason to exist downstream — `B1-method` and the
 * claim in `A2` are supposed to be answers to a gap. While it was a hardcoded
 * constant, the pipeline could retrieve 24 real papers and still report a gap that
 * had nothing to do with them. These tests pin the derivation: an injected writer
 * sees the retrieved records, its lines become the gaps, and an empty analysis
 * fails the step rather than passing with nothing.
 */

import { describe, expect, it } from 'vitest'
import { getArtifact, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import type { ResearchProseRequest, ResearchProseWriter } from '../src/runner/registry.ts'

import { runT19B } from '../src/runner/drive.ts'

interface GapListShape {
  readonly gaps: ReadonlyArray<string>
  readonly gapSource: 'model' | 'fixture'
}

/** A writer that records what it was asked and answers with fixed lines. */
function recordingWriter(lines: ReadonlyArray<string>): {
  readonly writer: ResearchProseWriter
  readonly seen: ResearchProseRequest[]
} {
  const seen: ResearchProseRequest[] = []
  return {
    seen,
    writer: {
      async write(request) {
        seen.push(request)
        return { text: lines.join('\n'), provider: 'test-provider', model: 'test-model' }
      },
    },
  }
}

describe('A1 gap analysis', () => {
  it('stays a labelled fixture when no writer is injected', async () => {
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, { stopBefore: 'A2-claim' })

    const gapList = getArtifact(store, run.runId, 'gap-list') as GapListShape
    expect(gapList.gapSource).toBe('fixture')
    expect(gapList.gaps.length).toBeGreaterThan(0)
  })

  it('turns the model analysis into gaps and shows the writer the retrieved papers', async () => {
    const { writer, seen } = recordingWriter([
      'Gap A: no benchmark for mixed-connectivity corridors',
      'Gap B: transfer across signal controllers is unmeasured',
    ])
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, { proseWriter: writer, stopBefore: 'A2-claim' })

    const gapList = getArtifact(store, run.runId, 'gap-list') as GapListShape
    expect(gapList.gapSource).toBe('model')
    expect(gapList.gaps).toEqual([
      'Gap A: no benchmark for mixed-connectivity corridors',
      'Gap B: transfer across signal controllers is unmeasured',
    ])

    // The writer was handed the records A1 actually retrieved — this is what makes
    // the gap a derivation rather than a coincidence.
    const request = seen[0]
    expect(request?.stepId).toBe('A1-landscape')
    const papers = (request?.context as { papers?: unknown }).papers
    expect(Array.isArray(papers)).toBe(true)
    expect((papers as unknown[]).length).toBeGreaterThan(0)
  })

  it('strips list markers the model may add', async () => {
    const { writer } = recordingWriter(['- first gap', '1. second gap', '  * third gap  '])
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, { proseWriter: writer, stopBefore: 'A2-claim' })

    const gapList = getArtifact(store, run.runId, 'gap-list') as GapListShape
    expect(gapList.gaps).toEqual(['first gap', 'second gap', 'third gap'])
  })

  it('fails the step on an empty analysis rather than passing with no gaps', async () => {
    const { writer } = recordingWriter(['   ', ''])
    const store: ResearchRunStore = new Map()

    // The driver deliberately does not let an executor throw escape: a failed step
    // stays 'in_progress' with no artifact and no gate verdict, so it can be rolled
    // back. The observable contract is therefore a failed step, not a rejection.
    const run = await runT19B(store, { proseWriter: writer, stopBefore: 'A2-claim' })
    const a1 = run.steps.find(step => step.stepId === 'A1-landscape')

    expect(a1?.status).toBe('in_progress')
    expect(a1?.outputSlugs).toEqual([])
  })
})
