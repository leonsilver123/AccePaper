# @deepseek-ai/dsh-research-core

English | [中文](README.zh.md)

The pure-logic kernel of the AI research-paper production system: the 16-step state machine, L0 literature tiering, the citation identity chain, A/B/C gate adjudication, and the run-state snapshot store. Zero runtime dependencies, zero Cordis, unit-testable in any host.

The design premise is that **AI-generated scientific claims are untrustworthy**, so the state machine turns "recording research judgments without being able to cheat" into constraints: a single forward transitioner, a single gate adjudicator, `abstained` taking highest precedence and never upgradable to `passed`, one-shot replay protection for human approval, rollback cascading to a transitive closure, and snapshots deep-cloned then deep-frozen.

The public entry point deliberately does not export `approveHumanGate` / `transition` / `submitHumanApproval` or the mutable step singletons; human approval is reachable only through the `./host` subpath, and that subpath exposes only the restricted production entry points.

## Known Limitations and Deferred Work

- `snapshot-store.ts` has no production consumer yet: it provides atomic writes and replay protection, but no runner or team code reads it, so process-level restart recovery for a Session is still unimplemented — the substrate is ready, the wiring is not.
- The state machine records adjudications but does not produce them: the inputs to a gate verdict (L0 tiering, citation verification, the A/B/C channels) are constructed by the caller, and this package touches no network, filesystem, or clock.
- The `ResearchError` base class is also imported by sibling pure-logic modules such as the gate. This is a deliberate near-term arrangement (a shared base class, no runtime cycle); in the long run it should move to a neutral module to decouple further.

No invariant companion is published: this package's cross-module invariants are asserted directly by its own specs, and it ships no `./invariant` entry for one to accompany.
