import { defineConfig } from 'tsdown'
import { typertPlugin } from './packages/typert/generator/lib/types/tsdown-plugin.js'

function isBuildFaceClient(value: unknown): boolean {
  if (value === undefined || value === 'host') return false
  if (value === 'client') return true
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

/**
 * The ordinary workspace build consumes JavaScript emitted by the Host
 * TypeScript project and runs Typert. The Client pass selects packages that
 * declare a browser bundle and lets their package-local configs emit both
 * their Node loader entry and browser artifact.
 */
export default defineConfig(({ env }) => {
  const client = isBuildFaceClient(env?.DSH_BUILD_FACE)
  return {
    // dsh-research-core is a standalone pure-TS domain core (no Cordis). It builds itself via
    // a package-local tsdown.config (src/index.ts → lib/index.js, src/host.ts → lib/host.js)
    // + tsc -p tsconfig.json emits lib/types. It is INCLUDED in the workspace build (no longer
    // excluded) so its lib/index.js is produced for the adapter's production import. The main
    // entry exports NO trust capability; the `./host` subpath is the only approval path.
    workspace: { include: ['vendor/*', 'packages/*/*', 'apps/cli'] },
    entry: client ? '' : ['lib/types/{index,invariant,startup}.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    plugins: client ? [] : [typertPlugin({ mode: 'workspace', faces: ['host'] })],
  }
})
