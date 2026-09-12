# 04 开源复用候选调研（A3）

> 范围：DSH（Node/TS 宿主）§十四 七个明确能力缺口的开源复用候选 + 用户已下载社区插件目录（`D:\1\awesome-dsh-plugin-main`，2937 条 yml）筛选。
> 方法：Bash/Python 枚举 category 分布与关键词过滤；外部 OSS 用 WebSearch 核验 GitHub 地址/许可证；github.com WebFetch 被网络策略阻断，仓库 commit/release/issue 精确日期标为「待 web 核验」。
> 结论格式：项目名｜GitHub 地址｜能力缺口｜官方/社区｜最近提交｜最近 Release｜活跃 Issue｜许可证｜技术栈｜与 Node/TS/DSH 适配性｜直接依赖数｜二次封装成本｜维护者集中度｜安全供应链风险｜推荐结论

---

## 0. 社区插件目录枚举（基线事实）

- 总插件数：2937（`data/plugins/*.yml`，Python glob 得 2936，含 1 条非 yml 偏差，以用户声明 2937 为准）
- yml 字段：`url / name / category / tarball(部分) / description.en+zh`
- category 分布（22 类，降序）：

| category | 数量 | category | 数量 |
|---|---|---|---|
| ui | 476 | security | 100 |
| tools | 378 | fun | 96 |
| dev | 239 | vision | 95 |
| session | 185 | remote | 79 |
| workflow | 173 | git | 71 |
| usage | 163 | market | 70 |
| memory | 136 | browser | 70 |
| skill | 125 | voice | 46 |
| notify | 122 | docs | 44 |
| model | 120 | wsl | 33 |
| theme | 105 | identity | 9 |
| | | agi | 1 |

- 关键词过滤命中量（去重前）：文献检索 462、引文核验 91、LLM 评测 40、可复现 26、科研图表 151、Visio/矢量 155、可观测性 235。关键词「review/research/chart/trace/figure」匹配过宽，下文仅取强信号候选。

---

## 1. 缺口—项目映射（外部 OSS + DSH 社区插件）

> **v1.1 更正**：下表 GitHub 项目（OSS + DSH 社区插件，许可证/活跃度均**未 web 核验**）一律标**候选**，核验前**不得写入正式依赖 manifest**；仅开放数据 API（Crossref/OpenAlex/arXiv/Semantic Scholar/Retraction Watch/OpenCitations）标**直接复用**。

### 缺口 A｜文献检索与综述
**外部 OSS**
| 项目名 | GitHub 地址 | 类型 | 许可证 | 技术栈 | Node/TS 适配 | 推荐结论 |
|---|---|---|---|---|---|---|
| paper-qa (PaperQA2) | https://github.com/Future-House/paper-qa | 官方(科研机构) | 待核验(科研仓，偏 Apache/MIT 系) | Python，高精度科学文献 RAG | 低(纯 Python) | 适配层复用(subprocess)或仅参考其 RAG 流程在 TS 重实现 |
| gpt-researcher | https://github.com/assafelovic/gpt-researcher | 官方 | 待核验 | Python，自主研究 agent，暴露 HTTP API(gptr.dev) | 中(HTTP API 可被 Node 直调) | 适配层复用(走其 HTTP API) |
| Crossref REST API | https://www.crossref.org/services/metadata-delivery/rest-api/ | 官方(非营利) | 开放元数据(无 copyleft) | REST | 高(原生 fetch) | 直接复用(REST 直调) |
| OpenAlex API | https://docs.openalex.org/ | 官方 | 开放数据 CC0 | REST | 高 | 直接复用 |
| arXiv API | https://arxiv.org/help/api/index | 官方 | 开放 | REST | 高 | 直接复用 |
| Semantic Scholar Graph API | https://github.com/allenai/scholar-reader (API 在 api.semanticscholar.org) | 官方(AllenAI) | 待核验 | REST | 高 | 直接复用(API) |

**DSH 社区插件（已读 yml，仓库活跃度/许可证待 web 核验）**
| 项目名 | GitHub 地址 | 类型 | 能力 | 推荐结论 |
|---|---|---|---|---|
| Aik358/dsh-literature | https://github.com/Aik358/dsh-literature | 社区 | Unpaywall/arXiv 全文 PDF + Crossref 宽松检索 + APA/GB-T7714/MLA/Chicago 引用 + 侧窗 PDF 阅读器 + AI 问答 | 候选(覆盖面最广，原生 DSH) |
| Flan246/dsh-lit-search | https://github.com/Flan246/dsh-lit-search | 社区 | Crossref+OpenAlex 检索(无 API key) + GB/T7714/APA/BibTeX | 候选(无 key、轻量，与 Aik358 互补) |
| 863683348/dsh-plugin-academic-writing | https://github.com/863683348/dsh-plugin-academic-writing | 社区 | 学术写作工具包(大纲/摘要/引用/措辞质检) | 仅参考设计(写作侧，非检索) |
| dsh-research/dsh-research | https://github.com/dsh-research/dsh-research | 社区 | 精选科研插件市场(逐个审读代码+钉版) | 仅参考设计(分发机制，可借鉴其审读门禁) |

### 缺口 B｜引文及撤稿核验
**外部 OSS / 数据源**
| 项目名 | 地址 | 类型 | 许可证 | 能力 | 推荐结论 |
|---|---|---|---|---|---|
| Crossref + Retraction Watch | https://www.crossref.org/documentation/retrieve-metadata/retraction-watch/ | 官方 | 开放元数据 | Retraction Watch 撤稿数据已并入 Crossref API(update-to-date 标志位) | 直接复用(撤稿核验首选数据源，REST) |
| OpenCitations | https://opencitations.net/ (github.com/opencitations) | 官方(学术) | CC0/开放 | 开放引用图(引用关系核验) | 直接复用(REST) |

**DSH 社区插件**
| 项目名 | GitHub 地址 | 能力 | 推荐结论 |
|---|---|---|---|
| Flan246/dsh-latex-guard | https://github.com/Flan246/dsh-latex-guard | BibTeX 去重 + Crossref 字段补全 + \cite 键审计 | 候选(引文一致性核验，与 dsh-lit-search 同作者，可组合) |
| Hongcheng-LI/dsh-zotero | https://github.com/Hongcheng-LI/dsh-zotero | Zotero 本地 API(无 key)读元数据/全文/笔记 | 适配层复用(面向 Zotero 用户，非通用引文核验) |
| Aik358/dsh-literature | (见上) | 含引用生成(多格式) | 候选(引用生成侧) |

> 撤稿「核验」专项缺原生 DSH 插件：建议以 Crossref Retraction Watch API + dsh-lit-search/dsh-latex-guard 组合补齐，封装成本中。

### 缺口 C｜科研 Golden Set 和 LLM 评测
**外部 OSS**
| 项目名 | GitHub 地址 | 类型 | 许可证 | 技术栈 | Node/TS 适配 | 推荐结论 |
|---|---|---|---|---|---|---|
| promptfoo | https://github.com/promptfoo/promptfoo | 官方 | MIT | Node/TypeScript，NPM 包，LLM eval + red teaming | 高(原生 TS) | 候选(DSH 评测首选，CI 友好，已有 GitHub Action 集成) |
| lm-evaluation-harness | https://github.com/EleutherAI/lm-evaluation-harness | 官方(社区标杆) | MIT(见 LICENSE.md) | Python，标准化基准任务集(MMLU/HellaSwag 等) | 低(Python) | 仅参考设计(Golden Set 任务规范)，运行走 promptfoo |
| OpenCompass | https://github.com/open-compass/opencompass | 官方(上海AI实验室) | Apache 2.0 | Python，多模型评测平台 + LLM-as-Judge | 低(Python) | 仅参考设计(评测维度/榜单设计) |

**DSH 社区插件**
| 项目名 | GitHub 地址 | 能力 | 推荐结论 |
|---|---|---|---|
| BiBoyang/dsh-eval-harness | https://github.com/BiBoyang/dsh-eval-harness | YAML 用例驱动 headless agent + 断言工具调用/参数/返回/token + baseline CI 门禁 | 候选(DSH 原生评测框架，与 promptfoo 互补：promptfoo 评 prompt/model，本插件评 DSH agent 行为) |
| pengxuding/dsh-plugin-judge | https://github.com/pengxuding/dsh-plugin-judge | 源码静态扫描 + LLM 裁判(装前/装后) | 仅参考设计(插件价值审计，非 LLM golden set) |
| PerryLink/dsh-score | https://github.com/PerryLink/dsh-score | 五维质量评分 + 排行榜 | 仅参考设计(插件质量，非模型评测) |
| zoahdev/dsh-quality-score | https://github.com/zoahdev/dsh-quality-score | 0-100 评分卡 + 六项 + 修复建议 | 仅参考设计(同上) |

### 缺口 D｜数据与实验可复现管理
**外部 OSS**
| 项目名 | GitHub 地址 | 类型 | 许可证 | 技术栈 | Node/TS 适配 | 推荐结论 |
|---|---|---|---|---|---|---|
| DVC | https://github.com/iterative/dvc | 官方(iterative) | Apache 2.0 | Python CLI，数据/模型版本化 | 中(CLI subprocess) | 适配层复用(数据版本化走 CLI) |
| MLflow | https://github.com/mlflow/mlflow | 官方 | Apache 2.0 | Python(服务端) + 多语言 client(含 JS/REST) | 中(tracking server REST 可被 Node 调) | 适配层复用(tracking 走 REST，自托管 server) |

**DSH 社区插件**
| 项目名 | GitHub 地址 | 能力 | 推荐结论 |
|---|---|---|---|
| poplarity/dsh-science-workbench | https://github.com/poplarity/dsh-science-workbench | 可复现科学工作台：agent 驱动 cell + 内联图重画 + manifest 溯源 + 环境快照 + 出版级出图(9 个 bio_* 工具) | 候选(DSH 内最贴合「可复现+科研图表」的工作台，原生) |
| JimchengChina/dsh-frontier-repro | https://github.com/JimchengChina/dsh-frontier-repro | arXiv/实验室/官方产物聚合为版本化证据包 + claim 级复现门禁 | 适配层复用(复现门禁逻辑可借鉴，偏前沿论文复现) |
| Harzva/dsh-uvm | https://github.com/Harzva/dsh-uvm | uv 环境管理器(Python venv 创建/同步/运行 + pip 回退 + conda 只读) | 适配层复用(环境可复现的 Python 侧基础设施) |
| EvilIrving/dsh-repro | https://github.com/EvilIrving/dsh-repro | 导出去 secret 的最小可复现问题包(会话日志+失败命令+git diff) | 仅参考设计(偏 bug 复现，非科研复现) |
| hackerFish/dsh-lab | https://github.com/hackerFish/dsh-lab | 隔离环境真机过四关 + 公开复现命令 | 仅参考设计(插件测评实验室) |

### 缺口 E｜SciencePlots 和科研图表
**外部 OSS**
| 项目名 | GitHub 地址 | 类型 | 许可证 | 技术栈 | Node/TS 适配 | 推荐结论 |
|---|---|---|---|---|---|---|
| SciencePlots | https://github.com/garrettj403/SciencePlots | 官方(社区) | MIT | Python，matplotlib 样式表(IEEE/Nature/Science 风格) | 低(纯 Python+matplotlib) | 适配层复用(subprocess 生成图)或仅参考其样式 token 在 TS 图库复刻 |

**DSH 社区插件**
| 项目名 | GitHub 地址 | 能力 | 推荐结论 |
|---|---|---|---|
| poplarity/dsh-science-workbench | (见缺口 D) | 含出版级出图技能 + 内联图反馈重画 | 候选(已集成出图能力) |
| (无原生 SciencePlots 封装插件) | — | — | 建议以 SciencePlots(subprocess) 或 TS 图库(plotly/uplot.js)补齐 |

> Node/TS 侧科研图表无成熟 SciencePlots 等价物：若要纯 TS，参考 SciencePlots 样式 token 在 plotly/visx 复刻；若可接受 Python，subprocess 调 matplotlib+SciencePlots 最快。

### 缺口 F｜Visio/VSDX/矢量技术路线图
**外部 OSS**
| 项目名 | GitHub 地址 | 类型 | 许可证 | 技术栈 | Node/TS 适配 | 推荐结论 |
|---|---|---|---|---|---|---|
| mermaid | https://github.com/mermaid-js/mermaid | 官方 | MIT | JavaScript，文生图(流程/路线/时序)，离线可渲染 | 高(原生 JS) | 候选(矢量技术路线图首选，DSH 已有 4 个 mermaid 插件) |
| drawio (diagrams.net) | https://github.com/jgraph/drawio | 官方 | Apache 2.0 | JavaScript，客户端编辑器 + drawio-desktop(Electron) | 高(原生 JS) | 候选(交互式矢量编辑，可嵌入) |
| excalidraw | https://github.com/excalidraw/excalidraw | 官方 | MIT | TypeScript/React，NPM 包 @excalidraw/excalidraw，手绘风 | 高(原生 TS) | 候选(草稿风路线图/白板，组件可嵌) |
| vsdx (dave-howard) | https://github.com/dave-howard/vsdx | 社区 | MIT(见 setup.py) | Python，.vsdx 解析/编辑 | 低(Python) | 适配层复用(VSDX 导入导出走 subprocess；纯 TS 解析 vsdx 需自研，成本高) |

**DSH 社区插件（均为 mermaid 渲染，已验证 yml）**
| 项目名 | GitHub 地址 | 能力 | 推荐结论 |
|---|---|---|---|
| genius-alray/dsh-mermaid-render | https://github.com/genius-alray/dsh-mermaid-render | mermaid→可交互卡片(缩放/全屏/预览代码切换)，复用官方原语 | 候选(交互最完整) |
| gitByteFree/dsh-mermaid-smooth | https://github.com/gitByteFree/dsh-mermaid-smooth | 离线打包渲染引擎 + 丝滑缩放 + localStorage 切换 + 暗黑跟随 | 候选(离线优先，DSH 内置合适) |
| AKS1st/dsh-mermaid | https://github.com/AKS1st/dsh-mermaid | 惰性加载 SVG + 严格消毒 + 主题跟随 | 候选(最轻量) |
| baconbao/dsh-mermaid-image-preview | https://github.com/baconbao/dsh-mermaid-image-preview | 本地渲染图预览 + 外部渲染服务器 | 仅参考设计(图片预览，矢量保真不如 SVG) |

> VSDX「读写」缺口无原生 DSH/TS 方案：vsdx(Python) subprocess 处理导入导出；矢量「生成/渲染」走 mermaid/drawio/excalidraw(均原生 TS/JS，候选，许可证待 web 核验)。

### 缺口 G｜Prompt/Agent/RAG 可观测性
**外部 OSS**
| 项目名 | GitHub 地址 | 类型 | 许可证 | 技术栈 | Node/TS 适配 | 推荐结论 |
|---|---|---|---|---|---|---|
| Langfuse + langfuse-js | https://github.com/langfuse/langfuse (SDK: https://github.com/langfuse/langfuse-js) | 官方 | MIT(核心) + EE(企业特性) | 多语言，官方 JS/TS SDK，自托管 | 高(原生 JS SDK) | 候选(DSH 可观测性首选：trace 树/prompt 版本/评测，自托管可控) |
| OpenLLMetry (openllmetry-js) | https://github.com/traceloop/openllmetry (JS: https://github.com/traceloop/openllmetry-js) | 官方 | Apache 2.0 | OpenTelemetry 规范，多语言 + JS sister 项目 | 高(有 JS SDK) | 候选(OTel 标准化追踪，与 Langfuse 互补) |
| Helicone | https://github.com/Helicone/helicone | 官方 | AGPL-3.0 | TypeScript，一行集成网关 | 中(TS 原生) | 不建议采用(AGPL 网络传染条款，嵌入产品有合规风险) |
| Arize Phoenix | https://github.com/Arize-ai/phoenix | 官方 | Elastic License 2.0(ELv2，非 OSI 开源) | Python | 低(Python)+许可证受限 | 不建议采用(ELv2 禁止托管化/移除 license key，非 OSI，合规风险) |

**DSH 社区插件**
| 项目名 | GitHub 地址 | 能力 | 推荐结论 |
|---|---|---|---|
| FlySnailY/dsh-langfuse-plus | https://github.com/FlySnailY/dsh-langfuse-plus | Langfuse 可观测性：会话轮次→trace 树(session id 聚合) + prompt 版本管理 + 评测 | 候选(DSH 原生 Langfuse 封装，与外部 Langfuse JS SDK 配套) |
| 030611/dsh-telemetry-redactor | https://github.com/030611/dsh-telemetry-redactor | session-telemetry 导出副本脱敏(在遥测后端接收前) | 候选(可观测性前置脱敏，安全侧必备) |
| Cavan-Ou/dsh-observation-journal | https://github.com/Cavan-Ou/dsh-observation-journal | 零侵入运行遥测：每会话写任务/模型档/工具/失败/时长/状态 + 统计(纯观察者) | 候选(轻量事实日志，与 Langfuse trace 互补) |
| BrambleXu/dsh-prompt-profile | https://github.com/BrambleXu/dsh-prompt-profile | 可复用 Markdown Prompt Profile + 单轮模型选择 + 参数替换 + 状态恢复 | 仅参考设计(prompt 管理，非可观测性) |

---

## 2. 推荐复用清单（候选 + 开放数据直接复用，合并视图）

> **v1.1 更正**：本表 GitHub 项目（OSS + DSH 社区插件）许可证/活跃度均**未 web 核验**（github.com 被网络策略阻断，见 §3），一律标**候选**，核验完成前**不得写入正式依赖 manifest**；仅 Crossref/OpenAlex/arXiv/Semantic Scholar/OpenCitations（开放数据，地址已确认）可直接复用。下表"复用形态"列描述技术适配形态，非正式依赖准入。

> 判定标准：许可证兼容(MIT/Apache2.0/开放)**且经 web 核验** + Node/TS 原生或已有 DSH 插件封装 + 二次封装成本低。未 web 核验许可证/活跃度的 GitHub 项目标**候选**，不进正式依赖（AUD-03）。

| # | 项目 | 缺口 | 来源 | 复用形态 |
|---|---|---|---|---|
| 1 | mermaid (mermaid-js) | F 矢量路线图 | OSS | npm 直接依赖，JS 原生 |
| 2 | excalidraw | F 矢量路线图 | OSS | npm @excalidraw/excalidraw，TS 原生组件 |
| 3 | drawio (jgraph) | F 矢量路线图 | OSS | JS 原生，嵌入或 drawio-desktop |
| 4 | promptfoo | C LLM 评测 | OSS | npm 原生，CI eval + red team |
| 5 | Langfuse (langfuse-js) | G 可观测性 | OSS | JS SDK 直接接入，自托管 |
| 6 | OpenLLMetry (openllmetry-js) | G 可观测性 | OSS | OTel JS SDK |
| 7 | Crossref REST API(含 Retraction Watch) | A+B 检索/撤稿 | 数据源 | REST 直调 |
| 8 | OpenAlex / arXiv / Semantic Scholar API | A 检索 | 数据源 | REST 直调 |
| 9 | Aik358/dsh-literature | A 文献检索 | DSH 插件 | 原生 DSH，全文+检索+引用+PDF 阅读器 |
| 10 | Flan246/dsh-lit-search | A 检索 | DSH 插件 | 原生 DSH，无 key 检索 |
| 11 | Flan246/dsh-latex-guard | B 引文核验 | DSH 插件 | 原生 DSH，BibTeX 审计 |
| 12 | BiBoyang/dsh-eval-harness | C 评测 | DSH 插件 | 原生 DSH，YAML agent 评测 |
| 13 | poplarity/dsh-science-workbench | D+E 可复现+图表 | DSH 插件 | 原生 DSH，cell+溯源+出图 |
| 14 | Harzva/dsh-uvm | D 环境可复现 | DSH 插件 | 原生 DSH，uv venv 管理 |
| 15 | genius-alray/dsh-mermaid-render + gitByteFree/dsh-mermaid-smooth | F 矢量 | DSH 插件 | 原生 DSH mermaid 渲染 |
| 16 | FlySnailY/dsh-langfuse-plus | G 可观测性 | DSH 插件 | 原生 DSH Langfuse 封装 |
| 17 | 030611/dsh-telemetry-redactor | G 可观测性安全 | DSH 插件 | 原生 DSH 遥测脱敏 |
| 18 | Cavan-Ou/dsh-observation-journal | G 可观测性 | DSH 插件 | 原生 DSH 运行事实日志 |

### 适配层复用清单（Python/服务，需 subprocess 或 HTTP 桥接）
- DVC、MLflow(tracking REST)、paper-qa(subprocess)、SciencePlots(subprocess)、vsdx(subprocess，VSDX 读写)、lm-evaluation-harness/OpenCompass(仅参考设计，运行走 promptfoo)

### 不建议采用
- Arize Phoenix：ELv2 非 OSI，合规受限
- Helicone：AGPL-3.0 网络传染，嵌入产品有风险

---

## 3. 待 web 核验项（github.com 被网络策略阻断，未能直取精确日期）

> 以下需在可访问 github.com 的环境补取：最近提交日期、最近 Release 版本/日期、open issue 数、contributor 数、star 数、确证 LICENSE 文件文本。

**外部 OSS（地址已 WebSearch 确认存在，活动/许可证精确值待核验）**
1. https://github.com/Future-House/paper-qa — 许可证待确证（疑似 Apache/MIT 系）、近期 Release
2. https://github.com/assafelovic/gpt-researcher — 许可证待确证、HTTP API 鉴权方式
3. https://github.com/EleutherAI/lm-evaluation-harness — LICENSE.md 确为 MIT（搜索已见），但 Release 版本/日期待核
4. https://github.com/open-compass/opencompass — Apache 2.0 待确证 LICENSE、Release
5. https://github.com/iterative/dvc — Apache 2.0 待确证、Release
6. https://github.com/mlflow/mlflow — Apache 2.0 待确证、Release
7. https://github.com/garrettj403/SciencePlots — MIT 待确证 LICENSE、Release（PyPI 见 1.0.2）
8. https://github.com/mermaid-js/mermaid — MIT（见 develop/LICENSE）、Release 版本待核
9. https://github.com/jgraph/drawio — Apache 2.0 待确证 LICENSE、drawio-desktop Release
10. https://github.com/excalidraw/excalidraw — MIT 待确证、Release（v18 相关 issue 见）
11. https://github.com/dave-howard/vsdx — MIT 待确证 LICENSE
12. https://github.com/langfuse/langfuse + langfuse-js — MIT 核心 + EE 边界待厘清（自托管 OSS 用法讨论 #13737/#13848 见）
13. https://github.com/traceloop/openllmetry + openllmetry-js — Apache 2.0 待确证
14. https://github.com/promptfoo/promptfoo — MIT 待确证、Release
15. https://github.com/Arize-ai/phoenix — 已确证 ELv2（非 OSI）；待核 Release/issue 活跃度
16. https://github.com/Helicone/helicone — 已确证 AGPL-3.0；待核 Release

**DSH 社区插件（yml 已读得声明 url，仓库真实存在性/活动度/许可证待逐个 web 核验）**
- Aik358/dsh-literature、Flan246/dsh-lit-search、Flan246/dsh-latex-guard、Hongcheng-LI/dsh-zotero、863683348/dsh-plugin-academic-writing、BiBoyang/dsh-eval-harness、poplarity/dsh-science-workbench、JimchengChina/dsh-frontier-repro、Harzva/dsh-uvm、FlySnailY/dsh-langfuse-plus、030611/dsh-telemetry-redactor、Cavan-Ou/dsh-observation-journal、genius-alray/dsh-mermaid-render、gitByteFree/dsh-mermaid-smooth、AKS1st/dsh-mermaid、ChenYiming-aaa/dsh-ui-ux-pro-max
- 核验要点：仓库是否存在（非 404）、最近提交、是否有 LICENSE 文件及类型、是否发布 npm tarball（yml 中 tarball 字段）、维护者是否单人集中

---

## 4. ui-ux-pro-max 适配分析

### 4.1 本体核验（已 Read）
- 路径：`D:\1\awesome-dsh-plugin-main\.agents\skills\ui-ux-pro-max`
- 入口：`scripts/search.py`（BM25 CSV 搜索，CLI：`--domain / --stack / --design-system / --persist`）
- 依赖：`core.py / design_system.py / reasoning_contract.py / validate_data.py / search.py`，**纯 Python 标准库（argparse/json/sys/io），零外部依赖**
- 数据：`data/` 下 17 个 CSV/JSON（styles 79、colors、charts 25、typography、google-fonts 747KB、phosphor-icons 823KB、ui-reasoning、ux-guidelines 119、products、landing、motion、react-performance、app-interface 等）+ `references/` quick-reference.md / pro-rules.md
- 契约：`reasoning_contract.py` 为「封闭、不可执行的设计决策语法」（if_booking/if_dashboard 等条件信号→规则）
- 输出：token 优化格式供 LLM 消费；`--design-system` 支持 ascii/markdown/json + `--persist` 写 MASTER.md + page overrides

### 4.2 已有 DSH 插件封装
- `ChenYiming-aaa/dsh-ui-ux-pro-max`（https://github.com/ChenYiming-aaa/dsh-ui-ux-pro-max）：已将本 skill 封装为 DSH 插件，提供 `design_recommend / design_review / design_search` 三工具，宣称「离线优先、零运行依赖、中文优先」。
- 即：**ui-ux-pro-max 在 DSH 宿主中已有可直接安装的插件形态**，无需从零二次封装。

### 4.3 与 Node/TS/DSH 适配性
- 适配度高。运行模型为「Python 子进程 + stdin/stdout JSON」——DSH(Node/TS) 可经 `child_process.spawn` 调 `search.py`，零网络、零 npm 依赖、数据全本地。
- 替代路径（纯 TS 重写）：CSV 为纯文本，可在 TS 端直接解析 + 实现 BM25（成本中，约 1-2 人周），换取免除 Python 运行时依赖；但会失去 `design_system.py` 的聚合推理与 `reasoning_contract.py` 的规则引擎，得不偿失。
- 建议：**候选优先 `ChenYiming-aaa/dsh-ui-ux-pro-max`**（包装插件许可证待 web 核验，核验前不进正式依赖，v1.1 更正）；若需更深集成（如 DSH 设置面板内联设计系统生成），以「TS 包装层 spawn search.py + 解析 JSON」做适配层，保留 Python 推理核心。

### 4.4 与缺口的关系
- ui-ux-pro-max 属「UI/UX 设计智能」能力，**不直接对应 §十四 任一科研缺口**，但其 `charts.csv`(25 图表类型) 与缺口 E(科研图表) 的「图表选型」有弱关联，`data-provenance.json` 与缺口 D(溯源) 设计可互鉴。
- 结论：作为 DSH 宿主的横向 UI/UX 增能件**候选**（许可证待 web 核验，核验前不进正式依赖，v1.1 更正），不纳入科研缺口项目表，但在缺口 E 图表选型时可调用其 `--domain chart` 输出。

### 4.5 安全/供应链
- 零外部依赖 → 供应链风险极低；唯一外部数据是 google-fonts(747KB) 与 phosphor-icons(823KB) 的上游 JSON，属静态参考资料，无运行时加载。`google-font-licenses.json`(433KB) 已内嵌字体许可证信息，合规可追溯。

---

## 5. 跨缺口缺口补齐建议（信息不足暂不决策项）

1. **撤稿核验原生 DSH 插件缺失**：缺口 B 仅有数据源(Crossref RW)+引文审计插件(dsh-latex-guard)，无端到端「输入引文列表→输出撤稿状态」的 DSH 原生插件。建议以 Crossref API + dsh-lit-search 组合自研薄封装，或等待社区插件。**信息不足暂不决策**（取决于 DSH 是否纳入科研合规流）。
2. **SciencePlots 的 TS 等价物**：缺口 E 纯 TS 科研图表风格库不存在成熟方案，需在「subprocess Python」与「TS 复刻样式 token」间决策。**信息不足暂不决策**（取决于 DSH 是否允许 Python 子进程运行时）。
3. **VSDX 纯 TS 解析**：缺口 F 的 vsdx 读写无 TS 原生库，vsdx(Python) 是唯一成熟方案。若 DSH 强约束纯 TS，则 VSDX 导入导出需自研(XML/zip 解包)，成本高。**信息不足暂不决策**（取决于 Visio A/B 决策，见现有任务 #3）。

---

## 附：本次 WebSearch 已核验地址清单（真实存在）
mermaid-js/mermaid · jgraph/drawio(+drawio-desktop) · excalidraw/excalidraw · promptfoo/promptfoo · EleutherAI/lm-evaluation-harness · open-compass/opencompass · iterative/dvc · mlflow/mlflow · garrettj403/SciencePlots · dave-howard/vsdx · langfuse/langfuse(+langfuse-js) · traceloop/openllmetry(+openllmetry-js) · Helicone/helicone · Arize-ai/phoenix(ELv2) · Future-House/paper-qa · assafelovic/gpt-researcher · Crossref Retraction Watch API · OpenAlex API · arXiv API · Semantic Scholar API · OpenCitations
