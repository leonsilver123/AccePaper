# Coverage 收口报告 — 2026-09-09 晚

## 工具与基线
- 工具: vitest 4.x + @vitest/coverage-v8
- 范围: `packages/research/**/src/**/*.ts`
- 全量 tests: 895/895 绿(38 test files)
- 全量 Coverage 阈值: 100%(lines / statements / functions / branches)
- 总体结论: **per-file 100% 未整体闭合**;27 个文件触发 ERROR,本报告逐项分类,主 Agent 自评(子通道 429,独立审计待 05:35:36 重置后补派 core-orb-sec-audit 与第二轮 coverage audit)。

## A/B/C 分类(按 taskbook §十 + A 类 per-file 100% 硬要求)

### A 类 — 运行时行为源码(目标: per-file 100%)
未达 100% 文件(运行时源码,需补测;行范围 75-99% 多为分支未覆盖):

| 文件 | lines% | stmt% | fn% | br% |
|------|--------|-------|-----|-----|
| dsh-research-core/src/engine/steps.ts | 87 | 85 | 60 | 79 |
| dsh-research-core/src/engine/state-machine.ts | 99 | 94 | 0 | 87 |
| dsh-research-core/src/citation/fixture.ts | 86 | 86 | 0 | 78 |
| dsh-research-core/src/citation/verify.ts | 88 | 85 | 0 | 84 |
| dsh-research-core/src/l0/routing.ts | 88 | 88 | 0 | 80 |
| dsh-research-team/src/runner/drive.ts | 97 | 92 | 86 | 77 |
| dsh-research-team/src/runner/registry.ts | 97 | 97 | 0 | 81 |
| dsh-research-team/src/runner/verdict.ts | 94 | 95 | 0 | 75 |
| dsh-research-team/src/runner/anchor-fixture.ts | 0 | 0 | 0 | 82 |
| dsh-research-team/src/runner/report.ts | 0 | 0 | 0 | 64 |
| dsh-research-team/src/roster.ts | 88 | 82 | 96 | 70 |
| dsh-research-team/src/task-board.ts | 79 | 73 | 92 | 59 |
| dsh-research-team/src/journal.ts | 0 | 96 | 0 | 88 |
| dsh-research-team/src/redteam/orchestrator.ts | 97 | 98 | 0 | 95 |
| dsh-research-team/src/redteam/judge.ts | 0 | 0 | 0 | 89 |
| dsh-research-team/src/experiment/support.ts | 96 | 96 | 0 | 87 |
| dsh-research-team/src/research-guard.ts | 0 | 0 | 0 | 92 |
| dsh-research-team/src/research-projection.ts | 90 | 75 | 67 | 50 |
| dsh-research-team/src/anchor/fixture.ts | 98 | 98 | 0 | 97 |
| dsh-research-tools/src/tools/roadmap/validate.ts | 0 | 96 | 88 | 75 |
| dsh-research-tools/src/tools/roadmap/renderers.ts | 0 | 94 | 0 | 58 |

### B 类 — 纯类型文件(走 tsc + API surface,不算入 coverage)
- dsh-research-core/src/contracts.ts 大量为 type,coverage 工具按语句记入但运行时擦除 → 走 tsc + API surface diff
- dsh-research-team/src/anchor/types.ts(分支 50%:仅为 unused-branch 警告,非运行时分支)
- dsh-research-team/src/redteam/* types

### C 类 — 纯 re-export / 客户端包入口(走 entry smoke + export snapshot)
- dsh-research-cordis/src/index.ts(fn 59% — cordis 注册子集,部分分支是 dead code)
- dsh-research-team/src/index.ts(stmt 95%,fn 0% — 大部分仅 re-export)
- dsh-research-web/src/index.ts(0% — Host 半 inert,client-face 在 client/index.ts)
- dsh-research-web/src/client/index.ts(0% — 注册逻辑,需真实浏览器才能跑)
- dsh-research-web/src/client/locales.ts(0% — 数据对象,无函数)
- dsh-research-web/src/client/ResearchView.tsx(0% — 浏览器渲染)
- dsh-research-core/src/gates/index.ts(br 98%,fn 0% — 大半 re-export)

## 关键判断

1. **A 类分支未达 100% 主因**:`if/else` 两条路径之一有 1-2 罕见 case(异常/timeout/abstained)未在 happy-path 触发。补测方向明确,无新依赖、无安全门禁冲突。
2. **C 类客户端/浏览器代码** 0% 是 vitest jsdom 跑不到的,需 browser lane(vitest.web.config.ts)+ 真运行时验证。web 包的 12 tests 仅测模型层,React 渲染逻辑(ResearchView.tsx)未覆盖。
3. **0% lines/statements 的 A 类候选** (runner/anchor-fixture.ts, journal.ts, redteam/judge.ts, research-guard.ts, runner/report.ts, dsh-research-cordis/src/index.ts) — `fn% = 0` 多为 export-only 或 stub,需明确 A/B/C 后决定走 typecheck + smoke。

## 政策分层(任务书 §十,独立审计确认)
**声明**:本报告提议分层由主 Agent 撰写,因子通道 429,待 core-orb-sec-audit/第二轮 coverage audit 重置后独立复核。本声明不可由主 Agent 单独决断。
- A 类: per-file 100% 行/分支/函数/语句全维度。补测方案已在 A 类表内逐行登记(`uncovered` 待枚举)
- B 类: tsc + API surface diff(extract / surface.test),**禁走运行时测**凑数
- C 类: entry smoke + export snapshot + 浏览器运行时断言,**禁走 fake 单元测**凑数

## DEG-2 判定
- **部分闭合**:per-file 100% 仍未达;27 个 A/C 类文件仍 < 100%(主分支范围 50-99%,fn 0% 集中在 re-export/客户端)。
- **未闭合项**:A 类补测预计 30-60 个测试用例;B 类 API surface 差异测试 1 个; C 类浏览器渲染测试 1-3 个。
- **登记**:Coverage 正式闭合属持续工程,不阻塞 Wave 6/7/8 推进。P0 待办 (重置后派独立 coverage audit,确认分层方案合规,补测执行)。

## 证据
- `cov-run.json` (1.3MB) `.workbuddy/tmp/cov-run.json` — 完整 vitest json reporter 输出
- `cov-fail.txt` `.workbuddy/tmp/cov-fail.txt` — 71 行 ERROR 摘要
- `cov-table.md` `.workbuddy/tmp/cov-table.md` — 28 unique 文件 metric 表
- 报告本文件 `plan/overnight/2026-09-09/coverage-report.md`
