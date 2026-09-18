# Agent Note: A rule nobody read is not a requirement the manuscript meets

Status: implemented

English | [中文](2026-09-18-a-rule-nobody-read-is-not-a-requirement-met.zh.md)

## Problem

Every publication condition asked whether the PAPER was finished — its review complete, its floats embedded, its deliverables written, its approval current — and none asked whether it was the document the JOURNAL accepts. E1 wrote `venueStyle: '<name> template'`, naming a template no run has read while the compiler applies pandoc's default, and the plan's own words for this gap were "未知期刊规则阻断最终发布" with the honest note that the official guide could not be fetched.

The tempting remedy is a table: an abstract limit, a reference style, a figure count. It would read as compliance while measuring the manuscript against nothing, and it would wear the journal's name while doing it.

## Decision

- **A rule is a RECORD, not a value.** `JournalRule` gained what a requirement has to carry: the OFFICIAL page it is stated on, the date that page was read, the article type it applies to, whether it was established, and the condition — or what attempting the page produced. `'verified'` means somebody read it at that source on that date. There is no third state, and a rule is never `'verified'` because it seems obvious.
- **A journal profile with no rules is an UNREAD GUIDE, and TRC's is now eight `unknown` ones.** `unreadRulesFor` records the questions every journal's guide answers — abstract length, highlights, graphical abstract, reference style, figures and tables, the manuscript file, declarations, anonymity — each marked unknown, with the URL of the page that would state it and what the attempt produced. This replaces the empty list the profile shipped with: "nobody has read the guide" was true and unactionable, because it did not say what was missing. Recording the questions is not defaulting them — an invented word limit would have read as compliance, while an `unknown` rule is refused.
- **`checkVenueRules` decides, and `checkFinalPackage` gained `journal-rules-verified`.** A profile containing any unread rule refuses the final package, naming the rule ids so a reader knows how many pages to fetch; a profile with no rules is refused as an unread guide; a run carrying no profile at all is refused as `journal-rules-absent`. The conditions about the paper are unchanged — this is the one that asks about the submission.
- **A deployment that read the guide states it where the run is conducted.** The seam already existed: `resolveResearchProfile({ journal })` freezes the profile into the run's spec, and the export reads it from there rather than re-stating the rules it wants to publish under. A first version of this added a second `venueRules` option beside it, and the profile's own spec caught the duplication — one fact, one home.
- **E1 stopped claiming a template.** `venueStyle` read `<name> template`; it now says the compiler applied pandoc's default and the venue's requirements are recorded on the run's profile rather than applied.

## Alternatives considered

- **Hard-code TRC's limits from memory or from a secondary source.** Refused: a limit nobody read is a guess, and a manuscript that meets it reads as checked. The plan's own instruction is that each rule carries its official source, access date, article type and verification state.
- **Leave the gap silent and let the last condition be `run-saved`.** Refused: the pipeline would publish under rules nobody read and say nothing, which is the failure mode this whole subsystem is built against.
- **Record the rules only when a venue is a "real journal".** Refused: the venue artifact already distinguishes `retrieved-corpus` from `declared`, and both are venues whose guide has to be read. A declared venue is not exempt from its own requirements.
- **Fetch the guide at run time.** Refused for now: the retrieval host is a policy question (a run that reaches the open web needs the same provenance rules as the literature channel), and the measured state is that the official pages refuse this host anyway. The seam is the journal profile, and filling it is a reading somebody performs.

## Consequences

- **Measured, 2026-09-18.** Three official pages for TRC were attempted from this host — `sciencedirect.com/journal/transportation-research-part-c-emerging-technologies/publish/guide-for-authors`, `…/about/author-information`, and `elsevier.com/journals/transportation-research-part-c-emerging-technologies/0968-090X/guide-for-authors` — and every one answered HTTP 403 with a JavaScript challenge body (1.2 MB) rather than the guide. That finding is what `TRC_PROFILE` records as the `detail` of every one of its rules, so the record carries the evidence for its own `unknown`s.
- **`tests/venue-rules.spec.ts`** (7 cases): an unread guide is recorded as questions, each with its source and what the attempt produced; a submission under it is refused naming the ids; a run with no profile is refused as unchecked; a profile with an empty rule list is refused as an unread guide; a fully read guide is satisfied; and ONE unread rule is enough to refuse.
- **`tests/research-profile.spec.ts`** pins the shipped profile: eight rules, none of them claimed as read, each naming the page that would state it.
- **`tests/start-run.spec.ts`** carries both directions on the production path. The approved production run now fails three conditions — profile, review, and the journal's rules — and the case says why. The success path is reachable again because the CONDUCTING process states it read the guide (`--venue-rules-read` on the fixture, supplying `journal`), and the exporting process reads the frozen profile off the run rather than supplying rules of its own.
- **What this is not.** No journal's rules are recorded in this repository. The shipped state is that this pipeline cannot produce a final package, and that is the true state: a submission cannot be said to meet requirements nobody has read. Filling the record is a reading, and it is P18-09's remainder.

## Files

- `packages/research/dsh-research-team/src/runner/research-profile.ts` (`JournalRule`'s provenance, `unreadRulesFor`, `TRC_PROFILE`), `src/runner/venue-rules.ts` (new — the decision), `src/runner/registry.ts` (E1's `venueStyle`), `src/runner/final-package.ts` (`journal-rules-verified`, read from the frozen spec).
- Specs: `tests/venue-rules.spec.ts` (new), `tests/start-run.spec.ts`, `tests/final-package.spec.ts`, `tests/fixtures/approve-restart/approve-and-exit.ts` (`--venue-rules-read`).
- `packages/research/dsh-research-team/README.md` / `README.zh.md`.
