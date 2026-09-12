# 17 — T06 契约重设计稿：INV-HUMAN-1 + INV-ROLLBACK-1/2

> 实施前置：#15 基线（`post-batch1-observed`）建立 + #16 目录重命名 `research-core`→`dsh-research-core` 完成后，在此包内实施。本稿为 pure design，不触源码，不污染基线。
> 实施范围：仅 `packages/research/<pkg>/src/engine/{types.ts, state-machine.ts}` + `tests/state-machine.spec.ts`。不扩 Tools/Team/Web/Bundle/AgentLoop。不引新依赖（新增类型均纯 TS）。不涉 credentials/真实 key。

## 0. 缺陷来源
T06 现行 state-machine.ts 批次1 交付 7/7 通过，但**对抗设计核验**暴露两处**契约设计缺口**（非测试覆盖问题）：
- **INV-HUMAN-1**：`humanGate:true` 步骤可不经显式人类批准记录即进入 `'passed'`。
- **INV-ROLLBACK-1/2**：`rollback` 物理清除 `gateResults/artifacts`，无 attempt 隔离与历史保留。

现行 7 测试只覆盖"快乐路径 + 合法边界"，未覆盖这两条不变量，故 7/7 ≠ 契约无缺陷。

---

## 1. 现行代码缺陷精确定位（state-machine.ts 行号，#16 后不变）

### 缺陷 A — INV-HUMAN-1 违反（人类闸门可绕过）
- `steps.ts`：`E2-submit` = `{ humanGate: true, gate: [] }`（唯一 humanGate 步骤；语义=投稿是人的行为）。
- `state-machine.ts:113-117` `submitGateVerdict`：
  ```ts
  if (step.gate.length === 0) { state.status = 'passed'; state.finishedAt = Date.now(); return state.status }
  ```
  → E2 调 `submitGateVerdict`（空闸门）即自动 `'passed'`，**无任何人类批准记录**。违反 INV-HUMAN-1。
- `state-machine.ts:146-157` `transition`：`LEGAL_TRANSITIONS.gated` 含 `'passed'`，故 `transition(E2,'passed')`（从 gated）可直入 passed，**亦不校验 humanGate/approval**——第二条绕过路径。

### 缺陷 B — INV-ROLLBACK-1/2 违反（物理清除 + 无隔离/历史）
- `state-machine.ts:164-173` `rollback`：
  ```ts
  state.status = 'pending'
  state.gateResults = {}              // ← 物理清除
  if (clearArtifacts) state.artifacts = {}  // ← 物理清除
  state.startedAt = undefined; state.finishedAt = undefined
  ```
  - **INV-ROLLBACK-2 违反**：不得物理清除 gateResults/artifacts；须事件追加、历史可审计。
  - **INV-ROLLBACK-1 违反**：无 `attempt_id` 追踪、无 `history`；rollback 未建新 attempt、未标记旧记录 superseded、投影未限定读当前 attempt。

---

## 2. 类型增量（types.ts）

```ts
/** 人类批准记录。绑定 run_id+step_id+attempt_id+actor+timestamp。
 *  非 agent 生成（actor 不得为 'agent'）；不得复用 attempt_id 不匹配的旧批准。 */
export interface ApprovalRecord {
  run_id: string
  step_id: string
  attempt_id: number        // 须 == 当前 state.attempt_id，否则拒绝
  actor: string             // 人类主体标识；'agent' → 拒绝
  decision: 'approved' | 'rejected'
  rationale?: string
  timestamp: number
}

/** 已 superseded 的历史 attempt 快照（rollback 追加，不物理清除）。 */
export interface AttemptRecord {
  attempt_id: number
  status: StepStatus
  artifacts: Record<string, unknown>
  gateResults: Record<TrinityComponent, GateVerdict>
  approval?: ApprovalRecord
  superseded: true
}
```

`StepState` 增字段（`attempts` 复用为当前 attempt_id，语义即"当前 attempt 编号"）：
```ts
export interface StepState {
  stepId: string
  status: StepStatus
  attempts: number            // = 当前 attempt_id（startStep +=1；rollback 不直接改，由 startStep 在重跑时推进）
  attempt_id: number          // 显式当前 attempt id（与 attempts 同步；冗余但语义清晰，供 ApprovalRecord 绑定）
  artifacts: Record<string, unknown>        // 当前 attempt 的产物（投影读取）
  gateResults: Record<TrinityComponent, GateVerdict>  // 当前 attempt 的闸门裁决
  approval?: ApprovalRecord   // 当前 attempt 的人类批准（humanGate 步骤）
  history: AttemptRecord[]    // 已 superseded 历史快照（追加；审计可见全量）
  startedAt: number | undefined
  finishedAt: number | undefined
}
```
> 抉择：`attempt_id` 与 `attempts` 合一语义（均=当前 attempt 编号）。`ensureEntry` 初始化 `attempt_id:0, history:[]`；`startStep` 同步 `attempts+=1; attempt_id=attempts`。

---

## 3. 状态机增量（state-machine.ts）

### 3.1 submitGateVerdict 改造（INV-HUMAN-1）
空闸门或全部自动化组件裁决收齐后 adjudicate 时：
- 若 `step.humanGate === true` → **不得** `'passed'`；改置 `status='gated'`（等待人类批准），`finishedAt` 暂不置（待 approve）。
- 若 `step.humanGate === false` → 维持原 adjudication（全过→passed；C-fail-falsifiable→failed；其他 fail→blocked；空闸门→passed）。
- 即 humanGate 步骤自动化闸门满足后停在 `'gated'`，转交 `approveHumanGate`。

### 3.2 新增 approveHumanGate(stepId, approval, store): StepStatus
- 前置：`step.humanGate === true` 且 `state.status === 'gated'`（否则抛错）。
- 校验 `approval.step_id === stepId` 且 `approval.attempt_id === state.attempt_id`（不匹配→抛错，**拒绝复用旧 attempt 批准**）。
- 校验 `approval.actor` 非空且 `!== 'agent'`（agent 生成→抛错）。
- `decision === 'approved'` → `status='passed'`, `finishedAt=now`, `state.approval=approval`。
- `decision === 'rejected'` → `status='blocked'`, `state.approval=approval`（拒绝证据留存，非物理清除）。
- 返回 status。

### 3.3 transition 改造（INV-HUMAN-1 防绕过）
- 目标 `'passed'` 且 `step.humanGate === true` → 须 `state.approval?.decision === 'approved'`，否则抛错（禁止无批准经 transition 直入 passed）。
- 其余边合法性不变。

### 3.4 rollback 改造（INV-ROLLBACK-1/2）
- **不物理清除**。构造当前 attempt 快照 `{attempt_id: state.attempt_id, status, artifacts: state.artifacts, gateResults: state.gateResults, approval: state.approval, superseded: true}`，`push` 入 `state.history`。
- 当前字段重置为新 attempt 初始态：`status='pending'`, `artifacts={}`, `gateResults={}`, `approval=undefined`, `startedAt=undefined`, `finishedAt=undefined`。
- `attempt_id` **不在 rollback 中推进**；留待 `startStep` 重跑时 `attempt_id = ++attempts`（与现有 attempts 计数语义一致；rollback 不虚增计数）。旧 attempt_id 存于 history 快照。
- `clearArtifacts` 选项**废弃**（物理清除不再支持；INV-ROLLBACK-2 禁止）。调用方若传则忽略并记 deprecation。

### 3.5 投影函数（INV-ROLLBACK-1 隔离）
- `canStart` 的"produced"检查读 `state.artifacts`（**当前 attempt**）。rollback 后为 `{}` → 下游失输入（emergent cascade 满足）。历史 artifacts 在 `history[].artifacts`，**投影不读取**。
- `isComplete`：`status==='passed'` 且（`step.humanGate ? state.approval?.decision==='approved' : true`）。

### 3.6 新增 getAuditHistory(stepId, store): AttemptRecord[] | (AttemptRecord | CurrentSnapshot)[]
- 返回 `[...state.history, currentSnapshot]`，`currentSnapshot = {attempt_id, status, artifacts, gateResults, approval}`（无 `superseded`，标记为当前）。
- 审计视图见全历史（INV-ROLLBACK-2）。

---

## 4. 不变量测试矩阵（实施后须全绿；正反各覆盖）

### INV-HUMAN-1（人类闸门不得无批准即 passed）
| # | 场景 | 期望 |
|---|------|------|
| H1+ | E2 空-闸 `submitGateVerdict` 后 status | `'gated'`（非 passed） |
| H2+ | H1 后 `approveHumanGate(valid approval, approved)` | `'passed'`，`state.approval` 存在 |
| H3- | 未 approve 即 `transition(E2,'passed')` | 抛错 |
| H4- | `approveHumanGate` 的 approval.`actor='agent'` | 抛错 |
| H5- | approval.`attempt_id` ≠ 当前 attempt_id | 抛错（拒绝复用旧批准） |
| H6- | rollback 后用旧 attempt 的 approval 再 approve | 抛错（attempt_id 已变） |
| H7- | `approveHumanGate` 在非 humanGate 步骤调用 | 抛错 |
| H8- | `approveHumanGate(decision='rejected')` | `'blocked'`，approval 留存 |

### INV-ROLLBACK-1（当前投影隔离）
| # | 场景 | 期望 |
|---|------|------|
| R1+ | A1 passed→下游可 start→rollback(A1)→下游 canStart | false（当前 artifacts={}） |
| R2+ | rollback 后 A1 当前 `artifacts`/`gateResults` | `{}` |
| R3+ | rollback 后 `canStart(A1)`（自身输入仍在） | true，可 `startStep` 重跑 |
| R4- | 投影（canStart/isComplete）读取 `history[].artifacts` | 不得（隔离） |

### INV-ROLLBACK-2（历史证据保留）
| # | 场景 | 期望 |
|---|------|------|
| H1+ | rollback 前 A1 artifacts={x,y}；rollback 后 `getAuditHistory` 含旧快照 | history[0].artifacts==={x,y}（未物理清除） |
| H2+ | 多次 rollback → `history.length` | 每次 +1（追加） |
| H3+ | rollback 前 gateResults={B:...}；历史快照保留 | history[].gateResults 含旧 B 裁决 |
| H4- | rollback 物理改写历史快照内容 | 不得（追加只读） |

### 回归（不破坏现行 7 测试，调整断言）
- 现行测试 (c)/(e)/(f)：涉及空闸门或 rollback 的断言需按新契约调整（如非 humanGate 步骤空闸门仍 passed；rollback 改为历史追加而非物理清除的字段断言）。现行 (g) illegal transition 仍成立。

---

## 5. 覆盖报告口径（满足"状态迁移+不变量，非计数"）
实施后报告须含：
- **状态迁移覆盖**：pending→in_progress→gated→passed/blocked/failed 全边；humanGate gated→passed(经 approve)/gated→blocked(reject)；rollback any→pending（历史追加）。
- **不变量覆盖**：INV-HUMAN-1（H1-H8）、INV-ROLLBACK-1（R1-R4）、INV-ROLLBACK-2（H1-H4）逐条 pass/fail。
- 不以"测试数=N"作完成证据。

## 6. 不触约束重申
- 仅领域核心+状态机；不扩 Tools/Team/Web/Bundle/AgentLoop。
- 不引新第三方依赖（typescript/vitest/@types/node 既有）。
- 不写真实 key；无 credentials 涉及。
- E2 humanGate 语义=人类确认投稿；非 agent 生成批准。
- 直跑 node 二进制 tsc/vitest 验证（不经 pnpm，不改锁文件）。
- 两契约明确前**不得** P1.6（#2）。
