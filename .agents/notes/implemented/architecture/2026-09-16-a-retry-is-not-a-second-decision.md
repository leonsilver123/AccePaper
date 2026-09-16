# Agent Note: A retry is not a second decision

Status: implemented

English | [中文](2026-09-16-a-retry-is-not-a-second-decision.zh.md)

## Problem

The approval endpoint decides one human gate. Its guards are state-based, and they are good ones: a
step that is not `gated` is refused, an attempt that is not the current one is refused, and one
`approvalEventId` may be consumed once per run (`DSH_APPROVAL_REPLAY`).

What they do not do is survive a caller that never read the answer. The reader presses Approve, the
call times out, and — reasonably — presses it again. The backend refuses the second send with
`not-pending`, because the FIRST send decided the gate. The caller cannot tell that refusal apart
from "my decision never landed": both look like a gate that is still waiting.

The checkpoint plan names this: "网络超时导致重复批准或重复研究 | 幂等命令、结果查询、同一任务恢复".

## Decision

`ApprovalSubmission` gains `commandId` — the identity of the COMMAND, not of the decision — and
`submitApproval` answers a repeated id with the result the first send produced.

- the ledger is checked **before anything is decided**, so a retry cannot reach the channel and
  cannot be refused for the state the first send produced;
- only SUCCESSES are remembered. Caching a refusal would make a command that failed for a transient
  reason — a broken channel, a run this process does not hold — permanently refused under that id;
- a **different** id is a different intent, and meets the state the first command produced. The
  ledger answers retries; it is not a way around the gate;
- the id is REQUIRED on the wire. A command with no identity cannot be retried safely, and
  defaulting one would make every retry a fresh decision.

The client mints one per intent and REUSES it while the intent is unchanged: pressing Approve again
after a failure is the same command, and switching to Reject is a new one.

## Alternatives considered

**Let the client send the same `approvalEventId`.** Rejected: that id is the host's record of a
decision and the replay guard's key. A client that chooses it could collide with a decision it never
made, and the single-use rule exists precisely so a caller cannot name someone else's event.

**Return the decision's stored state on any second send, without a command id.** Rejected: a
retry and a genuine second attempt are indistinguishable without the caller saying which it is.
Deriving the answer from the step's state would also mean the endpoint never refuses a duplicate —
the guard that keeps a rollback-then-new-attempt honest relies on the attempt being named.

**Make the ledger durable.** Rejected for this layer: it would mean a table in a package that does
not own the run store's persistence, and the honest boundary is narrower than that. Across a restart
a retried command meets `not-pending` again — safe, because it cannot decide twice, but not
idempotent — and the README says so rather than implying a guarantee this layer does not provide.

**Ignore an unknown `commandId` and decide normally.** Rejected: that is the behaviour being fixed,
with extra fields.

## Consequences

- `tests/approval.spec.ts` pins that a repeated command returns the FIRST result and leaves ONE
  approval on the step, that a different id meets `not-pending` (the ledger is not a bypass), and
  that a refusal is not remembered — a command that failed against the wrong run still decides once
  it is sent against the right one.
- `tests/approval-panel.dom.spec.ts` pins the client half: a retry after a transport failure carries
  the same `commandId`, and switching the decision carries a new one.
- **What this does not do**: query a command's result by id from a different client, or after a
  reload. That is the "命令结果查询" half of U03, and it needs the durable command record.
