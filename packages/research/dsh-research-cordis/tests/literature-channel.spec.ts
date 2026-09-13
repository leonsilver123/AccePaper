/**
 * Literature-channel assembly — the plugin's Config → deps path.
 *
 * The seven tools reach external data only through `ResearchToolDeps`. Which
 * retrieval channel lands in that graph is a DEPLOYMENT decision recorded in the
 * plugin's `cordis.yml` config, so it must be observable and must default to the
 * offline fixture: silently reaching the network because a field was omitted would
 * turn a configuration mistake into unlogged live evidence.
 */

import { describe, expect, it } from 'vitest'
import { OpenAlexLiteratureAdapter } from '../src/openalex-adapter.ts'
import { buildToolDeps } from '../src/tools.ts'

describe('buildToolDeps — retrieval channel assembly', () => {
  it('defaults to the fixture graph when no channel is configured', () => {
    const deps = buildToolDeps(undefined)

    expect(deps.literatureAdapter).toBeUndefined()
    // The offline graph still carries the fixture citation resolver.
    expect(deps.citationDeps).toBeDefined()
  })

  it("assembles the fixture graph for an explicit 'fixture' channel", () => {
    const deps = buildToolDeps({ kind: 'fixture' })

    expect(deps.literatureAdapter).toBeUndefined()
  })

  it("assembles the real OpenAlex adapter for an 'openalex' channel", () => {
    const deps = buildToolDeps({ kind: 'openalex' })

    expect(deps.literatureAdapter).toBeInstanceOf(OpenAlexLiteratureAdapter)
    // The citation resolver stays a fixture: only the literature channel moved.
    expect(deps.citationDeps).toBeDefined()
  })

})
