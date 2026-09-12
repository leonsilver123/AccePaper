# C1 独立审计报告：batch-2 wave-1 新适配器 diff（T10-R 薄委托层）

## 1. 范围与边界诚实性

审计对象（仅两个提交）：
- `4d31a40` — core 类型面导出（纯类型 re-export）
- `eabc3d2` — Cordis 适配器 + 12 个委托测试

工作树干净于 `eabc3d2`。父子链确认：`eabc3d2^=4d31a40`，`4d31a40^=a4c7dc3`。

边界证据：
- `git diff --stat 4d31a40^ 4d31a40` → `core/src/gates/index.ts`(+11)、`core/src/index.ts`(+10/-1)，仅 2 文件。
- `git diff --stat eabc3d2^ eabc3d2` → `cordis/src/index.ts`(+78)、`cordis/tests/delegation.spec.ts`(+260)，仅 2 文件。
- `git diff --name-only 0081357..HEAD` → 上述 4 文件 + `core/tests/citation/red-line.spec.ts`（经 git log 确认属 Q1 提交 `a4c7dc3`，超出 C1 范围，仅记录不审计内容）。

范围诚实：`contracts.ts`、`core/engine/`（batch-1 状态机）在范围内零改动。✓

## 2. 检查清单判定

### 禁止项
| 项 | 判定 | 证据 |
|---|---|---|
| 自写 `switch(result.outcome)` | 合规 | cordis/src/index.ts:182-220 新增方法内无 switch/outcome 分支 |
| 门结果自动转状态迁移 | 合规 | 5 方法仅返回结果，无 StepStatus 转换；index.ts:30-39 头部明示不实现 auto-wiring |
| `abstained`→blocked/failed/passed | 合规 | index.ts:218-220 `getGateIntent` 逐字委托 `gateToStateMachineIntent(result.outcome)`，表唯一来自 core contracts.ts `GATE_OUTCOME_TO_INTENT` |
| 调用 `_apply` | 合规 | 新代码零引用 engine/；文件无相关 import |
| 暴露 store/Map/channel/principal/human-approval | 合规 | store 仍为模块级 `const runs`(index.ts:103，batch-1 既有)；新方法不取 runId、不触 store；测试断言 runs/store/transition/approveHumanGate 均 undefined（spec:234-248） |
| 复制 L0/citation/gate 核心逻辑 | 合规 | 全部单表达式转发至 core：classifyL0(182-184)→routing.ts:125、verifyCitation(190-200)→verify.ts:321、evaluateGate/adjudicate(205-212)→gates/index.ts:542；core index.ts:63-69/82-99/119-123 确认导出 |
| 修改 batch-1 状态机 engine/ | 合规 | 0081357..HEAD 文件清单无 engine/ 路径 |
| 启动 T12-T19 | 合规 | 提交内无相关代码 |
| 4d31a40 超类型面导出 | 合规 | gates/index.ts:83-90 与 core index.ts:124-132 仅 re-export contracts.ts 的 6 类型+StateMachineGateIntent；contracts.ts 零改动，无运行时 delta |

### 允许项
| 项 | 判定 | 证据 |
|---|---|---|
| 薄委托调用既有 core 函数 | 合规 | 见上，5 方法逐一对应 core 导出函数，签名镜像（verifyCitation 7 参与 core verify.ts:321-329 一致） |
| 返回 core 冻结结果 | 合规 | 直通 core；core gates/index.ts:551-552 clone+deepFreeze；spec 多处断言 Object.isFrozen(spec:80-109/160-176/211-233) |
| 经 `gateToStateMachineIntent` 消费冻结 intent | 合规 | index.ts:218-220；spec:190-209 对四 outcome 逐字等值断言 + abstained≠pass |
| 生命周期/错误传播/输入隔离/运行隔离/无信任测试 | 合规 | spec 12 项覆盖（spec:96-108 适配器故障、177-189 ResearchError 不包装、211-233 入参变更隔离、234-248 运行隔离+store 不可达） |
| 必要类型声明+导出更新 | 合规 | 4d31a40 最小改动实现 |
| 模块级 store 保持不可达 | 合规 | 新方法无 runId/无 runs 引用；index.ts:103 未变 |

### 测试复跑
`npx vitest run --project thread-safe packages/research/dsh-research-cordis/tests/delegation.spec.ts` → **12/12 通过**（注意：需从仓库根 + `--project thread-safe` 运行）。

## 3. 非阻塞观察
- 直接在某包目录内运行 vitest 失败（tsconfig-paths 解析告警），须走根配置，属仓库工具链行为，非本次代码问题。
- 提交说明称 core lib 已本地重建且 gitignored：干净克隆首次构建需保证 core 先 build 生成 d.ts，否则 cordis 类型面（新类型导出）可能解析失败——建议 CI 验证构建顺序，风险低。
- 测试辅助构造器（claim/ref/evidence 等）属脚手架而非核心逻辑复制；12 测试已覆盖 I1 授权清单全部维度。

## 4. 最终判定：**PASS**

两提交边界诚实（各仅触及声明路径，engine/ 与 contracts.ts 零改动），新增 5 个委托方法全部为对 core 既有纯函数的单表达式转发，`getGateIntent` 是服务上唯一意图映射面且逐字委托冻结 helper，四 outcome 映射经测试锁定为 passed→pass / blocked→rework / failed→hard_fail / abstained→hold_abstained（abstained 永不为 pass）；无 switch、无自动转迁、无 `_apply`、store 仍为模块级不可达、无信任能力外泄、无核心逻辑复制；4d31a40 为纯类型 re-export 无运行期行为。12 项授权内测试全部通过。未发现阻塞性违规。
