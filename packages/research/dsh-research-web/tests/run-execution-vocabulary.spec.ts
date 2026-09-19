/**
 * Every state the Host can name is on screen in the reader's own language.
 *
 * WHY THIS FILE EXISTS. The run list showed "the host named a state this build does not know" for
 * every stored run whose snapshot this build cannot parse. The state was `unreadable`; it existed in
 * the Host's `ResearchRunExecution`, in the client's list, and in BOTH dictionaries — and the panel
 * still printed the fallback, because the client kept a SECOND copy of the union and the list that
 * covered only three of the four. A dictionary entry nothing can reach is the same silence as a
 * missing one, so the pairing is checked here rather than trusted.
 *
 * The list's own completeness against the union is a compile-time check in `summary.ts`
 * (`MissingExecution`); this is the half a type cannot see.
 */
import { describe, expect, it } from 'vitest'
import { RUN_EXECUTIONS } from '../src/summary.ts'
import { en, zh } from '../src/client/locales.ts'

describe('the run-execution vocabulary', () => {
  it('names every state in both languages', () => {
    // Both directions: a state with no entry is the bug above, and an entry for a state that no
    // longer exists is a dictionary slowly filling with words for things that cannot happen.
    for (const execution of RUN_EXECUTIONS) {
      const key = `run.execution.${execution}`
      expect(Object.keys(zh), key).toContain(key)
      expect(Object.keys(en), key).toContain(key)
      expect(zh[key as keyof typeof zh].length, key).toBeGreaterThan(0)
      expect(en[key as keyof typeof en].length, key).toBeGreaterThan(0)
    }
  })

  it('has no entry for a state the list does not carry', () => {
    const named = new Set(RUN_EXECUTIONS.map(execution => `run.execution.${execution}`))
    const declared = Object.keys(en).filter(key => key.startsWith('run.execution.'))
    // Sorted and compared whole, so the failure names the orphan rather than a count.
    expect(declared.filter(key => !named.has(key)).sort()).toEqual([])
    expect(declared.length).toBe(RUN_EXECUTIONS.length)
  })
})
