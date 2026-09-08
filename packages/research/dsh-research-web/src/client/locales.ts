/** `research` namespace dictionaries for the research view (T26). */

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
} as const

/** The research dictionary key union. */
export type ResearchKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The research view copy (T26). */
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
}
