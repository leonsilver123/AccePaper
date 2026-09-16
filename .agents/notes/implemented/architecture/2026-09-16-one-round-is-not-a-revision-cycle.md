# Agent Note: One round is not a revision cycle

Status: implemented

English | [中文](2026-09-16-one-round-is-not-a-revision-cycle.zh.md)

## Problem

`D4-rebuttal` ran once. Its `roundId` was the literal `t19s-rebuttal-1`, and when the applier refused
a patch — written against another version, replacing a body with the same text, or conflicting with
another patch to the same section — the concern stayed open and there was nothing to try again.

The applier itself was already careful: it binds each patch to the version it was written against and
refuses rather than silently discarding what happened in between. What was missing was the other half
of a cycle. **A refusal is information**, and nothing acted on it.

The checkpoint plan puts it plainly: "D4 只有应用器,没有可持续闭环 … 轮次和预算均有限,未解决转人工".

## Decision

`D4-rebuttal`'s model path is a bounded cycle:

- each round is told which SECTIONS the previous one left open, and gets the manuscript as it now
  stands, so its patches are written against the current bodies;
- the bound is `revisionRounds` — **deployment configuration**, read from the research engine's own
  config through the same path `stepTimeoutMs` takes, defaulting to 2 in the executor;
- the artifact carries `rounds`, `revisionRounds` and `stoppedBecause` (`closed` / `no-progress` /
  `budget`), so a reader can see whether the author was asked once or as many times as configured.

**No progress is measured by section, not by issue id.** A round numbers its issues from one, so
`d4-issue-1` names a different concern in every round; comparing ids would call two rounds that
failed on the same sections PROGRESS and spend the budget re-asking. The round record carries both —
`open` (the issue ids, to find them in `issues`) and `openSections` (what the next round is told).

The cycle stops early on `no-progress`: a second round that leaves exactly the same sections open has
been answered, and a third ask spends the budget to learn nothing.

## Alternatives considered

**Retry until everything closes.** Rejected: a model that will not close a concern will not close it
on the fourth ask either, and the bound is what makes the cost of one run predictable.

**Compare open issues by id.** Rejected as above — the ids are positional, so they measure nothing
across rounds. This was the first implementation, and a test caught it.

**Fail `D4-rebuttal` when concerns remain open.** Rejected: a round that closes most of what it
raised is a working round, and failing the step would discard the patches it did apply. What is wrong
is claiming the RUN is finished, which readiness decides.

**Turn an exhausted budget into a human gate.** Not built. The step is left with `stoppedBecause:
'budget'` and its open concerns, and readiness refuses the run with those concerns named. A gate a
person could clear would be a second mechanism for the same fact; the honest version of "a person
must decide" here is that the run is not ready and says why.

## Consequences

- `tests/d4-model-revision.spec.ts` drives the whole cycle on the model path: a first round whose
  Method patch replaces the body with the text D3 already wrote is refused, a second round is asked
  and closes it, `rounds` names both, `stoppedBecause` is `closed`, and the run becomes READY once a
  person approves it. A second test pins the stuck case: the same reply twice stops at `no-progress`
  with the concern still open and readiness still false.
- A third test pins that the bound belongs to the deployment: `revisionRounds: 1` produces one round
  and `stoppedBecause: 'budget'`.
- `docs/config-catalog.md` carries the new field, and the engine refuses a bound below 1 where the
  value enters rather than at the step it would abort.
