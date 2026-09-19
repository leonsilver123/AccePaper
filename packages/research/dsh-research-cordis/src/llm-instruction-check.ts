/**
 * LlmInstructionChecker — one model call that reads an instruction before it is sent, and can stop it.
 *
 * WHY THIS IS A READER AND NOT AN OPTIMISER. The request it answers is bounded: does this instruction
 * carry the evidence it must be written from, the constraints on what may be asserted, and the format
 * the reply must take. It does NOT rewrite anything. A model asked to improve an instruction produces
 * a different one every run, and this pipeline's premise is that a claim nobody can re-read is a claim
 * nobody can check — an instruction that drifts between runs is an unauditable layer between the step
 * and the text judged against it.
 *
 * IT DECIDES AND IT FAILS CLOSED. Two answers are available, `yes` and `no`, and there is no default:
 * a reply that states neither, or that refuses without naming the part it finds missing, is a FAILURE
 * rather than a clearance. That is the same posture {@link LlmReviewer} takes, and for the same
 * reason — a reader that could not answer must be visible as one that could not.
 *
 * WHAT IT READS. The instruction AND the request's context, because the parts a task requires are
 * carried in either: several steps state their evidence as request DATA (the gap analysis's papers,
 * D3's `evidence` map) and name it in the instruction only by the field it sits under. A checker shown
 * the instruction alone would refuse every one of them, which is a check that stops correct work.
 */

import type { Context } from '@deepseek-ai/cordis'

import { LlmProseWriter, type LlmProseWriterConfig } from './llm-prose-writer.ts'

/**
 * Structural twin of the runner's `InstructionCheck`.
 *
 * Declared locally rather than imported so this adapter package does not depend on the runner
 * package, the way the reviewer's twins do.
 */
export interface InstructionCheckLike {
  readonly complete: boolean
  readonly missingPart: string
  readonly basis: string
  readonly judgedBy: string
  readonly judgedAt: string
}

/** The model route this checker reads on, and the version of its rules. */
export interface LlmInstructionCheckerConfig
  extends Pick<LlmProseWriterConfig, 'provider' | 'model' | 'cwd' | 'idleTimeoutMs'> {
  /**
   * The version of the rules this checker applies, when the deployment holds them.
   *
   * Recorded on every answer and compared before one is read, so a deployment that changes what its
   * reader is asked for does not carry the old answers forward.
   */
  readonly policyVersion?: string
}

/** The verdicts an instruction may be given. Anything else is refused. */
const VERDICTS: ReadonlyArray<string> = ['yes', 'no']

/**
 * One labelled field out of a reply, or undefined when the reply does not state it.
 *
 * @param reply - the model's text.
 * @param key - the field's name.
 * @returns the field's value, or undefined when it is absent or blank.
 */
function fieldOf(reply: string, key: string): string | undefined {
  for (const line of reply.split(/\r?\n/u)) {
    const match = /^([A-Za-z]+)\s*:\s*(.*)$/u.exec(line.trim())
    if (match === null) continue
    if (match[1]?.toUpperCase() !== key.toUpperCase()) continue
    const value = match[2]?.trim() ?? ''
    if (value.length > 0) return value
  }
  return undefined
}

/**
 * A required field, refused by name when the reply did not state it.
 *
 * @param reply - the model's text.
 * @param key - the field's name.
 * @returns the field's value.
 * @throws {Error} when the reply does not state the field.
 */
function requiredField(reply: string, key: string): string {
  const value = fieldOf(reply, key)
  if (value === undefined) {
    throw new Error(
      `[research-instruction-check] the reply states no ${key}, so nothing was decided — a reader that`
      + ` could not answer must not be read as one that cleared the instruction (reply began: ${reply.slice(0, 120)})`,
    )
  }
  return value
}

/**
 * The prompt for one instruction read before it is sent.
 *
 * The instruction and the request's context are both shown, labelled, and neither is paraphrased: the
 * question is whether THIS request carries the parts THIS task requires.
 *
 * @param input - the step, the instruction, and the context the writer will be given.
 * @param requiredParts - the parts the task requires, as the step states them.
 * @returns the instruction and the context the model reads.
 */
function checkPrompt(
  input: { readonly stepId: string; readonly instruction: string; readonly context: Readonly<Record<string, unknown>> },
  requiredParts: ReadonlyArray<string>,
): { readonly instruction: string; readonly context: Readonly<Record<string, unknown>> } {
  return {
    instruction: [
      'A step of a research pipeline is about to send an instruction to a writer.',
      `That step is ${input.stepId}. Before it is sent, decide whether the request carries every part`,
      'the task requires:',
      ...requiredParts.map(part => `- ${part}`),
      'Reply with exactly these three lines and nothing else:',
      `COMPLETE: <one of ${VERDICTS.join(' | ')}>`,
      'MISSING: <the one required part that is not carried, or exactly NONE when every part is carried>',
      'BASIS: <one sentence naming what in the request decides it>',
      '`yes` means every required part is carried. `no` means at least one is not.',
      'A part counts as carried when the instruction or the context carries it: several steps state',
      'their evidence as request data under a named field, and an instruction that names that field',
      'has carried it. Judge only whether the part is there — do not rewrite, improve or complete the',
      'instruction, and do not judge whether the task itself is a good one.',
    ].join('\n'),
    context: {
      instructionAboutToBeSent: input.instruction,
      requestContext: input.context,
    },
  }
}

/**
 * Real-model reader for "does this instruction carry what the task requires".
 *
 * @remarks Every method REFUSES rather than defaulting: a reply with no verdict, or with one this
 * pipeline does not know, throws with the reply's own opening text. A reader that cannot answer must
 * be visible as one that could not, never as one that approved.
 */
export class LlmInstructionChecker {
  /** What this checker is, for the record — a label, and nothing is decided on it. */
  readonly id: string
  /** The rules version its answers are bound to; see {@link LlmInstructionCheckerConfig}. */
  readonly policyVersion: string | undefined
  /** What serves it, so the record can say whether it shared the writer's model. */
  readonly route: { readonly provider: string; readonly model: string }
  private readonly writer: LlmProseWriter

  /**
   * @param ctx - the owning context.
   * @param config - the route this checker reads on, and where its sessions run.
   */
  constructor(ctx: Context, config: LlmInstructionCheckerConfig) {
    this.id = `llm-instruction-checker:${config.provider}/${config.model}`
    this.policyVersion = config.policyVersion
    this.route = { provider: config.provider, model: config.model }
    // THE PROSE CHANNEL'S OWN MACHINERY: the reader sends a request like any other and inherits the
    // loop's failure handling — a turn that died mid-stream, a provider error, a session that never
    // settles. A reader that re-implemented the loop would re-implement each of those holes.
    this.writer = new LlmProseWriter(ctx, {
      provider: config.provider,
      model: config.model,
      cwd: config.cwd,
      ...config.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: config.idleTimeoutMs },
    }, 'llm')
  }

  /**
   * Read one instruction against the parts the task requires of it.
   *
   * @param input - the step, the instruction as it will be sent, the required parts, and the context.
   * @returns the check, which may refuse the instruction.
   * @throws {Error} when the request fails or the reply states no usable verdict.
   */
  async check(input: {
    readonly stepId: string
    readonly instruction: string
    readonly requiredParts: ReadonlyArray<string>
    readonly context: Readonly<Record<string, unknown>>
  }): Promise<InstructionCheckLike> {
    const prompt = checkPrompt(input, input.requiredParts)
    const result = await this.writer.write({
      stepId: `check:${input.stepId}`,
      instruction: prompt.instruction,
      context: prompt.context,
    })
    const stated = requiredField(result.text, 'COMPLETE').toLowerCase()
    const verdict = VERDICTS.find(value => value === stated)
    if (verdict === undefined) {
      throw new Error(
        `[research-instruction-check] ${input.stepId}: the reply states complete '${stated}', which is`
        + ` not one of ${VERDICTS.join(', ')} — an unusable verdict is a failure, not a default`,
      )
    }
    const complete = verdict === 'yes'
    // `MISSING` IS READ ON BOTH PATHS AND USED ON ONE. A `no` without it has nothing a caller could
    // repair, and the runner refuses it; a `yes` that named a part anyway is stating two answers, and
    // what is recorded is the verdict and the part it names, so the contradiction is visible rather
    // than resolved here.
    const missingPart = requiredField(result.text, 'MISSING')
    return {
      complete,
      missingPart: missingPart.toUpperCase() === 'NONE' ? '' : missingPart,
      basis: requiredField(result.text, 'BASIS'),
      judgedBy: this.id,
      judgedAt: new Date().toISOString(),
    }
  }
}
