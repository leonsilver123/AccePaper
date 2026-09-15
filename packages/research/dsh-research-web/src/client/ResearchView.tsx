/**
 * T26 conversation-view entry for the research tab: renders one run summary through
 * {@link SummaryPanel}. The run is supplied by the caller — a session with no run has
 * nothing to show here, and this view never invents one.
 */
import type {
  ConvViewProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RunSummary } from '../summary.ts'
import { SummaryPanel } from './workbench/SummaryPanel.tsx'

/** Props the conversation.view slot contributes to the research entry. */
export type ResearchViewProps = ConvViewProps & PropsLocale<'research'> & {
  /** The run to render; required, because a summary this view made up would not be a run. */
  readonly summary: RunSummary
}

/**
 * Render the research run summary (the T26 panel).
 * @param props - slot runtime props, the `research` namespace translate `t`, and the
 *   {@link RunSummary} to render.
 */
export function ResearchView({ t, summary }: ResearchViewProps) {
  return <SummaryPanel summary={summary} t={t} />
}
