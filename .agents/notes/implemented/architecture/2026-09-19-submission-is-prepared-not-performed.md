# Agent Note: Submission is prepared, not performed

Status: implemented

English | [中文](2026-09-19-submission-is-prepared-not-performed.zh.md)

## Problem

`E2-submit` declared `submission-record` as its output and nothing ever wrote one. Its executor was `noExecutor`, which threw `T19B registry: E2-submit has no executor — it stops at the human gate`, and the driver never reached it: `driveStep` short-circuited on the entry's `humanGateStop` flag, called `completeStep` directly and returned `outputSlugs: []` with `artifacts: []`. Every run therefore advertised a submission record and the registry held none — the same defect class this codebase names repeatedly, a declared output that reads as run output while nothing produced it.

The flag carried a second cost. A step that can `complete` without executing needs a branch in the driver that no other step takes, and that branch is where the pipeline stopped being one machine: E2 was exempt from `startStep → runStep → completeStep`, so the one step a person decides was also the one step whose declared product nobody had to produce.

## Decision

- **E2 has a real executor, and it prepares rather than performs.** `e2Executor` builds the record from the run's artifacts only — zero filesystem access, so a `manuscript.docx` a previous export left on disk, a package it wrote, or a file a hand edited cannot influence it; a record built from those would attest to bytes the run never held. It names the two versions the decision binds (`manuscript` and `typeset`, through `ctx.readInputRef`, which is what carries a version where `getInput` carries only a value), lists the documents the compile recorded with their format, path, byte length and SHA-256, names the formats the deployment's own compiler declared, names the venue the typeset form was rendered for, and states `submitted: false` with `decision: 'pending'`.
- **The record says what it is.** Its `note` reads `PREPARED, NOT SUBMITTED`: the documents and versions above are what a submission would carry, nothing has been sent to the venue, and nothing in this pipeline sends one, because a submission is an external act by a person. `submitted` and `decision` are two fields rather than one because the first states a fact about the world and the second states why the decision is not the pipeline's.
- **E2 still leaves `gated`, so nothing about the approval path changed.** The driver's short-circuit is gone and the step runs the same sequence as every other, which is what makes the record real. The finalize phase is now stated as the two ways a step reaches a terminal status and no third one: an empty gate is finalized by core's `completeStep`, which returns `gated` for a step whose gate is the human one, and a non-empty gate is adjudicated by the verdicts. E2 reaches `passed` only through the host's approval channel.
- **`humanGateStop` was deleted, not set false.** After this change nothing read it, and a field that is always false is a field that lies about being a choice. The entry keeps `kind: 'humanGate'` — the level names the STEP's gate rather than its executor, and a truthfulness level beside this artifact would report the preparation as evidence about the paper — and `tagArtifact` accepts `'humanGate'` so the registry table, the per-step table and the one artifact E2 produces agree (`producer: 'human-gate:E2-submit'`). A spec asserts E2 is the only entry carrying that level, so the allowance cannot become a step declining to name what ran. The entry's `timeoutMs` moved off `0` (which had meant "no executor runs") onto the offline budget, because an executor runs and is bounded like every other.
- **The approval binds both refs, and that is a strictly better binding than one artifact.** Core's `_applyHumanApproval` still freezes `targetRefs` from `step.inputs`, which now names `manuscript` and `typeset`. An approval that bound only the typeset form would let the document move underneath a decision about it; an approval that bound only the document would not say which file the journal would receive.
- **`final-package.ts` gained `manuscript-typeset` and `typeset-complete`, and nothing that was exportable became fatal.** `manuscript-typeset` passes only when the version the typeset form records it rendered is the version the run holds now (both read off the run's records), so a form of a superseded document is a render of the draft the paper was. `typeset-complete` passes when every format in `SUBMISSION_FORMATS` (`docx`, `latex`) that this deployment's compiler declared it produces is present with the byte length and digest the artifact recorded — the requirement follows the deployment's own declaration, so a machine with no LaTeX engine asks nobody for `.tex`. `finalPackageStateOf` is `'final'` only when every check passes and `'draft'` otherwise, so a run failing either check still exports, as a draft.
- **What is not here: anything that submits.** No venue is contacted, and no record of a submission exists because none was made.

## Alternatives considered

- **Set `humanGateStop: false` rather than deleting the field.** Rejected: after the executor exists nothing reads the flag, so keeping it as a permanently false field would advertise a choice that no longer exists, and the next reader would have to prove that the false was not load-bearing.
- **Build the record from the files on disk** — the exported package, or the compiled `manuscript.docx` under the run's directory. Rejected by the executor's own reason: none of those is evidence that THIS run produced the document. A record built from them would attest to bytes the run never held, and a hand-edited file would become part of the submission request.
- **Name the slugs without their versions.** Rejected: a record that named only the slugs could not say which version the decision was about, and it is the version that makes the record worth preparing — the approval freezes `targetRefs`, and a record that disagreed with what was frozen would be a second, weaker account of the same decision.

## Consequences

- `submission-record` is really written on every run that reaches the step; what the registry holds and what the run advertises are the same thing.
- E2 has two refusals rather than none: `[E2-submit] the run holds no document, so there is no submission request to prepare` and the same for the typeset form. `canStart` guarantees both in a driven run, and a direct caller is refused rather than handed a record saying a submission is ready when there is nothing to submit. Both inputs are read even though only the typeset form supplies the documents, because the commit receipt's input digest is taken from the slugs the executor asked for.
- `StepExecutorEntry` no longer carries `humanGateStop`; `StepOutcome`'s `kind` doc, the two report lines in `report.ts` and the truthfulness legend no longer say E2 runs no executor.
- The driver has one finalize path for both kinds of gate instead of a special case per step, so a future step whose gate is empty cannot acquire a status no other step can reach.
- The report's truthfulness table counts E2 under `humanGate`, and a machine still never completes the step.

## Files

- `packages/research/dsh-research-team/src/runner/registry.ts` — `noExecutor` replaced by `e2Executor`, `refRecordOf`, the removed `humanGateStop` field, `tagArtifact` accepting `'humanGate'`, and the entry's basis, `timeoutMs` and comments.
- `packages/research/dsh-research-team/src/runner/drive.ts` — the short-circuit removed, the finalize phase split on whether the gate is empty, and `readInputRef` on `ExecCtx`.
- `packages/research/dsh-research-team/src/runner/final-package.ts` — `manuscript-typeset` and `typeset-complete` with their facts, codes and detail sentences.
- `packages/research/dsh-research-core/src/engine/state-machine.ts` — `completeStep` returning `gated` for a humanGate step, and `_applyHumanApproval` freezing `targetRefs` from `step.inputs`.
- `packages/research/dsh-research-core/src/engine/steps.ts` — the declared inputs the approval freezes.
- `packages/research/dsh-research-team/src/runner/{types,report}.ts` — the comments and report lines that said E2 had no executor.
