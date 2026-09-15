# Agent Note: The manuscript numbers its floats once, and offers those numbers to the prose

Status: implemented

English | [中文](2026-09-15-one-numbering-authority-for-floats.zh.md)

## Problem

The exported manuscript carried numbered captions that no sentence could refer to.

Measured on the package a real run exported: `figures/figure-1.svg` was written, the results table reached the manuscript as a pipe table, and the `## Figures` block carried `**Figure 1.**`, `**Figure 2.**` and `**Table 1.**` — while `Figure 1` and `Table 1` appeared in no section body. Three facts produced that, and they share one cause:

- E1-format assigned the numbers with two counters of its own (`figureNumber`, `tableNumber`) as it walked the rendered floats. Nothing outside that function could know them: a reader of `figure-plan` saw `totalFigures: 3` and three entries carrying no number at all.
- D3-writing told the prose channel `figureCount` — how many floats exist, not which. A section could not name one, and a writer asked to cite `Figure 2` would have had to guess which float that is.
- `equationBlock` numbered the equations from its own list order, so the equation labels were a fourth independent decision.

A cross-reference is one fact with two renderings: a caption and a sentence. Deciding it inside the step that renders the caption, and telling the drafting step nothing, makes the second rendering impossible rather than merely absent.

## Decision

**D1-figure-map numbers the floats, because it is the step that decides which floats exist.** Each plan entry carries `label` (`Figure 1`, `Table 1`) and `title`, assigned by `numberFloats` — a pure function of the plan array, in which figures take numbers 1..n in plan order and tables number independently from 1. A kind that function does not know is refused rather than skipped: an unnumbered float would render a caption nothing can refer to, which is the defect the numbering exists to prevent.

The plan's labels then travel two ways.

- **To the prose channel.** D3-writing offers the writer the roster — the labelled floats plus the equations the method section states — as `context.citable`, with the instruction saying to refer to an item by its exact label. The roster travels as data rather than only as a sentence in the instruction, because a label a model has to recover from prose is one it can get wrong, and a wrong number in a paper reads as a citation of something the manuscript does not contain.
- **To the assembler.** E1-format renders each caption from the plan entry's own `label` and `title` and drops both counters, so the number a sentence cites and the number a caption prints come from one decision. An entry that reaches it unlabelled is refused.

E1-format also records what the prose did with the offer. `crossReferences` splits the citable items into the labels the draft's section bodies mention and the ones they do not, and `floatsNotRendered` names any float the plan declares that this manuscript does not carry. Nothing is inserted to close the gap: a sentence this step added would be prose no step wrote, and it would land in whichever section came last rather than in the one the float is about. The report reads the DRAFT's sections, not the assembled body, because this step appends the equations to the method section — scanning the assembled text would count each equation's own label as a reference to it.

## Alternatives considered

**Have the assembler write the reference.** E1 knows every float's number and every section's text, so it could append "as Figure 1 shows" beside the floats. Rejected: that is a sentence no step produced, attached to a section this step cannot tell is about that figure. `crossReferences` gives a reader the same information without inventing prose.

**Keep numbering in E1 and hand the numbers back to D3 afterwards.** Not available: D3 runs before E1, and the labels are exactly what D3's request needs. A second pass over the draft was not considered worth its complexity against moving the decision to the step that owns it.

**Number the floats in D3 instead.** D3 is where the roster is needed, but it is not where the floats are decided. A step that numbers floats it did not choose can number one that is never rendered.

**Let the offline fixture prose cite the floats, so the report is non-empty without a model.** Rejected: the deterministic prose channel writes a demo notice and no findings, so a citation it produced would be the pipeline demonstrating its own wiring rather than a prose channel citing a float. The request-layer spec pins the offer instead, and an offline run reports every float uncited — which is the truth about a demo draft.

## Consequences

**The fixture draft cites nothing, and the artifact says so.** The offline route's section bodies are the demo notice, so an offline run lists every float and every equation under `crossReferences.uncited`. That is a fact about the draft, not a defect in the numbering, and it is visible rather than inferred.

**Old run snapshots fail at D3 or E1.** A `figure-plan` written before this change carries no `label` and no `title`, and both steps refuse such an entry. Under the pre-release stance this is allowed, but it is a break: a run resumed from an older snapshot whose D1 completed and whose D3 or E1 did not stops with a named error instead of rendering unnumbered captions.

**The equations are citable but are not drafted.** `MODEL_EQUATIONS` is a module constant, so its numbers are known to D3 before the method section exists. The prose channel is offered them; E1 renders them; nothing else changes about how they are stated.
