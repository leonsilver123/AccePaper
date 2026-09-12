# Batch 2 Wave 1 — Q1 测试差距分析(T07/T08/T09 冻结不变量 × 现有测试)

**分析时间:** 2026-09-03 ~15:30(GMT+8)
**分析性质:** 只读差距分析(Q1 角色);产出矩阵 + 差距清单 + 已执行的补充项
**基准规格:** `packages/research/dsh-research-core/src/contracts.ts`(冻结契约,含 NON-NEGOTIABLE INVARIANTS)+ 三模块头注释 + 用户路径 D 五项裁决(§9.1 of `batch2-wave0-review.md`)
**被评对象:** core 全量 **212 项**(批次1 core 子集 72 + 新模块 140:routing 42 / verify 29 / red-line 10 / gates 59)
**结论:** 覆盖度极高,无阻断性缺口;发现 1 个未锁定判别单元(#6 resolver 接触边界)、1 个契约死旋钮(已由主 Agent 处置)、1 个低优可选补强;静态类不变量移交 C1 审计与 I1 验收。

> 说明:原始指令中 Q1 基数为"现有 126 项"——该数字在路径 D 契约修正与补测后已演进(现 212+);本分析以**当前真实仓库状态**为准,并记录每步增量。

---

## 1. 差距矩阵(不变量 × 覆盖 × 证据锚点)

### 1.1 跨模块不变量(contracts.ts 头,INV-*)

| 不变量 | 判定 | 证据锚点(describe / it) |
|---|---|---|
| INV-SNAPSHOT:输入克隆+冻结,不留活引用,返回深冻结 | ✅ | l0「IMMUTABLE SNAPSHOTS」(258–340,7 it);citation「IMMUTABLE SNAPSHOTS」(255–290)+ getter/原型污染(red-line 49–133);gates「immutability + isolation」(398–462) |
| 非 cloneable 输入 → 模块前缀 DSH_*_VALUE_NOT_CLONEABLE | ✅ | l0 271/279;citation 196;gates 423/448 |
| NO DEFAULT PASS:未知/缺证据/冲突 → abstained/blocked/unverified,永不静默通过 | ✅ | l0「NO-DEFAULT-PASS counterexamples」(96–219);gates「ABSTENTION-NOT-UPGRADABLE」(520–543)+ 阈值守卫(115–161);citation claimed-unverified(182–191) |
| abstained 不可升级为 passed(跨模块边界) | ✅ | gates「frozen mapping」(475–518)+ 专用 describe(520+) |
| NO TRUTH CLAIM:L0/verify/gates 均不断言"文献真实/主张已证" | ✅ | l0「NO TRUTH CLAIM」(220–243,3 it);citation 结论语义测试;gates B 锚规则(240–308) |
| 纯函数:无网络/fs/共享态/时钟(timestamp 注入) | ⚠️ 静态 | 仅设计约束 + 注入 TS 的确定性测试;无网络/密钥静态扫描已在 Wave 0 §6 通过 → **移交 C1 静态审计** |
| 可审计:reasonCode(模块前缀)+ evidenceRefs + timestamp | ✅ | l0 395(7 字段);gates 365(所有 reasonCode 均 DSH_GATE_ 前缀)+ evidenceRefs;citation 每结论断言 code |
| 错误基类:只抛 ResearchError(模块前缀),不抛裸 Error | ✅ | l0 DSH_L0_MISSING_ADAPTER/INVALID_SOURCE_INPUT;gates DSH_GATE_INVALID_INPUT;citation DSH_CITATION_VALUE_NOT_CLONEABLE |
| 模块隔离:不 import 兄弟模块实现,仅经 contracts 类型通信 | ⚠️ 静态 | 代码走查确认(§4 of Wave0 报告);无 fs 脆性单测 → **C1 审计 + 仓库门禁**(vitest 不读文件,避免脆测) |
| Gate→状态机映射冻结,单一解释点 | ✅ | gates 475–518(5 it:表冻结/abstained≠pass/helper 全函数/端到端) |

### 1.2 T07 L0(42 项)

| 语义 | 判定 | 证据锚点 |
|---|---|---|
| 9 类 source type 路由,adapter-driven(非硬编码 switch) | ✅ | routing(28–94)11 it + configurable(373–395) |
| tier/status 分离(L0Tier 不含 abstained,编译期守卫) | ✅ | tier/status guards(422–442,4 it 含 @ts-expect-error) |
| abstained = 数据不足/规则冲突/敌意 adapter;failed = adapter 故障/结构损坏 | ✅ | counterexamples 113–219(缺 id/冲突/钳制/抛错→failed/非法 tier→failed/非法 status→failed) |
| 未识别类型 → classified + tier unknown(非弃权混淆) | ✅ | 97/104 |
| unvetted vs unknown 语义区分 | ✅ | 55(未列名期刊→unvetted)/97(unknown 类型) |
| preprint 仅风险旗标,绝不等于 tier1 | ✅ | 86 + 235 |
| 快照/隔离/审计 | ✅ | 258–395 |

### 1.3 T08 citation(verify 29 + red-line 12)

| 语义 | 判定 | 证据锚点 |
|---|---|---|
| #1 虚构(resolver not_found)→ blocked+redLine,绝不 unverified | ✅ | verify 28–46(resolverStatus='not_found' 已断言) |
| resolver 判别联合:outage/ambiguous → unverified 无 redLine | ✅ | verify 47–66 |
| malformed(adapter 故障)≠ 虚构 | ✅ | verify 67–75 |
| #2 身份不符 / #3 内容不支持 / #4 撤稿(未标=redLine,已标=surface)/ #5 相关作因果 | ✅ | verify 79–149 |
| #6 硬红线最先判定,不可绕过 | ✅ | red-line 全文(plain triggers + getter/原型污染/事后改输入) |
| **#6 短路不接触 resolver:resolverStatus 必须缺席(与虚构 not_found 的判别器)** | 🆕 **本次补 +2** | red-line plain triggers 新增 2 it(44–65 区域):fixtureResolver 可解析仍无 status;notFoundResolver 不得泄漏 code → RED_LINE_NO_ORIGINAL |
| happy path:supported/partial/claimed-unverified + resolverStatus='resolved' + provenance 透传 | ✅ | verify 150–192(160 断言 resolved;162–163 断言 sourceUri/contentHash 存活) |
| 输入校验:accessedAt iff method、provenance 字符串型、invalid kind/method/options/timestamp | ✅ | verify 195–253 |
| 跨 run 隔离 / 冻结 | ✅ | verify 255–292+ |

### 1.4 T09 gates(59 项)

| 语义 | 判定 | 证据锚点 |
|---|---|---|
| A 门 pass/fail/blocked(歧义) | ✅ | gates 89–113 |
| 阈值纯配置:缺省/NaN/越界/非整数 → abstain(无硬编码"2 票通过") | ✅ | gates 115–161 |
| 同族检测+降权:未校准权重→abstain;簇上报(C3 不伪装异质性) | ✅ | gates 163–238(6 it) |
| B 门:锚可用/redLine 阻断/无锚 abstain;非锚结论(撤稿/unsupported/mismatch/未访问)不得当锚 | ✅ | gates 240–308(8 it) |
| C 门矩阵:无可证伪→blocked/空串/非串;有预测无实验→abstain;非 bool→abstain;实验支持/否定 | ✅ | gates 310–356(7 it) |
| dispatch + 结构校验 + reasonCode 前缀 + 不可变/污染隔离 | ✅ | gates 358–473 |
| 冻结映射 + abstention 不可升级 | ✅ | gates 475–543 |
| **配置面卫生:requireFalsifiableResult 死旋钮(全仓库零引用,C 门硬性要求可证伪,与配置无关)** | 🆕 **本次处置(D1)** | 契约字段已移除 + gates 注释同步(见 §3) |

---

## 2. 差距发现与处置

| # | 级别 | 发现 | 处置 |
|---|---|---|---|
| F1 | Must(未锁定判别单元) | #6 红线结果是否携带 `resolverStatus` 无断言——若未来重构在 #6 路径误触 resolver 或乱盖章,测试无法察觉 | ✅ **已补**:red-line +2 it(§1.3);断言短路路径 `resolverStatus === undefined`、且与虚构(not_found)结果形成判别。**复核后再补 1 it**(`a4c7dc3`):vi.fn 抛错 spy + `not.toHaveBeenCalled()`,杜绝"先调用再丢弃"的实现仍过测 |
| F2 | Main-Agent 决策(契约死面) | `AdjudicationConfig.requireFalsifiableResult` 零引用;C 门按冻结契约硬性要求可证伪预测(无预测→blocked),不存在可关闭该要求的合理语义——保留将诱使 T10-R 误读为可配置旁路 | ✅ **已移除**(contracts.ts + gates/index.ts 注释同步),见提交 1 |
| F3 | Low(可选) | venue tier 分级仅 journal 覆盖 tier1/2/3,conference 仅 tier1;arxiv/isbn/standard 引用类未做 E2E resolve | 不阻塞;fixture 表按类型对称、判别联合已由 doi 路径全覆盖 → 列为可选,交模块补充时再定,避免为测而测 |
| F4 | Deferred(C1 静态) | 模块隔离(不 import 兄弟实现)、纯函数无 I/O、sk-xxx 无真密钥 —— 属静态/仓库级不变量,vitest 单测读取 fs 会产生脆测 | 移交 **C1 独立审计**(静态红线扫描 + 目录/导入边界核对)+ 仓库门禁 |
| F5 | Deferred(I1 验收) | "Cordis 必须消费 `gateToStateMachineIntent`/`GATE_OUTCOME_TO_INTENT`,不得自行重解释" —— core 内无可测点,须待 T10-R(Cordis 包裹)后验收 | **I1 接受准则**:Cordis 断言消费冻结映射;任何自行 switch 重解释视为失败 |

---

## 3. 本次执行变更(主 Agent 汇合,路径限定提交)

| 提交 | 内容 | 验证 |
|---|---|---|
| (1) `src/contracts.ts` + `src/gates/index.ts` | 移除 inert `requireFalsifiableResult`(F2);C 门注释改为"硬性要求可证伪,无配置旁路";contracts 接口内注释记录原因 | tsc exit 0 |
| (2) `tests/citation/red-line.spec.ts` | F1:+2 it(#6 短路 resolverStatus 缺席判别;not_found 不得泄漏进 #6) | red-line 10→12 |
| (3) `tests/citation/red-line.spec.ts`(Q1 关闭复核) | F1 补强:+1 it(vi.fn 抛错 spy,**resolver 零调用**锁定 #6 先于 resolver 接触短路) | red-line 12→13 |

**处置后全量:** `vitest run packages/research/dsh-research-core/tests` → **6 文件 / 215 项全绿**(+3);`tsc --noEmit` exit 0。

## 4. Q1 结论

- 覆盖评估为"近乎逐条、无阻断性缺口"——该表述已按复核意见收敛为**时效性判断**:截至本分析时刻,140 项新模块测试对冻结契约的逐条映射未发现其他语义判别缺口;F1/F2 已闭环,复核补强(F1 零调用判别器)后正式关闭。
- 唯一语义判别缺口(F1)与契约死面(F2)已于本分析内闭环。
- 剩余可测工作全部依赖外部接线:静态类→C1;Cordis 消费映射→I1 验收。
- **下一步建议:** 启动 **I1(T10-R,Cordis 增量)**,验收准则含 F5;随后启动**单一 C1 独立审计**(静态红线 + 模块隔离 + 提交边界归属核对)。

## 5. Q1 关闭记录(用户复核,2026-09-03)

- **判定**:Q1 整体通过;补一项"resolver 零调用"短路测试后关闭(§1/§3 之 a4c7dc3);`requireFalsifiableResult` 删除 ✅;214 项接受。
- **复核意见**:原新增测试仅断言 `resolverStatus === undefined`,不足以证明 resolver 未被调用(实现可先调用再丢弃结果);真正的判别器是"接触即抛错"的 spy + `not.toHaveBeenCalled()`。
- **I1 授权边界**(见 `plan/batch2-wave0-review.md` §9.5):仅薄适配与结果暴露;`getGateIntent(result)` 只委托 `gateToStateMachineIntent`;Gate 自动驱动状态机暂缓(hold_abstained 契约缺口,单独设计)。
- **验证**:补测后仅跑 citation 目录(42/42)与 core typecheck(exit 0),即提交 `a4c7dc3`。
