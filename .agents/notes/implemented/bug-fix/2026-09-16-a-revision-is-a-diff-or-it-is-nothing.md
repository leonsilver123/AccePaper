# Agent Note: A revision is a diff, or it is nothing

Status: implemented

English | [中文](2026-09-16-a-revision-is-a-diff-or-it-is-nothing.zh.md)

## Problem

`D4-rebuttal` produced its revised draft like this:

```ts
const revised = sections.map(s => ({ ...s, revised: record.hasRevisions }))
```

`hasRevisions` is derived from the exchanges, and every parsed exchange set `requiresRevision: true`. So one concern marked EVERY section revised, while no body changed anywhere. An offline probe compared the D3 and D4 drafts and measured `unchangedBodies: true, revisedFlags: [true, true]`.

Two artifacts therefore disagreed with each other and neither was checked: the rebuttal said the paper had been revised, the revised draft said so too, and the manuscript was byte-identical to the draft it claimed to revise. This was the largest open P0 in the review's list, and the reason its other findings could not be closed one at a time — a revision cycle that produces no revision makes every downstream check meaningless.

## Decision

`runner/issue-patch.ts` holds an Issue → Patch → Verify cycle, and its rules are all of the form "a diff or nothing".

An **issue** names one section and the version it was written against. That version is a hash the EXECUTOR computes from the body the author was shown — never a value the author declares, because a patch that named its own basis could claim to apply to anything. A **patch** is a replacement body for that section.

`applyRevision` decides each issue:

- the section does not exist → `open`;
- the issue requires no text change and carries an answer → `accepted_explanation`, which is a different outcome from a patch and recorded apart from one;
- the issue requires a change and proposes none → `open`;
- the basis hash is not the section's current body → `open`, naming both hashes. The patch was written against a version that no longer exists, and applying it would silently discard whatever happened in between;
- the patch reproduces the body it was written against → `open`, because a revision that proposes no diff closes nothing;
- otherwise → `patched`, and that section's body is replaced.

`revised` is then derived per section from whether its own body changed. A round that changed nothing marks nothing and reports `patchedSections: []`.

`D4-rebuttal` reads `CONCERN` / `SECTION` / `RESPONSE` / `PATCH` per exchange, and writes `issues`, `changes`, `patchedSections` and `openIssues` onto both the rebuttal and the revised draft. The writer receives the current section bodies and ids in its context, so a patch is written against something it can see and a reply can name a section without inventing the outline.

Two issues patching one section is a CONFLICT, not a merge: the second was written against a body that no longer exists, so it stays open. That is the recovery — the next round sees the new body and can patch against it — and it is preferable to a merge rule nobody agreed to.

## Alternatives considered

**Diff the D3 and D4 drafts after the fact and set `revised` from the diff.** Rejected as the mechanism, though it is the obvious simplification. It tells you a body changed and not which concern changed it, so an issue could close because an unrelated edit touched its section, and a patch that failed to apply would be invisible. The basis hash is what makes "this patch closed this issue" checkable.

**Let the model return a diff — a hunk list — rather than a replacement body.** Rejected. A replacement body is verifiable against a hash and cannot half-apply; a hunk format needs a patch applier, fuzz matching, and a story about what a partial application means. The all-or-nothing replacement is the smaller correct thing.

**Mark `revised` at the document level and record the per-section detail beside it.** Rejected: the document-level flag is what was wrong. A reader who sees `revised: true` on the manuscript does not go looking for a second field that qualifies it.

**Keep `requiresRevision` as the model's declaration rather than deriving it from whether a patch was offered.** Rejected: it is what let an exchange demand a revision and propose none, and the demand read as a fact. Whether a text change is required now follows from whether one was supplied, and an issue that says it needs a change without supplying one stays open by name.

**Fail the D4 step when any issue stays open.** Rejected: a round that closes four of five concerns has done work, and refusing it discards that. `openIssues` is reported, the step passes, and the open ones are visible on the artifact.

## Consequences

- `packages/research` is at **1749 passed / 98 files**; `tsc -b tsconfig.host.json` is clean.
- **`tests/issue-patch.spec.ts` (12 tests) covers the cycle and each refusal**: a patch that applies and marks only its own section; the same body returned as a patch closing nothing; a required change with no patch; an empty answer; an explanatory acceptance recorded apart; a patch against a stale basis; two patches to one section; and an issue naming a section the draft does not have.
- **The driven run is measured against the review's own observation.** One test reads both drafts and asserts the bodies are NOT all identical, that the sections that changed are exactly `['results']`, and that the sections marked `revised` are exactly those — the inverse of `unchangedBodies: true, revisedFlags: [true, true]`.
- **The revision passes its own A gate.** D4's gate reviews `revised-draft` with the new manuscript checks, so a patch that introduced a number the run never measured would be caught there. That is what makes the cycle safe to run rather than merely recorded.
- **The fixture patches are two lines of a fixture.** The fixture path produces one explanation and one patch; the model path is not exercised end to end, because the driven run in this suite has no writer. The parser that reads `SECTION` and `PATCH` is exercised only through the fixture's issues, which are built in code rather than parsed from a reply.
- **`revisionCount` and `hasRevisions` still exist on the rebuttal** and still describe the round, because other readers use them. They are no longer what decides `revised`.
