/**
 * Production entry for the `./host` subpath of @deepseek-ai/dsh-research-core.
 *
 * Re-exports ONLY the public trust-channel surface from host.ts:
 *  - `createHostApprovalChannel` (runtime — the singleton channel minter; the only approval
 *    path). The load-bearing defense against Agent self-approval of HOST runs is RC-C
 *    module-scoped store isolation — `submit` takes the run store as its first parameter, and
 *    the host's real store is a module-scoped Map in the Cordis adapter that an Agent cannot
 *    obtain — NOT host-startup-precedence. No host/bootstrap caller of
 *    `createHostApprovalChannel` exists today; startup-precedence is a FUTURE Host-wiring
 *    (Interaction phase) defense-in-depth, not a current hard boundary.
 *  - `HostApprovalChannel` / `TrustedHumanPrincipal` (TYPES only — the runtime class is NOT
 *    re-exported, so an importer cannot obtain the prototype for `Object.create`. The per-
 *    channel WeakSet is the sole identity guard regardless; withholding the prototype is
 *    defense-in-depth — RC-E E1/E2.)
 *
 * `_resetApprovalChannelForTests` is NOT re-exported here → it is tree-shaken out of
 * `lib/host.js` (a production importer cannot obtain it, so cannot reset the singleton —
 * RC-E E2). Tests import the host.ts SOURCE directly (relative `../src/host.ts`) where the
 * reset helper and the runtime class are available; the production `./host` subpath carries
 * neither.
 */
export { createHostApprovalChannel } from './host.ts'
export type { HostApprovalChannel, TrustedHumanPrincipal } from './host.ts'
