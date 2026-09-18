/**
 * A1's evidence follows the deployment's retrieval channel.
 *
 * Before this seam existed, A1 carried `mockLiteratureSearchAdapter` as a literal,
 * so a fully assembled real adapter could sit on the cordis tool surface while the
 * pipeline still retrieved the synthetic corpus. These tests pin the wiring: the
 * injected deps must reach A1's artifact, and the artifact must say which corpus it
 * came from.
 */

import { describe, expect, it } from 'vitest'
import { getArtifact, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import type {
  LiteratureHit,
  LiteratureHitId,
  LiteratureSearchAdapter,
  LiteratureSearchOutcome,
} from '@deepseek-ai/dsh-research-tools'

import { runT19B } from '../src/runner/drive.ts'

/**
 * A recognisable stand-in for a live catalogue: one hit, one known id.
 *
 * @param total - the catalogue's pre-cap match count. `truncated` is derived from it, so a total
 *   above the hits is how this seam says the adapter's own answer was capped.
 * @returns the adapter.
 */
function markerAdapter(total = 1): LiteratureSearchAdapter {
  const hit: LiteratureHit = {
    id: 'W-marker' as LiteratureHitId,
    venue: 'Journal of Deployment Channels',
    title: 'A record that only the injected channel can supply',
    ref: { kind: 'doi', id: '10.0000/marker', title: 'marker', authors: ['A. Author'] },
  }
  return {
    async search(): Promise<LiteratureSearchOutcome> {
      return { status: 'ok', hits: [hit], total }
    },
  }
}

interface LandscapeShape {
  readonly hits: ReadonlyArray<{ readonly id: string }>
  readonly corpus: string
  readonly hitCount: number
  readonly truncated: boolean
}

describe('A1 tool-deps injection', () => {
  it('keeps the synthetic-corpus label when no deps are injected', async () => {
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, { stopBefore: 'A2-claim' })

    const landscape = getArtifact(store, run.runId, 'landscape-map') as LandscapeShape
    expect(landscape.corpus).toBe('synthetic-fixture')
  })

  it('routes A1 through the injected adapter and labels the corpus accordingly', async () => {
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, {
      toolDeps: { literatureAdapter: markerAdapter() },
      stopBefore: 'A2-claim',
    })

    const landscape = getArtifact(store, run.runId, 'landscape-map') as LandscapeShape
    // The injected channel's record is what A1 actually retrieved...
    expect(landscape.hits.map(h => h.id)).toEqual(['W-marker'])
    expect(landscape.hitCount).toBe(1)
    // ...and the artifact says so, rather than still claiming a synthetic corpus.
    expect(landscape.corpus).toBe('live-catalogue')
    // The channel matched exactly what it returned, so nothing was capped and this artifact says so.
    expect(landscape.truncated).toBe(false)
  })

  it('records whether the answer was capped, which is what tells a corpus that matched nothing from one whose matches were dropped', async () => {
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, {
      toolDeps: { literatureAdapter: markerAdapter(3) },
      stopBefore: 'A2-claim',
    })

    const landscape = getArtifact(store, run.runId, 'landscape-map') as LandscapeShape
    expect(landscape.hitCount).toBe(1)
    // THE FIELD THIS PINS. The catalogue matched three and this run holds one; without the pre-cap
    // count on the artifact, a corpus whose matches the adapter's own filters dropped reads exactly
    // like a corpus that holds nothing — which is the ambiguity one real incident could not be
    // diagnosed through after the fact.
    expect(landscape.truncated).toBe(true)
  })
})
