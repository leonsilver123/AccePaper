/**
 * The view's model builder.
 *
 * The view never polls a live run and never invents one: the host maps a run snapshot into
 * {@link RunSummaryInput} (see `run-source.ts`) and this turns it into the model the panels render.
 * The bundled demo run this module used to expose is gone — a package that ships a fabricated run is
 * one a caller can render by accident.
 */
import { toRunSummary, type RunSummary, type RunSummaryInput } from './summary.ts'

/**
 * Build the presentation model from a flattened run input.
 * @param input - flattened run data mapped from a host snapshot.
 * @returns the derived {@link RunSummary}.
 */
export function buildSummary(input: RunSummaryInput): RunSummary {
  return toRunSummary(input)
}
