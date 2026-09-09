/** T28 figures/tables panel: artifacts grouped by a coarse kind. */
import { selectArtifacts, type ArtifactKind } from '../../panels.ts'
import type { PanelProps } from './shared.ts'
import css from './ResearchWorkbench.module.css'

/** Which artifact kind this panel instance presents. */
export type ArtifactsVariant = 'figure' | 'table'

/** Render the figure or table artifacts of the run (mock-classified by slug/text). */
export function ArtifactsPanel(
  { summary, t, variant }: PanelProps & { variant: ArtifactsVariant },
) {
  const kind: ArtifactKind = variant
  const items = selectArtifacts(summary, kind)
  const noneKey = variant === 'figure' ? 'artifacts.figures.none' : 'artifacts.tables.none'
  return (
    <section className={css.panel}>
      <h3 className={css.panelHeader}>{t(`artifacts.${kind}`)}</h3>
      {items.length === 0
        ? <p className={css.empty}>{t(noneKey)}</p>
        : (
          <ul className={css.list}>
            {items.map(artifact => (
              <li
                key={artifact.slug}
                className={`${css.cell} ${artifact.invalidated ? css.invalidated : ''}`}
              >
                <div className={css.slug}>{artifact.slug}</div>
                <div className={css.summary}>
                  <span className={`${css.tag} ${css.kindBadge}`}>
                    {t('artifacts.kind', { kind: t(`artifacts.${kind}`) })}
                  </span>{' '}
                  {artifact.summary}
                  {artifact.invalidated && ` (${t('artifacts.invalidated')})`}
                </div>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}
