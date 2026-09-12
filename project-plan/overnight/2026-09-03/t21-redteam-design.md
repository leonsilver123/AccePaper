# T21 设计规格：red-team agent fleet（P3.2，设计前侦察产出）

> Agent: general-purpose-22 ｜ 2026-09-03 ｜ 只读侦察；仓库零改动。依据：WBS T21 行(05:103)、冲突裁决 3 与 A4/A9(01_fact_baseline:171/221/266)、D12(§24.1)、t20-design-spec/recon、`dsh-research-core/src/contracts.ts`、subagent 源码(types/child-agent/continuation/fork)。本文件是唯一规格，≤100 行。

## 0. 目标与触发点
- 目标：在 L2 判断点 A 机制（red-team 反驳 + judge 投票）前，产出**多角色/多流派异质反驳**；fleet 只反不裁（裁决权=judge T22 + gate A 纯函数）。
- 触发点（Trinity gate 映射，final:211）：`A2/B1` gate=['A','C']、`C2-trinity-loop` gate=['A','B','C']。即 claim 可证伪对抗(A2)、方法推导(B1)、三合一收敛循环(C2 每轮迭代)三个判断点各开一轮 rebuttal round。
- 每轮：fleet 逐角色输出 `position ∈ support|refute|abstain + rationale` → 组 `AdjudicationVote[]`(contracts.ts:239) → T22/judge 计数。弃权/阈值一律 abstain 缺省（D12：固定阈值须经 T36 Golden Set 校准，不硬编码 ≥2）。

## 1. persona 注入机制（源码级结论，异质实现路径）
- `request.persona`(string)→ 创建/冷恢复时写入子 Agent `deployment:persona` **system-prompt 段**，shadowing 部署 persona，严格 `{{…}}` 插值（subagent types.ts:150-156；child-agent.ts:210-217）；**descriptor 持久化，cold-resume 自动重放**（continuation.ts:1018）。
- `request.toolFilter` → `childCtx.tools.restrict`（工具名级，持久）；`request.agentOptions` → provider/model/reasoning-effort 覆写（types.ts:121-127，in-process 合并于父路由）。
- provider：`fork`= 继承 Lead completed-turn 前缀一次性 seed（fork-in-process:70-90）；`spawn`= 无 seed 全新。均为全能力+prepareContinuable。
- **异质机制排序**：① persona 字符串（角色/流派，最强，同族下唯一真"观点"杠杆）→ ② 角色化任务 prompt 模板 → ③ agentOptions.model 在 flash/pro 间铺开 → ④ provider 选型（默认全 `spawn`/fresh，保独立；需全辩论史的角色才 `fork`）。**不依赖模型族差异（D8 下不可得，D12 已接受）**。

## 2. fleet 成员配置表（默认 5，可配置）
| name(小写唯一) | 角色 persona | 流派/反驳侧重 | model | toolFilter |
|---|---|---|---|---|
| red-method | 学术审稿人(方法学) | 内部效度/基线公平/评测漏洞 | pro | 只读集 |
| red-stat | 统计学家 | 显著性/p 值/CI-SD-SE/效应量误用 | flash | 只读集 |
| red-domain | 交通工程师(领域) | 数据真实/场景适用/落地可行 | pro | 只读集 |
| red-skeptic | 怀疑论者(魔鬼代言) | 先验可疑性/过度声称/外部效度，默认 refute 立场 | flash | 只读集 |
| red-cross | 交叉审稿人(CS×交通) | 方法迁移相关性/跨域推广 | flash | 只读集 |
- persona 文本静态（不用 {{var}}）；角色默认立场仅倾向非硬约束（可 abstain）。只读集 = 引用核验/L0/SOTA/复现等读工具 allow-list（T19 后注入；未接前为空，测试用 mock）。

## 3. 与 T20 roster/task-board 交互
- **建队**：Lead 经 `agentTeams.spawnMember`（index.ts:151）建 5 成员。**需 T21 扩展** `SpawnMemberRequest`：新增 `persona?/agentOptions?/toolFilter?`，roster.spawnMember 透传进 `startContinuable.request`（现仅 prompt+parent，roster.ts:253-259）；description=角色 charter 首条消息，context 默认 `'fresh'`。
- **领反驳任务**：每 (claim, 判断点, 角色) 一任务。Lead `createTask`(writeScopes=[]) → board CAS 认领/分派 ownerId=成员 → `subagents.sendMessage(lead→member)` 投递 assignment（claim+证据包+判断点上下文；成员独立 FIFO inbox 持久，冷恢复后投递保留）。
- **write-scope 边界**：成员 writeScopes=[] ⇒ 全局 guard 对非 Lead 写默认 deny；toolFilter 只读 ⇒ 工具面收窄；嵌套 one-shot 写归最近成员 lineage（roster.ts:108-141）。**fleet 永不写稿件/claim 目录**。
- **回报**：成员 `sendMessage(→lead)` 回结构化 rebuttal（role/position/rationale）；Lead 以唯一写者记 `research/rebuttal` 事件（journal+SessionEventMap 扩展）+ board complete。重复投票拒。
- 裁决权边界：fleet 输出只进 gate A 输入，不经 fleet 自裁；`voterRole=role name`、`modelFamily` 取自成员 options.model → 同族可被 gate 检出（contracts.ts:235-244；gates/index.ts:152）。

## 4. C3 降级约束下的取舍
- 承认同族局限：flash/pro 错误相关，非真异质；对抗有效性仅靠 persona+prompt 观点分异 + 外部锚(B) 补强（D12/A4/A9）。fleet 不伪装异质——同族簇由 gate `sameFamilyClusters` 显式上报。
- 步骤 9（三合一，最重认知）保留人领域锚：fleet refute 可 blocked，**永不能单独 pass**；judge 聚合 + L4 抽样人审计兜底。
- 阈值纪律：任何 ≥N 通过阈值在 T36 前一律 abstain（沿 T09 gates 契约，无隐含常量）。
- 跨族引入：仅在 Golden Set 量化不达标后触发（D12），届时需用户再裁；本次实现不做。

## 5. 验收清单
纯逻辑单测（vitest，无 ctx）：
- personas/fleet-config：角色名唯一小写 kebab、persona 非空、非法 model/重复 role 拒绝、默认 5 员确定性、只读 filter 校验。
- rebuttal 映射：消息→`AdjudicationVote` 字段契约（voterRole/modelFamily/position 合法性、空 rationale 拒）；未知 role 拒；重复投票拒；round 状态机 pending→submitted→completed 幂等。
Host 集成（mock services，同 T20 host spec 组合）：
- spawn：persona/agentOptions/toolFilter 确实透传至 `startContinuable` 且入 descriptor；member view 暴露 model。
- 冷恢复回归：fleet 成员 persona 保留、guard 仍生效、越界写被拒（DEC-003 免 per-activation 重装）。
- 全轮次：create→分派→投递→只读清单→回 vote→lead 落 rebuttal 事件+complete；vote[] 喂 dsh-research-core gate A 纯函数返回正确裁决（含同族簇上报）。
- E2E（T35 后）：A2/B1/C2 每轮前必有 ≥3 角色 rebuttal 到位，不足则 round blocked（不入 judge）。

## 6. 明确不做
- 不引入跨族 provider、不伪造模型异质；不实现 judge/T22（只定义 vote 输出契约）；不改 subagent/experimental（F-W3/X8）；不做成员主动写稿。模块放 dsh-research-team/src/redteam/（纯：personas/fleet-config/rebuttal；adapter：orchestrator+index 接线），路径由主 Agent 实现时定。

## 附：裁决请求
- 无需新用户裁决：C3 已由用户 U1→D12（2026-09-02）定案"接受三重补强降级"，WBS T21 行"C3 待裁决"为过期措辞（最终计划 §24.1/差异清单已录）。
- 两项设计参数自动默认（可回滚，DEC-004 先例）：① 默认 5 角色集合；② roster SpawnMemberRequest 透传 persona/agentOptions/toolFilter 的向后兼容扩展。
