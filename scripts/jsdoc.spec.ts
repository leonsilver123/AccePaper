import { describe, expect, it } from 'vitest'
import { parseJsDoc, parseTags } from './jsdoc.ts'

/**
 * The JSDoc reader the documentation gates share (`verify-export-jsdoc`, `gen-config-catalog`,
 * `gen-persistence-catalog`, `cordis-core-api`).
 *
 * These pin the two spellings the repository's files are actually written in: the standard
 * ` * @param x - …`, and the older ` *  @param x - …` with two spaces after the asterisk. The
 * second used to be invisible — the reader stripped at most one space, so a present tag parsed as
 * description prose. The export gate then reported the tag as missing while the block above the
 * declaration visibly carried it, and the generated catalogs printed the tag as a sentence.
 */

describe('parseTags', () => {
  it('reads a tag written with one space after the asterisk', () => {
    const { params, returns } = parseTags('/**\n * Prose.\n * @param x - the thing.\n * @returns the result.\n */')
    expect(params.get('x')).toBe('the thing.')
    expect(returns).toBe('the result.')
  })

  it('reads the same tag written with two spaces, which the older files use', () => {
    const { params, returns } = parseTags('/**\n *  Prose.\n *  @param x - the thing.\n *  @returns the result.\n */')
    expect(params.get('x')).toBe('the thing.')
    expect(returns).toBe('the result.')
  })

  it('keeps a continuation line with its tag under either spelling', () => {
    const oneSpace = parseTags('/**\n * @param x - first line\n *   second line\n */')
    const twoSpace = parseTags('/**\n *  @param x - first line\n *    second line\n */')
    expect(oneSpace.params.get('x')).toBe('first line second line')
    expect(twoSpace.params.get('x')).toBe('first line second line')
  })

  it('reports an absent tag as absent rather than as an empty one', () => {
    const { params, returns } = parseTags('/**\n * Prose only.\n */')
    expect(params.size).toBe(0)
    expect(returns).toBeNull()
  })
})

describe('parseJsDoc', () => {
  it('does not read a tag line as description prose, under either spelling', () => {
    expect(parseJsDoc('/**\n * What it is.\n * @param x - the thing.\n */').doc).toBe('What it is.')
    expect(parseJsDoc('/**\n *  What it is.\n *  @param x - the thing.\n */').doc).toBe('What it is.')
  })

  it('keeps a list item that is indented past the asterisk', () => {
    const doc = parseJsDoc('/**\n * Intro line.\n *   - first item\n */').doc
    expect(doc).toContain('Intro line.')
    expect(doc).toContain('- first item')
  })
})
