# @deepseek-ai/dsh-research-web

[English](README.md) | 中文

科研工作台的双面插件。host 半边刻意惰性(不做任何宿主注册),浏览器半边把 `conversation.view` slot 的 `research` 标签页挂载为 9 个面板:综述 / 流水线 / 图 / 表 / 路线图 / 闸门 / 对抗 / 审批 / 恢复。

面板由 `panels.ts` 的纯 selector 从一份 run summary 派生,`summary.ts` 是无依赖的视图模型,因此两者无需 Cordis 即可单测。文案经 `client/locales.ts` 的 `zh` / `en` 字典,符合客户端的本地化归属约定。

## 已知限制与延期工作

- **真实数据通路已接**:工作台经 `ctx.remote.research.run({})` 启动一次真实运行并渲染它,徽标跟随数据来源。**它不造假 run**:本次会话没跑过时,只显示引导区与运行控件;运行失败时说明原因,屏幕上不留任何 run。原先回落到的那份演示 run 已从 `src/` 移出 —— 现在在 `tests/support/` 下,生产代码 import 不到。
- 组件**有注入缝**:`ResearchWorkbench` 接受 `summary`、`onRun`、`onApprove` 三个 prop(注入摘要、启动运行、提交人工裁决)。`summary` 缺席即"没有跑过",视图如实这么说,而不是补一份进去。
- **人工审批已接通后端**(2026-09-14):`client/approval-source.ts` 经 `ctx.connection.rpc.call('/research-approval', 'decide', ...)` 把裁决送到 `dsh-research-team` 注册的、由宿主做浏览器认证的通道上,面板只渲染后端回传的状态、attempt 与操作者;驳回/失效/传输失败**如实报错**并让该步留在待审。`onApprove` 缺席时(部署没有浏览器认证通道)两个按钮**禁用**并说明原因,而不是显示一个没人做过的决定。
- 恢复面板**只读,并写明原因**:本部署没有开放"从快照恢复"的入口,所以这一页只报当前屏幕上的 run,不提供任何动作。它此前有一个"从快照恢复"按钮,处理函数加载的是那份演示 run —— 看起来像恢复,实际是把读者正在看的 run 换成了编造的数据。
- **测试覆盖已补齐**(B5):9 个标签页全部被点击,`panels.ts` 的 selector 全部被 import;`src/index.ts` 的 host 半边是刻意的空体(视图由 client 半边挂载),因此无测试引用它。

不发布不变式伴生入口,因为本包不发布任何运行时不变式条目:它的宿主半边刻意惰性,没有可发布的伴生对象。

- **运行接线已是 Runtime-verified**(2026-09-15)。研究标签页启动真实运行 —— `ctx.remote.research.run({})` → `run-source.ts` 映射 → `ResearchWorkbench` 渲染 —— 并已被一个独立浏览器探针对着运行中的 Host(1120 端口)驱动过,断言对着后端自己的记录(`.workbuddy/tmp/verify-browser-b.mjs`,30/30)。这里此前写"没有任何浏览器驱动过",写下时是真的,现在不再是。
- **审批面板同样只是 Integration-verified**:它的提交器由 jsdom spec 对着一个 mock 的 Connection 服务覆盖,`dsh-research-team/tests/approval.spec.ts` 覆盖后端核对与 §8.1 各条不变量;真实 socket 上验过的是**通道本身**(无 cookie → 401 且处理器不被调用,令牌换 cookie → 200 并写入后端记录,伪造 cookie → 401),不是浏览器里的这一次点击。
- **`summary` 的载荷形状是本包声明的结构孪生**。服务在 Host 面编译、本包在 Client 面,而客户端 bundle 不取跨插件值依赖,所以 `run-source.ts` 里的 `WireRunSnapshot` 是**复述**而不是导入。两边字段名不一致会让视图静默变空。Host 侧的集成 spec 断言的正是同一组字段名。
- **MOCK 徽标跟随数据来源**(`summary.isMock`),而且已**没有任何生产路径**会产出 fixture 来源的摘要:`run-source.ts` 映射出来的 run 一律标 `live`。因此该徽标只对"注入一份 fixture 摘要的宿主"可达,今天就是那些 spec。
