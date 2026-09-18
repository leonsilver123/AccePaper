/**
 * LlmReviewer — the real-model channel for the two judgements the pipeline refuses to make itself.
 *
 * TWO QUESTIONS, ONE READER ROLE. Whether a sentence's citation supports THAT sentence, and whether a
 * revision answers the issue it was written for, are both readings of a text against evidence — and
 * the pipeline review of 2026-09-18 named both as places where a machine had been assumed rather than
 * supplied. The runner declares both seams (`StatementSupportAssessor`, `ResolutionVerifier`) and
 * carries no implementation; this class is one, so a deployment that configures it gets its own
 * sentences read rather than a claim's verdict inherited.
 *
 * IT IS BUILT ON THE PROSE CHANNEL, and for the failure handling, not the prompt style: a turn that
 * died mid-stream, a provider error, a session that never settles and an assembly that fails before
 * the request is sent are all already refused by {@link LlmProseWriter}, with the turn's own reason.
 * A reviewer that re-implemented the loop would re-implement each of those holes.
 *
 * WHAT THE MODEL DECIDES, AND WHAT IT DOES NOT. The model reads a sentence against a passage and says
 * how the two stand. It does not choose the read scope: a verdict cannot claim a broader reading than
 * the passage it was given, so `readScope` is copied from the judgement that was made of the source.
 * It does not name itself, date itself, or state either version — a reader that could write its own
 * provenance could certify anything. And it does not get a default: a reply that does not state a
 * verdict this pipeline knows is a FAILURE, never a silent "supported", because the whole point of the
 * seam is that a sentence nobody could read is different from a sentence that was read and holds.
 *
 * IT DOES NOT SAY WHO IT IS. A verdict carries the decision and what was read, and NOT an identity:
 * the host that starts the execution records which execution it was, in which session, under which
 * rules. A reader that could name itself could forge one, and a check written against a self-reported
 * name is a check a renamed reader passes. What makes two roles independent is the host's
 * record — different execution, different session, its own instructions — not the model behind them;
 * the model is recorded so a reader can see whether one model wrote and reviewed, which is a
 * shared-bias risk rather than a refusal.
 */

import type { Context } from '@deepseek-ai/cordis'

import { LlmProseWriter, type LlmProseWriterConfig } from './llm-prose-writer.ts'

/**
 * Structural twin of the runner's `Statement`.
 *
 * Declared locally rather than imported so this adapter package does not depend on the runner
 * package, the way {@link ProseRequestLike} does; TypeScript's structural typing accepts it when the
 * reviewer is handed to `DriveOptions.statementAssessor`.
 */
export interface StatementLike {
  readonly statementId: string
  readonly sectionId: string
  readonly text: string
  readonly textSha256: string
}

/** Structural twin of the runner's `SourceJudgement`. */
export interface JudgementLike {
  readonly citeKey: string
  readonly location: string
  readonly quote: string
  readonly quoteSha256: string
  /** How far the source was actually read. The verdict may not claim more than this. */
  readonly readScope: string
}

/**
 * Structural twin of the runner's `StatementAssessment`.
 *
 * The identity and provenance fields are filled by this class from what it was given and when it ran;
 * only `support` and `basis` come from the model.
 */
export interface AssessmentLike {
  readonly statementId: string
  readonly statementSha256: string
  readonly citeKey: string
  readonly quoteSha256: string
  readonly assessorVersion: string
  readonly support: string
  readonly readScope: string
  readonly basis: string
  readonly judgedBy: string
  readonly judgedAt: string
}

/** Structural twin of the runner's `SectionChange`. */
export interface SectionChangeLike {
  readonly sectionId: string
  readonly beforeHash: string
  readonly afterHash: string
}

/** Structural twin of the runner's `RevisionIssue`. */
export interface RevisionIssueLike {
  readonly issueId: string
  readonly sectionId: string
  readonly concern: string
  readonly response: string
  readonly requiresTextChange: boolean
}

/**
 * Structural twin of the runner's `ResolutionVerdict`.
 *
 * NO IDENTITY AND NO TIMESTAMP. The host that started the read records which execution it was, in
 * which session, under which rules, and when — a reader that supplied those could certify itself, and
 * a reader that cannot supply them cannot be renamed past the check.
 */
export interface VerdictLike {
  readonly verdict: string
  readonly basis: string
  /** What the reader actually read; a decision reached on nothing read is refused by the runner. */
  readonly evidenceRead: ReadonlyArray<string>
}

/** The model route a {@link LlmReviewer} reads on, and what its verdicts are bound to. */
export interface LlmReviewerConfig extends Pick<LlmProseWriterConfig, 'provider' | 'model' | 'cwd' | 'idleTimeoutMs'> {
  /**
   * The version of the REVIEW rules this reviewer applies.
   *
   * REQUIRED, because the role is the instructions: the runner refuses a verification taken under the
   * author's own version, so a reviewer that did not state one could not be told apart from the writer
   * it is checking. A deployment that changes what it asks its reviewer to do changes this, and
   * verifications taken under the old rules stop matching the new ones.
   */
  readonly instructionsVersion: string
  /**
   * The version of the rules this reviewer applies, when the deployment holds them.
   *
   * Recorded on every assessment and compared before one is reused, so a deployment that changes what
   * its reader is asked for does not carry the old answers forward.
   */
  readonly policyVersion?: string
}

/** The verdicts a sentence's citation may be given. Anything else is refused. */
const SUPPORTS: ReadonlyArray<string> = ['supported', 'contradicted', 'partial', 'unrelated']

/**
 * The decisions a revision's issue may be given. Anything else is refused.
 *
 * `abstained` IS A DECISION, and the third one exists because a reader that could not get what it
 * needed must be able to say so: without it, the only replies available are "answered" and "not
 * answered", and a reader short of evidence would have to guess at one of them.
 */
const VERDICTS: ReadonlyArray<string> = ['verified', 'rejected', 'abstained']

/**
 * One labelled field out of a reply, or undefined when the reply does not state it.
 *
 * The format is one `KEY: value` per line, read case-insensitively on the key. Values are taken
 * verbatim to the end of the line and trimmed at the outer edges only — a basis is a sentence the
 * reader wrote and is not re-wrapped here.
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
 * @param stepId - the step the reply belongs to, for the failure message.
 * @returns the field's value.
 * @throws {Error} when the reply does not state the field.
 */
function requiredField(reply: string, key: string, stepId: string): string {
  const value = fieldOf(reply, key)
  if (value === undefined) {
    throw new Error(
      `[research-review] ${stepId}: the reply states no ${key}, so nothing was decided — a reviewer`
      + ` that could not answer must not be read as one that answered (reply began: ${reply.slice(0, 120)})`,
    )
  }
  return value
}

/**
 * The member of a closed vocabulary the reply named, refused by name when it named none.
 *
 * @param reply - the model's text.
 * @param key - the field's name.
 * @param allowed - the values this pipeline knows.
 * @param stepId - the step the reply belongs to, for the failure message.
 * @returns the value, lower-cased.
 * @throws {Error} when the reply's value is not one of `allowed`.
 */
function vocabularyField(
  reply: string,
  key: string,
  allowed: ReadonlyArray<string>,
  stepId: string,
): string {
  const stated = requiredField(reply, key, stepId).toLowerCase()
  const match = allowed.find(value => value === stated)
  if (match === undefined) {
    throw new Error(
      `[research-review] ${stepId}: the reply states ${key.toLowerCase()} '${stated}', which is not one`
      + ` of ${allowed.join(', ')} — an unusable verdict is a failure, not a default`,
    )
  }
  return match
}

/**
 * The prompt for one sentence read against one passage.
 *
 * The sentence is quoted as the manuscript wrote it and the passage as it was read; neither is
 * paraphrased, because the question is whether THIS sentence is established by THIS passage.
 *
 * @param input - the sentence and the judgement about the source it cites.
 * @returns the instruction and the context the model reads.
 */
function assessPrompt(input: { readonly statement: StatementLike; readonly judgement: JudgementLike }): {
  readonly instruction: string
  readonly context: Readonly<Record<string, unknown>>
} {
  return {
    instruction: [
      'One sentence of a manuscript cites one source. Decide what the passage that was READ of that',
      'source establishes about THAT SENTENCE — not about the claim the sentence came from.',
      'Reply with exactly these two lines and nothing else:',
      `SUPPORT: <one of ${SUPPORTS.join(' | ')}>`,
      'BASIS: <one sentence naming what in the passage decides it, or what is missing>',
      '`supported` means the passage establishes the sentence as written.',
      '`contradicted` means it establishes the opposite.',
      '`partial` means it establishes part of it, or only in a narrower scope than the sentence claims.',
      '`unrelated` means it does not bear on what the sentence states.',
      'The passage is everything that was read; do not assume anything beyond it.',
    ].join('\n'),
    context: {
      sentence: input.statement.text,
      section: input.statement.sectionId,
      citedSource: input.judgement.citeKey,
      whereItWasRead: input.judgement.location,
      passageRead: input.judgement.quote,
      howFarItWasRead: input.judgement.readScope,
    },
  }
}

/**
 * The prompt for one revision checked against the issue it was written for.
 *
 * @param input - the issue, the change the round made, and the section body as it now stands.
 * @returns the instruction and the context the model reads.
 */
function verifyPrompt(input: {
  readonly issue: RevisionIssueLike
  readonly change?: SectionChangeLike
  readonly revisedBody?: string
}): { readonly instruction: string; readonly context: Readonly<Record<string, unknown>> } {
  return {
    instruction: [
      'A reviewer raised a concern about a manuscript and the author answered it. Decide whether the',
      'answer settles the concern — the concern as raised, not a related one.',
      'Reply with exactly these three lines and nothing else:',
      `VERDICT: <one of ${VERDICTS.join(' | ')}>`,
      'BASIS: <one sentence naming what decides it>',
      'READ: <what you read, separated by semicolons — the concern, the change, the section as it',
      'now stands, and any evidence you consulted>',
      '`verified` means the concern is answered. `rejected` means it is still owed an answer.',
      '`abstained` means you could not get what the decision needs; an issue is never closed without'
        + ' something read, so abstain rather than guess.',
      'An answer that explains why no change was needed can settle a concern; judge whether the',
      'explanation holds, and send it back when the manuscript still carries the problem.',
    ].join('\n'),
    context: {
      concern: input.issue.concern,
      authorsAnswer: input.issue.response,
      committedToChangingTheText: input.issue.requiresTextChange,
      section: input.issue.sectionId,
      ...input.change === undefined
        ? {}
        : { changeMade: { before: input.change.beforeHash, after: input.change.afterHash } },
      ...input.revisedBody === undefined ? {} : { sectionAsItNowStands: input.revisedBody },
    },
  }
}

/**
 * Real-model reader for the two judgements the pipeline refuses to make itself.
 *
 * @remarks Every method REFUSES rather than defaulting: a reply with no verdict, or with one this
 * pipeline does not know, throws with the reply's own opening text. A reader that cannot answer must
 * be visible as one that could not, never as one that approved.
 */
export class LlmReviewer {
  /**
   * What this reviewer is, for the record — and NOT what makes it independent.
   *
   * The host mints the execution id, the session and the rules version of every verification this
   * class produces; this string is a label a reader can recognise, and nothing is decided on it.
   */
  readonly id: string
  /** The rules version this reviewer's verdicts are bound to; see {@link LlmReviewerConfig}. */
  readonly policyVersion: string | undefined
  /** The restricted role this reviewer occupies; the runner refuses any other. */
  readonly role = 'revision-verifier' as const
  /** The version of the rules it applies, recorded on every verification it produces. */
  readonly instructionsVersion: string
  /** What serves it, so the record can say whether it shared the author's model. */
  readonly route: { readonly provider: string; readonly model: string }
  private readonly writer: LlmProseWriter

  /**
   * @param ctx - the owning context.
   * @param config - the route this reviewer reads on, and where its sessions run.
   */
  constructor(ctx: Context, config: LlmReviewerConfig) {
    this.id = `llm-reviewer:${config.provider}/${config.model}`
    this.policyVersion = config.policyVersion
    // THE RULES VERSION IS REQUIRED, and that is the point: two roles are distinct tasks by their
    // INSTRUCTIONS, so a reviewer that does not say which rules it applies cannot be told apart from
    // the author. `policyVersion` stays for the assessment cache, which reuses verdicts by version.
    this.instructionsVersion = config.instructionsVersion
    this.route = { provider: config.provider, model: config.model }
    // THE PROSE CHANNEL'S OWN MACHINERY, told it is an LLM route: the reader sends a request like
    // any other and inherits the loop's failure handling. `channel` is not a claim about what this
    // class produces — nothing labels an assessment with it — but the writer refuses to be built
    // without one, and `'llm'` is what this route is.
    this.writer = new LlmProseWriter(ctx, {
      provider: config.provider,
      model: config.model,
      cwd: config.cwd,
      ...config.idleTimeoutMs === undefined ? {} : { idleTimeoutMs: config.idleTimeoutMs },
    }, 'llm')
  }

  /** The string recorded as `assessorVersion`, so a replaced reader's verdicts are not reused. */
  private get version(): string {
    return this.policyVersion === undefined || this.policyVersion.length === 0
      ? this.id
      : `${this.id}@${this.policyVersion}`
  }

  /**
   * Judge one citing sentence against the source it cites.
   *
   * @param input - the sentence, with its content version, and the judgement about the source.
   * @returns the assessment, carrying the sentence's and the passage's versions as it read them.
   * @throws {Error} when the request fails or the reply states no usable verdict.
   */
  async assess(input: {
    readonly statement: StatementLike
    readonly judgement: JudgementLike
  }): Promise<AssessmentLike> {
    const prompt = assessPrompt(input)
    const result = await this.writer.write({
      stepId: `assess:${input.statement.statementId}`,
      instruction: prompt.instruction,
      context: prompt.context,
    })
    return {
      statementId: input.statement.statementId,
      statementSha256: input.statement.textSha256,
      citeKey: input.judgement.citeKey,
      quoteSha256: input.judgement.quoteSha256,
      assessorVersion: this.version,
      support: vocabularyField(result.text, 'SUPPORT', SUPPORTS, `assess:${input.statement.statementId}`),
      // COPIED FROM THE JUDGEMENT, NOT ASKED OF THE MODEL. A verdict cannot rest on a broader reading
      // than the one that was actually made, and a reader asked how much it read would answer for
      // the passage it was handed either way.
      readScope: input.judgement.readScope,
      basis: requiredField(result.text, 'BASIS', `assess:${input.statement.statementId}`),
      judgedBy: this.id,
      judgedAt: new Date().toISOString(),
    }
  }

  /**
   * Decide whether one revision answers the issue it was written for.
   *
   * @param input - the issue as raised, the change it produced, and the body as it now stands.
   * @returns the verdict, what it rests on, and what was read — never an identity.
   * @throws {Error} when the request fails or the reply states no usable verdict.
   */
  async verify(input: {
    readonly issue: RevisionIssueLike
    readonly change?: SectionChangeLike
    readonly revisedBody?: string
  }): Promise<VerdictLike> {
    const prompt = verifyPrompt(input)
    const result = await this.writer.write({
      stepId: `verify:${input.issue.issueId}`,
      instruction: prompt.instruction,
      context: prompt.context,
    })
    const verdict = vocabularyField(result.text, 'VERDICT', VERDICTS, `verify:${input.issue.issueId}`)
    // WHAT WAS READ, NAMED BY THE READER AND CHECKED BY THE RUNNER. A `verified` or a `rejected` with
    // nothing behind it is refused there, so an abstention is the only honest reply for a reader that
    // could not get what the decision needs — which is why it is one of the three verdicts.
    const read = fieldOf(result.text, 'READ') ?? ''
    return {
      verdict,
      basis: requiredField(result.text, 'BASIS', `verify:${input.issue.issueId}`),
      evidenceRead: read === ''
        ? []
        : read.split(';').map(piece => piece.trim()).filter(piece => piece.length > 0),
    }
  }
}
