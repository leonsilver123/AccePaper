# audit-register — 2026-09-09 (T13-R 双审计)

范围: 51e3aa1..HEAD。规则: P0/P1 返工→定向回归→原审计 Agent 复审;P2 修或记录理由;
审计未过不关 Task #13、不进 T30-R。Agent 只读、不提交。

## S1 安全审计(Schema/授权/生命周期/动态 import/exports)
- 派发: general-purpose-10 → 429;general-purpose-12 → 429;general-purpose-14 → 429(均 15:53:52 重置)。
- 审计清单: input-schema 绕过/TOCTOU;注册事务与 identity 标记可伪性;unload 撤销;guard
  name-scoping + pipeline_only 经 ToolRuntime 可执行性;loader 错误码与路径泄漏;deep import;
  错误信息卫生。
- 状态: Pending(重置后重派)。

## F1 功能+科研语义审计(Invoker 执行器/16 步语义/通道/provenance/E2E)
- 派发: general-purpose-11 → 429;general-purpose-13 → 429;general-purpose-15 → 429(均 15:53:52 重置)。
- 审计清单: 五执行器 Invoker 注入等价与 fail-closed;actualChannel 真实性;SEMANTIC_TASKS/
  STEP_CAPABILITIES 工具≠步骤;provenance 标签;artifact 不伪造;E2E 业务断言。
- 状态: Pending(重置后重派)。

## 双审计结论(S1 PASS + F1 PASS,P0/P1 清零)→ Task #13 关闭条件满足;T19=离线 Direct 闭环+部分 AgentLoop Runtime-verified;pipeline_only 仍 ARCH-BLOCK-01;T30-R 未做。
### S1 安全审计结果与处置
- P1-1 TOCTOU/未快照 → **修复**(execution.ts 单次 JSON 快照再校验分发;回归测试;commit 01e94e5)→ 待 S1 复审。
- P2-2 open 深嵌套/尺寸 → **部分修复**: isJsonSafe 深度上限 64(防校验器栈溢出 DoS);
  open 单所有者对象仅剩 256KiB 载荷+深度 64 全局界(记录接受理由: 内容级结构归 core
  verifyCitation/validateRoadmap,其自测覆盖)。
- P2-3 executeResearchTool 无 exposure 检查 → **接受(P2)**: 该函数为内部唯一分发缝,合法
  流水线(DirectInvoker)须能调 pipeline_only;对外的 agent 面边界= ctx.tools guard(一律拒)
  + AgentLoopResearchToolInvoker(model_ready-only)。非旁路(工具无秘密,运行时已拒)。
- P2-4 句柄 .execute 绕过 guard → **修复**: 模块私有 WeakSet capability;pipeline_only 经句柄
  .execute 无/伪造/复制均 RESEARCH_TOOL_NOT_CAPABILITY;对抗测试+注册测试改走 cap;commit 01e94e5。
- P2-5 agent-loop-invoker 导入失败泄路径 → **修复**: cause 丢弃,RESEARCH_TOOL_HOST_LOAD_FAILED(本提交)。
- P3-6 core-owned 边界(接受,内容归 core);P3-7 并发无锁(接受,宿主拒重;运行时不可观测);
  P3-8 ./src/* wildcard exports(接受,同信任域、monorepo 测试需要;登记消除候选);
  P3-9 错误归类文案(接受,cosmetic);P3-10 restrict 应用面(接受,agent 层授权非本文件)。
### F1 功能+语义审计结果与处置【复审通过 2026-09-09】
- 复审结论: P1-1 CLOSED、P2-3 CLOSED、接受清单全部同意、无新 P0/P1 → **F1 PASS**。
- P1-1 provenance 未传播 → **修复**: tagArtifact 支持 ArtifactChannelMeta;五个真实工具
  执行器把 invocation.provenance/invokerTruthfulness 落到产物 __provenance/__invokerTruthfulness
  (D1 用 figureInv 引用);registry spec 断言 A1 landscape-map __provenance=direct。→ 待 F1 复审。
- P2-3 静态占位 execution id → **修复**: toolRuntimeExecutionId 恒 undefined(会话事件不可得),
  spec 改为断言不伪造 id。agent-loop-injected 由 invokerKind/actualChannel 表达。
- P2-2 D1/E1 多工具低归因 → **接受**: D1 figures[].toolId 三工具逐一记录、E1 note 说明三线表为
  子能力(审计认可 notes 诚实)。
- P2-4 usedRealTool 由 kind 派生 → **接受**: __provenance 已入产物可供运行时观测;drive kind 判定
  与产物 __producer 佐证(审计认可)。
- P3-5 矩阵文档在 git 树外(plan/ 目录)→ 记录: 本机可读路径给出,后续可迁 docs。
- P3-6 E2 truthfulness 双词表 → **接受**: registry.kind 轴 vs channel truthfulness 轴,各自诚实。
