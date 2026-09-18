# Agent Note: A citation's support is about a sentence, not the claim it came from

Status: implemented

English | [中文](2026-09-18-a-citation-supports-a-sentence-not-a-claim.zh.md)

## Problem

The pipeline review of 2026-09-18 reproduced this: **the claim-level support verdict was attached to whichever sentence cited the source.** `evidence-corpus.ts` holds what a reviewer read and concluded, and the conclusion is about the CLAIM — the assessment names the claim sentence verbatim, records whether the source supports it, and states what it does not establish. `judgementsFor(claimRef)` turned those into `SourceJudgement`s and `bindJudgements` attached them to sentences, so a sentence nobody had read carried a `supported` that was decided about a different sentence. A sentence stating more than the claim did — or the same thing about a different system — inherited it.

## Decision

- **A seam, like the other deployment capabilities.** `runner/statement-support.ts` states `StatementAssessment` (the sentence's identity and content version, the source, the verdict about that sentence, what the verdict rests on, who made it, when) and `StatementSupportAssessor` (`id` + `assess({statement, judgement})`). Whether a machine can read a passage and judge it against a particular sentence is a property of the deployment, exactly as whether it has a plotting library or a document toolchain is.
- **D3 assesses, and refuses what it finds.** With an assessor configured, every citing sentence is assessed against its own text, the readings are recorded on the draft, and `checkStatementSupport` refuses `statement-unassessed` (no reading covers the sentence, or the reading is about a version that has since been rewritten), `statement-contradicted`, `statement-unrelated` and `statement-beyond-scope`. A run that fails this publishes nothing: no draft, so no manuscript.
- **E1 re-checks the REVISED manuscript.** The readings were made against the draft; the manuscript assembled at E1 is what a revision produced. A D4 rewrite that nobody re-read is refused where the manuscript is published, which is the same place and the same reason as the citation-version check beside it.
- **No assessor means no reading — and that is a POLICY, not a field.** The first wiring let the artifact's `statementAssessments` field decide whether E1 checked at all, and the review of 2026-09-18 reproduced what that costs: D4 rebuilt the revised draft without the field, so a run under a deployment that HAD read every sentence arrived at E1 looking like one that could not — and passed. The decision is now the run's capability (`ctx.statementAssessor`), D4 carries the readings forward and re-reads the sentences a patch changed, and E1 refuses a manuscript whose readings do not cover it. The absence of readings for a deployment that cannot read is still recorded as absence, but nothing *infers* the policy from it. Measured twice over: the first wiring refused 109 and then 78 tests, and the injection that strips the field from the real D4 executor is now a regression case.
- **An assessment is bound to three versions, not one.** The sentence's, the passage's, and the assessor's (`quoteSha256`, `assessorVersion`). The review measured the gap: with the sentence unchanged and the source's excerpt replaced, the cache returned the old verdict. Any of the three moving makes the question new, so it is re-read — and `checkStatementSupport` refuses a verdict whose passage the source no longer holds.
- **`bindJudgements` takes the readings as an argument.** When a sentence has one, the binding carries the SENTENCE's verdict and read scope; otherwise it carries the claim's, which is what an unassessed run's artifacts already said. The passage, its version and the source identity are the source's either way — what changes is whether anybody read it against this sentence.

## Alternatives considered

- **Make the claim-level verdict an abstention everywhere.** Refused: the B channel's anchor legitimately uses the claim-level assessment, and an abstention there would break the channel that is supposed to pass. The inheritance was the defect, not the existence of claim-level judgements.
- **A rule-based assessor inside this package.** Refused: deciding whether a passage establishes a sentence is reading, and a lexical rule that guessed would be the same class of false confidence as inheriting the verdict. The deployment supplies whoever can read; this package states what must be recorded.
- **Assess in E1 instead of D3.** Refused: at E1 the manuscript is assembled and a refusal costs the whole run's prose. D3 is where the sentences exist and where a rewrite can still be asked for.

## Consequences

- **Three directions pinned at the module** (`tests/statement-support.spec.ts`): a sentence the passage contradicts, a real source the passage does not bear on, and an abstract-only reading of a detailed sentence that refuses as beyond scope rather than passing. Plus: an unassessed sentence is refused however sound the claim verdict is, a stale version is refused, asking is once per sentence-and-source, and a rewrite is asked again.
- **Four through the chain** (same file, all driving the real executors): a deployment with an assessor records its readings on the draft, D4 CARRIES them, and E1 passes; **stripping the field with the real D4 executor** leaves D3 `passed` and makes **E1 refuse** — the review's breakpoint as a regression case, which fails when the policy line is disabled; a contradicted sentence stops `D3-writing` with the reason and publishes nothing; a deployment without one records no field at all.
- **The cache's three bindings** (same file): a replaced excerpt is asked again with the sentence unchanged; a changed assessor policy is asked again and an unchanged one is not; a verdict on a passage the source no longer holds is refused.
- **What this is not.** The shipped bundle names no assessor, so shipped runs still carry the claim's verdict on their bindings and their drafts say no sentence was read — an honest gap rather than a silent one. Wiring a real reviewer (the review's independent-verifier role) is the next unit.

## Files

- `packages/research/dsh-research-team/src/runner/statement-support.ts` (new), `src/runner/citation-bindings.ts` (`bindJudgements` takes assessments), `src/runner/registry.ts` (D3 assesses and refuses; E1 re-checks), `src/runner/types.ts` (`DriveOptions.statementAssessor`, `DriveStepOptions`), `src/runner/drive.ts` (carried into the run context).
- `packages/research/dsh-research-team/README.md` / `README.zh.md`.
- Specs: `tests/statement-support.spec.ts` (new).
