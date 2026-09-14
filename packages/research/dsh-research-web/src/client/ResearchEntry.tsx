/**
 * The research view entry: binds the workbench to a run source the caller supplies.
 *
 * The workbench renders whatever summary it is handed; this module is the only place
 * that knows how to OBTAIN one. Keeping that behind a factory means the component the
 * slot mounts closes over one run source, and the workbench itself stays free of any
 * knowledge of the Host.
 */
import { useCallback } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RunSummary } from '../summary.ts'
import { ResearchWorkbench } from './workbench/ResearchWorkbench.tsx'

/** Resolve the summary for one real run, or reject with why it could not be produced. */
export type ResearchRunSource = () => Promise<RunSummary>

/**
 * Build the slot component bound to one run source.
 *
 * @param run - starts a run and resolves with its summary.
 * @returns a conversation-view component that renders the research workbench.
 */
export function researchViewWith(run: ResearchRunSource) {
  return function ResearchViewBound(props: ConvViewProps & PropsLocale<'research'>) {
    const onRun = useCallback(run, [run])
    return <ResearchWorkbench {...props} onRun={onRun} />
  }
}
