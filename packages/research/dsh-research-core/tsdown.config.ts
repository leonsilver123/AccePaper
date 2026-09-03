import { defineConfig } from 'tsdown'

/**
 * Build dsh-research-core's two entries:
 *  - src/index.ts → lib/index.js  (the public main entry — NO trust capability; a humanGate
 *    step can reach 'gated' but never 'passed' via it)
 *  - src/host-prod.ts → lib/host.js  (the `./host` subpath — re-exports ONLY
 *    createHostApprovalChannel + the HostApprovalChannel/TrustedHumanPrincipal TYPES from
 *    host.ts; `_resetApprovalChannelForTests` is NOT re-exported so it is tree-shaken out of
 *    lib/host.js, and the runtime TrustedHumanPrincipal class is not exported at runtime
 *    (RC-E E1/E2 — an importer cannot obtain the prototype / create / mint / reset / channel).
 *    host.ts SOURCE is imported by tests directly (relative) where the reset + runtime class
 *    are available.)
 *
 * Type declarations are emitted by `tsc -p tsconfig.json` into lib/types (tsdown dts:false).
 * Core is a pure-TS package (no Cordis, no runtime deps) built standalone (not bundled into
 * the host); the adapter composes it via `@deepseek-ai/dsh-research-core`.
 */
export default defineConfig({
  entry: { index: 'src/index.ts', host: 'src/host-prod.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  // Scoped clean (NOT boolean `true`): `true` resolves to ['lib'] and wipes EVERYTHING under
  // lib/ — including tsc's lib/types/*.d.ts — which the canonical build order
  // (`tsc -b tsconfig.host.json && tsdown`) would leave missing (tsc emits lib/types, then
  // tsdown clean:true erases it). `lib/*.js` / `lib/*.js.map` match tsdown's OWN lib-root
  // outputs (index.js / host.js / state-machine-*.js chunks, incl. stale orphan chunks from
  // prior builds whose content hash changed) so changed hashes don't accumulate orphans — but
  // `*` does not cross '/' into lib/types/, so tsc's declarations survive. Only tsdown emits
  // into lib/ root (dts:false); tsc (emitDeclarationOnly:true) emits into lib/types/ only.
  clean: ['lib/*.js', 'lib/*.js.map'],
})
