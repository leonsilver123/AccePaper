// @vitest-environment jsdom
/**
 * The quality panel: what a package's baseline found, and WHAT IT COULD READ.
 *
 * THE REVIEW'S R04 IS THE REASON THIS PANEL EXISTS, and the reason it is three lists rather than one.
 * `qualityFindings: []` is the output of the rules that could read the manuscript; a page that showed
 * it alone would tell a reader the paper is fine while a rule whose input the manuscript does not
 * carry never ran at all. So these cases drive both directions — a report with findings, and an empty
 * one whose checks are mostly `not-applicable` — and assert the coverage is on the page in both.
 */
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { QualityPanel } from '../src/client/workbench/QualityPanel.tsx'
import { toRunSummary } from '../src/summary.ts'
import type { RunSummaryInput } from '../src/summary.ts'
import type { PaperQualityReportView } from '../src/summary.ts'
import { en } from '../src/client/locales.ts'

/** Translate double over a plain dictionary (first hit wins, `{name}` interpolated). */
function makeTranslate(dict: Record<string, string>) {
  return (key: string, params?: Record<string, unknown>): string => {
    const template = dict[key] ?? key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/gu, (match, name: string) =>
      (name in params ? String(params[name]) : match))
  }
}

afterEach(cleanup)

const t = makeTranslate(en)

/** The fixture run, with a package whose manifest carried this quality report. */
function withQuality(quality: PaperQualityReportView): RunSummaryInput {
  return {
    runId: 'run_quality_001',
    source: 'live',
    projectRevision: 12,
    status: 'awaiting-approval',
    steps: [],
    artifacts: [],
    gates: [],
    abstentions: [],
    degradations: [],
    deliverables: [{
      kind: 'package',
      files: [{ path: 'manuscript.md', bytes: 100 }],
      revision: null,
      // THE PACKAGE STATE, not the artifact slug — this file says nothing about the state.
      state: 'draft',
      quality,
    }],
  }
}

/** A report whose rules could mostly not read the manuscript. */
const SILENT: PaperQualityReportView = {
  findings: [],
  checks: [
    { code: 'uncited-object', asks: 'does the text refer to every object', outcome: 'no-defect-found' },
    {
      code: 'metric-misread',
      asks: 'does a sentence quoting the change describe its direction',
      outcome: 'not-applicable',
      reason: 'no sentence states the change the run measured, so the rule had no claim to read',
    },
    {
      code: 'no-literature-position',
      asks: 'does a document that carries a bibliography use it',
      outcome: 'not-applicable',
      reason: 'the document carries no bibliography',
    },
  ],
  needsDomainReview: [{ id: 'claim-worth-testing', asks: 'is this claim worth testing' }],
  summary: 'no defect found by the 1 check(s) that could read this manuscript; 2 check(s) could not'
    + ' run, and 1 question(s) need a domain reviewer',
}

/** A report that found something, with the object it is about named. */
const DEFECTIVE: PaperQualityReportView = {
  findings: [{
    code: 'uncited-object',
    where: 'Figure 2',
    detail: 'the manuscript carries Figure 2 and no sentence in it refers to that object',
    evidence: 'uncited: Figure 2',
  }],
  checks: [
    { code: 'uncited-object', asks: 'does the text refer to every object', outcome: 'defect-found' },
    { code: 'metric-misread', asks: 'does a sentence quoting the change describe its direction', outcome: 'no-defect-found' },
  ],
  needsDomainReview: [{ id: 'figure-legibility', asks: 'are the figures legible' }],
  summary: '1 defect(s) in 2 check(s) that could read this manuscript, 0 that could not, and 1'
    + ' question(s) for a domain reviewer',
}

describe('a package whose baseline reported nothing', () => {
  it('renders the coverage beside the empty finding list, not instead of it', () => {
    // THE READING THIS PANEL PREVENTS: an empty list rendered alone says "the paper is fine".
    render(createElement(QualityPanel, { t, summary: toRunSummary(withQuality(SILENT)) }))

    // The report's own sentence, verbatim, is on the page.
    expect(screen.getByText(/2 check\(s\) could not run/)).toBeTruthy()
    // Every check is listed with what it could say...
    expect(screen.getAllByText(en['quality.outcome.not-applicable']).length).toBe(2)
    expect(screen.getByText(en['quality.outcome.no-defect-found'])).toBeTruthy()
    // ...and the reason it could not answer is shown, because that is what a reader acts on.
    expect(screen.getByText(/no sentence states the change the run measured/)).toBeTruthy()
    expect(screen.getByText(/carries no bibliography/)).toBeTruthy()
    // The questions a person has to answer are named, not left to the silence.
    expect(screen.getByText(en['quality.domainReview'])).toBeTruthy()
    expect(screen.getByText(/is this claim worth testing/)).toBeTruthy()
  })

  it('names each check and its outcome on the element, for the reading of a real page', () => {
    // THE BROWSER ACCEPTANCE READS THIS PANEL AGAINST THE MANIFEST the deployment wrote, and it can
    // only do that if the outcome is on the element: a list of outcome labels in innerText would be
    // read in whatever order the copy happened to be in. These attributes are the panel's contract
    // with that probe, so a refactor that drops one has to fail here.
    const { container } = render(createElement(QualityPanel, { t, summary: toRunSummary(withQuality(SILENT)) }))

    const checks = [...container.querySelectorAll('[data-research-quality-check]')]
    expect(checks.map(el => el.getAttribute('data-research-quality-check')))
      .toEqual(['uncited-object', 'metric-misread', 'no-literature-position'])
    expect(checks.map(el => el.getAttribute('data-research-quality-outcome')))
      .toEqual(['no-defect-found', 'not-applicable', 'not-applicable'])
    expect(container.querySelector('[data-research-quality]')?.getAttribute('data-research-quality'))
      .toBe('report')
    expect([...container.querySelectorAll('[data-research-quality-domain]')]
      .map(el => el.getAttribute('data-research-quality-domain'))).toEqual(['claim-worth-testing'])
  })

  it('marks the finding with the code it was reported under', () => {
    const { container } = render(createElement(QualityPanel, { t, summary: toRunSummary(withQuality(DEFECTIVE)) }))

    expect([...container.querySelectorAll('[data-research-quality-finding]')]
      .map(el => el.getAttribute('data-research-quality-finding'))).toEqual(['uncited-object'])
  })
})

describe('a package whose baseline found something', () => {
  it('names the object and shows the evidence the finding rests on', () => {
    render(createElement(QualityPanel, { t, summary: toRunSummary(withQuality(DEFECTIVE)) }))

    // WHERE the problem is, in the paper's own vocabulary: the label the manuscript prints, so a
    // reader goes and looks at the thing rather than at a line in a file they do not have.
    expect(screen.getAllByText(/Figure 2/).length).toBeGreaterThan(0)
    // WHAT the rule found, and the text it rests on.
    expect(screen.getByText(/no sentence in it refers to that object/)).toBeTruthy()
    expect(screen.getByText(/uncited: Figure 2/)).toBeTruthy()
    expect(screen.getByText(en['quality.outcome.defect-found'])).toBeTruthy()
  })
})

describe('a run that has exported no package', () => {
  it('says there is no report rather than reporting no findings', () => {
    // "NOT EXPORTED" AND "NO PROBLEMS" ARE DIFFERENT FACTS, and a panel that rendered the second for
    // the first would clear a manuscript nobody had looked at.
    render(createElement(QualityPanel, {
      t,
      summary: toRunSummary({
        runId: 'run_quality_002', source: 'live', projectRevision: 12, status: 'running',
        steps: [], artifacts: [], gates: [], abstentions: [], degradations: [], deliverables: [],
      }),
    }))
    expect(screen.getByText(en['quality.noPackage'])).toBeTruthy()
    expect(screen.queryByText(en['quality.noFindings'])).toBeNull()
  })
})
