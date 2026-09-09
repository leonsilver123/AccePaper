/** `research` namespace dictionaries for the research view (T26–T29). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'research'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'view.research': '科研',
  'mock.badge': '演示数据 (MOCK)',
  'header.runId': '运行 ID',
  'header.status': '状态',
  'section.steps': '步骤进度',
  'section.artifacts': '产物',
  'section.gates': '评审历史',
  'section.abstentions': '弃审记录',
  'section.degradations': '降级标注',
  'section.humanPending': '待人工处理',
  'steps.total': '共 {total} 步',
  'steps.byStatus': '通过 {passed} · 进行中 {in_progress} · 待审 {gated} · 阻塞 {blocked} · 失败 {failed} · 未开始 {pending}',
  'step.attempt': '第 {n} 次尝试',
  'step.humanGate': '人工门',
  'step.holdReason.human_gate': '等待人工裁决',
  'step.holdReason.gate_abstained': '评审弃审冻结',
  'artifacts.count': '{valid}/{total} 有效',
  'artifacts.invalidated': '已失效',
  'gate.component': '组件 {component}',
  'gate.outcome.passed': '通过',
  'gate.outcome.blocked': '阻塞',
  'gate.outcome.failed': '失败',
  'gate.outcome.abstained': '弃审',
  'humanPending.note': '以下步骤需要人工裁决，不会自动完成：',
  'humanPending.empty': '无待人工处理步骤',
  'abstention.reason': '原因 {code}',
  'status.running': '运行中',
  'status.completed': '已完成',
  'status.abstained': '已弃审',
  'status.failed': '失败',
  'status.degraded': '已降级',
  'status.pending': '未开始',
  'status.in_progress': '进行中',
  'status.gated': '待审',
  'status.blocked': '阻塞',
  'status.passed': '通过',
  'status.failed.step': '失败',
  'degradation.kind.quality': '质量',
  'degradation.kind.timeout': '超时',
  'degradation.kind.fallback': '回退',
  'degradation.kind.coverage': '覆盖',

  // --- T27–T29 workbench tab nav (shared) ---
  'tab.summary': '概览',
  'tab.pipeline': '流水线',
  'tab.figures': '图表',
  'tab.tables': '表格',
  'tab.roadmap': '路线图',
  'tab.gates': '评审闸门',
  'tab.adversarial': '对抗红队',
  'tab.approval': '人工审批',
  'tab.recovery': '会话恢复',

  // --- Pipeline panel (T27) ---
  'pipeline.title': '16 步研究流水线',
  'pipeline.phase': '阶段 {phase}',
  'pipeline.empty': '无步骤',
  'pipeline.attempt': '第 {n} 次',

  // --- Figures / Tables panels (T28) ---
  'artifacts.figures.none': '暂无图形产物（阶段 D 图合成 s13 尚未产出）',
  'artifacts.tables.none': '暂无表格产物（阶段 D 表合成 s14 尚未产出）',
  'artifacts.kind': '类型 {kind}',
  'artifacts.figure': '图',
  'artifacts.table': '表',
  'artifacts.other': '其他',

  // --- Roadmap panel (T27) ---
  'roadmap.title': '研究路线图（阶段 A–E）',
  'roadmap.phase.summary': '阶段 {phase}：{passed}/{total} 步通过',
  'roadmap.total': '共 {phases} 阶段 · {passed}/{total} 步通过',

  // --- Gate panel (T29) ---
  'gate.title': '三一评审闸门（组件 A/B/C）',
  'gate.empty': '无评审记录',

  // --- Adversarial red-team panel (T29) ---
  'adversarial.title': '对抗红队审查（组件 A）',
  'adversarial.note': '组件 A 无法达成裁决时冻结而非失败。',
  'adversarial.steps': '对抗相关步骤',
  'adversarial.artifact': '红队报告产物',
  'adversarial.abstention': '评审弃审冻结（组件 A）',
  'adversarial.empty': '无对抗记录',

  // --- Human approval panel (人工审批) ---
  'approval.title': '人工审批（E2 待人工步骤）',
  'approval.note': '以下人工门步骤需裁决；按钮仅本地演示，不调用真实网关。',
  'approval.empty': '无待人工审批步骤',
  'approval.approve': '批准',
  'approval.reject': '驳回',
  'approval.decided.approved': '已批准（演示）',
  'approval.decided.rejected': '已驳回（演示）',

  // --- Session recovery panel (会话恢复) ---
  'recovery.title': '会话恢复（演示快照）',
  'recovery.note': '以下运行快照可恢复；按钮仅本地重新载入演示数据。',
  'recovery.runId': '运行 ID',
  'recovery.status': '状态',
  'recovery.steps': '步骤',
  'recovery.artifacts': '产物',
  'recovery.abstention': '含弃审',
  'recovery.degradation': '含降级',
  'recovery.reload': '从快照恢复',
  'recovery.restored': '已重新载入演示快照（演示）',
  'recovery.yes': '是',
  'recovery.no': '否',
} as const

/** The research dictionary key union. */
export type ResearchKey = keyof typeof zh

/** Strongly-typed translate for the `research` namespace. */
export type ResearchT = import('@deepseek-ai/dsh-client-ui-slots').TranslateNS<'research'>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The research view copy (T26–T29). */
    research: ResearchKey
  }
}

/** English dictionary, checked complete against the Chinese source of truth. */
export const en: Record<ResearchKey, string> = {
  'view.research': 'Research',
  'mock.badge': 'Demo data (MOCK)',
  'header.runId': 'Run ID',
  'header.status': 'Status',
  'section.steps': 'Step progress',
  'section.artifacts': 'Artifacts',
  'section.gates': 'Gate history',
  'section.abstentions': 'Abstention records',
  'section.degradations': 'Degradation notes',
  'section.humanPending': 'Awaiting human',
  'steps.total': '{total} steps',
  'steps.byStatus': 'passed {passed} · in-progress {in_progress} · gated {gated} · blocked {blocked} · failed {failed} · pending {pending}',
  'step.attempt': 'attempt {n}',
  'step.humanGate': 'human gate',
  'step.holdReason.human_gate': 'awaiting human decision',
  'step.holdReason.gate_abstained': 'gate abstained (frozen)',
  'artifacts.count': '{valid}/{total} valid',
  'artifacts.invalidated': 'invalidated',
  'gate.component': 'component {component}',
  'gate.outcome.passed': 'passed',
  'gate.outcome.blocked': 'blocked',
  'gate.outcome.failed': 'failed',
  'gate.outcome.abstained': 'abstained',
  'humanPending.note': 'These steps require a human decision and are NOT auto-completed:',
  'humanPending.empty': 'No steps awaiting a human',
  'abstention.reason': 'reason {code}',
  'status.running': 'running',
  'status.completed': 'completed',
  'status.abstained': 'abstained',
  'status.failed': 'failed',
  'status.degraded': 'degraded',
  'status.pending': 'pending',
  'status.in_progress': 'in-progress',
  'status.gated': 'gated',
  'status.blocked': 'blocked',
  'status.passed': 'passed',
  'status.failed.step': 'failed',
  'degradation.kind.quality': 'quality',
  'degradation.kind.timeout': 'timeout',
  'degradation.kind.fallback': 'fallback',
  'degradation.kind.coverage': 'coverage',

  'tab.summary': 'Summary',
  'tab.pipeline': 'Pipeline',
  'tab.figures': 'Figures',
  'tab.tables': 'Tables',
  'tab.roadmap': 'Roadmap',
  'tab.gates': 'Gates',
  'tab.adversarial': 'Adversarial',
  'tab.approval': 'Approval',
  'tab.recovery': 'Recovery',

  'pipeline.title': '16-step research pipeline',
  'pipeline.phase': 'Phase {phase}',
  'pipeline.empty': 'No steps',
  'pipeline.attempt': 'attempt {n}',

  'artifacts.figures.none': 'No figure artifacts yet (phase D figure synthesis s13 has not produced output)',
  'artifacts.tables.none': 'No table artifacts yet (phase D table synthesis s14 has not produced output)',
  'artifacts.kind': 'kind {kind}',
  'artifacts.figure': 'figure',
  'artifacts.table': 'table',
  'artifacts.other': 'other',

  'roadmap.title': 'Research roadmap (phases A–E)',
  'roadmap.phase.summary': 'Phase {phase}: {passed}/{total} steps passed',
  'roadmap.total': '{phases} phases · {passed}/{total} steps passed',

  'gate.title': 'Trinity gate verdicts (components A/B/C)',
  'gate.empty': 'No gate records',

  'adversarial.title': 'Adversarial red-team review (component A)',
  'adversarial.note': 'When component A cannot reach a verdict it freezes rather than failing.',
  'adversarial.steps': 'Adversarial steps',
  'adversarial.artifact': 'Red-team report artifact',
  'adversarial.abstention': 'Gate abstention freeze (component A)',
  'adversarial.empty': 'No adversarial records',

  'approval.title': 'Human approval (E2 pending steps)',
  'approval.note': 'The following human-gate steps need a decision; the buttons are local-only demo and call no real gateway.',
  'approval.empty': 'No steps awaiting human approval',
  'approval.approve': 'Approve',
  'approval.reject': 'Reject',
  'approval.decided.approved': 'Approved (demo)',
  'approval.decided.rejected': 'Rejected (demo)',

  'recovery.title': 'Session recovery (demo snapshot)',
  'recovery.note': 'The run snapshot below can be recovered; the button only reloads demo data locally.',
  'recovery.runId': 'Run ID',
  'recovery.status': 'Status',
  'recovery.steps': 'Steps',
  'recovery.artifacts': 'Artifacts',
  'recovery.abstention': 'Has abstention',
  'recovery.degradation': 'Has degradation',
  'recovery.reload': 'Restore from snapshot',
  'recovery.restored': 'Demo snapshot reloaded (demo)',
  'recovery.yes': 'yes',
  'recovery.no': 'no',
}
