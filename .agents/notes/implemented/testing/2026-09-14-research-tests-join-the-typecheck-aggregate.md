# Agent Note: The research tests join the typecheck aggregate

Status: implemented

English | [中文](2026-09-14-research-tests-join-the-typecheck-aggregate.zh.md)

## Problem

`tsconfig.host.json` excluded `packages/research/*/tests/**` from every typecheck program. TypeScript therefore never read those 68 spec files, and nothing else did either: `pnpm run lint` resolves its rule set through the same program, so files outside it were analysed with default compiler options and produced false positives that nobody could act on.

The exclusion was load-bearing in the sense that it made `pnpm run typecheck` pass, and invisible in the sense that no gate said what it was hiding. Measured on the day this note was written, re-including the four host-face globs surfaced **159 type errors**, and they were not all mechanical:

- `dsh-research-core/tests/orchestration.spec.ts` imported types from `../../src/index.ts`, one directory above the package. The import is type-only, so it is erased before the test runs and the file had never failed at runtime.
- `dsh-research-tools/tests/e2e/helpers/imports.ts` was imported for a `StepExecutor` it never exported.
- `host-integration.spec.ts` called `isComplete(store, runId)` — the function takes a `stepId` and always has; the two-argument call could never have compiled.
- The same file declared `release: Promise<void>` for a member it then called as `release()`.
- `e2e/helpers/report.ts` declared two fields narrower than the values the code wrote into them (`'pending'` and `'missing'` against `GateOutcome` and `StepStatus`).

Each of these is a statement about code that was wrong in a way only a compiler notices.

## Decision

The four host-face globs leave `tsconfig.host.json`'s `exclude`. `packages/research/dsh-research-web/tests/**` stays: it is the client-face package, and including it in the host aggregate pulls browser sources into a program that must not see them.

The 159 errors were fixed in the test sources, under one rule: change the TYPE, never the assertion. Four packages were worked in parallel — one agent per package, with disjoint directories, the main agent holding the write and commit decision — and each agent reported separately on anything that could only be fixed in `src/`, on anything it judged to be a genuine defect in the test, and on every non-empty-assertion change it made.

No `as any`, `@ts-ignore`, or new `@ts-expect-error` was accepted. Two `as unknown as` conversions remain, both at points where the test deliberately hands the implementation an object that violates its own static type in order to prove the runtime check rejects it; the double assertion is the honest spelling of "intentionally out of contract" and the assertions around them are unchanged.

## Admission and ownership

`tsconfig.host.json` owns the aggregate. The standing rule is that a research test file is checked by the same program as every other host-face test file; a future exclusion needs a reason written down, not just a green run.

The parallel split is what made this tractable, and it is the same shape the runner's own P6 used: independent modules, one writer per shared entry point. The agents had no commit authority, so the gate could not be moved by an agent whose work had not been reviewed.

## Alternatives considered

**Keep the exclusion and document the gap.** Rejected: a recorded blind spot is still blind. The 159 errors were not noise — they included a type-only import pointing at a module that does not exist, a helper imported for an export it never had, and a call to `isComplete` with the wrong arity. Documenting those instead of fixing them would have made the README accurate about a defect and left the defect in place.

**A separate `tsconfig.research-tests.json` aggregate.** Used as the work surface while the errors were being fixed, and rejected as the permanent shape: a second program is a second thing to keep in step with the first, and `pnpm run lint` resolves its rules through the host aggregate, so the tests would still be analysed without a program. The temporary config was deleted with the fix.

**Fix only the errors that look substantive and leave the mechanical ones.** Rejected: without a program there is no way to tell which is which. The `as never` casts in the cordis specs looked like noise until they turned out to be suppressing a real signature mismatch, and the unhelpful-looking `possibly undefined` reports sat next to genuinely unreachable calls.

**Route the four globs through the client aggregate instead.** Rejected: these are host-face packages, and `dsh-research-web/tests/**` — the one client-face glob in the set — is precisely the one that must stay out of the host program.

## Consequences

`pnpm run typecheck` now reads the research tests, and the 159 errors are gone: `tsc -b tsconfig.host.json` exits 0 with the globs included.

**The lint gate is still red, and it was red before.** `pnpm run lint` reports 299 errors on the pre-change tree; with the tests inside the program it reports 155. Of those, the 62 in research `src/` are unchanged by this work — they are pre-existing, and 62 are in research sources rather than tests. The test-side count falls from 234 to 90 because the false positives disappear once the files have a program; the 90 that remain are real rule violations (unsafe assignments off the `any` that a non-literal dynamic import produces, unnecessary conditions, void-returning shorthands) and are left for a separate change. This note records the numbers so the next reader does not have to re-measure them, and so nobody mistakes the remaining count for something this change introduced.

The `agentTeams` name collision is now visible in the host aggregate: `packages/experimental/agent-team` and `dsh-research-team` both declare `Context.agentTeams` with different types, and TypeScript silently picks whichever declaration it sees. `host-integration.spec.ts` casts at the one assignment site, which holds in both programs. The collision itself is already documented in `CLAUDE.md`; this change makes it a compile-time fact rather than a latent one.
