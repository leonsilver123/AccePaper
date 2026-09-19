# Agent Note: The panel followed no theme and could not name every run state

Status: implemented

English | [中文](2026-09-19-the-panel-followed-no-theme-and-could-not-name-three-run-states.zh.md)

## Problem

Two defects in the research panel, both visible on screen and neither reachable by a gate.

**The panel ignored the application's theme.** Its two stylesheets, `ResearchView.module.css` and `workbench/ResearchWorkbench.module.css`, carried 161 `#rrggbb` literals and zero theme variables. The host switches dark mode by toggling `data-ds-dark-theme` on the body (`packages/client/ui-theme/src/boot-theme.ts`) and defines its palette as `--dsw-alias-*` tokens in `packages/client/ui-theme/src/styles/design-platform.css`, under the same attribute. With dark mode on, the panel kept light surfaces and fixed greys: a colour written as a hex value has one meaning and no other palette to take, while a token chosen by role has one chosen for it.

**The run list could not name every state the Host can produce.** The Host's `ResearchRunExecution` has four members, including `unreadable` — something is on disk under this id and THIS BUILD CANNOT READ IT, which is not `failed` and not absent, because a driver that threw and a snapshot written by another schema are different facts. A stored run the Host reports under that name was displayed as `the host named a state this build does not know`. The client kept its own copy of the union in `summary.ts` covering three of the four states, and a second copy of the list in `run-source.ts` covering the same three, so `RUN_EXECUTIONS.find(...) ?? null` answered `null` and `ResearchWorkbench.tsx` printed `projects.stateUnknown`. Both dictionaries carried `run.execution.unreadable` in both languages the whole time, unreachable. A dictionary entry nothing can reach is the same silence as a missing one.

## Decision

- **Every colour comes from a token, chosen by role rather than by hex value.** The panel paints `--dsw-alias-bg-module-platform`, `--dsw-alias-bg-layer-1`, `--dsw-alias-label-primary`, `--dsw-alias-label-secondary`, `--dsw-alias-border-l2`, the `--dsw-alias-state-*` family and the scrollbar pair, and it rebinds `--dsh-scrollbar-thumb` / `--dsh-scrollbar-thumb-hover` to the l2 elevation pair under the contract `ui-theme`'s `styles/scrollbar.css` owns, because the sheet scrolls and paints module surfaces.
- **Two places had to move off a colour, and both were forced by measurement rather than taste.** The amber advisory ink measured 2.58:1 on a light surface — the only sub-WCAG pair in the panel — so the run’s warning state moved from `#b25e00` on `#fff4e5` to a tinted fill (`--dsw-alias-state-warn-tertiary`) with primary-label ink (`--dsw-alias-label-primary`). And ui-cordis’s success pairing was deliberately NOT copied: `ui-cordis` paints `--dsw-alias-state-success-tertiary` (green-100) with `--dsw-alias-state-success-primary` (green-500) as the ink, which measures 2.09:1 in light; the panel uses the success fill with `--dsw-alias-label-primary`. Neutral-token borders narrowed from `1px` to the `0.5px` hairline the elevation gate requires.
- **The verification was rendered, not inferred.** An automated sweep of every visible text node in the panel found 617 nodes and 0 below the WCAG floor, in BOTH palettes. The first probe rendered the OLD palette and was caught — the profile serves the BUILT artifact, and CSS Modules are inlined at build time, so the source change was invisible until the client bundle was rebuilt.
- **The list of run states lives once, beside the union it must cover.** `summary.ts` exports `RUN_EXECUTIONS` and `run-source.ts` imports it; the second copy is deleted with a comment naming what it cost. A state added to the union without being added to the list is a TYPE error, which is the check a duplicated list could never give:
```
type MissingExecution = Exclude<RunExecution, (typeof RUN_EXECUTIONS)[number]>
const EVERY_EXECUTION_IS_LISTED: MissingExecution extends never ? true : never = true
```
- **The dictionary half is a thing a type cannot see, so a spec checks it.** `tests/run-execution-vocabulary.spec.ts` reads the list and both dictionaries and checks both directions: every state in the list has a non-empty `run.execution.<state>` entry in `en` and in `zh`, and no `run.execution.*` key exists for a state the list does not carry — compared whole and sorted, so a failure names the orphan rather than a count.

## Alternatives considered

- **Copy ui-cordis's green pairing for the panel's success surfaces.** Rejected on measurement: green-500 as ink on green-100 measures 2.09:1 in light, below the floor. Copying the neighbouring panel's pairing would have carried a contrast failure into a second surface, and the asymmetry that remains is named with the number that decided it rather than left to look like an oversight.
- **Fix only the run list rather than collapsing the twin.** Rejected: the twin is what drifted. Two copies of a union can each lag the Host independently, and the copy that lagged was not the one being read — so repairing the list would have left the next state to be missed in exactly the same way.
- **Keep the fallback text as the panel's answer for an unknown state.** Rejected: the fallback is right to exist, because a wire value this build does not know must still reach the screen. What was wrong was a state the build DOES know taking that path, which no amount of improving the fallback can fix.

## Consequences

- The panel follows the application's theme in both palettes. A colour it paints is now a role's colour, so a palette change in `ui-theme` reaches it without an edit here.
- The run list names every state the Host can produce, and `unreadable` now reads in the reader's own language instead of as an unknown state.
- A state added to the Host's union reaches the screen only after it is added to the list and to both dictionaries: the first is a compile error, the second a test failure.
- The vocabulary work is the client half of a Host union; nothing on the Host side changed, and the Host's four members are what the client must keep up with.
- The verification limit is stated rather than implied: the sweep measured the rendered page, and it was only meaningful after the client bundle was rebuilt.

## Files

- `packages/research/dsh-research-web/src/client/workbench/ResearchWorkbench.module.css` and `packages/research/dsh-research-web/src/client/ResearchView.module.css` — every colour replaced by a role's token, the two measured exceptions, and the hairline borders.
- `packages/research/dsh-research-web/src/summary.ts` — the one home of `RUN_EXECUTIONS`, the fourth member of `RunExecution`, and the `MissingExecution` exhaustiveness check.
- `packages/research/dsh-research-web/src/run-source.ts` — the second copy of the list removed.
- `packages/research/dsh-research-web/tests/run-execution-vocabulary.spec.ts` — the dictionary checked in both languages and both directions.
- `packages/research/dsh-research-web/src/client/workbench/ResearchWorkbench.tsx` — the fallback the known state used to reach.
