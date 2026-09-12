# Batch 2 Wave 1 — P2 三工具增量独立审计(C2,general-purpose-3)

**审计时间:** 2026-09-03(GMT+8)
**审计性质:** 单独立审计(fresh-eyes)。对被审对象无任何先验实现知识;全程只读,唯一写入为本交付物(位于 git 仓库外)。
**仓库零改动确认:** 未修改/创建/删除 `deepseek-harness-master1` 内任何文件。审计中曾运行一次覆盖率门禁,其 `coverage/` html 产物已即时删除;`git status --porcelain` 于审计末复核为空。
**审评对象:** `D:\1\deepseek-harness-master1\deepseek-harness-master`,master @ `ebed4cf`(工作树 clean)。

---

## 1. 审计范围与方法

**线性提交链(全部在 master):**
- `b25947e` scaffold: workspace package + shared 约定(package.json/tsconfig.json/src/index.ts 占位/src/shared.ts + pnpm-lock.yaml)
- `07a1e77` T12 literature-search(4 文件全部限于 literature-search 目录,19 tests)
- `528135c` T13 citation-verify(2 文件全部限于 citation-verify 目录,6 tests)
- `d33e424` T14 claim-construct(2 文件全部限于 claim-construct 目录,11 tests)
- `ebed4cf` 集成(src/index.ts 聚合 + tests/entry/public-surface.spec.ts,7 tests)

**方法/命令:** `git log --oneline -8`、`git show --stat <hash>`、逐提交 `git show <hash> --check`(whitespace)、`git diff --stat b25947e^..HEAD`、`git diff --name-only`、`git ls-files`(排除 .tsbuildinfo);逐一全文 Read 8 个 src 文件 + 4 个 spec(约 1800 行);对 core `src/citation/verify.ts` 全文比对(约束 4);grep 密钥/网络/状态机/`Date.now`/`supportStatus` 定值路径;独立重跑测试与类型检查;独立运行仓库 per-file 100% 覆盖门禁(仅测 tools 包,产物已清理)。

**独立执行结果:** `vitest run packages/research/dsh-research-tools` → **4 files / 43 tests 全绿**(claim-construct 11, literature-search 19, public-surface 7, citation-verify 6),与提交声明的 43 一致;`tsc --noEmit` clean。batch-1(core/cordis)按指示不重审。

---

## 2. 逐条合规判定(checklist 1-9)

### 1. DIR EXCLUSIVITY —— ✅
`git show --stat` 逐提交核验:07a1e77 的 4 个文件全在 `src/tools/literature-search/`+`tests/literature-search/`;528135c 全在 `src/tools/citation-verify/`+`tests/citation-verify/`;d33e424 全在 `src/tools/claim-construct/`+`tests/claim-construct/`。无任何单工具提交触碰其他工具目录或共享文件。共享文件只出现在 scaffold(b25947e)与集成(ebed4cf)。

### 2. MAIN-AGENT OWNERSHIP —— ✅
- `package.json`、`tsconfig.json`、`pnpm-lock.yaml` 仅出现在 b25947e(scaffold);此后四个提交零触碰(证据:`git show --stat` 逐提交)。
- `src/index.ts` 仅在 b25947e(占位,10 行)与 ebed4cf(聚合)被改;ebed4cf **只**改 `src/index.ts` + `tests/entry/public-surface.spec.ts`(stat 证实,与集成提交声称一致)。
- 各工具提交从未触碰 index.ts/package.json/tsconfig/lock。

### 3. T12 FIXTURE/MOCK ONLY —— ✅
- 无网络/无真实 key/无 model gateway:`adapter.ts` 定义唯一外接缝 `LiteratureSearchAdapter.search(query)`(注入参数,非模块内构造);`src/` 全量 grep(`fetch|XMLHttpRequest|WebSocket|process\.env|https?://|api[_-]?key|secret|Bearer`)零命中(仅注释里 "token OR" 等词被误命中,已排除)。
- 数据全合成:`mock.ts:19-45` SYNTHETIC_CORPUS,venue 均为 `Synthetic Journal A/B/Conference A/B/Regional Journal A`,title 均 `Synthetic` 前缀;refId 用 Crossref 保留测试域 `10.1000/synth-lit-*` 与 impossible month-99 arXiv 风格 id(`2499.xxxxx`),无任何真实期刊/真实 identifier/未确认许可数据。
- T12 工具(及其 mock)不 import core;adapter.ts 头注释明示"no core import so this module type-checks in isolation"。

### 4. T13 DELEGATES T08,NO COPIED LOGIC —— ✅
- `citation-verify/index.ts:25` 从 `@deepseek-ai/dsh-research-core` import 同名 `verifyCitation` + `ResearchError`。
- 委托调用点(index.ts ~102-108)实参与 core `verify.ts` 导出签名**逐位同序**:`verifyCitation(input.claimId, input.citationId, input.ref, input.evidence, deps.resolver, timestamp, input.options)` ↔ core `verifyCitation(claimId, citationId, ref, evidence, resolverAdapter, timestamp, options)`。
- 工具体内**无**裁决分支:无 outcome switch、无 red-line / not_found / ambiguous / retracted / identity_mismatch 本地复刻、无 makeResult 式结果构造;核心裁决(红线首查、resolver triage、retraction、identity、correlation、content gap、conclusion 放行)全部只在 core verify.ts。与 core 全文比对无逻辑复制。
- 错误透明:工具对 core 调用无 try/catch,core 抛错原样上抛(spec C6 用 `DSH_CITATION_VALUE_NOT_CLONEABLE` 直证)。
- 唯一"本地逻辑"是 6 行 `assertNonEmptyBrand`(index.ts:67-71),空 id 时抛与 core 完全相同的 code(`DSH_CITATION_INVALID_REF`),作为 timestamp 兜底前的 fail-fast —— 属输入守卫而非裁决,不违反"thin"约束,记入非阻塞观察。

### 5. T14 CONSTRUCTS ONLY —— ✅
- `supportStatus` 全代码唯一定值:`index.ts:173` 仅经常量 `CLAIM_SUPPORT_STATUS_NOT_CLAIMED`(`index.ts:35`,`'not_claimed' as const`);类型面 `index.ts:74` 收窄为字面量 `'not_claimed'`;grep 确认无其他赋值路径(第 149 行系注释)。spec D2 用 3 个变体(falsifiability/note/手动 id)直证恒为 `not_claimed`。
- 工具从不主张文献支持:无任何 supported/verification 相关字段或逻辑;仅 `import type { ClaimId }` 于 core。
- claimId 确定性:`resolveClaimId`(134-143)—— caller 提供则 trim 采用;否则 `claim-{slug48}-{FNV1a32-8hex}`(slugify 100-107 + stableHash 92-97,`hash>>>0 .toString(16).padStart(8)`)。spec D5/D6 直测确定性、falsifiability/note/首尾空白不扰动 id、caller id 采用。

### 6. ARTIFACT-ONLY,NO STATE-MACHINE ADVANCE —— ✅
- `shared.ts:25-42 freezeArtifact` = `structuredClone` + 递归 `Object.freeze`(deepFreeze 覆盖对象与数组;`clone` 保证无活引用逃逸,`freeze` 保证写抛错)。
- 三工具产物全部经 `freezeArtifact` 产出并带 `meta: ToolArtifactMeta{toolId, version, producedAt}`(shared.ts:45-49;T12 index.ts:210-244、T13 ~109-116、T14 177-184)。
- 状态机零触碰:grep `_apply|applyGate|stateMachine|ResearchEngine|advance` 于 src/ 仅命中注释(shared.ts:11、index.ts:5、citation-verify/index.ts:61 提到 `GATE_OUTCOME_TO_INTENT` 仅为"绝不在此重映射"的注释);无 engine/gates import;T13 只 import 纯函数 `verifyCitation`。不自动转换 gate outcome、不涉及 abstained(T19 前契约范围外,三工具均无相关代码)。

### 7. NO TOUCH OUTSIDE SCOPE —— ✅
`git diff --stat b25947e^..HEAD` 全部 14 个文件 = 13 × `packages/research/dsh-research-tools/**` + 1 × `pnpm-lock.yaml`。无 core engine/state-machine、无 cordis、无 Host trust channel、无 B-PICK/VSDX 相关文件改动。lock 文件改动仅在 scaffold(b25947e,新增 workspace importer + 既有 content-type 去重,属 pnpm 正常解析刷新),由主 Agent 持有,符合约束 2 所有权。

### 8. NO-DEFAULT-PASS(T12 contract)—— ✅
- adapter 恰好一次:`runLiteratureSearch`(index.ts ~275-283)单次 `adapter.search(normalizedQuery)`,无 retry/无 fallback;spec「calls the injected adapter exactly once」直测 `calls===1`。
- outage → `unavailable` + 零 hits(buildArtifact 'unavailable' 分支,index.ts:226-240:`hits:[]`、`truncated:false`,绝不构造 'ok');spec「seeded-unavailable…」「genuine no-match…」双测区分 outage 与空 ok。
- 异常原样上抛:工具对 adapter 调用无 try/catch,throw 直接穿出;spec「an adapter that throws is surfaced」toThrow('adapter exploded')。
- 附加:结构非法输出(status 'maybe')→ `DSH_LITERATURE_SEARCH_INVALID_ADAPTER_OUTPUT`(有测);'ok' 子结构违约分支(见 §3 G1)无测但实现正确。

### 9. REPO HYGIENE —— ✅(附注)
- HEAD(ebed4cf)工作树 clean(`git status --short` 空),审计全程复核。
- `git ls-files` 全仓无任何 `*.tsbuildinfo`;tools 包内无多余 module tsconfig(仅标准 `tsconfig.json` extends 仓库 base)。
- 逐提交 `git show <hash> --check` 5 提交全 clean(无 trailing whitespace/space-before-tab)。
- lefthook 配置(`lefthook.yml`)含 lint(oxlint staged)/whitespace/vendor manifest guard/third-party notices;git log 本身不记录 hook 运行结果,历史 hook 是否实际执行无法独立确证(任何 git 审计的固有局限),但树状态与 whitespace 结果与"hooks passed"一致;本次增量新增依赖均为仓库既有依赖(@types/node/typescript/vitest)或 workspace link,无第三方 notice 增量。

---

## 3. Q2 缺口交叉核对(G1/G2/G3 独立 spot-check)

### G1(T12 buildArtifact 'ok' 子结构违约分支零直测)—— **属实,且影响被低估**
- 逐行核对 `literature-search/index.ts`:195/198/204/207 四条违约分支(`!Array.isArray(ok.hits)` / total 非法 / `hits.length>total` / `hits.length>maxResults`)在现有 19 tests 中**零直测**;唯一结构违约测试只覆盖 status='maybe'(242-244)。
- **新证据(超 Q2)**:独立运行仓库覆盖门禁(v8,per-file 100% statements/branches/functions/lines,阈值非 partition 模式)后,`literature-search/index.ts` 实测 **statements 90.38 / branches 90.56**,报告 20 处 uncovered locations 中包含 **189(非对象 outcome)、196、199、205、208(G1 四条 throw)**。即 Q2 自己标注的"若覆盖门禁在本包生效,这些分支会在覆盖通道暴露"——**门禁确实生效且当前 FAIL**。详见 §5 结论。

### G2(T12 mock fixture 契约无直测)—— **属实**
- 不存在 `mock.spec.ts`;5 个契约点(token OR / venue+refId 入 haystack / fresh-hit 无别名 / 实例隔离 / syn-lit-NNNN id)均无直接断言。现有用例仅经工具间接覆盖 'synthetic' 全命中 14 条与 'no-such-token' 0 命中,无法区分 OR 语义、无法证明 venue/refId 参与匹配。
- 覆盖门禁佐证:`mock.ts` branches 90%,uncovered location 在 **140 行**(`Math.max(0, query.maxResults)` 防御分支,工具路径永不触达)。

### G3(T13 薄委托结构锁缺失)—— **属实**
- 6 个 spec 全为行为等价断言(结果字段匹配 core 语义),唯一 spy 打在 **resolver 的 resolveMetadata**(C2 红线零调用),而非 core `verifyCitation` 本身;无 `vi.mock` 证明经工具调用**恰 1 次**且实参顺序为 core 7 元序。当前实现经代码阅读确认正确(§2.4),但结构未被测试锁定。

### 附加核对(非 top-3)
- **G4(T13 timestamp 兜底)属实**:citation-verify/index.ts **96 行** `input.timestamp ?? Date.now()` 的 Date.now() 路径在覆盖报告 uncovered(binary-expr path 2/2),6 用例全显式传 TS。T14 同构(claim-construct/index.ts **167 行** `input.now ?? Date.now()` 亦 uncovered),Q2 只列了 T13。
- **G6 属实**(claim-construct 137-138 whitespace claimId 分支 uncovered)、**G7 属实**(106 行 slug `'claim'` 回退 uncovered)。
- **Q2 遗漏**(不在 G1-G9,覆盖门禁暴露的额外分支):claim-construct **110-111**(assertPlainObject 非对象防御)与 **153-154**(input null 守卫);literature-search/index.ts **188-189**(outcome 非对象);mock.ts **140**(负 maxResults 防御)。均系防御性分支,无独立用例。

### 阻断判定
G1/G2/G3 单独看均为"测试密度"缺口:对应**实现经审计全部正确**,且本波关键 trust-boundary 不变量(NO DEFAULT PASS、adapter 恰好一次、异常原样上抛、红线零调用短路、虚构≠unverified、supportStatus 冻结、深冻结无活引用)均有直接断言——**就冻结合规清单而言无任何一条升级为阻断**。但 G1 所承载的"仓库 per-file 100% 覆盖门禁 FAIL"是 Q2 未实测、我实测证实的**收口条件问题**,归入 §5 结论。Q2 将 9 项全评为低-中、不阻断,**基本成立但需修正**:覆盖门禁一项使 G1 的后果超出"纯测试债"。

---

## 4. 非阻塞观察

1. **工具版本体系不一致**:T12 `0.1.2-alpha.4`(与包版本 lockstep)、T13 `0.1.0`、T14 `1.0.0`;entry spec 对 T12 仅 `/^0\.1\./` 前缀、对 T13/T14 字面锁死。版本 bump 时入口 spec 需人工同步(Q2 已注,确认)。
2. **T13/T14 时钟兜底**:省略 timestamp/now 时 `Date.now()` 兜底(均在文件内注释声明"仅省略时");T12 则强制注入(无兜底)。三工具"确定性"仅在显式注入时成立,注释已如实声明,无合规问题,但兜底分支零测(G4/T14-167)。
3. **T13 极薄化的两处可议点**:① 本地 6 行 `assertNonEmptyBrand` 与 core 首查重复(同码 fail-fast,理由充分但严格说可删);② `input` 为 null 时在 `input.claimId` 处抛裸 TypeError 而非 ResearchError(无 null-input 守卫),错误风格与 T12 带前缀 Error 不一致。
4. **T14 非字符串 assertion**(如数字)在 `assertion.trim()` 抛裸 TypeError(Q2 G8,确认);T14 与 T12/T13 的错误风格(带 `[tool-id]` 前缀)不一致。
5. **入口 spec 按相对 `.ts` 路径消费**:包名 `@deepseek-ai/dsh-research-tools` 消费待 gitignored `lib/` 构建后,spec 头注释已记录为延迟项(非缺口)。T13 未在入口级端到端执行(G9,确认属实:public-surface.spec E3 只锁身份/同一实例)。
6. **hook 历史不可证**:lefthook lint/vendor-guard 在提交时是否实际通过无法从 git log 独立确证;本次仅能证 whitespace(逐提交 `--check` clean)+ 树状态 clean。新依赖均为仓库既有或 workspace link,无 notice 增量,与 hook 预期一致。
7. **审计过程注**:沙箱 stdout 偶发退化(exit 0 但空输出)未对本审计造成影响;覆盖运行产生 gitignored `coverage/` html 已删除,树复核 clean。

---

## 5. 结论

**CONDITIONAL-BLOCKER(条件性阻断)**

**9 条冻结约束全部合规(✅),无任何代码/结构违规;43/43 tests 与 tsc 均独立复验绿态;Q2 的 G1/G2/G3 全部属实且描述准确(Q2 遗漏若干同源防御分支,已补列)。**

**唯一阻断条件**:仓库质量门禁 —— 根 `vitest.config.ts` 对 `include: ['packages/*/*/src/**/*.{ts,tsx}']` 施加 **per-file 100%(statements/branches/functions/lines,非 partition 模式)阈值**,本波 4 个有运行时代码的 src 文件**当前全部低于 100%**(citation-verify branches 83.33;claim-construct statements 92.68/branches 86.48;literature-search statements 90.38/branches 90.56;mock branches 90),合计 **20 处 uncovered locations**,已实测复现。若"关闭本波"以仓库 CI 覆盖车道通过为准,则该增量为**红**。

**具体可执行 blocker(不可含糊):**
1. 补齐 G1 四条 + 同文件 188-189(outcome 非对象):在 `tests/literature-search/literature-search.spec.ts`「structurally-invalid adapter output」describe 追加手写 adapter 返回 `{status:'ok'}`(缺 hits)、`{status:'ok',hits:[x],total:-1}`、`{status:'ok',hits:[a,b],total:1}`、`{status:'ok',hits:[a,a,a],total:3}&maxResults:2`、`null`/`42` 作 outcome → 均断言 `DSH_LITERATURE_SEARCH_INVALID_ADAPTER_OUTPUT`。
2. 补齐 citation-verify/index.ts:96(timestamp 兜底):追加省略 timestamp 的用例,断言 `meta.producedAt` 与 `result.timestamp` 为数字且相等(≈调用时刻)。
3. 补齐 claim-construct 106/110-111/137-138/153-154/167:纯 CJK assertion(→`/^claim-claim-/` 回退)、whitespace-only claimId、`constructClaim(null)`、省略 now、非对象 falsifiability。
4. 补齐 mock.ts:140(负 maxResults 防御)或将该防御简化为 `Math.min(total, query.maxResults)`(工具已保证 ≥1,该分支不可达)。
5. 补测后以覆盖车道(非 partition 模式)复核至每文件 100%;或对纯防御分支按仓库政策加**带理由的 `v8-ignore` 注释**(docs/testing.md:every ignore must carry a reason)—— 二者择一,由主 Agent 裁定。
6. 若团队裁定本波收口**不以**该 CI 覆盖车道为判据,则本条件解除,整体降为 **PASS-with-notes**(缺口清单转为后续补测债,债主项为 G1+G3,与 Q2 判断一致)。

**快照事实供 team-lead 定夺:** 提交链已在 master HEAD;本审计无法从沙箱观测 CI 是否对该路径执行覆盖车道 —— 若 master CI 已跑,该车道应已在 ebed4cf 处失败;若 CI 不覆盖 research 包路径,则本条件不成立。

---

## 6. 收口记录(team-lead 处置,2026-09-03 16:46)

**裁定**:仓库 per-file 100% 覆盖门禁(根 vitest 配置全局 include `packages/*/*/src/**`,research 无豁免,per-file 100/100/100/100,经 `check:ci:coverage` 接入 CI,仓库规范 "100% or it doesn't merge")**适用于本波增量**;§5 条件性阻断成立 → 执行 §5 修复清单。

**修复执行(独立实现 Agent,commit `17c77bf`)**:纯测试增量(仅 3 个 spec,+160 行,+14 用例,43→57),src 四文件零改动、零 v8-ignore:
- literature-search.spec 27 条(+8):G1 六条(缺 hits / total 非法 / hits>total / hits>maxResults / outcome=null / outcome=42,覆盖 outcome 守卫 `||` 两臂)+ mock 防御 2 条(`maxResults:-5` 直调绕过工具归一化 → hits 空 total 仍 14,覆盖 `Math.max(0,…)`;空 topic 直调覆盖空 token 过滤臂);
- citation-verify.spec 7 条(+1):timestamp 省略 → `Date.now()` 兜底,断言 `meta.producedAt === result.timestamp` 且为有限数、≈调用时刻(index.ts:96);
- claim-construct.spec 16 条(+5):106 纯 CJK slug 回退 `claim-claim-<hash8>` / 110-111 非对象 falsifiability / 137-138 空白 claimId / 153-154 `constructClaim(null)` / 167 省略 now。

**复核证据**:per-file 覆盖(tools-only 覆盖运行实测)literature-search/{index,mock}.ts、citation-verify/index.ts、claim-construct/index.ts 全部 **100/100/100/100**;tsc tools/core/cordis 全 clean;全量回归 **290/290 绿**(core 215 + cordis 18 + tools 57);`git status` 空。lefthook(lint 0 warn/0 err / whitespace / vendor guard)全过。

**终局判定**:§5 阻断解除 → 本审计整体升为 **PASS**(9 条冻结约束合规 + 覆盖车道 100% 收口)。残留非阻断债(不含于本审计阻断范围):G2 mock fixture 契约直测(OR/venue+refId/fresh-hit 别名/实例隔离/syn-lit id)、G3 T13 薄委托结构锁(vi.mock 计数 verifyCitation 恰 1 次 + 实参同序)、工具版本字符串不一致与 T14 错误风格(§4 obs 1/3/4)等,已记入 Q2 矩阵与本节,待后续 wave 补测债。
