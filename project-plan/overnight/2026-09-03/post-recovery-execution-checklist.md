# Post-Recovery Execution Checklist（冻结汇总 → 恢复后待办 + 全量测试矩阵）

> 产出：general-purpose-37（只读规划 Agent）｜2026-09-04 ｜ 纯文档，生产代码零改动。
> 工作目录 `D:/1/plan/overnight/2026-09-03/`。依据：status.json / execution-ledger.md / decisions.md(DEC-001..005) / t20-design-spec / t21-redteam-design / t20+t21-independent-audit / t25-slot-verdict-input / t26-exports-verdict-input / 05_execution_wbs.md / 用户 2026-09-04 裁决。
> 已核验（只读）：master1 仓库 master@`96c7f1c`、overnight/2026-09-03@`7ce683b`，merge-base=96c7f1c ⇒ **ff-only 可行**；bundle `D:/1/plan/dsh-recovered-20260904.bundle`（09:31）verify OK：heads{master=96c7f1c, overnight=7ce683b}+tag post-batch1-observed=c6731f7+HEAD=7ce683b；refs 文件现健康。

## 1. 恢复后第一步序列（git 稳定后；主 Agent 独占执行，未完成不启 T22+）
1. **环境自检**：`git log --oneline -1`=7ce683b；`git status --porcelain|wc -l`=0；`refs/heads/{master,overnight/2026-09-03}` 均在。
2. **bundle 验证**：`git bundle verify D:/1/plan/dsh-recovered-20260904.bundle` + `list-heads` 与上表一致；可选新鲜 clone 冒烟（只读检出 T21 审计同法）。
3. **ff-only 合入**：切 master → `git merge --ff-only overnight/2026-09-03`；断言 `git rev-parse master`=7ce683b。T21 审计已 PASS（t21-independent-audit.md，无 P0/P1）。
4. **标签+新 bundle**：打标 `post-overnight-p3-20260903`@master；重建 bundle（含 master/overnight/tag/HEAD）→ verify。**保留旧 bundle 副本**再覆盖。
5. **收口门禁**：research 三包 `tsc 0` + vitest 702/702 + `oxlint 0` + 工作树干净。
6. 环境怪癖纪律：**每 commit 后立即** `git log --oneline -1`+`status|wc -l`；ref 被移走则 reflog 查 hash→mkdir refs/heads→printf 恢复（execution-ledger 规程，已复现 5 次）。

## 2. 待实施任务清单
> 建议目录 = 独占归属，规避单写冲突；"设计引用"列 = 现有只读输入，T22-T24/T18 尚需各自设计文档（沿 T20/T21 先设计后实现惯例）。

| 任务 | 依赖 | 设计引用 | 预计测试 | 建议独占目录/模块 |
|---|---|---|---|---|
| **D0 WBS 措辞更正**（T21 行 C3→"已裁决(D12)"；T26 行 J2→"无阻断(AUD-01已纠正)"） | 无 | DEC-005/DEC-002 | 无（文档 diff） | `D:/1/plan/05_execution_wbs.md` 行103/108，独立文档提交 |
| **T18 roadmap_render**（P2.7 缺口工具） | T10(core host,完成)；J4/V4 用户裁决(U4/U6) | 参照 figure/three-line-table 模式；U4/U6 建议默认 mermaid/SVG fallback | tools roadmap spec：~12 纯测+定义注册冒烟 | `dsh-research-tools/src/tools/roadmap/`（新建）+ tests/roadmap/ |
| **T22 judge vote**（P3.3） | T21(完成,193) | t21-redteam-design §0/§3/§5；core gates A 已含投票加权+同族簇+abstain | judge 纯测 ~10 + host 全轮次集成（喂 gate A 返回裁决+同族上报） | core gates/judge（纯）+ team redteam/orchestrator 轮闭合（**串行单写**） |
| **T23 外部锚 B**（P3.4） | T20(完成)+T07(L0 纯逻辑完成)+T12/13 tools(完成) | core gates B 已含缺锚 abstain/#6 blocked；t21 设计"外部锚补强" | B 证据组装纯测 ~10 + mock 外部源 host 集成（缺锚 abstain 用例） | core external-anchor 纯组装 + host 侧证据接线 |
| **T24 C 可证伪→裁决**（P3.5） | T09 gate C(完成)+T20+claim-construct/ablation tools(完成) | core gates C 已含无预测 blocked/无结果 abstain；t19-hold 契约(gate-abstention) | C 组装纯测 ~10 + mock 预测/结果 host 集成 | core C-assembly 纯 + 与 engine state-machine/cordis evaluateGate 汇合 |
| **T26 双面包插件**（P4.2 脚手架） | T25(完成, DEC-001) | t26-exports-verdict-input（模板=ui-skill 六项+`./client`+dsh.client platform web） | `DSH_BUILD_FACE=client` build 过 purity gate + 静态注册冒烟 | `packages/research/dsh-research-web/`（新包，主 Agent 独占 scaffold） |
| **T27 research slots 注册**（P4.3） | T26 | t25-slot-verdict-input §c 样板（conversation.view id 'research' order20 + children research.*） | slots 注册 host 测试 + locale/view 冒烟 | dsh-research-web/src/client/{contract/slots.ts,apply.ts} |
| **T28 科研工作台 UI**（P4.4） | T27 | DEC-001 方案 A；pipeline/figure/gate/对抗四面板 | 组件渲染测试（mock data） | dsh-research-web/src/client/ 面板组件+data hook |
| **T29 人介入 UI**（P4.5） | T28 | DEC-001 方案 C（composer chain pending kind + approval.detail） | pending interaction 接管渲染测试 | dsh-research-web interaction/ 注册 |
| （T25 slot 裁决） | 无 | 已完成 DEC-001+U3 定案 | — | — |

### 各任务 Mock 边界与验收标准（沿用 T20/T21 门禁：纯逻辑零 host 依赖、freeze 语义、无密钥/网络/时钟、审计 PASS）
- **通用验收**：tsc exit 0；oxlint 0；vitest 全绿且 host 集成走 in-memory stand-in+真实 cordis Context（仿 T20 host-integration.spec）；per-file 100% 覆盖；无真实模型调用（一切 mock/合成语料）；不 import experimental；边界措辞禁"真实对抗已验证"。
- **T22**：Mock=mock 投票/拒重复/迟到；验证据 abstain 缺省，**不硬编码 ≥2**（T36 前 abstain 纪律）；e2e 判据留给 T35。首任务先出 `t22-design-spec`（≤120 行）明确跨包契约（team 现仅镜像 AdjudicationVote 字段、未 import core——契约接线是本任务关键设计点）。
- **T23**：Mock=L0/SOTA/复现结果 fixture；缺外部锚→abstain、#6 未访原文→blocked；外部源真实调用留 P5/P6（T02 待 key）。
- **T24**：Mock=合成 falsifiable 预测+实验真值；无预测→blocked、无实验结果→abstain；与 T19 hold 契约衔接（弃权不落 passed）。
- **T26-T29**：Mock=slots/services/locale/session mock；真值验证=构建产物双工件+purity gate+（P5 后）`dsh web` 加载；U3 已定 conversation.view tab，**不劫持 details/composer 单例**。

## 3. P3/P4 全量测试矩阵（行=任务；当前状态：✅完成 / 🟡设计就绪 / ⬜待实现+缺设计）
| 任务 | 纯逻辑 vitest | host 集成 | per-file 100% | oxlint | tsc | 状态与缺口 |
|---|---|---|---|---|---|---|
| T20 | ✅ types9/projection12/scope15/revision43 | ✅ host-integration 16（team 小计 97） | ✅（审计核） | ✅0 | ✅0 | 完成+审计 PASS；遗留 P2-1（teammate 嵌套 one-shot lineage 用例，T35 前补） |
| T21 | ✅ personas/fleet-config/rebuttal/session-events | ✅ host-integration 扩展（team 合计 193） | ✅（审计核） | ✅0 | ✅0 | 完成+审计 PASS；P2-1..P2-4 已立案，P2-1/P2-2/P2-4 建议并入 T22 前加固（同一单写者） |
| T22 | ⬜ judge 纯逻辑（目标~10） | ⬜ 轮闭合喂 gate A（目标~6+） | ⬜ | ⬜ | ⬜ | **设计文档待产**（gate A 纯函数已在 core，缺口=judge 组装+跨包契约+轮闭合） |
| T23 | ⬜ 证据组装（目标~10） | ⬜ mock 外部源（目标~6+） | ⬜ | ⬜ | ⬜ | **设计文档待产**（gate B 已在 core；缺口=anchor 证据组装） |
| T24 | ⬜ C 组装（目标~10） | ⬜ mock 预测/结果（目标~6+） | ⬜ | ⬜ | ⬜ | **设计文档待产**（gate C 已在 core；缺口=可证伪→裁决组装 + T19 hold 衔接） |
| T18 | ⬜ roadmap（目标~12） | ⬜ 注册冒烟 | ⬜ | ⬜ | ⬜ | 受 U4/U6/J4 阻塞；fallback 裁决后即设计就绪（tools 其余 6 工具已 100%） |
| T25 | 🟡（只读侦察产出） | — | — | — | — | ✅ DEC-001+U3 定案，无代码任务 |
| T26 | 🟡 exports 契约=ui-skill 模板 | ⬜ build/purity 验收 | ⬜ | ⬜ | ⬜ | **设计就绪**（t26 recon 可直接落地）；缺 package.json/tsdown scaffold |
| T27 | ⬜ slots 契约类型 | ⬜ register host 测试 | ⬜ | ⬜ | ⬜ | 依 T26 脚手架；样板=T25 §c（conversation.view 'research'） |
| T28 | ⬜ | ⬜ 组件渲染 mock | ⬜ | ⬜ | ⬜ | 依 T27；依赖 ui-chat/ui-trajectory 渲染范式 |
| T29 | ⬜ | ⬜ interaction 接管 | ⬜ | ⬜ | ⬜ | 依 T28；复用 composer chain（勿劫持 shipped 单例） |
| WBS 措辞 | — | — | — | — | — | 文档任务，无需测试；随第一步序列独立提交 |

## 4. 风险与依赖
- **依赖链**：T22←T21(轮闭合)←T20；T23←T07/L0+T20；T24←T09/T20+T14/15 tools；T26←T25；T27←T26←T25；T28←T27；T29←T28。T22-T24 与 T26-T29 两轨无文件交集，可并行。
- **公共 team service 接线归属（单写者原则）**：roster.ts/orchestrator.ts/rebuttal.ts/session-events.ts 为 T21 作者所有；T22 轮闭合与 T21 审计 P2-1/P2-2/P2-4 加固**必须同一单写者串行**，禁二人并行触碰；index.ts(TeamService/global guard) 为主 Agent 汇合点，任何扩展须主 Agent 收口。跨包契约（team 是否新增 dsh-research-core peer+project reference）由 T22 设计定案，未定前 team 不得 import core。
- **bundle checkpoint 规程**：每汇合 commit 后立即①ref 健康验证→②重建 bundle（含 tag+两分支+HEAD）→③verify；主 Agent 独占。历史教训：pack 丢失致对象库损坏 + refs 被备份机制移走（均无损恢复，内容保全）。
- **冻结边界**：本清单生效前生产代码零改动；T22-T24 设计文档（只读区）可在恢复等待期先行产出，不占 git 写。

## 附：按依赖排序的推荐启动顺序
1. D0+第一步序列：bundle 验证→ff-only 合入→标签+新 bundle→收口门禁（全 702 绿）——主 Agent 独占。
2. P3 轨道（同作者串行，先补 T21 P2 加固）：T22（先 `t22-design-spec`）→ T23 → T24。
3. P4 轨道（并行，另一作者）：T26（scaffold+exports）→ T27（slots）→ T28（workbench）→ T29（人介入）。
4. T18：等 U4/U6 裁决；裁决后按 figure/three-line 模式独立实现（tools 包单写）。
5. 每轨每次汇合后跑 §1-6 纪律 + bundle checkpoint。
