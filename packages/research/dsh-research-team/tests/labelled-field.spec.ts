/**
 * The labelled-field parser and its placeholder guard.
 *
 * Four steps read model output through this parser (A1 gaps, A2 claim, B1 method,
 * D2 outline), so a lax parse does not merely misread one field — it lets a
 * non-answer travel downstream as content. The cases below are the two an audit
 * found: a label without a separator inventing a field, and a model echoing the
 * prompt's `<placeholder>` back being accepted as an answer.
 */

import { describe, expect, it } from 'vitest'
import { labelledField, looksLikePlaceholder } from '../src/runner/registry.ts'

describe('labelledField', () => {
  it('reads the plain, list-marked and emphasised forms', () => {
    expect(labelledField('TITLE: A study', 'TITLE')).toBe('A study')
    expect(labelledField('- TITLE: A study', 'TITLE')).toBe('A study')
    expect(labelledField('1. TITLE: A study', 'TITLE')).toBe('A study')
    expect(labelledField('TITLE = A study', 'TITLE')).toBe('A study')
    expect(labelledField('title: A study', 'TITLE')).toBe('A study')
    // Models commonly emphasise the label; the value is what matters.
    expect(labelledField('**TITLE:** A study', 'TITLE')).toBe('A study')
  })

  it('requires a separator, so a longer word is not a match', () => {
    // Without this, `ASSERTIONX: stray` reads as ASSERTION with value `X: stray` —
    // a field invented out of a different word.
    expect(labelledField('ASSERTIONX: stray', 'ASSERTION')).toBeUndefined()
    expect(labelledField('STEPSIZE: 3', 'STEPS')).toBeUndefined()
    expect(labelledField('METRICS: 5', 'METRIC')).toBeUndefined()
  })

  it('rejects an echoed template placeholder', () => {
    expect(labelledField('TITLE: <a specific paper title>', 'TITLE')).toBeUndefined()
    expect(labelledField('PREDICTION: TBD', 'PREDICTION')).toBeUndefined()
    expect(labelledField('ASSERTION: ...', 'ASSERTION')).toBeUndefined()
  })

  it('returns undefined for an absent or empty label', () => {
    expect(labelledField('nothing here', 'TITLE')).toBeUndefined()
    expect(labelledField('TITLE:', 'TITLE')).toBeUndefined()
    expect(labelledField('TITLE:   ', 'TITLE')).toBeUndefined()
  })
})

describe('looksLikePlaceholder', () => {
  it('flags bracketed placeholders and bare filler words', () => {
    expect(looksLikePlaceholder('<one sentence claim>')).toBe(true)
    expect(looksLikePlaceholder('  <value> ')).toBe(true)
    expect(looksLikePlaceholder('TBD')).toBe(true)
    expect(looksLikePlaceholder('n/a')).toBe(true)
    expect(looksLikePlaceholder('...')).toBe(true)
  })

  it('does not flag real content', () => {
    expect(looksLikePlaceholder('a claim about adaptive control')).toBe(false)
    expect(looksLikePlaceholder('12%')).toBe(false)
    // An angle bracket inside prose is not a placeholder.
    expect(looksLikePlaceholder('delay < baseline by 12%')).toBe(false)
  })
})
