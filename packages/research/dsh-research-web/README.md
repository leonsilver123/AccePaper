# @deepseek-ai/dsh-research-web

科研工作台的双面插件。host 半边刻意惰性(不做任何宿主注册),浏览器半边把 `conversation.view` 槽位的 `research` 标签页挂载为 9 个面板:综述 / 流水线 / 图 / 表 / 路线图 / 闸门 / 对抗 / 审批 / 恢复。

面板由 `panels.ts` 的纯 selector 从一份 run summary 派生,`summary.ts` 是无依赖的视图模型,因此两者无需 Cordis 即可单测。文案经 `client/locales.ts` 的 `zh` / `en` 字典,符合客户端的本地化归属约定。

## Known Limitations and Deferred Work

- **真实数据通路已接**(2026-09-14):工作台可经 `ctx.remote.research.run({})` 启动一次真实运行并渲染它,徽标跟随数据来源。默认(未点运行、或运行失败)仍是 `fixture.ts` 的演示 run —— 失败会如实报错,不会把 fixture 留在屏幕上冒充结果。
- 组件**已有注入缝**:`ResearchWorkbench` 接受 `summary`、`onRun`、`onApprove` 三个 prop(注入摘要、启动运行、提交人工裁决),只有在 `summary` 与 `onRun` 都缺席时才回落到 `loadFixtureSummary()`。
- **人工审批已接通后端**(2026-09-14):`client/approval-source.ts` 经 `ctx.connection.rpc.call('/research-approval', 'decide', ...)` 把裁决送到 `dsh-research-team` 注册的、由宿主做浏览器认证的通道上,面板只渲染后端回传的状态、attempt 与操作者;驳回/失效/传输失败**如实报错**并让该步留在待审。`onApprove` 缺席时(部署没有浏览器认证通道)两个按钮**禁用**并说明原因,而不是显示一个没人做过的决定。
- 恢复面板仍是**显示用占位**:按钮重新加载同一份 fixture。
- **测试覆盖已补齐**(B5):9 个标签页全部被点击,`panels.ts` 的 selector 全部被 import;`src/index.ts` 的 host 半边是刻意的空体(视图由 client 半边挂载),因此无测试引用它。

No invariant companion is published because the package publishes no runtime invariant entry: its host half is intentionally inert, leaving no companion to publish.

- **运行接线已完成,但未经浏览器实跑验证**(2026-09-14)。研究标签页现在可以启动真实运行:`ctx.remote.research.run({})` → `run-source.ts` 映射 → `ResearchWorkbench` 渲染。Host 半边由挂载真实服务的 spec 覆盖,客户端半边由针对打桩 namespace 的 jsdom spec 覆盖,两个 typecheck 面与两次构建通过,1120 boot 加载成功。**没有任何浏览器对着运行中的 Host 驱动过这个标签页** —— 这是 Designed → Integration-verified 与 Runtime-verified 之间的那道坎,没有被跨过。
- **审批面板同样只是 Integration-verified**:它的提交器由 jsdom spec 对着一个打桩的 Connection 服务覆盖,`dsh-research-team/tests/approval.spec.ts` 覆盖后端核对与 §8.1 各条不变量;真实 socket 上验过的是**通道本身**(无 cookie → 401 且处理器不被调用,令牌换 cookie → 200 并写入后端记录,伪造 cookie → 401),不是浏览器里的这一次点击。
- **`summary` 的载荷形状是本包声明的结构孪生**。服务在 Host 面编译、本包在 Client 面,而客户端 bundle 不取跨插件值依赖,所以 `run-source.ts` 里的 `WireRunSnapshot` 是**复述**而不是导入。两边字段名不一致会让视图静默变空。Host 侧的集成 spec 断言的正是同一组字段名。
- **MOCK 徽标现在跟随数据来源**(`summary.isMock`)。它此前是无条件的,所以即使注入了真实运行也仍标"演示数据";`RunSummary.isMock` 也从一个字面量 `true` 变成了推导值。
