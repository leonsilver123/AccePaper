# Agent Note: A package says which one it is, and the final one can be refused

Status: implemented

English | [中文](2026-09-17-a-package-says-which-one-it-is.zh.md)

## Problem

The export wrote one kind of package. It refused nothing, and its manifest carried the readiness facts
as data: `submissionReady: false`, `profileEligible: false`, `E2-submit: gated`. A package of a run
that stopped at A1, of a run conducted under the evaluation profile, and of a run a person had
approved were written identically, and only a reader who compared manifest fields could tell them
apart from a package that was the finished thing.

The one that mattered most was a consequence of WHEN the export runs. It runs when the drive ends —
and a run that reaches the human gate ends there, by construction. So the manifest of the delivered
paper records `E2-submit: gated` and `submissionReady: false`, while the run itself, after the person
approved on the page, records `E2 → passed`. The approval never reached the file. A page offering that
file as the final package offered a package of the state before the decision, and the finding was
written into the delivery's own index as C09 without a fix.

## Decision

**A package states whether it is the final one or a working draft, and the final one is an operation
with its own guards.** Nine conditions, computed from the run's own records rather than from anything
a caller says:

`production-evidence` (the run was conducted under the production profile), `manuscript-produced`,
`every-step-closed`, `no-refused-sections`, `no-open-issues`, `approval-recorded` (the human gate
carries an `approved` decision), `approval-current` (that decision still covers the artifact versions
the run holds), `required-files-present` (every file the run's own manuscript declares), `run-saved`
(the run's last write landed).

- **The manifest carries them**: `state` (`final` only when all nine hold), the checks themselves with
  what was observed, and `approval` — who decided, when, the event id, and the artifact versions the
  decision was taken on. A reader comparing two packages can see whether the same revision was
  approved.
- **The drive-end export is a draft**, and says so in its manifest, in its checks, and in its own
  `run-summary.md`. A run that stops at the human gate has not been decided, so the package of it is
  not the final one — which is what makes the C09 mismatch impossible rather than merely documented.
- **`@Remote('exportRunPackage')` writes the package on demand**, as `draft` or `final`. A `final`
  export is refused in the operation, naming the first condition that failed, **before anything is
  written**: a refusal that emptied the directory on its way out would take away the draft a reader
  still has. A `draft` export is written anyway, labelled — a reader who wants the current material
  should get it rather than a refusal that helps nobody.
- **The page states the host's answer and computes nothing**: it renders `state`, every check with the
  host's sentence, and two controls. A host that names no state shows none, because a package shown as
  final on a host that never said so is the defect the field exists to prevent.

## Alternatives considered

**Refuse to export anything until the run is ready.** The reader asking for the current material at the
gate is the ordinary case — that is exactly when they want to look — and a refusal would leave them
with nothing to read. The draft is written, and every file in it says which it is.

**Have the page decide whether a package is final.** The facts are the run's: its step statuses, its
registry, its approval record, its last write. A page computing them would be a second implementation
of readiness, and the two would disagree exactly when it mattered — the failure this codebase keeps
paying for.

**Re-export automatically when a decision lands.** The approval path would have to know about package
directories, and a run approved while nobody is looking would write files nobody asked for. Asking for
the final package is an act with an author, and the operation records who asked by writing the file.

## Consequences

- **C09 is closed by construction**: the package a reader has after approving is the one they asked
  for, and its manifest says `final` with the approval that made it so. The draft written at the end
  of the drive stays readable and cannot be mistaken for it.
- **The refusal is enforced where the decision is made**, so a caller that never saw a page is refused
  for the same reasons — and the page's control being absent or hidden changes nothing.
- **Not verified**: no browser reading exists of a package that reaches `final`, because a `final`
  package needs a production-profile run whose human gate a person approved, and the deployment used
  for the browser readings is the evaluation one. The refusal and the draft have browser readings; the
  `final` path is covered by the checks' unit tests and by the operation's own refusal test.
