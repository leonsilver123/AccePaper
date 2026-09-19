# Agent Note: What a citation roster owes, and two bounds around a model call

Status: implemented

English | [中文](2026-09-20-a-roster-a-permission-and-two-bounds.zh.md)

## Problem

Every real run of the research pipeline stops at `D3-writing`, and the refusals have changed three times as upstream defects were fixed. The surviving class is `statement-unrelated`, and the reason quoted by the deployment's own sentence assessor is: "The passage only concerns the reaction-time lag (a first-order lag) and the critical lag value above which safe CCC gains do not exist, saying nothing about a gap-to-closing-speed ratio." The sentence it refused was `stmt-introduction-1`, and what that sentence says is `The quantity at stake is the smallest gap-to-closing-speed ratio reached by any follower over the measurement window [@cite-10.1109/tits.2026.3727135]` — the study's own metric, carrying the citation of a source whose passage is about something else.

**Two rules in one instruction could not both be obeyed.** D3 required every source on the reviewed roster to be cited somewhere in the manuscript, and required a sentence that cites a source to state only what that source establishes. When a source bears on no sentence the paper needs, the only way to satisfy the first is to attach it to a sentence the second refuses, and the writer decorated the nearest sentence it had. The pipeline was set up to fail the writer, and the writer was set up to be refused.

**One refusal ended the run.** Refusal at this step is the normal case, because the evidence often does not establish what the writer wanted to say. A pipeline that stops on the first refusal cannot report the runs where the writer simply wrote the wrong sentence — and it cannot tell the difference between "this claim is not supported" and "this draft says too much", which are different findings.

**An instruction reaches a model unread.** A step composes an instruction out of parts and the rules each part states live in modules the step is judged by, but nothing checked that the composed text still CARRIES the parts. The two refusals that preceded this one on the deployment were both about material the writer had never been shown — a roster without the passage, a passage without what was read — and both were found by hand after a run stopped.

## Decision

- **The roster is a permission, and the obligation is stated over the sources that carry the claim's evidence.** `judgementsFor` marks a source `supported` when the reviewer found its passage establishes the claim; those are the sources the paper's own claim rests on, and they must be cited. The rest of the roster is prior work the paper MAY cite and owes nothing to. The instruction says exactly that, in the terms the sentence assessor reads.
- **`citation-source-uncited` is KEPT AND NARROWED, not replaced.** Its code, its fatal status and its message survive; what changed is which sources it names. Its documented intent is "a paper that states no position its own evidence establishes", and that is true of the sources whose passages establish the claim — the narrow set — and false of prior work the paper may discuss. The over-broad half, which is the half that could not be obeyed, is what was dropped.
- **The uncited sources that carry no obligation are still reported.** `uncitedSources` carries every reviewed source no sentence cites, on the draft and — newly — through D4, which was dropping the field. A judgement nobody used is either a manuscript that failed to state a position or a source that does not bear on the paper, and only a reader can say which.
- **A refusal is answered with bounded rewrite rounds.** `D3-writing` feeds the reading's own reasons back to the writer, verbatim, and writes again within the same evidence and under the same rules, for `proseRounds` rewrites (two by default; `0` is the behaviour before the loop). Only the sections whose sentences were refused are rewritten, and only those — the evidence on a rewrite is the same evidence. Each round is recorded on the draft: `told` (the refusals), `wrote`, `changed` (a hash before and after per section), `refusedAfter`, and `stoppedBecause`.
- **The last round is read by the check the first one was.** Not one gate, assessor, threshold or claim was touched. A run still refused after its last round stops with the reading's reason, verbatim, exactly as it did before the rounds existed — and the round's own record says the budget ran out rather than that the reading was satisfied.
- **An instruction is read before it is sent, by a reader and not an optimiser.** `InstructionChecker` reads the request — instruction AND context, because several steps carry their evidence as request data — against the parts the task requires, and `sendCheckedProse` is the only path a prose request takes, so a refusal stops the send. An answer that states no usable verdict, or refuses without naming a part, is a FAILURE rather than a clearance.
- **The check's answer is recorded beside the request.** `proseRoute.instructionCheck` and `proseRequests[].instructionCheck` carry the verdict, the part it names, the reader's version, the SHA-256 of the instruction it read, and the parts required of it — so a reader can tell a send that was checked from one that was never looked at, and the absence of the record means no check was made rather than that one cleared.
- **The check fails closed and the mechanism is what the specs prove.** A refusal stops the send and the writer is never called, which is what makes it a gate rather than an observation. Whether a model's reading is right is not something a spec can prove, and the note does not claim it.

## Alternatives considered

- **Drop `citation-source-uncited` entirely and let the reference list be whatever the body cites.** Rejected: that is `citation-entry-uncited`'s job, and it leaves a paper that argues a claim and cites none of the evidence establishing it with nothing refusing it. The refusal had a real defect behind it — a delivered paper with twenty-five retrieval hits in the bibliography and a body citing none — and the narrow set is the part of that defect which is a defect.
- **Keep it over the whole roster and let the writer refuse.** Rejected: "every reviewed source must be cited" is not a rule about papers. A run that reviews thirty sources and writes six sections would have to cite all thirty, which is a rule that guarantees exactly the decoration the assessor refused.
- **Let the writer drop a citation and record why.** Rejected: the record would be a model's sentence about its own choice, which is the kind of claim this pipeline exists to not accept — and the reading that already decides what a passage establishes is the assessor, not the writer.
- **Let the rounds run to a fixed point instead of a bound.** Rejected: a model asked the same question a fourth time is a model being asked the same question. The bound is configuration (`proseRounds`), and the loop also stops when a round changes nothing.
- **Have the check rewrite or complete the instruction.** Rejected outright: an instruction that changes between runs is an unauditable layer between the step and the text judged against it, and this layer's premise is that a claim nobody can re-read is a claim nobody can check. The check reads and refuses; it never edits.
- **Make the check warn instead of blocking.** Rejected: an observation wearing a gate's name. Measured on the deployment on 2026-09-20, an enabled check stopped a run at `D2-framework` with "the instruction is missing the constraints on what may be asserted, which this task requires" — which is a finding about D2's instruction, not about the check.

## Consequences

- A run whose writer over-reaches can now be answered rather than ended. The convergence is bounded, recorded, and judged by the same reading at every round; a run that does not converge still stops and still says why.
- A deployment that reads instructions before sending them reaches one fewer class of defect — an instruction that never carried the material the writer was judged against — and pays one model call per prose send for it. The shipped bundle names no checker, so the shipped runs send unchecked and record the absence.
- The narrowed refusal means a manuscript may now cite only part of what was reviewed. What it must cite is the evidence for its own claim, and the sources it does not cite are named on the draft rather than dropped.
- D4 now carries `uncitedSources` and `proseRounds` forward. Both were being dropped by the step that republishes the manuscript, which is the same class of defect the `statementAssessments` carry-forward was added for.
- The check has not been shown to judge correctly on a real deployment. One run blocked at D2 on a real reading, which is evidence that it can refuse; whether that refusal was right is a judgement about D2's instruction, and closing it — by giving D2 a constraints part — is deferred work rather than a change made here.

## Files

- `packages/research/dsh-research-team/src/runner/prompts/d3-writing.ts` — the roster stated as a permission with an obligation inside it, `sectionRevisionOf`, and `revisionInstruction`.
- `packages/research/dsh-research-team/src/runner/prompts/skeleton.ts` — the `revision` part, and the assembly order it joins in.
- `packages/research/dsh-research-team/src/runner/registry.ts` — the D3 write/read/rewrite loop, `proseRewriteRoundsOf`, `DEFAULT_PROSE_ROUNDS`, the narrowed `citation-source-uncited`, `proseRounds` on the draft, and `proseRouteOf(result, check)`.
- `packages/research/dsh-research-team/src/runner/instruction-check.ts` — `InstructionChecker`, `InstructionCheck`, `REQUIRED_INSTRUCTION_PARTS` and `sendCheckedProse`.
- `packages/research/dsh-research-cordis/src/llm-instruction-check.ts` — `LlmInstructionChecker`, the model-backed route a deployment names.
- `packages/research/dsh-research-cordis/src/index.ts` — `Config.instructionCheck`, `InstructionCheckChannel`, and the engine property the team reads.
- `packages/research/dsh-research-team/src/index.ts`, `src/runner/types.ts`, `src/runner/drive.ts` — `instructionCheck` and `proseRounds` on the drive options and the step context.
- `packages/research/dsh-research-team/tests/d3-convergence.spec.ts` — a run that converges, a run that spends its budget and stops, and `proseRounds: 0`.
- `packages/research/dsh-research-team/tests/instruction-check.spec.ts` — the answer recorded beside the request, and the block proven by the writer never being called.
- `packages/research/dsh-research-cordis/tests/llm-instruction-check.spec.ts` — the model-backed reader against a scripted provider.
- `packages/research/dsh-research-team/tests/citation-binding-run.spec.ts` — the narrowed refusal, and the run that cites its evidence and leaves prior work uncited.
