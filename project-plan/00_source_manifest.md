# 00 源材料清单与版本基线

> 产出方：A1 文档与需求 Agent（只读分析）
> 日期：2026-09-02
> 职责边界：只读核验两份设计文档与 DSH 源码，不改任何源码或设计文档。

---

## 一、输入材料清单

| 序号 | 材料 | 路径 | 版本 | 状态 |
|---|---|---|---|---|
| M1 | AI 科研论文生产系统 · DSH 插件落地方案 | `D:\1\1.科研论文生产系统_DSH插件落地方案_v1.1.md` | v1.1（纳入用户决策确认 2026-09） | 已完整阅读（285 行） |
| M2 | AI 驱动科研论文生产系统 · 系统设计文档 | `D:\1\1.AI科研论文生产系统设计文档_v1.0.md` | v1.0（适用领域：工科，交通 TRC 参照） | 已完整阅读（257 行） |
| M3 | DSH 开发副本源码 | `D:\1\deepseek-harness-master1\deepseek-harness-master` | `@deepseek-ai/dsh-root` **0.1.2-alpha.4**（pre-release） | 已核验 package.json |
| M4 | awesome-dsh-plugin 目录 | `D:\1\awesome-dsh-plugin-main` | 列表活态（2026-09-02 快照） | 已核验 |
| M5 | recon 工作流旁证 | `D:\1\deepseek-harness-master1\deepseek-harness-master\research-prototype\src\engine\`（steps.ts 185 行 / types.ts 74 行） | 纯逻辑 16 步 + Trinity(A/B/C) 引擎 | 已完整核验 |

### M3 / M5 版本基线（源码已验证事实）

| 基线项 | 证据位置 | 验证结论 |
|---|---|---|
| DSH 版本号 | `package.json` `"version": "0.1.2-alpha.4"` | ✅ 确认 pre-release |
| provider `deepseek-official` | `packages/llm/llm-deepseek/lib/index.js:1825` `const PROVIDER = "deepseek-official"`；`packages/llm/llm/tests/topology.spec.ts:110` | ✅ 真实注册的 provider route |
| 模型 `deepseek-v4-flash` / `deepseek-v4-pro` | `packages/llm/token-meter/tests/token-meter.spec.ts:215,372` | ✅ 源码已认知的模型名 |
| agents 配置结构 | `apps/cli/tests/profiles/headless/tests/fixtures/deepseek-defaults.patch.yml`（agent-loop → agents → id:main / provider:deepseek-official / model:deepseek-v4-flash / cwd:process.cwd()） | ✅ 与 v1.1 §2 cordis.yml 结构一致。**注：v1.1 文档误拼为 `deseek-defaults.patch.yml`，实际文件名 `deepseek-`** |
| web 端口默认值 | `packages/bundle/web-app/cordis.patch.yml:121` `port: !!js ctx.webStartup.port ?? 3080` | ✅ 默认 3080，可经 webStartup 改为 1120 |
| defineTool 签名 | `packages/core/tools/src/schema.ts:545` `export function defineTool<...>` | ✅ 确认 |
| tool-agent-team member-scope | `packages/experimental/tool-agent-team/README.zh.md:99`（member scope 上 team:policy 段 + 十个工具 schema） | ✅ 确认 |
| ui-slots 四种 kind | `packages/client/ui-slots/README.zh.md:28` `single/list/keyed/chain` | ✅ 确认 |
| dsh.client 双面声明 | `packages/client/ui-skill/package.json` 嵌套结构 `"dsh":{"client":{"inject":[...],"platform":"web"}}` + `exports["./client"]` | ✅ **确认且 v1.1 §7.1 引用正确**：嵌套 `dsh.client` **且实有 `./client` exports**（types:`./lib/types/client/index.d.ts`、default:`./lib/client.js`，package.json:21-24）。license MIT(:45)。【AUD-01 返工更正：A1 原判"无 ./client exports"误判，已纠正】 |
| clientBundle lazy-CJS | `packages/client/ui-settings-plugins/README.zh.md:96`（lazy-CJS factory + 预设在 `packages/client/tsdown.client.ts`） | ✅ 确认 |
| inspector 骨架 | `packages/experimental/inspector/src/index.ts:52,60,63,74,106`（name/inject/Config/apply/declare module 五件套） | ✅ 确认 |
| inspector source overlay | `packages/experimental/inspector/cordis.source.patch.yml` 存在 | ✅ 确认 |
| DSH_CLIENT_COMMIT_HASH 逃生口 | `scripts/client-build-environment.ts:26` `const CLIENT_COMMIT_HASH_VARIABLE = 'DSH_CLIENT_COMMIT_HASH'` | ✅ 确认（master1 非 git，build 需此 env） |
| code-runtime / e2b 并存 | `packages/code-runtime/`（含 code-runtime-worker-thread）与 `packages/e2b/`（含 fs-e2b/subprocess-e2b）并存 | ✅ 确认本地 worker-thread 可用、e2b 仍在但用户决策不用 |

### M5 recon 引擎旁证（关键设计可行性证据）

| 设计主张 | recon 旁证 | 证据 |
|---|---|---|
| 16 步全流程可建模 | `STEPS` 数组 16 条 StepDefinition，Phase A-E | `steps.ts` |
| Trinity(A/B/C) 每步 gate 可分配 | 每步 `gate: TrinityComponent[]`（A2=['A','C']，C2-trinity-loop=['A','B','C']，E2-submit=[]） | `steps.ts` |
| 仅 2 处人工硬介入 | `humanGate: true` 仅 `E2-submit`（步骤 16）；`domain-direction` 为 A1 的 pre-condition input，非 step | `steps.ts` + `types.ts:StepDefinition.humanGate` 注释 |
| 增量验证非二元对立 | StepStatus = `pending/in_progress/gated/passed/blocked/failed`；gate 不达标可 blocked/failed 回退 | `types.ts:51` |
| 引擎与 Cordis 解耦 | types.ts 头注："No Cordis imports here — portable and unit-testable. Ported into dsh-research-core (wrapped with Cordis three-piece) at P1.6" | `types.ts:3` |

### M4 awesome-dsh-plugin 基线

| 项 | 值 |
|---|---|
| 目录路径 | `D:\1\awesome-dsh-plugin-main` |
| 插件条目数 | README 中约 **2939** 条（grep `^- \[`/`^- \**` 计数；用户口径称 2937，属活态列表正常波动） |
| 数据子目录 | `data/plugins`、`data/added-dates.json`、`data/downloads.json`、`data/stars.json`、`data/screenshots.json` |
| 性质 | curated list，声明"不排名、不判质量，收录标准=可 `dsh plugin add` 安装且描述属实" |

---

## 二、两份文档关系

| 维度 | v1.0 系统设计文档 | v1.1 落地方案 |
|---|---|---|
| 定位 | 方法论与架构蓝图（领域无关偏交通） | DSH 落地工程（绑定用户决策） |
| 落地约束 | 未绑定具体框架 | 锁定 DSH 源码 + 用户决策 |
| 16 步 | §5 详细 6 维设计 | §12 与方法论映射表 |
| 判断三件套 | §4 A/B/C 机制定义 | §5 拆到 core/team/tools |
| 绘图 | §6.1 含 PDF/SVG | §6 按 SVG+PNG 无 PDF（用户决策覆盖） |
| 人介入 | §10.2 仅 2 处 | §0 + §1.1 复用 interaction/ |
| 分阶段 | §7 P1-P6（增量验证路线） | §10 P0-P6（落地交付） |
| 维护声明 | v1.0，迭代原则 | v1.1 基于 v1.0 + 用户决策；DSH pre-release 接口可能 rename，落地前以 extension-cookbook 重核 |

---

## 三、未在本次核验范围内（外部待验证）

- 第三方网关 `ai.ctaigw.cn` 连通性与 base_url 路径级别（v1.1 标注"实测"，属运行期验证，非文档核验）
- Visio ai 绘图 skill 复用项目（v1.1 标注"待搜索确认"，fallback `vsdx` 库）
- L0 白名单数据源（中科院分区表 / CCF 目录）的获取与许可
