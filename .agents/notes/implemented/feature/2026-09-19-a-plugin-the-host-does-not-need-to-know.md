# Agent Note: a plugin the host does not have to know about

Status: implemented

English | [中文](2026-09-19-a-plugin-the-host-does-not-need-to-know.zh.md)

## Problem

The research workbench wanted to sit beside the conversation rather than behind a tab in it, and it got there by changing the **host client core**: `conversation.aside` was added to the conversation shell's slot contract, to the client slot catalogue, and to the subsystem docs — a new slot, a new `asideRegistered` snapshot, and a new region in `ConversationRoot`. Three host-side files and thirteen modified ones, all of them existing so that ONE plugin could have a layout preference.

That is the wrong place to pay. A plugin that a host must be modified to accept is not a plugin; it is a fork, and it cannot be packaged, versioned or dropped independently. The user's ruling (2026-09-19): revert the host-side change, and make the equivalent change inside the plugin.

## Decision

- **The host-side change is reverted in full.** `packages/client/ui-conversation/**`, `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` and `docs/subsystems/slots.*` return to their committed state; the three new host files and the aside note moved to the backup rather than being deleted. `git diff` over `packages/client`, `packages/extensions` and `docs/subsystems` is empty.
- **The plugin registers where the host already offers room.** `dsh-research-web` mounts its entry in `conversation.view` — a list seat for session views that the host core already declares — with the label thunk it had before.
- **The cost is paid in the plugin and stated.** The panel is a sibling view of `chat` (order 0) and `trajectory` (order 10) rather than a column beside them, so a reader switches to it instead of reading it alongside the conversation. That is a real regression in how the panel is reached, and it is the price of not owning host code.
- **A test now refuses a seat the host does not declare.** The component suite's slot double lists only `conversation.view`, so a regression back into an undeclared seat fails there rather than after a boot.

## Alternatives considered

- **Keep `conversation.aside` and ship it as part of the research bundle.** Rejected: the slot would still be declared in the host's contract, so the host would still carry a concept that exists for one plugin, and the plugin would still not be installable on a host without it.
- **Ask the host for a generic "any plugin may add a region" mechanism.** Rejected as the same mistake with a better name: a general host facility built for a single current consumer is host code with no second user, and the repository's rule is that an abstraction needs a current owner AND a need.
- **Render the panel as an overlay from inside the plugin's own `conversation.view` entry.** Considered and not taken: an overlay would have to position itself against the shell's layout, which is the host's to own, and it would look like a column while behaving like neither a view nor a column.
- **Leave the host change and note the dependency.** Rejected: the user's goal is one packageable plugin, and a documented host dependency is still a host dependency.

## Consequences

- **Measured on a real boot (2026-09-19, port 1121):** the served plugin bundle carries `conversation.view` 16 times and `conversation.aside` **zero** times, and the root answers 200 with the research entry registered. The revert is what the browser actually receives, not only what the working tree says.
- **2767 tests pass** across `packages/research` and `packages/client/ui-conversation`; the host and client compiler faces both typeclean; seven documentation gates pass, and the research-web README pair is re-recorded.
- **What this does not do.** It does not give the plugin a right-hand column, does not add any host facility in its place, and does not touch the research-side work another session has in flight — the uncommitted changes under `dsh-research-team`, `dsh-research-cordis` and `dsh-research-core` were left exactly as they were. The whole working tree was copied to `.workbuddy/tmp/backup-20260919/working-tree.patch` before anything was reverted.

## Files

- `packages/research/dsh-research-web/src/client/index.ts` — registers into `conversation.view`, with the locale binder its label thunk needs restored.
- `packages/research/dsh-research-web/src/client/ResearchEntry.tsx`, `src/client/workbench/ResearchWorkbench.tsx` — the seat and owner-props comments now state what is true of the view seat.
- `packages/research/dsh-research-web/tests/researchview-component.dom.spec.ts` — the slot double declares only the seat the host has.
- `packages/research/dsh-research-web/README.md` / `.zh.md` — the panel's seat, corrected in both languages.
- `Start DSH.cmd` — the refusal to start on a busy port now says it is a deliberate stop rather than reading like a crash.
