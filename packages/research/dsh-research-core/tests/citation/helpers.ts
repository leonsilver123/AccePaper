import type {
  CitationEvidence,
  CitationId,
  CitationRef,
  ClaimId,
  VerificationMethod,
} from '../../src/contracts.ts'
import { MockCitationResolverAdapter } from '../../src/citation/fixture.ts'
import type { CitationResolverAdapter, ResolverOutcome } from '../../src/citation/adapter.ts'

/** Brand a string as ClaimId (boundary construction; branded strings are plain
 *  strings at runtime and survive structuredClone). */
export function claim(id: string): ClaimId {
  return id as ClaimId
}
export function citation(id: string): CitationId {
  return id as CitationId
}

export function ref(kind: CitationRef['kind'], id: string, extra?: { title?: string; authors?: string[] }): CitationRef {
  return {
    kind,
    id,
    ...(extra?.title !== undefined ? { title: extra.title } : {}),
    ...(extra?.authors !== undefined ? { authors: extra.authors } : {}),
  }
}

/** Build consistent CitationEvidence. method='none' => accessedAt undefined +
 *  originalTextAccessed false (per contract: accessedAt undefined iff none).
 *  Optional provenance fields (sourceUri/sourceVersion/contentHash/retrievedAt)
 *  may be injected via `provenance`. */
export function ev(
  method: VerificationMethod,
  opts?: {
    originalTextAccessed?: boolean
    accessedAt?: number
    locator?: CitationEvidence['locator']
    excerpt?: string
    provenance?: Partial<Pick<CitationEvidence, 'sourceUri' | 'sourceVersion' | 'contentHash' | 'retrievedAt'>>
  },
): CitationEvidence {
  const originalTextAccessed = opts?.originalTextAccessed ?? (method !== 'none')
  return {
    originalTextAccessed,
    method,
    // contract: accessedAt present iff method !== none
    ...(method !== 'none' ? { accessedAt: opts?.accessedAt ?? 1000 } : {}),
    ...(opts?.locator !== undefined ? { locator: opts.locator } : {}),
    ...(opts?.excerpt !== undefined ? { excerpt: opts.excerpt } : {}),
    ...(opts?.provenance !== undefined ? opts.provenance : {}),
  }
}

/** Fixture resolver with one real + one retracted record; any other id resolves
 *  to 'not_found' (fabricated literature — #1). */
export function fixtureResolver(): MockCitationResolverAdapter {
  return new MockCitationResolverAdapter({
    'doi:10.1000/real': { title: 'Real Paper', authors: ['Alice A', 'Bob B'], retracted: false },
    'doi:10.1000/retracted': { title: 'Retracted Paper', authors: ['Carol C'], retracted: true },
    'arxiv:2024.12345': { title: 'Preprint Study', authors: ['Dave D'], retracted: false },
  })
}

/** A resolver that always reports an authoritative miss (every citation is
 *  fabricated — must hard-block, never surface as 'unverified'). */
export function notFoundResolver(): CitationResolverAdapter {
  return { resolveMetadata: () => ({ status: 'not_found' as const }) }
}

/** A resolver simulating a service outage (must NOT be misjudged as fiction). */
export function outageResolver(): CitationResolverAdapter {
  return { resolveMetadata: () => ({ status: 'temporarily_unavailable' as const, detail: 'down' }) }
}

/** A resolver simulating an ambiguous multi-record response. */
export function ambiguousResolver(): CitationResolverAdapter {
  return { resolveMetadata: () => ({ status: 'ambiguous' as const, detail: 'multi' }) }
}

/** A resolver returning a structurally malformed outcome (adapter fault). */
export function malformedResolver(): CitationResolverAdapter {
  return { resolveMetadata: () => ({ status: 'telepathic' } as unknown as ResolverOutcome) }
}
