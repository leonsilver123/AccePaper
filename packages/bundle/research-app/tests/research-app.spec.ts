/**
 * dsh-research-app bundle contract (T30) — vitest spec.
 *
 * The research-app bundle is a PATCH-ONLY layer (its `cordis.patch.yml` applies
 * over dsh-base → dsh-web-app in the `web` profile stack); it carries no
 * runtime glue of its own. The loader consumes that file as text (its `!!js`
 * expression dialect is not plain YAML), so this spec asserts the patch
 * contract at the text level: the research transport fallback port (1120), the
 * three plugin rows mounted (research-cordis / research-team / research-web),
 * the absence of any experimental row (AUD-04), and the five dsh-research-*
 * dependencies that make the rows resolvable.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const patch = readFileSync(`${HERE}../cordis.patch.yml`, 'utf8')
const manifest = JSON.parse(readFileSync(`${HERE}../package.json`, 'utf8')) as {
  name: string
  dependencies: Record<string, string>
  dsh: { bundle: { patch: string } }
  exports: Record<string, unknown>
}

describe('dsh-research-app bundle contract (T30)', () => {
  it('is the research layer bundle with the five research packages declared', () => {
    expect(manifest.name).toBe('@deepseek-ai/dsh-research-app')
    expect(manifest.dsh.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.exports['./cordis.patch.yml']).toBe('./cordis.patch.yml')
    for (const pkg of [
      'cordis', 'core', 'team', 'tools', 'web',
    ]) {
      expect(manifest.dependencies[`@deepseek-ai/dsh-research-${pkg}`]).toBeDefined()
    }
  })

  it('binds the research webserver fallback port to 1120, flag still authoritative', () => {
    // The webserver row restates host/port with the webStartup override; the
    // fallback default is 1120 (not the web-app default 3080).
    expect(patch).toContain('port: !!js ctx.webStartup.port ?? 1120')
    expect(patch).toContain('host: !!js ctx.webStartup.host ?? \'127.0.0.1\'')
    expect(patch).toContain('compression: gzip')
  })

  it('mounts exactly the three plugin rows (research-cordis / team / web)', () => {
    const rows = ['research-cordis', 'research-team', 'research-web']
    for (const id of rows) {
      expect(patch).toContain(`    - id: ${id}`)
      expect(patch).toContain(`      name: '@deepseek-ai/dsh-${id}'`)
    }
    // No other plugin id is inserted.
    const inserted = (patch.match(/\n\s+- id: ([a-z0-9-]+)/g) ?? [])
      .map(line => line.trim().slice(6))
    expect(inserted).toEqual(rows)
  })

  it('never mounts an experimental row (AUD-04)', () => {
    expect(patch).not.toMatch(/experimental/i)
  })

  it('documents the layer apply order (base → web-app → research-app)', () => {
    // The patch header is the operator-facing composition contract; assert the
    // ordering statement is present so a reorder cannot silently drop it.
    expect(patch).toContain('1. dsh-base')
    expect(patch).toContain('2. dsh-web-app')
    expect(patch).toContain('3. dsh-research-app')
  })
})
