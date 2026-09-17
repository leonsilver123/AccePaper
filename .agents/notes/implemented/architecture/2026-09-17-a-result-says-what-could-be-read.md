# Agent Note: A quality result says what could be read, not only what was found

Status: implemented

English | [中文](2026-09-17-a-result-says-what-could-be-read.zh.md)

## Problem

The package manifest carried `qualityFindings`, and for the shipped run it was `[]`. Five exact rules produce that list — an object the text never refers to, an object the text refers to and the document does not carry, a bibliography the text never uses, a statement about prior work with no citation, a sentence describing the measured change in a direction its own measurement contradicts — and an empty list is the output of the ones that could read the manuscript. A reader takes it for a verdict on the paper, which is the reading the review rejected: "`qualityFindings: []` can only report that the covered checks found no problem. Without a real PDF, without correct static figures, with unknown journal rules, or with an unverified production success path, none of these may be presented as the plugin being able to produce a TRC submission."

The conflation is real inside a single run. `no-literature-position` reads a document that carries a bibliography and never cites it; a document with no bibliography at all produces the same silence. `metric-misread` only fires on a sentence quoting the change the run measured; a manuscript whose results section never states the number produces the same silence. `uncited-object` reads a float roster; a draft with no floats produces the same silence. Four different facts — agreed, nothing to read, never ran, and not this baseline's question at all — all rendered as `[]`.

## Decision

- **`reportPaperQuality(input)` is the production entry point**, and it returns `PaperQualityReport`: the findings, one `QualityCheck` per rule with its `outcome` (`no-defect-found` | `defect-found` | `not-applicable` | `not-executed`) and the reason when it could not answer, the `needsDomainReview` questions, and a `summary` sentence.
- **The rules are one table** (`QUALITY_RULES`), so the coverage list cannot be shorter than the rules that ran. A check that had nothing to read says what it needed: no bibliography, no sentence stating the measured change, no float roster, no draft.
- **`needsDomainReview` is data, not prose** (`DOMAIN_REVIEW_ITEMS`): is the claim worth testing, does the method answer the question, does each cited source say what the sentence cites it for, are the figures legible, does the prose claim more than the measurement supports. Each is a question a reader answers, and each is reported whether or not the exact comparisons found anything.
- **The summary states what the report is.** `no defect found by the 3 check(s) that could read this manuscript; 2 check(s) could not run, and 5 question(s) need a domain reviewer` — never that the paper is good.
- **The manifest carries the report** (`RunPackageManifest.quality`), because the package is what a reader receives and an empty list with no coverage is the reading this replaces.
- **`reviewPaperQuality` stays** as the findings-only view, documented as such: the existing rule-by-rule specs drive the rules directly, and a caller that wants only the defects should not have to read past the coverage.

## Alternatives considered

- **Keep `qualityFindings` and add a `qualityCoverage` field beside it.** Refused: two fields that must be read together to mean one thing is how the empty list gets read alone, which is the defect.
- **Report a boolean `ran` per rule.** Refused: "not applicable" and "not executed" have different remedies — the first is a fact about the manuscript, the second about the run — and a boolean reads as the same silence for both.
- **Enumerate the domain questions per manuscript rather than as a fixed list.** Refused: which questions a baseline cannot answer is a property of the baseline, not of one paper, and deriving it per manuscript would make it look like a finding.

## Consequences

- **A package's empty finding list now travels with what produced it** — `tests/package-export.spec.ts` asserts the five checks, no `defect-found`, the review questions, and the summary wording.
- **The three states are distinguished by test**: `tests/paper-quality.spec.ts` drives a manuscript that agrees with the measurement and one whose results section never states it, asserts both have no findings, and asserts their `metric-misread` outcomes and summaries differ.
- **What this does not cover.** The rule set is unchanged: the coverage list says which of THESE five rules could read the manuscript, not what other checks a paper needs. The domain questions are named and not answered — recording a reviewer's answer against an item id is not built.

## Files

- `packages/research/dsh-research-team/src/runner/paper-quality.ts` (`reportPaperQuality`, `QUALITY_RULES`, `DOMAIN_REVIEW_ITEMS`, `QualityCheck`, `PaperQualityReport`), `runner/package-export.ts` (the manifest carries `quality` in place of `qualityFindings`).
- Specs: `tests/paper-quality.spec.ts`, `tests/package-export.spec.ts`.
