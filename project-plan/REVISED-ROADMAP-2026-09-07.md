# 执行路线修订 v2 —— 从"内核优先"转向"端到端闭环优先"(2026-09-07)

> 依据:用户 2026-09-07 评审(纠正上版计划三处错误 + 重排关键路径)。Superpowers 方法:先规格、后 TDD、证据优于声称。
> 本计划取代"先重做 T22/T24 → T26/T23 → T19"的旧顺序。

## 0. 对旧报告的三处纠正(已确认,立即生效)

| # | 旧结论 | 纠正 |
|---|---|---|
| C1 | T18 被 U4/U6 决策阻塞 | ❌ 已裁决:U4=自动结构检查+人工评分量表联合验收;U6/D17=结构化图模型→Python `vsdx`→VSDX+SVG+PNG,Mermaid 作预览/降级;接受 Python subprocess;VSDX 不可用不阻塞 Mermaid/SVG/PNG。**T18 可立即开发** |
| C2 | T26 与 T23 需错峰 | ❌ 不必错峰:T26 在 web 包、T23 在 team 包,文件范围不同可并行。真正要串行化的是"公共入口由主 Agent 接线",不是整个任务 |
| C3 | research-skills 可直接作素材 | ❌ 只能标记为**候选参考**,核验(LICENSE/来源/版本/可否再分发/规则是否经验证/是否与 T07-T19 契约冲突)通过前不得纳入正式包 |

## 1. 真实完成度基线(评审确认,作为复验基准)

后端规则/安全内核约 60-70%;工具层约 50%(多 Mock);多 Agent 约 30-40%;前端约 10%;完整工程闭环约 25-35%;科研有效性验证基本未开始。**702 测试只是历史基线,须在新环境复跑后才重新有效。** T22/T24/T26 代码随 D:\1 迁移丢失,仅剩设计规格。

## 2. 阶段 0:新环境基线复验(硬前置,未过不写功能)

唯一可信仓库:**G:\AccePaper-main\deepseek-harness-dev**(master=7ce683b;旧仓库只读归档,不再引用)。
顺序:
1. `git fsck --full` 零错误;
2. `pnpm install --frozen-lockfile`(pnpm 11.7.0 = packageManager 声明;node ^22.19);
3. 按 core → cordis → tools → team 顺序构建(产出 lib/,供 vitest 解析);
4. 运行历史 702 测试;
5. research 各包 typecheck(tsc --noEmit exit 0);
6. coverage(per-file 100% 门禁确认);
7. pack/unpacked smoke;
8. Mock `dsh web` 启动 smoke;
9. 记录 node/pnpm/python/OS 版本;
10. 创建新 tag + bundle(含 refs 核验,见 §6)。

通过后才将"702/702"重新标记为**当前有效基线**。

## 3. 第一优先级:T19-A 最小工具流水线(取代 T22 优先)

用现有 T12-T17 + T18 Fixture 打通:

```
pre-execute → guard → execute → post-execute → artifact → result
```

实现要素:工具注册 / 输入校验 / artifact 写入 / timeout / cancellation / result 恰好一次 / 错误映射 / 审计事件 / `hold_abstained` / rollback / 新 attempt / 下游阻断。
T18 本期可用结构合法的 Fixture artifact,不等 VSDX。

### 3.1 16 步最小 Mock 纵向切片(T19-A 完成后立即)

场景一 Happy Path:交通研究方向 → 16 步依次运行 → 每步最小合法 artifact → E2 停在 humanGate。
场景二 Abstained/Rollback:引文证据不足 → gate abstained → Step gated → 下游禁止启动 → rollback → 新 attempt → 补 Fixture 证据 → 重新裁决。
验收:16 步无死锁 / 依赖正确 / artifact 可追溯 / abstained 永不为 pass / rollback 后旧产物失效 / E2 不可被 Agent 自动通过 / 两次运行确定性 / 完整审计链可导出。

## 4. 第二并行波次(16 步 Mock 切片通过后)

| 轨道 | 内容 | 文件独占 | 备注 |
|---|---|---|---|
| A-P3 三路并行 | T22 Judge Vote / T23 外部锚 / T24 实验裁决 | team/judge/**, team/anchor/**, team/experiment/** | 主 Agent 独占:team/index.ts、package.json、SessionEventMap、公共事件注册 |
| B | T18 路线图(结构化模型/Mermaid/SVG/PNG/VSDX adapter/Python vsdx PoC/renderer manifest/自动结构检查/人工评分量表) | tools 内独立目录 | U4/U6 已裁决 |
| C | T26 dsh-research-web 重建(双面包/conversation.view id='research'/clientBundle/browser purity/load-unload/package smoke) | web 包 | 与 T23 并行无冲突 |

纪律:T22 缺 Golden Set 阈值一律 abstain;T23 先 Mock 不碰许可未确认数据;T24 严格区分 `executed` 与 `supportsClaim`;Mock 结果永不升级为真实证据。

## 5. 第三阶段:完整汇合

T19-B(真实 T18/T22-T24 接入流水线)→ 重跑 16 步 Mock E2E → T27 Slots 注册 → T28 Research Workbench → T29 Human Interaction → T30 Bundle 总集成 → T32 1120 单端口 Mock 启动。至此形成用户可见可操作的完整 Mock 原型。随后才进入 T02/T33 真实模型与 Golden Set。

## 6. Git 备份制度(事故教训,强制执行)

- 每个在途分支:创建即建临时 checkpoint tag:`refs/tags/checkpoint/<txx>-<YYYYMMDD-HHMMSS>`;
- 里程碑后 `git show-ref` 核验所有 ref;
- bundle 前检查全部 worktree/分支,显式列出 refs(master、p3-t22-t24、p4-t26、refs/tags/checkpoint/*),**禁用仅 `--all`**;
- bundle 后执行 `git bundle list-heads` 验证 heads 确实在内;
- 每个分支同时生成 patch;至少两份不同磁盘位置的 bundle/patch;
- **未进 bundle 的分支不得标记为"已备份"**。

## 7. research-skills 处置(候选,非资产)

`G:\AccePaper-main\research-skills\`(4 来源 51 技能)在核验完成前仅作参考。核验清单:LICENSE 可再分发性 / 来源与版本(commit)/ 未经验证 prompt 与科研规则风险 / 与 T07-T19 契约(l0/gates/citation 语义)冲突面 / 若需纳入正式包须先申请与独立评审。

## 8. 关键路径(汇总)

```
新环境基线复验(§2) → T19-A 最小流水线(§3) → 16步 Mock 纵向切片(§3.1)
→ T18 ∥ T22 ∥ T23 ∥ T24 ∥ T26(§4) → T19-B 完整接线(§5)
→ T27-T29 → T30 → T32 Mock 产品演示 → T02/T33 真实模型 → Golden Set
```

## 9. 待办入口与引用

- 本计划 → plan/REVISED-ROADMAP-2026-09-07.md
- 恢复清单:plan/overnight/2026-09-03/post-recovery-execution-checklist.md
- 重实现规格:t22-t24-design-spec.md / t23-external-anchor-design.md / t26-implementation-spec.md / batch2-t19-hold-abstained-design.md
- WBS:plan/05_execution_wbs.md(T00-T36,措辞将按本修订同步)

## 执行状态(2026-09-08 夜间,追加;不改写上文)
- 阶段0 ✅ 关闭(env-baseline-2026-09-08.md;v2 tag/bundle;DEG-2 coverage、DEG-3 lint 口径证据化)
- T19-A ✅:P1-P2 hold_abstained 61922e2;P3 pipeline 73c4dda;E2E(16 步 Mock 纵向 ×2)5f2410d —— 全部提交入 master
- T22/T24 ✅(纯逻辑)eaee215;事件与 orchestrator 接线 → T19-B
- 测试基线:702 → 758(全量绿)
- 待办:独立审计(子 Agent 429 至 17:26 恢复)→ 补 T19-A/T22/T24 独立审计与复审;T19-B;T18/T26/T23;Golden Set 实现;replay runner;S10 完整演练;T02/T33 真实通道
