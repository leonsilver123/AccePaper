# Agent Note: The plan the pipeline could not execute, discovered four steps in

Status: implemented

English | [中文](2026-09-16-the-plan-the-pipeline-could-not-execute.zh.md)

## Problem

R1a made `B1-method` take the algorithm from the implementation the plan declares, and refuse when it declares none:

```ts
const resolved = resolveImplementation(planOf(ctx))
if (!resolved.ok || resolved.implementation === undefined) {
  throw new Error(`[B1-method] ${resolved.reason}`)
}
```

`requirePlan` then required an implementation only when one was *present*:

```ts
const declared = source['implementationId']
if (declared === undefined) return { ok: true }
```

Those two together are a hole, and the browser path went through it every time. A model proposes a study, a person confirms it, the plan arrives off the wire — and the wire plan carries no `implementationId`, because a proposal knows what it is about, not which code this deployment can run. `requirePlan` accepted it. The run started, A1 retrieved a live catalogue, A2 derived the claim, A3 and A4 closed their gates, and then `B1-method` threw. `runStep` leaves a failed execute phase `in_progress`, so the run simply stopped there with no error a reader could see.

The end-to-end probe found it twice, at the same step, with the same shape: `{"a2":"passed","steps":5}`. The first time it looked like model latency, and the second run reproducing the same stop within 13 ms of A4 finishing is what ruled that out. Nothing in the offline suite caught it, because every test in the suite drives `DEFAULT_PLAN`, which states an implementation.

## Decision

The implementation is resolved at the plan boundary, from the quantity the plan declares it measures, and the resolved id is written onto the plan.

`resolvePlanImplementation` replaces `requireImplementation`. A plan that names an id has it checked against the plan's metric — two statements about one method that disagree is how a manuscript comes to describe an experiment nobody ran. A plan that names none takes the single supported implementation whose `metric.key` equals the plan's; a quantity no implementation measures is refused, as is an ambiguous one. `requirePlan` returns a plan that always carries `implementationId`, so nothing downstream resolves it again or discovers the absence.

`runT19B` calls `requirePlan` on the plan it was handed, before the first step. The driver accepted a plan it could not execute and left the discovery to a step; now a caller learns before the run starts. This is also what makes the resolution reachable from the driver at all — the wire path already went through `requirePlan`, and a plan handed directly to `runT19B` did not.

## Alternatives considered

**Make `implementationId` required on the wire and have the client send one.** Rejected: the client has no basis for choosing. A proposal states a field, a direction and a claim; which code can measure that claim is a property of the deployment, and a client that guessed would be stating a fact about a process it cannot see. This is the same split `explicitDefaulting` names: resolution belongs in the owning implementation, not in a hidden default and not in a caller.

**Have `B1-method` fall back to the implementation that measures the plan's metric.** Rejected as the only change, though it is where the resolution logic lives. It would fix the symptom at the step that noticed, leaving the pipeline free to run four gates and a live retrieval before finding out it had no experiment. The refusal belongs where the value enters.

**Refuse a plan that names no implementation.** Rejected, and this was the tempting one, because it is what the type says. It would have been correct about the contract and fatal to the product: the only plan that names one is the default, so the browser could never start a run at all — the interface's whole purpose. The contract was wrong, not the caller: a plan states what it studies, and the deployment states what it runs.

**Infer the implementation from the plan's claim text.** Rejected: the metric key is the plan's own declaration of what it measures, and matching prose would be the string comparison over written language this repository keeps refusing to grade on.

## Consequences

- `tests/method-implementation.spec.ts` gained four tests, including the run: a plan with no `implementationId` drives through B1 and the `method-spec` it produces names the resolved implementation. `tests/project-recovery.spec.ts` records the new fact — the plan a resume reads back carries its implementation id, so a deployment whose supported implementations changed under a running run cannot quietly resume it as a different one.
- **The refusal moved to the boundary and improved there**: a plan measuring a quantity no implementation can measure is now refused with that quantity and the available implementations named, instead of a thrown string from step five.
- **`requirePlan` is now called twice on the wire path** — once by the host before `runPipeline`, once by `runT19B`. That is idempotent by construction (a resolved plan resolves to itself) and the cost is one pass over a small record. It is also what makes the driver's boundary the same as the wire's rather than a second, weaker one.
- `MeasuredMetric` gained `unit`. The section writer needed it to state a number with its unit, and a unit recovered from the display label is a substring match on prose.
- **Nothing in the offline suite could have caught this**, and that is the finding worth keeping: 1719 tests, 96 files, two TypeScript faces, and the product's own path was broken at step five. The end-to-end browser probe caught it, twice, and only because its failure message named the step count.
