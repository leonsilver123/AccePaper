# Agent Note: A requirement stated in the conversation reaches the run, and a decision does not

Status: implemented

English | [中文](2026-09-18-a-requirement-stated-in-the-conversation-reaches-the-run.zh.md)

## Problem

A person hands a research run its requirements by talking. Until this change the panel's own controls were the only way in: an agent could understand "tighten the results section" or "the claim is stronger than the measurement" and had nowhere to put it, so a person who works in the conversation had to leave it and retype what they had just said.

The two things a person can say are not the same kind of thing, and nothing in the product told them apart. Information — change this, name it that — is what the run answers with work the person still judges. A decision — approve, reject, submit — carries the operator's principal, travels the host's authenticated browser channel, and is what `approval.ts` records. One door for both would let a model attribute a decision to a person who never made it, which is the failure the approval seam exists to prevent.

## Decision

- **The door records a change request and nothing else.** `record-change-request`, registered by `ResearchTeamService` on `ctx.tools`, turns what the person asked for in the conversation into a durable revision request at the pipeline's own human gate, using the same `recordRevisionRequest` the panel's remote call uses.
- **The parameter set is the boundary, not the handler's good behaviour.** It declares `runId`, `instruction` and an optional `targets`; there is no parameter a verdict could travel in, and `execute` reads only those three, so a call that smuggles `decision: 'approved'` alongside them produces a change request and nothing more. `defineTool` validates the arguments against that declaration before the handler runs, and a call naming no run never reaches the service.
- **The record says which place it came from.** `RevisionRequestRecord.source` is `'panel' | 'conversation'`; the panel's own remote request and the change request an applied decision produces both stamp `'panel'`, the tool stamps `'conversation'`, the projection carries the value, and the client twin keeps it optional.
- **The panel makes a claim about the agent, never one about the person.** A conversation-sourced request renders as "the agent recorded this from the conversation (not something you confirmed here)". An agent can mishear, and a badge reading "you asked for this" would overwrite that possibility with the person's own voice; the person still judges the candidate written to answer the request.
- **The step is the pipeline's human gate**, taken from the step definitions rather than named by the caller: a request filed against a step that never waits for anybody would have nowhere to be answered, and the service refuses to boot the tool at all when a pipeline declares no gate.
- **This is the only tool the team service registers.** The pipeline's seven (T12–T18) are the engine's and stay where they are; the boot-path assertion in `host-integration.spec.ts` pins the count at one so a second one cannot appear unnoticed.
- **A source this build has no word for is reported as the record stated it** (`来源:主机写的是「…」`), in the same posture as artifact slugs and package-check codes.

## Alternatives considered

- **Add an eighth tool to `RESEARCH_TOOL_DIRECTORY`.** Refused: that catalogue is the T12–T18 batch of pure pipeline tools, "exactly the seven P2 tools" is asserted in five specs and restated throughout the packages' prose, and a run-interaction door is not one of them. Growing the roster to hold it would churn a documented historical fact.
- **Let the tool record a decision as well.** Refused: `approval.ts` owns decisions, they travel the host's authenticated browser channel, and they carry the operator's principal. A model-invoked tool that could take one would attribute a decision to a person who never made it.
- **Give the conversation its own store beside the revision records.** Refused: a person's requirement already has a durable, projected, displayed home — the revision request, which names the sections it read and the body hash each one had — and a second home would be a second thing to read, to keep in step, and to explain to a researcher.
- **Default an absent `source` to `panel` on the wire.** Refused: for a record written before the field existed that inference happens to be true, but it is a fact about the build rather than about the record in front of the reader. The record's own field is required (an old file is a format this pre-release backend does not carry forward) while the twin's is optional, which is the case that is real — a host that sends none.
- **Register the tool from `dsh-research-cordis`**, which already depends on the tools package and registers the seven. Refused: it does not depend on the team package, which owns the revision store, and the run's records are not the engine's to write.

## Consequences

- **A model can put words into the record, and the record says who wrote them.** The provenance is what makes that safe to ship: the panel never presents a conversation-sourced request as something the person confirmed, and the request is information — the person judges the work that answers it, and can still reject it in the panel.
- **`source` is required on the record and optional on the wire**, for the two different reasons above; a page shown a record that states none shows no badge rather than the panel's name.
- **The team package now builds a tool definition**, using `@deepseek-ai/dsh-tools`, which it already declared as a peer dependency; `defineTool` is what validates the arguments at the tool-JSON boundary, so the boundary is not hand-rolled.
- **Every test harness that mounts this service needed a `tools.register` stand-in** — six of them: five process fixtures and one integration harness. That is the visible cost of a service that registers on boot, and the integration harness now fails if the tool stops registering.

## Files

- `packages/research/dsh-research-team/src/change-request-tool.ts`, `tests/change-request-tool.spec.ts` — the tool and what it cannot do.
- `packages/research/dsh-research-team/src/manuscript-revision.ts`, `tests/manuscript-revision.spec.ts` — the `source` field on the durable record.
- `packages/research/dsh-research-team/src/index.ts`, `src/types.ts`, `tests/host-integration.spec.ts` — the shared `recordRevisionRequest`, the boot registration, and the projection.
- `packages/research/dsh-research-web/src/run-source.ts`, `src/client/record-vocabulary.ts`, `src/client/workbench/RevisionPanel.tsx`, `tests/revision-panel.dom.spec.ts` — the twin, the words, and the badge.
