# @deepseek-ai/dsh-research-web

科研工作台的双面插件。host 半边刻意惰性(不做任何宿主注册),浏览器半边把 `conversation.view` 槽位的 `research` 标签页挂载为 9 个面板:综述 / 流水线 / 图 / 表 / 路线图 / 闸门 / 对抗 / 审批 / 恢复。

面板由 `panels.ts` 的纯 selector 从一份 run summary 派生,`summary.ts` 是无依赖的视图模型,因此两者无需 Cordis 即可单测。文案经 `client/locales.ts` 的 `zh` / `en` 字典,符合客户端的本地化归属约定。

## Known Limitations and Deferred Work

- **没有真实数据通路**:工作台渲染 `fixture.ts` 中的演示 run,MOCK 徽章如实标注这一点。`loader.ts` 写明将来由 snapshot adapter 替换,而该 adapter 目前不存在。
- 组件**没有注入缝**:`ResearchWorkbench` 在组件体内直接调用 `loadFixtureSummary()`,而下一层的 `ResearchView` 是接受 `summary` prop 的。接真实数据必须改组件源码,而不是配置一个 adapter。
- 审批与恢复两个面板是**显示用占位**:审批按钮只改本地 state(文件内注明不会到达任何网关),恢复按钮重新加载同一份 fixture。真实的人工审批通道 `createHostApprovalChannel` 没有生产调用方。
- 测试覆盖不均衡:9 个标签页的 DOM 测试只点击了 3 个,`panels.ts` 的多数 selector 未被任何测试 import,`src/index.ts` 的 host 半边不被任何测试引用。

No invariant companion is published because the package publishes no runtime invariant entry: its host half is intentionally inert, leaving no companion to publish.
