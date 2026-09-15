# Agent Note: A claim id the tool would refuse, and a gate that read silence as a pass

Status: implemented

English | [中文](2026-09-16-a-claim-id-the-tool-would-refuse.zh.md)

## Problem

Two defects, found by two different methods on the same day. Both are the same shape: a rule existed in one place and the thing it governed was decided somewhere else.

**A derived claim id over the tool's limit ended a run.** The browser probe confirmed a model-proposed plan and started a run; the run failed at A2 with

```
[claim-construct] claim-construct.claimId: longer than maxLength 64
```

`claimIdFor` slugged a proposal's whole direction with no bound. `claim-construct` declares `maxLength: 64`. The shipped default's direction produces 57 characters, so the bound was never exercised until a model proposed a longer one — and a model's proposal is not deterministic, so the same probe passed the previous night and failed this one. The plan had passed `requirePlan`, which validated the claim's id as *present* and nothing more, so a plan the pipeline could not execute was accepted at the boundary that exists to accept only executable plans.

**A gate aggregated a required check's silence into a pass.** `aggregateDisposition` blocked when a required check was absent from the report, and when a check had `failed`. A check that was present and reported `not_evaluated` — the disposition that means "I did not run" — produced `allow`. The module's own documentation said the opposite in two places: `not_evaluated` "means a required check did not run, and is never a soft warning", and the aggregate's own doc said "a check that was never executed has found nothing, and its silence is not a pass". The two spellings of one fact were being treated as different facts, which is the review's H.1 requirement ("a required check that did not run must not be disguised as a low-risk warning") failing in the module written to enforce it.

The second was found by an independent reader of the module, not by its tests — because the tests had been written from the same reading as the implementation, and a spec that pins the implementation cannot find where the implementation disagrees with its contract.

## Decision

**One number, read by both sides.** `INPUT_LIMITS.maxClaimIdChars` is declared in `dsh-research-tools`, where the schema that enforces it lives, and read by the derivation that must satisfy it. `claimIdFor` bounds its id; a direction that would overflow is truncated to fit and carries an eight-character digest of the WHOLE direction, so two long directions sharing a prefix do not collide onto one claim id. `requirePlan` refuses a plan whose `claim.id` is over the same limit, naming the length and the limit — the plan problem is reported where the plan arrives instead of two steps later as an execution failure.

**`not_evaluated` on a required check blocks, exactly as absence does.** The fix is one filter; the substance is that `not_evaluated` and `not_applicable` are now treated as the different things they are. `not_applicable` may pass, because it is a finding about the work ("this check does not apply here") and it must state which rule exempts it. `not_evaluated` may not, because it is a report of silence in either spelling. A check the policy does not require may report anything.

**Two smaller corrections in the same pass.** `quality.ts`'s reference reader now applies `isContentHash` to a target's `contentHash`, the same rule `artifact.ts` applies to the same field: a "hash" that is any non-empty string cannot be checked against a store's content, so the report could not be verified against the revision it names. And `contentHashOf`'s refusal text now names the objects it actually refuses — it had listed only functions, symbols, `undefined`, non-finite numbers, bigints and cycles, while the encoder also refuses a `Map`, `Set`, `Date`, `RegExp`, typed array, `ArrayBuffer` or class instance, so a refused producer was told about a value it did not have.

**`optionalStringField` was removed.** It was exported from the core entry with no caller anywhere in the repository — every parser inlines the same optional-non-empty-string check. A reader with no consumer is a claim about a design rather than part of one.

## Alternatives considered

**Let the tool refuse the long id, and treat it as a normal step failure.** Rejected: that is what happened, and what it produced was a run that stopped two steps in with a schema error naming a tool field, from which nothing tells a reader that the PLAN was the problem. The boundary that accepts plans is where an unacceptable plan belongs.

**Truncate the slug alone.** Rejected: two directions that share a 55-character prefix would produce one claim id. Artifacts of two studies under one claim id is worse than a long id — nothing downstream could tell them apart, and the claim id is what the C channel's evidence is keyed to.

**Reject the proposal instead of bounding the id.** Rejected: the id is derived, not proposed. The model writes a direction; the id is this code's business, and refusing a good direction because our own derivation cannot fit it would refuse the model's work for our defect.

**Drop `not_evaluated` from `CheckDisposition` and express silence as absence.** Rejected: the review's H.1 requires the distinction — a check that ran and found `not_applicable` must be distinguishable from one that did not run, and only `not_evaluated` carries that. The defect was that the aggregate ignored it, not that it existed.

**Make `parseGateReportIngress` reject an `allow` report carrying a `not_evaluated` check, as it already does for `failed`.** Rejected for now: the parser does not know which checks the policy requires, so it would reject a report whose `not_evaluated` check is not required — and refusing a valid record is a worse failure than the one it would prevent. `aggregateDisposition` is where the required set is known.

## Consequences

- A model-proposed direction of any length now yields a usable claim id, and a plan carrying one the tool would reject is refused at `requirePlan` with the two numbers.
- `tests/direction-proposals.spec.ts` pins the bound, the prefix-collision case, stability, and the boundary refusal; `tests/domain/quality.spec.ts` pins that a required `not_evaluated` blocks, that a required `not_applicable` still passes, and that a query about a non-required check does not decide the gate.
- The browser probe's run reached A2 and stopped there on 2026-09-16; that failure is what surfaced this. The probe is re-run against the fix.
- `packages/research` is 1648 passing across 91 files.
