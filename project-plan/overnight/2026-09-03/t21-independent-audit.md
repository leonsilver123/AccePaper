# T21 独立只读审计报告（P3.2 red-team fleet）

> Agent: general-purpose-35 ｜ 2026-09-04 ｜ 可信仓库 `D:/1/deepseek-harness-recovered-20260904`（只读）
> 审计对象：commit `7ce683b` 相对 `1b56abf` 的 diff（14 文件，+2462）。依据：t21-redteam-design.md + decisions.md DEC-005。
> 复跑说明：可信新仓库无 node_modules 且禁写（不可 pnpm install），验证命令在**同哈希同内容**的干净检出（HEAD=7ce683b，status 空）上执行；git 层面命令均在新仓库执行。

## (a) 10 项检查逐项结论

1. **persona 真实透传（含冷恢复）** PASS：roster.ts:323-325 将 persona/agentOptions/toolFilter 三可选字段透传进 `startContinuable.request`（缺省保持 absent，向后兼容）；orchestrator.deploy 构造请求（orchestrator.ts:129 persona=persona.persona、130 model override、131-133 toolFilter allow）；宿主 mock 将三字段快照入子 Session descriptor（host-integration.spec.ts:288-291），断言 persona/model 已在 descriptor 持久化（:896-907）——冷恢复可重放。
2. **toolFilter 默认最小权限** PASS（附 P2-4）：默认 5 persona 的 toolFilter 均为 `[]`（personas.ts:63/74/86/98/110），deploy 对空表**省略** toolFilter（orchestrator.ts:131-133；测试钉死 :901-902），子代工具**可见面=主机全量**。安全不依赖此层：全局 guard 对非 scopeChecked 工具一律 deny、对 scopeChecked 写须 in-scope claim（scope-guard.ts:78-94），fleet 任务 writeScopes=[]（orchestrator.ts:175）⇒ 任何写路径被拒，无越权。与设计 §2「T19 后注入，未接前为空」一致。
3. **同族如实标注** PASS：tier 仅是抽象 pro/flash（personas.ts:17-21），tier→host model 映射只在配置层 `modelRoute`（fleet-config.ts:66-85，未知 tier 拒）；modelFamily 取自成员**实际 live** `options.model`（orchestrator.ts:219-220），成员消息自报的 modelFamily 被丢弃，防伪；注释仅称"same-family 可被 gate 检出+降权"（types.ts:265-267），无跨族/异质声称。
4. **rebuttal 无死循环** PASS：状态机纯函数、单调单向（pending→submitted→completed），completed 幂等（rebuttal.ts:139-186）；仅 `allRolesVoted` 时 close（orchestrator.ts:241）；空 round close 被拒=blocked 不入 judge（rebuttal.ts:179-184）；无轮询/递归环。
5. **重复/迟到/完成后再投拒** PASS：重复同 role 投 → DUPLICATE_VOTE（rebuttal.ts:148-153）；round completed 后投 → INVALID_REBUTTAL（:139-141；纯测 rebuttal.spec.ts:172-183）；宿主重复投拒（host-integration.spec.ts:1041-1047）；迟到（离线）票可记录但无法促成完成（:1079-1103）。T21 无 round 取消 API，弃轮仍可投（依赖 Lead 不提交）；完成后/未知 round 均拒。
6. **member 身份防伪** PASS：submit 仅 Lead 可调（orchestrator.ts:199/262-271）；role→member 绑定来自 deploy 台账，`row.memberId !== input.voterId` 拒（:213-218）；冒充/错配/未部署 role/未知 round 均有宿主用例（host-integration.spec.ts:1105-1140）。modelFamily 以 live agent 为准不可伪造（见 #3）。
7. **跨 run/round 隔离** PASS（附 P2-3）：roundId=randomUUID 每轮独立（orchestrator.ts:164-166）；rebuttal 事件校验后**不 fold** 进 TeamState（projection.ts:61-69），不污染投影；事件带 teamId 且经 schema 边界（session-events.ts:135-142）。编排态仅内存，进程重启后不可恢复（见 P2-3）。
8. **roster 越权覆盖** PASS：spawnMember 仅 exact-live Lead 可调（roster.ts:273-279），成员无建队权；扩展字段可选、缺省即 absent（:323-325），默认行为不变；fleet 路径只透传 config 派生 model + 校验后的只读 allow 表（orchestrator.ts:130-133）。agentOptions 无 schema 校验但唯一可传者=Lead 自身权限内，无提权面。
9. **成员失败不致 fleet 卡死** PASS（附 P2-2）：deploy 失败成员置 failed+drain（roster.ts:329-344），failed 行不参与成员分类（:180）；round 只在全员投票后 completed，单成员永不投票则此轮 blocked（设计语义），不影响其他轮/其他成员；Lead 可按 role 子集轮询跳过（orchestrator.ts:153-156）。无超时属设计取舍。
10. **Mock/Unit 边界** PASS：宿主测试全部基于 in-memory stand-in + 真实 cordis Context（host-integration.spec.ts:1-16）；grep「真实对抗|Golden Set|已验证|跨族/异质声称」= 0 命中；persona 文本仅为角色指令；无任何"已 Golden Set 验证/真实对抗有效"措辞。

## (b) 验证命令结果

| 命令 | 结果 |
|---|---|
| `git diff --stat 1b56abf 7ce683b`（新仓库） | 14 files，+2462/-20，与声明一致 PASS |
| `git status --porcelain`（新仓库，审计前后） | 空 PASS |
| `tsc -p packages/research/dsh-research-team/tsconfig.json` | exit 0 PASS |
| `vitest --project thread-safe packages/research/dsh-research-team` | Test Files 9 passed / Tests **193 passed**，exit 0 PASS |

## (c) 问题分级（均 T21 自身；无 P0/P1）

- **P2-1（并发双记）**：submitRebuttal 在 await 之间（journal/任务完成）才 `rounds.set`（orchestrator.ts:221-243），同一 role 并发两次 submit 可在 in-memory round 未更新前双双通过 cast → 重复票+重复 durable 事件。仅 Lead 单写者场景低概率；建议 round 级 CAS/串行化。
- **P2-2（deploy 部分失败孤儿）**：deploy 循环中途某成员 spawn 抛错时，先前已 spawn 成员保持 live+rostered，但 fleetByLead 台账未落（orchestrator.ts:138 在循环后才 set）→ 无法 retry（roster 名复用拒），孤儿成员无台账。建议增量记账或回滚。
- **P2-3（编排态不可冷恢复）**：rounds/fleetByLead 仅内存，Lead 冷恢复后 FLEET_NOT_DEPLOYED 且 redeploy 被名复用拒；与设计验收"persona 保留/guard 生效"不冲突，但 E2E(T35) 前需补恢复/重建方案。附带 rounds Map 不淘汰的内存累积。
- **P2-4（默认工具面未收窄）**：空 toolFilter → deploy 省略字段 = 子代工具可见面全开，仅靠 guard 兜底。T19 只读工具接线时应显式将空表编码为 deny-all/allow 列表，避免 guard 配置漂移后裸奔（现无越权）。

## 结论

**PASS**（无 P0/P1）。10 项检查全部通过；tsc exit 0、vitest 193 passed；P2-1…P2-4 为加固/生命周期建议，不阻断 T21 合入，建议 T35 E2E 前按 P2-2/P2-3 补恢复路径。
