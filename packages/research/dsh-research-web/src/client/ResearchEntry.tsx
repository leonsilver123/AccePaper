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

/**
 * Start one real run and follow it to its end.
 *
 * `onUpdate` is called with every snapshot the host produces, starting with the first one
 * available — so the page follows a study that takes minutes instead of freezing on a promise that
 * resolves when it is over. The returned promise settles when the run stops, fails, or leaves the
 * host's records; it carries no summary, because the summaries have already been handed over.
 */
export type ResearchRunSource = (
  plan: WirePlan | undefined,
  onUpdate: (summary: RunSummary) => void,
) => Promise<void>

/** Ask the host for research directions within a field, or reject with why it could not. */
export type ResearchProposalSource = (field: string) => Promise<WireProposalAnswer>

/**
 * Pick up the run this browser was following before a reload, and follow it again.
 *
 * `onUpdate` has the same meaning it has in {@link ResearchRunSource}. Nothing to resume is not a
 * failure: a first visit resolves with no updates at all, which is what the page shows as "nothing
 * has been run in this session yet".
 */
export type ResearchResumeSource = (onUpdate: (summary: RunSummary) => void) => Promise<void>

/**
 * Build the slot component bound to one run source and one approval endpoint.
 *
 * @param run - starts a run and reports each snapshot as it is read.
 * @param approve - submits one human-gate decision to the backend. Omitted when this
 *   deployment serves no authenticated approval endpoint, which disables the panel's buttons.
 * @param propose - asks the host for research directions. Omitted when this deployment reaches no
 *   model, in which case the run control starts the default plan without opening a dialog.
 * @param resume - picks up the run this browser was following before a reload. Omitted by a host
 *   whose runs cannot be named again, in which case a reload shows no run.
 * @returns a conversation-view component that renders the research workbench.
 */
export function researchViewWith(
  run: ResearchRunSource,
  approve?: ApprovalSubmitter,
  propose?: ResearchProposalSource,
  resume?: ResearchResumeSource,
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
        {...(resume === undefined ? {} : { onResume: resume })}
        {...approve === undefined ? {} : { onApprove: approve }}
      />
    )
  }
}
