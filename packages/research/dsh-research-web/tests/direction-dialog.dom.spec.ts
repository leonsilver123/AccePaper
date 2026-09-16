// @vitest-environment jsdom
/**
 * Component-level DOM acceptance for the run dialog (S3).
 *
 * Integration-verified only: it mounts the real components and asserts on the produced DOM with
 * `@testing-library/react`, with no running server behind them. What it pins is the dialog's whole
 * reason to exist — a run is started under a plan a PERSON confirmed, and the page must not be able
 * to say otherwise. So the assertions are about identity, not about appearance: the plan the host
 * receives is the plan the dialog showed, the criterion is rendered from the plan's own declared
 * commitment rather than from a description of it, and a proposal request that failed starts
 * nothing.
 *
 * It also covers the path where a host can propose nothing: the run control must still run, rather
 * than opening a dialog that could only ever fail.
 */

import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import { en } from '../src/client/locales.ts'
import type { ResearchT } from '../src/client/locales.ts'
import type { WirePlan, WireProposalAnswer } from '../src/client/direction-source.ts'
import { ResearchWorkbench } from '../src/client/workbench/ResearchWorkbench.tsx'

afterEach(cleanup)

/** Translate over the real English dictionary, with `{name}` interpolation as the runtime does. */
const t = ((key: string, params?: Record<string, unknown>): string => {
  const template = (en as Record<string, string>)[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/gu, (_, name: string) => {
    const value = params[name]
    return typeof value === 'string' || typeof value === 'number' ? String(value) : `{${name}}`
  })
}) as ResearchT

/** A plan a proposal would confirm, in the shape the wire carries. */
function plan(over: Partial<WirePlan> = {}): WirePlan {
  return {
    title: 'Ahead-of-Time Prediction in Mixed Platoons',
    field: 'road transport safety',
    direction: 'predictive look-ahead for autonomous following',
    outline: [{ id: 'abstract', heading: 'Abstract' }],
    claim: {
      id: 'claim-predictive-look-ahead',
      ref: 'An AV that predicts its leader raises the platoon minimum time-to-collision.',
      assertion: 'An AV that predicts its leader raises the platoon minimum time-to-collision.',
      essentialDifference: '',
      experimentToFalsify: '',
      prediction: 'the HV-AV-HV platoon shall exceed the all-HV platoon in minimum time-to-collision by at least 25%',
    },
    metric: { key: 'min-ttc-seconds', label: "the platoon's minimum time-to-collision (s)", direction: 'higher-is-better', phrases: [] },
    commitment: { direction: 'increase', bound: 'at-least', thresholdPct: 25 },
    ...over,
  }
}

/** One answer carrying `proposals`, and `refusals` when the test wants them. */
function answer(proposals: ReadonlyArray<WirePlan>, refusals: number = 0): WireProposalAnswer {
  return {
    proposals: proposals.map(candidate => ({
      plan: candidate,
      title: candidate.title,
      direction: candidate.direction,
      claim: candidate.claim.ref,
    })),
    refusals: Array.from({ length: refusals }, (_, index) => ({
      reason: `refusal ${String(index)}`,
      block: 'TITLE: something unusable',
    })),
    channel: 'llm',
  }
}

/**
 * Open the dialog from the run control and ask for proposals in `field`.
 * @param field - the domain to type into the dialog.
 */
async function open(field: string): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: en['run.action'] }))
  fireEvent.change(screen.getByLabelText(en['propose.fieldLabel']), { target: { value: field } })
  fireEvent.click(screen.getByRole('button', { name: en['propose.ask'] }))
  await waitFor(() => { expect(screen.queryByText(en['propose.asking'])).toBeNull() })
}

describe('the run dialog', () => {
  it('asks for the field before it runs anything, and passes it on', async () => {
    const onRun = vi.fn(async () => { throw new Error('unreachable') })
    const onPropose = vi.fn(async () => answer([plan()]))
    render(createElement(ResearchWorkbench, { t, onRun, onPropose }))

    fireEvent.click(screen.getByRole('button', { name: en['run.action'] }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    // Nothing has run: the dialog exists so the run's subject is chosen, not discovered.
    expect(onRun).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText(en['propose.fieldLabel']), { target: { value: 'distributed systems' } })
    fireEvent.click(screen.getByRole('button', { name: en['propose.ask'] }))
    await waitFor(() => { expect(onPropose).toHaveBeenCalledWith('distributed systems') })
  })

  it('runs the plan the person confirmed, unchanged', async () => {
    // The load-bearing assertion of this whole stage: the host receives the plan the dialog showed.
    const ran: WirePlan[] = []
    const chosen = plan()
    const other = plan({ title: 'A Second Direction', claim: { ...chosen.claim, id: 'claim-second' } })
    render(createElement(ResearchWorkbench, {
      t,
      onRun: async (confirmed) => { if (confirmed !== undefined) ran.push(confirmed); throw new Error('stop after capture') },
      onPropose: async () => answer([chosen, other]),
    }))
    await open('road transport safety')

    fireEvent.click(screen.getAllByRole('radio')[1])
    fireEvent.click(screen.getByRole('button', { name: en['propose.confirm'] }))
    await waitFor(() => { expect(ran).toHaveLength(1) })
    expect(ran[0]).toEqual(other)
  })

  it('renders the criterion from the plan\'s own commitment', async () => {
    // Not from a sentence the host composed: UI copy is locale-owned, and the number and bound a
    // person confirms have to be the ones the run will be graded against.
    const onRun = vi.fn(async () => { throw new Error('unreachable') })
    render(createElement(ResearchWorkbench, { t, onRun, onPropose: async () => answer([plan()]) }))
    await open('road transport safety')

    const criterion = document.querySelector('[data-research-criterion]')
    expect(criterion?.textContent).toContain('25')
    expect(criterion?.textContent).toContain(en['propose.bound.atLeast'])
    expect(criterion?.textContent).toContain('minimum time-to-collision')
  })

  it('shows what the model proposed, and states the channel it came from', async () => {
    const onRun = vi.fn(async () => { throw new Error('unreachable') })
    render(createElement(ResearchWorkbench, { t, onRun, onPropose: async () => answer([plan()]) }))
    await open('road transport safety')

    const list = document.querySelector('[data-research-proposals]')
    expect(list?.textContent).toContain('Ahead-of-Time Prediction in Mixed Platoons')
    expect(list?.textContent).toContain('predictive look-ahead for autonomous following')
    expect(document.querySelector('[data-research-channel]')?.textContent)
      .toContain(en['propose.channel.llm'])
  })

  it('reports refusals, and distinguishes them from an answer that proposed nothing', async () => {
    const onRun = vi.fn(async () => { throw new Error('unreachable') })
    const refused = answer([plan()], 2)
    render(createElement(ResearchWorkbench, { t, onRun, onPropose: async () => refused }))
    await open('road transport safety')
    expect(document.querySelector('[data-research-refusals]')?.textContent).toContain('2')

    cleanup()
    const empty = answer([], 0)
    render(createElement(ResearchWorkbench, { t, onRun, onPropose: async () => empty }))
    await open('road transport safety')
    expect(screen.getByText(en['propose.none'])).toBeTruthy()
    expect(document.querySelector('[data-research-refusals]')).toBeNull()
    // With nothing to confirm, the confirm control cannot start a run.
    expect(screen.getByRole<HTMLButtonElement>('button', { name: en['propose.confirm'] }).disabled).toBe(true)
  })

  it('reports a failed proposal request and starts nothing', async () => {
    const onRun = vi.fn(async () => { throw new Error('unreachable') })
    render(createElement(ResearchWorkbench, {
      t,
      onRun,
      onPropose: async () => { throw new Error('the model route refused') },
    }))
    fireEvent.click(screen.getByRole('button', { name: en['run.action'] }))
    fireEvent.click(screen.getByRole('button', { name: en['propose.ask'] }))

    await waitFor(() => {
      expect(document.querySelector('[data-research-propose-error]')?.textContent)
        .toContain('the model route refused')
    })
    // A run started here would be about something the person did not choose, labelled as their
    // choice. The dialog returns to the field step instead.
    expect(onRun).not.toHaveBeenCalled()
    expect(screen.getByLabelText(en['propose.fieldLabel'])).toBeTruthy()
  })

  it('closes without running when cancelled', async () => {
    const onRun = vi.fn(async () => { throw new Error('unreachable') })
    render(createElement(ResearchWorkbench, { t, onRun, onPropose: async () => answer([plan()]) }))
    fireEvent.click(screen.getByRole('button', { name: en['run.action'] }))
    fireEvent.click(screen.getByRole('button', { name: en['propose.cancel'] }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onRun).not.toHaveBeenCalled()
  })

  it('runs the default directly when the host cannot propose', async () => {
    // A deployment that reaches no model has nothing to ask with. Opening a dialog that could only
    // fail would leave a person with no way to start a run at all.
    const onRun = vi.fn(async () => { throw new Error('stop here') })
    render(createElement(ResearchWorkbench, { t, onRun }))
    fireEvent.click(screen.getByRole('button', { name: en['run.action'] }))
    await waitFor(() => { expect(onRun).toHaveBeenCalledTimes(1) })
    // No plan, because a host that cannot propose has none to offer — and a place to report
    // snapshots, which the page uses to follow the run it just started.
    const [plan, onUpdate] = onRun.mock.calls[0] as unknown as [unknown, unknown]
    expect(plan).toBeUndefined()
    expect(typeof onUpdate).toBe('function')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
