# 07 独立审计发现（C 独立审计 Agent）

> 产出方：C 独立审计 Agent（未参与 A/B 设计，独立取证、独立评分，不复制 A/B 报告）
> 日期：2026-09-02
> 职责边界：只读核验 DSH 源码 + 两份设计文档 + plan/00..06 全部产物；不修改任何 DSH 源码或设计文档；仅 Write 本 plan 文件。
> 审计范围：plan/00_source_manifest、01_fact_baseline、02_requirement_traceability、03_dsh_evidence、04_reuse_candidates、05_execution_wbs、06_test_acceptance 全文 + v1.0/v1.1 两份设计文档全文。
> 独立性声明：本文取证结论由 C 独立对 DSH 源码逐项核验得出，凡与 A/B 结论相同处为独立复核一致，非照抄。
> 结论格式：结论｜类型｜证据位置｜影响｜建议动作

---

## 〇、独立取证复核表（C 直读源码逐项核验，非引用 A/B）

| 核验项 | A/B 主张 | C 独立核验结论 | 证据位置（C 自取） |
|---|---|---|---|
| DSH 版本 0.1.2-alpha.4 | A1 S1 | ✅ 一致确认 | `package.json:3` `"version": "0.1.2-alpha.4"` |
| provider deepseek-official | A1 S2/R26 | ✅ 一致确认 | `packages/llm/llm-deepseek/lib/index.js:1825` `const PROVIDER = "deepseek-official"` |
| 模型 v4-flash/pro 仅测试认知 | A2 §1.17 | ✅ 一致确认 | `packages/llm/token-meter/tests/token-meter.spec.ts:215,372`（src/ 无硬编码模型名表） |
| defaults 文件名 = deepseek-（非 deseek-） | A1 J3/R72 | ✅ 一致确认 | `apps/cli/tests/profiles/headless/tests/fixtures/deepseek-defaults.patch.yml` 实存 |
| web 默认端口 3080 可改 | A1 S5/R29 | ✅ 一致确认 | `packages/bundle/web-app/cordis.patch.yml:121` `port: !!js ctx.webStartup.port ?? 3080` |
| **state-machine.ts 不存在** | B1 F-W1 | ✅ 一致确认（关键） | `research-prototype/src/engine/` 仅含 `steps.ts`+`types.ts`，无 state-machine.ts；`steps.ts:12` 注释引用 `(state-machine.ts)` 但文件缺失；`research-prototype/package.json` 有 `"test":"vitest run"` 但无任何 .test.ts/.spec.ts 文件 |
| 16 步 + Trinity gate + humanGate 仅 E2 | A1 S13/R37 | ✅ 一致确认 | `steps.ts` 16 条 StepDefinition（A1-A4/B1-B3/C1-C3/D1-D4/E1-E2）；C2-trinity-loop `gate:['A','B','C']`；E2-submit `gate:[]`,`humanGate:true`，其余全 `humanGate:false`；`types.ts:51` `StepStatus='pending'|'in_progress'|'gated'|'passed'|'blocked'|'failed'` |
| domain-direction 为 pre-condition 非 step | A1 S13 | ✅ 一致确认 | `steps.ts:14` 注释 `domain-direction (human T0 方向授权) is a pre-condition input to A1, not a step` |
| **conversation.side.panel slot 不存在** | A1 J1/R71 | ✅ 一致确认 | grep `conversation.side` 在 `packages/client/` 全仓零命中；真实 conversation slot 经 C 核验为：`conversation.view`(ui-chat/apply.ts:94)、`conversation.chat.node`(ui-chat/apply.ts:102)、`conversation.message.images`(ui-attachment/index.ts:19)、`conversation.composer.dock`(ui-chat/apply.ts:155)、`conversation.approval.detail`(ui-approval/slots.ts:37)、`conversation.composer`(ui-approval/index.ts:80)、`conversation.details.tool`(ui-chat/apply.ts:166)、`conversation.hero.agentPreset`(ui-agent-preset)、`conversation.session.header.actions`(ui-agent-preset)——A1 列举的 7 个真实 slot 全部核验存在 |
| **ui-sskill package.json 有 ./client exports** | A1 J2/R70 主"不存在" | ❌ **C 发现 A1 事实错误** | `packages/client/ui-skill/package.json:21-24` 实存 `"./client": {"types":"./lib/types/client/index.d.ts","default":"./lib/client.js"}`；v1.1 §7.1 引用正确，A1 误判 |
| webserver 单端口（1121 非必要） | A2 §1.18-1.19/B1 F-W2 | ✅ 一致确认 | `packages/host/webserver/src/index.ts:9 createServer`+单 `listen`；`grep "1120|1121" packages/ scripts/` 仅零命中（排除 logo） |
| DSH_CLIENT_COMMIT_HASH 逃生口 | A2 §1.21/F-W5 | ✅ 一致确认 | `scripts/client-build-environment.ts:30` 先读 env `DSH_CLIENT_COMMIT_HASH` 再 fallback `git rev-parse`；`.dsh-build/client-build-environment.json` 实存 `0000000`+`0.1.2-alpha.4`+220 artifacts+sha256 |
| experimental 私有未发布 | A2 §1.9/§5/F-W3 | ✅ 一致确认 | `packages/README.md:52` `experimental/ | Private prototypes and internal-only plugins`；`:86` `experimental/ is unreleased` |
| pre-release 无兼容承诺 | A2 §1.20/F-W4 | ✅ 一致确认 | `AGENTS.md:5-7` `Pre-release stance: foundation over blast radius... Backends reject old on-disk formats... SESSION_FORMAT_VERSION at 0 with no compatibility promise` |
| vendored 19 条本地修改 | A2 §1.20 | ✅ 一致确认 | `vendor/README.md:29-59` 编号至 19（含 cordis fiber lifecycle、include durable writes、loader v2 detection 等） |
| web 端口 loopback 安全 | — | ✅ C 补充核验 | `packages/bundle/web-app/README.md:12,54` `binding all network interfaces is intentionally not supported`（默认仅本机） |
| ctx.sandbox seam 存在 | A2 §1.12 | ✅ 一致确认 | `docs/capability-seams.md:153` `ctx.sandbox Process-sandbox seam`；但 bwrap/Landlock/Seatbelt 为 Linux/macOS 技术，win32 可用性未明（见 AUD-02） |

**取证统计**：C 独立复核 16 项关键事实，15 项与 A/B 一致确认，1 项发现 A1 事实错误（J2/R70）。

---

## 一、§十八 检查项逐条结论

| §十八 检查项 | C 审计结论 | 依据 |
|---|---|---|
| 1. 两份文档真实冲突是否完整处理 | **基本完整** | C1-C6 六冲突均识别并给裁决建议；但 v1.1 §5.3/§8.1 引用 experimental agent-team 与 F-W3"不依赖 experimental"的冲突未入 A1 正式冲突表 C1-C6（见 AUD-04） |
| 2. 所有技术结论是否有证据状态 | **基本合格，1 处事实错误** | A1 用分类表(A-J)+状态枚举、A2 用状态取值(已确认/需PoC等)，证据状态标注规范；但 J2/R70 标"已核验❌"实为误判（见 AUD-01） |
| 3. 伪精确工期 | **无问题** | 05 WBS 用 P0-P7 阶段+T01-T44 依赖链，无伪精确工期估算（无"X 天完成"/"X 月交付"）；仅文档日期 2026-09-02 |
| 4. 把计划任务写成已完成 | **无问题** | 05 §四质量阶梯明确：①骨架=已完成（recon steps.ts 存在但 state-machine.ts 缺）、②-⑤=未开始；v1.1 §11"build ✅完成"经 A2 §1.21 独立核验构建记录（220 artifacts）佐证，A1 标 E2 为"待外部"非冒充已验 |
| 5. agent 一致性写成事实正确 | **无问题** | A3/A4/A9 三降级：投票"必"→"可能"、异质→同族非真异质、自评投票风险；C3 冲突识别；未把 agent 一致性写成既成事实 |
| 6. 格式质量写成科研质量 | **无问题** | 06 §6 剔除 V1-V4（稳定顶刊/非显然延展/灵魂叙述/懂方法主线）从自动门禁，以代理指标+人裁决替代；区分"降级(可测待冻结)"vs"剔除(不可计算)" |
| 7. 可复现写成科学正确 | **无问题** | A10 降级：复现≠正确，定位"必要非充分"，叠加敌意审稿+人审基线；06 INV-REPRO-2"可复现但操作化错被叠加审稿拦截" |
| 8. 期刊等级写成文献真实性 | **无问题** | A7 降级：L0 白名单=质量层级≠真实性，拆为质量层级(L0)+真实性(DOI/原文核验)；冲突 5 扩展引文身份链 6 类问题+#6 红线 |
| 9. 遗漏失败/回退/人工停止/弃权 | **无遗漏（机制已设，阈值待冻结）** | 失败=StepStatus blocked/failed(types.ts:51)；回退=D4→B1/C1/C2(05 DAG2)+StepStatus 可回退；人工停止=humanGate E2+gate gated 等待；弃权=INV-VOTE-1/INV-PROP-3 弃权阈值（*P 待试点冻结，非编造） |
| 10. 不必要企业 SaaS 复杂度 | **无问题** | v1.1 D7 个人单机无鉴权/多租户/并发；X4 排除；Langfuse 自托管非 SaaS；单端口最简架构；唯一多余复杂度=v1.1 §8.1 名册列 experimental 包（A2/B1 已纠正为自建，见 AUD-04） |
| 11. 第一批任务真正可执行 | **无问题** | 05 §七：T01(build,逃生口已验,无阻断)、T05(移植 recon,骨架已存)、T06(状态机新建,StepDefinition 已定义)、T25(slot 裁决只读核验)、T03/T04(PoC)；T02(网关)待用户提供 key——可执行性判定诚实 |
| 12. 本地代码执行/密钥/端口安全 | **部分合格，1 处安全缺口** | 密钥=.env+CredentialRef 每请求解析(adapter.ts)+v1.1 §2 警告轮换；端口=loopback(0.0.0.0 被拒)；但 code-runtime worker-thread 在 win32 无 OS 级沙箱（见 AUD-02） |
| 13. GitHub 项目真实活跃许可证兼容 | **未完成核验** | A3(04) WebFetch 被 github.com 网络策略阻断，16 外部 OSS+16 DSH 社区插件许可证/活跃度均标"待 web 核验"（见 AUD-03） |
| 14. 是否把 16 骨架误写成全部能力成熟 | **无问题（此项处理为范例级）** | 05 §四五级质量阶梯明确区分骨架覆盖/单步可运行/跨步闭环/科研有效性/生产级；显式声明"不得把 16 空壳 agent 当 16 步完成"+"骨架覆盖≠跨步闭环可运行"；F-W1 明确 state-machine.ts 不存在致②③须新建 |

**§十八 总评**：14 项中 12 项无问题，2 项有发现（第 2 项 J2 事实错误、第 12 项 win32 沙箱缺口），1 项未完成（第 13 项 GitHub 许可证待 web 核验），1 项基本完整有微缺口（第 1 项 experimental 冲突未入正式表）。

---

## 二、§十五 问题表

> 表头：issue_id | requirement_id | severity | 证据 | 复现步骤 | 预期 | 实际 | 根因 | 责任Agent | 整改内容 | 影响范围 | 回归测试 | 复验人

| issue_id | requirement_id | severity | 证据 | 复现步骤 | 预期 | 实际 | 根因 | 责任Agent | 整改内容 | 影响范围 | 回归测试 | 复验人 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| AUD-01 | R70/R22/R33（J2） | **P1** | `packages/client/ui-skill/package.json:21-24` 实存 `"./client":{"types":"./lib/types/client/index.d.ts","default":"./lib/client.js"}`；A1 `01_fact_baseline.md:127`、`00_source_manifest.md:31`、`02_requirement_traceability.md:R70` 均称"无 ./client exports" | 读 `packages/client/ui-skill/package.json` 的 `exports` 字段 | v1.1 §7.1 引用 ui-skill 作双面包模板正确（ui-skill 同时有 `dsh.client` 嵌套+`./client` exports） | A1 判定"v1.1 §7.1 对 ./client exports 不准确"、标 J2 为阻断项（A1 blockers 含 J2、B2 BL-5） | A1 核验时漏读 `exports` 块中的 `./client` 行（可能误以为 exports 仅 `./src/*`+`./package.json`），将正确引用误判为不一致 | A1 | 将 J2/R70 改为"✅ v1.1 §7.1 引用正确，ui-skill 实有 `./client` exports(types:./lib/types/client/index.d.ts, default:./lib/client.js)+`dsh.client` 嵌套结构"；从 A1 blockers 列表移除 J2；从 B2 BL-5 移除；00/01/02/05/06 五处同步更正 | R70 状态由"待核验"→"已验证(v1.1 正确)"；B2 G1/G4 双面包测试不再受 BL-5 阻断；blocker 总数 A1 5→4、B2 9→8 | G1 静态检查+dsh.client.external 声明完备性（无需特殊处理，./client 本就存在） | C 独立审计 |
| AUD-02 | R2/R39/R57（code-runtime 安全） | **P2** | A2 `03_dsh_evidence.md` §1.12："worker-thread 共享进程，无 OS 级沙箱，真正 confinement 须配 ctx.sandbox(bwrap/Landlock/Seatbelt)"；`docs/capability-seams.md:153` ctx.sandbox seam 存在；但 bwrap/Landlock=Linux、Seatbelt=macOS，目标平台=win32(Windows 11) | 查 `packages/host/` 沙箱包对 win32 的支持；v1.1 §0 D2"本地 code-runtime"+v1.0 §5 步骤 6/8 执行 AI 生成 Python/实验代码 | 在 win32 上对 AI 生成代码有 OS 级隔离（容器/VM/WSL2+bwrap）或显式风险接受 | 06 T13 A-54 写"code-runtime worker-thread + ctx.sandbox 隔离"未注明 ctx.sandbox 在 win32 不可用；plan 未给出 win32 沙箱替代方案 | plan 引用 ctx.sandbox 时未区分平台可用性；A2 §1.12 提及"Windows 无"但未在 T13 测试/落地决策中跟进 | A2/B1/B2 | 在 05 T16(figure_render)/T17(table)或 P0 决策中增加 win32 沙箱裁决：(a)接受个人单机风险(显式 risk acceptance 记录接受人/理由/失效日期)或(b)用 WSL2+容器执行 AI 代码或(c)仅执行经 L4 人审代码；T13 A-54 注明 ctx.sandbox win32 限制 | 本地代码执行安全链；T13 数据泄漏/隔离测试设计 | C 独立审计 |
| AUD-03 | R40/R68/R69（复用许可证） | **P2** | A3 `04_reuse_candidates.md` §3："github.com 被网络策略阻断(WebFetch 'Unable to verify if domain github.com is safe')，无法直取仓库 commit/Release/issue 精确日期与 LICENSE 全文"；16 外部 OSS+16 DSH 社区插件均标"待 web 核验" | 在当前环境对 github.com 跑 WebFetch 任一仓库 URL | 许可证兼容结论(MIT/Apache2.0)基于 LICENSE 全文+活跃度(commit/release/issue)核验 | 仅 WebSearch 片段确认地址存在，许可证/活跃度为推断非核实；"直接复用"18 项清单的许可证基础未坐实 | WebFetch 网络策略阻断 github.com，非 A3 过失；但 plan 据此给出"许可证兼容"结论时未降级为"待核验假设" | A3 | 在 04 §2 推荐清单每项"许可证"列追加"待 web 核验"状态标记（已有 §3 待核验清单但 §2 结论表未标）；落地 manifest 锁定版本前必须补 web 核验 LICENSE 全文+最近提交+issue 活跃度 | 复用选型安全；若某项实为非 OSI(如 Phoenix ELv2 已排除)或停更须替换 | C 独立审计（需可访问 github.com 环境）；**v1.1 已落实：§十九/04 §1+§2 将未核验项目标"候选"+不进正式依赖（plan 侧整改完成，§1 缺口表 19 行二次核验 C5/C7 补）；web 核验本身仍待可访问 github.com 环境，AUD-03 保持 P2 开放** |
| AUD-04 | R11/R24/R31/R66（experimental 冲突） | **P3** | v1.1 §5.3"复用 agent-team 的持久 mailbox + task DAG"+§8.1 名册列 `@deepseek-ai/dsh-experimental-agent-team`/`dsh-experimental-tool-agent-team`；A2 §5/F-W3/X8"不得直接 import experimental，须自建于 ctx.subagents"；`packages/README.md:52` experimental=Private prototypes | 对照 v1.1 §8.1 名册与 05 §九 X8"不直接 import experimental 包" | v1.1 §8.1 名册应移除 experimental 行，§5.3 应改"借鉴 member-scope 模型，自建于 ctx.subagents" | v1.1 §8.1 仍列 experimental 包；该冲突未入 A1 C1-C6 正式冲突表（仅 A2 §5/B1 F-W3 处理） | A1 冲突识别未覆盖 v1.1 工程陈述与 A2 源码隔离建议的矛盾；A2/B1 处理了实质但 A1 冲突表遗漏 | A1 | 在 01 §三追加冲突 7(C7: v1.1 §5.3/§8.1 experimental 依赖 vs 源码私有不可稳定依赖)；裁决=自建 mailbox/DAG/write-scope 于 ctx.subagents+自有 SessionEventMap；T30 bundle 名册明确移除 experimental 行 | P3 前端 bundle 名册；P3 对抗编排自建边界 | T9 AgentTeam 自建测试（已设，不依赖 experimental） | C 独立审计 |
| AUD-05 | R6/R64（用户决策 D6 覆盖） | **P3** | v1.1 §0 D6"端口 1120/1121 固定"(用户决策，02 R6 标"已确认")；A2 §1.19/B1 F-W2"1121 辅助服务源码架构上不必要，单端口 webserver 已含 SPA+RPC+WS"；`packages/host/webserver/src/index.ts` 单 server+单 listen | 对照 02 R6(已确认)与 05 §八(1121 暂缓) | 用户决策 D6 被 A2 源码证据推翻时显式标注"决策覆盖"并列入待用户裁决(U) | 02 R6 标"已确认"未注 1121 被推翻；05 §八暂缓 1121 但未在 §十待用户裁决列出 | A2/B1 基于证据纠正用户决策，但未在需求追溯层标注决策覆盖状态 | A1/B1 | 02 R6 1121 子项状态追加"(被 F-W2 源码证不必要，改为暂缓/可选，属用户决策覆盖)"；05 §十追加 U8"用户确认接受 1121 暂缓(单端口 1120)或坚持双端口须走独立进程" | 端口架构；T32 启动 | T1 静态检查无硬编码端口 | C 独立审计 |

---

## 三、审计结论

### 总体结论｜类型｜证据位置｜影响｜建议动作

- **结论**：**不通过（条件性），1 项 P1 必须返工**。C 独立复核 16 项关键事实中 15 项与 A/B 一致确认，1 项发现 A1 事实错误（AUD-01: J2/R70 误判 `./client` exports 不存在）。§十八 14 检查项中 12 项无问题。整体计划质量高（证据状态标注规范、质量阶梯防误写骨架为完成、10 主张诚实降级、V1-V4 剔除、冲突 C1-C6 有裁决、无伪精确工期、第一批任务可执行性诚实），但 1 项 P1 事实错误须返工更正后方可放行。
- **类型**：独立审计结论。
- **证据位置**：本文件 §〇 取证复核表 + §一 §十八逐条结论 + §二 §十五问题表。
- **影响**：AUD-01(P1)须返工更正 5 份 plan 文件(00/01/02/05/06)中 J2/R70 的"❌不存在"误判为"✅ v1.1 引用正确"，并从 blocker 列表(A1 blockers+B2 BL-5)移除 J2；AUD-02/03(P2)须在落地前裁决(win32 沙箱+GitHub 许可证核验)但不阻塞计划推进；AUD-04/05(P3)为完善性更正。
- **建议动作**：A1 执行 AUD-01 第一轮返工（更正 J2/R70 + 移除 blocker）；返工后 C 复验 J2/R70 项，若 P1 清零则改判通过；AUD-02/03 由 B1/B2 在 P0 决策点跟进；AUD-04/05 由 A1 补冲突表/决策覆盖标注。

### 必须返工项（P0/P1）

| 返工项 | severity | 责任 | 返工内容 | 复验标准 |
|---|---|---|---|---|
| AUD-01 | P1 | A1 | J2/R70 五处更正：`./client` exports 实存(ui-skill/package.json:21-24)；v1.1 §7.1 引用正确；R70 状态→已验证；A1 blockers 移除 J2；B2 BL-5 移除 | C 复读 5 文件确认 J2/R70 修正为"✅"+blocker 列表不含 J2 |

**无 P0 项**（未发现研究诚信伪造/安全根本缺陷/根本架构错）。

### P2 项（不阻塞，须跟进）

| 项 | severity | 跟进时机 | 跟进动作 |
|---|---|---|---|
| AUD-02 win32 沙箱缺口 | P2 | P0 决策点/T16 落地前 | 显式风险接受(个人单机)或 WSL2/容器替代；T13 注明 ctx.sandbox win32 限制 |
| AUD-03 GitHub 许可证未核实 | P2 | 落地 manifest 锁定版本前 | 在可访问 github.com 环境补取 16 OSS+16 社区插件 LICENSE 全文+活跃度 |

### P3 项（完善性更正）

| 项 | severity | 更正动作 |
|---|---|---|
| AUD-04 experimental 冲突未入 C1-C6 | P3 | A1 追加 C7；T30 名册移除 experimental 行 |
| AUD-05 用户决策 D6 被覆盖未标注 | P3 | 02 R6 标注决策覆盖；05 §十追加 U8 |

### 复验结论

- 第一轮返工范围：AUD-01（A1 更正 J2/R70 五处）。
- 复验人：C 独立审计。
- 复验方法：复读 00/01/02/05/06 确认 J2/R70 修正+blocker 列表更新。
- 若第一轮返工后 AUD-01 P1 清零且无新 P0/P1 → **改判通过**。
- 若第二轮返工后仍存 P0/P1 → 停止，输出未决问题。

---

## 四、附：C 独立取证使用的源码路径索引（绝对路径）

- DSH 根：`D:\1\deepseek-harness-master1\deepseek-harness-master`
- 版本：`package.json:3`
- provider：`packages/llm/llm-deepseek/lib/index.js:1825`
- token-meter 测试（v4 仅测试认知）：`packages/llm/token-meter/tests/token-meter.spec.ts:215,372`
- defaults fixture：`apps/cli/tests/profiles/headless/tests/fixtures/deepseek-defaults.patch.yml`
- recon 引擎（仅 steps.ts+types.ts，无 state-machine.ts，无测试）：`research-prototype/src/engine/steps.ts`、`research-prototype/src/engine/types.ts`、`research-prototype/package.json`
- **J2 关键证据（./client exports 实存）**：`packages/client/ui-skill/package.json:16-27`
- 真实 conversation slots：`packages/client/ui-chat/src/client/apply.ts:94,102,155,166`、`packages/client/ui-attachment/src/client/index.ts:19`、`packages/client/ui-approval/src/client/contract/slots.ts:37`、`packages/client/ui-agent-preset/src/client/index.ts:154,159`
- 构建逃生口：`scripts/client-build-environment.ts:26-61`
- 构建记录：`.dsh-build/client-build-environment.json`
- 单端口 webserver：`packages/host/webserver/src/index.ts:9,118`
- 端口配置：`packages/bundle/web-app/cordis.patch.yml:121`
- loopback 安全：`packages/bundle/web-app/README.md:12,54`
- experimental 私有：`packages/README.md:52,86`
- pre-release 立场：`AGENTS.md:5-7`
- vendored 19 mod：`vendor/README.md:29-59`
- ctx.sandbox seam：`docs/capability-seams.md:153`
- 被审计 plan 文件：`D:\1\plan\00_source_manifest.md` 至 `06_test_acceptance.md`
- 设计文档：`D:\1\1.科研论文生产系统_DSH插件落地方案_v1.1.md`、`D:\1\1.AI科研论文生产系统设计文档_v1.0.md`
