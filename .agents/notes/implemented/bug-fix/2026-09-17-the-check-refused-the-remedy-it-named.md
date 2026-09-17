# Agent Note: The check refused the remedy it named

Status: implemented

English | [中文](2026-09-17-the-check-refused-the-remedy-it-named.zh.md)

## Problem

`artifacts-current` — the check that a final package describes the state the run is in — failed whenever the artifacts a previous package was read from had moved. Its own detail said what to do about that: `these artifacts moved after this package was read: … — re-export to describe the run as it stands`.

The remedy could not be taken. The versions handed to a re-export come from the package ON DISK (`previousArtifactRefsOf(directory)`, wired into `@Remote('exportRunPackage')`), and a package whose artifacts have moved describes an older state by construction — so the same stale versions arrived at every subsequent export, `moved` was never empty, and **"differs from the previous export" was permanently illegal**. A run that moved, was re-checked and was re-approved still could not produce a final package. The review found it as R06 and asked for both directions to be tested.

## Decision

- **A move that was re-checked and re-approved is not a move this check refuses.** The refusal exists for a LATE export — one that would replace a reading of a state the run has left and nobody re-examined — and the artifact that proves re-examination is the approval: an approval names the artifact versions it was taken on, so one that still covers the run as it stands (`approval !== undefined && staleApproval === undefined`) is exactly that evidence.
- **The refusal still holds in both directions that matter.** With no approval, or with an approval that no longer covers the run, `approval-recorded` and `approval-current` fail — and `artifacts-current` fails too, because neither condition holds. A late export is refused; it is just no longer refused *twice* for the same reason.
- **The passing case says what happened**, rather than reporting a clean bill: `this package replaces a reading of <artifacts>, which the run has moved past — and the approval it carries covers the run as it stands, so this package describes the state the decision was taken on`.

## Alternatives considered

- **Drop `artifacts-current` and let `approval-current` carry the whole refusal.** Refused: the two answer different questions — whether the artifacts stand, and whether the decision covers them — and a run can move without a decision being involved at all (a recovery, a re-run, an offline step) while no approval exists yet.
- **Have the caller declare whether the move was reviewed.** Refused: a caller's claim about its own material is what this package's checks exist to replace, and the approval is the run's own record of exactly that.
- **Let the second export through by comparing against the refs the FIRST export wrote rather than the ones on disk.** Refused: it hides the fact that the package being replaced described a different state, which is the one thing a reader of a re-export needs to know.

## Consequences

- **Both directions are pinned** in `tests/final-package.spec.ts`: a move nobody re-examined is refused and reported as a draft; the same move with an approval covering the run as it stands passes every check and is `final`.
- **The existing stale case is unchanged**: `tests/package-export.spec.ts` exports an evaluation run, which carries no approval, so `artifacts-current` still fails and the package is still a draft.
- **What this does not cover.** A caller cannot ask for a package of an EARLIER revision — the export always reads the run as it stands — so "a late export of an old version" is reachable only as a move without a matching approval, which is what these tests drive. An export of a named historical revision is a different operation and is not built.

## Files

- `packages/research/dsh-research-team/src/runner/final-package.ts` (the `artifacts-current` check).
- Specs: `tests/final-package.spec.ts`.
