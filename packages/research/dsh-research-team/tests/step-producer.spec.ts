/**
 * What produced a step, versus what the step would run under.
 *
 * THE DEFECT THIS PINS was measured on a real run package: `run-summary.md` reported D3-writing's
 * producer as the tool brand its registry entry declares, while the draft artifact beside it recorded
 * `proseSource: 'model'` through the deployment's configured route. Both statements are about the same
 * manuscript, and only one of them can be true — a reader of the package was told a model-written
 * paper came out of a table renderer.
 *
 * The step is driven through `driveStep` with a LIVE-MODEL writer (channel `llm`), which is the
 * configuration the entry's static brand cannot describe. The assertions below are about the two
 * places a step's row is read: the driver's own {@link StepOutcome} and the package's run facts,
 * which are what `run-summary.md` renders line by line.
 */

import { describe, expect, it } from 'vitest'
import {
  createRun,
  getRunSnapshot,
  getStepDefinitions,
  setRunInput,
  type ResearchRunStore,
} from '@deepseek-ai/dsh-research-core'

import { createRunContext, driveStep } from '../src/runner/drive.ts'
import { packageRunFactsOf } from '../src/runner/package-export.ts'
import { stepProjectionsOf } from '../src/runner/project-view.ts'
import { FIXED_TS, type ResearchProseWriter } from '../src/runner/registry.ts'
import type { StepOutcome } from '../src/runner/types.ts'

const DOMAIN_DIRECTION = 'adaptive traffic signal control research program'

/**
 * A writer that answers every prose step the way a model following the instruction would.
 *
 * IT CITES EVERY REVIEWED SOURCE THE REQUEST OFFERS, because D3 refuses a draft that leaves one
 * uncited — the keys travel out of the request, so the reply cites what the run actually bound rather
 * than a list this spec holds.
 *
 * @returns the writer, on the deployment's live-model route.
 */
function modelWriter(): ResearchProseWriter {
  return {
    channel: 'llm',
    write(request) {
      const keys = (request.context['citations'] as ReadonlyArray<{ readonly citeKey: string }>)
        .map(citation => `[@${citation.citeKey}]`)
        .join(' ')
      return Promise.resolve({
        text: `This section states what the run measured and nothing it did not ${keys}.`,
        provider: 'test-provider',
        model: 'test-model',
      })
    },
  }
}

/**
 * Drive the pipeline step by step, giving D3-writing the deployment's prose writer and nothing else.
 *
 * ONE STEP AT A TIME so the writer reaches D3 alone: the steps before it are the offline path, and a
 * model-written draft is what is under test rather than a model-written run.
 *
 * @returns the store the run lives in, its id, and D3's own outcome.
 */
async function driveWithModelProse(): Promise<{
  readonly store: ResearchRunStore
  readonly runId: string
  readonly d3: StepOutcome | undefined
}> {
  const store: ResearchRunStore = new Map()
  const runCtx = createRunContext(FIXED_TS)
  const runId = createRun(store)
  setRunInput(store, runId, 'domain-direction', DOMAIN_DIRECTION)
  let d3: StepOutcome | undefined
  for (const step of getStepDefinitions()) {
    const outcome = await driveStep(store, runId, step.id, step.id === 'D3-writing'
      ? { runCtx, proseWriter: modelWriter() }
      : { runCtx })
    if (step.id === 'D3-writing') {
      d3 = outcome
      // STOPPED HERE ON PURPOSE. A model-written draft is judged by the A channel on the prose this
      // writer produced, and whether that prose carries the argument is not what this spec is about —
      // the step's row is written when it COMMITS, which happens before the gate either way.
      break
    }
  }
  return { store, runId, d3 }
}

describe('a step reports the producer its own artifacts record', () => {
  it('names the model that wrote the draft, not the table tool the entry declares', async () => {
    const { store, runId, d3 } = await driveWithModelProse()

    // THE TWO STATEMENTS ARE READ TOGETHER, because the defect was exactly their disagreement: the
    // artifact says a model wrote the prose, and the step's row now names the same model rather than
    // the tool the step executed.
    const draft = getRunSnapshot(store, runId).steps['D3-writing']?.artifacts['manuscript'] as
      | { readonly proseSource?: unknown; readonly proseRoute?: { readonly producer?: unknown } }
      | undefined
    expect(draft?.proseSource).toBe('model')
    expect(draft?.proseRoute?.producer).toContain('test-provider/test-model')
    expect(d3?.producer).toBe('llm:test-provider/test-model')
    expect(d3?.producer).not.toBe('fixture:writing')
    // THE LEVEL MOVED WITH IT: the same artifact-driven resolution the kind already used.
    expect(d3?.kind).toBe('live_external')
    expect(d3?.artifacts[0]?.producedBy).toBe('llm:test-provider/test-model')

    // AND THE PACKAGE STATES THE SAME ROW, which is what `run-summary.md` is rendered from.
    const row = packageRunFactsOf(store, runId).steps.find(step => step.stepId === 'D3-writing')
    expect(row?.producer).toBe('llm:test-provider/test-model')
    expect(row?.producer).not.toBe('fixture:writing')
    // The steps that ran the offline path keep the brand their entry declares, so this is a
    // resolution rather than a replacement of every row.
    expect(packageRunFactsOf(store, runId).steps.find(step => step.stepId === 'D2-framework')?.producer)
      .toBe('fixture:framework')
  })

  it('separates what would run from what ran on the step projection a page reads', async () => {
    // THE THIRD READ OF THE SAME ROW, and the last one that conflated them. `driveStep`'s
    // `StepOutcome` and the package's run facts both resolve the producer from the artifacts; the
    // projection the browser renders took the registry entry's brand and called it `producer`, so
    // the panel reported a model-written draft as produced by the table tool the step executes —
    // the same drift, one reader further out.
    const { store, runId } = await driveWithModelProse()
    const steps = new Map(stepProjectionsOf(store, runId).map(step => [step.stepId, step]))

    expect(steps.get('D3-writing')?.producer).toBe('llm:test-provider/test-model')
    // AND THE OTHER QUESTION IS STILL ANSWERABLE: the brand the entry declares is its own field, so
    // a reader can tell what this deployment's D3 WOULD run under from what this run's D3 DID.
    expect(steps.get('D3-writing')?.declaredProducer).toBe('three-line-table@0.1.2-alpha.4')
    expect(steps.get('D3-writing')?.declaredProducer).not.toBe(steps.get('D3-writing')?.producer)

    // THE OFFLINE STEPS AGREE, and that is a resolution rather than a copy: their artifacts carry
    // the brand the entry declares, so both fields say the same thing for a different reason.
    expect(steps.get('D2-framework')?.producer).toBe('fixture:framework')
    expect(steps.get('D2-framework')?.declaredProducer).toBe('fixture:framework')

    // A STEP THAT NEVER RAN HAS NO ARTIFACTS TO READ, so it reports its declared brand in both
    // fields rather than a fabricated producer.
    expect(steps.get('E2-submit')?.producer).toBe(steps.get('E2-submit')?.declaredProducer)
  })
})
