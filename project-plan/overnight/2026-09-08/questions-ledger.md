# questions-ledger
## Q-01(2026-09-08):tsdown 配置处置(B 审计裁决 b)
- 问题:主 Agent 本轮新建的 3 个 tsdown.config.ts(cordis/tools/team)是否保留?
- 审计裁决:保留但需配套 tsconfig.host.json references 补 tools/team(否则官方 build:lib:host 不产其 lib/types)。
- 临时决定:保留 3 配置;等全量 build 后作为**独立工程修复提交**(tsconfig.host.json + 3 tsdown.config + 验证记录)。已备份 patch(plan/ + .workbuddy/tmp/)。
- 影响:构建流程修复,不改公共 API/契约。
- 需明早拍板:否(按审计裁决推进)。
- 回滚:git revert 该提交或移除 3 文件(patch 在手)。
## Q-02(2026-09-08):独立审计因 429 推迟
- 问题:子 Agent 全通道 429(重置 17:26 UTC+8);T19-A P1-P5 与 T22/T24 的独立只读审计无法执行。
- 临时决定:主 Agent 亲自复核(单裁决源/禁改面/fixture 标注/测试真实性逐项核),审计差异已在各 commit message 与晨报标注"审计待补"。
- 影响:合规流程缺口(非代码质量缺口);晨报如实披露。
- 需明早拍板:建议通道恢复后补跑独立审计(短清单:T19A-P2/P3/E2E、T22/T24)。
- 回滚:无(审计是追加行为)。
## Q-03(2026-09-08):T22/T24 事件与 orchestrator 接线范围
- 问题:规格含 research/verdict+research/experiment 事件与 Lead 接线;本轮只交付纯逻辑。
- 临时决定:事件+接线归 T19-B(避免半接状态机与 session-events 穷尽面风险),已记录。
- 影响:内部;验收 a/d(纯逻辑)已满足。
