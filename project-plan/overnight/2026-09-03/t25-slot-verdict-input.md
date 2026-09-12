# T25(P4.1) Slot 裁决输入报告

> 只读侦察，仓库零改动。核验对象：deepseek-harness-master。日期 2026-09-03。
> F-W6 裁决输入，供 J1/用户拍板 U3；P4(T27/T28/T29) 注册依据。

## (a) 真实 slot 清单与出处（声明=SlotMap 合并；存在=运行时 register children 声明）

机制：`SlotMap{}` 空表 + 各包 `declare module '@deepseek-ai/dsh-client-ui-slots'` 合并（ui-slots/src/index.ts:26）；kind/scope 轴：index.ts:90-93；**运行时声明权=父 entry 的 register() children 表**（index.ts:856-863 重复声明抛错；819-822 未声明即注册抛错）。影子语义：index.ts:749-755（优先级/同 cell 双注册抛错）。

| slot | kind/scope | 源码位置 |
|---|---|---|
| root（内建） | single/root | ui-slots/src/index.ts:731-735 |
| sidebar/conversation/details/shell.overlay | single/root; single/session-maybe; single/session; list/root | ui-layout/src/client/index.ts:37-88（SlotMap）；**:123-141**（AppFrame register children，root 唯一父声明） |
| conversation.session / .session.header / .view / .composer(chain) / .input.dock / .composer.dock / 各 input.* / hero.* | session 为主 | ui-conversation/src/client/contract/slots.ts:93-148（SlotMap）；apply.ts:197-234、236-250（children 声明）；conversation.view 渲染 ConversationSession.tsx:189-193 |
| conversation.chat.node / .message.images / .chat.commandview / .chat.turnTail(chain) / .chat.assistant-actions / .details.tool | keyed/single/chain/list | ui-chat/src/client/contract/slots.ts:184-228（SlotMap）；apply.ts:94-153（chat view 注册）、163-169（details 注册声明 details.tool） |
| conversation.approval.detail | single/session | ui-approval/src/client/contract/slots.ts:35-43 |
| conversation.trajectory.images | single/session | ui-trajectory/src/client/trajectory-contract.ts:88-96 |
| tool.call.toolview | keyed/session | ui-tool/src/client/contract/slots.ts:10-28 |
| settings.*/sidebar.*/tool.view.cordis 等 | — | 与科研工具无关，略 |

**已核验事实**：`conversation.view` ✅ 存在（list/session，聊天=id 'chat' order0、轨迹=id 'trajectory' order10 已占用；一次仅渲染 active view）；`details` ✅ 存在但 **single 且已被 ui-chat DetailsPanel 占用**；`conversation.details` ❌（仅有其子 slot `conversation.details.tool`）；`conversation.side.panel`/`side.panel` ❌（全仓库 grep=0，与 F-W6 一致）。

## (b) J1 裁决建议（按表面分层，主推 A）

- **A(主) 科研工作台 = `conversation.view` 新 view tab，id 'research'**：trajectory 同款模板（ui-trajectory/src/client/index.ts:77-106 即最简样板）。list 型纯增量，不触碰任何 shipped 包；随带子 slot 由 research entry 自己 children 声明。适合 pipeline 进度全景/gate 面板/对抗面板/figure 画廊等宽幅面。
- **B(补) 聊天侧常驻 pipeline 进度条 = `conversation.input.dock` 或 `.composer.dock` list 加 id**：TodoDock(id 'todo') 样板（skeleton/TodoPanel.tsx:133-140）。A 工作台仅当切到 research tab 可见，dock 使运行状态在聊天态仍可见。
- **C(补) gate/对抗/人介入决策 = 走 composer chain 既有机制，勿自建侧栏**：`conversation.composer` 是 chain/session，ui-approval(PendingApproval)、ui-user-questions(PendingQuestion) 均以 selector 匹配 pendingInteraction 并接管 composer（ui-approval/.../slots.ts:161-166、ui-user-questions/.../slots.ts:220-224）。T29 的 gate/ask-user 应新增 pending kind + SessionPendingInteractionMap 合并，复用同一 UX，并可用 `conversation.approval.detail`(single) 展示关联工具详情。
- **D(补) 工具调用在转录流内的 figure/table/roadmap 输出 = `tool.call.toolview` 按 wire tool 名 keyed 注册**（key 域开放、对自有工具增量，ui-tool/.../slots.ts:10-28）。details 右栏不要碰：`details`/`conversation.details.tool` 均 single 且绑定“当前选中 tool-call”，注册即劫持 shipped 面板。

## (c) P4 最小注册样板（以 conversation.view 新 tab 为例）

```ts
// dsh-research-web/src/client/contract/slots.ts —— 类型层(declaration merging)
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { research: ResearchKey }
  interface SlotMap {
    'research.pipeline': { kind: 'single'; scope: 'session' } // 若要外部可注入子面板
  }
}
// dsh-research-web/src/client/apply.ts —— 运行时层
export const inject = ['slots', 'sessions', 'uiSession', 'uiConversation', 'locale']
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'research: dict')
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view', id: 'research', order: 20,
    label: () => ctx.locale.bind(NS)('view.research'),
    children: { 'research.pipeline': { kind: 'single', scope: 'session' } }, // 选填
    // 数据面：ctx.uiSession.provide({hooks:['research'],resolve}) + SessionStandardProps 合并 useResearch
    inject: (sessionId: SessionId): ResearchViewInjected => ({ hooks: {...} }),
  }, ResearchView))
}
```

要点：①注册须等目标 slot 被声明 → 一律包 `ctx.slots.inject('conversation.view', ...)`（ui-chat apply.ts:94 同款）；②view entry 需唯一 id + 不重复 order；③组件 props 用 ComposedProps 派生类型（PropsRuntime<'conversation.view'> & PropsRenderSlots<children> & InjectFace & PropsLocale）；④locale 必须注册字典并声明命名空间；⑤自备数据源须经 uiSession.provide 注入 + SessionStandardProps 合并成标准 hook。

## (d) 问题分级

- **P0：无**（源码无阻断；F-W6“不存在”获证，改真实 slot 即可）。
- **P1（设计决策，非代码缺陷）**：仓库不存在任何“会话旁常驻侧栏/侧 dock”的增量 slot；若产品要求 research 面板与聊天**同时同屏**（原 side.panel 意图），仅靠 conversation.view(tab) 做不到，另辟即须劫持 single 的 `conversation`/`details` 或改动 ui-layout AppFrame——均超出“纯注册”范围。建议把工作台定义为 tab view（A），把“进度常显”用 dock(B) 解，可绕开。
- **P2**：①T27 的 `research.pipeline/figure/table/roadmap/gate/adversarial` 目前在 SlotMap **零声明**，须 P4 自声明并自任父 entry，命名建议 `conversation.research.*`（对齐 conversation.<target>.* 惯例，避免顶层裸 key 与既有约定混淆）；②`details`/`conversation.details.tool`/`conversation.composer` 为 single/chain 占用面，误注册即 shadow shipped UI（高 replaceRisk）；③conversation.view 每次仅渲染 active entry、view tab 条在 ≥2 个 view 时出现——交互/验收用例需覆盖 tab 切换与 openView 程序化聚焦（views.ts ConversationViewRequest）。

证据：01_fact_baseline.md:126(J1)、05_execution_wbs.md:20(F-W6)/107(T25)/349(U3)。运行时树佐证：D:/1/plan/t25-slot-tree.json。
