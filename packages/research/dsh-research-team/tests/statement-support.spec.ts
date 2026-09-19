/**
 * What a sentence's citation rests on, and what it is refused for.
 *
 * THE PIPELINE REVIEW'S SECOND CITATION GAP. `evidence-corpus.ts` records what a reviewer concluded
 * about a CLAIM, and the citation layer attached that verdict to whichever sentence cited the source —
 * so a sentence nobody had read inherited a judgement made about a different sentence. These cases
 * hold the replacement to the three outcomes the review asks for: a real source whose passage does not
 * support the sentence is refused, a reading too thin for what the sentence states abstains, and a
 * sentence that says what the evidence supports passes.
 */
import { describe, expect, it } from 'vitest'
import {
  assessStatements, checkStatementSupport,
} from '../src/runner/statement-support.ts'
import type {
  StatementAssessment, StatementSupportAssessor,
} from '../src/runner/statement-support.ts'
import { locateStatements } from '../src/runner/citation-bindings.ts'
import type { SourceJudgement } from '../src/runner/citation-bindings.ts'
import { getArtifact, getRunSnapshot, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { runT19B } from '../src/runner/drive.ts'
import { STEP_EXECUTOR_REGISTRY } from '../src/runner/registry.ts'

const CITING = 'Prior work reports that the controller holds a constant gap [@cite-10.1016/j.trb.2025.103352].'

/** The judgement about the source the sentence above cites. */
function judgement(): SourceJudgement {
  return {
    literatureRef: 'W1',
    citeKey: 'cite-10.1016/j.trb.2025.103352',
    location: 'section 3',
    quote: 'the controller maintains a constant inter-vehicle gap',
    quoteSha256: 'a'.repeat(64),
    // THE CLAIM-LEVEL VERDICT, which the sentence must NOT inherit.
    support: 'supported',
    readScope: 'full-text',
    access: 'read',
    judgedBy: 'reviewer',
  }
}

/** An assessor that answers with what a case tells it to, and records what it was asked. */
function assessor(answer: Partial<StatementAssessment>): {
  readonly assessor: StatementSupportAssessor
  readonly asked: string[]
} {
  const asked: string[] = []
  return {
    asked,
    assessor: {
      id: 'spec-assessor',
      assess(input) {
        asked.push(`${input.statement.statementId} ${input.judgement.citeKey}`)
        return Promise.resolve({
          statementId: input.statement.statementId,
          statementSha256: input.statement.textSha256,
          citeKey: input.judgement.citeKey,
          // WHAT IT READ AND WHAT IT IS: an assessment names the passage's version and the reader's,
          // because either moving makes the verdict a statement about something else.
          quoteSha256: input.judgement.quoteSha256,
          assessorVersion: 'spec-assessor',
          support: 'supported',
          readScope: 'full-text',
          basis: 'the passage states it',
          judgedBy: 'spec-assessor',
          judgedAt: '2026-09-18T00:00:00.000Z',
          ...answer,
        })
      },
    },
  }
}

const statements = locateStatements([{ id: 'introduction', bodyText: CITING }])
const one = statements[0]

describe('a claim-level verdict is not a sentence-level one', () => {
  it('refuses a sentence no assessment covers, however sound the claim verdict is', () => {
    // THE GAP ITSELF. The judgement says the source supports the CLAIM; nothing says it supports this
    // sentence, and the two are different questions.
    const refusals = checkStatementSupport([], statements, [judgement()])
    expect(refusals.map(refusal => refusal.code)).toEqual(['statement-unassessed'])
    expect(refusals[0]?.detail).toContain('supports the claim it came from')
  })

  it('passes the same sentence once it has been assessed against its own text', async () => {
    const { assessor: a } = assessor({})
    const assessed = await assessStatements(a, statements, [judgement()])
    expect(assessed).toHaveLength(1)
    expect(assessed[0]?.statementSha256).toBe(one?.textSha256)
    expect(checkStatementSupport(assessed, statements, [judgement()])).toEqual([])
  })

  it('refuses a sentence whose assessment was made about a different version of it', () => {
    // A REVISION IS A NEW QUESTION. The assessment names the sentence's version, so a rewrite leaves
    // it about text nobody read — the same rule the citation binding follows, for the same reason.
    const stale: StatementAssessment = {
      statementId: one?.statementId ?? '',
      statementSha256: 'b'.repeat(64),
      citeKey: 'cite-10.1016/j.trb.2025.103352',
      quoteSha256: judgement().quoteSha256,
      assessorVersion: 'spec-assessor',
      support: 'supported',
      readScope: 'full-text',
      basis: 'the passage states it',
      judgedBy: 'spec-assessor',
      judgedAt: '2026-09-18T00:00:00.000Z',
    }
    const refusals = checkStatementSupport([stale], statements, [judgement()])
    expect(refusals.map(refusal => refusal.code)).toEqual(['statement-unassessed'])
    expect(refusals[0]?.detail).toContain('since')
  })
})

describe('what an assessment can find, and what each finding means', () => {
  it('refuses a sentence the passage contradicts', async () => {
    const { assessor: a } = assessor({
      support: 'contradicted',
      basis: 'the passage reports the gap collapsing under the declared disturbance',
    })
    const assessed = await assessStatements(a, statements, [judgement()])
    const refusals = checkStatementSupport(assessed, statements, [judgement()])
    expect(refusals.map(refusal => refusal.code)).toEqual(['statement-contradicted'])
    expect(refusals[0]?.detail).toContain('collapsing')
  })

  it('refuses a sentence the passage does not bear on', async () => {
    // A REAL SOURCE, CORRECTLY CITED, THAT SAYS SOMETHING ELSE. This is the case the review names: the
    // DOI resolves, the passage is quoted accurately, and it is about a different question.
    const { assessor: a } = assessor({ support: 'unrelated', basis: 'the passage is about platoon formation' })
    const assessed = await assessStatements(a, statements, [judgement()])
    expect(checkStatementSupport(assessed, statements, [judgement()]).map(refusal => refusal.code))
      .toEqual(['statement-unrelated'])
  })

  it('abstains rather than passing a detailed sentence read only in an abstract', async () => {
    // AN ABSTRACT CANNOT ESTABLISH A DETAIL. The reading is honest and the verdict is `partial`: what
    // was read supports the claim's shape, not the sentence's specificity — so it is refused as
    // beyond scope, not counted as support.
    const { assessor: a } = assessor({
      support: 'partial',
      readScope: 'abstract-only',
      basis: 'the abstract states the result but not the conditions the sentence names',
    })
    const assessed = await assessStatements(a, statements, [judgement()])
    const refusals = checkStatementSupport(assessed, statements, [judgement()])
    expect(refusals.map(refusal => refusal.code)).toEqual(['statement-beyond-scope'])
    expect(refusals[0]?.detail).toContain('abstract')
  })
})

describe('assessing is asked once per sentence and source', () => {
  it('asks about each citing sentence, in document order', async () => {
    const twice = locateStatements([
      { id: 'introduction', bodyText: CITING },
      { id: 'discussion', bodyText: 'That tension is the one we measured [@cite-10.1016/j.trb.2025.103352].' },
    ])
    const { assessor: a, asked } = assessor({})
    const assessed = await assessStatements(a, twice, [judgement()])
    expect(asked).toEqual([
      'stmt-introduction-1 cite-10.1016/j.trb.2025.103352',
      'stmt-discussion-1 cite-10.1016/j.trb.2025.103352',
    ])
    // EACH SENTENCE GETS ITS OWN ASSESSMENT, carrying its own version.
    expect(new Set(assessed.map(assessment => assessment.statementSha256)).size).toBe(2)
  })

  it('does not ask again about a sentence and source it already holds', async () => {
    const { assessor: a, asked } = assessor({})
    const first = await assessStatements(a, statements, [judgement()])
    const second = await assessStatements(a, statements, [judgement()], first)
    expect(asked).toHaveLength(1)
    expect(second).toHaveLength(1)
  })

  it('asks again when the sentence has been rewritten', async () => {
    const { assessor: a, asked } = assessor({})
    const first = await assessStatements(a, statements, [judgement()])
    const rewritten = locateStatements([{
      id: 'introduction',
      bodyText: 'Earlier work settles this [@cite-10.1016/j.trb.2025.103352].',
    }])
    await assessStatements(a, rewritten, [judgement()], first)
    // TWICE, because the second version is a different sentence — carrying the first assessment over
    // is exactly the inheritance this module removes.
    expect(asked).toHaveLength(2)
  })
})

describe('a run under a deployment that reads sentences', () => {
  it('writes the sentence-level readings onto the draft, and marks each one', async () => {
    // THE PRODUCTION PATH, not the module: D3 is where the sentences exist and where an assessment can
    // be made about them, so this asserts what the run RECORDS — an empty list would say nobody read
    // them, which is the fact the review found being reported as support.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, { statementAssessor: assessor({}).assessor })
    const draft = getArtifact(store, run.runId, 'manuscript') as {
      statementAssessments?: ReadonlyArray<StatementAssessment>
    }
    expect(draft).toBeDefined()
    const assessments = draft.statementAssessments ?? []
    expect(assessments.length).toBeGreaterThan(0)
    for (const assessment of assessments) {
      expect(assessment.statementSha256).toMatch(/^[0-9a-f]{64}$/u)
      expect(assessment.basis.length).toBeGreaterThan(0)
      expect(assessment.judgedBy).toBe('spec-assessor')
    }
  })

  it('stops where a sentence cites a source the reviewer found does not support it', async () => {
    // THE REFUSAL THE REVIEW ASKS FOR: a real DOI, a passage that does not establish what the sentence
    // says, and a run that does not go on to write a manuscript with that citation in it.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, {
      statementAssessor: assessor({ support: 'contradicted', basis: 'the passage reports the opposite' }).assessor,
    })
    const d3 = run.steps.find(step => step.stepId === 'D3-writing')
    expect(d3?.status).toBe('in_progress')
    expect(d3?.executeError).toContain('statement-contradicted')
    expect(d3?.executeError).toContain('the passage reports the opposite')
    // AND NOTHING WAS PUBLISHED: no draft, so no manuscript can follow it.
    expect(getArtifact(store, run.runId, 'manuscript')).toBeUndefined()
    expect(getArtifact(store, run.runId, 'typeset')).toBeUndefined()
  })

  it('records that no sentence was read when the deployment names no assessor', async () => {
    // THE OTHER FACT, and it is not a failure: a deployment with no reviewer cannot read a passage
    // against a sentence. What it must not do is let the claim's verdict stand in for one — so the
    // draft says the list is empty and a reader can tell the two apart.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store)
    const draft = getArtifact(store, run.runId, 'manuscript') as {
      statementAssessments?: ReadonlyArray<StatementAssessment>
    }
    // ABSENT, NOT EMPTY. An empty list would mean the readings were made and found nothing — the
    // reading a consumer must not make — so the field is missing and E1 checks nothing for this run.
    expect(draft.statementAssessments).toBeUndefined()
  })
})

describe('the readings travel with the manuscript, and the policy decides', () => {
  it('carries them from the draft onto the revised draft, through D4', async () => {
    // THE BREAK THE REVIEW REPRODUCED: D4 rebuilt the revised draft without the field, so a run under
    // a deployment that HAD read every sentence arrived at E1 looking like one that could not read any.
    // This drives the production executors and asserts what the artifact between them carries.
    const store: ResearchRunStore = new Map()
    const run = await runT19B(store, { statementAssessor: assessor({}).assessor })
    // ONE DOCUMENT, ONE SLUG, TWO VERSIONS. The draft is D3's version, which the registry no longer
    // holds once D4 has republished `manuscript`; it is read where the engine keeps it, as D3's own
    // attempt. Reading the slug twice would compare the revision with itself, and this case — D4
    // rebuilding the manuscript without the readings — is the break it exists to catch.
    const draft = getRunSnapshot(store, run.runId).steps['D3-writing']?.artifacts['manuscript'] as {
      statementAssessments?: ReadonlyArray<StatementAssessment>
    }
    const revised = getArtifact(store, run.runId, 'manuscript') as {
      statementAssessments?: ReadonlyArray<StatementAssessment>
    }
    expect(draft.statementAssessments?.length ?? 0).toBeGreaterThan(0)
    expect(revised.statementAssessments?.length).toBe(draft.statementAssessments?.length)
    // AND THE RUN FINISHED: the manuscript this revision produced is the one the readings are about.
    expect(run.steps.find(step => step.stepId === 'E1-format')?.status).toBe('passed')
  })

  it('refuses at E1 when the revision arrives carrying no readings at all', async () => {
    // THE BREAK THE REVIEW FOUND, INJECTED AT THE STEP THAT CAUSED IT: the REAL D4 executor runs, and
    // what it hands on has the field removed — exactly what the shipped code did by rebuilding the
    // revised draft without it. D3's readings are sound, so nothing refuses before E1; the run under a
    // deployment that READS SENTENCES arrives at the manuscript step with no reading of it, and that
    // is refused there rather than mistaken for a deployment that cannot read.
    const store: ResearchRunStore = new Map()
    const real = STEP_EXECUTOR_REGISTRY.get('D4-rebuttal')?.executor
    expect(real).toBeDefined()
    const run = await runT19B(store, {
      statementAssessor: assessor({}).assessor,
      executorOverride: stepId => stepId !== 'D4-rebuttal' || real === undefined
        ? undefined
        : async (ctx) => {
          const produced = await real(ctx)
          const revised_ = produced['manuscript']
          if (revised_ !== null && typeof revised_ === 'object') {
            delete (revised_ as Record<string, unknown>)['statementAssessments']
          }
          return produced
        },
    })
    const d3 = run.steps.find(step => step.stepId === 'D3-writing')
    const e1 = run.steps.find(step => step.stepId === 'E1-format')
    // D3 IS SOUND — it wrote three readings and passed. What fails is the step that publishes.
    expect(d3?.status).toBe('passed')
    expect(e1?.status).toBe('in_progress')
    expect(e1?.executeError).toContain('statement-unassessed')
    expect(getArtifact(store, run.runId, 'typeset')).toBeUndefined()
  })
})

describe('an assessment is bound to the passage as well as the sentence', () => {
  it('asks again when the passage changed, even though the sentence did not', async () => {
    // THE CACHE GAP THE REVIEW MEASURED: the sentence unchanged, the source's excerpt replaced, and
    // the old verdict reused. An assessment is a reading of a pair, so either half moving makes it a
    // different question.
    const { assessor: a, asked } = assessor({})
    const first = await assessStatements(a, statements, [judgement()])
    expect(asked).toHaveLength(1)
    const corrected: SourceJudgement = { ...judgement(), quote: 'a corrected passage', quoteSha256: 'd'.repeat(64) }
    await assessStatements(a, statements, [corrected], first)
    expect(asked).toHaveLength(2)
  })

  it('asks again when the assessor changes, and not when it has not', async () => {
    const { assessor: a, asked } = assessor({})
    const first = await assessStatements(a, statements, [judgement()])
    // Same reader, same policy: nothing to ask again.
    await assessStatements({ ...a, id: 'spec-assessor' }, statements, [judgement()], first)
    expect(asked).toHaveLength(1)
    // A reader whose rules changed produces a different verdict for the same pair, so the old one is
    // not reused.
    await assessStatements({ ...a, id: 'spec-assessor', policyVersion: '2' }, statements, [judgement()], first)
    expect(asked).toHaveLength(2)
  })

  it('refuses a verdict made on a passage the source no longer holds', async () => {
    const { assessor: a } = assessor({})
    const assessed = await assessStatements(a, statements, [judgement()])
    expect(checkStatementSupport(assessed, statements, [judgement()])).toEqual([])
    const replaced: SourceJudgement = { ...judgement(), quote: 'a replaced passage', quoteSha256: 'e'.repeat(64) }
    const refusals = checkStatementSupport(assessed, statements, [replaced])
    expect(refusals.map(refusal => refusal.code)).toEqual(['statement-unassessed'])
    expect(refusals[0]?.detail).toContain('evidence that has changed')
  })
})
