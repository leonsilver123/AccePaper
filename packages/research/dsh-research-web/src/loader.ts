/**
 * Fixture/snapshot loader for the research view.
 *
 * The view never polls a live run. It renders whatever {@link RunSummaryInput}
 * an adapter hands it; for demonstration this package ships a fixture. When the
 * T19-B runner snapshot format is wired, replace {@link loadFixtureSummary} with
 * an adapter that reads the local snapshot file and maps it into
 * {@link RunSummaryInput} — the rest of the package (model + view) is unchanged.
 */
import { RESEARCH_FIXTURE } from './fixture.ts'
import { toRunSummary, type RunSummary, type RunSummaryInput } from './summary.ts'

/**
 * Build the presentation model from a flattened run input.
 * @param input - flattened run data (fixture or mapped snapshot).
 * @returns the derived {@link RunSummary}.
 */
export function buildSummary(input: RunSummaryInput): RunSummary {
  return toRunSummary(input)
}

/**
 * Load the demo run summary driven by the bundled fixture. Always returns mock
 * data — the view labels it as such.
 * @returns the demo {@link RunSummary} (MOCK).
 */
export function loadFixtureSummary(): RunSummary {
  return toRunSummary(RESEARCH_FIXTURE)
}
