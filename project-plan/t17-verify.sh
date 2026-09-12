#!/usr/bin/env bash
# #17 verify: tsc typecheck + vitest 23 tests (7 regression + 16 invariant matrix).
# Sub-agent edited types.ts/state-machine.ts/tests; did NOT run anything. This verifies.
REPO="D:/1/deepseek-harness-master1/deepseek-harness-master"
cd "$REPO" || exit 1

echo "=== 1. tsc --noEmit (typecheck new types) ==="
node "$REPO/node_modules/typescript/bin/tsc" --noEmit -p packages/research/dsh-research-core/tsconfig.json
echo "tsc_exit=$?"

echo ""
echo "=== 2. vitest (direct node binary, repo root, dsh-research-core filter) ==="
node "$REPO/node_modules/vitest/vitest.mjs" run "packages/research/dsh-research-core" 2>&1 | tail -50
echo "vitest_pipe_exit=${PIPESTATUS[0]}"

echo ""
echo "=== 3. git status (impl changes, not yet committed) ==="
git status --short | head -10
