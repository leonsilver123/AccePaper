# Agent Note: Step budgets were calibrated for the offline channel, so a real model could not finish a run

Status: implemented

English | [中文](2026-09-15-step-budgets-were-calibrated-for-the-offline-channel.zh.md)

## Problem

The pipeline could be configured to reach a real model, and could not complete a run when it was.

Every step declares a timeout in the runner's registry as a constant — `REAL_TOOL_TIMEOUT_MS = 5_000` for a tool step, `FIXTURE_TIMEOUT_MS = 2_000` for a fixture step. Those numbers fit the channel the deployment shipped: the deterministic prose route computes its answer, so a prose step returns in milliseconds.

Measured with the shipped bundle switched to `prose: { kind: llm, provider: deepseek-official, model: deepseek-v4-pro }`: A1-landscape — the first step that writes prose — was recorded `status: "timeout"` with `durationMs: 5009`, and the run never left phase A. The snapshot showed one step, `in_progress`, and **no error message anywhere**: a step that overruns is not a step that failed, so there is nothing for a reader to read. Twelve of the sixteen steps then completed unchanged once the budget was raised, which is what makes the calibration — rather than the model route — the thing at fault.

The same measurement found a second ceiling of the same kind. D3-writing drafts every section in **one step**, issuing one model call per section together, and died on the writer's own idle ceiling: `[research-prose] D3-writing: agent loop idle timeout after 120000ms`, `durationMs: 120010`. That ceiling covers a single write; the step is seven of them at once.

Together these made `kind: deterministic` the only configuration that could finish a run — not a preference recorded in the bundle, but the only one the constants permit.

## Decision

**Both ceilings become deployment fields, because the right budget follows from the channels a deployment configured and not from the step.**

- `Config.stepTimeoutMs` on the research engine overrides the registry's per-step value for the whole run, and is refused at construction when it is not a positive finite number — a budget of zero reads at the far end as "the run stopped for no stated reason".
- `LlmProseWriterConfig.idleTimeoutMs` already existed as a field of the `prose` row and was already spread through; the deployment now states it.

The shipped bundle sets both (`stepTimeoutMs: 900000`, `idleTimeoutMs: 600000`), with the measurement that produced each value written beside it.

## Alternatives considered

**Raise the constants.** Rejected on the repository's own rule: the registry declares a timeout per step, and that declaration is a property of the tool being run — not of the deployment. Raising the offline numbers would also spend five minutes of a run's life on a step that answers in milliseconds.

**Derive the budget from the configured channel** (deterministic → 5 s, llm → 15 min). Rejected as implicit defaulting: the deployment already states which channel it reaches, and the repo's rule is that such a choice is an explicit `resolve(request): Spec` step in the owning implementation, not a hidden derivation that a reader has to reconstruct from two files.

**Make D3 issue its section calls sequentially so each fits the 120 s ceiling.** Rejected as the fix for this defect, though it may be worth doing on its own: it changes how long the step takes rather than whether the deployment can state its budget, and the ceiling it would dodge is the same one any slow step meets.

**Leave `DriveOptions.timeoutMs` documented as fault injection and add a second field.** Rejected: the field is the deployment's budget and a test-only reading of it is what let a deployment-varying tunable live as a constant. Its doc now says what it is.

## Consequences

**A run's wall-clock is now the deployment's to state.** The defaults are unchanged, so the offline route behaves exactly as before; a deployment that configures a model route must also state its budgets, and the bundle's own comments carry the two errors that a missing one produces.

**A budget set too low is still silent.** An overrun is recorded as `timeout` with the step left `in_progress`, and no error text reaches the artifact or the page. This note and the field's JSDoc say so, because the failure mode is a run that looks like it stopped for no reason; making it loud is a separate change to the driver.

**The prose citation path is now demonstrated.** With the model route, the E1 artifact's cross-reference report is no longer all-uncited: measured `{"cited":["Figure 1","Figure 2","Table 1","Equation 1","Equation 2","Equation 3"],"uncited":[]}`. The offline route could never produce that, which is why the note that introduced the report recorded it as unverifiable there.
