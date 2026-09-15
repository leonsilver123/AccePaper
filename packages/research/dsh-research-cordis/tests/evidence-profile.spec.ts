import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { DEFAULT_EVIDENCE_PROFILE } from '@deepseek-ai/dsh-research-core'
import { ResearchEngine } from '../src/index.ts'

// The evidence profile is a deployment's claim about its own evidence: `production` says its
// evidence can carry a submission, `evaluation` admits synthetic evidence and stamps the whole
// output unsubmittable (see the core module docs on `EvidenceProfile`). It is a `Config` field, so
// what these pin is the load-time refusal and the resolved value the runner-side service reads —
// the admission rules themselves are core's own suite.
//
// The value comes from `cordis.yml`, so the typo case is a string no profile names; the type
// system cannot express it, and `as never` stands in for it (the same idiom the tool-hardening
// spec uses for values a caller can really produce).

describe('ResearchEngine evidence profile (Config.evidenceProfile)', () => {
  it('refuses an unrecognised profile at load, naming the field and the accepted values', async () => {
    const ctx = new Context()
    await expect(ctx.plugin(ResearchEngine, { evidenceProfile: 'prod' } as never))
      .rejects.toThrow(/`evidenceProfile` must be one of production \| evaluation, got "prod"/)
  })

  it('resolves an omitted profile to the evaluation default (runnable, never submittable)', async () => {
    const ctx = new Context()
    await ctx.plugin(ResearchEngine)
    expect(ctx.research.evidenceProfile).toBe(DEFAULT_EVIDENCE_PROFILE)
    expect(ctx.research.evidenceProfile).toBe('evaluation')
  })

  it('carries an explicit production profile through unchanged', async () => {
    const ctx = new Context()
    await ctx.plugin(ResearchEngine, { evidenceProfile: 'production' })
    expect(ctx.research.evidenceProfile).toBe('production')
  })

  it('exposes the profile on the service the runner-side reader resolves (ctx.get)', async () => {
    const ctx = new Context()
    await ctx.plugin(ResearchEngine, { evidenceProfile: 'production' })
    // Read the way the team package reads its sibling fields (e.g. `snapshotDirectory`): the
    // strict `ctx.get` against the global service store, not the topology-sensitive `ctx.research`.
    expect(ctx.get('research')?.evidenceProfile).toBe('production')
  })
})
