# Agent Note: What produced a value, and what a deployment is allowed to call evidence

Status: implemented

English | [中文](2026-09-16-provenance-and-the-evidence-profile.zh.md)

## Problem

The research pipeline mixes six kinds of value in one artifact graph, and until now the difference between them lived in a string field nobody was required to read.

`A1-landscape` reaches the OpenAlex catalogue and records real papers. The B channel — the judgment that a claim is anchored in external evidence — resolves against `MockCitationResolverAdapter` over a synthetic DOI (`10.0000/synthetic.t19b-anchor`) and hands the resulting verification to `adjudicate({ component: 'B', requireExternalAnchor: true })`. That verification passes. Its own basis string says `mock_external` on every verdict, so nothing was hidden, and nothing stopped it from counting as production evidence either.

The architecture review reproduced the consequence as probe `externalAnchor`: the A1 B gate returned `passed` with evidence naming `MockCitationResolverAdapter` and `syn-l0-001`. A run whose literature is real and whose anchoring is synthetic reported one uninterrupted chain of approvals.

The same conflation ran in two other directions. A `fixture` artifact and a `simulation` artifact were both "not real", although a simulation can be a legitimate research result and a fixture only proves the program ran. And a source that was located but never read through was indistinguishable from one whose full text supported the claim — which is the distinction that decides whether a citation may be used at all.

## Decision

**Two axes, kept apart because they fail differently, and one profile that decides what may carry a gate.**

`dsh-research-core/src/domain/provenance.ts` declares them.

**`sourceClass`** is what a value IS: `fixture`, `simulation`, `imported`, `measured`, `literature`, `model_generated`. A closed set, because a producer that fits none of them has no honest class to declare.

**`sourceAccess`** is how much of a source was actually read: `full-text`, `abstract-only`, `metadata-only`, `none`. It is absent when the question does not apply — a simulated measurement was not read from anywhere, and stating an access level for it would be noise.

`admitAsEvidence(profile, provenance)` returns one of three dispositions, and the third is the one that matters:

- **`admitted`** — the evidence may carry the gate.
- **`pending`** — the source was located but not read through. This is evidence still being gathered, and the correct end for it is a HOLD. It is deliberately not a softer `refused`: a `refused` carries the risk of reporting a claim as contradicted when the truth is that nobody has read the paper yet.
- **`refused`** — the class cannot carry a production gate at all.

**`EvidenceProfile`** is `production` or `evaluation`. Under `production`, `fixture` and `model_generated` are refused outright — the class decides before the access level, because "a synthetic record whose text we read" is still synthetic. `sourceAccess` below `full-text` yields `pending`. `simulation`, `imported`, `measured` and `literature` are admitted, so a study whose experiment is a simulation is not blanket-rejected: a simulation is a result, a fixture is a demonstration.

Under `evaluation`, everything is admitted, because exercising the pipeline is what that profile is for — and `submittabilityOf('evaluation').submittable` is `false`. **The permission to run and the permission to publish are separate, and that is where they are kept separate.** A run cannot become submittable by containing no fixture evidence; submittability is a property of the profile a deployment is on record as declaring.

**The shipped bundle declares `evaluation`.** Its B anchor is the simulated resolver, so it is the honest declaration, and the package it writes says `submittable: NO` with the reason in the manifest and in `run-summary.md`. The run snapshot carries the profile and the submittability into the browser view, so the page cannot render a demo run and a production run identically.

**`runT19B` defaults to `evaluation`.** An undeclared run executes and is stamped unsubmittable — the permissive default cannot become a published claim, because the freedom it grants is the freedom to run and never to submit. `production` is reached only by declaring it, which is what puts a deployment on record.

**The B channel enforces it where the evidence is used.** `buildBChannelAnchors` now returns `provenance` as data rather than describing it only in prose, and `verdictB` calls `admitAsEvidence` before adjudicating. When the disposition is not `admitted`, the verifications are WITHHELD and core's own `requireExternalAnchor` produces the abstention. The core gate remains the single adjudication source, the outcome is a HOLD rather than a finding about the claim, and the evidence string names the policy code and reason.

**The domain vocabulary the commit point needed.** `src/domain/` also gains `ids.ts` (branded identities, versions distinct from ids), `artifact.ts` (the `ArtifactRef` triple, the canonical-JSON content hash, the artifact envelope and its ingress parser), `task.ts` (attempt, lease, budget, execution receipt, and the lease-vs-attempt cross-check), `quality.ts` (`GateReport` bound to target refs and an input digest, plus `aggregateDisposition` and `reportAnswers`), and `project.ts` (the project header and the revision counter). The ingress parsers refuse rather than coerce: an unknown `schemaVersion`, a missing content hash, a reference that does not resolve, and a reference that resolves to DIFFERENT content than it recorded.

## What is deliberately not covered

**No `Decision` object.** The review's domain model has one, and nothing consumes it yet. A type with no reader is a claim about a design rather than a part of it.

**The B channel has no production-grade source.** Under `production`, today's B channel holds every run at A1. That is the correct exposure of a capability gap, not a bug — but it means the `pending` path (a real record found, full text unread) is exercised only at the policy level tonight. The literature work that gives B a real evidence graph is what will exercise it end to end.

**`simulation` is admitted as production evidence** on the strength of the review's own distinction ("simulation 可以是合法科研结果"). Nothing yet checks that a `simulation` artifact's producing rule version is the one the method names; that is the method–result consistency work.

## Alternatives considered

**Default `production` so the safe thing is implicit.** Rejected after weighing it against what the default actually protects. With `production` as the default, every existing test and the shipped bundle would have had to declare `evaluation` to keep running — a large diff that changes no outcome, since submittability is already `false` by default under the choice made. The property that matters is that an undeclared run cannot be published, and defaulting to `evaluation` holds it while keeping the diff honest.

**Rename the mock so it does not look like a mock.** Rejected outright: the review names this as a way to pass without fixing anything, and the labelling was never the defect. The defect was that a label did not decide anything.

**Make the profile a request field.** Rejected: `runPipeline` is exposed as a Remote method, and a browser must not be able to promote its own run to production.

**Refuse the anchor as `blocked` rather than withholding it.** Rejected: `blocked` means evidence was usable and spoke against the claim. An unusable anchor says "we cannot judge", and reporting it as a contradiction would be the same category error the C gate was fixed for.

**Put the provenance on the citation chain's own `VerificationResult`.** Rejected: the chain reports what it verified, and provenance is a statement by whoever assembled the inputs. Making the assembler declare it is what keeps the two from being confused.

## Consequences

- The B channel can no longer pass on a synthetic anchor in a production run, and the evaluation run that does pass says so in its own manifest.
- `packages/research` is 1617 passing across 89 files, including `production-evidence-policy.spec.ts` (the production/evaluation divergence at the B gate), the five `tests/domain/` specs (the ingress refusals), and `evidence-profile.spec.ts` (the config validation).
- A production deployment that reaches A1 today stops there with `gate_abstained` and a reason naming the evidence class. That is the run reporting a capability gap instead of a success.
- The core package entry grows a `domain` surface. Its modules import nothing from `engine/`, and `engine/commit.ts` imports from `domain/`, so the direction stays one way.
