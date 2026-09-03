// prod-import-smoke.mjs — plain-Node import/export smoke test against the BUILT production
// package (NOT vitest, which resolves the package name to SOURCE via tsconfig paths and so
// cannot observe the production tree-shaking). Verifies the production export surface (RC-E E2):
//   - the MAIN entry (@deepseek-ai/dsh-research-core) exposes the 13 non-trust API funcs and
//     leaks NO trust capability (adversarial test #5);
//   - the ./host subpath (@deepseek-ai/dsh-research-core/host) exports ONLY
//     createHostApprovalChannel at runtime — no TrustedHumanPrincipal class (prototype), no
//     .create(), no _resetApprovalChannelForTests, no mintPrincipal, no channel instance
//     (adversarial tests #5 / #7 / #10);
//   - the singleton: a second createHostApprovalChannel throws APPROVAL_CHANNEL_EXISTS (#4).
//
// Run:  node packages/research/dsh-research-cordis/tests/prod-import-smoke.mjs
// (the adapter's node_modules symlinks @deepseek-ai/dsh-research-core → the built lib; this
// script imports via the package name + package.json exports, exercising the real production
// resolution path an Agent importer would use.)

import * as Core from '@deepseek-ai/dsh-research-core'
import * as Host from '@deepseek-ai/dsh-research-core/host'

let failures = 0
function check(name, cond) {
  if (cond) console.log('ok  :', name)
  else { console.error('FAIL:', name); failures++ }
}

// ── #10 + MAIN: the main entry exposes the 13 non-trust API funcs and NO trust capability ──
const MAIN_FUNCS = [
  'createRun', 'setRunInput', 'getRunSnapshot', 'getArtifact', 'canStart', 'startStep',
  'startIfCan', 'recordArtifact', 'submitGateVerdict', 'completeStep', 'rollback',
  'isComplete', 'getAuditHistory',
]
for (const fn of MAIN_FUNCS) check(`MAIN exports ${fn} (function)`, typeof Core[fn] === 'function')
check('MAIN leaks NO createHostApprovalChannel', Core.createHostApprovalChannel === undefined)
check('MAIN leaks NO TrustedHumanPrincipal', Core.TrustedHumanPrincipal === undefined)
check('MAIN leaks NO _applyHumanApproval', Core._applyHumanApproval === undefined)
check('MAIN leaks NO _resetApprovalChannelForTests', Core._resetApprovalChannelForTests === undefined)
// The MAIN entry also exports the 3 error classes (callers catch them); nothing else.
const MAIN_ERROR_CLASSES = ['ResearchError', 'ResearchRunError', 'ResearchValueError']
for (const cls of MAIN_ERROR_CLASSES) check(`MAIN exports ${cls} (error class — callers catch)`, typeof Core[cls] === 'function')
check('MAIN runtime exports are only the 13 API funcs + 3 error classes (no trust leak)', Object.keys(Core).length === MAIN_FUNCS.length + MAIN_ERROR_CLASSES.length)

// ── #5 / #7 / #10 + HOST: the ./host subpath exports ONLY createHostApprovalChannel at runtime ──
check('HOST exports createHostApprovalChannel (function)', typeof Host.createHostApprovalChannel === 'function')
check('HOST does NOT export TrustedHumanPrincipal at runtime (type-only — no prototype to Object.create)', Host.TrustedHumanPrincipal === undefined)
check('HOST does NOT export TrustedHumanPrincipal.create (removed — RC-E E2)', Host.TrustedHumanPrincipal?.create === undefined)
check('HOST does NOT export _resetApprovalChannelForTests (tree-shaken — RC-E E2; prod cannot reset the singleton)', Host._resetApprovalChannelForTests === undefined)
check('HOST does NOT export HostApprovalChannel (type-only)', Host.HostApprovalChannel === undefined)
check('HOST does NOT export mintPrincipal (method on the channel INSTANCE, not a free export)', Host.mintPrincipal === undefined)
check('HOST does NOT export submit (method on the channel INSTANCE)', Host.submit === undefined)
check('HOST runtime exports are only createHostApprovalChannel', Object.keys(Host).length === 1)

// ── #4 + singleton: production creates exactly one channel; a second mint throws ──
const channel = Host.createHostApprovalChannel('smoke-secret')
check('createHostApprovalChannel returns a channel instance', typeof channel === 'object' && channel !== null)
check('channel instance has registerPrincipal method', typeof channel.registerPrincipal === 'function')
check('channel instance has mintPrincipal method (the sole principal factory)', typeof channel.mintPrincipal === 'function')
check('channel instance has submit method', typeof channel.submit === 'function')
let secondThrew = false
try {
  Host.createHostApprovalChannel('second-secret')
} catch (e) {
  secondThrew = /APPROVAL_CHANNEL_EXISTS/.test(String(e?.message ?? e))
}
check('a second createHostApprovalChannel throws APPROVAL_CHANNEL_EXISTS (singleton)', secondThrew)

if (failures > 0) {
  console.error(`\n${failures} PROD-IMPORT-SMOKE CHECK(S) FAILED`)
  process.exit(1)
}
console.log('\nprod-import-smoke: ALL PASS')
