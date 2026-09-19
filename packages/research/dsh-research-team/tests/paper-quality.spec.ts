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
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { getArtifact, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { runT19B } from '../src/runner/drive.ts'
import { loadCasePack, planCasePackInputs } from '../src/runner/case-pack.ts'
import {
  DOMAIN_REVIEW_ITEMS, QUALITY_RULES, reportPaperQuality, reviewPaperQuality,
} from '../src/runner/paper-quality.ts'
import type { PaperQualityInput } from '../src/runner/paper-quality.ts'

/** A SECOND TASK: the same study, a claim that commits to a decrease. Synthetic, test-owned. */
const DECREASE_PACK_DIR = fileURLToPath(new URL('./fixtures/case-pack-decrease', import.meta.url))

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
    // ZERO BY DEFAULT, so a case about one rule is not also a case about the bibliography: the
    // crafted sections below are about objects, statements and directions, and a fixture that
    // accidentally carried references would have every such case failing for a second reason.
    referenceCount: 0,
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

describe('a bibliography the prose never uses', () => {
  it('catches a manuscript that carries references and cites none', () => {
    const findings = reviewPaperQuality(cleanInput({
      referenceCount: 2,
      sections: [
        { id: 'introduction', heading: 'Introduction', bodyText: 'We test one claim about platoon control.' },
        { id: 'references', heading: 'References', bodyText: '[1] Someone. A paper. 2001.' },
      ],
    }))
    expect(findings.map(finding => finding.code)).toEqual(['no-literature-position'])
    expect(findings[0]?.detail).toContain('never says what it builds on')
  })

  it('is silent when the text cites, and silent when there is nothing to cite', () => {
    // A citation anywhere in the body answers it; a document with no bibliography at all is a
    // different fact — it has nothing to fail to use.
    expect(codesOf(cleanInput())).toEqual([])
    expect(codesOf(cleanInput({ referenceCount: 0 }))).toEqual([])
    // ...and a bibliography the text DOES use is clean, which is what makes the rule a rule.
    expect(codesOf(cleanInput({
      referenceCount: 1,
      sections: [{ id: 'introduction', heading: 'Introduction', bodyText: 'Platoon control has been studied [1].' }],
    }))).toEqual([])
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

describe('the same baseline on a different research task', () => {
  it('reads a study whose claim commits to the opposite direction, and finds its own defects there', async () => {
    // A DIFFERENT TASK, THE SAME MEASUREMENT. What the C gate grades is the claim's DECLARED
    // commitment, not its prose — the plan's own note records four audit rounds dismantling a prose
    // reader. So a task that commits to a DECREASE is satisfied by the very −38.20% that the shipped
    // task is refuted by, and the pipeline should report support instead of a refutation.
    //
    // WHY THIS IS THE MULTI-TASK HALF OF Q00: a baseline proved only on the one manuscript it was
    // written beside is a baseline tuned to that manuscript. Running it against a run that ends with
    // the opposite verdict is what shows the rules read the records rather than the expected answer.
    const store = new Map() as ResearchRunStore
    // ITS OWN PACK, because the commitment the C gate grades is read from the pack the run is given —
    // an injected value is not the task. Everything else in the copy is the shipped study, so the
    // measurement is identical and only the claim differs.
    const pack = loadCasePack(DECREASE_PACK_DIR)
    const inputs = planCasePackInputs(pack)
    const run = await runT19B(store, { casePackInputs: inputs })
    const mvp = getArtifact(store, run.runId, 'mvp-results') as {
      outcome: { supportsPrediction: boolean; verdict: string }
      observed: { improvementPct: number }
    }
    // THE SAME NUMBERS, THE OPPOSITE VERDICT: the measurement did not change, the commitment did.
    expect(mvp.observed.improvementPct).toBeLessThan(0)
    expect(mvp.outcome.supportsPrediction).toBe(true)

    // AND THE BASELINE READS THIS MANUSCRIPT TOO — the same rules, applied to a run that ended the
    // other way, still finding what is actually wrong with the document rather than what the shipped
    // task's answer looks like.
    const draft = getArtifact(store, run.runId, 'manuscript') as {
      sections: ReadonlyArray<{ id: string; heading: string; bodyText: string }>
    }
    const manuscript = getArtifact(store, run.runId, 'typeset') as {
      crossReferences: { cited: ReadonlyArray<string>; uncited: ReadonlyArray<string> }
      floatsNotRendered: ReadonlyArray<string>
      manuscriptCounts: { references: number }
    }
    const baseline = getArtifact(store, run.runId, 'baseline-results') as {
      baseline: { metric: { name: string; direction: string } }
      measured: { variantImprovementPct: number }
    }
    const findings = reviewPaperQuality({
      sections: draft.sections,
      crossReferences: manuscript.crossReferences,
      floatsNotRendered: manuscript.floatsNotRendered,
      referenceCount: manuscript.manuscriptCounts.references,
      metric: {
        name: baseline.baseline.metric.name,
        direction: baseline.baseline.metric.direction,
        changePct: baseline.measured.variantImprovementPct,
      },
    })
    const codes = ['uncited-object', 'unrendered-object', 'unsupported-statement', 'metric-misread', 'no-literature-position']
    for (const finding of findings) expect(codes).toContain(finding.code)
    // AND IT FINDS NOTHING HERE EITHER, which is the reading to keep on both tasks: the manuscript of
    // THIS run names its floats and cites its sources, so the rules that reported six unreferenced
    // objects and no literature position on the pipeline's earlier output now report neither — on a
    // run whose verdict is the opposite of the shipped one. The rules' directions are pinned by the
    // fixtures above; this is the same baseline reading a second task's real output and staying quiet
    // because there is nothing to say.
    expect(findings).toEqual([])
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
    const draft = getArtifact(store, run.runId, 'manuscript') as {
      sections: ReadonlyArray<{ id: string; heading: string; bodyText: string }>
    }
    const manuscript = getArtifact(store, run.runId, 'typeset') as {
      crossReferences: { cited: ReadonlyArray<string>; uncited: ReadonlyArray<string> }
      floatsNotRendered: ReadonlyArray<string>
      manuscriptCounts: { references: number }
    }
    const baseline = getArtifact(store, run.runId, 'baseline-results') as {
      baseline: { metric: { name: string; direction: string } }
      measured: { variantImprovementPct: number }
    }

    const findings = reviewPaperQuality({
      sections: draft.sections,
      crossReferences: manuscript.crossReferences,
      floatsNotRendered: manuscript.floatsNotRendered,
      referenceCount: manuscript.manuscriptCounts.references,
      metric: {
        name: baseline.baseline.metric.name,
        direction: baseline.baseline.metric.direction,
        changePct: baseline.measured.variantImprovementPct,
      },
    })

    for (const finding of findings) {
      expect(['uncited-object', 'unrendered-object', 'unsupported-statement', 'metric-misread', 'no-literature-position'])
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

describe('the result is reported with what could be read', () => {
  // THE REVIEW'S R04. `qualityFindings: []` is the output of a handful of exact comparisons, and a
  // reader takes it for a verdict on the paper. The three states it collapses are different facts —
  // a rule that read the manuscript and found nothing, one that had nothing to read, and one that
  // never ran — and a domain reviewer's questions are not this baseline's silence either.

  it('says which rules read the manuscript and which had nothing to read', () => {
    const report = reportPaperQuality(cleanInput())
    expect(report.findings).toEqual([])
    expect(report.checks.map(check => check.code))
      .toEqual(QUALITY_RULES.map(rule => rule.code))
    const byCode = new Map(report.checks.map(check => [check.code, check]))
    // READ: the fixture cites every object it carries, and its one statement about prior work is
    // sourced.
    expect(byCode.get('uncited-object')?.outcome).toBe('no-defect-found')
    expect(byCode.get('unsupported-statement')?.outcome).toBe('no-defect-found')
    // NOT APPLICABLE, and each says why: this fixture carries no bibliography, and its Metric sentence
    // quotes the change — so the difference below is a difference in what was READ, not in agreement.
    expect(byCode.get('no-literature-position')?.outcome).toBe('not-applicable')
    expect(byCode.get('no-literature-position')?.reason).toContain('no bibliography')
  })

  it('separates a manuscript that agrees from one the misreading rule could not read', () => {
    // THE DIFFERENCE THIS UNIT EXISTS FOR. Both reports have no findings; one had a sentence quoting
    // the measured change to read, and the other did not.
    const agreed = reportPaperQuality(cleanInput())
    const unread = reportPaperQuality(cleanInput({
      sections: [{ id: 'results', heading: 'Results', bodyText: 'The variant is compared in Figure 1.' }],
      crossReferences: { cited: ['Figure 1'], uncited: [] },
    }))
    expect(agreed.findings).toEqual([])
    expect(unread.findings).toEqual([])
    expect(agreed.checks.find(check => check.code === 'metric-misread')?.outcome).toBe('no-defect-found')
    const silent = unread.checks.find(check => check.code === 'metric-misread')
    expect(silent?.outcome).toBe('not-applicable')
    expect(silent?.reason).toContain('no sentence states the change')
    // ...and the summaries differ, so a reader of a package cannot read the two the same way.
    expect(agreed.summary).not.toBe(unread.summary)
  })

  it('reports a rule that never ran as not-executed, distinct from one that read nothing', () => {
    const empty = reportPaperQuality(cleanInput({ sections: [], crossReferences: { cited: [], uncited: [] } }))
    for (const check of empty.checks) {
      expect(check.outcome).toBe('not-executed')
      expect(check.reason).toContain('no draft')
    }
    expect(empty.summary).toContain('0 check(s) that could read')
  })

  it('names the questions a domain reviewer has to answer, whatever the checks found', () => {
    const clean = reportPaperQuality(cleanInput())
    const defective = reportPaperQuality(cleanInput({
      crossReferences: { cited: [], uncited: ['Figure 1', 'Table 1'] },
    }))
    // THE BASELINE'S BOUNDARY IS NOT A FINDING COUNT. Every item here takes a reader — whether the
    // claim is worth testing, whether a source says what the sentence claims — and it is reported
    // whether or not the exact comparisons found anything.
    expect(clean.needsDomainReview).toEqual(DOMAIN_REVIEW_ITEMS)
    expect(defective.needsDomainReview).toEqual(DOMAIN_REVIEW_ITEMS)
    for (const item of clean.needsDomainReview) {
      expect(item.id.length).toBeGreaterThan(0)
      expect(item.asks.endsWith('?') || item.asks.length > 0).toBe(true)
    }
  })

  it('states what the report is, never that the paper is good', () => {
    const clean = reportPaperQuality(cleanInput())
    const defective = reportPaperQuality(cleanInput({ floatsNotRendered: ['Figure 3'] }))
    expect(clean.summary).toContain('no defect found by the')
    expect(clean.summary).toContain('could not run')
    expect(clean.summary).toContain('domain reviewer')
    expect(defective.summary).toContain('1 defect(s)')
    // The word a reader would take as a verdict is absent from both.
    expect(clean.summary.toLowerCase()).not.toContain('the paper is')
    expect(defective.summary.toLowerCase()).not.toContain('the paper is')
  })
})
