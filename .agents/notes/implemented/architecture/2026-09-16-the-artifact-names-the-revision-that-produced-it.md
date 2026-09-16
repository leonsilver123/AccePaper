# Agent Note: The artifact names the revision that produced it

Status: implemented

English | [中文](2026-09-16-the-artifact-names-the-revision-that-produced-it.zh.md)

## Problem

The run has carried a `projectRevision` for a while. `commitStepOutputs` compares it against the
revision a commit was prepared against, refuses `DSH_COMMIT_REVISION_CONFLICT` when they differ, and
advances it on the write. `run-persistence` saves and restores it. The domain type for an artifact,
`ResearchArtifact` in `core/src/domain/artifact.ts`, even has a `projectRevision` field.

What no production path did was **write one**. `ArtifactRecord` — the live registry entry — carried
`{slug, producerStepId, producerAttemptId, value, producedAt, invalidated, ref}`, and `ref` holds
`artifactId`, `version` and `contentHash`. So a reader could ask "which version of the results
section is this" and get an answer, and could not ask "which state of the study produced it" at all.
The second question is the one a package, a screen and an approval all need in common.

`ref.version` looks like a substitute and is not: it counts revisions of ONE artifact. Two artifacts
written by the same commit share a project revision and have unrelated version numbers.

## Decision

`ArtifactRecord` and `ArtifactRecordMeta` carry `projectRevision`, written by both writers:

- `commitStepOutputs` stamps the revision the commit **published**, not the one it was prepared
  against — the artifacts become part of the state that revision names;
- `recordArtifact` stamps the run's **current** revision, because that seam writes one artifact and
  does not move the revision. Claiming the next one would report a change the call never made.

The field is REQUIRED in the snapshot format. A snapshot without it is refused rather than
defaulted: naming a project revision an artifact may never have belonged to destroys the only fact
the field carries, and every reader of it exists to tell which state produced something.

The first consumer is the export manifest: `RunPackageManifest.projectRevision`, read from the run
rather than derived from the files, so a reader comparing two packages — or matching a package
against a screen — can tell whether they are the same state of the study.

## Alternatives considered

**Derive the project revision from `producedAt`.** Rejected: the exporter writes
`new Date(0).toISOString()` for `generatedAt` — a fixed timestamp, because a package that changes
its bytes on every export cannot be compared with itself. A clock is not a revision anyway: two
commits can land in the same millisecond and one can land after a restart that moved the clock back.

**Put it on `ArtifactRef`.** Rejected: a ref is the identity of ONE artifact (`artifactId`,
`version`, `contentHash`) and is compared for equality in several places, including
`sameTargetSet`. Adding a project revision to it would make two refs to the same bytes unequal
because they were produced in different commits, which is not what those comparisons mean.

**Optional, with readers tolerating its absence.** Rejected: the default would be a lie in one
direction or the other, and the field exists precisely to end the guessing.

**Publish the field and let the UI adopt it later.** Rejected: the checkpoint plan says a field with
no consumer is not a deliverable. The manifest reads it in this change.

## Consequences

- `tests/commit.spec.ts` pins that both artifacts of one commit carry the PUBLISHED revision (and
  therefore each other's), and that the one-artifact seam carries the current revision and does not
  move it.
- `tests/package-export.spec.ts` pins that the manifest names the run's revision and that it is not
  the zero a missing read would produce.
- Snapshots written before this are refused on load. That is the format's normal discipline (the
  loader validates against the live model and returns no partial run), and no snapshot in the tree
  predates the change.
- **What is still missing, and named in the README**: the browser wire and the workbench do not read
  it yet. The manifest is a real consumer; the UI is the next one.
