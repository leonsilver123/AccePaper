# Agent Note: A citation's support is about a sentence, not the claim it came from

Status: implemented

English | [中文](2026-09-18-a-citation-supports-a-sentence-not-a-claim.zh.md)

## Problem

The pipeline review of 2026-09-18 reproduced this: **the claim-level support verdict was attached to whichever sentence cited the source.** `evidence-corpus.ts` holds what a reviewer read and concluded, and the conclusion is about the CLAIM — the assessment names the claim sentence verbatim, records whether the source supports it, and states what it does not establish. `judgementsFor(claimRef)` turned those into `SourceJudgement`s and `bindJudgements` attached them to sentences, so a sentence nobody had read carried a `supported` that was decided about a different sentence. A sentence stating more than the claim did — or the same thing about a different system — inherited it.

## Decision

- **A seam, like the other deployment capabilities.** `runner/statement-support.ts` states `StatementAssessment` (the sentence's identity and content version, the source, the verdict about that sentence, what the verdict rests on, who made it, when) and `StatementSupportAssessor` (`id` + `assess({statement, judgement})`). Whether a machine can read a passage and judge it against a particular sentence is a property of the deployment, exactly as whether it has a plotting library or a document toolchain is.
- **D3 assesses, and refuses what it finds.** With an assessor configured, every citing sentence is assessed against its own text, the readings are recorded on the draft, and `checkStatementSupport` refuses `statement-unassessed` (no reading covers the sentence, or the reading is about a version that has since been rewritten), `statement-contradicted`, `statement-unrelated` and `statement-beyond-scope`. A run that fails this publishes nothing: no draft, so no manuscript.
- **E1 re-checks the REVISED manuscript.** The readings were made against the draft; the manuscript assembled at E1 is what a revision produced. A D4 rewrite that nobody re-read is refused where the manuscript is published, which is the same place and the same reason as the citation-version check beside it.
- **No assessor means no reading — and that is recorded, not inferred.** The draft omits `statementAssessments` entirely. An empty array would mean the readings were made and found nothing, and a consumer that read `[]` as "nothing to object to" would be making exactly the inference this unit removes. E1 checks nothing for such a run: its absence is a fact about the deployment, and refusing every citation of every run under it would report that fact as a defect of the manuscript. This was measured — the first wiring refused 109 and then 78 tests, and both times the cause was an empty list standing in for a missing capability.
- **`bindJudgements` takes the readings as an argument.** When a sentence has one, the binding carries the SENTENCE's verdict and read scope; otherwise it carries the claim's, which is what an unassessed run's artifacts already said. The passage, its version and the source identity are the source's either way — what changes is whether anybody read it against this sentence.

## Alternatives considered

- **Make the claim-level verdict an abstention everywhere.** Refused: the B channel's anchor legitimately uses the claim-level assessment, and an abstention there would break the channel that is supposed to pass. The inheritance was the defect, not the existence of claim-level judgements.
- **A rule-based assessor inside this package.** Refused: deciding whether a passage establishes a sentence is reading, and a lexical rule that guessed would be the same class of false confidence as inheriting the verdict. The deployment supplies whoever can read; this package states what must be recorded.
- **Assess in E1 instead of D3.** Refused: at E1 the manuscript is assembled and a refusal costs the whole run's prose. D3 is where the sentences exist and where a rewrite can still be asked for.

## Consequences

- **Three directions pinned at the module** (`tests/statement-support.spec.ts`): a sentence the passage contradicts, a real source the passage does not bear on, and an abstract-only reading of a detailed sentence that refuses as beyond scope rather than passing. Plus: an unassessed sentence is refused however sound the claim verdict is, a stale version is refused, asking is once per sentence-and-source, and a rewrite is asked again.
- **Three at the run** (same file): a deployment with an assessor records its readings on the draft with content versions; a contradicted sentence stops `D3-writing` with the reason and publishes nothing; a deployment without one records no field at all.
- **What this is not.** The shipped bundle names no assessor, so shipped runs still carry the claim's verdict on their bindings and their drafts say no sentence was read — an honest gap rather than a silent one. Wiring a real reviewer (the review's independent-verifier role) is the next unit.

## Files

- `packages/research/dsh-research-team/src/runner/statement-support.ts` (new), `src/runner/citation-bindings.ts` (`bindJudgements` takes assessments), `src/runner/registry.ts` (D3 assesses and refuses; E1 re-checks), `src/runner/types.ts` (`DriveOptions.statementAssessor`, `DriveStepOptions`), `src/runner/drive.ts` (carried into the run context).
- `packages/research/dsh-research-team/README.md` / `README.zh.md`.
- Specs: `tests/statement-support.spec.ts` (new).
