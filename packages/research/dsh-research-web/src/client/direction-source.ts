/**
 * The plan a run will carry, and the proposals a person chooses between, as the browser sees them.
 *
 * TWINS. This module compiles in the Client face and `dsh-research-team` in the Host face, and the
 * client bundle takes no cross-plugin value dependency, so both wire values are declared
 * structurally here. The Host side exports the same field names and its integration spec asserts
 * them, so a rename there fails a test instead of silently blanking the dialog.
 *
 * WHAT IS NOT HERE: any display text. The host sends the model's own words — a title, a direction, a
 * claim — and the browser renders the criterion from the plan's `commitment`, so no sentence a
 * person reads is composed on the host. UI copy belongs to this face's locale dictionary.
 */

/** One section of the plan's skeleton, as it crosses the wire. */
export interface WirePlanSection {
  readonly id: string
  readonly heading: string
}

/** The plan the host will run. */
export interface WirePlan {
  readonly title: string
  readonly field: string
  readonly direction: string
  readonly outline: ReadonlyArray<WirePlanSection>
  readonly claim: {
    readonly id: string
    readonly ref: string
    readonly assertion: string
    readonly essentialDifference: string
    readonly experimentToFalsify: string
    readonly prediction: string
  }
  readonly metric: {
    readonly key: string
    readonly label: string
    readonly direction: string
    readonly phrases: ReadonlyArray<string>
  }
  readonly commitment?: {
    readonly direction: string
    readonly bound: string
    readonly thresholdPct: number
  } | undefined
}

/** One proposal, with the plan that confirming it would run. */
export interface WireProposal {
  /** What the host validated and would run. The dialog sends this back unchanged. */
  readonly plan: WirePlan
  /** The model's own words, for the dialog to show as content. */
  readonly title: string
  readonly direction: string
  readonly claim: string
}

/** One block of the model's answer that became no proposal, and why. */
export interface WireRefusal {
  readonly reason: string
  readonly block: string
}

/** The host's answer to a proposal request. */
export interface WireProposalAnswer {
  readonly proposals: ReadonlyArray<WireProposal>
  readonly refusals: ReadonlyArray<WireRefusal>
  /**
   * Which channel produced the proposals.
   *
   * The dialog states it, because a deterministic channel produces a fixed answer and a person
   * confirming one should know that no model was reached.
   */
  readonly channel: string
}
