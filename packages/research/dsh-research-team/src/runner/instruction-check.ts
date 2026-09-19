// @deepseek-ai/dsh-research-team — one reading of an instruction, before it is sent, that can stop it.
//
// WHY THIS EXISTS. A step composes an instruction out of parts (`skeleton.ts`) and the rules each part
// states live in modules the step is judged BY. Nothing checked that the composed text still CARRIES
// those parts: the refusals a real deployment measured on 2026-09-20 were about material the writer
// had never been shown — a roster without the passage, a passage without what was read — and each was
// fixed by hand, after the run stopped, in the composer. A reading of the instruction before it is
// sent is where that class of defect is visible while the run is still going.
//
// WHAT IT IS NOT. It is NOT an optimiser. A model asked to improve an instruction would rewrite it
// differently every run, and this pipeline's premise is that a claim nobody can re-read is a claim
// nobody can check — an instruction that drifts between runs is an unauditable layer between the step
// and the text it is judged against. The check below changes NOTHING: it reads the instruction, says
// whether each part the task requires is carried, and that answer is recorded beside the request. The
// instruction the writer receives is the one the step composed, whether the check ran or not.
//
// IT BLOCKS, AND IT FAILS CLOSED. A check that answered "a part is missing" and then let the request
// through anyway would be an observation wearing a gate's name, so a refusal here stops the send and
// the step reports it. An answer that states no usable verdict is also a refusal rather than a default
// "fine": a reader that could not answer must be visible as one that could not, which is the same
// posture `LlmReviewer` takes. What the specs PROVE is the mechanism — a `false` stops the send, and
// so does an unusable answer. Whether a given model's reading is right is not something a spec can
// prove, and this module does not claim it.

import { createHash } from 'node:crypto'

import type { ResearchProseRequest } from './registry.ts'

/**
 * What a checker says about one instruction.
 *
 * `complete` is the verdict, `missingPart` is what decides it, and `basis` is the reader's sentence
 * naming what in the instruction it read. A `false` with no named part has nothing to repair, and is
 * refused as unusable rather than acted on.
 */
export interface InstructionCheck {
  /** Whether the instruction carries every part the task requires. */
  readonly complete: boolean
  /**
   * The required part the instruction does not carry, as the checker names it.
   *
   * Required when {@link complete} is false, and ignored when it is true: an instruction that carries
   * everything has nothing missing, and a checker that named one anyway is stating two answers.
   */
  readonly missingPart: string
  /** Why: what in the instruction decides the verdict. */
  readonly basis: string
  /** Who read it: a person, or the deployment's own reader. */
  readonly judgedBy: string
  /** When, ISO 8601. A verdict with no date cannot be told from one made before the instruction changed. */
  readonly judgedAt: string
}

/**
 * A deployment's ability to read an instruction and say whether it carries what the task requires.
 *
 * The same shape as every other capability seam in this package: whether a machine can do this is a
 * property of the deployment, which supplies one or supplies none. A deployment that names none
 * records no check, which is a fact a reader can act on rather than a silence.
 */
export interface InstructionChecker {
  /** What this checker is, for the record: a model id, or the name of the rulebook behind it. */
  readonly id: string
  /**
   * The version of the rules this checker applies, when it has them.
   *
   * Recorded beside every answer, for the reason an assessment records its assessor's version: a
   * replaced reader, or one whose policy changed, produces a different answer for the same
   * instruction, and the old answer must not be read as the new one's.
   */
  readonly policyVersion?: string
  /**
   * Read one instruction against the parts the task requires of it.
   *
   * @param input - the step, the instruction as it will be sent, the parts the step states the task
   * requires, and the request's context.
   * @returns the check, which may refuse the instruction.
   */
  check(input: {
    readonly stepId: string
    readonly instruction: string
    readonly requiredParts: ReadonlyArray<string>
    readonly context: Readonly<Record<string, unknown>>
  }): Promise<InstructionCheck>
}

/**
 * One check's answer as the run records it.
 *
 * THE COUNTERPART TO THE REQUEST, not a copy of it. `instructionSha256` is the version of the
 * instruction the answer was made about, so an instruction edited after the check stops matching the
 * record that cleared it, and a reader can tell a send that was checked from one that was only
 * claimed to have been.
 */
export interface InstructionCheckRecord extends InstructionCheck {
  /** The step whose instruction this is. */
  readonly stepId: string
  /** The checker that produced the answer, with the version of its rules. */
  readonly checkerVersion: string
  /** SHA-256 of the instruction read, hex. */
  readonly instructionSha256: string
  /**
   * The parts the step stated the task requires, as it stated them.
   *
   * Recorded because "carries everything the task requires" is not a fact about the instruction alone:
   * it is the instruction read against the parts THIS step requires, and a record without them cannot
   * be re-read.
   */
  readonly requiredParts: ReadonlyArray<string>
}

/**
 * The parts every prose instruction's task requires, as the check is asked about them.
 *
 * THE REQUIRED PARTS ARE THE ONES A WRITER CANNOT DO THE TASK WITHOUT, and they are named here rather
 * than derived from whichever parts a step happened to state: a step that composed no evidence part
 * would otherwise be checked against "carries the parts it carries", which passes on everything.
 * Evidence and constraints are the two a run has already been stopped by; the format is required
 * because a reply nothing can parse is a reply that was never read.
 */
export const REQUIRED_INSTRUCTION_PARTS: ReadonlyArray<string> = [
  'the evidence the task must be written from',
  'the constraints on what may be asserted',
  'the output format the reply must take',
]

/**
 * SHA-256 of one piece of text, as the record's instruction version is computed.
 *
 * @param text - the text.
 * @returns its SHA-256, hex.
 */
function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * The version string recorded beside one checker's answers.
 *
 * @param checker - the deployment's checker.
 * @returns its id, or its id with the policy version it applies.
 */
function checkerVersionOf(checker: InstructionChecker): string {
  return checker.policyVersion === undefined || checker.policyVersion.length === 0
    ? checker.id
    : `${checker.id}@${checker.policyVersion}`
}

/**
 * Read one instruction before it is sent, and refuse it when the reading says a part is missing.
 *
 * @param checker - the deployment's checker.
 * @param input - the step, the instruction, the parts the task requires, and the request's context.
 * @returns the record of the answer, when the instruction may be sent.
 * @throws {Error} when the reading refuses the instruction, or states no usable verdict.
 */
export async function checkInstruction(
  checker: InstructionChecker,
  input: {
    readonly stepId: string
    readonly instruction: string
    readonly requiredParts: ReadonlyArray<string>
    readonly context: Readonly<Record<string, unknown>>
  },
): Promise<InstructionCheckRecord> {
  const answer = await checker.check(input)
  const record: InstructionCheckRecord = {
    ...answer,
    stepId: input.stepId,
    checkerVersion: checkerVersionOf(checker),
    instructionSha256: sha256(input.instruction),
    requiredParts: input.requiredParts,
  }
  // AN UNUSABLE ANSWER IS A FAILURE, NOT A PASS. A checker that refused the instruction without
  // naming what is missing has not answered the question this call asks, and reading that as
  // clearance would make every unreadable answer a silent approval. The same holds the other way: a
  // clearance with nothing behind it is a verdict nothing can be re-read against.
  if (!answer.complete && answer.missingPart.trim() === '') {
    throw new Error(
      `[instruction-check] ${input.stepId}: the check refused the instruction without naming the part`
      + ` it finds missing (${answer.basis}) — there is nothing a caller could repair, so this is a`
      + ' reader that could not answer rather than one that answered',
    )
  }
  if (answer.complete && answer.basis.trim() === '') {
    throw new Error(
      `[instruction-check] ${input.stepId}: the check cleared the instruction while stating nothing it`
      + ' read — a clearance with no basis cannot be re-read, so it is not a clearance',
    )
  }
  if (!answer.complete) {
    throw new Error(
      `[instruction-check] ${input.stepId}: the instruction is missing ${answer.missingPart}, which`
      + ` this task requires: ${answer.basis}`,
    )
  }
  return record
}

/**
 * Send one prose request, after a reading of the instruction that can stop it.
 *
 * THE ONLY PATH A PROSE REQUEST TAKES. Every step that asks a model for text goes through here, so
 * there is one place where the check runs and one place where its answer is recorded; a step that
 * called the writer directly would be a send with no record of whether it was checked.
 *
 * @param checker - the deployment's checker, or undefined when it configured none.
 * @param request - the request as the step composed it.
 * @param send - how the request is actually sent.
 * @returns what the send resolved with, and the check's record when a check ran.
 * @throws {Error} when the check refuses the instruction; the send does not happen.
 */
export async function sendCheckedProse<T>(
  checker: InstructionChecker | undefined,
  request: ResearchProseRequest,
  send: () => Promise<T>,
): Promise<{ readonly result: T; readonly check?: InstructionCheckRecord }> {
  if (checker === undefined) return { result: await send() }
  const check = await checkInstruction(checker, {
    stepId: request.stepId,
    instruction: request.instruction,
    requiredParts: REQUIRED_INSTRUCTION_PARTS,
    context: request.context,
  })
  return { result: await send(), check }
}
