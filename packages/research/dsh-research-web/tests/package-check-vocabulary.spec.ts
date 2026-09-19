/**
 * Every condition the host checks is on screen in the reader's own language.
 *
 * WHY THIS FILE EXISTS. The host's `checkFinalPackage` gained `manuscript-typeset` and
 * `typeset-complete`, and this package's vocabulary did not: the panel rendered both conditions as
 * the raw identifiers `manuscript-typeset` and `typeset-complete`, which is the answer to a question
 * about the reader's own manuscript given in a language nobody reads. A check the panel cannot name
 * IS a bug rather than a fallback, so the pairing is checked here rather than trusted.
 *
 * THE HOST'S OWN ANSWER IS THE LIST, and the spec asks the host for it rather than keeping a second
 * copy. The web package depends on no research package at RUNTIME — the layering is deliberate — but
 * a list of check codes kept here would be a copy nothing keeps in step, and the next condition the
 * host adds would vanish from the panel silently. `stages.spec.ts` imports the engine's catalogue
 * from source for the same reason; this spec imports the host's own check function, which returns
 * one entry per condition whatever the facts are. Production imports none of it.
 *
 * Both directions are asserted: a condition with no name is the defect above, and a name for a
 * condition that no longer exists is a dictionary slowly filling with words for things that cannot
 * happen.
 */
import { describe, expect, it } from 'vitest'
import { checkFinalPackage } from '../../dsh-research-team/src/runner/final-package.ts'
import type { FinalPackageFacts } from '../../dsh-research-team/src/runner/final-package.ts'
import { en, zh } from '../src/client/locales.ts'
import { packageCheckName } from '../src/client/record-vocabulary.ts'

/** A translate that echoes the key, so a check's dictionary key can be read off the table itself. */
const echoKey = (key: string): string => key

/**
 * Facts for a run that satisfies nothing.
 *
 * ONLY THE MEMBERS THAT EXIST MATTER: `checkFinalPackage` reports one check per condition whatever
 * these hold, which is the property this spec reads it for. The values are the emptiest legal ones so
 * a fact added to the host's set of checks cannot make this throw instead of fail.
 */
function facts(): FinalPackageFacts {
  return {
    profile: 'evaluation',
    manuscriptProduced: false,
    unfinishedSteps: [],
    refusedSections: [],
    openIssues: [],
    staleApproval: undefined,
    typeset: {
      renderedManuscriptVersion: undefined,
      manuscriptVersion: undefined,
      declaredFormats: [],
      documents: [],
    },
    compilation: { tool: null, dropped: [] },
    approval: undefined,
    declaredFiles: [],
    packagedFiles: [],
    deliverables: { produced: [], carried: [] },
    artifactRefs: { read: [], moved: [] },
    saveError: undefined,
  }
}

/** Every condition the host's own final-package check reports. */
function hostCheckCodes(): ReadonlyArray<string> {
  return checkFinalPackage(facts()).map(check => check.code)
}

describe('the package-check vocabulary', () => {
  it('names every condition the host checks, in both languages', () => {
    const codes = hostCheckCodes()
    expect(codes.length).toBeGreaterThan(0)
    for (const code of codes) {
      // The key the table gives this code, read off the table rather than spelled here: a code that
      // falls through the lookup answers with itself, which is the raw identifier the reader saw.
      const key = packageCheckName(code, echoKey)
      expect(key, code).not.toBe(code)
      expect(Object.keys(zh), key).toContain(key)
      expect(Object.keys(en), key).toContain(key)
      expect(zh[key as keyof typeof zh].length, key).toBeGreaterThan(0)
      expect(en[key as keyof typeof en].length, key).toBeGreaterThan(0)
    }
  })

  it('has no name for a condition the host does not check', () => {
    const named = new Map(hostCheckCodes().map(code => [packageCheckName(code, echoKey), code]))
    const declared = Object.keys(en).filter(key => key.startsWith('packageCheck.'))
    // Sorted and compared whole, so the failure names the orphan rather than a count.
    expect(declared.filter(key => !named.has(key)).sort()).toEqual([])
    expect(declared.length).toBe(named.size)
  })
})
