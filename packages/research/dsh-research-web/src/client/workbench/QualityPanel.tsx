/**
 * Quality panel (质量基线): what the baseline found in the manuscript, and WHAT IT COULD READ.
 *
 * THE COVERAGE IS RENDERED WITH THE FINDINGS, and that is the whole reason this panel shows three
 * lists rather than one. A package whose finding list is empty is a package where the rules that
 * could read the manuscript found nothing — and a page that rendered the list alone would report
 * that as the paper being fine while a rule whose input the manuscript does not carry never ran at
 * all. So each check is shown with its outcome and, when it could not answer, with what it needed.
 *
 * THE QUESTIONS NO RULE ANSWERS ARE NAMED TOO. Whether a claim is worth testing, whether a cited
 * source says what the sentence claims — those take a reader, and the panel says so beside the
 * findings rather than letting an empty list speak for them.
 *
 * WHERE A FINDING IS. Each finding names the section or the float it is about, and the objects it
 * names are the labels the paper prints, so a reader can go and look at the thing the rule is
 * talking about rather than at a line number in a file they do not have.
 *
 * READ-ONLY. It reports; it decides nothing, and it offers no control — a finding is answered by a
 * revision request or by a person's judgement, and both live in the panels that own them.
 *
 * IT CARRIES `data-research-quality-*` ATTRIBUTES because a browser acceptance reads this panel
 * against the manifest the deployment just wrote, and a page that rendered an empty list for a report
 * it never received would otherwise be indistinguishable from one whose report had no findings. The
 * attributes name the code, the outcome and the question, so the reading is of the report and not of
 * this file's markup.
 */
import { selectQuality } from '../../panels.ts'
import type { PanelProps } from './shared.ts'
import css from './ResearchWorkbench.module.css'

/**
 * The locale key for each finding code, spelled out rather than composed.
 *
 * A TEMPLATE KEY IS NOT A LOCALE KEY: the dictionaries are typed, so `quality.finding.${code}` is
 * `string` and the translate function refuses it — which is the type system saying that a code with
 * no entry would render as its own key to a reader. An explicit map makes a new finding code a
 * compile error here until it has copy in both languages.
 */
const FINDING_LABEL = {
  'uncited-object': 'quality.finding.uncited-object',
  'unrendered-object': 'quality.finding.unrendered-object',
  'unsupported-statement': 'quality.finding.unsupported-statement',
  'metric-misread': 'quality.finding.metric-misread',
  'no-literature-position': 'quality.finding.no-literature-position',
} as const

/** The locale key for each check outcome; see {@link FINDING_LABEL} for why it is spelled out. */
const OUTCOME_LABEL = {
  'defect-found': 'quality.outcome.defect-found',
  'no-defect-found': 'quality.outcome.no-defect-found',
  'not-applicable': 'quality.outcome.not-applicable',
  'not-executed': 'quality.outcome.not-executed',
} as const

/** The key for one finding code, or undefined when this build has no copy for it. */
function findingLabel(code: string): (typeof FINDING_LABEL)[keyof typeof FINDING_LABEL] | undefined {
  return (FINDING_LABEL as Readonly<Record<string, (typeof FINDING_LABEL)[keyof typeof FINDING_LABEL]>>)[code]
}

/** The key for one check outcome, or undefined when this build has no copy for it. */
function outcomeLabel(outcome: string): (typeof OUTCOME_LABEL)[keyof typeof OUTCOME_LABEL] | undefined {
  return (OUTCOME_LABEL as Readonly<Record<string, (typeof OUTCOME_LABEL)[keyof typeof OUTCOME_LABEL]>>)[outcome]
}

/**
 * Render the quality baseline's report for the package on screen.
 *
 * @param props - the flattened run summary and the `research` translate `t`.
 */
export function QualityPanel({ summary, t }: PanelProps) {
  const quality = selectQuality(summary)

  if (quality === null) {
    return (
      <section className={css.panel} data-research-quality="no-package">
        <h3 className={css.panelHeader}>{t('quality.title')}</h3>
        {/* NO PACKAGE, NO REPORT — said as its own state. A panel that rendered "no findings" here
            would be reporting a clean manuscript for a run that has not exported one. */}
        <p className={css.empty} data-research-quality-empty="">{t('quality.noPackage')}</p>
      </section>
    )
  }

  return (
    <section className={css.panel} data-research-quality="report">
      <h3 className={css.panelHeader}>{t('quality.title')}</h3>
      {/* THE REPORT'S OWN SENTENCE, untranslated: it is composed from the run's numbers and states
          what the report IS. A view that paraphrased it could say something the report does not. */}
      <p className={css.note}>{quality.summary}</p>

      <h4 className={css.panelHeader}>{t('quality.findings')}</h4>
      {quality.findings.length === 0
        ? <p className={css.empty}>{t('quality.noFindings')}</p>
        : (
          <ul className={css.list}>
            {quality.findings.map((finding, index) => {
              const label = findingLabel(finding.code)
              return (
                <li
                  key={`${finding.code}-${finding.where}-${String(index)}`}
                  className={css.cell}
                  data-research-quality-finding={finding.code}
                >
                  {/* A CODE WITH NO COPY RENDERS AS ITSELF, so a finding added without a translation is
                    visible on the page rather than silently labelled with an empty string. */}
                  <span className={css.tag}>
                    {label === undefined ? finding.code : t(label, { where: finding.where })}
                  </span>
                  <div className={css.summary}>{finding.detail}</div>
                  {/* THE EVIDENCE, verbatim: the text or value the finding rests on, so a reader checks
                    it rather than believing the rule. */}
                  <div className={css.note}>{finding.evidence}</div>
                </li>
              )
            })}
          </ul>
        )}

      <h4 className={css.panelHeader}>{t('quality.checks')}</h4>
      <ul className={css.list}>
        {quality.checks.map((check) => {
          const label = outcomeLabel(check.outcome)
          return (
            <li
              key={check.code}
              className={css.cell}
              data-research-quality-check={check.code}
              data-research-quality-outcome={check.outcome}
            >
              <span className={css.tag}>
                {label === undefined ? check.outcome : t(label)}
              </span>
              <div className={css.summary}>{check.asks}</div>
              {check.reason === undefined ? null : <div className={css.note}>{check.reason}</div>}
            </li>
          )
        })}
      </ul>

      <h4 className={css.panelHeader}>{t('quality.domainReview')}</h4>
      <p className={css.note}>{t('quality.domainReviewNote')}</p>
      <ul className={css.list}>
        {quality.domainReview.map(item => (
          <li key={item.id} className={css.cell} data-research-quality-domain={item.id}>
            <div className={css.summary}>{item.asks}</div>
          </li>
        ))}
      </ul>
    </section>
  )
}
