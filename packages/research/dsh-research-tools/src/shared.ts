// @deepseek-ai/dsh-research-tools — shared tool conventions (main-Agent-owned).
//
// P2 (batch 2 wave-1) tool rules — every tool module in this package MUST:
//   1. be a PURE function of its inputs + injected adapter (no hidden IO);
//   2. never call a real model gateway or a real external literature API —
//      external services are reached ONLY through an adapter interface, and
//      this wave ships fixture/mock adapters with SYNTHETIC data only
//      (no data whose license has not been confirmed);
//   3. return a deeply-frozen artifact via {@link freezeArtifact} — no live
//      references escape the tool boundary;
//   4. NOT advance the batch-1 state machine and NOT auto-convert gate
//      outcomes (state wiring is out of scope until the T19 pre-contract,
//      see D:\1\plan\batch2-t19-hold-abstained-design.md);
//   5. reuse core logic instead of copying it (e.g. T13 must import T08
//      verifyCitation from '@deepseek-ai/dsh-research-core').
//
// The package entry (src/index.ts), the public tool registry, package.json
// exports and this file are owned by the main Agent — tool agents do not edit
// them.

/** Deep-freeze a structured-cloneable artifact (INV-IMMUTABLE, same semantics
 *  as the core engine snapshots). Non-cloneable input throws TypeError from
 *  structuredClone — tool inputs/results are plain data by contract. */
export function freezeArtifact<T>(value: T): Readonly<T> {
  const clone: T = structuredClone(value)
  return deepFreeze(clone) as Readonly<T>
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key])
    }
    Object.freeze(value)
  }
  return value
}

/** Common tool-invocation envelope carried by every tool artifact so the
 *  future T19 pipeline can attribute results without re-interpreting them. */
export interface ToolArtifactMeta {
  readonly toolId: string
  readonly version: string
  readonly producedAt: number
}
