# Batch 2 Wave 1 — Q2 跨工具测试矩阵(T12/T13/T14 三科研工具 × 冻结验收准则)

**分析时间:** 2026-09-03(GMT+8)
**分析性质:** 只读架构/QA 产出(Q2 角色);矩阵 + 集成层覆盖 + 缺口清单;唯一交付物本文件,git 仓库零改动
**被评对象:** `dsh-research-tools`(T12 literature-search / T13 citation-verify / T14 claim-construct + 聚合入口 src/index.ts + shared.ts),`dsh-research-core`(contracts.ts / citation/verify.ts)作契约锚,`dsh-research-cordis` 仅作薄委托先例参照(属 I1,非本矩阵范围)
**当前基线(分析时点):** 四个提交已落盘 —— `07a1e77`(T12,19 tests)、`528135c`(T13,6 tests)、`d33e424`(T14,11 tests)、`ebed4cf`(集成入口,7 tests);全量回归 276 全绿(core 215 + cordis 18 + tools 43)。本矩阵以 HEAD 源码与 spec 为准逐条核对,未在分析中改动任何仓库文件。

---

## 1. 范围与依据

本矩阵锚定的「冻结契约/验收准则」来源(按证据优先级):

1. **工具包内冻结 brief(最高具体性)** —— `packages/research/dsh-research-tools`:
   - `src/index.ts` 聚合头:P2 三工具均须为 **PURE、fixture 驱动、返回深冻结 artifact、绝不推进批次1状态机**;**刻意不引入 T19 registry**,artifact 经 `meta.toolId` + `meta.version` 自描述。
   - `src/shared.ts` P2 工具规则 **1-5**:① 纯函数(仅输入 + 注入 adapter,无隐藏 IO);② 不触真实 model gateway / 真实外部文献 API,外部服务**只经 adapter 接缝**,本波仅 Fixture/Mock + **纯 synthetic 数据**(无许可未确认数据);③ 经 `freezeArtifact` 返回深冻结 artifact(结构化克隆 + 递归 Object.freeze,无活引用逃逸);④ **不推进状态机、不自动转换 gate outcome**(接线属 T19);⑤ **复用 core 逻辑而非复制**(如 T13 必须 import T08 `verifyCitation`)。
   - 各工具 `src/tools/<name>/{index,adapter,mock}.ts` 头注释(冻结设计 brief + trust-boundary invariants):T12 **NO DEFAULT PASS**、adapter 恰好一次、adapter 抛错原样上抛;T13 **thin delegation**、与 core 相同实参顺序、错误透明;T14 `supportStatus` 恒冻结 `'not_claimed'`、cap 2000、确定性 claimId。
2. **计划文档** —— `final_execution_plan.md`:§九 T12-T18 行(工具可并行,验收「工具可调用产出 artifact」)、§十(阻塞汇合点 T19)、§五 C5/C6(引文身份链与 core 职责拆分)、§三 D13/D16(mock 占位;许可未核验数据不得入)、`06_test_acceptance.md` INV-CITE-2/3 + G14(#6 红线/6 类最高级全 blocked 语义由 T08 core 承接,工具层只做薄委托)。
3. **core 冻结契约** —— `packages/research/dsh-research-core/src/contracts.ts`:`VerificationResult` / `VerificationConclusion`('blocked' 同时覆盖 #6 红线与 resolver-confirmed 虚构,'unverified' 绝不与虚构混淆)、`VerifyCitationOptions`、`CitationEvidence`(provenance 字段、`accessedAt` iff method)、`CitationRef`/`CitationId`/`ClaimId`、`GATE_OUTCOME_TO_INTENT`/`StateMachineGateIntent`(冻结映射,消费方为 T19,工具不得重解释)。`src/citation/verify.ts`(T08)为 T13 的唯一裁决逻辑所在。
4. **上下文不变量文档** —— `batch2-t19-hold-abstained-design.md` §7(工具层禁改 engine、不接线;产物不得违反弃权/审计/不可变语义)、`batch2-wave1-q1-gap.md`(#6 短路 **resolver 零调用**判别器模式、静态不变量移交 C1 审计的 F4 先例)。
5. **仓库级背景** —— 根 `vitest.config.ts`:tsconfig paths 别名优先于 package exports(避免 built lib 加载第二份模块单例)、per-file 100% 覆盖门禁配置(含 `packages/*/*/src/**`)。

---

## 2. 跨工具矩阵(main table)

> 状态列:**已覆盖** = 有直接测试断言;部分 = 有间接/行为层覆盖但结构层缺直接断言,或属静态不变量(标注);缺口 = 无直接测试。
> 文件路径均相对 `packages/research/`。

### 2.1 A 组 — P2 跨工具规则(shared.ts + index.ts)

| 测试项 | 覆盖工具 | 所在测试文件 | 关键断言(简述) | 对应验收准则/契约点 | 状态 |
|---|---|---|---|---|---|
| A1 freezeArtifact 深冻结:结构化克隆+递归 freeze,嵌套写抛错,调用方输入事后改动 inert(无活引用) | 三工具(公共) | tools/tests/literature-search/literature-search.spec.ts「ok path…deeply-frozen」;claim-construct.spec.ts「deep-freezes…」;citation-verify/citation-verify-tool.spec.ts「…artifact frozen」;entry/public-surface.spec.ts「re-exports…freezeArtifact」 | `Object.isFrozen` 于 artifact/meta/claim/result/hits/ref/evidence/falsifiability;写 frozen 属性抛错;构造后改调用方 falsifiability 不影响 artifact | shared.ts rule3 + freezeArtifact 注释(与 core INV-SNAPSHOT 同语义) | **已覆盖** |
| A2 每个 artifact 携带 `ToolArtifactMeta{toolId,version,producedAt}`(未来 T19 registry 归因面) | 三工具 | 三 spec 的 meta 断言 + entry spec | toolId==工具常量、version==工具常量、producedAt 为数字且==注入 TS/now;T12 额外断言 unavailable 产物也带 meta | shared.ts ToolArtifactMeta + index.ts:11-13(自描述,registry 不重解释) | **已覆盖** |
| A3 时钟不内读:timestamp/now 调用方注入(确定性、可审计) | T12 / T14 | literature-search.spec「meta envelope」;claim-construct.spec「deterministic…」「meta…producedAt」 | `meta.producedAt===TS`、`constructedAt===now`;同输入两次产物全等 | index.ts:6(clock-free)+ shared.ts rule1(T13 的 Date.now() 兜底见 C8) | **已覆盖**(注入路径;兜底分支见 G4) |
| A4 纯函数无隐藏 IO / 无真实外部服务 / 无真密钥 / 仅 adapter 接缝,synthetic-only fixture | 三工具(静态) | 无 vitest 直测;代码证据:adapter.ts:2-12(external seam)、mock.ts:1-22(synthetic corpus / 无网络 / 无 key)、T13 经 core 注入 resolver | fixture 均为 `Synthetic Journal A` 类命名与 `10.1000/synth-*` / month-99 arXiv id;无真实凭据 | shared.ts rule2 + 计划 D16 + wave0 §6(无网络/无密钥静态扫描) | **部分**(静态不变量,vitest 不可直测 → 移交 C1 审计/仓库门禁,Q1 F4 同款处置) |
| A5 不推进状态机、不自动转换 gate outcome;artifact 内无 gate/state 字段 | 三工具(静态+结构) | index.ts:8-14 声明;三 artifact 接口无任何 engine/StepStatus/gate intent 字段;工具模块无 engine 导入 | 工具公共 API 只产出 artifact;`GATE_OUTCOME_TO_INTENT` 冻结映射不在本包再导出 | shared.ts rule4 + t19 设计 §7(禁改/不接线)+ index.ts:11-13 | **已覆盖**(静态/结构;运行时接线属 T19,刻意不在此测试) |
| A6 reuse-core-not-copy:T13 经包名 import T08 `verifyCitation`/`ResearchError`,工具零裁决逻辑 | T13 | citation-verify-tool.spec.ts 6 its(行为等价于 core 语义) | 各结论/错误码与 core 冻结语义一致;core 错误透明传播(见 C6) | shared.ts rule5 + T13 index.ts:25(import from core)+ C5 拆分 | **部分**(行为等价已覆盖;导入/单次调用结构锁缺失 → G3) |

### 2.2 B 组 — T12 literature-search(19 its 全绿,基线 `07a1e77`)

| 测试项 | 覆盖工具 | 所在测试文件 | 关键断言(简述) | 对应验收准则/契约点 | 状态 |
|---|---|---|---|---|---|
| B1 ok 路径:outcome 'ok' + 深冻结 + query 规范化 echo(trim) | T12 | literature-search.spec「ok path」 | `outcome==='ok'`;hits/ref/query 写抛错;`query.topic` 回显 trim 后值 | index.ts normalizeQuery:99-155 + NO TRUTH CLAIM | **已覆盖** |
| B2 maxResults 封顶 + truncated 语义 | T12 | 同 spec「keeps hits…」「maxResults larger…」 | maxResults 5→5 hits + truncated true;maxResults 100→14 hits(全量)+ truncated false | adapter 契约(total 为 cap 前计数,index.ts:211) | **已覆盖** |
| B3 adapter 恰好调用一次 | T12 | 同 spec「calls the injected adapter exactly once」 | countingAdapter `calls===1`(无 retry、无 fallback adapter) | index.ts:279-280(EXACTLY ONCE) | **已覆盖** |
| B4 venueTierFilter 过滤 + 可与 cap 组合 | T12 | 同 spec「venueTierFilter + truncation」 | tier1 过滤仅命中 Synthetic Journal A/Conference A 5 篇;`tier1+maxResults 2`→2 hits truncated true | index.ts VALID_VENUE_TIERS + mock tier 过滤 | **已覆盖** |
| B5 topic 空/纯空白 → EMPTY_TOPIC | T12 | 同 spec「rejects empty and whitespace-only topics」 | code==`DSH_LITERATURE_SEARCH_EMPTY_TOPIC` | index.ts:113-119(trim 后非空) | **已覆盖** |
| B6 topic 缺失/非字符串/query 非对象 → INVALID_QUERY | T12 | 同 spec「rejects a missing / non-string topic」 | 42 与 null 均报 `INVALID_QUERY` | index.ts:100-112(never coerced) | **已覆盖** |
| B7 maxResults<1/非整数/NaN → INVALID_MAX_RESULTS;边界 1 接受 | T12 | 同 spec「rejects maxResults < 1」「accepts maxResults = 1」 | [0,-1,1.5,NaN] 均报错;maxResults 1 → 1 hit | index.ts:121-132(安全整数≥1) | **已覆盖** |
| B8 venueTierFilter 未知值 → INVALID_VENUE_TIER_FILTER | T12 | 同 spec「rejects an unknown venueTierFilter」 | 'tier9' 报错 | index.ts:134-144 | **已覆盖** |
| B9 adapter 缺失/无 search fn → MISSING_ADAPTER | T12 | 同 spec「rejects a missing / malformed adapter」 | null 与 {} 均报错 | index.ts:157-168 | **已覆盖** |
| B10 timestamp 非有限 → INVALID_TIMESTAMP | T12 | 同 spec「rejects a non-finite timestamp」 | NaN 报错 | index.ts:170-177 | **已覆盖** |
| B11 播种 unavailable → outcome 'unavailable',hits []/truncated false,**绝不为空 ok** | T12 | 同 spec「a seeded-unavailable adapter…」 | `outcome==='unavailable'` + hits==[] + truncated false;非 'ok' | **NO DEFAULT PASS**(index.ts:226-240,adapter.ts:14-20) | **已覆盖** |
| B12 真无匹配 → ok + 零 hits,与 unavailable 判别 | T12 | 同 spec「a genuine no-match is outcome ok」 | 'no-such-token-xyzzy' → ok + 0 hits | adapter.ts:19('ok' 可空 hits)+ 工具不吞不可用 | **已覆盖** |
| B13 adapter 抛异常原样上抛(不吞、不映射 unavailable) | T12 | 同 spec「an adapter that throws is surfaced」 | toThrow('adapter exploded'),非 INVALID_ADAPTER_OUTPUT | index.ts:260-262(异常 surface 非 remap) | **已覆盖** |
| B14 adapter 结构非法(未知 status)→ INVALID_ADAPTER_OUTPUT | T12 | 同 spec「structurally-invalid adapter output」 | status 'maybe' → 报 `INVALID_ADAPTER_OUTPUT` | index.ts:242-244(adapter fault ≠ literature judgment) | **已覆盖** |
| B15 'ok' 子结构违约分支:hits 缺失 / total 非非负整数 / hits>total / hits>maxResults → INVALID_ADAPTER_OUTPUT | T12 | — | 无工具层直测(capping-contract 违约只在代码 195-209 存在) | index.ts:195-209(adapter capping 契约) | **缺口** → G1 |
| B16 mock fixture 契约直测:token OR 语义 / haystack=title+venue+refId / 每次全新 hit(无别名)/ 实例级冻结克隆隔离 / 稳定 syn-lit-NNNN id | T12 | —(仅经工具间接覆盖 'synthetic' 全命中 14 条与 'no-such-token' 0 命中) | 无直接断言上述 fixture 语义 | adapter.ts:99-107 + mock.ts:1-22 头注释(合成性/确定性/隔离) | **缺口** → G2 |

### 2.3 C 组 — T13 citation-verify(6 its 全绿,基线 `528135c`)

| 测试项 | 覆盖工具 | 所在测试文件 | 关键断言(简述) | 对应验收准则/契约点 | 状态 |
|---|---|---|---|---|---|
| C1 薄委托主路径:resolved + 原文已访问 + claimed supported → supported,provenance 透传,产物深冻结+meta | T13 | citation-verify-tool.spec.ts「resolved + original accessed…」 | conclusion==supported;redLine false;reasonCode==`DSH_CITATION_SUPPORTED`;resolverStatus=='resolved';evidence.sourceUri 存活;artifact/meta/result/evidence 全 frozen | T13 index.ts:98-116 + T08 happy path + contracts.ts VerificationResult | **已覆盖** |
| C2 **#6 红线经工具在 resolver 接触前短路**(零调用判别器) | T13 | 同 spec「#6 red line short-circuits BEFORE resolver contact」 | 接触即抛错的 resolver spy + `not.toHaveBeenCalled()`;conclusion==blocked;reasonCode==`DSH_CITATION_RED_LINE_NO_ORIGINAL`;`resolverStatus===undefined` | 工具层可达 T08 首个分支(index.ts:85-108)+ **Q1 F1 判别器同款**(zero-call) | **已覆盖** |
| C3 resolver 确证虚构(not_found)→ blocked + NOT_FOUND,**绝不 unverified** | T13 | 同 spec「fabricated literature…never unverified」 | conclusion==blocked + redLine true + reasonCode==`DSH_CITATION_NOT_FOUND` + resolverStatus=='not_found';显式 `conclusion not.toBe('unverified')` | contracts.ts:196-199('blocked' 双语义)+ verify.ts 分支 #1 | **已覆盖** |
| C4 resolver 不可用 → unverified 无 red line,非 blocked、非 NOT_FOUND | T13 | 同 spec「resolver availability…unverified」 | conclusion==unverified;redLine false;reasonCode==`DSH_CITATION_TEMPORARILY_UNAVAILABLE`;非 blocked、reasonCode 非 NOT_FOUND | contracts.ts:200-204(unverified ≠ 虚构)+ verify.ts 分支 #1 | **已覆盖** |
| C5 空 claimId/citationId → ResearchError `DSH_CITATION_INVALID_REF`(工具层 fail-fast 与 core 同码,可审计一致) | T13 | 同 spec「empty branded ids throw…」 | '' 的 claimId/citationId 均 toThrow(ResearchError)+ /DSH_CITATION_INVALID_REF/ | T13 index.ts:67-71 + core assertNonEmptyBrand 同码设计 | **已覆盖** |
| C6 core 运行时错误透明传播(工具不重包装/不重解释) | T13 | 同 spec「core runtime errors propagate unwrapped」 | 非 cloneable evidence(函数属性)→ toThrow(`DSH_CITATION_VALUE_NOT_CLONEABLE`) | T13 index.ts:13-14(error transparency)+ core cloneValue | **已覆盖** |
| C7 委托单次调用形态与实参顺序锁(导入即复用,非复制) | T13 | — | 无 vi.mock core 模块断言调用次数/参数序 | shared.ts rule5(复用非复制)+ index.ts:99-107(实参顺序) | **缺口** → G3 |
| C8 省略 timestamp 时 `?? Date.now()` 兜底分支;`meta.producedAt===result.timestamp` | T13 | —(全部用例显式传 TS) | 无直测 | T13 index.ts:96(clock fallback 仅省略时) | **缺口(小)** → G4 |
| C9 resolver triage 剩余分支经工具 parity:ambiguous → unverified/AMBIGUOUS;adapter 抛非 ResearchError → core 包装 `DSH_CITATION_RESOLVER_FAILED` | T13 | —(core verify.spec 已覆盖语义;工具层仅 6 条委托链) | 无直测 | contracts.ts resolverStatus 判别联合(4 态) + verify.ts:372-398 | **部分/低优** → G5 |

### 2.4 D 组 — T14 claim-construct(11 its 全绿,基线 `d33e424`)

| 测试项 | 覆盖工具 | 所在测试文件 | 关键断言(简述) | 对应验收准则/契约点 | 状态 |
|---|---|---|---|---|---|
| D1 构造 claim:branded claimId(`claim-` 前缀)、assertion 保真、`supportStatus==='not_claimed'`、constructedAt==now、meta | T14 | claim-construct.spec.ts「constructs a claim…」 | claimId 非空字符串且 /^claim-/;assertion 原样;supportStatus 冻结 'not_claimed';meta.toolId/version 正确 | T14 index.ts:169-176(构造范围 A2,永不声明支持)+ CLAIM_SUPPORT_STATUS_NOT_CLAIMED | **已覆盖** |
| D2 **所有**构造路径 supportStatus 恒为 'not_claimed'(falsifiability/note/手动 id 变体) | T14 | 同 spec「constructs a claim…variants」 | 3 变体全部 supportStatus=='not_claimed' | T14 index.ts:5-8(唯一可赋值字面量) | **已覆盖** |
| D3 深冻结 + 无活引用(构造后改调用方 scaffold inert) | T14 | 同 spec「deep-freezes…」「treats falsifiability…」 | 各级 Object.isFrozen + 写抛错;事后改 scaffold 不影响 artifact | shared rule3 + freezeArtifact | **已覆盖** |
| D4 确定性:同输入两次 → 全等 artifact | T14 | 同 spec「is deterministic…」 | `second` toEqual `first`(claimId/claim/meta) | T14 index.ts:148-151(纯构造) | **已覆盖** |
| D5 claimId 由 trimmed assertion 稳定派生:falsifiability/note/首尾空白不扰动;不同 assertion 不同 id | T14 | 同 spec「derives a stable claimId from the assertion alone」 | withFalsifiability/withNote/`  ${A}\n` 均同 derived;不同 assertion 不同 id | T14 resolveClaimId:134-143(slug+FNV-1a hash) | **已覆盖** |
| D6 caller-supplied claimId 采用 + trim,且与派生 id 不同 | T14 | 同 spec「honors a caller-supplied claimId」 | 'caller-provided-id' 与 '  padded…  ' 均采用;非 derived | resolveClaimId:135-141 | **已覆盖** |
| D7 空/纯空白 assertion → 抛错 | T14 | 同 spec「rejects empty or whitespace-only assertions」 | '' 与 '   \n\t  ' 均 toThrow | T14 index.ts:156-159 | **已覆盖** |
| D8 cap 2000:2001 抛错、2000 接受 | T14 | 同 spec「rejects over-long assertions at the sane cap」 | 2001 字符 toThrow;2000 字符原样接受 | MAX_CLAIM_ASSERTION_LENGTH=2000(index.ts:28) | **已覆盖** |
| D9 falsifiability 可选语义:absent/null→null;partial 保字段;readonly | T14 | 同 spec「treats falsifiability as optional…」 | 缺省/null→null;单字段 partial 仅含该字段;三字段完整相等 | ClaimFalsifiability 全 optional(index.ts:37-46) | **已覆盖** |
| D10 note 仅在提供时记录;null→undefined | T14 | 同 spec「records note only when provided」 | 缺省/null → undefined;提供 → 原样 | index.ts:166 + 可选键 exactOptionalPropertyTypes | **已覆盖** |
| D11 `runClaimConstruct===constructClaim` 别名 | T14 | 同 spec「exposes runClaimConstruct as an alias」 | 同一函数实例;产物仍 not_claimed + frozen | index.ts:190(step 入口命名) | **已覆盖** |
| D12 caller claimId 纯空白 → 抛错(非空-after-trim 守卫) | T14 | —(现有测试仅覆盖非空 id 的 trim) | 无直测 | resolveClaimId:136-139(trim 后空即 throw) | **缺口(小)** → G6 |
| D13 slugify 回退/规范化分支:纯 CJK 等无 ASCII slug → 'claim' 前缀;重音字符 NFKD 去音 | T14 | — | 无直测 | index.ts:100-107(slug==='' ? 'claim' : slug) | **缺口(小)** → G7 |
| D14 缺失/非字符串 assertion → 现抛裸 TypeError(无 `[claim-construct]` 前缀),健壮性未测 | T14 | — | 无直测 | index.ts:153-156 仅防 input 非对象;assertion 类型不守卫 | **缺口(低/健壮性观测)** → G8 |

### 2.5 E 组 — 集成入口(tests/entry/public-surface.spec.ts,7 its 全绿,基线 `ebed4cf`)

| 测试项 | 覆盖工具 | 所在测试文件 | 关键断言(简述) | 对应验收准则/契约点 | 状态 |
|---|---|---|---|---|---|
| E1 入口再导出共享约定面(freezeArtifact) | 公共 | public-surface.spec.ts「re-exports the shared convention surface」 | typeof freezeArtifact==='function';冻结嵌套对象 | index.ts:21-22 | **已覆盖** |
| E2 T12 入口稳定身份:toolId/version 前缀/error prefix/run fn/error class/mock adapter 可达 + **函数同一实例** | T12 | 同 spec「exposes the T12…」 | id=='literature-search';version /^0\.1\./;prefix=='DSH_LITERATURE_SEARCH_';`runLiteratureSearch===toolLocalRunLiteratureSearch` | index.ts:27(export *)防重导出断线/名字碰撞/陈旧常量 | **已覆盖** |
| E3 T13 入口身份 + 同一实例 | T13 | 同 spec「exposes the T13…」 | id=='citation-verify';version=='0.1.0';`verifyCitationTool===toolLocal` | index.ts:33 | **已覆盖** |
| E4 T14 入口身份/常量 + 同一实例(含别名) | T14 | 同 spec「exposes the T14…」 | id=='claim-construct';version=='1.0.0';MAX==2000;SUPPORT=='not_claimed';`constructClaim===toolLocal`;`runClaimConstruct===constructClaim` | index.ts:38 | **已覆盖** |
| E5 三 tool id 互异(registry-key 安全) | 公共 | 同 spec「keeps the three tool ids mutually distinct」 | `new Set(ids).size===3` | index.ts:39(三工具唯一性;未来 T19 registry 键面) | **已覆盖** |
| E6 端到端经入口产出冻结自描述 artifact(T14 与 T12 两例) | T14/T12 | 同 spec「produces a frozen, self-attributed artifact…」 | artifact/meta/claim frozen;meta.toolId/producedAt 正确;T14 supportStatus not_claimed;T12 outcome ∈ {ok,unavailable} 且 hits≤maxResults 各 hit frozen | 集成提交目标(防单工具 spec 无法捕获的聚合断线) | **已覆盖** |
| E7 T13 经入口端到端执行(verifyCitationTool 经 index 实际调用)未被入口 spec 覆盖 | T13 | —(E3 仅锁身份/类型,无运行调用) | 无直测 | 聚合完整性的对称缺口(E6 覆盖 T14/T12 而漏 T13) | **缺口(小)** → G9 |

**矩阵合计:52 行**(A1-A6 计 6 + B1-B16 计 16 + C1-C9 计 9 + D1-D14 计 14 + E1-E7 计 7)。状态分布:**「已覆盖」41 行、部分 3 行(A4/A6/C9)、缺口 8 行(B15/B16/C7/C8/D12/D13/D14/E7)**。注:行数按「准则/契约点」粒度统计,与测试文件 it 数(19+6+11+7=43)不同源——一条准则可被多个 it 交叉覆盖,一条 it 亦可覆盖多条准则。

---

## 3. 集成层覆盖(entry spec 锁了什么、没锁什么)

**已锁定(tests/entry/public-surface.spec.ts):**
- 聚合断线防护:每个稳定 id/version/函数/常量/错误类/mock 适配器经包入口可达(E2-E4);重导出为**同一函数实例**(identity,无影子副本)。
- registry-key 安全:三 tool id 互异(E5);`ToolArtifactMeta` 自描述字段(toolId/version/producedAt)在入口级可用。
- 端到端冻结自描述 artifact 至少经入口跑通 T14 与 T12(E6);shared 面 freezeArtifact 入口可达(E1)。
- 集成所有权:index.ts 由主 Agent 持有,工具 Agent 不编辑;单文件聚合随集成提交 `ebed4cf` 落盘。

**未锁定(刻意或缺口):**
1. **按包名运行时消费未测**(非缺口):spec 头注释明确 —— 测试以 repo 相对 `.ts` 后缀导入入口;`'@deepseek-ai/dsh-research-tools'` 名称消费待 gitignored `lib/` 构建存在后(exports map 已把 `.` 路由到 lib)。这是记录在案的延迟,非覆盖缺口。
2. **无 T19 registry,刻意不引入**(非缺口):index.ts:11-13 明确「本波不引入 registry,artifact 已经 meta 自描述,registry 形状属 T19 前契约设计」。任何「按名注册/查找工具」的断言属 T19 范围,本矩阵不列为缺口。
3. **T13 未在入口级执行**(缺口 G9):E3 只锁 verifyCitationTool 的身份与类型;入口聚合若有影响 T13 运行时路径的接线问题,现有测试无法捕获(与 E6 覆盖 T14/T12 不对称)。
4. **版本锁强度不一致**(低优观测):LITERATURE_SEARCH_TOOL_VERSION 仅 `/^0\.1\./` 松散前缀校验(与包版本 lockstep),而 CITATION_VERIFY='0.1.0'、CLAIM_CONSTRUCT='1.0.0' 字面锁死——版本 bump 时 entry spec 需人工同步;非功能缺口。
5. **依赖解析形态**(注记):工具源码与 spec 经包名 `@deepseek-ai/dsh-research-core` 导入 core;根 vitest.config.ts 注释声明 tsconfig paths 别名**优先于 package exports**,以避免 built lib 加载第二份模块单例——即工具测试实际跑 core **src** 而非 lib(若别名生效)。此属仓库既有机制,本矩阵未重验;若某环境别名失效则回落到 built lib,存在陈旧风险,建议 CI 覆盖通道一并确认。
6. **cordis(I1)不在本矩阵**:`dsh-research-cordis`(18 tests,含 delegation.spec.ts)是批次1薄委托层,非 P2 wave-1 三工具;仅作为 T13「薄委托 + 冻结结果 + 零重解释」模式的先例参照(batch2-t19 设计 §5 不变量 4 要求其 delegation.spec.ts:190-209 原样成立)。

---

## 4. 缺口清单(无直接测试覆盖,各附具体建议测试)

> 除 G8 为健壮性观测外,其余均为「该准则/分支今日零直测」的诚实清单;均为低-中优先、可后置,不构成集成阻断。

| # | 级别 | 缺口 | 具体建议测试(file + scenario) |
|---|---|---|---|
| G1 | 中 | T12 `buildArtifact` 的 'ok' **子结构违约分支**零直测:missing hits 数组 / total 非非负整数 / `hits.length>total` / `hits.length>query.maxResults`(capping 契约违约),仅代码 195-209 存在。若仓库 per-file 100% 覆盖门禁(include `packages/*/*/src/**`)在本包生效,这些分支会在覆盖通道暴露。 | 在 literature-search.spec.ts「structurally-invalid adapter output」describe 追加:手写 adapter 返回 `{status:'ok', total:0}`(缺 hits)、`{status:'ok',hits:[x],total:-1}`、`{status:'ok',hits:[a,b],total:1}`、`{status:'ok',hits:[a,a,a],total:3}` + maxResults:2 → 均 `errorCodeOf===DSH_LITERATURE_SEARCH_INVALID_ADAPTER_OUTPUT`。 |
| G2 | 中 | T12 mock **fixture 契约无直测**(B16):token OR 语义、venue/refId 亦入 haystack、每次返回全新 hit(无别名)、实例级冻结克隆隔离、稳定 syn-lit-NNNN id。现仅经工具间接覆盖 'synthetic'(全命中 14)与 no-match。 | 新增 tests/literature-search/mock.spec.ts(或并入工具 spec):(a) `topic:'attention memory'` → ≥2 命中(OR);(b) `topic:'Journal A'`(venue 命中)与 `topic:'2499.00001'`(refId 命中)各 ≥1;(c) 同 query 两次 search,改第一次返回的 `hits[0].title` 不影响第二次结果(fresh object);(d) 普通实例与 `{unavailable:true}` 实例各自独立(seed 不泄漏跨实例);(e) 命中 id 形如 `syn-lit-####` 且与 corpus 行序稳定对应。 |
| G3 | 中 | T13 **薄委托结构锁缺失**(C7):行为等价测试无法区分「委托 core」与「在工具里复制了一份 core 逻辑」——P2 rule5(复用非复制)无运行时断言。 | citation-verify-tool.spec.ts 顶部 `vi.mock('@deepseek-ai/dsh-research-core', ...)`:以 spy 替换 `verifyCitation`,断言经工具调用**恰 1 次**、实参顺序为 `(claimId, citationId, ref, evidence, resolver, timestamp, options)`(与 index.ts:99-107 同序)、返回被 freezeArtifact 包装后原样置于 `artifact.result`。该测试同时锁 C7 与 A6。 |
| G4 | 低 | T13 **timestamp 兜底分支零直测**(C8):全部用例显式传 TS,`input.timestamp ?? Date.now()` 分支(index.ts:96)裸奔;亦未断言 `meta.producedAt===result.timestamp`。 | 追加:传 input(省略 timestamp)→ `meta.producedAt` 与 `result.timestamp` 均为数字且彼此相等、接近调用时刻(|now-Δ|<5000ms);显式传 TS 时兜底被覆盖(已隐含于 C1,但可加显式 `result.timestamp===TS` 断言)。 |
| G5 | 低 | T13 **triage 剩余分支工具层 parity 缺**(C9):ambiguous → unverified/`DSH_CITATION_AMBIGUOUS`、adapter 抛非 ResearchError → core 包 `DSH_CITATION_RESOLVER_FAILED`,这两条经工具路径无直测(语义已被 core verify.spec 覆盖)。 | 追加两例:resolver 返回 `{status:'ambiguous'}` → conclusion unverified、resolverStatus=='ambiguous';resolver 抛 `new Error('boom')` → toThrow(/DSH_CITATION_RESOLVER_FAILED/)(错误透明,非重包装)。 |
| G6 | 低 | T14 **空白 claimId 守卫分支零直测**(D12):`resolveClaimId` 的 `trim().length===0` 抛错(index.ts:136-139)只在 caller 提供空串时触发,现有测试只测非空 trim。 | claim-construct.spec.ts「honors a caller-supplied claimId」内追加:`constructClaim(baseInput({claimId:'   '}))` → toThrow(/non-empty/)。 |
| G7 | 低 | T14 **slugify 回退/去音分支零直测**(D13):纯 CJK(无 ASCII slug)→ `'claim'` 前缀(index.ts:106);重音字符 NFKD 去音路径(index.ts:101)未测。 | 追加:(a) assertion '纯中文的主张语句' → claimId 匹配 `/^claim-claim-/`(slug 回退)且确定性;(b) 另一纯 CJK 断言 → claimId 不同(hash 区分);(c) assertion 'café lattices' → 去音后含 'cafe'。 |
| G8 | 低(健壮性观测) | T14 **非字符串/缺失 assertion** 现抛裸 TypeError(无 `[claim-construct]` 前缀,index.ts:156 直接 `.trim()`);与 T12/T13 的带前缀错误风格不一致,且无测试记录该行为。若属范围外可只记录,否则建议加类型守卫。 | 视主 Agent 裁定:若修,在 constructClaim 入口加非字符串守卫并抛带前缀 Error,再补 `assertion:42` 与缺省字段两例;若不改,补一条测试固化当前 TypeError 行为以防无意变更。 |
| G9 | 低 | **T13 未在入口级执行**(E7):E3 仅锁身份,入口聚合的 T13 运行时接线与 E6(T14/T12)不对称。 | public-surface.spec.ts 追加:经入口 `verifyCitationTool` 以 fixture resolver 跑一例 supported → artifact frozen、`meta.toolId==='citation-verify'`、`result.conclusion` 由 core 语义产出(入口级端到端闭环补齐)。 |

**刻意不列为缺口(范围外声明):** T19 状态机接线/registry/`GATE_OUTCOME_TO_INTENT` 消费方断言——属 T19 前契约与 I1 验收面,本矩阵不越界。静态类不变量(纯函数无 IO、无真实 key、synthetic-only、模块隔离)遵循 Q1 F4 先例移交 C1 审计与仓库门禁,而非伪造脆性单测。

---

## 5. 结论

Wave-1 三工具 + 集成入口的测试覆盖(43 its:19+6+11+7,全量 276 回归全绿)对 P2 波 1 验收准则的覆盖度**足够支撑集成**,理由:(1) 工具特有 trust-boundary 不变量——T12 NO DEFAULT PASS('unavailable'≠空 'ok')、adapter 恰好一次、adapter 抛错原样上抛、结构违约报错,T13 #6 红线经工具**零调用短路**(复用 Q1 F1 判别器)、虚构≠unverified、不可用≠blocked、空 id fail-fast、core 错误透明,T14 `supportStatus` 恒 'not_claimed'、cap 2000、确定性 claimId、深冻结无活引用——全部已有直接断言;(2) 跨工具 P2 规则(冻结 artifact + ToolArtifactMeta、时钟注入、状态机不接线)在可测面已覆盖,不可测的纯静态面(无 IO/无真实 key/合成数据)按 Q1 F4 先例移交审计,非测试缺陷;(3) 入口 spec 锁定聚合完整性与函数身份,防单工具 spec 盲区。剩余 9 项缺口均为低-中优先、附具体建议测试,无一定睛即危险(P0/P1 级)的语义空洞;若在合并前补 G1(buildArtifact 子结构分支 + 覆盖门禁风险)与 G3(T13 委托结构锁)收益最高。整体判定:**通过(条件性)**——准予进入 T19 汇合点集成,附带上述低优先缺口清单作为后续补测债,不改变任何仓库文件。

---

**仓库零改动确认:** 本次分析仅执行只读操作(Read/Grep/ls),未修改、创建或删除 `deepseek-harness-master1` 内任何文件;唯一写入为本交付物 `D:\1\plan\batch2-q2-tools-test-matrix.md`(位于仓库外)。分析中 Bash 输出通道一度退化(命令 exit 0 但无 stdout),故回归绿态以 team-lead 提供的 276/276 基线为准,未在本次会话内重跑 vitest。
