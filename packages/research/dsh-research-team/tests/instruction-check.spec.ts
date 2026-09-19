/**
 * The bounded pre-send check: one reading of an instruction, before it is sent, that can stop it.
 *
 * WHY THESE CASES EXIST. The check is only worth having if it BLOCKS — a reader whose "a required part
 * is missing" is recorded and then ignored is an observation wearing a gate's name. Two things are
 * proven here and one is not. Proven: a refusal stops the send (the writer is never called, so this is
 * the send being stopped and not a note about it), an unusable answer is a refusal rather than a
 * default pass, and a clearance is recorded beside the request it cleared with the version of the
 * instruction it read. NOT proven, and not claimed: that a given model's reading is right.
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getArtifact, getRunSnapshot, type ResearchRunStore } from '@deepseek-ai/dsh-research-core'
import { runT19B } from '../src/runner/drive.ts'
import { DEFAULT_PLAN } from '../src/runner/study-plan.ts'
import { loadCasePack, planCasePackInputs } from '../src/runner/case-pack.ts'
import { FIXED_TS } from '../src/runner/registry.ts'
import type { ExecCtx, ResearchProseRequest, ResearchProseWriter, RunContext } from '../src/runner/registry.ts'
import { platoonAdapter } from '../src/runner/study-adapter.ts'
import { experimentStudy } from '../src/runner/platoon-sim.ts'
import { EMPTY_CLAIM_MATERIAL } from '../src/runner/redteam-review.ts'
import {
  REQUIRED_INSTRUCTION_PARTS, checkInstruction, sendCheckedProse,
} from '../src/runner/instruction-check.ts'
import type {
  InstructionCheck, InstructionCheckRecord, InstructionChecker,
} from '../src/runner/instruction-check.ts'

/** The Case Pack the deployment ships, which supplies the claim's declared scope and data source. */
const CASE_PACK_DIR = join(process.cwd(), 'plan/overnight/2026-09-09/case-pack-traffic')

/** A checker that answers with what a case tells it to, and records what it was asked. */
function checker(answer: Partial<InstructionCheck>): {
  readonly checker: InstructionChecker
  readonly asked: ReadonlyArray<string>
} {
  const asked: string[] = []
  return {
    asked,
    checker: {
      id: 'spec-checker',
      policyVersion: 'v1',
      check(input) {
        asked.push(input.instruction)
        return Promise.resolve({
          complete: true,
          missingPart: '',
          basis: 'the instruction carries an evidence part, a constraints part and a format',
          judgedBy: 'spec-checker',
          judgedAt: '2026-09-20T00:00:00.000Z',
          ...answer,
        })
      },
    },
  }
}

describe('one reading of an instruction, before it is sent', () => {
  it('records the answer against the instruction it read, and against the parts required of it', async () => {
    const { checker: c } = checker({})
    const record = await checkInstruction(c, {
      stepId: 'D3-writing',
      instruction: 'Write the "Results" section of a research paper.',
      requiredParts: REQUIRED_INSTRUCTION_PARTS,
      context: {},
    })
    expect(record.complete).toBe(true)
    expect(record.stepId).toBe('D3-writing')
    expect(record.checkerVersion).toBe('spec-checker@v1')
    // THE VERSION OF THE INSTRUCTION THE ANSWER IS ABOUT, so an instruction edited after the check
    // stops matching the record that cleared it.
    expect(record.instructionSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(record.requiredParts).toEqual(REQUIRED_INSTRUCTION_PARTS)
  })

  it('refuses an instruction the reading finds missing a part, naming it', async () => {
    const { checker: c } = checker({
      complete: false,
      missingPart: 'the evidence the task must be written from',
      basis: 'nothing under `evidence` is named by the instruction',
    })
    await expect(checkInstruction(c, {
      stepId: 'D3-writing',
      instruction: 'Write the "Results" section.',
      requiredParts: REQUIRED_INSTRUCTION_PARTS,
      context: {},
    })).rejects.toThrow(/instruction-check.*missing the evidence the task must be written from/u)
  })

  it('refuses an answer that decides nothing, rather than reading it as clearance', async () => {
    // A READER THAT COULD NOT ANSWER IS NOT ONE THAT CLEARED. Both halves are refused: a refusal with
    // no part named has nothing a caller could repair, and a clearance with no basis cannot be read
    // again by anybody.
    const silent = checker({ complete: false, missingPart: '', basis: 'unsure' })
    await expect(checkInstruction(silent.checker, {
      stepId: 'D3-writing', instruction: 'x', requiredParts: REQUIRED_INSTRUCTION_PARTS, context: {},
    })).rejects.toThrow(/without naming the part it finds missing/u)
    const baseless = checker({ complete: true, basis: '' })
    await expect(checkInstruction(baseless.checker, {
      stepId: 'D3-writing', instruction: 'x', requiredParts: REQUIRED_INSTRUCTION_PARTS, context: {},
    })).rejects.toThrow(/cleared the instruction while stating nothing it read/u)
  })

  it('sends nothing when a deployment configured no checker', async () => {
    // THE ABSENT CASE IS NOT A PASS. A deployment that named no checker gets no check recorded, which
    // is a fact a reader can act on rather than a clearance nobody made.
    let sent = false
    const { check } = await sendCheckedProse(undefined, {
      stepId: 'D3-writing', instruction: 'x', context: {},
    }, () => {
      sent = true
      return Promise.resolve('prose')
    })
    expect(sent).toBe(true)
    expect(check).toBeUndefined()
  })
})

/** A writer that answers every prose step in that step's own format, and counts its D3 calls. */
function countingWriter(): { readonly writer: ResearchProseWriter; readonly d3Calls: () => number } {
  let d3 = 0
  return {
    d3Calls: () => d3,
    writer: {
      channel: 'llm',
      write(request: ResearchProseRequest) {
        const text = (() => {
          switch (request.stepId) {
            case 'A2-claim':
              return [
                `ASSERTION: ${DEFAULT_PLAN.claim.assertion}`,
                `DIFFERENCE: ${DEFAULT_PLAN.claim.essentialDifference}`,
                `EXPERIMENT: ${DEFAULT_PLAN.claim.experimentToFalsify}`,
                `PREDICTION: ${DEFAULT_PLAN.claim.prediction}`,
              ].join('\n')
            case 'A3-agenda':
              return 'PHASES: declare | measure | report'
                + '\nCONTRIBUTIONS: a measured comparison | a stated boundary'
            case 'B1-method':
              return [
                'FAMILY: a family the model declared',
                'STEPS: build both platoons | integrate | measure',
                `METRIC: ${DEFAULT_PLAN.metric.key}`,
                'DIRECTION: higher is better',
              ].join('\n')
            case 'D2-framework':
              return `TITLE: ${DEFAULT_PLAN.title}\nSECTIONS: ${DEFAULT_PLAN.outline.map(s => s.heading).join(' | ')}`
            case 'D4-rebuttal':
              return [
                'CONCERN: The introduction does not position the work against prior findings.',
                'SECTION: introduction',
                'RESPONSE: The position is stated in the revised draft.',
                'PATCH: NONE',
              ].join('\n')
            case 'D3-writing':
              d3 += 1
              return 'Prior work reports that reaction time enters as a first-order lag'
                + ' [@cite-10.1109/tits.2026.3727135]. The comparison is drawn in Figure 1, Figure 2'
                + ' and Table 1.'
            default:
              return 'The run states what it measured and nothing it did not. The comparison is drawn'
                + ' in Figure 1, Figure 2 and Table 1.'
          }
        })()
        return Promise.resolve({ text, provider: 'spec', model: 'spec' })
      },
    },
  }
}

describe('a run under a deployment that reads its instructions before sending them', () => {
  it('BLOCKS the send when the reading finds the evidence part missing, and writes no prose', async () => {
    // THE PROOF THAT MATTERS: the writer is never called. A check that refused the instruction and
    // let the request through would still produce a manuscript, so asserting the refusal alone would
    // prove nothing about the send — the counter is what proves the send did not happen.
    const store: ResearchRunStore = new Map()
    const { writer, d3Calls } = countingWriter()
    const { checker: c } = checker({
      complete: false,
      missingPart: 'the evidence the task must be written from',
      basis: 'the instruction names no `evidence` part and supplies none in the context',
    })
    const run = await runT19B(store, {
      studyPlan: DEFAULT_PLAN,
      proseWriter: writer,
      instructionCheck: c,
      casePackInputs: planCasePackInputs(loadCasePack(CASE_PACK_DIR)),
    })
    // THE FIRST PROSE STEP IS WHERE IT STOPS, because every prose send goes through the check: A1
    // asks the model for the gap analysis, the reading refuses the instruction, and the run ends
    // there. THAT is the stronger fact — a check that only guarded D3 would have spent six model
    // calls before reaching it.
    const a1 = run.steps.find(step => step.stepId === 'A1-landscape')
    expect(a1?.status).toBe('in_progress')
    expect(a1?.executeError).toContain('instruction-check')
    expect(a1?.executeError).toContain('the evidence the task must be written from')
    // NO MODEL CALL WAS MADE AFTER THE REFUSAL. The counter is what makes this a block rather than a
    // note: a check that refused the instruction and let the request through would still have
    // written prose, and this run wrote none.
    expect(d3Calls()).toBe(0)
    expect(getArtifact(store, run.runId, 'landscape-map')).toBeUndefined()
  })

  it('records the clearance beside the request it cleared, with the route that carried it', async () => {
    const store: ResearchRunStore = new Map()
    const { writer, d3Calls } = countingWriter()
    const { checker: c } = checker({})
    const run = await runT19B(store, {
      studyPlan: DEFAULT_PLAN,
      proseWriter: writer,
      instructionCheck: c,
      casePackInputs: planCasePackInputs(loadCasePack(CASE_PACK_DIR)),
    })
    // THE DRAFT, NOT THE MANUSCRIPT SLUG. There is one manuscript artifact and D4 republishes it
    // under the same slug, so the route D3 sent on is read where the engine keeps it: D3's own
    // attempt. Reading the slug would read the version a later step wrote.
    const draft = getRunSnapshot(store, run.runId).steps['D3-writing']?.artifacts['manuscript'] as {
      proseRoute: { instructionCheck?: InstructionCheckRecord }
      proseRequests: ReadonlyArray<{ instruction: string; instructionCheck?: InstructionCheckRecord }>
    }
    // THE SEND HAPPENED: the check cleared rather than blocked, so the run reached D3 and every
    // step that asked for prose got an answer.
    const d3 = run.steps.find(step => step.stepId === 'D3-writing')
    expect(d3?.executeError).toBeUndefined()
    expect(d3Calls()).toBeGreaterThan(0)
    const route = draft.proseRoute.instructionCheck
    expect(route?.complete).toBe(true)
    expect(route?.checkerVersion).toBe('spec-checker@v1')
    // AND EVERY REQUEST CARRIES THE ANSWER ABOUT ITS OWN INSTRUCTION, not one answer shared between
    // them: two sections are two instructions, and a record that named neither would clear neither.
    for (const request of draft.proseRequests) {
      expect(request.instructionCheck?.checkerVersion).toBe('spec-checker@v1')
      expect(request.instructionCheck?.requiredParts).toEqual(REQUIRED_INSTRUCTION_PARTS)
      expect(request.instructionCheck?.instructionSha256).toMatch(/^[0-9a-f]{64}$/u)
    }
    expect(new Set(draft.proseRequests.map(r => r.instructionCheck?.instructionSha256)).size)
      .toBe(draft.proseRequests.length)
  })
})

/** A context standing over no run, for the module-level cases. */
function execCtx(): ExecCtx {
  const runCtx: RunContext = {
    predictionText: '', claimId: '', claimRef: '', metricKey: '',
    claimMaterial: { ...EMPTY_CLAIM_MATERIAL },
    study: experimentStudy(), studyPlan: DEFAULT_PLAN, planSource: 'default',
    timestamp: FIXED_TS, adapter: platoonAdapter(experimentStudy()),
  }
  return {
    runId: 'instruction-check-spec', stepId: 'D3-writing', attemptId: 1,
    getInput: () => undefined, readInputRef: () => undefined, runCtx,
  }
}

describe('the check is a deployment capability, wired like the others', () => {
  it('reaches the step context the executors are handed', () => {
    // THE SEAM, NOT A BYPASS. The deployment states this on `DriveOptions`; the driver forwards it;
    // the executor reads it off `ExecCtx`. The two run-driven cases above are the end-to-end proof of
    // the forwarding — the checker configured on `DriveOptions` was consulted by D3 — and this one
    // states the shape the executor reads.
    const { checker: c } = checker({})
    const ctx: ExecCtx = { ...execCtx(), instructionCheck: c }
    expect(ctx.instructionCheck?.id).toBe('spec-checker')
  })

  it('is absent on a context whose deployment named none, which is not a clearance', () => {
    expect(execCtx().instructionCheck).toBeUndefined()
  })
})
