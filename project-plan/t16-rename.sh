#!/usr/bin/env bash
# #16 T05 rename: research-core -> dsh-research-core (dir -> package-name alignment).
# Lockfile importer key already edited via Edit tool (line 6599). This script does the dir mv + verify.
REPO="D:/1/deepseek-harness-master1/deepseek-harness-master"
cd "$REPO" || { echo "cd failed"; exit 1; }

echo "=== 1. git mv (rename dir) ==="
git mv packages/research/research-core packages/research/dsh-research-core
echo "mv_exit=$?"

echo ""
echo "=== 2. lockfile importer key (should be dsh-research-core) ==="
grep -n "packages/research/.*research-core:" pnpm-lock.yaml | head -5

echo ""
echo "=== 3. git status (rename preview, head 20) ==="
git status --short | head -20

echo ""
echo "=== 4. tsc --noEmit (direct node binary, new path) ==="
node "$REPO/node_modules/typescript/bin/tsc" --noEmit -p packages/research/dsh-research-core/tsconfig.json
echo "tsc_exit=$?"

echo ""
echo "=== 5. vitest (direct node binary, repo root) ==="
node "$REPO/node_modules/vitest/vitest.mjs" run "packages/research/dsh-research-core" 2>&1 | tail -40
echo "vitest_pipe_exit=${PIPESTATUS[0]}"
