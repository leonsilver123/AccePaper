# Agent Note: The failure that was read as a product

Status: implemented

English | [中文](2026-09-16-the-failure-that-was-read-as-a-product.zh.md)

## Problem

Two places turned a failure into a success. Both were found by the completion audit against `project-plan/architecture-review-2026-09-15/`, and both are the same species as the D4 parser defect: something went wrong, and the pipeline recorded that it went right.

**1. A timeout ended the attempt and left the work running.** `runStep` handed the executor the CALLER's `AbortSignal`. On timeout it settled the attempt as `timeout` and nothing else — so the executor could not learn that its time was up. It kept holding a model call, a subprocess or a simulation whose result would be discarded as late, and the attempt's own record said only that the step timed out.

**2. A failed turn returned its partial text.** `LlmProseWriter.write` read the turn's failure reason **inside** the zero-length branch:

```ts
const text = assistantTextFrom(events)
if (text.length === 0) {
  const failure = lastTurnErrorFrom(events)
  if (failure !== undefined) throw new Error(`... failed before the model produced text: ${failure}`)
  throw new Error('... the model produced no text')
}
return { text, ... }
```

Any text at all was enough to return a product. A session whose first turn wrote a few sentences and whose second died — a provider error mid-stream, a cancelled request, a tool call that never came back — resolved with those sentences, and the step certified prose no turn ever finished writing. The only record of why was a `turn/end` reason nothing read.

## Decision

**The executor's cancellation is its own.** `runStep` creates an `AbortController` per attempt; both the caller's abort and the timeout abort it, and the executor is given that signal. The timeout states the budget as the abort reason, so an executor can report "exceeded its N ms budget" rather than a bare cancellation.

**A failed turn is a failed write.** The failure check runs first, and its message carries both the reason and how much unfinished text it refused. And the failure is read from the **final** turn end: `lastTurnErrorFrom` now resets its answer at every `turn/end`, so an earlier turn that failed while a later one succeeded is a session that recovered rather than one that failed. The old implementation returned the most recent failure anywhere in the log, which would have failed a session that recovered.

## Alternatives considered

**Wait for the executor to unwind after a timeout.** Rejected for now: it needs a bound of its own (otherwise a step that ignores its signal re-introduces the hang the timeout exists to prevent), and the pipeline has no second bound to give it. The limitation is stated in the README instead — a timeout cancels, it does not wait.

**Only abort on timeout, keep handing the executor the caller's signal.** Rejected: the executor has exactly one signal to poll, and it needs to answer "should I still be running?" — which is true when either the caller went away or the budget ran out.

**Keep the failure check where it was and add a second check above it.** Rejected: two checks with one meaning is how they drift. There is one reason a write must not return text, and it is now in one place.

**Treat any failed turn in the log as a failed write.** Rejected: a session can recover across turns, and failing it would report a completed answer as a failure — the mirror image of the defect being fixed.

## Consequences

- `tests/pipeline.spec.ts` pins that the executor is handed a signal, that the timeout aborts it, and that the reason names the budget.
- `tests/llm-prose-writer.spec.ts` pins the two-turn shape: the first turn writes text and asks for a tool, the second dies, and the write is refused with the partial length named.
- Both refusals keep their existing behaviour for the cases that already worked: a late result is still discarded rather than written, and a turn that ends normally with no text still reports "no text" rather than a failure.
- **The audit that found these is `project-plan/architecture-review-2026-09-15/REMEDIATION-STATUS-2026-09-16.md`**, which also records what else the plan asked for and did not get.
