/**
 * Case Pack loader — contract tests.
 *
 * The pack is a run's curated INPUT set, so the properties that matter are the ones a
 * silent degradation would hide: a pack that is incomplete, from another schema version,
 * or carrying a datum the pipeline needs must be refused rather than half-used, and every
 * value the loader derives must still say which file and pointer it came from.
 *
 * The fixtures here are copies of the shipped traffic pack's files written to a temporary
 * directory, so a test can damage one file without touching the tracked pack.
 */

import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createRun, setRunInput } from '@deepseek-ai/dsh-research-core'
import type { ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import {
  CASE_PACK_FILES,
  CASE_PACK_INPUT_SLUGS,
  CASE_PACK_SCHEMA_VERSION,
  CasePackError,
  type CasePackFileName,
  loadCasePack,
  planCasePackInputs,
} from '../src/runner/case-pack.ts'

/** The tracked traffic pack, reused rather than duplicated (one data system, not two). */
const SOURCE_PACK = join(process.cwd(), 'plan/overnight/2026-09-09/case-pack-traffic')

const created: string[] = []

afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop()
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true })
  }
})

/** Write a copy of the shipped pack, optionally rewriting one file. */
function packCopy(override?: { readonly file: CasePackFileName; readonly content: string }): string {
  const dir = mkdtempSync(join(tmpdir(), 'case-pack-'))
  created.push(dir)
  mkdirSync(dir, { recursive: true })
  for (const file of CASE_PACK_FILES) {
    const body = override?.file === file
      ? override.content
      : readFileSync(join(SOURCE_PACK, file), 'utf8')
    writeFileSync(join(dir, file), body, 'utf8')
  }
  return dir
}

/** Rewrite one top-level/nested field of a pack file's parsed content. */
function withField(file: CasePackFileName, mutate: (content: Record<string, unknown>) => void): string {
  const content = JSON.parse(readFileSync(join(SOURCE_PACK, file), 'utf8')) as Record<string, unknown>
  mutate(content)
  return packCopy({ file, content: JSON.stringify(content, null, 2) })
}

describe('loadCasePack — the shipped traffic pack', () => {
  it('reads all seven files and keeps each one’s provenance envelope', () => {
    const pack = loadCasePack(SOURCE_PACK)

    expect([...pack.files.keys()]).toEqual([...CASE_PACK_FILES])
    expect(pack.id).toBe('case-pack-traffic-2026-09-09')
    for (const entry of pack.files.values()) {
      expect(entry.envelope.schemaVersion).toBe(CASE_PACK_SCHEMA_VERSION)
      expect(entry.envelope.sourceKind).toBe('fixture')
      // The pack is NOT uniform: the three computed-result files say `mock`, the rest
      // `fixture`. Asserting one value for all seven would hide that distinction.
      expect(['fixture', 'mock']).toContain(entry.envelope.truthfulness)
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/)
    }
  })

  it('reports the manifest’s own hash as an assertion and never claims to have checked it', () => {
    const pack = loadCasePack(SOURCE_PACK)
    const manifest = pack.files.get('reproducibility-manifest.json')

    // The value is the pack's, carried through verbatim. Nothing in this repository can
    // recompute it: the generator that wrote the pack is not in the tree.
    expect(pack.assertedHashOfInputs).toBe(manifest?.content.hashOfInputs)
    expect(pack.assertedHashOfInputs).toMatch(/^[0-9a-f]{64}$/)
    // What the loader DID compute is per file, and is a different fact about different bytes.
    expect(pack.assertedHashOfInputs).not.toBe(manifest?.sha256)
  })

  it('resolves a relative directory against the process working directory', () => {
    const pack = loadCasePack('plan/overnight/2026-09-09/case-pack-traffic')
    expect(pack.id).toBe('case-pack-traffic-2026-09-09')
  })
})

describe('loadCasePack — refusals', () => {
  it('refuses a directory that does not exist', () => {
    expect(() => loadCasePack(join(SOURCE_PACK, 'no-such-pack'))).toThrow(CasePackError)
    try {
      loadCasePack(join(SOURCE_PACK, 'no-such-pack'))
    } catch (error) {
      expect((error as CasePackError).code).toBe('CASE_PACK_DIR_MISSING')
    }
  })

  it('refuses a pack missing any one of its seven files', () => {
    const dir = packCopy()
    rmSync(join(dir, 'ablation.json'))
    try {
      loadCasePack(dir)
      throw new Error('expected a refusal')
    } catch (error) {
      expect((error as CasePackError).code).toBe('CASE_PACK_FILE_MISSING')
      expect((error as Error).message).toContain('ablation.json')
    }
  })

  it('refuses a file that is not valid JSON', () => {
    const dir = packCopy({ file: 'claim.json', content: '{ not json' })
    expect(() => loadCasePack(dir)).toThrow(/not valid JSON/)
  })

  it('refuses a file whose envelope is incomplete', () => {
    const dir = withField('claim.json', (content) => { delete content.truthfulness })
    try {
      loadCasePack(dir)
      throw new Error('expected a refusal')
    } catch (error) {
      expect((error as CasePackError).code).toBe('CASE_PACK_ENVELOPE_INVALID')
      expect((error as Error).message).toContain('truthfulness')
    }
  })

  it('refuses an unsupported schemaVersion instead of guessing at the format', () => {
    const dir = withField('claim.json', (content) => { content.schemaVersion = 'case-pack-traffic.v2' })
    try {
      loadCasePack(dir)
      throw new Error('expected a refusal')
    } catch (error) {
      expect((error as CasePackError).code).toBe('CASE_PACK_VERSION_UNSUPPORTED')
      expect((error as Error).message).toContain('case-pack-traffic.v2')
    }
  })

  it('preserves keys it does not read, so a richer pack loses nothing', () => {
    const dir = withField('claim.json', (content) => { content.futureField = { kept: true } })
    const pack = loadCasePack(dir)
    expect((pack.files.get('claim.json')?.content as { futureField?: unknown }).futureField)
      .toEqual({ kept: true })
  })
})

describe('the loader and the core allowlist agree', () => {
  it('every slug the loader declares is accepted by the core engine', () => {
    // `SEEDABLE_INPUTS` is deliberately not exported from core (it is deep-frozen and
    // consumed internally so no importer can widen it), so the slug names have two homes.
    // This test is what keeps them from drifting: the engine rejects an unlisted slug with
    // DSH_INPUT_NOT_SEEDABLE, so a loader slug the allowlist lacks fails here rather than
    // at the first real run.
    const store: ResearchRunStore = new Map()
    const runId = createRun(store)
    for (const slug of Object.values(CASE_PACK_INPUT_SLUGS)) {
      expect(() => { setRunInput(store, runId, slug, { probe: true }) }).not.toThrow()
    }
  })
})

describe('planCasePackInputs', () => {
  it('derives every run input, each naming the file and pointer it came from', () => {
    const inputs = planCasePackInputs(loadCasePack(SOURCE_PACK))
    const bySlug = new Map(inputs.map(input => [input.slug, input]))

    expect([...bySlug.keys()]).toEqual([
      CASE_PACK_INPUT_SLUGS.direction,
      CASE_PACK_INPUT_SLUGS.claim,
      CASE_PACK_INPUT_SLUGS.scenario,
      CASE_PACK_INPUT_SLUGS.experiment,
      CASE_PACK_INPUT_SLUGS.ablation,
      CASE_PACK_INPUT_SLUGS.boundary,
      CASE_PACK_INPUT_SLUGS.citations,
    ])
    for (const input of inputs) {
      expect(input.derivedFrom.length).toBeGreaterThan(0)
      for (const pointer of input.derivedFrom) expect(pointer).toMatch(/\.json#|\.json$/)
    }
  })

  it('labels each derived value from ITS OWN source file, never from the pack as a whole', () => {
    // The three computed-result files are `truthfulness: mock` /
    // `provenance: synthetic_deterministic`; the question and claim files are
    // `direct_fixture`. One envelope stamped across all of them would attribute a
    // synthetic result to the wrong source.
    const inputs = planCasePackInputs(loadCasePack(SOURCE_PACK))
    const bySlug = new Map(inputs.map(input => [input.slug, input.value as Record<string, unknown>]))
    const label = (slug: string): unknown => ({
      truthfulness: bySlug.get(slug)?.truthfulness,
      provenance: bySlug.get(slug)?.provenance,
      primaryFile: bySlug.get(slug)?.primaryFile,
    })

    expect(label(CASE_PACK_INPUT_SLUGS.claim))
      .toEqual({ truthfulness: 'fixture', provenance: 'direct_fixture', primaryFile: 'claim.json' })
    expect(label(CASE_PACK_INPUT_SLUGS.experiment))
      .toEqual({ truthfulness: 'mock', provenance: 'synthetic_deterministic', primaryFile: 'mock-experiment.json' })
    expect(label(CASE_PACK_INPUT_SLUGS.ablation))
      .toEqual({ truthfulness: 'mock', provenance: 'synthetic_deterministic', primaryFile: 'ablation.json' })
    expect(label(CASE_PACK_INPUT_SLUGS.boundary))
      .toEqual({ truthfulness: 'mock', provenance: 'synthetic_deterministic', primaryFile: 'boundary-counterexample.json' })
    for (const value of bySlug.values()) {
      if (typeof value !== 'object') continue
      expect(value.casePackId).toBe('case-pack-traffic-2026-09-09')
    }
  })

  it('supplies the four fields the claim step adjudicates', () => {
    const claim = planCasePackInputs(loadCasePack(SOURCE_PACK))
      .find(input => input.slug === CASE_PACK_INPUT_SLUGS.claim)?.value as Record<string, unknown>

    for (const field of ['assertion', 'essentialDifference', 'experimentToFalsify', 'prediction']) {
      expect(typeof claim[field]).toBe('string')
      expect((claim[field] as string).length).toBeGreaterThan(0)
    }
    // Restated from the pack's own two variant configurations, not authored here.
    expect(claim.essentialDifference).toContain('fixed-time')
  })

  it('fails when the pack is missing a datum the pipeline needs', () => {
    const dir = withField('claim.json', (content) => {
      content.prediction = {}
    })
    expect(() => planCasePackInputs(loadCasePack(dir))).toThrow(/claim\.json#prediction/)
  })

  it('changes the derived inputs when a pack parameter changes', () => {
    // The acceptance property: the pack is the driver, not a decoration. A changed
    // parameter must reach the run input, which is what makes a run reproducible from
    // the pack and different when the pack differs.
    const base = planCasePackInputs(loadCasePack(SOURCE_PACK))
    const edited = planCasePackInputs(loadCasePack(withField('case-pack.json', (content) => {
      const question = content.researchQuestion as { en: string }
      question.en = 'A DIFFERENT question for the same synthetic case.'
    })))

    const directionOf = (inputs: ReturnType<typeof planCasePackInputs>): unknown =>
      inputs.find(input => input.slug === CASE_PACK_INPUT_SLUGS.direction)?.value
    expect(directionOf(edited)).not.toBe(directionOf(base))
    expect(directionOf(edited)).toContain('A DIFFERENT question')
  })
})

describe('the envelope pair', () => {
  /** Copy the source pack, apply one edit, and try to load it. */
  function loadingWith(file: string, mutate: (content: Record<string, unknown>) => void): () => unknown {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-case-pack-pair-'))
    cpSync(SOURCE_PACK, dir, { recursive: true })
    const path = join(dir, file)
    const content = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    mutate(content)
    writeFileSync(path, JSON.stringify(content, null, 2), 'utf8')
    return () => loadCasePack(dir)
  }

  it('REFUSES a fixture pack that claims a live-external level', () => {
    // An audit copied the shipped pack and changed one file's truthfulness to `live_external`
    // while its own `sourceKind` still said `fixture`; the whole pipeline ran to sixteen steps
    // carrying that label into the artifacts and the manuscript. The two fields describe the same
    // material, and nothing had compared them.
    for (const file of CASE_PACK_FILES) {
      const load = loadingWith(file, (content) => { content['truthfulness'] = 'live_external' })
      expect(load, file).toThrow(/not a level a "fixture" source may claim/)
    }
  })

  it('REFUSES a sourceKind this loader does not define, rather than guessing its levels', () => {
    const load = loadingWith('claim.json', (content) => { content['sourceKind'] = 'peer-reviewed' })
    expect(load).toThrow(/sourceKind "peer-reviewed" is not one this loader defines/)
  })

  it('still loads the SHIPPED pack, whose pair is honest', () => {
    // `fixture` (16 occurrences) and `mock` (3) are the only levels the shipped pack declares.
    expect(loadCasePack(SOURCE_PACK).id).toBe('case-pack-traffic-2026-09-09')
  })
})
