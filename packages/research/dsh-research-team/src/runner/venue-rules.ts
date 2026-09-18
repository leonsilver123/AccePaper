// @deepseek-ai/dsh-research-team — may this manuscript be published under the rules that were read?
//
// WHY THIS IS SEPARATE FROM THE PROFILE. `research-profile.ts` owns what a venue requires — the rule,
// the page that states it, the date it was read, the article type, and whether it was established —
// and a run carries that profile frozen into its spec. What the profile does not do is decide
// anything: recording that a guide is unread and REFUSING to publish under it are different acts, and
// the second is this file's. The pipeline review of 2026-09-18 named the gap as "未知期刊规则阻断最终
// 发布" — unknown journal rules block final publication — and before this, nothing consulted the
// profile at publication time at all.
//
// A RULE NOBODY READ IS NOT A REQUIREMENT THE MANUSCRIPT MEETS. Every other publication condition
// asks whether the PAPER is finished; this one asks whether it is the document the JOURNAL accepts. A
// manuscript measured against an invented word limit reads as compliant while being measured against
// nothing, so the record is the questions and the refusal is the answer.

import type { JournalProfile } from './research-profile.ts'

/** Why a manuscript may not be published under the rules that were read. */
export type VenueRuleRefusalCode =
  /** The run carries no venue profile, so nothing about the manuscript was checked against one. */
  | 'journal-rules-absent'
  /** The profile exists and rules in it were never established. */
  | 'journal-rules-unverified'

/** One refusal, naming the rules that stand in the way. */
export interface VenueRuleRefusal {
  readonly code: VenueRuleRefusalCode
  readonly detail: string
  /** The rule ids that are not established, so a reader knows how many pages to fetch. */
  readonly unverified: ReadonlyArray<string>
}

/**
 * Whether a manuscript may be published under the rules that were read.
 *
 * @param profile - the venue's requirements as the run carries them, or undefined when it carries none.
 * @returns one refusal when they are absent or unestablished, and none when every rule was read.
 */
export function checkVenueRules(profile: JournalProfile | undefined): ReadonlyArray<VenueRuleRefusal> {
  if (profile === undefined) {
    return [{
      code: 'journal-rules-absent',
      detail: "this run carries no record of the target journal's requirements, so nothing about the"
        + ' manuscript has been checked against them — the guide has to be read before a submission'
        + ' can be said to meet it',
      unverified: [],
    }]
  }
  // AN EMPTY RULE LIST IS AN UNREAD GUIDE, NOT A VENUE THAT REQUIRES NOTHING: the profile's own
  // contract says so, and a check that read it as "nothing to satisfy" would pass every manuscript
  // written for a journal nobody had looked up.
  if (profile.rules.length === 0) {
    return [{
      code: 'journal-rules-unverified',
      detail: `no requirement recorded for '${profile.name}' has been read, so the manuscript was`
        + ' checked against none of them — the guide is the first thing to fetch',
      unverified: [],
    }]
  }
  // `not_specified` IS NOT A GAP. A guide that was read and states no requirement for a subject has
  // answered the question; only a rule nobody read leaves the submission measured against nothing.
  const unverified = profile.rules.filter(rule => rule.verification === 'unknown')
  if (unverified.length === 0) return []
  return [{
    code: 'journal-rules-unverified',
    detail: `${String(unverified.length)} of ${String(profile.rules.length)} requirement(s) for`
      + ` '${profile.name}' have not been established (${unverified.map(rule => rule.id).join(', ')})`
      + ` — each is recorded with its official source (${profile.rules[0]?.source ?? 'none'}) and awaits`
      + ' a reading, and a manuscript is published under the rules that were read',
    unverified: unverified.map(rule => rule.id),
  }]
}
