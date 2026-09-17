# Agent Note: The quality report reaches the page, with its coverage

Status: implemented

English | [中文](2026-09-17-the-quality-report-reaches-the-page.zh.md)

## Problem

The quality baseline's report was written, carried on the package manifest, tested — and invisible. The page reads a `ResearchRunSnapshot`, whose `packageExport` carried `files`, `state` and `checks`; the report was not among them. So the one surface a person actually looks at showed nothing about whether the manuscript refers to its own figures or positions itself in its own bibliography, and the M11 work item ("an explainable quality UI that locates what to change") had no data to render.

## Decision

- **`ResearchPackageExport` gained `quality?: PaperQualityReport`**, and `exportRunPackage` fills it from the manifest. **No new `@Remote` method**: the field rides an existing result, so the descriptor set the assembly bundle inlines does not change — which is the trap that once left a page calling `listRuns is not a function`.
- **The client twin gained it too** (`WirePackageExport.quality`, `DeliverableView.quality`, and the report's view type declared in `summary.ts`, the model module, because `run-source.ts` already imports from there and the reverse would be a cycle).
- **`toRunSummary` lifts the report out of the deliverables** into four fields a panel reads directly (`quality`, `qualityChecks`, `qualityDomainReview`, `qualitySummary`), so a panel does not walk a file list to find a fact about the manuscript.
- **`selectQuality(summary)` is the pure selector** (`panels.ts`, which has no React and no runtime imports), and `QualityPanel.tsx` renders three lists:
  - the findings, each with the code's copy, the rule's own detail, and **the evidence verbatim** so a reader checks the finding rather than believing it;
  - **every check with its outcome** — `defect-found` / `no-defect-found` / `not-applicable` / `not-executed` — and the reason it could not answer, which is what a reader acts on;
  - **the questions no rule answers**, named beside the findings rather than left to an empty list.
- **`FINDING_LABEL` / `OUTCOME_LABEL` are spelled out rather than composed.** The dictionaries are typed, so `quality.finding.${code}` is `string` and the translate function refuses it — which is the type system saying a code with no entry would render as its own key. The map makes a new finding code a compile error until it has copy in both languages; a code that somehow reaches the panel without one renders as itself rather than as an empty label.
- **A run with no exported package says so** (`quality.noPackage`) rather than rendering an empty finding list: "not exported" and "no problems" are different facts, and the second would clear a manuscript nobody looked at.
- **The panel sits beside the revision loop**, because a finding is answered by asking for different work — the panel next to it.

## Alternatives considered

- **A new `@Remote('qualityReport')`.** Refused: it needs the typert descriptors regenerated and both faces rebuilt in order, and the report is already part of the package the page holds. Riding the existing export has no such ordering.
- **Render the findings alone.** Refused — it is the reading R04 exists to prevent: an empty list is the output of the rules that could read the manuscript.
- **Translate the report's `summary` sentence.** Refused: it is composed from the run's numbers and states what the report IS; a view that paraphrased it could say something the report does not. The labels around it are translated; the sentence is quoted.
- **Let the panel offer a control per finding.** Refused: a finding is answered by a revision request or by a person's judgement, and both have panels that own them. A second control here would be a second way to ask.

## Consequences

- **Both directions are pinned** in `tests/quality-panel.dom.spec.ts`: a report whose checks mostly could not read the manuscript renders the coverage, the reasons and the domain questions beside an empty finding list; a report with a finding names the object (in the paper's own vocabulary, `Figure 2`) and shows its evidence; and a run with no package says there is no report rather than reporting no findings.
- **The tab count is the roster's own length** now, so adding a panel is one entry in one place rather than a number to find.
- **What this is not.** The panel reports; it decides nothing and writes nothing. A finding's `where` is the label the paper prints, not a link into the manuscript — locating a finding in the text the reader is looking at is the next step, and it needs the section bodies on the page, which this snapshot does not carry. Whether the baseline's five rules are the right five is a reviewer's question and is stated as such in the report itself.

## Files

- `packages/research/dsh-research-team/src/types.ts` (the export field and the report types), `src/index.ts` (fills it).
- `packages/research/dsh-research-web/src/run-source.ts` (wire twin), `src/summary.ts` (view type and the lifted fields), `src/panels.ts` (`selectQuality`), `src/client/workbench/QualityPanel.tsx` (new), `src/client/workbench/ResearchWorkbench.tsx` (the tab), `src/client/locales.ts` (copy in both languages).
- Specs: `packages/research/dsh-research-web/tests/quality-panel.dom.spec.ts` (new), `tests/researchview-component.dom.spec.ts`.
