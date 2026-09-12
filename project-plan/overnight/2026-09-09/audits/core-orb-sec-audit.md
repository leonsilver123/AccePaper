# core 编排 API 安全审计(core-orb-sec-audit, 只读, 对象 c98e648 Wave2 API)

- 状态:**条件通过**(CONDITIONAL PASS),1 P1 + 5 P2。
- 闭环登记: P1-1、P2-2、P2-3 已于 commit **46fbc54** 关闭;P2-1/P2-4/P2-5 维持 OPEN/延迟(见各条)。
- 复测基线: core 261 + tools/team 616 = **877/877 全绿**;core tsc exit 0;变更文件 oxlint 0。

## 发现与处置

### P1-1(已闭环,46fbc54)— 可变 STEP_BY_ID Map 可被换入伪造定义,静默关闭 E2 人工闸门
- 风险: `STEP_BY_ID` 是 `Map`,其 internal state 不受 `Object.freeze` 保护。任何能触达该符号的代码可
  `STEP_BY_ID.set('E2-submit', { ...def, humanGate:false })`,随后每个守卫(canStart/startStep/runStep/
  submitGateVerdict/completeStep/_applyHumanApproval/isComplete)都读被替换定义 → 系统唯一红线(E2 人工闸门)
  被静默关闭。审计以"经文件路径 import 构建产物 chunk"端到端复现。
- 修复: 删除可变 `Map`,改 `lookupStep(stepId)` 直接扫描深冻结的 `STEPS` 数组。无映射可换、值冻结 →
  篡改路径彻底移除。`getStepDefinitionById` 与 `getStepDefinitions` 现读同一数组,二者不可能再不一致。
- 证据: packages/research/dsh-research-core/src/engine/steps.ts(lookupStep)、steps-accessor.ts、
  state-machine.ts(全 `STEP_BY_ID.get(` → `lookupStep()`)。

### P2-1(OPEN / 延迟,低风险)— recordArtifact 公共导出可绕过 runStep 执行
- 风险: `recordArtifact` 在公共 index 导出,调用方可直接写 artifact 而不经 `runStep`,从而不产生
  `step-executed` 审计事件。
- 处置: 暂不移除。执行器仍需 `recordArtifact` 写产物;路由收窄需配套改 `runStep` 成为唯一写入口并补
  测试。列为 P2 存量,待 Task #13(七工具注册)后统一评估是否收窄导出面。不阻塞本次交付。

### P2-2(已闭环,46fbc54)— getRunSnapshot 返回可变快照,可伪造 human-approval 时间线
- 风险: `snapshot.events.push({kind:'human-approval'})` 成功,下游(报告/UI/裁决日志)读到被伪造时间线;
  core 内部 state 虽正确,但消费方被误导。
- 修复: `getRunSnapshot` 构建 `snapshot` 后调用 `deepFreezeSnapshot(snapshot)` 再返回(递归冻结 events/
  steps/registry)。快照恒为新克隆,冻结不会 alias 内部 state。

### P2-3(已闭环,46fbc54)— snapshotStep 外泄内部(冻结)定义的 outputs 引用
- 风险: `snapshotStep` 原 `outputs: state.outputs` 直接返回内部数组引用。
- 修复: 改为 `outputs: [...state.outputs]`(克隆),即便未来解冻 `STEPS` 也不泄漏。

### P2-4(OPEN / 延迟,文档)— gate 结果映射文档与代码不一致
- 处置: 文档一致性,低优先级。待本轮实现落定后统一补 `docs/` 与审计结论对齐。

### P2-5(OPEN / 延迟,文档)— plan 契约滞后
- 处置: plan/ 下的步骤契约说明滞后于最新实现。待 T30 Bundle 前后统一刷新。

## 结论
核心编排 API 的可变面已收敛为不可变(步骤定义 + 快照),唯一红线 E2 人工闸门在源码层面不可被换定义关闭。
剩余 P2-1/P2-4/P2-5 均为导出面收窄或文档一致性,非阻断项。审计通过。
