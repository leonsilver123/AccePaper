# Agent Note: A required check that did not run

Status: implemented

English | [中文](2026-09-16-a-required-check-that-did-not-run.zh.md)

## Problem

`domain/quality.ts` has carried the vocabulary for this since it was written:

- `aggregateDisposition(checks, requiredCheckIds)` — blocks when a required check is absent, when one
  reported `not_evaluated`, or when one failed;
- its docs say why: "A required check that is absent is not the same as one that passed … `not_evaluated`
  IS the same as absent, and saying so is the point of this function."

Nothing in production called it. The A channel decided its gate through `judgeRound` over the reviews,
and the reviews were produced by one implementation that always returned all of them. So the
distinction the vocabulary exists for — **a check that did not run** — had no representation anywhere
in the pipeline.

Worse, the two facts were the SAME VALUE. When the run held no result record, `red-stat` and
`red-claim` pushed a finding with `position: 'abstain'` — "the material does not settle this" — which
is what a check says when it READ the material and found it inconclusive. A check that verified
nothing because there was nothing to verify against said exactly the same thing. Nothing downstream
could refuse the second without also refusing the first.

## Decision

**`RoleReview.evaluated`** — optional, absent means it ran, `false` means it could not. It is set by
`review(role, findings, evaluated = true)` and used by the two checks that verify nothing without a
result record.

**`checkDispositionOf(review)`** — exported, so the mapping has one home and a test can assert the
production function rather than a copy of it:

```ts
if (review.evaluated === false) return 'not_evaluated'
return review.position === 'refute' ? 'failed' : 'passed'
```

**`verdictA` aggregates.** The reviews become gate checks, `aggregateDisposition` runs over the roles
the round declares, and a `block` from the aggregate is STRICTER than `judgeRound`: the step is
`blocked` where it would have passed. An `allow` leaves the round's verdict standing, so this can
only ever add a block — the injected-abstention path still abstains, because its reviews all ran.

## Alternatives considered

**Map `abstain` to `not_evaluated`.** Rejected, and this is the whole design: an abstention is a
finding. Mapping it would make the A channel block every claim whose evidence is merely incomplete —
exactly what `judgeRound`'s `minValidVotes` decides deliberately — and the two dispositions would
again be one value, in the other direction.

**Extend `ResearchRebuttalPosition` with a fourth member.** Rejected for scope: that type travels
into the recorded votes, the artifact, the wire and the UI, and the distinction being added is about
the CHECK, not about the vote a reviewer cast. A check that did not run still casts a vote — an
abstention — because that is what the adjudicator needs from it.

**Make `reviewManuscript` return fewer checks when an input is missing.** Rejected: the round
declares its required roles and a shorter list would make `expectedRoles` fail — a louder failure for
a fact that is now stated precisely. The check reports; the aggregate decides what its report means.

**Leave the aggregate out and rely on `judgeRound`.** Rejected: `judgeRound` abstains when a declared
role is missing, which is a different disposition and names no check. A gate that abstains leaves the
step open; the requirement is that it closes.

## Consequences

- `tests/manuscript-review.spec.ts` drives the whole chain: a review built without a result record
  marks `red-stat` and `red-claim` `evaluated: false`, `checkDispositionOf` turns those into
  `not_evaluated`, and the aggregate over `MANUSCRIPT_REVIEW_ROLES` blocks — while the two checks
  that DID read the manuscript still pass.
- The A verdict's evidence now carries the aggregate's decision and reason, so a blocked step says
  which check was missing rather than which vote it lacked.
- **What is still not wired**: `GateReport`, `reportAnswers` and `parseGateReportIngress`. A verdict
  binds by presence and attempt rather than by a minted report, and the README says so.
