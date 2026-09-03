/**
 * T08 citation identity chain — Fixture/Mock resolver (BATCH-2 ONLY).
 *
 * This is the batch-2 stand-in for a real Crossref/OpenAlex/gateway resolver.
 * It performs NO network I/O and holds NO real API keys (uses `sk-xxx`
 * placeholder only as a documented non-secret). Real resolver implementations
 * live OUTSIDE this pure module (per the adapter contract in ./adapter.ts);
 * wiring one is the host's job, never the verifier's.
 *
 * The fixture maps a {@link CitationRef} (by kind + normalized id) to a
 * pre-baked {@link ResolvedCitationMetadata} record and returns a discriminated
 * {@link ResolverOutcome}:
 *   - 'resolved'   when the key matches a record;
 *   - 'not_found'  when the key is absent (fabricated literature — #1);
 *   - 'temporarily_unavailable' when the key is in `unavailableKeys` (service
 *     fault simulation — MUST NOT be misread as fabrication);
 *   - 'ambiguous'  when the key is in `ambiguousKeys` (multi-record simulation).
 * It is PURE: deterministic, stateless lookup, returns fresh clones so callers
 * cannot mutate the fixture's internal table.
 */

import type { CitationRef } from '../contracts.ts'
import type {
  CitationResolverAdapter,
  ResolverOutcome,
  ResolvedCitationMetadata,
} from './adapter.ts'

/** A bibliographic record the fixture can resolve an id to. */
export interface FixtureRecord {
  readonly title: string
  readonly authors: readonly string[]
  readonly retracted: boolean
}

/** Key for the fixture lookup table: `${kind}:${normalized-id}`. */
function fixtureKey(ref: CitationRef): string {
  return `${ref.kind}:${ref.id.trim().toLowerCase()}`
}

/** Construction options. `unavailableKeys` / `ambiguousKeys` let tests
 *  simulate resolver outages / ambiguous records deterministically. */
export interface MockCitationResolverOptions {
  readonly ruleVersion?: string
  /** kind:normalized-id keys that resolve to temporarily_unavailable. */
  readonly unavailableKeys?: readonly string[]
  /** kind:normalized-id keys that resolve to ambiguous. */
  readonly ambiguousKeys?: readonly string[]
}

/**
 * Pure Fixture/Mock {@link CitationResolverAdapter}. Construct from a lookup
 * map of (kind+id) -> record. Returns a discriminated {@link ResolverOutcome};
 * a missing key is 'not_found' (fabricated literature — #1). `ruleVersion`
 * defaults to 'fixture-mock-v1' (auditable; never a real partition-list id).
 *
 * Statelessness: the fixture table is deep-cloned on construction; resolved
 * metadata is returned deep-cloned, so callers can never mutate fixture state
 * and cross-run isolation is guaranteed.
 */
export class MockCitationResolverAdapter implements CitationResolverAdapter {
  private readonly table: ReadonlyMap<string, ResolvedCitationMetadata>
  private readonly ruleVersion: string
  private readonly unavailableKeys: ReadonlySet<string>
  private readonly ambiguousKeys: ReadonlySet<string>

  constructor(
    records: Readonly<Record<string, FixtureRecord>> = {},
    options: MockCitationResolverOptions = {},
  ) {
    const map = new Map<string, ResolvedCitationMetadata>()
    for (const [key, rec] of Object.entries(records)) {
      map.set(key, {
        title: rec.title,
        authors: rec.authors,
        retracted: rec.retracted,
        ruleVersion: options.ruleVersion ?? 'fixture-mock-v1',
      })
    }
    // Deep-clone + freeze the internal table (INV-SNAPSHOT for fixture state).
    this.table = deepFreezeMap(map)
    this.ruleVersion = options.ruleVersion ?? 'fixture-mock-v1'
    this.unavailableKeys = new Set(options.unavailableKeys ?? [])
    this.ambiguousKeys = new Set(options.ambiguousKeys ?? [])
  }

  resolveMetadata(ref: CitationRef): ResolverOutcome {
    const key = fixtureKey(ref)
    if (this.unavailableKeys.has(key)) {
      return {
        status: 'temporarily_unavailable',
        detail: 'fixture: simulated resolver outage',
      }
    }
    if (this.ambiguousKeys.has(key)) {
      return {
        status: 'ambiguous',
        detail: 'fixture: multiple candidate records',
      }
    }
    const meta = this.table.get(key)
    if (meta === undefined) {
      return { status: 'not_found' } // confirmed miss -> fabricated (#1)
    }
    // Return a fresh clone so callers cannot mutate the fixture's record.
    return {
      status: 'resolved',
      metadata: {
        title: meta.title,
        authors: meta.authors.slice(),
        retracted: meta.retracted,
        ruleVersion: this.ruleVersion,
      },
    }
  }
}

/** Freeze a Map's entries defensively (fixture internal state isolation). */
function deepFreezeMap<K, V extends object>(m: Map<K, V>): ReadonlyMap<K, V> {
  for (const v of m.values()) {
    Object.freeze(v)
    if (Array.isArray((v as { authors?: unknown }).authors)) {
      Object.freeze((v as { authors: readonly unknown[] }).authors)
    }
  }
  return m as ReadonlyMap<K, V>
}
