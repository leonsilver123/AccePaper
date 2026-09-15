# Agent Note: The research packages document their exported contracts

Status: implemented

English | [中文](2026-09-15-research-export-contracts-documented.zh.md)

## Problem

Two documentation gates had been red on the research packages since before this batch, and neither was visible from `pnpm run test:docs`.

Measured: `verify-export-jsdoc` listed **280** missing `@param`/`@returns` tags (411 violations of every kind) across `dsh-research-{tools,core,team,cordis}`, and `gen-config-catalog --check` listed **9** config fields with no JSDoc prose, all in `dsh-research-cordis`. The first gate is not in `run-gates.ts`'s `quick` set, so `test:docs` never ran it; both are in the full `doc-sync`/CI path.

The consequence is not cosmetic. This repository's premise is that AI-generated scientific claims are untrustworthy, and the research layer is where those claims are produced. An exported function with no `@param` beside it states no contract: a reader — human or agent — cannot tell what a parameter is for, and neither can a reviewer checking whether the call site means what the signature allows.

## Decision

**Document each export with the tags its signature requires**, package by package, and treat a package as done only when both gates pass on it.

The batch rule this repository set for the work is binding: where an export cannot be described in one clear sentence, **question the export surface rather than write filler JSDoc**. The comments state the contract the code has, not a restatement of the code: what a parameter must be for the call to be well-formed, what the result carries, and which failure the caller has to handle.

`dsh-research-cordis` went first. Its 52 tags and 9 config fields are done, and the package is clean under both gates.

**The first package turned up one defect the gates could not name.** `Config.requireResearchTools` was the field the config gate reported as undocumented, and its prose existed — stranded in an orphan JSDoc block three declarations above, where an earlier revision of the interface had been. A block that documents nothing is worse than no block: it reads as documentation while the field it describes is reported missing. The prose moved onto the field it describes, which both satisfies the gate and brings the package into the generated catalog.

## Alternatives considered

**Exempt the research packages from `verify-export-jsdoc`.** Rejected: the gate exists so that an exported surface states its contract, and the research layer is the one whose outputs a reader is asked to trust. An exemption here would be the exact arrangement the premise rules out — the least checkable claims carrying the fewest stated contracts.

**Write `@param` tags that restate the parameter name.** Rejected. It turns CI green while freezing whatever the API surface is into permanent decoration, which is the failure the batch rule names. Where a tag could not be written honestly, the export would have been the thing to change.

**Document the modules' prose only, leaving the tags to a later pass.** Not available: the gate requires the tags, and splitting the work would leave both gates red for longer with no partial credit.

**Leave the orphaned JSDoc block where it was and add a short tag block on the field.** Rejected: two blocks would then describe one field, and the stranded one would keep describing a declaration that no longer exists.

## Consequences

**The generated config catalog gained two packages.** `docs/config-catalog.md` now carries `@deepseek-ai/dsh-research-cordis` and `@deepseek-ai/dsh-research-team` sections and four entries in its two trailing lists, because a package appears there once its config is documented. The Chinese counterpart is maintained by hand — the file's own header says so — so the four list entries and the new sections were mirrored into `docs/config-catalog.zh.md` and the pairing record re-recorded with `verify-translation-pairing --write`.

**The gate checks what a package's ENTRY POINTS reach, not every file in it.** `dsh-research-core` exports no `./src/*` subpath, so `verify-export-jsdoc` resolves its surface through the built `lib/types/index.d.ts` and `lib/types/host-prod.d.ts`. Three exports — `GATE_ERROR_PREFIX`, `appendAuditEvent`, `_applyHumanApproval` — are reachable from neither entry point, so the gate never reported them and they are not part of the 280. They were documented anyway, for symmetry with the constants they sit beside. "The gate is green" therefore means "everything a consumer can import states its contract", which is the claim the gate makes; it is not the same as "every exported name in every file".

**One pre-existing comment turned out to be false, and its own field's documentation said so.** `RoadmapNode.kind` was described as an "optional free-placement hint", but no renderer or validator reads it — the layered layout places nodes by their edges alone. The tag is authored by callers and travels into the artifact unchanged. Documenting the interface honestly while leaving a field comment that describes an effect nothing implements would have left the lie in place one line below the correction, so the field comment was rewritten to state what is true.

**Documentation is not completion.** Passing `verify-export-jsdoc` and `gen-config-catalog --check` says every export now states a contract; it does not say the contract is the right one. The batch's evidence is those two gates plus the unchanged test suite, and nothing here upgrades a package's position on the completion ladder.
