# Agent Note: The method section is the code that ran

Status: implemented

[English](2026-09-16-the-method-section-is-the-code-that-ran.md) | 中文

## Problem

`B1-method` 向模型要一个方法 FAMILY,把模型写下的字原样放进 `method-spec`。手稿的方法一节渲染的正是那段文字。一条记录在案的 fixture 回答写着 `reinforcement-learning phase-plan policy`。

下游每一个数字都来自 `runner/platoon-sim.ts`,它积分的是智能驾驶员模型的轨迹。没有任何代码比对过这两者,于是一篇论文可以描述一个实验、报告另一个。方法一节是流水线上唯一一处**自由文本在承重**的地方:别处的值都是派生的、被检查的、或被测量出来的,而这里手稿里最承重的那句话,是模型恰好写下什么就是什么。

同一个缺陷还有第二副面孔,在研究方案里。`DEFAULT_PLAN.claim.essentialDifference` 写着 `control policy is adaptive (RL) rather than fixed-time`,而手稿里"两个实验臂差在哪里"那句正是从它派生的。两半都不真:两个实验臂的跟驰都是 IDM;基线是均质车队,不是定周期信号方案。

## Decision

算法、它的参数、两个实验臂**实际**不同的因素、方程、以及这个实现产出的工件,由一条实现记录声明(`runner/implementations.ts` 的 `MethodImplementation`),而每一个字段都从仿真模块自己的常量里读出 —— `SIMULATION_INPUTS`、`DECLARED_VEHICLE_CLASSES`、`MODEL_EQUATIONS`、`EXPERIMENT_RULE_VERSION`。没有第二份要跟着改的副本,这是一段手写的方法一节能够保持为真的唯一原因。

`StudyPlan.implementationId` 具名实现,`requirePlan`(`runner/study-plan.ts`)拒绝本运行没有的实现。`SUPPORTED_IMPLEMENTATIONS` 恰好一条,而"支持"是关于本进程的主张:这个运行器能执行它、能量它的产出。需要别的实现的研究还没有运行器,诚实的结果是说出来,而不是描述它去测量别的东西。

模型留下的是它**能够**贡献的部分 —— 过程步骤与指标方向。它答的 FAMILY 记为 `method-spec` 上的 `modelDeclaredFamily`,读者因此能看见模型说了一套、代码做了另一套,而它到不了手稿里的任何一处。

`DEFAULT_PLAN.claim.essentialDifference` 现在陈述 `DECLARED_VEHICLE_CLASSES` 真正变化的那四个参数:自动驾驶车以 0.15 s 反应延迟、1.2 s 期望车头时距、0.15 s 前视时域跟驰,对照人类的 1.2 s 延迟、2.0 s 车头时距、无前视。

## Alternatives considered

**把模型的回答与实现比对,不一致就拒。** 拒绝。那会让算法仍然是模型的产出,并且让正确性取决于对一段模型写的散文做字符串比对 —— 一个碰巧含有正确词汇的近邻回答会通过,一个措辞不同但正确的回答会失败。派生掉这段文字是消除分歧,而不是检测分歧。

**参数也问模型,再拿仿真校验。** 出于同一理由拒绝,而且代价比更差:参数是方法一节里读者唯一可以拿代码核对的部分,所以它必须来自代码。

**`family` 保持模型写,把派生出的算法记在旁边。** 拒绝:手稿渲染的是 `family`,那模型仍然在写方法一节。

**把模型这一步从 `B1-method` 整个删掉。** 拒绝,这次改动不该做这么多。过程步骤与指标方向是真实的贡献,而 B1 的散文通道也是让这一步的真信度分层诚实的东西。

## Consequences

- `tests/method-implementation.spec.ts`(12 条)钉住派生:`parameters` 与 `SIMULATION_INPUTS` 深等、`varied` 与 `DECLARED_VEHICLE_CLASSES` 一致、`equations` 等于 `MODEL_EQUATIONS`、`version` 是 `EXPERIMENT_RULE_VERSION`、`family` 就是实现的算法、模型自己的回答到不了 `family`、而具名未知实现的方案在边界被拒且理由里带着可用的 id。
- 差异描述那条测试断言方案不再匹配 `/RL|reinforcement/i`、不再匹配 `/fixed-time/i`,并且含有两个反应延迟值。这条断言存在,是因为那段假话真的到达过手稿。
- 研究方案现在必须具名实现才可执行。`resolveImplementation` 拒绝一个不具名任何实现的方案,所以这条要求是可执行的,不是约定俗成的。
- **注入写作者时 B1 无法端到端驱动**,所以模型那条路由 `b1-method-derivation.spec.ts` 覆盖,派生由上面那条 spec 覆盖。两者分开,是因为一条同时跑模型的派生测试,会把模型的行为当成派生的行为来报告。
- 运行器仍然只有一个实现。另一个领域的第二个研究要等到声明第二个实现才能跑,这与 `runner/prediction-gate.ts` 为它的测量量参数记下的限制是同一个。
