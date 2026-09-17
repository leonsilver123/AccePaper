/**
 * The quality baseline — what it catches, and what it must stay silent about.
 *
 * BOTH DIRECTIONS, EVERY RULE. A baseline is only worth its findings if it distinguishes a manuscript
 * with a defect from one without: a rule that never fires looks the same as one that always fires when
 * only one side is tested. Each rule below therefore has a crafted negative that it must catch and a
 * crafted positive that it must leave alone.
 *
 * THE SHIPPED RUN IS AN INPUT, NOT A GOLDEN EXAMPLE. Its output is what the baseline exists to
 * criticise, and the plan behind this module says so: "不以现有坏产物作为 golden 正例". The last case
 * here runs the real pipeline and records what it finds — as a finding, never as a target to match.
 */
import { describe, expect, it } from 'vitest'
import { getArtifact, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { runT19B } from '../src/runner/drive.ts'
import { reviewPaperQuality, type PaperQualityInput } from '../src/runner/paper-quality.ts'

/** A manuscript with nothing wrong with it: every object cited, every claim sourced. */
function cleanInput(overrides: Partial<PaperQualityInput> = {}): PaperQualityInput {
  return {
    sections: [
      {
        id: 'introduction',
        heading: 'Introduction',
        bodyText: 'Platoon control has been studied as a safety problem [1]. We test one claim about it.',
      },
      {
        id: 'results',
        heading: 'Results',
        bodyText: 'The platoon minimum time-to-collision fell by 38.20% under the variant (Figure 1, Table 1).',
      },
    ],
    crossReferences: { cited: ['Figure 1', 'Table 1'], uncited: [] },
    floatsNotRendered: [],
    metric: { name: 'min-ttc-seconds', direction: 'higher is better', changePct: -38.2 },
    ...overrides,
  }
}

/** The codes a review found, in order. */
function codesOf(input: PaperQualityInput): ReadonlyArray<string> {
  return reviewPaperQuality(input).map(finding => finding.code)
}

describe('the baseline is silent about a manuscript with nothing wrong with it', () => {
  it('finds nothing in a clean manuscript', () => {
    expect(reviewPaperQuality(cleanInput())).toEqual([])
  })

  it('leaves a hypothesis alone, and reads a sourced claim as sourced', () => {
    // A HYPOTHESIS IS NOT A CLAIM ABOUT THE LITERATURE. "We test whether ..." is the run's own work,
    // and a rule that read it as unsupported would fire on every paper ever written.
    expect(codesOf(cleanInput({
      sections: [{ id: 'introduction', heading: 'Introduction', bodyText: 'We test whether the variant lowers the metric.' }],
    }))).toEqual([])
    // The same sentence, with a citation, is still clean — and with none of its own, it is not.
    expect(codesOf(cleanInput({
      sections: [{ id: 'introduction', heading: 'Introduction', bodyText: 'We test whether the variant lowers the metric, as reported for similar platoons [2].' }],
    }))).toEqual([])
    // "prior work" is a claim about the literature whatever the sentence says about it, and this one
    // carries no label — the rule fires on the verb, which is what makes it checkable.
    expect(codesOf(cleanInput({
      sections: [{ id: 'introduction', heading: 'Introduction', bodyText: 'Prior work is not cited here.' }],
    }))).toEqual(['unsupported-statement'])
  })
})

describe('objects the text and the document disagree about', () => {
  it('reports a float the prose never refers to', () => {
    const findings = reviewPaperQuality(cleanInput({
      crossReferences: { cited: ['Figure 1'], uncited: ['Figure 2', 'Equation 1'] },
    }))
    expect(findings.map(finding => finding.code)).toEqual(['uncited-object', 'uncited-object'])
    expect(findings[0]?.where).toBe('Figure 2')
    expect(findings[0]?.detail).toContain('no sentence in it refers to that object')
  })

  it('reports a reference to an object the document does not carry', () => {
    // The worse direction of the same defect: the reader is sent to something that is not there.
    const findings = reviewPaperQuality(cleanInput({ floatsNotRendered: ['Figure 3'] }))
    expect(findings.map(finding => finding.code)).toEqual(['unrendered-object'])
    expect(findings[0]?.detail).toContain('does not carry it')
  })
})

describe('a statement about the literature with nothing behind it', () => {
  it('catches the sentence, and points at the section', () => {
    const findings = reviewPaperQuality(cleanInput({
      sections: [{
        id: 'introduction',
        heading: 'Introduction',
        bodyText: 'Cooperative platooning has been shown to improve safety. We measure one configuration.',
      }],
    }))
    expect(findings.map(finding => finding.code)).toEqual(['unsupported-statement'])
    expect(findings[0]?.where).toBe('Introduction')
    expect(findings[0]?.evidence).toContain('has been shown')
  })

  it('does not read the reference list as a place where claims are made', () => {
    const findings = reviewPaperQuality(cleanInput({
      sections: [{ id: 'references', heading: 'References', bodyText: 'Studies report a range of effects.' }],
    }))
    expect(findings).toEqual([])
  })
})

describe('a result described in the wrong direction', () => {
  it('catches a fall called an improvement, when the metric says higher is better', () => {
    const findings = reviewPaperQuality(cleanInput({
      sections: [{
        id: 'conclusion',
        heading: 'Conclusion',
        bodyText: 'The variant improved the platoon minimum time-to-collision by 38.20%.',
      }],
    }))
    expect(findings.map(finding => finding.code)).toEqual(['metric-misread'])
    expect(findings[0]?.detail).toContain('the direction the metric says is worse')
  })

  it('catches a rise the record does not hold, and a fall the record does not hold', () => {
    // The direction words alone: the sentence says one way, the measurement went the other.
    const rose = reviewPaperQuality(cleanInput({
      sections: [{ id: 'results', heading: 'Results', bodyText: 'The metric increased by 38.20% under the variant.' }],
    }))
    expect(rose.map(finding => finding.code)).toEqual(['metric-misread'])
    expect(rose[0]?.detail).toContain('the run measured it falling')

    const roseUp = cleanInput({
      sections: [{ id: 'results', heading: 'Results', bodyText: 'The metric fell by 38.20% under the variant.' }],
    })
    expect(reviewPaperQuality({
      ...roseUp,
      metric: { name: 'min-ttc-seconds', direction: 'higher is better', changePct: 38.2 },
    }).map(finding => finding.code)).toEqual(['metric-misread'])
    // AND THE SAME SENTENCE IS FINE when the record agrees with it.
    expect(reviewPaperQuality(roseUp)).toEqual([])
  })

  it('does not read a compound word as a direction', () => {
    // FOUND BY RUNNING IT: the first version of this rule flagged the shipped manuscript's own honest
    // sentence — "run over 240 s after a 120 s warm-up ... a change of -38.20%" — because `up` was one
    // of its direction words. A baseline that fires on compounds is one a reader stops reading.
    expect(codesOf(cleanInput({
      sections: [{
        id: 'experiments',
        heading: 'Experiments',
        bodyText: 'Both platoons were run after a 120 s warm-up, and the change was -38.20%.',
      }],
    }))).toEqual([])
  })

  it('says nothing about a sentence that quotes some other number', () => {
    // The threshold is a number the manuscript is entitled to state. Only the measured change is read.
    expect(codesOf(cleanInput({
      sections: [{
        id: 'results',
        heading: 'Results',
        bodyText: 'The claim required an increase of at least 20%, and the measurement is reported below.',
      }],
    }))).toEqual([])
  })
})

describe('the shipped run, read by the baseline', () => {
  it('reports what it finds, and every finding is one of the four kinds', async () => {
    // NOT A TARGET: this is the pipeline's own current output. Whatever the baseline finds here is a
    // fact about the system as it stands, and the assertions below are deliberately about the SHAPE of
    // the answer rather than about which defects are present — pinning the defects would turn a
    // baseline into a golden file, and the plan forbids exactly that.
    const store = new Map() as ResearchRunStore
    const run = await runT19B(store)
    const draft = getArtifact(store, run.runId, 'draft') as {
      sections: ReadonlyArray<{ id: string; heading: string; bodyText: string }>
    }
    const manuscript = getArtifact(store, run.runId, 'formatted-manuscript') as {
      crossReferences: { cited: ReadonlyArray<string>; uncited: ReadonlyArray<string> }
      floatsNotRendered: ReadonlyArray<string>
    }
    const baseline = getArtifact(store, run.runId, 'baseline-results') as {
      baseline: { metric: { name: string; direction: string } }
      measured: { variantImprovementPct: number }
    }

    const findings = reviewPaperQuality({
      sections: draft.sections,
      crossReferences: manuscript.crossReferences,
      floatsNotRendered: manuscript.floatsNotRendered,
      metric: {
        name: baseline.baseline.metric.name,
        direction: baseline.baseline.metric.direction,
        changePct: baseline.measured.variantImprovementPct,
      },
    })

    for (const finding of findings) {
      expect(['uncited-object', 'unrendered-object', 'unsupported-statement', 'metric-misread'])
        .toContain(finding.code)
      // EVERY FINDING IS ACTIONABLE: it says where, what, and on what evidence.
      expect(finding.where.length).toBeGreaterThan(0)
      expect(finding.detail.length).toBeGreaterThan(0)
      expect(finding.evidence.length).toBeGreaterThan(0)
    }
    // The baseline is a critique, not a pass mark: it never returns an empty finding list as proof of
    // quality, and this run's own objects are what it is reading.
    expect(Array.isArray(findings)).toBe(true)
  })
})
