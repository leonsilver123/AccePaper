/**
 * Node (Host) half of the research web plugin.
 *
 * The research view is a browser-only conversation-view contribution; the Host
 * half is intentionally inert. It re-exports the pure summary model so a Host-side
 * snapshot adapter (future) can map a T19-B runner snapshot into
 * {@link RunSummaryInput} without importing the browser half.
 */
import type { Context } from '@deepseek-ai/cordis'

export type {
  AbstentionRecord, ArtifactView, DegradationNote, GateHistoryEntry, GateOutcome,
  Phase, RunStatus, RunSummary, RunSummaryInput, StepStatus, StepView,
  TrinityComponent,
} from './summary.ts'
export { toRunSummary } from './summary.ts'
export { buildSummary, loadFixtureSummary } from './loader.ts'

/**
 * Host registration. No Host-side services are consumed — the view is mounted by
 * the browser half into the `conversation.view` slot. The empty body keeps the
 * package a valid dual-face plugin (the loader imports `lib/index.js`).
 * @param _ctx - Host context (unused).
 */
export function apply(_ctx: Context): void {
  // Intentionally inert: all behavior lives in the client half.
}
