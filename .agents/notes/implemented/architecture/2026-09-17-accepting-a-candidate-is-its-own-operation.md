# Agent Note: Accepting a candidate is its own operation, not a step commit

Status: implemented

English | [中文](2026-09-17-accepting-a-candidate-is-its-own-operation.zh.md)

## Problem

The revision loop ended at a reviewed candidate. Everything before that — the request, the candidate, the diff, the checks — described work nobody had adopted, and the run's official manuscript stayed the text E1-format wrote. A person who asked for a change, read the answer and approved it had no way to make it the manuscript, so the loop's last step happened outside the product, by hand, and the run never learned that its manuscript had changed.

The obvious mechanism does not fit. `commitStepOutputs` writes a step's declared outputs inside that step's **in-progress attempt**, and E1-format committed long before anyone read the paper. Writing the registry per slug beside the commit receipt would leave the registry and the receipt describing different values; rolling the step back to `in_progress` to make room would report the study as at a state it never reached.

## Decision

**Core gains `acceptManuscriptCandidate`: an operation with its own guards, its own audit record and a producer that names a person.**

- **Every refusal is a way of publishing something nobody read**: a run revision other than the one the caller stated; a manuscript whose current version is not the one the candidate was written against; a candidate with no review, a review of a DIFFERENT version, or a review that failed; a value with no canonical encoding. `reviewed: false` is its own refusal rather than `passed: false` — "nobody checked this" and "the checks failed" are different facts.
- **The checks live in one place.** `checkAcceptance` is called by the operation and by `canAcceptManuscriptCandidate`, the read a page makes before offering the control. A predicate that restated them could offer a button the operation then refuses, and the two would drift with nothing to notice it. `canAcceptManuscriptCandidate` cannot write: it runs the check and reports.
- **The write is small and total**: the registry's one entry per slug is replaced with a new version, the project revision moves, and the audit record NAMES THE VERSION IT REPLACED — an audit that says an acceptance happened and not what it changed is not an audit of anything.
- **`producerStepId` is `human-acceptance`.** A person deciding is not a step executing, and a reader of the registry can tell which produced an artifact.
- **The service assembles the value, not the caller.** The accepted manuscript is the E1 artifact with the candidate's sections over it, keeping every other field — a value rebuilt from the candidate alone would drop the counts, the float roster and the package files, and the run's own readers would find the fields they depend on missing. The caller names a request and a candidate; it cannot hand over a document.
- **It is recorded where a restart reads it.** The acceptance is written under the request (`acceptance.json`) and into the run through the same serialized writer every other write uses. A write that did not land is REPORTED beside the receipt, not turned into a refusal: the acceptance is in the store, and telling the operator it failed would misdescribe what happened.
- **The page offers the accept only after a review passed**, states what accepting does, and renders the result from the run's own record — so a page that reloaded says the same thing as the one that accepted.

## Alternatives considered

**Roll E1-format back and re-run it with the accepted text.** It reuses the commit path exactly, and it makes the run's record say E1 produced text a person wrote. Every consumer of the step's history — the gate verdicts, the audit, the next run's inputs — would read a fabrication.

**A per-slug write beside the commit receipt.** Cheapest, and it leaves two records of what the manuscript is. The registry would say one thing and the receipt another, and nothing would advance the revision to say when it changed.

**Let the caller hand over the accepted manuscript value.** It removes the assembly step and it makes the version check meaningless: a caller that supplies the value can supply one that matches whatever it likes. The caller names a candidate; the service reads the text and the versions itself.

**Accept automatically when a candidate passes its checks.** The checks answer "does this introduce anything the study does not have", not "is this the manuscript you want". Publishing without a person would make the review a formality and the acceptance unattributable.

## Consequences

- The loop closes: a person can ask for a change, read the answer, and make it the manuscript, with the run recording who did it, when, and which version it replaced.
- **The manuscript's version counter now has two writers** — a step commit and an acceptance — and the registry distinguishes them by producer. Anything that assumed `formatted-manuscript` was always E1's output has to read the producer.
- **What this does not do**: it does not re-run the gates over the accepted text. A1–E1's verdicts are about the artifacts they judged, and an accepted candidate has been through the loop's own checks (numbers, citations, structure) but not through the trinity gates. Whether a revised manuscript must re-enter the pipeline is a question for the module design's acceptance rules, and it is open.
