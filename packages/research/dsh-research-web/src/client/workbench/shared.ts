/** Shared props every T27–T29 workbench sub-panel receives. */
import type { RunSummary } from '../../summary.ts'
import type { ResearchT } from '../locales.ts'

/** Common data + translate share for the workbench panels. */
export interface PanelProps {
  /** The flattened run summary (fixture or mapped snapshot). */
  readonly summary: RunSummary
  /** The `research` namespace translate. */
  readonly t: ResearchT
}
