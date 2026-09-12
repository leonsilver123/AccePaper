# D0 — WBS 过期措辞更正(独立文档任务,git 恢复后单独提交)

> 用途:授权更正(用户 2026-09-04 裁决),作为独立文档提交,不混入功能代码。
> 提交时仅含本文件所述两处 WBS 行更正,单独 commit。

## 更正 1 — 05_execution_wbs.md T21 行(约 :104)

**原文(过期)**:`| T21 | P3.2 | red-team agent fleet:异质 prompt(多角色/流派)| IMPL | T20 | red-team agents | T20 | 串行 | 多流派反驳 | C3 同族降级确认 | same-family 局限 |`

**问题**:裁决格写 "C3 同族降级确认",暗示 C3 待裁决——已过期。

**更正为**:`C3 已裁决(D12):同族模型 + persona/prompt 差异化 + 外部锚;效果待 Golden Set 验证`

(依据:用户 2026-09-02 U1→D12,最终执行计划 §24.1 接受三重补强;DEC-005 已记录)

## 更正 2 — 05_execution_wbs.md T26 行(约 :108)

**原文(过期)**:`| T26 | P4.2 | 双面包插件:node ESM+browser CJS factory,clientBundle lazy-CJS | IMPL | T25 | 双面包插件 | T25 | 串行 | clientBundle build pass+purity gate | J2 ./client exports 不准确(F-W7) | lazy-CJS 复刻 |`

**问题**:裁决格写 "J2 ./client exports 不准确(F-W7)"——已被 AUD-01 证伪(J2 是审计误判,非代码缺陷;仓库 ./client exports 一致准确)。

**更正为**:`J2 已解除(AUD-01 证伪,./client exports 一致准确;以 ui-skill 为模板,DEC-002)`

(依据:07_audit_findings.md:25/89、t26-exports-verdict-input.md、DEC-002)

## 附注
- 两处均为**措辞更正**,不改变任何 WBS 任务定义/依赖/门禁语义。
- 提交信息建议:`docs(overnight): correct stale WBS wording — T21 C3 resolved (D12), T26 J2 cleared (AUD-01)`

## 执行状态更新(2026-09-04 11:5x)
- **实际落盘**:两处更正已直接应用到 `D:\1\plan\05_execution_wbs.md`(第 103 行 T21 C3、第 108 行 T26 J2),已验证。
- **提交说明**:WBS 位于 git 仓库外(`D:\1\plan\`,非代码仓库 `D:\1\deepseek-harness-stable-20260904` 的跟踪路径)——仓库内无 WBS 副本,故**无 git 提交产生**;本更正属仓库外规划文档变更,已在规划层生效。
- 若需仓库内留痕,可将本 D0 文档移入仓库 `docs/` 或随下次功能提交附注;按"不混入功能代码"原则,保持独立即可。
