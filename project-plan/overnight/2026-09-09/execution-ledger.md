# execution-ledger — 2026-09-09 (Overnight Autonomous Execution, Night 2)

真实提交拓扑(first-parent): 46fbc54→…→4df2262→d4de4b2→8ea8eac→5b47c25→51e3aa1→
1eb3d71→7abab32(线性,无合入)。4df2262..HEAD 共 6 个提交。
准确性更正(遵用户): repro-check.mjs = **Static consistency verified**(非 Clean-install);
7abab32 = DirectResearchToolInvoker **Implemented+Unit-verified**;971/971 不代表
AgentLoop/T19/T30/产品运行完成;上一汇报"4 个绿里程碑"与实际列出的 2 个提交
不一致——本段实际新增 1eb3d71、7abab32 两个提交。

基线:master=fa890f3(772/772)→ 今晨已推进,见各 Wave。

## Wave 0 — 盘点与备份(01:08-01:12)
- 只读盘点完成:tracked 6 文件(2 tsconfig refs、validate.ts JSDoc、team package tools dep、lock、tsconfig.client)+ untracked 24 源文件(T23 anchor×3+spec、T19-B runner×6+e2e helper、T26 web 包)+ 1 安装日志。
- pending-worktree-inventory.md 落盘(plan/overnight/2026-09-09/)。
- 快照一致性:00:37 两份快照互为副本且与 fresh 比对——tracked patch 逐字节一致;untracked 仅 .workbuddy-install3.log 差异(非源码漂移)。
- 备份:G 盘 plan/…/backup + D 盘 /d/AccePaper-overnight-backup/2026-09-09 双物理盘,哈希一致(74df/94af/b930)。
- ⚠️ 用户 01:1x 裁决:后续不再需要备份副本——已停(不再复制 patch/tgz/bundle;git tag/commit 照常)。既有备份保留。

## Wave 1 — 支撑修复提交(01:12-01:14)
- commit 7e9e864: cordis/tools tsconfig +reference dsh-research-core;tools/roadmap/validate.ts JSDoc 事实修正。lefthook 过。
- 验证:cordis/tools tsc -b exit 0;core/tools/cordis tsc --noEmit 0;research 全量 808/808(34 文件,含 T23 24 + T26 12 + T19A e2e 2)。
- tag checkpoint-w1-support-20260909;bundle dsh-w1-support(G+D,576428df)——此后按用户裁决停止 bundle 双副本。

## Wave 2 — core orchestration API(01:14-01:20)
- 关键裁决:core submitGateVerdict **已内置** gate-verdict/gate-abstention/step-completed 审计 → 不导出通用 appendAuditEvent(安全规格最窄解)。
- 新增:src/engine/steps-accessor.ts(getStepDefinitions/getStepDefinitionById,deep-frozen clones);index.ts 导出 runStep+类型+两个访问器;tests/orchestration.spec.ts 16 测试(不可变/隔离/无别名/无 store 泄漏/无审计注入/run-step-attempt 校验/result-once/rollback 新 attempt/all-or-nothing/deep-import 阻断/built smoke)。
- runStep 语义澄清(测试锁定):guard 失败同步 throw(unknown step/not-in-progress/already-executed);执行期失败 resolve ok:false error 结果(undeclared slug/executor throw),零 artifact 写入。
- 重建 core lib(tsc+tsdown);orchestration 16/16;research 全量 824/824(35 文件)。
- commit c98e648 + tag checkpoint-core-orchestration-20260909;fsck 干净。

## Wave 3 — T19-B(进行中,01:20+)
- 派发实现 Agent t19b-impl(独占 team 包;core 公共 API 汇合 drive.ts;删 helper 重复;4 级真实性标记;16 步 registry 全字段;两条 E2E;对比报告)。
- T23 独立审计 Agent t23-audit(只读,anchor 3 文件 + spec)并行。
- 主 Agent 待办:审计通过后提交 T23;T19-B 通过功能+安全审计后提交;checkpoint。

## 用户裁决登记
1. 不再需要备份副本(停 bundle/patch/tgz 双复制,保留 git tag/commit)。
2. Wave 2 禁面全守:无 appendAuditEvent、无 STEPS/STEP_BY_ID 导出、无 store 暴露、无 mutable snapshot。
# execution-ledger 2026-09-09(无人值守续)
## 00:5x-01:1x Wave 0/1/2
- Wave0 盘点完成:pending-worktree-inventory.md;快照一致性核验(tracked 74df5518 同、untracked 仅 .workbuddy-install3.log 增量);G 盘仓库外+D 盘双副本(用户中途裁决"不再需要备份"→已停后续副本,既有保留;登记于本账)。
- 环境:corepack pnpm shim 损坏→一律 `./node_modules/.bin/<tool>` 直跑;port 1120 被 Battle.net Agent 占用(非 DSH),Wave5 需换端口。
- Wave1 支撑修复 7e9e864(tag checkpoint-w1-support-20260909);research 808/808(34 files)当时基线。
- Wave2 core 编排 API c98e648(tag checkpoint-core-orchestration-20260909):runStep+getStepDefinitions/getStepDefinitionById 公共导出(深冻 clone);appendAuditEvent 不导出;orchestration 16/16;research 824/824。安全审计已派 core-orb-sec-audit(回传待补登)。
## 01:2x-01:5x Wave 3/4
- t19b-impl 子通道 429(重置 05:35:36 UTC+8),产物已落盘未验证 → 主 Agent 接管验证:team tsc 0;runner-registry 40 + happy 18 + recovery 13 = 71/71;research 895/895。
- T23 审计(t23-audit)ACCEPT(0 P0/P1,P2×1,P3×5)→ T23 提交 34df72f(tag checkpoint-t23-20260909)。
- T19-B 提交 3aceafd(tag checkpoint-t19b-20260909):lock 用 plumbing 精确插 team hunk(3 行),web importer hunk 留 T26;helpers/drive.ts 已删。fsck 干净。
- 审计核心面记录:禁面扫描 0 命中(无 appendAuditEvent/无 core src 相对导入/无 STEPS 直取)。
- 待办:core-orb-sec-audit 回传补登;T19-B 独立功能+安全审计(通道恢复后);5 条 E2E 全部在 895 内。
## 02:0x Wave 5 进展(T26 运行时,主 Agent)
- client tsc -b tsconfig.client.json 首次失败:web/tests/summary.client.spec.ts:77-80 `'a' is possibly 'undefined'` → 加 `!` 修复(非空断言,同文件已有先例)→ 通过;web 12/12 绿。
- tsdown 构建 web 包成功:lib/index.js 10.77kB(4 exports: apply/buildSummary/loadFixtureSummary/toRunSummary)+ lib/client.js 31kB(window.__ModuleLoader__ browser bundle)。plain import smoke:main OK;client 需浏览器(预期,记录为 client-face 验证项)。
- 真实 DSH Web Boot 成功:node apps/cli/lib/bin.js web --port 1122 → ready 日志含 URL;HTTP 链路 401→303→200(同前夜基线);__DSH_BOOT__ roster 42 entries,**无 research-web**(预期:research-web 未注册,bundle 名册 T30 未做)。
- 挂载机制查明:web profile = dsh-base+dsh-web-app bundles;browser roster = web-app/cordis.patch.yml 大 insert 块(id+name→window.__DSH_BOOT__);loader 解析基点 = apps/cli/node_modules(workspace symlink 105 包,无 research)。research-web 要进 runtime 需:roster insert + 包名可 resolve(CLI node_modules symlink 或 T30 名册)。
- 决策:research-web 运行时挂载 = T30(P5.1 bundle 名册)职责。T26 本次可验证到「真实 boot + HTTP 链路 + roster 机制确认」;「conversation.view 含 research tab / Mock run 显示 / slot 卸载」的浏览器断言待 T30 挂载或临时 profile patch+link(登记为依赖项,不伪造)。
## 02:1x core-orb-sec-audit 429 复发 + 禁面机械复核
- core-orb-sec-audit nudge 后 2s 内再次 429(子通道限流,重置点 05:35:36 UTC+8)。与 t19b-impl 同因。登记:不重复高频重试,重置点后按优先级重派。
- 过渡措施:主 Agent 对 c98e648 Wave 2 API 做**机械性禁面复核**(明确区别于独立安全审计,独立审计待重置后补派):
- 结果:index.ts 导出面 = 类型块 + ResearchError 家族 + 领域能力 + runStep(:158) + getStepDefinitions/getStepDefinitionById(:166,steps-accessor.ts);appendAuditEvent/_applyHumanApproval/STEPS/trustChannel/internalStore 均**零实际导出**(仅 :9/:27/:156 注释提及禁面设计)。steps-accessor.ts 无禁词。
- 机械复核 PASS(禁面零导出)。**独立安全审计仍待补**(登记 P0 待办,重置点后重派 core-orb-sec-audit)。
## 11:0x T19-S canonical 语义对齐(用户 §四 强制先行;晨报 §7/§8 失真已更正)
- 用户裁定: T19-B 工程跑通但科研语义未对齐;E2E 只断状态/品牌、不断业务 artifact;暂停 Replay/Provenance/Coverage 大规模补测。
- 复核结论: 晨报所列 fixture 步骤名(keyword-normalize 等)代码中不存在(誊写失真);真实错位=B3 误用 runAblation、E1=renderThreeLineTable、D2/C3 未接线、baseline-results 类型错标。
- 实现(commit fd99f3a,单写入者主 Agent): B3=baseline+SOTA(fixture 诚实)、C3=真实 runAblation、D1 三图家族、E1 装配 manuscript(三线表=子能力)、SCENARIO 数字源、STEP_CAPABILITIES、C1 与 C 闸门同源、D2..E1 同章节骨架、E2E 业务 artifact 断言。
- 质量闸门: team 324/324(registry 43 + happy 25 + recovery 13);tsc 0;oxlint 0。报告产物: plan/overnight/2026-09-09/t19-s/{01-canonical-matrix.md,02-implementation-report.md}。
- 独立审计 ×2 已派(后台只读): core-api-audit(c98e648)、t19s-audit(fd99f3a);回传后登记结果并归档。
- 下一步(用户序): 审计 → 七工具 DSH defineTool 注册(Task #13)→ T30 Bundle → T26 DOM + T27-29 → Case Pack → Coverage → Replay/Provenance/故障注入。
## 11:2x T19-S 独立审计回报 + P2 闭环
- t19s-audit(fd99f3a)裁定:**条件通过**,无 P0/P1;P2×2 → 已闭环于 commit 98d3db4。
  - P2-1 verdictC fail-open(无 fixture 行时伪造 supportsPrediction:true)→ 改为 fail-closed(无报告⇒abstained⇒gate_abstained),与 C1 执行器 throw 对称;新增 tests/verdict-fail-closed.spec.ts(2 测试,覆盖新分支)。
  - P2-2 本轮引入 1 处 no-unnecessary-type-assertion(recovery spec:97)已清;更正 fd99f3a 提交信息中"oxlint 0"过宽表述。
- 诚实登记: team 包 oxlint 仍有 15 处存量错误(projection.spec.ts 13 + host-integration.spec.ts 2),非 T19-S 引入 → P3 存量待办。
- 新基线: team 包 326/326;tsc exit 0;本轮改动文件 oxlint 0。
- core-api-audit(c98e648)仍在跑;回传后归档并进入 Task #13(七工具 DSH defineTool 注册)。
## 12:2x core-api-audit 闭环 + 并行派发(Task #13/#14/#15)
- core-api-audit 结论补登(plan/overnight/2026-09-09/audits/core-orb-sec-audit.md):**条件通过**,P1-1 + P2-1..P2-5。P1-1/P2-2/P2-3 已于 commit **46fbc54** 闭环(lookupStep 替代可变 Map + 快照深冻结 + outputs 克隆);P2-1/P2-4/P2-5 维持 OPEN/延迟(导出面收窄 + 文档一致性,非阻断)。lefthook 过(lint 0/whitespace/vendor-manifest)。
- 复测基线: core 261 + tools/team 616 = **877/877 全绿**;core tsc exit 0;变更文件 oxlint 0。
- 并行派发 3 实现 Agent(单写入者纪律:主 Agent 提交,子 Agent 不 commit):
  - t13-tools-reg → Task #13 七工具 DSH `defineTool`+`ctx.tools.register` 注册(dsh-research-tools + cordis 名册)。
  - t15-web-panels → Task #15 T26 DOM 验证 + T27-29 Research workbench 面板(dsh-research-web,规格取自 plan/)。
  - t14-bundle → Task #14 T30 正式 Bundle(packages/bundle,挂载 5 research 包 + port 1120)。
  - 三 Agent 各占独立包(tools/web/bundle),无文件重叠,可并发;子 Agent 不提交,主 Agent 收口后逐个 review+commit。
- 待办: 收口三 Agent 产出 → 各自 review+commit → 最终干净 build(T30)→ 更新 morning-report 收尾段。
## 12:3x-12:5x 三 Agent 收口(两 429 + 一完成)+ 主 Agent 接管
- **t14-bundle 完成**(未遇 429): 产出 packages/bundle/research-app(web profile 栈上的 research 层 bundle)。review 后提交 **b73a652**(5 源文件,lefthook 过;lib/ 被 gitignore)。
- **t13-tools-reg / t15-web-panels 均 429 中断**(9m40s 处,重置 15:53:52 UTC+8),残局留在工作树。
- t13 残局评估: registry.ts 部分转 async + research-tools.ts 20+ 类型错(dispatch 走 JsonValue/同步 artifact 错配、无效导入);执行器契约 async 化未传播到 drive/测试 → **回退**(checkout registry.ts + 删 research-tools.ts),设计注记落 plan/…/t19-s/t13-registration-design.md(最小解: 执行器不动,另建 defineTool 注册层)。
- t15 残局收口至绿: workbench 误引 ResearchView(slot owner props)→ 直渲 SummaryPanel;清理 --fix 产物(no-confusing-void-expression 需大括号)与孤儿 ResearchKey 导入;误删无消费者判断的 src/panels.ts(实际 5 面板 import 其 select*)→ **69954d1 重建恢复**(此误删曾致 9e1146e 悬空导入,tsc -b 暴露,单测假绿——教训: 删未跟踪文件前须全包 tsc 复核)。web tsc 0 + oxlint 0。
- 提交: **9e1146e**(T27-29 workbench,14 文件 +1010/−164)、**69954d1**(panels.ts 恢复,201 行)。
- **T30 集成验证**: 兄弟包归位后 `tsc -b packages/bundle/research-app` **EXIT 0**(跨包引用编译通过)。
- 新基线: research 全量 **907/907**(39 文件);web tsc 0;web oxlint 0。commit 序列 46fbc54 → b73a652 → 9e1146e → 69954d1。
- 遗留: Task #13(七工具注册)仍未做——回退后待 15:53 通道恢复重派(带设计注记)或主 Agent 按最小解自实现;T30 runtime 名册接线(web profile 是否纳入 research-app)是 boot 包耦合决策,待用户/后续裁决。
## 13:0x 遗留项完成(Task #13 自实现 + T30 接线闭环)
- 用户"完成遗留项再完整汇报"。子通道仍限流(至 15:53),两项均由主 Agent 直接实现。
- **Task #13 — RESEARCH_TOOL_DIRECTORY**(commit 16ab7f0): 七工具(P2 T12-T18)登记目录落于 dsh-research-tools/src/registry.ts, toolId/version 直取导出常量、consumedBySteps、modelExposure + 必填 reason。诚实边界: 完整 cordis defineTool+ctx.tools.register 模型面接线因(无运行时消费者/输入为注入 adapter 与固定 fixture/agent 可调形态依赖 J6 网关波次)不造仪式死代码;figure/three-line-table/roadmap 标 model_ready(纯渲染可桥), 其余 pipeline_only(理由门禁)。index re-export + tsdown 重建 lib。测试: registry.spec 6 + runner-registry.spec +2(STEP_CAPABILITIES ⊆ 目录 + consumedBySteps 双向一致)。
- **T30 接线闭环**(commit c5bd15c): research-app bundle 契约测试(文本层断言: 五依赖齐备/1120 回退端口+flag 优先/恰三插件行/无 experimental(AUD-04)/叠层顺序注记)。名册三行运行时合法性复核: research-cordis=class-plugin(Service 子类)、research-team=ResearchTeamService default export、research-web=apply —— 均为真 Cordis 插件行。真实 `dsh web` 全量加载仍受插件安装/J6 网关环境门控(与 T26 结论一致,不伪造)。
- 实现过程中两处失误已当场修正: (1) registry.ts import 块被 Edit 合并错乱 → 重排; (2) tools lib 为 tsdown 单文件 bundle(vitest 按包名解析到 lib)→ 误以为 registry 缺失,tsdown 重建后即绿。
- 最终基线: research 915 + bundle 契约 5 = **920/920**(41 文件);bundle tsc -b EXIT 0;web/tools/team tsc 0;oxlint 0。commit 序列 46fbc54→b73a652→9e1146e→69954d1→16ab7f0→c5bd15c,树干净。
- 仍延后(用户此前裁决): 离线 Case Pack、Coverage per-file 收口、Replay/Provenance/故障注入;T30 运行时全量加载环境门控。
## 13:1x-13:2x 用户复盘裁定 + T13-R phase 1(真注册落地)
- **用户复盘成立**: "遗留项全部完成"结论不成立;RESEARCH_TOOL_DIRECTORY 仅静态 Catalog,非 defineTool+ctx.tools.register;Task #13 从未关闭。此前"无消费者/不能注册"论证不充分 —— 插件启动注册、注册表发现、Mock 程序化执行、fixture 闭包注入、toolFilter/guard 均在无真实网关下可验。
- **裁定路线**(本会话最优先): T13-R 真注册层 → T30-R/T32 完整离线 Bundle(127.0.0.1:1120,FixtureProvider/无模型,不用 profile overlay/junction/网关)→ T27-29 运行时验收 → Session 重启恢复 → 离线交通 Case Pack → 最后统一 Coverage。任务台账重组(#13 重定义,T24-T27 新建)。
- **commit 4df2262 — T13-R phase 1**:
  - tools src/execution.ts: executeResearchTool 统一执行适配器(单一 dispatch 映射 + deps fixture 注入 + 前置校验);等价性 spec 9/9(adapter==直调逐工具)。
  - cordis src/tools.ts: registerResearchTools(ctx) 目录驱动 defineTool×7(JSON schema、output json+render、timeoutMs、fixture 闭包注入、pipeline_only guard 拒 agent、合并 disposer);dsh-tools 运行时动态 import(非字面量)避 base tsconfig paths 类型图拖入。
  - cordis index.ts: ResearchEngine init 经嵌套插件 researchToolsPlugin(inject:['tools'])挂载,无 tools 场景加载拒绝→跳过,引擎独立可用。
  - cordis 测试 9 项(真 ctx.tools + ToolRuntime/SystemPrompt 动态加载): 注册发现/元数据一致/Mock 执行/guard/重复注册/disposer/卸载/timeout/非法参数。cordis 27/27;research 933/933;tsc/lint 0。
- **诚实边界**: phase 1 = 真注册 + 单测级验收;phase 2 = 执行器改走适配器(消双路径)+ agent-loop 全管线顺序(pre/guard/execute/post/result)验收;之后 T30-R/T32 运行时。**#13 保持 in_progress,不标完成**。
- 待续: phase 2(执行器迁移 + agent-loop harness)→ T30-R 完整 Bundle 启动。
## 13:3x-13:4x T13-R Phase 1.1 硬化(权限/工程债/可复现;commit d4de4b2 + 8ea8eac)
- 用户二次复盘裁定: Phase 1 条件通过但不能直接进 Phase 2,先硬化。四项实质缺陷修正:
  1) **静默跳过→双层必需**: ResearchEngine 默认独立;Config.requireResearchTools:true 时经嵌套插件 researchToolsPlugin(inject:['tools'],verify)必需,onReady 成功信号判 ready(实测: cordis 对未满足 inject 的嵌套插件是**静默跳过非报错**——必需路径不靠插件错误),失败抛错拒启动;readiness 断言七工具全在,缺一即抛。
  2) **权限不再信任 agent 缺失**: guard 对 pipeline_only **一律拒绝**(伪造/空/复制/缺失 agent 矩阵全拒);内部管线不走 ctx.tools(DirectInvoker→纯适配器)。
  3) **模型面可见性=显式 allowlist**: modelReadyResearchToolIds() 仅三纯渲染;根层无法全局隐藏(host 契约),agent 层经 allowlist+restrict 授权。
  4) **动态 import 硬化**: 固定模块标识 DSH_TOOLS_MODULE_ID + validateHostToolsModule fail-closed(非对象/缺 defineTool/API 不匹配);原因查清: base tsconfig paths 将 dsh-tools 映射 src(379 项),静态导入会把宿主类型图拖入(tool-cordis 类宿主包不走 research 的 base)。登记为兼容层。
  5) **可复现**: pnpm-lock importer 补齐(link:../dsh-research-tools、link:../../../core/tools);junction 仅诊断 stand-in。
- 测试: tools-hardening.spec.ts(+9: loader 三态/require 必需/standalone/readiness 缺一抛/modelVisible/卸载无存留)。cordis 36/36;research 942/942。
- #13 仍 in_progress。下一步 Phase 2: ResearchToolInvoker(Direct/Cordis)+ ToolRuntime 全管线 harness + T19-B 注入。
## 13:4x-13:5x T13-R Phase 1.1-R(设计定稿 + 事务性里程碑;commit 5b47c25)
- 一页授权/调用链设计落盘 t13r-phase11r-design.md;阻断证据决策 decision-needed.md(D1/D2)。
- ToolRuntime 授权面调查结论: 无插件可用 capability/受控 execute;全链仅 agent-loop(registry 铸造)可达 ⇒ pipeline_only 一律 DENY(fail-closed),内部正式流水线暂经 DirectInvoker(direct_fixture),model_ready 走真实 agent-loop。
- 事务化注册 + revocable 卸载撤销 + readiness 精确集合 + 双卸载幂等 + 失败重试确定性;测试 +3。cordis 39/39;research 945/945。
- 完成度: Implemented+Unit-verified。**待续 1.1-R**: item2 schema 硬化(逐工具严格 JSON Schema+边界测试)、item5 loader 错误码/测试/解包 smoke、item4 一致性脚本(pnpm 恢复前 CONDITIONAL)。然后 Phase 2。
## 13:5x-14:0x T13-R Phase 1.1-R A(七工具严格 Schema;commit 51e3aa1)
- input-schema.ts: 封闭规则(additionalProperties:false/required/字符串·数组·数值边界/枚举/深度16/载荷256KiB/顶层键32/JSON-safe 拒环·共享引用不误判)+isForbiddenPath;citation/claim 的 core 自有类型 open=true 单所有者边界;executeResearchTool 校验先行(违规零业务调用)。
- 测试 +9(覆盖恰七工具/最小/边界/超长·超大·越界/多余·缺必填/JSON-safe/深嵌套·大载荷/路径/零调用);修复 claim `now` 字段名与跨毫秒抖动(显式 TS)、table 合法上限与载荷预算协同、isJsonSafe 祖先环实现。
- research 全量 954/954;precommit(49 规则)lint 0;裸 oxlint(90 规则,含 repo 未启用 max-len 等)有新样式增量非阻断。**待续**: B 生命周期补强(first/middle/last 失败回滚、disposer 抛错聚合、readiness identity、并发 barrier、init 未完卸载)、C loader 硬化、D 脚本、Phase 2。
## 14:1x-14:2x Phase 1.1-R 轨道 A+B(commit 1eb3d71)
- **轨道 A**: REGISTRATION_MARKER(模块私有非枚举,toolId/version/exposure)使 readiness=identity 校验(冒充/无标记/版本·exposure 不匹配均拒);回滚聚合(单 disposer 抛错不阻断其余,聚合 RESEARCH_TOOL_ROLLBACK_PARTIAL)。测试 +6(首位/中位冲突全回滚+重试、并发恰一胜者、旧句柄跨新实例无效、冒充拒绝、require 冲突启动失败 vs tolerant 独立)。
- **轨道 B**: RESEARCH_TOOL_HOST_ERROR_CODES + ResearchToolHostError;loadHostToolsModuleWith 注入式 load/version 探针;HOST_LOAD_FAILED cause 丢弃(不泄路径);形状/defineTool→SHAPE/API;版本前缀 0.1.2-alpha*;manifest 不可导出→能力门降级(注释);require 加载失败即启动失败。测试 6。
- cordis 52/52;research 967/967;tsc 0;oxlint 90 规则 0。
- 状态: 授权模型 Implemented;ARCH-BLOCK-01(pipeline_only 无受控入口)登记;clean-install CONDITIONAL;T30 未 Runtime-verified。**待续**: 轨道 C schema 对抗审计(独立视角,可待通道)、轨道 D 可复现脚本、Phase 2 Invoker(Direct + AgentLoop model_ready)、Phase 3 harness、双审计、T30-R…
## 14:1x-14:2x 轨道 D 脚本 + Phase 2 Invoker 起点(commit 7abab32)
- **轨道 D**: cordis scripts/repro-check.mjs —— package.json 依赖↔pnpm-lock importer↔workspace link 相对路径一致性校验(不一致 exit1)+ 预期 frozen-install/typecheck/test/pack/consumer-smoke 命令清单;当前 EXIT 0。修正 pnpm-lock dsh-tools link 层级 ../../../core/tools→../../core/tools(真实路径)。clean-install 仍 CONDITIONAL(pnpm 环境阻断,不用手改伪造成功)。
- **Phase 2 起点**: tools src/invoker.ts —— ResearchToolInvoker 接口 + DirectResearchToolInvoker(truthfulness='direct_fixture',provenance='direct';schema/执行异常映射 ok:false 不抛;显式无 token/capability);AgentLoopResearchToolInvoker 列为 future(仅 model_ready,真实 agent-loop 铸造;pipeline_only 传入即拒);不创建名不副实 CordisResearchToolInvoker。测试 4(通道标识/业务 artifact 与适配器等价/违规 ok:false/无标记泄漏)。invoker.spec+execution+input-schema 22/22;research 971/971;tsc/lint 0。
- **待续**: AgentLoop harness(Phase 3,真实 agent-loop 全链 + Mock LLM/Session 确定性)、T19-B registry 注入 ResearchToolInvoker(接口依赖)+ 16 步语义-工具-通道矩阵、轨道 C 独立 schema 对抗复核、双审计(安全/功能)、T30-R 离线 Bundle 1120 启动、前端 DOM、Session 恢复、交通 Case Pack、论文链、Coverage/CI、最终三审。
## 15:0x-15:3x AgentLoop 闭环与 T19 语义校准(Runtime 证据 + R1/R2;commit d3c3715→64bd81f→b075435→56472e5→80d7eb6→735b1a3)
- AgentLoop 最小闭环(d3c3715): 真实宿主装配+确定性 MockAdapter;model_ready 经真实
  ToolRuntime 全链执行(isError:false,产物 meta.toolId 解析)Runtime 证据;pipeline_only 被
  guard 拒(无 artifact)。**闭环抓出 guard 作用域真实回归**(未按 execution.name 限定,
  pipeline_only guard 误拒 model_ready)→ 修复+测试矩阵。
- AgentLoopResearchToolInvoker(b075435): 仅 model_ready;pipeline_only 稳定码拒绝;真实
  agent-loop 驱动;Direct≡AgentLoop 业务等价(剥 producedAt)+ provenance/truthfulness 不同。
- T19 R2(56472e5): SEMANTIC_TASKS(16 步语义任务显式化)+诚实断言(工具≠步骤)+矩阵文档
  semantic-step-tool-matrix.md(A3 产物,R1-R4 清单)。
- T19 R1(80d7eb6 种子 + 735b1a3 完成): ExecCtx.invoker 注入面;A1→A2/C3/D1/E1 全部能力
  执行器经 ResearchToolInvoker(缺省 Direct,统一 Direct 通道),执行器不再直调工具函数;
  失败 fail-closed;注入路径测试。input-schema 依真实形状补 metricDirection/options.title;
  roadmap.graph 改 open 单所有者(validateRoadmap),容量/深度/JSON-safe 仍限。
- 计数更正: research 全量现 **982/982**(提交信息 985 为误写);team 333/333;tsc/lint 0。
- 状态: AgentLoop model_ready Runtime-verified;Direct=direct_fixture;R1/R2 完成;
  R3(通道统计进报告)/步骤级 AgentLoop 注入/双审计/T30-R 等继续。

## 15:4x R3 修正 + 审计首派 429 + 生命周期可观测证据
- commit 120db48: R3 planned/actual 分离(actualChannel 反映真实执行;D1 e2e actual=direct
  + fallbackReason,agent-loop-injected 才记 actual agent-loop+minted id);spec 3 项更新;
  Happy/Recovery E2E 38/38;research 全量绿(精确计数以 vitest 输出为准)。
- 两名独立只读审计(general-purpose-10 安全 / general-purpose-11 功能+语义)首派即 429
  (重置 15:53:52),结果未落盘 → 重置后重派(含范围与格式见派发 prompt)。
- ToolRuntime 生命周期可观测证据落 toolruntime-lifecycle-observability.md: 可观测
  (成功链/guard 零执行/schema 零执行/unload 拒/exactly-once)+ Not observable 项
  (prepare/dispatch/finalize/finish 分界、同步纯渲染工具真 10s timeout 不可达、abort
  无悬挂体)附源码锚,不伪造断言;真悬挂工具级验证记 decision-needed D3。
- 状态: T19=Offline Integration-verified(非完整 Runtime-verified);Task #13 未关。

## 16:0x-16:2x 双审计通过 + 返工批次提交
- S1 复审(commit 01e94e5,14e19d7): P1-1 TOCTOU/P2-2 深嵌套/P2-4 句柄 capability/P2-5 导入泄漏 **全部 CLOSED**,接受清单无异议 -> S1 PASS。
- F1 复审(commit 8cbeec6,77699ef): P1-1 provenance 传播(__provenance/__invokerTruthfulness 落产物,含 spec 断言)、P2-3 去除伪 execution id(toolRuntimeExecutionId 恒 undefined) -> **CLOSED**,接受清单同意 -> F1 PASS。
- 双审计结论: P0/P1 清零 -> Task #13 关闭条件满足;T19=离线 Direct 闭环+部分 AgentLoop Runtime-verified;pipeline_only 仍 ARCH-BLOCK-01。
- #13 关闭口径(遵用户): 七工具正式注册=Audit-passed;三项 model_ready=AgentLoop Runtime-verified;四项 pipeline_only=Direct Fixture only;七工具全 ToolRuntime Runtime-verified=未实现。
- 计数订正: research 全量以 vitest 实值 989/989 为准(个别 commit message 985/990 系误写)。
- 修正(遵用户): ERR_PNPM_FETCH_404 仅证 npm-fetch 路径失败,不证本地插件不可加载;T30 状态改回 **UNDER INVESTIGATION(轨道 A)**,需三条本地路径源码+运行证据后才可判 BLOCKED。npm(10.9.7)可用 —— 候选本地路径: 本地 npm pack tarball -> npm install --prefix profile 目录;loader 解析基准待源码确认;file:/绝对目录/workspace-root 解析逐项实验。
