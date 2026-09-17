# Agent Note: A change request is a decision, and it leaves the gate open

Status: implemented

English | [中文](2026-09-17-a-change-request-leaves-the-gate-open.zh.md)

## Problem

The human gate offered two decisions and people have three intents. Approving passed work the reader may not accept; rejecting reported the step `blocked`, which stops the study. "Change this and show me again" — the thing a reviewer most often means — had nowhere to go, so a reader either passed work they did not accept or stopped a study they wanted continued, and either way the thing they actually wanted said nothing.

An instruction typed into a chat instead is not the same fact: it is not recorded against the run, it is not bound to the revision that was read, and the next reader — the one who has to act on it — never sees it.

## Decision

**`request_changes` is a third decision on the same channel, and the step stays `gated`.**

- Core's `_applyHumanApproval` gains the third outcome. Its effect is to record the decision and the instruction and to change NOTHING about the step: the gate stays open, because the person asked for different work rather than reporting that this one failed. A rejection still blocks, and the existing tests pin that difference.
- **A request must name what to change.** Validated at both boundaries — the channel's reader refuses a submission whose request is missing or blank, and core refuses one too, because a rule enforced only at the front door is a rule the next caller does not have. The refusal leaves the gate exactly where it was, so the person can make the request they meant to make.
- **The instruction is a fact about the run.** It is carried in the run's own approval record and its `human-approval` event, frozen against the artifact refs that were in front of the person, and it is what the snapshot now carries per step. A reloaded page — or one opened tomorrow — states who decided, when, and what was asked for, without having been there.
- **The receipt is read, not inferred.** The client used to derive the decision from the step's status (`passed` meant approved, anything else rejected). A change request breaks that reading: its status stays `gated`, so a derived decision reports a rejection the operator did not make and hides the instruction they wrote. The decision now comes from the backend's own field, and a host that does not send one is reported as a different build rather than guessed at.
- **The page does not offer an action that would be refused.** The button that asks for changes stays disabled until the field has text, so nobody learns the backend's refusal rule by hitting it.
- **The event id is still single-use.** A request consumes its own; approving the work that answers it takes a new one, and the approval does not carry the old instruction forward — it is a decision about a different revision.

## Alternatives considered

**Treat a change request as a rejection with a reason.** It needs no new decision value and no core change — and it reports the study as stopped, which is the outcome the person did not ask for. The gate would have to be re-opened by a recovery path, and the recovery would be indistinguishable from one that follows a genuine failure.

**Record the instruction in the client and show it until the page closes.** The instruction is the whole content of the decision; keeping it in one tab's memory means the next reader sees a gate with no explanation of why it is still open, and the record of what was asked dies with the tab.

**Let the page send the request and treat a blank one as "just tell me later".** An open gate with an empty instruction is a to-do nobody can act on, and the person who wrote nothing would be told their request was recorded.

**Keep deriving the decision from the status.** Cheaper than a required wire field — and it cannot express this decision at all: `gated` is the status of a step that has been requested to change AND of one nobody has looked at. The two are different states of the same field, so the field is not where the answer lives.

## Consequences

- The loop the gate exists for closes at its entry point: a reader can ask for specific changes, the gate stays open with the instruction recorded, and the next round has something to answer.
- Three decision values now travel the whole path — core, the channel's validated reader, the run's snapshot, the wire twin and the panel — and the panel states all three rather than two plus a guess.
- **What this does not do**: there is no candidate revision workflow. Asking for changes records a request and leaves the gate open; generating a candidate, reviewing it against the baseline and ACCEPTING it as the official manuscript (design M09) is not implemented, so answering a request is still work done outside this system.
