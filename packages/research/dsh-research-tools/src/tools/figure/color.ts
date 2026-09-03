// @deepseek-ai/dsh-research-tools — T16 figure, color-token grammar.
//
// Pure color handling used by BOTH renderers so the SVG and the PNG raster
// agree on exactly one canonical representation:
//  - a valid color token is '#rgb' / '#rrggbb' hex OR one of a small explicit
//    allowlisted set of CSS named colors (see NAMED_COLORS below);
//  - {@link canonicalizeColor} returns the canonical '#rrggbb' form (case
//    normalized) or throws RangeError for anything else — validation in
//    ./index.ts catches that and raises DSH_FIGURE_INVALID_COLOR_TOKEN, so by
//    the time any string reaches the SVG builder or rasterizer it is a safe,
//    validated hex value.
//
// The SVG therefore only ever embeds canonicalized hex (no unvalidated raw
// strings), and the raster only needs {@link parseColor} on the same hex.

/** Allowlisted CSS named colors (the set the tool accepts). Anything else must
 *  be expressed as #rgb / #rrggbb. */
export const NAMED_COLORS: Readonly<Record<string, readonly [number, number, number]>> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
  navy: [0, 0, 128],
  maroon: [128, 0, 0],
  teal: [0, 128, 128],
  purple: [128, 0, 128],
  olive: [128, 128, 0],
  lime: [0, 255, 0],
  orange: [255, 165, 0],
  pink: [255, 192, 203],
  brown: [165, 42, 42],
  crimson: [220, 20, 60],
  gold: [255, 215, 0],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
  indigo: [75, 0, 130],
  violet: [238, 130, 238],
  salmon: [250, 128, 114],
  skyblue: [135, 206, 235],
  steelblue: [70, 130, 180],
  darkblue: [0, 0, 139],
  darkgreen: [0, 100, 0],
  darkred: [139, 0, 0],
  slategray: [112, 128, 144],
  slategrey: [112, 128, 144],
}

function hexByte(token: string, start: number): number {
  const byte = Number.parseInt(token.slice(start, start + 2), 16)
  return byte
}

/**
 * Validate + canonicalize one color token.
 * @throws {RangeError} when the token is not a valid hex or allowlisted name.
 */
export function canonicalizeColor(rawToken: unknown): string {
  if (typeof rawToken !== 'string') {
    throw new RangeError(`color token must be a string (got ${String(rawToken)})`)
  }
  const token = rawToken.trim().toLowerCase()
  if (token.length === 0) {
    throw new RangeError('color token must not be empty after trimming')
  }
  if (token.startsWith('#')) {
    if (token.length === 4) {
      // #rgb -> #rrggbb (each nibble doubled)
      if (!/^#[0-9a-f]{3}$/.test(token)) {
        throw new RangeError(`invalid hex color token "${rawToken}"`)
      }
      const nibble = (index: number): string => {
        const hexDigit = token.charAt(index)
        return `${hexDigit}${hexDigit}`
      }
      return `#${nibble(1)}${nibble(2)}${nibble(3)}`
    }
    if (token.length === 7) {
      if (!/^#[0-9a-f]{6}$/.test(token)) {
        throw new RangeError(`invalid hex color token "${rawToken}"`)
      }
      return `#${token.slice(1)}`
    }
    throw new RangeError(`hex color token "${rawToken}" must be #rgb or #rrggbb`)
  }
  const named = NAMED_COLORS[token]
  if (named === undefined) {
    throw new RangeError(`unknown color token "${rawToken}" (use #rgb/#rrggbb or an allowlisted name)`)
  }
  const [r, g, b] = named
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b
    .toString(16)
    .padStart(2, '0')}`
}

export interface Rgb {
  readonly r: number
  readonly g: number
  readonly b: number
}

/**
 * Parse a color token (already validated via {@link canonicalizeColor}) into an
 * {r,g,b} triple for the PNG raster. Throws RangeError for tokens that never
 * passed canonicalization (internal misuse — the tool only calls this on
 * canonical output).
 */
export function parseColor(canonicalHex: string): Rgb {
  if (!/^#[0-9a-f]{6}$/.test(canonicalHex)) {
    throw new RangeError(`canonicalizeColor produced an unparseable token: "${canonicalHex}"`)
  }
  return {
    r: hexByte(canonicalHex, 1),
    g: hexByte(canonicalHex, 3),
    b: hexByte(canonicalHex, 5),
  }
}
