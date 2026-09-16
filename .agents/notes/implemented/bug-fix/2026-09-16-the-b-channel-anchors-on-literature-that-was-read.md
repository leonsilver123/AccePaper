# Agent Note: The B channel anchors on literature that was read

Status: implemented

English | [中文](2026-09-16-the-b-channel-anchors-on-literature-that-was-read.zh.md)

## Problem

The B channel decides whether a claim is anchored in external evidence. Its chain was real: `verifyCitation` ran the identity checks, the red lines, the retraction rule; core's `adjudicate('B')` decided the gate from the conclusion. The SOURCE was not. Every anchoring verification came from `MockCitationResolverAdapter` over a single record keyed `doi:10.0000/synthetic.t19b-anchor`, with `sourceUrl: mock://anchor/t19b/${stepId}` and `contentHash: 'deadbeef00'`.

Nothing hid this — the module's own basis string said `mock_external` — and nothing acted on it either. `production` refused the anchor's `fixture` class and the step abstained, which is correct and is also why no production run could reach a real B pass, let alone a first real closed loop. The bundle's config carried the admission in a comment: "Real retrieval beside a labelled synthetic anchor is the current state, not a finished one."

The review's R1 asked for the smallest thing that closes it: a few actual source excerpts, the Claim support relation reviewed by hand, one real B pass and one unsupported B refusal — explicitly not a literature search platform.

## Decision

`runner/evidence-corpus.ts` holds the retrieved material: three real articles, each with its DOI and the catalogue's canonical title and authors, the source's own access level, where the text was read from, when, the literal passage a reviewer judged, a SHA-256 over that passage, and — for the two read as author preprints — a note saying so. `SUPPORT_ASSESSMENTS` holds one reviewed judgement per source: the claim SENTENCE it was made about and a hash of it, the verdict, the reviewer, the date, why, and what the source does not establish.

`runner/evidence-anchors.ts` builds the anchor from that. It runs the same core `verifyCitation` the synthetic path runs, with the reviewer's verdict as the claimed conclusion, and publishes `sourceClass: 'literature'` with the source's OWN `sourceAccess`. `verdictB` uses it when the corpus holds a judgement for the run's claim sentence and falls back to the T23 fixture otherwise; the gate, the profile, and `requireExternalAnchor` are unchanged, so the abstention, block and pass paths are still core's.

The three outcomes the review asked for are pinned in `tests/reviewed-evidence.spec.ts`:

- **A real B pass.** Under `production`, A1's B gate returns `passed` with `anchoring=true` over `10.1109/tits.2026.3727135`. A production run now drives all fifteen steps and stops at `E2-submit`.
- **An unsupported B refused.** Consulted against the source assessed `does_not_support`, the gate returns `blocked` with `EXTERNAL_CONTRADICTION` — from real material, not a fixture row.
- **A source that could not be read is held.** The source available only as an abstract produces `pending` (`DSH_EVIDENCE_PENDING_SOURCE_ACCESS`): the policy admits it under no profile that can submit, so the step abstains. The README recorded `pending` as unreachable end to end, and it is reachable now.

Two supporting pieces follow from the same decision. `BChannelAnchors` split into `BChannelEvidence` (what the gate consumes: verifications, anchoring, provenance, basis) and `BChannelAnchors` (that plus the T23 signal), because the corpus path has no T23 signal and inventing one to hold a reviewer's verdict would present a judgement as a lookup. And `VERDICT_CHANNELS.B.kind` changed from `mock_external` to `live_external`, which is what a reader of a report sees.

## Alternatives considered

**Fetch the sources live, at run time, from OpenAlex.** Rejected for this change on the review's own instruction ("no literature search platform first"), and rejected on the merits for the B channel specifically: an anchor that depends on a network call at gate time makes a gate's outcome depend on whether a third party answered. The material is retrieved once and recorded; the honest description of that is what the provenance says, and live-retrieval-plus-caching belongs to the writing channel, where the corpus is broader and nothing is adjudicated.

**Keep the synthetic anchor in the shipped path and add the corpus as a test fixture.** Rejected: the shipped path would still be unable to reach a real B pass, which is the whole finding. The corpus is consulted by default for the claim version it covers.

**Hand the gate every assessed source, including the ones that do not support the claim.** Rejected, and this is the decision most likely to be revisited. `adjudicateB` blocks on an external contradiction that outranks a supporting anchor, so handing it both would block every step and end the run. Whether one counter-source refutes a claim is a threshold question, and the threshold lives in the C channel's commitment — a B gate inventing one would be this system making up a rule to look rigorous. The counter-assessed sources are therefore named on the verdict (`... NOT handed to the gate: ...`) with the question left open, and the gap is recorded as a limitation rather than closed by a rule nobody agreed to.

**Require the corpus for every claim, and refuse a run whose claim has no reviewed evidence.** Rejected: it would make the demonstration profile unusable for any other study, and the fallback is already honest — the fixture path declares itself and production refuses it.

**Add a `confidence` field so a reviewer can record "I could not check this".** Rejected for now. The field would have exactly one honest use here — an `does_not_support` reading taken from an abstract whose conditions could not be checked — and the access level already carries that fact for the policy. What the field would add is a way to suppress a reading, and nothing yet justifies one. The `scope` field records the caveat as prose; that nothing acts on it is written down as a limitation.

## Consequences

- `packages/research` is at **1700 passed / 95 files**; `tsc -b tsconfig.host.json` is clean.
- Three specs changed because they pinned the old source, and each was rewritten to the new truth rather than loosened: `e2e/happy-path-t19b.spec.ts` now asserts the corpus anchor by DOI and the counter-assessed sources on the verdict; `runner-registry.spec.ts` no longer asserts that no channel is `live_external` (B is one) and instead asserts the two channels that are `local_computation` and what B's basis must name; `production-evidence-policy.spec.ts` became the FALLBACK path's spec by giving its run a claim sentence the corpus does not hold.
- `package-export.spec.ts` gained a second case because the first stopped being about a blocked run: with a real anchor a production run reaches the human gate, so "eligible and not ready" is now pinned twice — once for a run held at its first step and once for a run that produced a manuscript and is waiting for a person.
- **A production run now stops at `E2-submit`, not at `A1`.** The manifest reports `profileEligible: true` and `submissionReady: false` with the reason naming the unapproved gate. That is the first time this pipeline has carried a claim from retrieval to a manuscript on evidence that exists, and it is the input R2 needs.
- `packages/bundle/research-app/cordis.patch.yml` keeps `evidenceProfile: evaluation`, and the comment now says that is a choice rather than a consequence: moving the shipped bundle to `production` belongs to the release gate, not to this row.
- **The corpus is code.** A source can be retracted or superseded without the run noticing, and `retracted` is a value a reviewer sets rather than something a run checks. A periodic re-retrieval that compares hashes and refuses a changed excerpt belongs with the writing channel's literature work.
- **The excerpt hash is over the stored string.** It detects an edit to the quotation; it does not detect that the quotation was never in the source. That is what the retrieval record is for.
