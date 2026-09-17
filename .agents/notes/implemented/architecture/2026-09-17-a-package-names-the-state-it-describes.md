# Agent Note: A package names the state it describes, and a re-export over a moved run says so

Status: implemented

English | [中文](2026-09-17-a-package-names-the-state-it-describes.zh.md)

## Problem

The manifest named the run's `projectRevision` and the moment of the export, and nothing about the artifacts the package was built from. A run that moved after an export — a later step, a revision, a re-run or a hand edit — left the package on disk describing a state the run no longer held, with no way for a reader to tell. The nine final-package conditions covered the approval and the run's save, and none of them covered "is this still the run".

## Decision

- **The manifest carries `artifactRefs`**, one entry per artifact the export read, with the version the run held at plan time. The slugs are listed rather than discovered: a package that recorded every artifact the run holds would report a move in something it never used.
- **`checkFinalPackage` gained `artifacts-current`**, and it is fed by a comparison the export can actually make: `previousArtifactRefsOf(directory)` reads the versions the package already on disk was read from, and `@Remote('exportRunPackage')` hands them to the plan. The check then names which artifacts the run has moved past, and the package is a DRAFT — whatever else holds.
- **A manifest that cannot be read is not a comparison that can be made.** The reader returns nothing for a missing or unparseable file, and the check then reports what this package was read from rather than a verdict it cannot support. Refusing to export because an older file is damaged would take away the remedy.

## Alternatives considered

- **Compare against the run's revision counter instead of per-artifact versions.** Refused: it says a state moved without saying what moved, and the remedy — re-export, or look at what changed — needs the artifact. A revision counter cannot tell a style change from a result change either.
- **Refuse to export when the previous package is stale.** Refused: the export is the remedy. A refusal would leave the reader with the stale package and no way to get a current one.
- **Move the dependency graph into the package layer.** Refused: which step's artifact invalidates which is core's declared-input graph, already enforced by the stale-attempt rules and tested there. This unit records a reading and compares it; it does not re-derive invalidation.

## Consequences

- **Two cases are pinned on the production path**: a package exported from a run records the versions it read and passes `artifacts-current`; a plan handed an older reading names the moved artifact and is refused as final (`tests/package-export.spec.ts`).
- **What this does not cover.** The check has nothing to compare against for a package that has never been compared — its entry reports what it was read from rather than a verdict. The dependency graph itself (a result change invalidating the draft, a style change leaving the experiment valid) is core's, and the run's frozen profile already keeps a reconfiguration from moving a study: those are tested where they live, not restated here.

## Files

- `packages/research/dsh-research-team/src/runner/final-package.ts` (the facts field and the check), `src/runner/package-export.ts` (`artifactRefsOf`, `previousArtifactRefsOf`, the manifest field, the option), `src/index.ts` (the Remote export compares with what is on disk).
- Specs: `tests/package-export.spec.ts`, `tests/final-package.spec.ts`.
