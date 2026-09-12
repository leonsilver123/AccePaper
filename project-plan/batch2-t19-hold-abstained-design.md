# Batch2 T19 冻结设计 — 状态机携带 hold_abstained(弃权持有)

**性质:** 只读架构产出,冻结的 T19 前契约(不实现、不改 engine 代码、不 git commit)。
**裁决:** 用户定案 — 四候选互斥皆否;正确设计为**组合方案**:**显式 gate outcome + 保留 StepStatus 'gated' + 追加弃权审计事件**。不加 'held' 状态。
**基线与引用:** 均以 `packages/research/dsh-research-core` 与 `dsh-research-cordis` 现 HEAD(工作树干净)为准。

## 1. 背景与裁决

wave0 I1(§9.5)已暴露真实契约缺口:核心门产出 `abstained`,映射冻结为 intent `'hold_abstained'`(contracts.ts:323-332),但 batch-1 六态枚举(types.ts:48)「无家可归」,故 cordis 头注释明示暂缓自动接线(cordis/index.ts:30-39)。本设计冻结唯一正确形态:**outcome 显式化 + 复用 'gated' + 独立审计**,否决「压缩进 passed:false」「新增 held 态」「仅审计不落状态」「abstained 静默升 passed」任一单选项。

## 2. 现状差距(证据)

- **裁决只读 boolean:** `GateVerdict.passed: boolean`(types.ts:51-57);`_adjudicate` 只按 `v.passed` 分派(engine/state-machine.ts:240-260)→ abstained 无处安放,只能伪装 fail。
- **'gated' 语义单一:** 现仅表「等人类审批」(`_adjudicate` :252、`completeStep` :480、`_applyHumanApproval` 前提 :587-588)。无 second reason。
- **无弃权审计类:** `AuditEventKind`(types.ts:91-99)八类无 abstention;无 `GateAbstentionRecord` 载体。
- **StepState 无 reason 字段:**(types.ts:136-147)无 `holdReason`,Snapshot/AttemptRecord 亦无。
- **合法迁移不含 held:**(engine/state-machine.ts:95-102)gated 仅→passed/blocked;rollback 不受其限(任意非 pending 均可回滚 :498-511)。

## 3. 冻结类型设计

**① 显式 outcome**(types.ts,与 contracts.ts:233 `AdjudicationOutcome` 结构同值、独立声明防循环依赖):
```ts
export type GateOutcome = 'passed' | 'blocked' | 'failed' | 'abstained'
export interface GateVerdict {
  readonly component: TrinityComponent
  readonly outcome: GateOutcome          // 新增判别字段,唯一裁决真相
  readonly passed: boolean               // 保留:写时投影 passed ⟺ outcome==='passed'
  readonly evidence: string; readonly rationale: string; readonly timestamp: number
}
```
映射规则(T19):写入口先由 `outcome` 推导 `passed` 再一并 clone 存储(沿用 INV-VERDICT-SNAPSHOT 单快照模式,state-machine.ts:428-440);**abstained 以 `outcome:'abstained'` 原样入库,绝不压缩成 `passed:false`**。读取方(`_adjudicate` 及任何判定)一律改用 `outcome`,`passed` 仅作遗留投影、禁止反推。存储为进程内 run store(模块级,unload 即清),无需迁移旧记录;凡缺少 `outcome` 的写入在引擎边界直接拒绝(DSH_GATEVERDICT_MISSING_OUTCOME)——**无静默重解释**。

**② StepState 增一可选字段**,快照/AttemptRecord/CurrentAttemptSnapshot 同步透出:
```ts
holdReason?: 'human_gate' | 'gate_abstained'   // 仅 status==='gated' 时出现
```
`gated + human_gate` = 既有审批等语义;`gated + gate_abstained` = 弃权持有。后者**非终态**,合法迁移集不变(不加 'held',StepStatus 冻结)。

**③ 审计:** `AuditEventKind` 增 `'gate-abstention'`;追加事件 detail 精确为:
```ts
export interface GateAbstentionRecord {
  readonly runId: string; readonly stepId: string; readonly attemptId: number
  readonly component: TrinityComponent; readonly reasonCode: string
  readonly evidenceRefs: readonly string[]; readonly recordedAt: string // ISO 8601
}
```
经既有 `pushEvent` 追加(append 即 clone,state-machine.ts:130-146,INV-EVENTS-IMMUTABLE),与 `AuditEvent` 顶层 runId/stepId/attemptId/ts 并存;`recordedAt` 供 C1 与上游 AdjudicationResult.timestamp 对账。

## 4. 状态/事件流(唯一解除路径)

```
in_progress ──全部必需 gate 齐判,且任一 outcome='abstained'──▶ gated(holdReason='gate_abstained')
              [+gate-verdict 审计逐组件;齐判点 +gate-abstention 审计;不发 step-completed]
gated(abstained) ──rollback()──▶ pending   [旧 attempt 快照入 history,abstained verdict 原样留存]
pending ──startStep(attempt_id+1)──▶ in_progress   [resetStep 已清空 gateResults = 重跑 gate]
in_progress ──补齐证据→再逐组件 submitGateVerdict──▶ _adjudicate
```
`_adjudicate` 冻结新分支(前置优先):**任一必需组件 `outcome==='abstained'` → `_apply(state,step,'gated')` + 置 holdReason,绝不落入 passed/blocked/failed**;多组件并存时 abstained 即否决(no-default-pass),混有 failed 亦不自动取终态——整个 attempt 由 rollback 整体废弃重来。同 attempt 内任何对已裁决组件的再次 submit 一律 `DSH_VERDICT_ALREADY_SET`(state-machine.ts:450-452)拒绝——覆盖路径不存在。

## 5. 不变量清单(6 条 → 验收断言草案)

| # | 不变量 | 验收断言(草案) |
|---|---|---|
| 1 | 持有期 `isComplete()===false` | 任一必需组件 abstained 后:snapshot.status==='gated';`isComplete(run,step)===false`(:516-525 passed 才真) |
| 2 | 下游不可启动 | 持有期 `canStart(downstream)===false`(上游非 passed,isInputSatisfied :344) |
| 3 | 无自动转换 | 状态在多次读快照/时间推移下稳定 'gated';不产生 step-completed;无超时/重判机制 |
| 4 | adapter 只读冻结 intent | Cordis 零新增映射;`getGateIntent` 逐字委托 `gateToStateMachineIntent`(cordis/index.ts:218-220);delegation.spec.ts:190-209 原样成立,abstained→'hold_abstained' 永不为 pass |
| 5 | 同 attempt 判定不被覆盖 | abstained 后再 submit 同组件 → throw DSH_VERDICT_ALREADY_SET;gateResults[component] 不变 |
| 6 | 审计留存 | rollback 后 run.events 仍含该 gate-abstention 记录(append-only 永不清理,types.ts:162);attemptId 与 history 中被 supersede 的 attempt 一致;reasonCode/evidenceRefs 完整 |

## 6. humanGate 规则(HostApprovalChannel 唯一入口,非后门)

- 审批入口唯一:`host.ts` `HostApprovalChannel.submit`(host.ts:122)→ `_applyHumanApproval`(state-machine.ts:573-608),前提 status==='gated' **且** `step.humanGate===true`(:584,:587)。
- **冻结新增守则**:`holdReason==='gate_abstained'` 时审批路径必须拒绝(新增 guard,新错误码 `DSH_ABSTENTION_REQUIRES_ROLLBACK`)。人类「批准」**不得**把普通弃权变成 passed——弃权是证据不足,不是待裁决;人类审批仅能处理定义层声明 `humanGate:true` 且持有原因为 `human_gate` 的步。否则审批即绕开科学证据门的通用后门。弃权持有**只**经 §4 回滚路径解除。

## 7. T19 落地边界与非目标

**可改(预计触点,以 T19 实测为准):**
- `core/src/engine/types.ts`:GateOutcome、GateVerdict.outcome、holdReason、AuditEventKind 增项、GateAbstentionRecord、Snapshot 透出;
- `core/src/engine/state-machine.ts`:`submitGateVerdict` 写 outcome+投影+齐判分支+审计、`_adjudicate` abstained 分支、`rollback` 清 holdReason、`_applyHumanApproval` 增 guard、error code;
- `core/src/host.ts`:submit 前置 holdReason guard(或委托 core 侧);
- `core/src/index.ts` 类型导出同步 + core/cordis 相关测试。

**禁止改:**
- `contracts.ts`:`GATE_OUTCOME_TO_INTENT`/`StateMachineGateIntent` 冻结,零改动;
- Cordis:`src/index.ts` 不建任何新映射表,继续只消费 `evaluateGate`/`getGateIntent`;
- StepStatus 六态 union 不加 'held'(types.ts:48 冻结);
- 本阶段不实现任何 engine/state-machine 代码改动(仅此契约)。

**C1 审计锚点:** engine/ 变更 diff 限定上列文件;Cordis 层 outcome 零重解释、abstained≠pass 的既有 233 项测试(含 delegation 12 项)须全绿;`git status` 除 T19 提交外无漂移。

## 8. 验收清单(checklist)

- [ ] §3 类型:GateVerdict 带 outcome,abstained 非 passed:false 压缩;写边界缺 outcome 即拒。
- [ ] §4 流:abstained 齐判 → gated(holdReason='gate_abstained')+ gate-abstention 审计;无 step-completed。
- [ ] 不变量 1-6 各自断言(§5)全绿。
- [ ] 唯一解除 = rollback→新 attempt;同 attempt 覆盖被拒(INV-VERDICT-IMMUTABLE)。
- [ ] 审批路径对 gate_abstained 拒绝;humanGate 规则无后门。
- [ ] contracts.ts 与 Cordis 映射面零改动;'held' 未入 enum。
- [ ] 回归:core+cordis 全量测试通过;typecheck exit 0。
