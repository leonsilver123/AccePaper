# Agent Note: A stage is a view of the run, not a second engine

Status: implemented

English | [中文](2026-09-17-a-stage-is-a-view-of-the-run.zh.md)

## Problem

The workbench organized a study by pipeline vocabulary: nine tabs named after artifacts and mechanisms (pipeline, gates, adversarial, roadmap), sixteen steps identified by `A1-landscape` and `E2-submit`, and a readiness model whose four parts are named `evidenceProfile`, `profileEligible`, `submissionReady` and `readinessNote`. A researcher who did not read the design documents could see that something had happened and could not tell what they were looking at, what it produced, whether it was blocked, or what was being asked of them. The states a person actually needs — waiting on my decision, failed and here is why, not yet, and here is what is missing — were spread across four panels and two vocabularies.

Adding a sixteenth "stage" as a real unit of state would have been worse: two state machines over the same run, disagreeing about what "done" means, with the pipeline's verdicts no longer the authority on whether a study advances.

## Decision

**The stages are a grouping over the run's own records, and every state they show is derived from those records.**

- `stages.ts` names six groups and, for each, the pipeline steps whose outcomes it reports. The intake group reports no step: the question, the material and the plan a person confirmed are not a seventeenth executed step, and a stage that reported one would claim work the pipeline never did.
- **A stage's state is a function of its steps' statuses**, tested in the order of what a reader must know first: a failure, then a decision waiting on a person, then a block, then work in flight, then completion. **`awaiting-human` is its own bucket and never a kind of progress** — a step held at a human gate is waiting for a person, and folding it into "in progress" shows a study moving while it is stopped on a decision nobody has been asked for. A status this build cannot name is `unknown` and blocks its stage, rather than being defaulted into `not-started`, which would report a step the host advanced as untouched.
- **Progress is counted, never estimated.** The line reports steps passed of the pipeline's total, decisions waiting on a person, failures and unknown states. There is no percentage and no completion time: the steps differ by orders of magnitude in cost, so a fraction of them is not a fraction of the work, and a time would be a promise this view cannot keep.
- **A later stage names what it is waiting for.** The earliest incomplete stage, not the latest: it is the one whose completion unblocks the chain, and naming a later one sends a reader to work that cannot start.
- **"You supply this" and "this build cannot place these steps" are different facts.** The intake group is `declared === 0`; a stage whose declared steps the projection did not carry says so and names them, instead of rendering the intake note over steps that exist on the host. The default stage is chosen by what a stage DECLARES, so a projection this build cannot place does not fall through to the intake group and answer "this is yours" about a host's own steps.
- **A study opened second is not overwritten by the first.** Every read of a study takes a generation, and a snapshot from an older generation is dropped rather than rendered. Two follows writing one piece of state means the last answer wins, which shows one study's numbers as another study's.
- The strip navigates and nothing else: pressing a stage changes what is on screen, and the pipeline reaches the same verdict whether a stage is open, collapsed or never visited.

## Alternatives considered

**Make the stages the state machine and derive the steps from them.** It reads as a simplification and it inverts the authority: the engine decides what advanced, the projection reports it, and a grouping that could hold an opinion about it would be a second place for a study's state to live.

**Show a percentage and an estimate.** Familiar, and both are inventions: the pipeline's steps are wildly unequal in cost, so "40% of the steps" is not 40% of the work, and a completion time would be computed from nothing.

**Derive the grouping from the phase letter.** Compact, and wrong for phase D, which spans three stages: the figure map belongs with the results it maps and the rebuttal with the delivery it answers for, so a prefix rule would silently file the rebuttal under the writing stage.

**Hide the stages a run has not reached.** A reader then cannot see that three stages are still ahead of them, or what the run is waiting for. The stages are shown, and a later one says what it waits on.

## Consequences

- The page answers, without pipeline vocabulary, what is happening, what it produced, why it is stopped and what is being asked of the person.
- The grouping is checked mechanically against the engine's own catalogue: the spec imports `STEPS` from the core package's source and fails when a step is added, so a new step cannot vanish from every stage silently.
- **Not done in this note**: the connection state machine (`idle → connecting → live → reconnecting → offline → resyncing → disposed`) and the single project cache the design calls for in M05. The generation guard is the part that closes the acceptance item "a late response for one study must not overwrite another"; the connection vocabulary and the cache are still to come, and the page states neither today.
