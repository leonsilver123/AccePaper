# Agent Note: The A gate reviews the manuscript

Status: implemented

English | [中文](2026-09-16-the-a-gate-reviews-the-manuscript.zh.md)

## Problem

`verdictA` called `reviewClaim(runCtx.claimMaterial)`. The three offline rulebooks judged the claim's own fields — its assertion, its prediction, its declared scope — whatever the step had written.

An offline probe measured what that meant. It changed a number in the draft, deleted the Method section, and skipped the revision entirely. None of the three moved the A vote. The channel the whole architecture is built around — the adversarial reader that decides whether a step advances — was reading a different document from the one the run produced, for every step after the claim existed. Nine of the sixteen steps are gated on A.

The gate was not a constant, which is what an earlier round had fixed. It was derived from real material. The material was just the wrong one.

## Decision

The A channel reviews the manuscript when the run has produced one. `runner/manuscript-review.ts` holds four checks, each a declaration or an exact match:

- **`red-method`** — does the manuscript state the method it ran? A missing Method section or an empty one refutes; a Method section that names none of the executed implementation's names abstains, because nothing in it is false and nothing in it can be checked. Every section the outline declares must also have a body.
- **`red-stat`** — is every number in the prose one the run produced? The accountable set is assembled from the run: the measured record's six quantities in their rounded and raw forms, the implementation's declared parameters and the factors the two arms vary in, the commitment's threshold, and the counts a section legitimately states. A decimal outside it refutes, and the finding names the section and the value.
- **`red-citation`** — does every float and reference the prose cites exist? `Figure 4` against a roster that reaches `Figure 1` refutes, and so does `[9]` against a three-entry list.
- **`red-claim`** — does the conclusion claim more than the measurement supports? The direction the prose states is compared with the sign of the measurement, and a claimed percentage against the record and the declared bound.

`verdictA` picks the document: `revised-draft` when the run has one, then `draft`, else the claim material. The round's expected roles are declared per path rather than taken from the reviews, so a review that silently dropped a check cannot satisfy its own expectation. The verdict's evidence names which document it read and which role reached which position.

`VerdictBuildCtx` gained `readInput`, wired by the driver to the same resolution the executor uses — so a verdict and the step it judges cannot disagree about what the run contains.

## Alternatives considered

**Have the D3 and D4 executors write the review findings onto their artifacts, and have `verdictA` read them.** Rejected: it makes the step under judgment the author of the judgment. A step that omitted its own review would then be judged on the absence, which reads as a gap rather than as a contradiction.

**Move the A gate to the steps that only run after the manuscript exists.** Rejected: nine steps are gated on A and most of them run before it. The honest arrangement is that the A channel reviews whatever the run has produced, and says which that was.

**Keep the claim review and add the manuscript review beside it.** Rejected. The two would be four votes plus three, and the round's roles would differ per step for a reason a reader cannot see. One document per gate, chosen by what exists.

**Read meaning from the prose — is the conclusion actually overstated?** Rejected, and this is the limit the module states. Four audit rounds dismantled a prose reader in this repository, and the replacement they recommended was something narrower. `red-claim` compares a direction word and a percentage; it does not read an argument. A manuscript that hedges into meaninglessness, or that overstates in words the checks do not look for, passes.

**Strip every parenthetical before scanning for numbers.** Rejected in favour of the narrow rule: a parenthetical *containing a year* is a citation. A results sentence inside brackets is still a results sentence.

## Consequences

- `packages/research` is at **1737 passed / 97 files**; `tsc -b tsconfig.host.json` is clean.
- **`tests/manuscript-review.spec.ts` (18 tests) injects each fault the review named**: a decimal the run never measured (`12.5`), a manuscript with no Method section, an empty Method body, `Figure 4` against a two-float roster, `[9]` against a three-entry list, and a conclusion claiming a rise where the record measures −38.2 %. The number is injected twice — once through the pure review and once through a **driven run**, where a wrapped D3 executor produces a doctored draft and the test asserts the A verdict is `blocked`, that the evidence names the draft, and that the run stops before anything downstream consumes the number.
- **Two of these checks were wrong when first written, and the run is what showed it.** The number check refuted the fixture Method section for stating its own `2000 s` measurement window and for reading `(Treiber, Hennecke & Helbing 2000)` as a measurement; the method check refused `Intelligent Driver Model car-following, three-vehicle platoon` against a body that says `Intelligent Driver Model`. Both were the check being wrong about a correct manuscript. The rules they were replaced with — parameters are accountable numbers, a parenthetical year is a citation, a three-word run of the implementation's name counts — are all narrower than what they replaced, and each is pinned by a test.
- **The A gate now catches an empty section before E1 does.** `tests/section-evidence.spec.ts` used to drive an empty-retrieval run to `DSH_MANUSCRIPT_EMPTY_SECTION` at E1; it now stops at D3 with `red-method=refute`, because the adversarial reader sees the hole the moment the draft is written. `assembleManuscript`'s guard never fires in that scenario and is still behind it.
- **The binding was already there and is now load-bearing.** `bindVerdict` stamps each verdict with the attempt's artifact revisions and input digest, so the A verdict names the manuscript version it judged and `submitGateVerdict` refuses a stale target. Those were R0's work; this is the first time a verdict has had a document worth binding to.
- **The fixture manuscript is what the checks were tuned against, and it is a fixture.** A model-written draft will phrase things the checks do not anticipate, and the honest prediction is that the number check is the one that will need widening first.
