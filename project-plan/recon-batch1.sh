#!/usr/bin/env bash
# Reconstruct batch1 change inventory + patch from trusted pristine upstream.
# ORIG = pristine upstream zip extraction (pre-batch1, no research-core).
# REPO = post-batch1 working repo (baseline commit c6731f7 + tag post-batch1-observed).
REPO="D:/1/deepseek-harness-master1/deepseek-harness-master"
ORIG="D:/1/deepseek-harness-master/deepseek-harness-master"
EXCLUDES=(--exclude=node_modules --exclude=lib --exclude=.dsh-build --exclude=dist-exe --exclude=coverage --exclude=.artifacts --exclude=.cache --exclude=.storages --exclude=.sessions --exclude=.session --exclude=.pnpm-store --exclude=.git --exclude=tmp --exclude=.worktrees --exclude='*.tsbuildinfo' --exclude=pnpm-debug.log)

echo "=== BRIEF inventory (diff -rq) ==="
diff -rq "${EXCLUDES[@]}" "$ORIG" "$REPO" > "D:/1/plan/batch1-inventory.txt" 2>&1
echo "brief_exit=$? (1=diffs found-OK / 0=identical / 2=error)"
echo "inventory lines: $(wc -l < "D:/1/plan/batch1-inventory.txt")"
echo "--- inventory ---"
cat "D:/1/plan/batch1-inventory.txt"

echo ""
echo "=== FULL patch (diff -ru, timeout 90s) ==="
if command -v timeout >/dev/null 2>&1; then
  timeout 90 diff -ru "${EXCLUDES[@]}" "$ORIG" "$REPO" > "D:/1/plan/batch1.patch" 2>&1
  echo "full_exit=$? (0=identical / 1=diffs-OK / 124=timed-out / 2=error)"
else
  diff -ru "${EXCLUDES[@]}" "$ORIG" "$REPO" > "D:/1/plan/batch1.patch" 2>&1
  echo "full_exit=$? (no-timeout-cmd; 0/1/2)"
fi
echo "patch lines: $(wc -l < "D:/1/plan/batch1.patch")"
