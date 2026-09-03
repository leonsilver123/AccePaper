// @deepseek-ai/dsh-research-tools — T16 figure, REAL PNG encoder (built-ins only).
//
// Decision-rules (b) outcome of the T16 capability recon: no in-repo image
// capability is importable from a pure-TS tool package under pnpm's strict
// node_modules (sharp is declared only in packages/attachment/attachment-local
// and is not resolvable here without editing the main-Agent-owned package.json),
// and no package hand-rolls PNG. This module therefore implements a byte-valid
// PNG encoder using ONLY Node built-ins:
//   - node:zlib deflateSync for the IDAT stream,
//   - a hand-rolled CRC-32 (PNG polynomial 0xEDB88320) and chunk writer
//     (IHDR / IDAT / IEND),
//   - truecolor RGBA (colour type 6, bit depth 8), filter byte 0 per scanline.
//
// The output is a REAL PNG — verifiable by signature bytes, chunk structure,
// dimensions and zlib-inflatable IDAT — never a filename and never fabricated
// base64. This module is an {@link FigurePngAdapter} (see adapter.ts): the tool
// injects it by default, and structurally invalid adapter output (e.g. bytes
// that are not a matching PNG) is caught by the tool as an adapter fault.

import { deflateSync } from 'node:zlib'

/** PNG magic signature bytes (89 50 4E 47 0D 0A 1A 0A). */
export const PNG_SIGNATURE: ReadonlyArray<number> = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export const PNG_SIGNATURE_HEX = '89504e470d0a1a0a'

/** PNG colour type for RGBA truecolor (used in IHDR). */
export const PNG_COLOR_TYPE_RGBA = 6

// ── CRC-32 (PNG polynomial), table built lazily and cached — deterministic. ──
let CRC_TABLE: Uint32Array | undefined

function crcTable(): Uint32Array {
  if (CRC_TABLE !== undefined) {
    return CRC_TABLE
  }
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[n] = c >>> 0
  }
  CRC_TABLE = table
  return table
}

function crc32(bytes: Uint8Array): number {
  const table = crcTable()
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) {
    // defensive: i is bounded by bytes.length and the masked table index is
    // always 0..255, so neither read below can ever be undefined.
    /* v8 ignore start -- bounded index reads */
    const byte = bytes[i] ?? 0
    const cell = table[(crc ^ byte) & 0xff] ?? 0
    /* v8 ignore stop */
    crc = cell ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  // type (4) + data + CRC-32 over (type || data); CRC computed before the
  // final buffer is assembled (a chunk is < 2^31 bytes so the length field and
  // the unsigned CRC both fit in uint32).
  const typeBytes = new Uint8Array(4)
  for (let i = 0; i < 4; i += 1) {
    const code = type.charCodeAt(i)
    /* v8 ignore next -- defensive: chunk() is only ever called with the ASCII constants IHDR/IDAT/IEND. */
    if (code > 0x7f) {
      throw new Error(`PNG encoder: chunk type must be ASCII ("${type}")`)
    }
    typeBytes[i] = code
  }
  const typeAndData = new Uint8Array(4 + data.length)
  typeAndData.set(typeBytes, 0)
  typeAndData.set(data, 4)
  const crc = crc32(typeAndData)
  const out = new Uint8Array(12 + data.length)
  new DataView(out.buffer).setUint32(0, data.length)
  out.set(typeAndData, 4)
  new DataView(out.buffer).setUint32(8 + data.length, crc)
  return out
}

function ihdrChunk(width: number, height: number): Uint8Array {
  const data = new Uint8Array(13)
  const view = new DataView(data.buffer)
  view.setUint32(0, width)
  view.setUint32(4, height)
  data[8] = 8 // bit depth
  data[9] = PNG_COLOR_TYPE_RGBA // colour type 6 (RGBA truecolor)
  data[10] = 0 // compression method
  data[11] = 0 // filter method
  data[12] = 0 // interlace method
  return chunk('IHDR', data)
}

function idatChunk(compressed: Uint8Array): Uint8Array {
  return chunk('IDAT', compressed)
}

function iendChunk(): Uint8Array {
  return chunk('IEND', new Uint8Array(0))
}

export interface PngBitmapInput {
  readonly width: number
  readonly height: number
  /** width*height*4 bytes RGBA, top row first (validated by callers). */
  readonly rgba: Uint8Array
}

/**
 * Encode an RGBA bitmap as a real PNG (byte-valid). Throws a plain Error on
 * impossible internal misuse (adapter-throw propagates as-is by contract — the
 * tool pre-validates all inputs so these branches are defensive only).
 */
export function encodePng(bitmap: PngBitmapInput): Uint8Array {
  const { width, height, rgba } = bitmap
  if (
    !(width >= 1) ||
    !(height >= 1) ||
    !(Number.isSafeInteger(width) && Number.isSafeInteger(height))
  ) {
    throw new Error(`PNG encoder: invalid dimensions ${width}x${height}`)
  }
  if (!(rgba instanceof Uint8Array)) {
    throw new Error('PNG encoder: rgba must be a Uint8Array')
  }
  const expected = width * height * 4
  if (rgba.length !== expected) {
    throw new Error(
      `PNG encoder: rgba length ${rgba.length} != expected ${expected} (${width}x${height}x4)`,
    )
  }
  // defensive: the length check above forces a (width*height*4)-byte
  // Uint8Array, which cannot exist when width or height exceeds 2^32-1 (it
  // would need more than 16 GiB of memory), so this guard is unreachable.
  /* v8 ignore start -- dimension-overflow guard is unreachable */
  if (width > 0xffffffff || height > 0xffffffff) {
    throw new Error(`PNG encoder: dimensions exceed PNG limits (${width}x${height})`)
  }
  /* v8 ignore stop */

  // Raw scanlines: filter byte 0 (None) + row pixels, per the PNG spec.
  const stride = width * 4
  const raw = new Uint8Array(height * (1 + stride))
  for (let y = 0; y < height; y += 1) {
    const rawStart = y * (1 + stride)
    raw[rawStart] = 0 // filter: None
    raw.set(rgba.subarray(y * stride, (y + 1) * stride), rawStart + 1)
  }

  const compressed = deflateSync(raw, { level: 9 })

  const signature = Uint8Array.from(PNG_SIGNATURE)
  const ihdr = ihdrChunk(width, height)
  const idat = idatChunk(compressed)
  const iend = iendChunk()
  const total = signature.length + ihdr.length + idat.length + iend.length
  const out = new Uint8Array(total)
  let offset = 0
  out.set(signature, offset)
  offset += signature.length
  out.set(ihdr, offset)
  offset += ihdr.length
  out.set(idat, offset)
  offset += idat.length
  out.set(iend, offset)
  return out
}

// ── Structural inspection (used by the tool for adapter-output validation and
//    by tests to verify the PNG is REAL — signature/IHDR/IDAT/IEND/dims). ─────

export interface PngInspectInfo {
  readonly width: number
  readonly height: number
  readonly bitDepth: number
  readonly colourType: number
  readonly idatBytes: number
  readonly chunkCount: number
}

export type PngInspectResult =
  | { readonly ok: true; readonly info: PngInspectInfo }
  | { readonly ok: false; readonly reason: string }

/** Parse a PNG byte stream and report whether it is structurally valid. */
export function inspectPng(bytes: Uint8Array): PngInspectResult {
  if (!(bytes instanceof Uint8Array)) {
    return { ok: false, reason: 'input is not a Uint8Array' }
  }
  if (bytes.length < 8 + 12 + 12) {
    return { ok: false, reason: 'byte stream shorter than a minimal PNG' }
  }
  for (let i = 0; i < PNG_SIGNATURE.length; i += 1) {
    if (bytes[i] !== PNG_SIGNATURE[i]) {
      return { ok: false, reason: 'PNG signature bytes missing' }
    }
  }
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colourType = 0
  let idatBytes = 0
  let chunkCount = 0
  let sawIhdr = false
  let sawIend = false
  while (offset + 8 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8)
    const length = view.getUint32(0)
    const type = String.fromCharCode(
      /* v8 ignore start -- defensive: the loop guard offset + 8 <= bytes.length guarantees these four bytes exist. */
      bytes[offset + 4] ?? 0,
      bytes[offset + 5] ?? 0,
      bytes[offset + 6] ?? 0,
      bytes[offset + 7] ?? 0,
      /* v8 ignore stop */
    )
    if (offset + 12 + length > bytes.length) {
      return { ok: false, reason: `chunk ${type} overruns the byte stream` }
    }
    chunkCount += 1
    if (type === 'IHDR') {
      if (length !== 13) {
        return { ok: false, reason: 'IHDR must carry exactly 13 bytes' }
      }
      sawIhdr = true
      const data = new DataView(bytes.buffer, bytes.byteOffset + offset + 8, 13)
      width = data.getUint32(0)
      height = data.getUint32(4)
      /* v8 ignore start -- defensive: IHDR length 13 was checked above, so the bit-depth/colour-type bytes at offsets +16/+17 exist. */
      bitDepth = bytes[offset + 16] ?? 0
      colourType = bytes[offset + 17] ?? 0
      /* v8 ignore stop */
      if (bitDepth !== 8) {
        return { ok: false, reason: `unsupported bit depth ${bitDepth}` }
      }
      if (colourType !== PNG_COLOR_TYPE_RGBA) {
        return { ok: false, reason: `unsupported colour type ${colourType}` }
      }
    } else if (type === 'IDAT') {
      idatBytes += length
    } else if (type === 'IEND') {
      sawIend = true
      offset += 12 + length
      break
    }
    offset += 12 + length
  }
  if (!sawIhdr) {
    return { ok: false, reason: 'IHDR chunk missing' }
  }
  if (!sawIend) {
    return { ok: false, reason: 'IEND chunk missing' }
  }
  if (idatBytes === 0) {
    return { ok: false, reason: 'IDAT chunk(s) carry no data' }
  }
  if (!(width >= 1) || !(height >= 1)) {
    return { ok: false, reason: `invalid dimensions ${width}x${height}` }
  }
  return { ok: true, info: { width, height, bitDepth, colourType, idatBytes, chunkCount } }
}
