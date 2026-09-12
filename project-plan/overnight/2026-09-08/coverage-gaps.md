# Coverage 逐文件缺口表(五裁决,2026-09-08)

> 原始:`.workbuddy/tmp/cov-table.txt`(vitest text 报告节选);JSON:`cov-json/coverage-final.json`。
> 处置原则:可达且有行为价值→补有意义测试;纯类型/re-export/聚合→双版本证据登记;禁 ignore/降阈值/无意义断言。

## A. 运行时行为缺口(候选补测;补测 Agent 逐项定可达性与价值)
| 文件 | 缺口位置(行) | 观察/推测行为 |
|---|---|---|
| core/engine/state-machine.ts | 92,252,255,417 | runId 回退/steps 边界/告警路径(需读码) |
| core/engine/steps.ts | 177,209,219,222 | seed/结构守卫(读码) |
| core/citation/fixture.ts | 90,96,103 | fixture 边界分支 |
| core/citation/verify.ts | 77,449,544-567 | 校验错误路径 |
| core/l0/routing.ts | 322-323,334-335 | 路由决策分支 |
| core/gates/index.ts | 230,435 | A 通道边界/拒绝 |
| core/host.ts | 152 | 审批守卫(夜间已改,部分) |
| cordis/src/index.ts | 133,145-169,211 | **service adapter 方法体缺测**(夜间已确认真实缺测,与方法语义=T19-A 管线同一批) |
| team/journal.ts | 60 | journal 边界 |
| team/roster.ts | 多行 234-489 | roster 守卫路径 |
| team/task-board.ts | 189-208,217 | CAS/状态迁移路径 |
| team/research-projection.ts | 43,60,62 | projection 折叠分支 |
| team/research-guard.ts | 75 | guard 分支 |
| team/redteam/judge.ts | 89,109-110 | sameFamily/voteTally 透出分支(新) |
| team/experiment/support.ts | 164 | 防御 outcome 分支(静态不可达,见注) |
| team/redteam/orchestrator.ts | 233,304 | orchestrator 分支 |
| team/src/index.ts | 166,301-303 | 聚合守卫 |

注:team/experiment/support.ts:164 为"core 返回意外 outcome"防御分支——结构上不可达(外层校验保证 passed|failed);若确认不可达,按"不可达防御"登记而非补测。

## B. 0% 文件(疑似类型/纯 re-export/聚合——instrumentation 类,待双版本证据登记)
core/index.ts、core/engine/types.ts、core/host-prod.ts、core/citation/{adapter,index}.ts、core/l0/{index,types}.ts、tools/index.ts、tools/figure/adapter.ts 等。
判据:文件是否含可执行运行时语句(v8 对纯类型与 re-export 计 0 属正常)。

## C. 已闭合(100%)
pipeline.ts、tools 六工具(除 adapter 聚合)、team scope-guard/projection/session-events/rebuttal/fleet-config/personas/citation-verify 等。

## 动作
补测 Agent 按 A 逐项:读源码→定可达/价值→写行为测试(禁凑)→结果更新本表;0% 类核对后登记。完成后重跑正式 coverage 门禁。
