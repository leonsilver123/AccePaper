# Agent Note:人工审批接通宿主的信任通道

Status: implemented

[English](2026-09-14-human-approval-host-channel.md) | 中文

## 问题

`E2-submit` 是流水线里唯一的 `humanGate` 步。core 把它停在 `gated`,而唯一能把它推下去的函数 `_applyHumanApproval` 是包私有的,只能经 `dsh-research-core/host` 的宿主信任通道触达。**没有任何宿主或 bootstrap 代码调用过 `createHostApprovalChannel`**:那个库有单例 minter、有 principal 守卫、有一组测试,却没有生产调用方。浏览器那一侧,`ApprovalPanel` 拿着一个本地 `decisions` 记录,渲染"已批准(演示)" —— 一个后端从未听说过的决定。两侧都是空壳,中间没有线。

更难的一半是身份。Typert Remote 方法被调用时只拿到解码后的 payload 与一个取消信号,别的什么都没有。Gateway 的 `/api` 路由确实在派发前做了宿主浏览器认证,但那个结果**不会**传进方法体,所以 Remote 方法分不清"持有会话 cookie 的浏览器"和"进程内任意调用方"。剩下唯一可信任的就只有请求体里的字段 —— 而这恰恰是 `ENGINEERING-CONTRACT` §8.1 明令禁止的那一件事。

## 决定

**身份来自传输,不来自载荷。** `dsh-research-team/src/approval.ts` 经 `ctx.connection.rpc.handle('/research-approval', …)` 注册一条普通通道 —— 这是宿主自己的"已认证绝对通道路径"注册 API,`HostConnectionService.register` 会用与 `/api` 前缀**同一条** `requestRejection` 包住它。该检查验证的是一个 HMAC 签名、绑定 authority、绑定有效期的 cookie,其唯一来源是 `dsh web` 打在宿主自己控制台上的进程启动令牌。因此,"进入处理器"本身就是持有证明,由宿主在我们任何代码运行之前施加。调用方**没有别的路**能到达 `submitApproval`:该模块被刻意排除在包入口的 re-export 列表之外,服务上也没有新增任何 Remote 方法,普通工具调用因此没有名字可以指过去。

**请求体只贡献四个字段。** `readSubmission` 读 `runId` / `stepId` / `attempt` / `decision`,丢弃其余每一个键。`actor`、`principal`、`principalId`、`status` 从不被读取,所以一个自称人类、或自称该步已 `passed` 的请求体改变不了任何结果。

**每一条核对都是对"本进程持有的 store"的读取。** `submitApproval` 先在模块作用域的注册表里解析 run(与 `dsh-research-cordis` 把 store 放在模块作用域同一个理由:TS 的 `private` 在运行时被抹掉,而实例属性可枚举),随后要求该步存在、是 `humanGate`、**此刻**是 `gated`、且处于调用方指名的那个 attempt。只有全部通过,它才铸造一个绑定 `(runId, stepId)` 的 principal 与一个一次性事件 id,调用 `HostApprovalChannel.submit` —— 由 core 写入 `ApprovalRecord` 与 `human-approval` 审计事件。响应用的是**从 store 重新投影**的 run,所以客户端渲染的是后端记下的状态,而不是它手里原来那份。

**面板自己什么都不决定。** `ApprovalPanel` 提交,然后渲染回来的东西:状态、attempt,以及宿主证实的操作者。被拒绝时如实给出理由并让该步保持待审。没有提交器时(部署根本没有浏览器认证通道),两个按钮**禁用**并说明原因,而不是显示一个没人做过的决定。

## 考虑过的替代方案

**用 `@Remote('approve')` 的 Typert 方法。** 否决:Remote 派发会丢掉认证结果,该方法只能去信任载荷里的某个字段。它还会把一个审批方法放到每个客户端本来就能到达的 wire 面上。

**自己注册一条 `webServer` 路由并回调 `connection.requestRejection`。** 认真考虑过,差一点采用 —— 它自己拥有销毁时机,还能在本地再断言一次。最终选了 `rpc.handle`:认证策略由宿主施加而非由我们施加,客户端的 `connection.rpc.call` 本来就讲这套信封,而且这条路由落在宿主已经设防的前缀**之内**,不是旁边。

**把端点注册在 `dsh-research-web` 的 host 半边。** 否决:run 的 store 与审批通道必须被"有权提交的那份代码"同时拿到,而那份代码必须属于同一个包。拆开会要求一个跨包的认证证明,即信任调用方给的一个布尔值。

**只从 `DSH_APPROVAL_SECRET` 铸造通道密钥。** core 的文档点了这个变量名,但该值在实现里根本不被消费;而环境变量对进程内代码而言**更**可观测,闭包里的值反而更少暴露。部署设了就用它,没设就铸造一个进程生命期的随机值;两种情况都是单例。

## 后果

`runPipeline` 现在记住它产出的 run —— `rememberRun(runId, store, project)` —— 因为它停下的那道门只能靠寻址那份 store 来决定,插件卸载时丢弃该注册表。`src/index.ts` 多了一处 `ctx.inject(['connection'], …)`;没有浏览器面的部署保留全部其它科研能力,只是不提供审批端点。

根 `tsconfig.base.json` 新增 `"@deepseek-ai/dsh-research-core/host"`。此前树里没有任何地方导入过该子路径,而没有这条别名它会经 `node_modules` 落到 `lib/` —— 产物面,而 `AGENTS.md` 禁止静态门禁读它。

**这不是进程级隔离。** 同进程内已持有 `Context` 的代码仍可直接调用 `submitApproval`,就像它可以调用任何服务一样;宿主也分不清同一部署上的两个人 —— cookie 只有 authority 与有效期,没有用户 id,所以每个已认证的浏览器都归到**同一个**按机制而非按人命名的主机注册 principal。`host.ts` 记的是同一条残余风险。

同一进程内第二次加载审批模块会**响亮失败**:通道是进程单例,`createHostApprovalChannel` 会拒绝第二次铸造。该异常任其向外抛出。

证据等级:面板与请求契约由 jsdom 与单元 spec 达到 Integration-verified;§8.1 的审批不变量由 `tests/approval.spec.ts` 对着**真实驱动器自己那次 `gated` 停下**覆盖。传输本身在真实 socket 上对着真实 webserver 与 Connection 插件跑过 —— 无 cookie 401 且处理器从未被调用、令牌换 cookie、带 cookie 200 并写入决定、伪造 cookie 401。**没有任何浏览器对着运行中的 Host 点过这个按钮**;见各包 README。
