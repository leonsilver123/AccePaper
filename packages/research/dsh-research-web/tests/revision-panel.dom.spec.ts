// @vitest-environment jsdom
/**
 * The revision loop as a page renders it: the request, the candidate's diff, and the review.
 *
 * THE PANEL HOLDS NO STATE OF ITS OWN beyond what is in flight. Every line it shows is read from the
 * host through `RevisionSource`, so these cases assert what the page does with the host's answer —
 * including the answers that are refusals.
 */
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { en } from '../src/client/locales.ts'
import { toRunSummary, type RunSummaryInput } from '../src/summary.ts'
import { RevisionPanel } from '../src/client/workbench/RevisionPanel.tsx'
import type { RevisionSource } from '../src/client/workbench/RevisionPanel.tsx'
import type { WireRevisionView } from '../src/run-source.ts'

/** Translate double over a plain dictionary (first hit wins, `{name}` interpolated). */
function makeTranslate(...dicts: ReadonlyArray<Record<string, string>>) {
  return (key: string, params?: Record<string, unknown>): string => {
    let template = key
    for (const dict of dicts) {
      const hit = dict[key]
      if (hit !== undefined) { template = hit; break }
    }
    if (!params) return template
    return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match))
  }
}

const t = makeTranslate(en)

const SUMMARY: RunSummaryInput = {
  runId: 'run_revision_001',
  source: 'live',
  projectRevision: 7,
  status: 'awaiting-approval',
  steps: [{
    stepId: 'E2-submit', index: 16, phase: 'E', name: 'Submission', status: 'gated',
    attempt: 1, humanGate: true, holdReason: 'human_gate', gateOutcomes: [],
  }],
  artifacts: [],
  gates: [],
  abstentions: [],
  degradations: [],
  deliverables: [],
}

/** One request, with whatever candidates and reviews a case needs. */
function revision(overrides: Partial<WireRevisionView> = {}): WireRevisionView {
  return {
    runId: 'run_revision_001',
    requestId: 'req-1',
    instruction: 'tighten the claim in the results',
    operator: 'authenticated-browser-operator',
    projectRevision: 7,
    requestedAt: 1,
    sections: [
      { sectionId: 'results', heading: 'Results', basisHash: 'aaa' },
      { sectionId: 'method', heading: 'Method', basisHash: 'bbb' },
    ],
    targets: ['results'],
    candidates: [],
    reviews: [],
    ...overrides,
  }
}

/** The candidate of one changed results section. */
function candidate() {
  return {
    candidateId: 'cand-1',
    writer: 'deterministic',
    createdAt: 2,
    sections: [
      {
        sectionId: 'results', heading: 'Results', changed: true,
        basisText: 'The minimum TTC fell to 12.10 s.', bodyText: 'The minimum TTC fell to 12.10 s, as measured.',
      },
      {
        sectionId: 'method', heading: 'Method', changed: false,
        basisText: 'We used the Intelligent Driver Model.', bodyText: 'We used the Intelligent Driver Model.',
      },
    ],
  }
}

/** A source whose read answers with `entries`. */
function sourceOf(entries: ReadonlyArray<WireRevisionView>): RevisionSource {
  return {
    list: vi.fn(() => Promise.resolve([...entries])),
    request: vi.fn(() => Promise.reject(new Error('not used'))),
    step: vi.fn(() => Promise.resolve(entries[0])),
  }
}

afterEach(cleanup)

describe('the revision panel reads the loop from the host', () => {
  it('shows the request, what it targets, and offers the candidate', async () => {
    const source = sourceOf([revision()])
    render(createElement(RevisionPanel, { summary: toRunSummary(SUMMARY), t, revisions: source }))

    expect(await screen.findByText('tighten the claim in the results')).toBeTruthy()
    expect(screen.getByText(new RegExp(en['revision.targets'].split('{')[0])).textContent)
      .toContain('results')
    expect(screen.getByRole('button', { name: en['revision.generate'] })).toBeTruthy()
  })

  it('offers no accept while no candidate has passed a review', async () => {
    const source = sourceOf([revision()])
    render(createElement(RevisionPanel, { summary: toRunSummary(SUMMARY), t, revisions: source }))
    await screen.findByText('tighten the claim in the results')

    // THE ACCEPT IS OFFERED ONLY AFTER A REVIEW PASSED. Before any candidate exists there is
    // nothing to accept, and the panel shows no control that would be refused.
    expect(document.querySelector('[data-research-accept]')).toBeNull()
    expect(screen.getByText(en['revision.acceptNote'])).toBeTruthy()
  })

  it('offers the accept once a review passed, and states the result from the run', async () => {
    const accepted = {
      requestId: 'req-1', candidateId: 'cand-1', operator: 'authenticated-browser-operator',
      revision: 8, manuscriptVersion: 4, acceptedAt: 3, persisted: true,
    }
    const source = sourceOf([revision({
      candidates: [candidate()],
      reviews: [{ candidateId: 'cand-1', passed: true, findings: [] }],
      acceptance: accepted,
    })])
    render(createElement(RevisionPanel, { summary: toRunSummary(SUMMARY), t, revisions: source }))

    // The receipt is rendered from the RUN's record, so a page that reloaded says the same thing as
    // the one that accepted.
    const stated = await screen.findByText(new RegExp(en['revision.accepted'].split('{')[0]))
    expect(stated.getAttribute('data-research-accepted')).toBe('cand-1')
    expect(stated.textContent).toContain('4')

    // And the control is still offered for the NEXT candidate: an acceptance publishes one version,
    // it does not end the loop.
    expect(document.querySelector('[data-research-accept]')).not.toBeNull()
  })

  it('renders both sides of every changed section, and no diff for the others', async () => {
    const source = sourceOf([revision({ candidates: [candidate()] })])
    render(createElement(RevisionPanel, { summary: toRunSummary(SUMMARY), t, revisions: source }))

    const diff = await waitFor(() => {
      const node = document.querySelector<HTMLElement>('[data-research-diff="results"]')
      if (node === null) throw new Error('no diff yet')
      return node
    })
    // BEFORE AND AFTER, both from the host: the reader is not asked to remember the old text.
    expect(within(diff).getByText('The minimum TTC fell to 12.10 s.')).toBeTruthy()
    expect(within(diff).getByText('The minimum TTC fell to 12.10 s, as measured.')).toBeTruthy()
    // A SECTION THE CANDIDATE DID NOT TOUCH IS NOT RENDERED AS A CHANGE.
    expect(document.querySelector('[data-research-diff="method"]')).toBeNull()
  })

  it('says a candidate changed nothing rather than showing an empty diff', async () => {
    const unchanged = candidate()
    const source = sourceOf([revision({
      candidates: [{ ...unchanged, sections: unchanged.sections.map(section => ({ ...section, changed: false })) }],
    })])
    render(createElement(RevisionPanel, { summary: toRunSummary(SUMMARY), t, revisions: source }))
    expect(await screen.findByText(en['revision.unchanged'])).toBeTruthy()
    expect(document.querySelector('[data-research-diff]')).toBeNull()
  })

  it('states a failed review with the check that failed', async () => {
    const source = sourceOf([revision({
      candidates: [candidate()],
      reviews: [{
        candidateId: 'cand-1',
        passed: false,
        findings: [{ check: 'numbers', passed: false, detail: 'numbers nothing in this run measured or declared: 8.42' }],
      }],
    })])
    render(createElement(RevisionPanel, { summary: toRunSummary(SUMMARY), t, revisions: source }))

    const report = await waitFor(() => {
      const node = document.querySelector<HTMLElement>('[data-research-review-report="cand-1"]')
      if (node === null) throw new Error('no report yet')
      return node
    })
    expect(report.getAttribute('data-research-review-passed')).toBe('false')
    expect(within(report).getByText(new RegExp('8.42'))).toBeTruthy()
    expect(within(report).getByText(en['revision.checkFailed'])).toBeTruthy()
  })

  it('writes a candidate through the source, and re-reads the loop', async () => {
    const source = sourceOf([revision()])
    render(createElement(RevisionPanel, { summary: toRunSummary(SUMMARY), t, revisions: source }))
    fireEvent.click(await screen.findByRole('button', { name: en['revision.generate'] }))

    await waitFor(() => { expect(source.step).toHaveBeenCalledTimes(1) })
    expect(vi.mocked(source.step).mock.calls[0]?.[0]).toMatchObject({
      runId: 'run_revision_001', requestId: 'req-1', operation: 'generate',
    })
    // The loop is re-read after the operation, so the panel shows the host's answer rather than the
    // one it hoped for.
    await waitFor(() => { expect(source.list).toHaveBeenCalledTimes(2) })
  })

  it('reports a list it could not read instead of showing no revisions', async () => {
    const source: RevisionSource = {
      list: () => Promise.reject(new Error('the deployment has no revision root')),
      request: vi.fn(), step: vi.fn(),
    }
    render(createElement(RevisionPanel, { summary: toRunSummary(SUMMARY), t, revisions: source }))

    // "You never asked" and "I could not read it" have different remedies, and one of them is not
    // "make the request again".
    const failure = await screen.findByText(new RegExp(en['revision.failed'].split('{')[0]))
    expect(failure.textContent).toContain('no revision root')
  })
})
