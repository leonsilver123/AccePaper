// @deepseek-ai/dsh-research-tools — T16 figure, 5x7 bitmap face for the PNG raster.
//
// The PNG path cannot rely on an OS font rasterizer (no canvas/fonts in a pure
// Node context), so the raster draws text with this tiny built-in 5x7 face.
// The face is derived from an ASCII-art table at module load (pure, cached),
// which keeps the glyphs readable in source. Rendering is deterministic: same
// text + same scale always draws the same pixels.
//
// Coverage: digits, uppercase A-Z (lowercase is uppercased before drawing),
// space and a small explicit punctuation set. Any OTHER printable-ASCII char
// (labels are ASCII-printable by validation) falls back to '?' so the raster
// never drops or shifts content silently.

/** 7 rows of width-5 '#'-marks per glyph. */
type GlyphArt = readonly [string, string, string, string, string, string, string]

const GLYPH_ART: Readonly<Record<string, GlyphArt>> = {
  ' ': ['     ', '     ', '     ', '     ', '     ', '     ', '     '],
  '0': [' ### ', '#   #', '#  ##', '# # #', '##  #', '#   #', ' ### '],
  '1': ['  #  ', ' ##  ', '  #  ', '  #  ', '  #  ', '  #  ', ' ### '],
  '2': [' ### ', '#   #', '    #', '   # ', '  #  ', ' #   ', '#####'],
  '3': ['#####', '    #', '   # ', '  ## ', '    #', '#   #', ' ### '],
  '4': ['   # ', '  ## ', ' # # ', '#  # ', '#####', '   # ', '   # '],
  '5': ['#####', '#    ', '#### ', '    #', '    #', '#   #', ' ### '],
  '6': ['  ## ', ' #   ', '#    ', '#### ', '#   #', '#   #', ' ### '],
  '7': ['#####', '    #', '   # ', '  #  ', ' #   ', ' #   ', ' #   '],
  '8': [' ### ', '#   #', '#   #', ' ### ', '#   #', '#   #', ' ### '],
  '9': [' ### ', '#   #', '#   #', ' ####', '    #', '   # ', ' ##  '],
  A: [' ### ', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
  B: ['#### ', '#   #', '#   #', '#### ', '#   #', '#   #', '#### '],
  C: [' ### ', '#   #', '#    ', '#    ', '#    ', '#   #', ' ### '],
  D: ['#### ', '#   #', '#   #', '#   #', '#   #', '#   #', '#### '],
  E: ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#####'],
  F: ['#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#    '],
  G: [' ### ', '#   #', '#    ', '# ###', '#   #', '#   #', ' ####'],
  H: ['#   #', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'],
  I: [' ### ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', ' ### '],
  J: ['   ##', '   # ', '   # ', '   # ', '   # ', '#  # ', ' ##  '],
  K: ['#   #', '#  # ', '# #  ', '##   ', '# #  ', '#  # ', '#   #'],
  L: ['#    ', '#    ', '#    ', '#    ', '#    ', '#    ', '#####'],
  M: ['#   #', '## ##', '# # #', '# # #', '#   #', '#   #', '#   #'],
  N: ['#   #', '##  #', '# # #', '#  ##', '#   #', '#   #', '#   #'],
  O: [' ### ', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
  P: ['#### ', '#   #', '#   #', '#### ', '#    ', '#    ', '#    '],
  Q: [' ### ', '#   #', '#   #', '#   #', '# # #', '#  # ', ' ## #'],
  R: ['#### ', '#   #', '#   #', '#### ', '# #  ', '#  # ', '#   #'],
  S: [' ####', '#    ', '#    ', ' ### ', '    #', '    #', '#### '],
  T: ['#####', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  '],
  U: ['#   #', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '],
  V: ['#   #', '#   #', '#   #', '#   #', '#   #', ' # # ', '  #  '],
  W: ['#   #', '#   #', '#   #', '# # #', '# # #', '## ##', '#   #'],
  X: ['#   #', '#   #', ' # # ', '  #  ', ' # # ', '#   #', '#   #'],
  Y: ['#   #', '#   #', ' # # ', '  #  ', '  #  ', '  #  ', '  #  '],
  Z: ['#####', '    #', '   # ', '  #  ', ' #   ', '#    ', '#####'],
  '.': ['     ', '     ', '     ', '     ', '     ', '     ', '  #  '],
  ',': ['     ', '     ', '     ', '     ', '  #  ', ' #   ', ' #   '],
  '-': ['     ', '     ', '     ', ' ### ', '     ', '     ', '     '],
  ':': ['     ', '  #  ', '     ', '     ', '  #  ', '     ', '     '],
  ';': ['     ', '  #  ', '     ', '     ', '  #  ', ' #   ', ' #   '],
  '/': ['    #', '   # ', '  #  ', ' #   ', '#    ', '     ', '     '],
  '(': ['   # ', '  #  ', ' #   ', ' #   ', ' #   ', '  #  ', '   # '],
  ')': [' #   ', '  #  ', '   # ', '   # ', '   # ', '  #  ', ' #   '],
  '%': ['#   #', '#   #', '   # ', '  #  ', ' #   ', '#   #', '#   #'],
  '+': ['     ', '  #  ', '  #  ', ' ### ', '  #  ', '  #  ', '     '],
  '=': ['     ', '     ', ' ### ', '     ', ' ### ', '     ', '     '],
  '_': ['     ', '     ', '     ', '     ', '     ', '     ', '#####'],
  '!': ['  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '     ', '  #  '],
  '?': [' ### ', '#   #', '    #', '   # ', '  #  ', '     ', '  #  '],
  "'": ['  #  ', '  #  ', '     ', '     ', '     ', '     ', '     '],
  '#': [' # # ', ' # # ', '#####', ' # # ', '#####', ' # # ', ' # # '],
  '*': ['     ', '# # #', ' ### ', '#####', ' ### ', '# # #', '     '],
}

/** Character-cell advance (glyph 5px wide + 1px spacing) at scale 1. */
export const FONT_ADVANCE = 6
export const FONT_HEIGHT = 7

function artToRows(art: GlyphArt): ReadonlyArray<number> {
  const rows: number[] = []
  for (let r = 0; r < 7; r += 1) {
    /* v8 ignore next -- defensive: every GlyphArt entry is a fixed 7-row tuple, so art[r] is always defined here. */
    const line = art[r] ?? ''
    let value = 0
    for (let col = 0; col < 5; col += 1) {
      if (line.charAt(col) === '#') {
        value |= 1 << (4 - col) // bit4 = leftmost column
      }
    }
    rows.push(value)
  }
  return rows
}

/** char -> 7 row bitmasks (bit 4 = leftmost column of the 5px glyph). */
export const GLYPHS: Readonly<Record<string, ReadonlyArray<number>>> = (() => {
  const built: Record<string, ReadonlyArray<number>> = {}
  for (const [ch, art] of Object.entries(GLYPH_ART)) {
    built[ch] = artToRows(art)
  }
  return built
})()

const QUESTION_ROWS = GLYPHS['?'] as ReadonlyArray<number>

/** Raster-time glyph for a character: uppercase letters, exact glyph match, or
 *  '?' for any printable-ASCII char outside the face. */
export function glyphRowsFor(ch: string): ReadonlyArray<number> {
  const ascii = ch.charCodeAt(0)
  if (ascii >= 0x61 && ascii <= 0x7a) {
    const upper = String.fromCharCode(ascii - 0x20)
    /* v8 ignore next -- defensive: GLYPH_ART defines every A-Z uppercase glyph, so GLYPHS[upper] is always present. */
    return GLYPHS[upper] ?? QUESTION_ROWS
  }
  return GLYPHS[ch] ?? QUESTION_ROWS
}

/** Width in px (at scale 1) of `text` drawn with this face. */
export function textWidth(text: string): number {
  return text.length * FONT_ADVANCE
}
