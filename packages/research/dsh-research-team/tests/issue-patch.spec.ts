/**
 * A revision is a diff, or it is nothing.
 *
 * The defect (the review's R4): `D4-rebuttal` mapped every section to
 * `{ ...section, revised: record.hasRevisions }`. One concern that said it required a revision
 * therefore marked EVERY section revised while no body changed anywhere. An offline probe compared
 * the D3 and D4 drafts and measured `unchangedBodies: true, revisedFlags: [true, true]` — the
 * artifact claimed a revision it had not made, and what it handed on was byte-identical.
 *
 * These tests are the Issue → Patch → Verify cycle the review asked for: an issue names a section
 * and the version it was written against, a patch applies or it does not, and `revised` follows
 * from whether the body changed. The conflict case is the one that matters most — a patch written
 * against a stale version must not be applied, because applying it silently discards whatever
 * happened in between.
 */

import { describe, expect, it } from 'vitest'
import { getArtifact, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'

import { runT19B } from '../src/runner/drive.ts'
import { applyRevision, bodyHashOf } from '../src/runner/issue-patch.ts'
import type { RevisionIssue } from '../src/runner/issue-patch.ts'

const SECTIONS = [
  { id: 'method', heading: 'Method', bodyText: 'The method as written.' },
  { id: 'results', heading: 'Results', bodyText: 'The results as written.' },
  { id: 'conclusion', heading: 'Conclusion', bodyText: 'The conclusion as written.' },
]

function basis(sectionId: string): string {
  const section = SECTIONS.find(entry => entry.id === sectionId)
  return bodyHashOf(section?.bodyText ?? '')
}

function issue(overrides: Partial<RevisionIssue> & { sectionId: string }): RevisionIssue {
  return {
    issueId: 'issue-1',
    concern: 'a reviewer concern',
    response: 'an author response',
    requiresTextChange: false,
    basisHash: basis(overrides.sectionId),
    ...overrides,
  }
}

describe('a patch that changes a body closes its issue', () => {
  it('applies, records the diff, and marks only that section revised', () => {
    const applied = applyRevision(SECTIONS, [
      issue({
        sectionId: 'results',
        requiresTextChange: true,
        patch: 'The results as written, with the sentence the concern asked for.',
      }),
    ])
    expect(applied.outcomes[0]?.disposition).toBe('patched')
    expect(applied.patchedSections).toEqual(['results'])
    // PER SECTION, and derived from the bodies. Every section elsewhere is unchanged and says so.
    expect(applied.sections.map(section => [section.id, section.revised])).toEqual([
      ['method', false],
      ['results', true],
      ['conclusion', false],
    ])
    expect(applied.sections.find(section => section.id === 'results')?.bodyText)
      .toContain('the sentence the concern asked for')
    // The change names both hashes, so a reader can tell a real edit from a rewritten paragraph
    // that happens to read the same.
    expect(applied.changes[0]).toMatchObject({ sectionId: 'results', changed: true })
    expect(applied.changes[0]?.basisHash).not.toBe(applied.changes[0]?.resultHash)
  })

  it('leaves every other section byte-identical', () => {
    const applied = applyRevision(SECTIONS, [
      issue({ sectionId: 'results', requiresTextChange: true, patch: 'A different results body.' }),
    ])
    for (const id of ['method', 'conclusion']) {
      const before = SECTIONS.find(entry => entry.id === id)?.bodyText
      expect(applied.sections.find(section => section.id === id)?.bodyText).toBe(before)
    }
  })
})

describe('an issue that proposes no diff does not close', () => {
  it('stays open when the patch is the body it was written against', () => {
    // THE FAULT THE REVIEW MEASURED. A round whose "revision" reproduces the draft has revised
    // nothing, and a flag cannot make it so.
    const applied = applyRevision(SECTIONS, [
      issue({ sectionId: 'results', requiresTextChange: true, patch: 'The results as written.' }),
    ])
    expect(applied.outcomes[0]?.disposition).toBe('open')
    expect(applied.outcomes[0]?.reason).toContain('no diff')
    expect(applied.patchedSections).toEqual([])
    expect(applied.sections.every(section => !section.revised)).toBe(true)
    expect(applied.openIssues).toEqual(['issue-1'])
  })

  it('stays open when the issue requires a change and proposes no patch', () => {
    const applied = applyRevision(SECTIONS, [issue({ sectionId: 'results', requiresTextChange: true })])
    expect(applied.outcomes[0]?.disposition).toBe('open')
    expect(applied.outcomes[0]?.reason).toContain('proposes no replacement body')
    expect(applied.sections.find(section => section.id === 'results')?.bodyText).toBe('The results as written.')
  })

  it('stays open when the response is empty and no change is offered', () => {
    const applied = applyRevision(SECTIONS, [issue({ sectionId: 'results', response: '   ' })])
    expect(applied.outcomes[0]?.disposition).toBe('open')
  })
})

describe('an answer without a text change is recorded as an explanation', () => {
  it('is neither a patch nor an open issue', () => {
    const applied = applyRevision(SECTIONS, [
      issue({ sectionId: 'conclusion', response: 'The scope sentence already states this limit.' }),
    ])
    // A DIFFERENT OUTCOME from a patch, and it has to be: a reader comparing two rounds needs to
    // tell "the text was changed" from "the author argued and the text was left alone".
    expect(applied.outcomes[0]?.disposition).toBe('accepted_explanation')
    expect(applied.outcomes[0]?.reason).toContain('without a text change')
    expect(applied.patchedSections).toEqual([])
    expect(applied.openIssues).toEqual([])
  })
})

describe('a patch written against another version is refused, not applied', () => {
  it('stays open and names both versions', () => {
    // THE CONFLICT CASE, and the reason a patch carries a basis. Without it, applying this would
    // silently discard whatever changed between the round that wrote the patch and the one that
    // reads it.
    const applied = applyRevision(SECTIONS, [
      issue({
        sectionId: 'results',
        requiresTextChange: true,
        patch: 'A results body written against an older draft.',
        basisHash: bodyHashOf('a results body that no longer exists'),
      }),
    ])
    expect(applied.outcomes[0]?.disposition).toBe('open')
    expect(applied.outcomes[0]?.reason).toContain('different version')
    expect(applied.sections.find(section => section.id === 'results')?.bodyText).toBe('The results as written.')
  })

  it('refuses a second patch to a section the round already changed', () => {
    // Two issues, one section. The second was written against a body that no longer exists, so it
    // conflicts — which is the recovery: nothing is merged and nothing is silently dropped.
    const applied = applyRevision(SECTIONS, [
      issue({ issueId: 'issue-1', sectionId: 'results', requiresTextChange: true, patch: 'The first revision.' }),
      issue({ issueId: 'issue-2', sectionId: 'results', requiresTextChange: true, patch: 'The second revision.' }),
    ])
    expect(applied.outcomes.map(outcome => outcome.disposition)).toEqual(['patched', 'open'])
    expect(applied.sections.find(section => section.id === 'results')?.bodyText).toBe('The first revision.')
  })

  it('refuses an issue about a section the draft does not have', () => {
    const applied = applyRevision(SECTIONS, [issue({ sectionId: 'limitations' })])
    expect(applied.outcomes[0]?.disposition).toBe('open')
    expect(applied.outcomes[0]?.reason).toContain('no section')
  })
})

describe('the driven revision is a diff', () => {
  it('marks only the patched section revised, and the bodies actually differ', async () => {
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store)
    const draft = getArtifact(store, run.runId, 'draft') as
      | { sections: ReadonlyArray<{ id: string; bodyText: string }> }
      | undefined
    const revised = getArtifact(store, run.runId, 'revised-draft') as
      | {
        sections: ReadonlyArray<{ id: string; bodyText: string; revised: boolean }>
        patchedSections?: ReadonlyArray<string>
      }
      | undefined
    if (draft === undefined || revised === undefined) throw new Error('fixture: the run produced no drafts')

    // THE MEASUREMENT THE REVIEW MADE, as an assertion: the bodies are NOT all identical, and the
    // sections that changed are exactly the ones marked.
    expect(revised.patchedSections).toEqual(['results'])
    const changed = revised.sections.filter((section, index) => section.bodyText !== draft.sections[index]?.bodyText)
    expect(changed.map(section => section.id)).toEqual(['results'])
    expect(revised.sections.filter(section => section.revised).map(section => section.id)).toEqual(['results'])
    // And nothing that did not change claims it did.
    expect(revised.sections.filter(section => !section.revised)).toHaveLength(revised.sections.length - 1)
  })

  it('records what became of every concern, per issue', async () => {
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store)
    const rebuttal = getArtifact(store, run.runId, 'rebuttal') as
      | {
        issues?: ReadonlyArray<{ issueId: string; disposition: string; reason: string }>
        patchedSections?: ReadonlyArray<string>
        openIssues?: ReadonlyArray<string>
      }
      | undefined
    const dispositions = rebuttal?.issues?.map(entry => entry.disposition) ?? []
    // One explanation and one patch: the two outcomes the review asked to see recorded apart.
    expect(dispositions).toContain('accepted_explanation')
    expect(dispositions).toContain('patched')
    expect(rebuttal?.openIssues).toEqual([])
    for (const entry of rebuttal?.issues ?? []) expect(entry.reason.length).toBeGreaterThan(20)
  })

  it('passes its own A gate on the revised manuscript', async () => {
    // A patch that introduced a number the run never measured would be caught here, which is what
    // makes the revision cycle safe to run rather than merely recorded.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store)
    const d4 = run.steps.find(step => step.stepId === 'D4-rebuttal')
    expect(d4?.executeError).toBeUndefined()
    expect(d4?.status).toBe('passed')
    expect(d4?.verdicts.A).toBe('passed')
  })
})
