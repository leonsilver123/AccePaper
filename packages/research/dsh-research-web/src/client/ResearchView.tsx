/**
 * T26 conversation-view entry for the research tab. Loads the MOCK run summary and
 * delegates rendering to {@link SummaryPanel}, which the T27–T29 workbench also
 * reuses as its Summary tab. The view never polls a live run.
 */
import { useMemo } from 'react'
import type {
  ConvViewProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RunSummary } from '../summary.ts'
import { loadFixtureSummary } from '../loader.ts'
import { SummaryPanel } from './workbench/SummaryPanel.tsx'

/** Props the conversation.view slot contributes to the research entry. */
export type ResearchViewProps = ConvViewProps & PropsLocale<'research'>

/**
 * Render the research run summary (the T26 panel). An optional `summary` lets a
 * parent (the T27–T29 workbench) supply a shared model; when omitted the
 * component loads the bundled fixture itself.
 * @param props - slot runtime props, the `research` namespace translate `t`, and
 *   an optional pre-loaded {@link RunSummary}.
 */
export function ResearchView({ t, summary: provided }: ResearchViewProps & { summary?: RunSummary }) {
  const summary = useMemo(
    () => provided ?? loadFixtureSummary(),
    [provided],
  )
  return <SummaryPanel summary={summary} t={t} />
}
