/**
 * The six stages, as a navigation strip.
 *
 * A stage's own state is what its steps recorded — never a guess from what the reader has opened,
 * and never a fold of "waiting for a person" into "in progress". The strip is navigation: pressing a
 * stage changes what is on screen and nothing about the study.
 */
import { STAGES, type StageId, type StageView } from '../../stages.ts'
import type { ResearchT } from '../locales.ts'
import css from './ResearchWorkbench.module.css'

/** Props for {@link StageNavigation}. */
export interface StageNavigationProps {
  /** The stages, in pipeline order, as derived from the run. */
  readonly stages: ReadonlyArray<StageView>
  /** The stage currently shown. */
  readonly selected: StageId
  /** Called with the stage a reader picked. */
  readonly onSelect: (stage: StageId) => void
  /** The `research` namespace translate. */
  readonly t: ResearchT
}

/** Render the stage strip. */
export function StageNavigation({ stages, selected, onSelect, t }: StageNavigationProps) {
  return (
    <nav className={css.stages} aria-label={t('stages.title')} data-research-stages="">
      {STAGES.map((definition) => {
        const stage = stages.find(candidate => candidate.id === definition.id)
        if (stage === undefined) return null
        return (
          <button
            type="button"
            key={definition.id}
            className={`${css.stage} ${selected === definition.id ? css.stageActive : ''}`}
            aria-current={selected === definition.id ? 'step' : undefined}
            data-research-stage={definition.id}
            data-research-stage-state={stage.state}
            onClick={() => { onSelect(definition.id) }}
          >
            <span className={css.stageName}>{t(`stages.${definition.id}`)}</span>
            {/* A STAGE THAT REPORTS NO STEP SAYS SO. The intake group is where a person's own
                question and material live; a count beside it would be a count of nothing. */}
            <span className={css.stageMeta}>
              {stage.steps.length === 0
                ? t('stages.noSteps')
                : t('stages.stepCount', {
                  passed: String(stage.counts.passed),
                  total: String(stage.steps.length),
                })}
            </span>
            <span className={`${css.tag} ${css[`stage-${stage.state}`]}`}>{t(`stages.state.${stage.state}`)}</span>
          </button>
        )
      })}
    </nav>
  )
}
