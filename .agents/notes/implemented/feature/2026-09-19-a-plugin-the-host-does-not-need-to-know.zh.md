# Agent Note: 一个不需要宿主认识它的插件

Status: implemented

[English](2026-09-19-a-plugin-the-host-does-not-need-to-know.md) | 中文

## 问题

科研工作台想待在对话旁边而不是藏在对话里的一个标签页后面,而它是靠**改宿主客户端核心**做到的: 往对话外壳的插槽契约、客户端插槽目录和子系统文档里加了 `conversation.aside` —— 一个新插槽、一个新的 `asideRegistered` 快照,以及 `ConversationRoot` 里的一个新区域。三个宿主侧新文件加十三个被改的文件, 全都只为了让**一个**插件实现一个布局偏好。

这个代价付错了地方。一个必须改宿主才能被接受的插件不是插件,是分叉 —— 它没法被独立打包、独立定版本、 独立撤下。用户 2026-09-19 的裁定:回退宿主侧改动,把等效的改动做在插件里。

## 决定

- **宿主侧改动整体回退。** `packages/client/ui-conversation/**`、 `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts` 与 `docs/subsystems/slots.*` 回到已提交状态;三个宿主新文件与那篇 aside 笔记**移到备份目录**而不是删除。`git diff` 在 `packages/client`、`packages/extensions` 与 `docs/subsystems` 上为空。
- **插件注册到宿主本来就提供的位置。** `dsh-research-web` 把条目挂进 `conversation.view` —— 宿主核心 本来就声明的、给会话视图用的 list 座位 —— 并带回它原有的 label thunk。
- **代价付在插件里,并且写清楚。** 面板现在是 `chat`(order 0)与 `trajectory`(order 10)的兄弟视图, 而不是与它们并排的一栏,于是读者是**切过去**而不是在旁边同时读。这是到达方式上的真实退步,也是 「不拥有宿主代码」的价钱。
- **用例现在拒绝宿主没有声明的座位。** 组件套件的插槽替身只列 `conversation.view`,于是回退到未声明 座位的改动会在那里失败,而不是等到启动之后。

## Alternatives considered

- **保留 `conversation.aside`,把它当成科研 bundle 的一部分一起发布。** 拒绝:插槽仍然声明在宿主的 契约里,宿主仍然背着一个只为单个插件存在的概念,而插件也仍然装不进没有它的宿主。
- **请宿主提供一个通用的「任何插件都可以加区域」机制。** 拒绝:那是同一个错误换了个好名字 —— 一个只为当前唯一消费方建的通用宿主设施是没有第二个用户的宿主代码,而本仓库的规矩是一项抽象需要 **既有当前所有者又有需要**。
- **在插件自己的 `conversation.view` 条目里把面板渲染成浮层。** 考虑过但没有采用:浮层得自行对着外壳的 布局定位,而那个布局是宿主的;它看起来像一栏,行为上既不是视图也不是一栏。
- **保留宿主改动,把依赖记录下来。** 拒绝:用户的目标是一个可打包的插件,而被记录下来的宿主依赖仍然是 宿主依赖。

## Consequences

- **真机实测(2026-09-19,端口 1121)**:服务端发出的插件包里 `conversation.view` 出现 16 次、 `conversation.aside` **0 次**,根路径答 200 且科研条目已注册。回退是浏览器真正收到的东西,不只是 工作区里的说法。
- **2767 条用例通过**(`packages/research` 与 `packages/client/ui-conversation`);host 与 client 两个 编译面都干净;七道文档门禁通过,research-web 的 README 配对已重录。
- **这里没有做的。** 它没有给插件一栏右侧空间,没有在别处补一个宿主设施,也没有碰另一个会话正在进行的 科研侧工作 —— `dsh-research-team`、`dsh-research-cordis`、`dsh-research-core` 下未提交的改动原样 未动。回退之前整棵工作区已复制到 `.workbuddy/tmp/backup-20260919/working-tree.patch`。

## Files

- `packages/research/dsh-research-web/src/client/index.ts` —— 注册进 `conversation.view`,并恢复 label thunk 所需的 locale 绑定。
- `packages/research/dsh-research-web/src/client/ResearchEntry.tsx`、 `src/client/workbench/ResearchWorkbench.tsx` —— 关于座位与 owner props 的注释改成对视图座位成立的 说法。
- `packages/research/dsh-research-web/tests/researchview-component.dom.spec.ts` —— 插槽替身只声明宿主 拥有的座位。
- `packages/research/dsh-research-web/README.md` / `.zh.md` —— 面板所在座位,两种语言一起更正。
- `Start DSH.cmd` —— 端口被占时的拒绝现在说明这是**有意的停止**,不再读起来像崩溃。
