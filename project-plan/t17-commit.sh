#!/usr/bin/env bash
# #17 commit: T06 contract redesign (INV-HUMAN-1 + INV-ROLLBACK-1/2).
REPO="D:/1/deepseek-harness-master1/deepseek-harness-master"
cd "$REPO" || exit 1

git add -A
git commit -m "T06 contract redesign: INV-HUMAN-1 + INV-ROLLBACK-1/2" \
  -m "types.ts: ApprovalRecord/AttemptRecord/CurrentAttemptSnapshot; StepState gains attempt_id/approval/history." \
  -m "state-machine.ts: submitGateVerdict humanGate->gated (no auto-pass), approveHumanGate (actor!=agent, attempt_id match), transition anti-bypass, rollback event-append (no physical clear, clearArtifacts deprecated), projection isolation, getAuditHistory." \
  -m "tests: 7 regression + 16 invariant matrix (23 total). tsc --noEmit exit 0; vitest 23/23." \
  -m "Note: gateResults kept Partial (compile-necessary, incremental build); approval: ApprovalRecord | undefined (exactOptionalPropertyTypes). Both contracts clear -> P1.6 unblocked." \
  -m "Co-Authored-By: Claude <noreply@anthropic.com>"
echo "commit_exit=$?"

echo ""
echo "=== log ==="
git log --oneline -4
echo "=== status ==="
echo "status_lines=$(git status --short | wc -l)"
