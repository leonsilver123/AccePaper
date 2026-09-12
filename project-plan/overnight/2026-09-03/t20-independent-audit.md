# T20 独立只读审计报告（dsh-research-team，P3.1）

> Agent: general-purpose-31 ｜ 2026-09-03 ｜ 仓库 `D:/1/deepseek-harness-master1/deepseek-harness-master`（只读）
> 审计对象：分支 overnight/2026-09-03 提交 6e787a3(纯逻辑) / 1357f13(依赖) / ce5d0c0(adapter)。
> 依据：t20-design-spec.md(§1-§6)、decisions.md(DEC-004)、t20-adapter-deps.md、t20-poc-guard-timing.md。

## (a) 冻结约束逐项核对表

| # | 约束 | 核对结果 |
|---|---|---|
| 1 | 不 import `@deepseek-ai/dsh-experimental-*` | PASS：全包 grep=0（src+tests，lib 忽略） |
| 2 | 不 import agent-team / code-runtime | PASS：grep=0；注释仅"mirroring agent-team"语义参考 |
| 3 | 不 shadow/包装 ctx.subagents | PASS：roster/index 直用 `ctx.subagents.startContinuable/drainContinuableChildren`，无 Proxy/属性改写/包装层 |
| 4 | 纯逻辑层零 host 依赖 | PASS：types.ts 零 import；revision/projection/scope-guard 仅 import `./types.ts`（见 import 清单逐行核） |
| 5 | 无真实密钥/网络/Date.now() 兜底 | PASS：src grep `Date.now|process.env|fetch|http|api_key|token|secret|child_process|node:net`=0；randomUUID 仅作 id 生成 |
| 6 | deep-freeze 语义 | PASS：types.freezeValue=structuredClone→递归 Object.freeze；nextSnapshot/fold 均出冻结副本 |
| 7 | write-scope 强制=全局 guard | PASS：index.ts:122 `installResearchGuard` 注册于插件 ctx(tools.guard)，唯一一次，ctx.effect 收集 disposer；无 per-activation 重装路径 |

## (b) DEC-004 实现核对

| 裁决 | 实现 | 核对 |
|---|---|---|
| U-A Lead 豁免 | scope-guard.ts:61 role==='lead'→undefined（在 decide 层，先于工具白名单）；task-board 授权对 lead 亦豁免 | PASS（claim 动作仍拒 lead，属 board 语义非 guard） |
| U-B 成员单写任务 | revision.ts:296(claim)/390(reassign 新 owner) `requireSingleActiveTask`；memberMayWrite(roster.ts:175-184) 扫描并集但结构上恒≤1 | PASS：无第二 in_progress 产生路径 |
| U-C 双 CAS | task 整值快照 revision 单调(projection:78) + rev 独立 `artifactRevs` 头(projection:83-88) + 'research/rev' 事件注入 | PASS：两跟踪对象并存；rev 硬断言(prevRevision)留待 P2 工具层，仅 fold 单调防护——与 §3 模块划分一致 |

## (c) 语义抽查发现（详见 e 级）

1. roster: name 小写 kebab 唯一且不重用（含 failed，无成员删除路径）；spawn 在 transact 内校验重复名；provisioning 事件先 appendAndFlush→再 startContinuable(childId 预保留)；reconcileProvisioning 以 sessionPersistence.inspect + foldSubagentDescriptor 判定 active/failed。宿主测试 6 覆盖 reconcile。PASS
2. task-board 与 revision.ts 授权矩阵一致（update 全委托 applyTaskAction；owner/lead vs 无关者矩阵 revision.spec:280-479 全覆盖）；CAS 在 journal.transact 内读-查-写，per-root 串行；冲突映射 team-task-conflict / 其余 team-rejected。PASS
3. SCOPE_CHECKED_TOOLS 依据充分：research-guard.ts:23-31 + index.ts:82-91 注明默认空集=deny-all 的保守姿态，配置项 scopeCheckedTools；依据 = spec §4 步骤 4 + §6 toolFilter 收窄 + poc-guard-timing §c。PASS（注释即依据）
4. 发现 P2-1：roster.tryMembership 对"成员嵌套 one-shot"解析为 undefined→非成员 passthrough，与 roster.ts:13-19 头注释及 spec §4"嵌套 one-shot 归最近成员 scope"不符；宿主测试仅覆盖 Lead 的 one-shot(=豁免同效)，无 teammate 嵌套用例 → PoC 残余 P-b 未闭环。
5. 发现 P2-2：成员 lineage 无法证明时 guard fail-open（Lead 不在 live 注册表 / 中间父不可达→passthrough 放行），而非 fail-closed；tryMembership 对"无法归属"与"真非成员"返回不可区分。

## (d) 验证命令结果

| 命令 | 结果 |
|---|---|
| `git log --oneline -4` | ce5d0c0 / 1357f13 / 6e787a3 / 96c7f1c（4 提交，含恢复基线）PASS |
| `git status --porcelain` | 空（审计前后均为空；pnpm 遗留临时文件已清除）PASS |
| `tsc --noEmit`（包目录，TS 6.0.3） | exit 0 PASS |
| vitest run packages/research/dsh-research-team/tests | Test Files 5 passed / Tests 95 passed（types 9 + projection 12 + scope-decide 15 + revision 43 + host-integration 16）exit 0 PASS |

## (e) 问题分级

- P0：无。
- P1：无。
- P2-1（成员嵌套 one-shot lineage）：guard 语义偏离文档 §4 与 roster 头注释；当前工具面（toolFilter=research 读写）下不可达；若成员工具面未来含 delegation/subagent 工具则升 P1。建议：实现最近成员归并或显式文档"one-shot 即非成员(放行)"并靠 toolFilter 兜底，二者取一。
- P2-2（guard fail-open）：成员 Lead 离线/lineage 不可证时越界写不受阻。建议 tryMembership 区分"可证非成员"与"无法归属"，后者 deny。

## 结论

**PASS**（无 P0/P1）。DEC-004 三项、冻结约束 7 项全部落实；95 测试与类型检查通过；两项 P2 为文档-实现偏差与 fail-open 健壮性建议，不阻断当前 P3.1 合并；建议 E2E(T35)前按 P2-1 决策并在宿主测试补 teammate 嵌套 one-shot 用例。
