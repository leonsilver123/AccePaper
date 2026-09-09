// Host tool runtime compatibility layer (Phase 1.1-R track B) — vitest spec.
//
// Covers: fixed module id behaviour, module-shape / API-capability checks,
// version/capability gate, stable error codes, and message hygiene (no local
// path / environment disclosure). Every failure branch is driven through the
// injectable loader seam — not a mock of the success path only.

import { describe, expect, it } from 'vitest'
import {
  RESEARCH_TOOL_HOST_ERROR_CODES,
  ResearchToolHostError,
  loadHostToolsModuleWith,
  validateHostToolsModule,
} from '../src/tools.ts'

describe('host tool runtime compatibility layer', () => {
  it('defines the four stable error codes', () => {
    expect(Object.values(RESEARCH_TOOL_HOST_ERROR_CODES).sort()).toEqual([
      'RESEARCH_TOOL_HOST_API_MISMATCH',
      'RESEARCH_TOOL_HOST_LOAD_FAILED',
      'RESEARCH_TOOL_HOST_SHAPE_INVALID',
      'RESEARCH_TOOL_HOST_VERSION_UNSUPPORTED',
    ])
  })

  it('module load failure maps to HOST_LOAD_FAILED and leaks no path', async () => {
    try {
      await loadHostToolsModuleWith({
        load: () => Promise.reject(new Error('Cannot find package ... resolved to C:\\secret\\app\\node_modules\\x')),
      })
      expect.unreachable('should throw')
    } catch (error) {
      expect(error).toBeInstanceOf(ResearchToolHostError)
      expect((error as ResearchToolHostError).code).toBe(RESEARCH_TOOL_HOST_ERROR_CODES.HOST_LOAD_FAILED)
      const message = (error as Error).message
      expect(message).not.toContain('C:\\secret')
      expect(message).not.toContain('node_modules')
      expect(message).toContain(RESEARCH_TOOL_HOST_ERROR_CODES.HOST_LOAD_FAILED)
    }
  })

  it('non-object module maps to HOST_SHAPE_INVALID', async () => {
    await expect(loadHostToolsModuleWith({ load: () => Promise.resolve(null) }))
      .rejects.toMatchObject({ code: RESEARCH_TOOL_HOST_ERROR_CODES.HOST_SHAPE_INVALID })
  })

  it('missing or wrongly-typed defineTool maps to HOST_API_MISMATCH', async () => {
    await expect(loadHostToolsModuleWith({ load: () => Promise.resolve({}) }))
      .rejects.toMatchObject({ code: RESEARCH_TOOL_HOST_ERROR_CODES.HOST_API_MISMATCH })
    await expect(loadHostToolsModuleWith({ load: () => Promise.resolve({ defineTool: 'not-fn' }) }))
      .rejects.toMatchObject({ code: RESEARCH_TOOL_HOST_ERROR_CODES.HOST_API_MISMATCH })
    expect(() => validateHostToolsModule(42)).toThrow(ResearchToolHostError)
  })

  it('compatible version passes; incompatible version maps to HOST_VERSION_UNSUPPORTED', async () => {
    const fn = () => ({ name: 'ok' })
    await expect(loadHostToolsModuleWith({
      load: () => Promise.resolve({ defineTool: fn }),
      loadVersion: () => Promise.resolve({ version: '0.1.2-alpha.4' }),
    })).resolves.toBe(fn)
    await expect(loadHostToolsModuleWith({
      load: () => Promise.resolve({ defineTool: fn }),
      loadVersion: () => Promise.resolve({ version: '9.9.9' }),
    })).rejects.toMatchObject({ code: RESEARCH_TOOL_HOST_ERROR_CODES.HOST_VERSION_UNSUPPORTED })
  })

  it('unavailable manifest degrades to the capability gate (defineTool) only', async () => {
    const fn = () => ({ name: 'ok' })
    await expect(loadHostToolsModuleWith({
      load: () => Promise.resolve({ defineTool: fn }),
      loadVersion: () => Promise.reject(new Error('manifest not exported')),
    })).resolves.toBe(fn)
  })

  it('diagnostics never embed the fixed module id caller or environment text', () => {
    // The fixed module id is referenced only as a safe constant; error messages
    // are constructed from fixed text + codes, never from thrown causes.
    const err = new ResearchToolHostError(
      RESEARCH_TOOL_HOST_ERROR_CODES.HOST_API_MISMATCH,
      'fixed diagnostic',
    )
    expect(err.message).toBe('fixed diagnostic')
    expect(err.code).toBe(RESEARCH_TOOL_HOST_ERROR_CODES.HOST_API_MISMATCH)
    expect(JSON.stringify(err.message)).not.toContain('$')
  })
})
