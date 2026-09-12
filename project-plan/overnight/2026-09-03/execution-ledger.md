# Execution Ledger (append-only)

## 2026-09-03 19:45 — wave-0 侦察启动(主 Agent)
- 背景:批次2 P2 收口完成(恢复提交 96c7f1c,审计 PASS);用户授权过夜全程序解锁(P3/P4)。
- 依 WBS 纪律:被裁决阻塞的实现不盲启;先跑无阻塞侦察轨道产出决策输入。

## 2026-09-03 19:5x — gp-21 T25 slot 裁决侦察 完成
- 产出:plan/overnight/2026-09-03/t25-slot-verdict-input.md(62 行)
- 结论:conversation.view 真实可用(加 id 'research' tab);side.panel 不存在(F-W6 坐实);details 单例已占用。
- 主推方案 A(纯增量注册);无 P0;P1=U3 设计决策(是否需"同时同屏")。
- 记录:DEC-001(默认方案 A,待 U3 确认)。

## 2026-09-03 20:0x — gp-22 T20 ctx.subagents 侦察 完成
- 产出:plan/overnight/2026-09-03/t20-ctxsubagents-recon.md(64 行)
- 结论:ctx.subagents(SubagentRuntime)能力面完整覆盖 experimental agent-team;durable CAS/owner/持久化需自建(SessionEventMap+根 session log);write-scope 需 tools guard/waterfall 层强制(experimental 仅 advisory)。
- openQuestion#7 初步判定"可复现";无 P0/P1;需 PoC 验证 5 点(见报告 d 节)。

## 2026-09-03 20:1x — gp-21 T26 J2 exports 核验 完成
- 产出:plan/overnight/2026-09-03/t26-exports-verdict-input.md(47 行)
- 结论:J2 系 A1 审计误判(AUD-01 已证伪返工);仓库 ./client exports 一致准确;双面包惯例=clientBundle 预设三名锁步。
- dsh-research-web exports 设计直接可用(ui-skill 模板);无 P0/P1;P2=过期措辞/跨插件 value-import/漏配 platform。
- 记录:DEC-002(J2 阻塞解除,T26 exports 面按 ui-skill 模板)。

## 2026-09-03 20:2x — gp-22 T20-R1 guard 时序 PoC 完成
- 产出:plan/overnight/2026-09-03/t20-poc-guard-timing.md(43 行)
- 静态结论:guard 在 agent.ctx 上不自动重装(agent.ctx 每 activation 全新;continuation setup 仅重放 persona+toolFilter);但 agent/created 在 publish 内同步、先于首个工具调用。
- **首选方案:单一全局 guard(root ctx.tools.guard)+ 执行期按 exec.agent.id→durable 成员表实时判定** → 免疫 R1 时序,无需探针。
- 无 P0/P1;残余低危 PoC:P-a 全局 guard 放行回归、P-b exec.agent lineage。
- 记录:DEC-003(write-scope 强制=global guard + 执行期判定;弃 per-activation 注入)。

## 2026-09-03 20:4x — gp-26 科研质量资产 完成
- 产出:quality-rules-dictionaries.md(76 行:交通指标字典 24 条 + p值星号/CI-SD-SE/百分比-小数位规则,标注待校准)
- security-fixture-checklist.md(85 行:T12-T17 安全反例结构 35 条,无攻击载荷)
- 均为结构资产,仓库零改动;供 P6 Golden Set 与工具测试落地引用。

## 2026-09-03 21:0x — T20 纯逻辑层实现 + 汇合 完成
- gp-22 实现(src: types/revision/projection/scope-guard;tests 4 spec 79 测试);独立复跑 tsc 0 错 + vitest 79 绿 + per-file 100%。
- 主 Agent 汇合提交(路径限定):T20 pure-logic commit(4 src + 4 spec + scaffold)。
- DEC-004 默认已实现(lead 豁免/单写任务语义在 task action 约束/双 CAS 对象)。adapter 层(session-events/journal/roster/task-board guard 接线)留下一轮。

## ⚠️ 环境症状记录(重复出现)
- 症状:git commit 成功(reflog 记录新 hash)但 `refs/heads/overnight/2026-09-03` 文件在 commit 后被删/移走,git log 报 "does not have any commits yet",status 误报数千文件。
- 处置:查 reflog 定位真实 commit hash → mkdir -p refs/heads/overnight → printf hash > ref 文件 → 恢复。
- 规律:master(refs/heads/master)不受影响;仅子路径分支 ref 消失。疑 WorkBuddy modify_backup 对 refs 树监控干扰。
- 对策:每次 commit 后立即 `git log --oneline -1` + `git status --porcelain|wc -l` 验证;异常则按上述处置补 ref。备份 D:/1/dsh-git-recovery-backup/git-191317 仍有效。

## 2026-09-03 21:1x — T20 纯逻辑层汇合 确认
- commit 6e787a39 已就位(reflog 实证),工作树干净。T20 纯逻辑层完成。下一轮:adapter 层(session-events declare module / journal transact / roster / task-board / guard 接线)+ host 集成测试。

## 2026-09-03 21:5x — T20 adapter 层 完成 + 汇合
- gp-22 两轮完成:adapter 6 src + index.ts + host-integration.spec(16 host 测试);oxlint 清零(含修复 revision.spec 类型导入 bug、branded cast、调试死代码)。
- 主 Agent 修复 tsconfig(加 12 project references,仿 agent-team)→ tsc 0。
- 独立复跑:vitest 5 files/95 passed、tsc exit 0。
- 汇合提交 ce5d0c0;探针/残留日志已清理。
- T20 累计:纯逻辑层(6e787a3)+ deps(1357f13)+ adapter(ce5d0c0);95 测试全绿。

## 2026-09-03 22:3x — T20 审计 P2 修复 + 汇合
- gp-31 独立审计 PASS(报告 t20-independent-audit.md;7 冻结约束+DEC-004 全落实;P2-1/P2-2 建议)。
- gp-22 修复:P2-2 guard fail-closed(3-state classify:member/not-member/unattributed;unattributed→deny)+ P2-1 文档决策(one-shot 按非成员放行,注释于 roster.ts 头)。
- 独立复跑:tsc 0、vitest 97(95+2);汇合提交 1b56abf。
- **T20 全链完成**:6e787a3(纯逻辑)→1357f13(deps)→ce5d0c0(adapter)→1b56abf(P2 fixes);97 测试;审计 PASS;DEC-004 默认实现。
- 环境 ref 症状每次 commit 后复现,已按规程恢复 4 次(6e787a3/1357f13/ce5d0c0/1b56abf)。

## 2026-09-03 23:5x — T21 red-team fleet 实现 + 汇合
- gp-22 实现(73m 运行,中断未发最终报告;主 Agent 验证产出):
  - redteam/ 4 文件 887 行:personas(5 角色+模型 tier+立场)/fleet-config/rebuttal(round 状态机)/orchestrator
  - roster SpawnMemberRequest 透传 persona/agentOptions/toolFilter(向后兼容)
  - research/rebuttal 事件 + session-events.spec
- 独立验证:tsc exit 0;vitest 9 files/**193 passed**(97 基础 + 96 新增);清理探针(__ignore-probe 等)与全部测试残留。
- 汇合提交 7ce683b;ref 症状恢复 5 次。
- **P3 进度**:T20 ✅(member-scope 地基,97 测试)→ T21 ✅(red-team fleet,193 测试)→ T22/T23/T24 待(judge vote/B 锚/C 裁决)。

## 2026-09-04 10:5x — 方案3 外置 git-dir 探针失败,转只读模式
- 外置 git-dir(D:/dsh-git-meta)checkout 卡死(1972 文件零增长),index.lock 同样被外部占用。
- 结论:环境干预针对 git 原子写行为(与 git-dir 位置无关)。git 写全部暂停。
- 预案执行:旧仓库/恢复仓库只读保留;只读模式:设计文档/测试矩阵/Fixture/任务清单;生产代码暂停。

## 2026-09-04 11:0x — 只读模式产出 1/2
- gp-37 交付 post-recovery-execution-checklist.md(65 行):10 项待办(D0 措辞+T18/T22/T23/T24/T26/T27/T28/T29;T25 参考行)+ 测试矩阵(11 任务×5 列)+ 依赖排序。
- 关键发现:gate A/B/C 纯函数已在 core;team 包 peer 不含 dsh-research-core(跨包契约 T22 定案);T21 审计 P2 建议并入 T22 前加固;T18 受 U4/U6 阻塞。

## 2026-09-04 11:1x — 只读模式产出 2/2
- gp-36 交付 t22-t24-design-spec.md(61 行):T22 judge(投影 completed rebuttal round→keep/drop/abstain,config 阈值缺省 abstain)+ T24 实验裁决(纯模块,mock/live 双源,拒"运行成功=支持",mock 标注不可升级);新增 judge.ts/experiment 模块+research/verdict+research/experiment 事件+core workspace 依赖。均内部默认,无需用户裁决。
- 只读模式产出完整:checklist(10 待办)+ T22/T24 规格 → git 恢复后可直接执行。

## 2026-09-04 11:2x — 只读模式产出 3/3
- gp-36 续交付 t23-external-anchor-design.md(60 行):L0/SOTA/复现三类锚→纯信号(support/contradict/inconclusive,全 Mock);不改 core gate B;新增 research/anchor 事件;src/anchor/ 模块树。无用户裁决项。
- 只读资产完整:D0(措辞)+T22/T24+T23+checklist → git 恢复后 P3 可直接实现;T26 规格(gp-39)在途。

## 2026-09-04 11:3x — T26 实现级规格完成,只读资产全部齐备
- gp-39 交付 t26-implementation-spec.md(75 行):dsh-research-web 双面包(ui-skill 六项 exports+conversation.view id 'research'/order 20+空 ResearchView);8 源文件+2 根级接线;P1 备忘=插件名需进宿主运行时使能清单(部署配置,接线方登记)。无裁决项。
- 恢复仓工作树损坏(client/ui-* 空+D 状态)——HEAD 树完整可用,已用 git show 只读读取交叉验证。
- **只读模式规划资产全部就绪**:D0 措辞 / T22/T24 规格 / T23 规格 / T26 实现规格 / 执行清单+测试矩阵 → git 恢复后 P3(T22-T24)+P4(T26)可直接按规格实现。
