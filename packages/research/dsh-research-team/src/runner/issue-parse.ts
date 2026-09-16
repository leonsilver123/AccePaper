// @deepseek-ai/dsh-research-team — D4's reply parser, as a pure function over the model's text.
//
// WHY THIS IS ITS OWN MODULE. It used to live inside `d4Executor`, returning a bare array of
// issues, and that shape could not say what it had thrown away: an exchange missing its `SECTION`
// line was `return`ed out of the accumulator, so a reply with three exchanges of which two were
// malformed produced ONE issue, the step passed, and `openIssues` was empty. Nothing in the run
// recorded that two thirds of the reply had been discarded.
//
// WHAT IT DISTINGUISHES NOW, because the three are three different facts:
//
//   - `replacement`   — the author proposes a new body; the applier decides whether it applies;
//   - `declared-none` — the reply says `PATCH: NONE`, which is the author ACCEPTING the concern as
//                       an explanation. A conclusion, and a legitimate one;
//   - `missing`       — the reply has no `PATCH` line at all. NOT an acceptance: the reply did not
//                       follow the format it was given, and reading a malformed reply as "the
//                       author agreed" is exactly the silent default this module must not have.
//
// A malformed exchange is REPORTED rather than dropped, and `assertWellFormed` turns a report into
// a refusal. The step fails loudly with the exchange number and the missing label, so the next
// attempt has something to act on.

import type { RevisionIssue } from './issue-patch.ts'

/** How a reply stated its intent about the text. */
export type PatchState = 'replacement' | 'declared-none' | 'missing'

/** One parsed exchange, before the executor binds it to the version it was written against. */
export interface ParsedIssue extends Omit<RevisionIssue, 'basisHash' | 'patch' | 'requiresTextChange'> {
  readonly patchState: PatchState
  /** The replacement body, present only for {@link PatchState} `replacement`. */
  readonly patch?: string | undefined
}

/** An exchange the reply did not state completely enough to act on. */
export interface DiscardedExchange {
  /** 1-based position among the exchanges the reply opened. */
  readonly exchange: number
  /** The concern as far as it was read, so a reader can find the block. */
  readonly concern: string
  /** What the reply failed to state. */
  readonly missing: ReadonlyArray<string>
}

/** What one reply parsed into. */
export interface ParsedReply {
  readonly issues: ReadonlyArray<ParsedIssue>
  /**
   * Exchanges that opened but did not complete. Empty on a well-formed reply, and never silently
   * dropped: the caller decides whether to refuse, and the count travels with the artifact.
   */
  readonly discarded: ReadonlyArray<DiscardedExchange>
}

/**
 * Parse one D4 reply.
 *
 * A `CONCERN` line opens an exchange and the next one closes it, so a reply that omits a label
 * yields a DISCARDED exchange rather than a mispaired one. Lines before the first `CONCERN` are
 * preamble and are ignored — a model that introduces its answer has not malformed it.
 *
 * @param text - the model's reply.
 * @returns the issues it stated, and the exchanges it did not.
 */
export function parseReply(text: string): ParsedReply {
  const issues: ParsedIssue[] = []
  const discarded: DiscardedExchange[] = []
  let concern: string | undefined
  let sectionId: string | undefined
  let response: string | undefined
  let patchState: PatchState | undefined
  let patch: string | undefined
  let opened = 0

  const flush = (): void => {
    if (concern === undefined) return
    const missing: string[] = []
    if (sectionId === undefined) missing.push('SECTION')
    if (response === undefined) missing.push('RESPONSE')
    if (patchState === undefined) missing.push('PATCH')
    if (missing.length > 0) {
      discarded.push({ exchange: opened, concern, missing })
    } else {
      issues.push({
        issueId: `d4-issue-${String(issues.length + 1)}`,
        sectionId: sectionId as string,
        concern,
        response: response as string,
        patchState: patchState as PatchState,
        ...(patch === undefined ? {} : { patch }),
      })
    }
    concern = undefined
    sectionId = undefined
    response = undefined
    patchState = undefined
    patch = undefined
  }

  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/^\s*(?:[-*•]|\d+[.)\]])?\s*/, '').trim()
    const labeled = (label: string): string | undefined => {
      const match = new RegExp(`^${label}\\s*[:=]\\s*(.*)$`, 'i').exec(line)
      // An empty value counts as STATED and empty, which is how `PATCH:` with nothing after it is
      // told apart from no `PATCH` line at all. The two used to be the same value here.
      return match === null ? undefined : (match[1]?.trim() ?? '')
    }
    const nextConcern = labeled('CONCERN')
    if (nextConcern !== undefined) {
      flush()
      opened += 1
      concern = nextConcern
      continue
    }
    if (concern === undefined) continue
    const nextSection = labeled('SECTION')
    if (nextSection !== undefined) {
      sectionId = nextSection === '' ? undefined : nextSection
      continue
    }
    const nextResponse = labeled('RESPONSE')
    if (nextResponse !== undefined) {
      response = nextResponse
      continue
    }
    const nextPatch = labeled('PATCH')
    if (nextPatch !== undefined) {
      if (/^none$/iu.test(nextPatch)) {
        patchState = 'declared-none'
      } else if (nextPatch === '') {
        // Stated but empty: the reply meant to propose a body and did not. That is a malformed
        // exchange, not an acceptance.
        patchState = undefined
      } else {
        patchState = 'replacement'
        patch = nextPatch
      }
      continue
    }
  }
  flush()
  return { issues, discarded }
}

/**
 * Refuse a reply that did not state every exchange completely.
 *
 * @param reply - what {@link parseReply} produced.
 * @param stepId - the step refusing, for the message.
 * @returns the issues, once the reply is known to be well formed.
 */
export function assertWellFormed(
  reply: ParsedReply,
  stepId: string,
): ReadonlyArray<ParsedIssue> {
  if (reply.discarded.length === 0) {
    if (reply.issues.length === 0) {
      throw new Error(
        `[${stepId}] the model response carried no CONCERN exchange `
        + '(a rebuttal with no exchange answers nothing — NO DEFAULT PASS)',
      )
    }
    return reply.issues
  }
  const named = reply.discarded
    .map(entry => `#${String(entry.exchange)} (missing ${entry.missing.join(' + ')}): ${entry.concern.slice(0, 80)}`)
    .join('; ')
  throw new Error(
    `[${stepId}] the model response did not state ${String(reply.discarded.length)} of its `
    + `${String(reply.discarded.length + reply.issues.length)} exchanges completely — ${named}. `
    + 'A reply that omits a label is malformed, and reading one as "the author accepted the '
    + 'concern" would close an issue on nothing (NO DEFAULT PASS)',
  )
}
