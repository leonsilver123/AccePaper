/**
 * The research view entry: binds the workbench to a run source the caller supplies.
 *
 * The workbench renders whatever summary it is handed; this module is the only place
 * that knows how to OBTAIN one. Keeping that behind a factory means the component the
 * slot mounts closes over one run source, and the workbench itself stays free of any
 * knowledge of the Host.
 */
import { useCallback, useMemo } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { RunSummary } from '../summary.ts'
import type { ApprovalSubmitter } from './approval-source.ts'
import type { WirePlan, WireProposalAnswer } from './direction-source.ts'
import { ResearchWorkbench } from './workbench/ResearchWorkbench.tsx'

/** Resolve the summary for one real run, or reject with why it could not be produced. */
export type ResearchRunSource = (plan?: WirePlan) => Promise<RunSummary>

/** Ask the host for research directions within a field, or reject with why it could not. */
export type ResearchProposalSource = (field: string) => Promise<WireProposalAnswer>

/**
 * Build the slot component bound to one run source and one approval endpoint.
 *
 * @param run - starts a run and resolves with its summary.
 * @param approve - submits one human-gate decision to the backend. Omitted when this
 *   deployment serves no authenticated approval endpoint, which disables the panel's buttons.
 * @param propose - asks the host for research directions. Omitted when this deployment reaches no
 *   model, in which case the run control starts the default plan without opening a dialog.
 * @returns a conversation-view component that renders the research workbench.
 */
export function researchViewWith(
  run: ResearchRunSource,
  approve?: ApprovalSubmitter,
  propose?: ResearchProposalSource,
) {
  return function ResearchViewBound(props: ConvViewProps & PropsLocale<'research'>) {
    const onRun = useCallback(run, [run])
    // Undefined when this deployment reaches no model: the workbench then starts the default plan
    // instead of opening a dialog it could only fail to fill.
    const onPropose = useMemo(
      () => (propose === undefined ? undefined : (field: string) => propose(field)),
      [propose],
    )
    return (
      <ResearchWorkbench
        {...props}
        onRun={onRun}
        {...(onPropose === undefined ? {} : { onPropose })}
        {...approve === undefined ? {} : { onApprove: approve }}
      />
    )
  }
}
