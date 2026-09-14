import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  // Name what THIS package emits rather than a wildcard. The Client pass runs after
  // the Host pass and uses this same config, so `lib/*.js` would delete the Typert
  // artifacts the Host pass generated (`typert.host.js`, `typert.remote-client.js`) —
  // which the Client pass does not regenerate. See the typert Agent Note.
  clean: ['lib/index.js', 'lib/index.js.map', 'lib/client.js', 'lib/client.js.map'],
})
