# Agent Note: The gate certified work it had not read

Status: implemented

English | [中文](2026-09-16-the-gate-certified-work-it-had-not-read.zh.md)

## Problem

An independent review of the first delivery (`project-plan/architecture-review-2026-09-15/FOLLOWUP-2026-09-16.md`) reproduced four defects by running the code, not by reading it. All four are the same shape as the ones before them: a guarantee that the code asserted and did not hold.

**F01 — an old verdict approved a new attempt's products.** Attempt 1 of A1 commits its outputs and passes gate B. The step is rolled back; attempt 2 commits DIFFERENT values. Re-submitting the same verdict object returns `passed` for attempt 2. The output-binding check added earlier confirmed only that the current attempt had produced all its declared outputs — never that THIS verdict had judged them. `GateVerdict` had no field naming what it was about, and `reportAnswers` / `aggregateDisposition` / `parseGateReportIngress` had no caller in the research path.

**F02 — the "single commit point" had a public bypass.** After `runStep` committed A1's outputs, `recordArtifact` replaced `landscape-map` and the project revision stayed at 1. The runner no longer used that path, so the browser path was not affected; but "the only path that writes official outputs" was a description of how the driver behaved, not of what the code allowed.

**F03 — a checkpoint could be told the wrong run.** The hook was handed `runIdOf(store)`, the store's first key. With two runs in one store — a shape the recovery tests already produce — the second run's checkpoint received the first run's id.

**F04 — a blocked production run exported `submittable: true`.** `submittabilityOf('production')` computed whether the PROFILE's evidence may ever carry a submission, named the field `submittable`, and the export projected it into the manifest. A production run gated at A1 shipped a package saying it was submittable. Nothing about that run was ready.

## Decision

**F01 — a verdict carries what it judged, and the gate compares it.** `GateVerdict` gains `targetRefs` and `inputDigest`, and `bindVerdict(verdict, receipt)` is the only thing that sets them. The binding happens where the verdict is BUILT (`buildStepVerdicts`, from the attempt's commit receipt) and never at submit time: a verdict stamped on arrival would say it judged the outputs it landed beside, which is precisely the claim that made the old verdict work. `submitGateVerdict` compares the verdict's targets with the current receipt and refuses a mismatch (`DSH_GATE_STALE_TARGET`), refuses a different input digest (`DSH_GATE_STALE_INPUTS`), and refuses a verdict that names nothing at all (`DSH_GATE_UNBOUND_VERDICT`).

**F02 — the commit is the write of record.** `recordArtifact` now refuses once the attempt has committed (`DSH_ARTIFACT_AFTER_COMMIT`), and the gate requires the attempt's commit RECEIPT (`DSH_GATE_WITHOUT_COMMIT`) rather than inferring completeness from the registry. An attempt that pads its declared outputs one at a time cannot pass a gate, which is the property the earlier note claimed. The registry is also checked against the receipt (`DSH_GATE_COMMIT_MISMATCH`), so a value replaced beside the commit is caught even if it got there another way.

That migration is what the ~100 spec call sites were for: a test that wants a gate now commits, exactly as the driver does.

**F03 — the driver passes the run id it is driving.** `checkpoint(runId, …)` takes it from `runT19B` / `driveRemaining`, and `runIdOf` is gone.

**F04 — eligibility and readiness are two facts.** `submittabilityOf` becomes `evidenceEligibilityOf`, returning `{ eligible, reason }`: a property of the profile, and nothing about any run. Whether a RUN is ready is `submissionReadinessOf` (team), computed from the run's own state — the profile is eligible, the manuscript exists, and every step reached `passed`. The manifest and the run summary carry `profileEligible`, `submissionReady` and the reason, so a reader can tell a demo from a submission from a blocked run.

**Persisted verdicts keep their targets.** `parseGateResults` carries `targetRefs` and `inputDigest`, and `parseLooseArtifactRef` reads a reference that is not a registry key (a verdict's target names some other artifact's revision, so the key-matching reader does not apply). Without this, a run that had adjudicated a step before a restart came back unable to say what that adjudication was about.

## Alternatives considered

**Stamp the verdict with the current targets at submit time.** Rejected, and the review names it explicitly: it makes an old judgment indistinguishable from a new one, which is the defect. The binding must be an input to the verdict, not an output of the gate.

**Make `targetRefs` required on `GateVerdict`.** Rejected as the primary mechanism. The values come from a receipt the caller must have read, so requiring them in the type moves the failure to compilation for the callers that legitimately build verdicts from a fixture — and does nothing about a caller that constructs a verdict with today's refs and no judgment behind it. The refusal at the gate is what enforces the rule; the type stays a description.

**Delete `recordArtifact` outright and migrate every caller.** Rejected for now: `ctx.research.recordArtifact` is a published method of the cordis service, the recovery fixtures use it, and the E2 human-gate path legitimately writes an artifact for a step with an empty gate and no commit. Closing it AFTER a commit removes the architectural bypass — which is what F02 is about — without removing a seam that still has users. The note that claimed more than the code did has been corrected instead.

**Keep `submittabilityOf` and add a second field.** Rejected: the name is what caused the defect. A reader who sees `submittable: true` does not go looking for a second field that qualifies it.

**Have the export refuse to write a package for a blocked run.** Rejected: a package of a blocked run is useful — it is how a person sees where a run stopped. What must not happen is the package saying it is ready, and that is now two named facts rather than one ambiguous one.

## Consequences

- The four reproduced defects each have a refusal test at the layer that enforces them: `tests/commit.spec.ts` (F01 replay of the same verdict object after a rollback, F02 replacement after commit), `tests/project-recovery.spec.ts` (F03 two runs in one store), `tests/submission-readiness.spec.ts` and `tests/package-export.spec.ts` (F04).
- `packages/research` is **1665 passing across 92 files**, and both TypeScript faces build clean.
- The gate is now stricter in a way that changes what a caller must do: a verdict built without a receipt is refused. `helpers.ts` gained `commitAll` / `bindTo` / `submitBound` so that specs and fixtures commit and bind the way the driver does.
- `RUN_SNAPSHOT_SCHEMA_VERSION` is unchanged at 3: the persisted verdict gained optional fields that a record written without them still loads without.
- `readsSlugs`-era claim that the closure was verified stands; what changed is the gate's INPUT, not the dependency graph.
- **Still open, and named rather than implied:** the review's F-list is closed, but its six-unit plan is not. Real B evidence, method–result consistency, evidence-driven writing, reviewing the actual manuscript, and real revision are all still unbuilt, and none of them is a smaller problem than these four.
