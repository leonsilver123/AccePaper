/**
 * 现在该你做什么 —— the panel's first block, and the only one that answers "so what do I do".
 *
 * WHY IT EXISTS. A real run stopped at `D3-writing`: the drafting step left the `references` section
 * empty, the run's own review refused the manuscript for it, and the step was recorded `blocked`. The
 * page's next-action selector had no `blocked` state, so the run fell through to `running` and the
 * page told the researcher it was still working — while the stage badge beside it read 受阻. Nothing
 * anywhere said which check had refused the draft, what it had found, or what the person was supposed
 * to do. This block is that sentence, and it is the first thing on the page.
 *
 * THE TWO WAYS A RUN STOPS ARE NOT THE SAME THING, and both the colour and the copy say so: a run
 * waiting on a decision is BLUE and points at the control that answers it, while a run that was
 * refused or that errored is RED and points at the work upstream of it. Collapsing the two is how a
 * person ends up approving something that cannot proceed.
 *
 * THE RECORD IS ALWAYS REACHABLE. Every claim this block makes about a refusal can be checked against
 * the verdict that made it, one click below the sentence, because a restatement of somebody else's
 * judgement is worth exactly as much as the reader's ability to verify it.
 *
 * THE COPY IS COMPOSED AS ELEMENTS, NOT CONCATENATED AS STRINGS. A translation this build does not
 * have resolves to `undefined` rather than to a default, and a page that interpolated that into a
 * sentence would print the word "undefined" into it. Rendered as a child it simply contributes
 * nothing, which is what a missing sentence should contribute.
 */
import type { ReactNode } from 'react'
import type { ResearchKey, ResearchT } from '../locales.ts'
import type { NextAction } from '../../panels.ts'
import type { StepView } from '../../summary.ts'
import css from './ResearchWorkbench.module.css'

/**
 * The manuscript sections this build can name, by the identifier the engine's record uses.
 *
 * A LOOKUP RATHER THAN A KEY COMPOSED FROM THE RECORD. The record speaks the engine's vocabulary and
 * may name a section this build has never heard of; an unmapped identifier is then shown as the
 * record wrote it — still true — instead of as a key nobody can read.
 */
const SECTION_KEYS: Readonly<Record<string, ResearchKey>> = {
  abstract: 'paperSection.abstract',
  introduction: 'paperSection.introduction',
  method: 'paperSection.method',
  experiments: 'paperSection.experiments',
  results: 'paperSection.results',
  conclusion: 'paperSection.conclusion',
  references: 'paperSection.references',
}

/** What one situation renders as. */
interface SituationBody {
  /**
   * The colour token for the kind of stop: waiting on a person and stopped dead are different facts.
   *
   * A CSS-module lookup is typed as possibly absent, and it is carried that way rather than cast: a
   * class the stylesheet does not define should contribute no class, not the text `undefined`.
   */
  readonly className: string | undefined
  readonly line: ReactNode
  readonly remedy?: ReactNode
  /** The verdict's own words, when there is a verdict to show. */
  readonly evidence?: string
}

/** A step's name as the host gave it, falling back to its identifier when it gave none. */
function stepLabel(step: StepView): string {
  return step.name.trim().length > 0 ? step.name : step.stepId
}

/**
 * The section names, in the reader's language where this build knows them.
 *
 * A section this build cannot name falls back to the identifier the record used, which is still a
 * true statement about what the check found — an empty string would not be.
 */
function sectionNames(sections: ReadonlyArray<string>, t: ResearchT): string {
  return sections
    .map((section) => {
      const key = SECTION_KEYS[section]
      return key === undefined ? section : t(key)
    })
    .join('、')
}

/**
 * What the block says for one next action.
 *
 * @param next - the selector's answer.
 * @param t - the `research` namespace translate.
 * @returns the copy, or undefined for a page with no run to act on.
 */
function bodyOf(next: NextAction, t: ResearchT): SituationBody | undefined {
  switch (next.kind) {
    case 'not-started':
      // Nothing has been run: the orientation block above already says what to press, and a second
      // "what to do now" would be the same sentence twice.
      return undefined
    case 'blocked': {
      const blocker = next.blocker
      const reason = blocker === undefined || blocker.check === 'unknown'
        ? t('situation.blocked.reasonUnknown')
        : blocker.finding.kind === 'empty-sections'
          ? t('situation.blocked.reason', {
            check: t(`check.${blocker.check}`),
            sections: sectionNames(blocker.finding.sections, t),
          })
          : t('situation.blocked.reasonBare', { check: t(`check.${blocker.check}`) })
      return {
        className: css.situationStuck,
        line: (
          <>
            {t('situation.blocked', { step: stepLabel(next.step) })}
            {' —— '}
            {reason}
          </>
        ),
        remedy: t('situation.remedy.blocked'),
        ...(blocker === undefined ? {} : { evidence: blocker.evidence }),
      }
    }
    case 'failed':
      return {
        className: css.situationStuck,
        line: t('situation.failed', {
          step: stepLabel(next.step),
          reason: next.step.executeError ?? t('situation.noReason'),
        }),
        remedy: t('situation.remedy.failed'),
      }
    case 'awaiting-human':
      return {
        className: css.situationAwaiting,
        line: t('situation.awaitingHuman', { count: String(next.pendingCount) }),
        remedy: t('situation.remedy.awaitingHuman'),
      }
    case 'running':
      return {
        className: css.situationRunning,
        // The step actually in flight when the projection names one; a run that names none falls back
        // to the count-free sentence the page already carried.
        line: next.step === undefined
          ? t('next.running')
          : t('situation.running', { index: String(next.step.index), step: stepLabel(next.step) }),
      }
    case 'complete':
      return { className: css.situationDone, line: t('situation.complete') }
  }
}

/** Props for {@link SituationBanner}. */
export interface SituationBannerProps {
  readonly next: NextAction
  readonly t: ResearchT
}

/** Render 现在该你做什么. Renders nothing when there is no run to act on. */
export function SituationBanner({ next, t }: SituationBannerProps) {
  const body = bodyOf(next, t)
  if (body === undefined) return null
  const classes = [css.situation, body.className].filter(part => part !== undefined).join(' ')
  return (
    <section className={classes} data-research-situation={next.kind}>
      <h2 className={css.situationTitle}>{t('situation.title')}</h2>
      <p className={css.situationLine} data-research-situation-line="">{body.line}</p>
      {body.remedy !== undefined && (
        <p className={css.situationRemedy} data-research-situation-remedy="">{body.remedy}</p>
      )}
      {body.evidence !== undefined && (
        <details className={css.situationRecord} data-research-situation-record="">
          <summary>{t('situation.record')}</summary>
          <p className={css.situationEvidence}>{body.evidence}</p>
        </details>
      )}
    </section>
  )
}
