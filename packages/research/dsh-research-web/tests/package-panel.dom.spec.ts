// @vitest-environment jsdom
/**
 * The package as a page renders it: which one it is, what decided that, and what a refusal says.
 *
 * THE PAGE STATES THE HOST'S FACTS. Whether a package is final is the host's decision, made from the
 * run's own records; the page renders the state and every condition it was decided from, and offers
 * the two exports. A refusal comes back as the host's own sentence — naming the condition that
 * failed — so these cases assert what the page does with an answer it did not compute.
 */
import { createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { en } from '../src/client/locales.ts'
import { toRunSummary, type DeliverableView, type RunSummaryInput } from '../src/summary.ts'
import { SummaryPanel } from '../src/client/workbench/SummaryPanel.tsx'

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

/** A summary carrying one package deliverable, as the host reports it. */
function summaryWith(pkg: DeliverableView) {
  const input: RunSummaryInput = {
    runId: 'run_package_001',
    source: 'live',
    projectRevision: 15,
    status: 'awaiting-approval',
    steps: [],
    artifacts: [],
    gates: [],
    abstentions: [],
    degradations: [],
    deliverables: [pkg],
  }
  return toRunSummary(input)
}

/** One package deliverable, draft unless a case says otherwise. */
function packageView(overrides: Partial<DeliverableView> = {}): DeliverableView {
  return {
    kind: 'package',
    files: [{ path: 'manuscript.md', bytes: 1200 }],
    revision: null,
    directory: 'H:/packages/run_package_001',
    state: 'draft',
    checks: [
      { code: 'production-evidence', passed: false, detail: 'the run was conducted under the evaluation profile' },
      { code: 'every-step-closed', passed: true, detail: 'every step the pipeline declares reached `passed`' },
    ],
    ...overrides,
  }
}

afterEach(cleanup)

describe('the summary states which package this is', () => {
  it('renders the state the host reported, with every condition it was decided from', () => {
    render(createElement(SummaryPanel, { summary: summaryWith(packageView()), t }))

    const state = document.querySelector('[data-research-package-state]')
    expect(state?.getAttribute('data-research-package-state')).toBe('draft')
    expect(state?.textContent).toContain(en['deliverables.stateDraft'])
    // BOTH conditions are on screen: a reader deciding what to do next needs the whole list, and one
    // that showed only the failure would read as the only thing wrong with the run.
    expect(document.querySelectorAll('[data-research-package-check]')).toHaveLength(2)
    expect(document.querySelector('[data-research-package-check="production-evidence"]')?.textContent)
      .toContain('evaluation profile')
  })

  it('says a final package is final, and renders no control on a host that cannot export', () => {
    render(createElement(SummaryPanel, {
      summary: summaryWith(packageView({ state: 'final', checks: [] })),
      t,
    }))
    expect(document.querySelector('[data-research-package-state]')?.getAttribute('data-research-package-state'))
      .toBe('final')
    // No export seam means no export control: a button that calls nothing is worse than no button.
    expect(document.querySelector('[data-research-package-export]')).toBeNull()
  })

  it('states no state at all when the host named none', () => {
    // A host built before the field still satisfies the wire type, and the page must not invent the
    // answer: a package shown as final on a host that never said so is the defect this guards.
    const without = packageView()
    delete (without as { state?: unknown }).state
    delete (without as { checks?: unknown }).checks
    render(createElement(SummaryPanel, {
      summary: summaryWith(without), t, onExportPackage: async () => {},
    }))
    expect(document.querySelector('[data-research-package-state]')).toBeNull()
    // The export controls are still offered: the host can write a package, it just did not say which
    // one the file on disk is.
    expect(document.querySelector('[data-research-package-export]')).not.toBeNull()
  })

  it('offers the export for a run that has no package yet', () => {
    // A study taken back from a previous process has no export recorded on it — the drive that wrote
    // one belongs to another process — and a reader on that study must still be able to ask for one.
    const input: RunSummaryInput = {
      runId: 'run_package_002', source: 'live', projectRevision: 15, status: 'awaiting-approval',
      steps: [], artifacts: [], gates: [], abstentions: [], degradations: [], deliverables: [],
    }
    render(createElement(SummaryPanel, {
      summary: toRunSummary(input), t, onExportPackage: async () => {},
    }))
    expect(document.querySelector('[data-research-package-export="draft"]')).not.toBeNull()
    expect(document.querySelector('[data-research-package-export="final"]')).not.toBeNull()
    // And the state stays unstated, because no package was reported at all.
    expect(document.querySelector('[data-research-package-state]')).toBeNull()
  })

  it('asks the host for the draft and for the final package, and renders the refusal it answers with', async () => {
    const calls: Array<{ runId: string; mode: string }> = []
    const onExportPackage = vi.fn(async (runId: string, mode: 'draft' | 'final') => {
      calls.push({ runId, mode })
      // THE HOST'S OWN SENTENCE, which names the first condition that failed.
      if (mode === 'final') throw new Error('[final-package-refused] production-evidence: the run was conducted under the evaluation profile')
    })
    render(createElement(SummaryPanel, { summary: summaryWith(packageView()), t, onExportPackage }))

    fireEvent.click(screen.getByText(en['deliverables.exportDraft']))
    await waitFor(() => { expect(calls).toEqual([{ runId: 'run_package_001', mode: 'draft' }]) })

    fireEvent.click(screen.getByText(en['deliverables.exportFinal']))
    await waitFor(() => {
      expect(document.querySelector('[data-research-package-error]')?.textContent)
        .toContain('final-package-refused')
    })
    // The refusal is shown BESIDE the files that are still there, not instead of them.
    expect(document.querySelector('[data-research-package-check="production-evidence"]')).not.toBeNull()
  })
})
