# 16 步语义 — 工具能力 — 执行通道 — 产物 — gate 矩阵(T19 语义校准, A3)

依据: dsh-research-team registry(STEP_DEFS/STEP_CAPABILITIES/执行器)与
dsh-research-tools(工具目录/严格 schema)、cordis(注册层)。状态: 校准用基线;
修订清单见文末。真实代码核实,非誊写。

## 矩阵(语义任务先行;工具=能力,非步骤)

| 步骤 | semanticTask(研究任务) | toolIds(能力; wired) | 现执行通道 | truthfulness | 产物(slug) | gate/说明 |
|---|---|---|---|---|---|---|
| A1-landscape | 领域与文献景观(交通自适应信号) | literature-search (wired:true) | Direct 执行器(fixture 语料 adapter) | real_tool_fixture_input | landscape-map | 无 gate;文献为 fixture |
| A2-claim | 构造**可证伪** claim(超越 SOTA 8% 差) | claim-construct (wired:true) | Direct 执行器 | real_tool_fixture_input | research-claim | gate A=adversarial 收敛 |
| A3-agenda | 研究议程与扩展(非"关键词处理") | 无(不接线) | Fixture 规划 | fixture_executor | research-agenda | 语义为任务分解,非工具 |
| A4-venue | 期刊/审稿标准(中科院∪CCF 双体系) | 无 | Fixture(L0 路由可服务) | fixture_executor | venue-target | 与 L0 routing 能力相关但非七工具 |
| B1-method | 方法推导(自适应 RL 策略) | 无(方法即文本推导) | Fixture 骨架 | fixture_executor | method-design | 语义禁止以消融代方法 |
| B2-data | 数据与复现基础(合成数据) | 无 | Fixture 数据集声明 | fixture_executor | data-registry | mock 数据显式标记 |
| B3-baseline | baseline 与指标(固定配时 10.0s) | literature-search(B3-SOTA 子任务 wired:false,off-domain) | Fixture baseline + SOTA 诚实缺口 | fixture_executor + 声明缺口 | baseline-results(真类型 baseline-measurement-set), sota-comparison | 语义禁止以消融代 baseline(T19-S 已纠) |
| C1-mvp | 方法 MVP(自适应 RL 变体 9.09s≈9.1%) | 无(执行用实验 fixture 行) | Fixture 实验 | fixture_executor | mvp-results | fail-closed: 无 fixture 行即抛 |
| C2-trinity-loop | 迭代实验三一收敛 | 无 | Fixture 循环 | fixture_executor | converged-verdict | gate A/B/C 收敛 |
| C3-boundary | 边界与反例(消融探测) | ablation (wired:true) | Direct 执行器(fixture executor) | real_tool_fixture_input | ablation-results, boundary-map | 消融在此(C3),非 B3 |
| D1-figure-map | claim→图表映射(数据图/三线表/路线图) | figure, three-line-table, roadmap (wired:true) | Direct 执行器(fixture) | real_tool_fixture_input | figure-map | 三图家族真实渲染 |
| D2-framework | 论文结构(骨架,与 D3 并行) | 无 | Fixture 骨架 | fixture_executor | paper-structure | D1∥D2 并行(canonical DAG) |
| D3-writing | 由内向外写作(证据→段落) | 无(禁止以 figure 代 D3) | Fixture 草稿 | fixture_executor | method-draft→… | 段落数字须可追溯 |
| D4-rebuttal | rebuttal 演练 | 无 | Fixture 意见 | fixture_executor | rebuttal-draft | 引用对应 claim/实验 |
| E1-format | 格式与复现包(装配 manuscript) | three-line-table(子能力 wired:true) | Direct 执行器 | real_tool_fixture_input | formatted-manuscript, reproducible-package | 三线表=子能力,非 E1 本身(T19-S 已纠) |
| E2-submit | 投稿前**人工**门禁 | 无 | humanGate(空 gate→gated) | live human(离线=待批) | (approval) | 唯一红线:不可自动过 |

## 执行通道统计口径(当前代码事实)

- Direct 执行器(纯函数直调,truthfulness 自洽): A1,A2,C3,D1,E1(5 个 real_tool_fixture_input 步)。
- Fixture(无工具或工具缺位): A3,A4,B1,B2,B3(fixture+诚实缺口),C1,C2,D2,D3,D4(10 步)。
- AgentLoop(model_ready 三纯渲染经真实 ToolRuntime): 当前仅 harness/invoker 层可达;
  步骤级注入属修订清单 R1(见下),届时 D1 的 figure/table/roadmap 能力可经
  AgentLoop 通道观测,provenance=cordis_tool_runtime,其余仍 Direct/Fixture。
- live_external: 0。E2: 人工待批。

## 修订清单(最小、可回滚、fail-closed)

- R1(步骤级通道注入): STEP_DEFS/执行器入口增加可选 invoker 注入面(接口
  ResearchToolInvoker),由 runner 组装: model_ready 能力步(D1)在真实 loop 可用时
  经 AgentLoopResearchToolInvoker;其余用 Direct;无注入则保持现状(Direct/fixture),
  不改变默认测试行为。
- R2(语义字段显式化): 每步 entry 补 semanticTask 字段(上表语义任务),报告/矩阵
  输出;测试断言非空且不与工具 id 同名(禁止工具即步骤)。
- R3(通道统计进报告): report.ts 输出 Direct/AgentLoop/Fixture/live 步数与降级原因。
- R4(审计前不改): 不动 gate 语义、不动 humanGate、不把 fixture 升格。

## 红线确认

A3 不得变成关键词处理; B3 不得变消融; D3 不得变画图; E1 不得变表格;
D1∥D2 并行;C3 独享 ablation;E2 保持人工 pending。
