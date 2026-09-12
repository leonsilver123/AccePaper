#!/usr/bin/env bash
# #16 commit: T05 dir rename research-core -> dsh-research-core (separate commit).
REPO="D:/1/deepseek-harness-master1/deepseek-harness-master"
cd "$REPO" || exit 1

git add -A
git commit -m "T05 rename: research-core -> dsh-research-core (dir aligns with package name)" \
  -m "Lockfile importer key updated (line 6599). tsc --noEmit exit 0; vitest 7/7 pass." \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
echo "commit_exit=$?"

echo ""
echo "=== log ==="
git log --oneline -3
echo "=== tags ==="
git tag -l
echo "=== status (should be clean) ==="
git status --short | head -5
echo "status_lines=$(git status --short | wc -l)"
