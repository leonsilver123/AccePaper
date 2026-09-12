# 02 需求可追溯性矩阵（R1..Rn）

> 产出方：A1 文档与需求 Agent（只读分析）
> 表头：requirement_id | 来源 | 类型 | 状态 | 冲突 | 依赖 | 验证方式
> 类型枚举：用户决策 / 文档事实 / 源码已验证 / 外部已验证 / 待验证假设 / 不可操作化愿景 / 文档内部冲突 / 合理工程推断 / 明确排除项
> 状态枚举：已确认 / 已验证 / 待验证 / 已降级 / 待裁决 / 待核验 / 待外部

---

| requirement_id | 来源 | 类型 | 状态 | 冲突 | 依赖 | 验证方式 |
|---|---|---|---|---|---|---|
| R1 | v1.1 §0 D1 | 用户决策 | 已确认 | C4 | R4 R5 | 双领域 L0 配置数据源获取（J5 待确认） |
| R2 | v1.1 §0 D2 | 用户决策 | 已确认 | — | R20 | code-runtime 本地 worker-thread 可用（S15 已验证） |
| R3 | v1.1 §0 D3 | 用户决策 | 已确认 | C1 | R6 R7 | 16 步状态机全流程跑通（recon S13 已旁证；P5 端到端） |
| R4 | v1.1 §0 D4 | 用户决策 | 已确认 | — | R16 R17 | matplotlib 输出 SVG+PNG 无 PDF（§6.1 落地后验） |
| R5 | v1.1 §0 D5 | 用户决策 | 已确认 | — | R18 | Visio ai skill 复用项目（J4 待搜索）或 fallback vsdx 库 |
| R6 | v1.1 §0 D6 | 用户决策 | 已确认 | — | R19 | 端口 1120 改 webStartup（S5 已验证可改）；1121 Config 默认值 |
| R7 | v1.1 §0 D7 | 用户决策 | 已确认 | — | — | 无鉴权/多租户/并发架构（落地后验最简） |
| R8 | v1.1 §0 D8 | 用户决策 | 已确认 | C3 | R20 R21 | provider deepseek-official（S2 已验证）；模型 v4-flash/pro（S3 已验证）；网关连通（J6 待实测） |
| R9 | v1.1 §0 D9 | 用户决策 | 待核验 | — | R22 R23 | Web Slots 嵌入 apps/web；conversation.side.panel slot（J1 未核验，需改真实 slot） |
| R10 | v1.1 §9 D10 | 用户决策 | 已确认 | — | — | loop 默认不改；动则 Agent Note + 更新 architecture.md |
| R11 | v1.1 §1 D11 | 用户决策 | 已确认 | C6 | R12-R16 | 5 插件包 cordis.yml 名册注册（S11 inspector 骨架已验证） |
| R12 | v1.0 §3 F1 | 文档事实 | 待验证 | — | R13 R14 R15 | 五层 L0-L4 架构落地后 P1-P6 验证 |
| R13 | v1.0 §4 F2 | 文档事实 | 待验证 | C3 C2 | R20 | 三件套 A/B/C 机制；A 降级（A3/A4）；B 外部锚（A2）；C 可证伪 |
| R14 | v1.0 §5 F3 | 文档事实 | 待验证 | C1 C2 | R3 | 16 步 5 阶段；每步 gate（recon S13 已旁证 gate 分配） |
| R15 | v1.0 §6 F4 | 文档事实 | 待验证 | — | R16 R17 R18 | 三类图表子系统（绘图/三线表/路线图）落地后验 |
| R16 | v1.1 §6.1 R4 | 文档事实 | 待验证 | — | R4 R2 | 数据绘图 SVG+PNG，matplotlib+SciencePlots，色盲友好/单位/字号 |
| R17 | v1.1 §6.2 | 文档事实 | 待验证 | — | R2 | 三线表 pandas.to_latex+booktabs，有效数字统一 |
| R18 | v1.1 §6.3 | 文档事实 | 待验证 | — | R5 | 技术路线图 Visio 优先；验证标准"不看正文懂方法主线"（V4 不可操作化，需人裁决） |
| R19 | v1.0 §6.4 F5 | 文档事实 | 待验证 | C4 | R1 R23 | L0 白名单（中科院/CCF/ABS/SCI/FT50/UTD24）+ 黑名单；数据源获取（J5 待确认） |
| R20 | v1.0 §6.5 F6 | 文档事实 | 待验证 | C5 | R19 R23 | 引文核实闸门 100% DOI+白名单；扩展为完整身份链（冲突 5） |
| R21 | v1.0 §10 F7 | 文档事实 | 已降级 | C2 | R8 R13 | 诚实边界：不开创范式（v1.0 §10.1 范围声明）【v1.1 更正：删"数学边界"无证据表述】；仅 2 处人介入——"仅 2 处"降级（A5），需权属矩阵（冲突 2） |
| R22 | v1.1 §7 R9 | 文档事实 | 待核验 | — | R9 R23 | 双面声明 dsh.client（S9 已验证形态，但 ./client exports 不准确 J2）+ clientBundle lazy-CJS（S10 已验证） |
| R23 | v1.1 §7.2 | 文档事实 | 待核验 | — | R9 R22 | Web Slots：conversation.side.panel（J1 未核验）、research.pipeline/figure/table/roadmap/gate/adversarial（需核验 slot 名是否已声明或需新声明） |
| R24 | v1.1 §4 F8 | 文档事实 | 待验证 | C6 | R11 | 5 插件包职责划分；core 过载需拆分（冲突 6） |
| R25 | M3 S1 | 源码已验证 | 已验证 | — | — | DSH v0.1.2-alpha.4 pre-release（package.json） |
| R26 | M3 S2 | 源码已验证 | 已验证 | — | R8 | provider deepseek-official 真实注册（llm-deepseek） |
| R27 | M3 S3 | 源码已验证 | 已验证 | — | R8 | 模型 v4-flash/pro 源码已认知（token-meter） |
| R28 | M3 S4 | 源码已验证 | 已验证 | — | R8 | agents 配置结构与 v1.1 cordis.yml 一致（deepseek-defaults.patch.yml）；v1.1 文档误拼文件名（J3） |
| R29 | M3 S5 | 源码已验证 | 已验证 | — | R6 | web 默认端口 3080 可改（cordis.patch.yml:121） |
| R30 | M3 S6 | 源码已验证 | 已验证 | — | R16 R17 R18 | defineTool 签名（schema.ts:545） |
| R31 | M3 S7 | 源码已验证 | 已验证 | — | R24 | tool-agent-team member-scope 模式（README:99） |
| R32 | M3 S8 | 源码已验证 | 已验证 | — | R23 | ui-slots 四种 kind single/list/keyed/chain（README:28） |
| R33 | M3 S9 | 源码已验证 | 已验证 | — | R22 | dsh.client 嵌套结构 dsh:{client:{inject,platform}}（ui-skill package.json） |
| R34 | M3 S10 | 源码已验证 | 已验证 | — | R22 | clientBundle lazy-CJS 预设（ui-settings-plugins README:96，预设 tsdown.client.ts） |
| R35 | M3 S11 | 源码已验证 | 已验证 | — | R11 | inspector 骨架五件套 + source overlay 模板（inspector/src/index.ts + cordis.source.patch.yml） |
| R36 | M3 S12 | 源码已验证 | 已验证 | — | — | DSH_CLIENT_COMMIT_HASH 逃生口（client-build-environment.ts:26） |
| R37 | M5 S13 | 源码已验证 | 已验证 | C1 C2 C6 | R3 R14 R24 | recon 引擎 16 步 + Trinity gate，humanGate 仅 E2，domain-direction 为 pre-condition（steps.ts/types.ts） |
| R38 | M5 S14 | 源码已验证 | 已验证 | C1 | R3 | StepStatus 含 blocked/failed/gated 可回退（types.ts:51） |
| R39 | M3 S15 | 源码已验证 | 已验证 | — | R2 | code-runtime 本地 worker-thread 可用 / e2b 并存但可不用 |
| R40 | M4 E3 | 外部已验证 | 已验证 | — | — | awesome-dsh-plugin 约 2939 条目（活态列表，用户口径 2937） |
| R41 | v1.1 §0 E1 | 外部已验证 | 待外部 | — | R11 | node v24.18.0 / pnpm 11.21.0 达标（文档自述，未独立重测） |
| R42 | v1.1 §11 E2 | 外部已验证 | 待外部 | — | R11 | pnpm install + build 均 exit 0（文档自述） |
| R43 | v1.0 §1 A1 | 待验证假设 | 已降级 | — | R13 R14 | 稳定产出顶刊——降级，缺基线/Golden Set/稳定阈值 |
| R44 | v1.0 §4 A2 | 待验证假设 | 已降级 | C3 | R13 | 外部信号充要防崩盘——降级为"必要"，"充要"待证 |
| R45 | v1.0 §4 A3 | 待验证假设 | 已降级 | C3 | R13 R26 R27 | 多 agent 投票必提高正确率——删"必"，待 Golden Set 量化 |
| R46 | v1.0 §4 A4 | 待验证假设 | 已降级 | C3 | R8 R26 R27 | v4-flash/pro 异质——同族非真异质，降级为差异化配置+异质 prompt |
| R47 | v1.0 §10 A5 | 待验证假设 | 已降级 | C2 | R21 R37 | 仅 2 处人介入——硬介入=2 成立（S37 旁证），但软介入多步需权属矩阵 |
| R48 | v1.1 §0 A6 | 待验证假设 | 已降级 | C1 | R3 R14 R38 | 16 步直铺优于闭环——澄清直铺=运行时全铺+内置 gate，非无验证 |
| R49 | v1.0 §6.4 A7 | 待验证假设 | 已降级 | C4 C5 | R19 R20 | L0 白名单=真实性——拆为质量层级(L0)+真实性(DOI/原文)，L0 不替代内容核验 |
| R50 | v1.0 §6.5 A8 | 待验证假设 | 已降级 | C5 | R20 | DOI 门禁=引用正确——扩展为完整身份链，DOI 只是链首 |
| R51 | v1.0 §4 A9 | 待验证假设 | 已降级 | C3 C2 | R13 R45 | agent 自评投票成立——同源互投风险，关键判断保留人锚 |
| R52 | v1.0 §11 A10 | 待验证假设 | 已降级 | — | R13 R20 | 干净复现=正确——定位为可复现性闸门(必要非充分)，叠加敌意审稿+人审基线 |
| R53 | v1.0 §1 V1 | 不可操作化愿景 | 待裁决 | — | R43 | "稳定产出顶刊级"——"顶刊级"无客观闸门，待人定义 |
| R54 | v1.0 §5 V2 | 不可操作化愿景 | 待裁决 | — | R14 | "≥1 条非显然延展扛过反驳"——"非显然"无客观定义 |
| R55 | v1.0 §5 V3 | 不可操作化愿景 | 待裁决 | C2 | R14 | "方法章灵魂叙述"——属人直觉不可计算 |
| R56 | v1.0 §6.3 V4 | 不可操作化愿景 | 待裁决 | — | R18 | "不看正文仅凭图懂方法主线"——主观标准需人裁决 |
| R57 | v1.1 §0 X1 | 明确排除项 | 已确认 | — | R2 R39 | 不用 e2b（本地 code-runtime） |
| R58 | v1.1 §0 X2 | 明确排除项 | 已确认 | — | R4 R16 | 绘图不输出 PDF |
| R59 | v1.1 §0 X3 | 明确排除项 | 已确认 | C1 | R3 | 不做垂直切片 MVP |
| R60 | v1.1 §0 X4 | 明确排除项 | 已确认 | — | R7 | 不开鉴权/多租户/并发 |
| R61 | v1.0 §10 X5 | 明确排除项 | 已确认 | — | R43 | 不做范式级开创性工作（v1.0 §10.1 范围声明）【v1.1 更正：删"数学边界"无证据表述】 |
| R62 | v1.1 §9 X6 | 明确排除项 | 已确认 | — | — | 默认不改 loop |
| R63 | v1.1 §0 X7 | 明确排除项 | 已确认 | — | R9 R22 | 不另起前端项目 |
| R64 | v1.1 §3 I1 | 合理工程推断 | 待验证 | — | R6 | 1121 辅助服务独立于 1120 可行 |
| R65 | v1.1 §8.3 I2 | 合理工程推断 | 待验证 | — | R11 R35 | source-overlay 开发期零构建可行 |
| R66 | v1.1 §5.1 I3 | 合理工程推断 | 待验证 | C6 | R24 R37 | recon engine 可移植为 core 纯核心（S37 已旁证） |
| R67 | v1.1 §2 J6 | 待核验 | 待外部 | — | R8 | 第三方网关 ai.ctaigw.cn 连通性 + base_url 路径级别 |
| R68 | v1.1 §6.3 J4 | 待核验 | 待外部 | — | R5 R18 | Visio ai 绘图 skill 复用项目待搜索 |
| R69 | v1.1 §11 J5 | 待核验 | 待外部 | — | R1 R19 | L0 白名单数据源（中科院分区/CCF）获取与许可 |
| R70 | v1.1 §7.1 J2 | 源码已验证 | 已验证 | — | R22 R33 | v1.1 §7.1 引用正确，ui-skill package.json:21-24 实有 ./client exports（types+default）【AUD-01 返工更正：原判误，已纠正】 |
| R71 | v1.1 §7.2 J1 | 待核验 | 待核验 | — | R9 R23 | conversation.side.panel slot 代码库不存在，需改真实 slot |
| R72 | v1.1 §2 J3 | 待核验 | 待核验 | — | R28 | defaults fixture 文件名误拼（deseek→deepseek） |

---

## 冲突-需求映射（冲突影响哪些需求）

| 冲突 ID | 冲突 | 涉及需求 | 裁决建议位置 |
|---|---|---|---|
| C1 | 16 步直铺 vs 增量验证 | R3 R14 R38 R48 R59 | 01_fact_baseline §三 冲突 1 |
| C2 | 人工介入点 | R14 R21 R47 R55 | 01_fact_baseline §三 冲突 2 |
| C3 | 异质模型降级 | R8 R13 R21 R44 R45 R46 R51 | 01_fact_baseline §三 冲突 3 |
| C4 | L0 多体系路由 | R1 R19 R49 | 01_fact_baseline §三 冲突 4 |
| C5 | 引文核验身份 | R20 R50 | 01_fact_baseline §三 冲突 5 |
| C6 | core 职责过载 | R11 R24 R37 R66 | 01_fact_baseline §三 冲突 6 |

---

## 待用户裁决的阻断项（需用户拍板才能推进）

1. **C3 异质模型**：用户限定 DeepSeek 网关（D8）致同族对抗局限。需用户确认是否接受"同族+异质 prompt+外部锚"降级方案，或是否引入跨族外部模型。
2. **C4 L0 多体系路由**：双领域+多文献类型致 L0 不能一刀切分区表。需用户确认各类型路由表是否采纳。
3. **J1 conversation.side.panel slot**：v1.1 文档引用的 slot 代码库不存在。需用户/前端确认改用 `conversation.view` 或 `details` 或新声明子 slot。
4. **R18/V4 技术路线图验收标准**："不看正文懂方法主线"为主观标准。需用户确认是否接受人裁决或定义可操作化替代指标。
5. **J5 L0 数据源获取**：中科院分区表/CCF 目录的获取与许可未确认。阻断 R19/R20 引文闸门落地。
