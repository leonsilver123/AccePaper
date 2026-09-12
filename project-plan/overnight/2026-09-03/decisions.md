# Decisions Log (unattended-auto + user-required)

## DEC-001 — T25/P4.1 slot 裁决(侦察产出,2026-09-03)
- 问题:科研工作台注册到哪个真实 slot?文档假设 side.panel 不存在(F-W6 坐实:全仓库 grep=0)。
- 侦察结论(gp-21,D:/1/plan/overnight/2026-09-03/t25-slot-verdict-input.md):
  - conversation.view 存在(list/session,chat/trajectory 已占),可加 id 'research' tab —— 纯增量
  - details 单例已被 ui-chat 占用;conversation.composer 走 chain(pending 接管机制);tool.call.toolview keyed 开放
- 自动选择(默认,待用户 U3 确认):**方案 A = conversation.view 新 tab 'research'**,进度常显用 input.dock(B),gate/ask-user 走 composer chain(C),转录内输出走 tool.call.toolview(D)。全部纯注册、零 shipped 包改动、可回滚。
- 依据:最小修改/向后兼容/最小权限/可回滚(无人值守降级表)
- 影响:P4(T26-T29)注册面据此设计
- **是否需要用户次日裁决:是(U3)—— 若产品强求 research 面板与聊天"同时同屏",则 tab-view 不够,需另议劫持方案**

## DEC-002 — T26/P4.2 J2 exports(核验产出,2026-09-03)
- 问题:WBS 阻断格记"J2 ./client exports 不准确(F-W7)"。
- 侦察(gp-21):J2 系 A1 审计误判,AUD-01 已证伪返工(07_audit_findings.md:25,89);仓库 ./client exports 一致准确,无实例错误。
- 自动选择:**J2 阻塞解除**;T26 exports 面按 ui-skill 模板复刻(dsh-research-web 放 packages/<group>/dsh-research-web 两层深;package.json 六项+dsh.client{platform:'web',inject};'./client' 子路径必叫 client.js;浏览器半禁跨插件 value-import)。
- 依据:事实核验推翻过期裁决(证据优先级:当前代码 > 计划措辞)。
- 是否需要用户次日裁决:否(仅建议顺手更正 WBS T26 行过期措辞,防误读)。

## DEC-003 — T20/P3.1 write-scope 强制注入点(设计选定,2026-09-03)
- 问题:ctx.subagents 无 write-scope;agent.ctx guard 每 activation 全新,不自动重装(cold-resume 后无人重装=越界窗口)。
- PoC(gp-22):agent/created 与 agent/session-start 在 publish 内同步、先于首个工具调用,可作注入点;但 per-activation 注入"漏装=脱管"。
- 自动选择:**单一全局 guard**(root ctx.tools.guard 一次注册,生命周期=插件生命周期)+ 执行期按 exec.agent.id(exact-live Agent)→durable 成员表/owner+writeScopes 实时判定 → 免疫 R1 时序。
- 依据:最小修改/可回滚/消除时序脆弱点(无人值守降级表);弃 per-activation 注入与 ctx shadow。
- 残余低危 PoC:P-a 全局 guard 对非团队 agent 放行回归;P-b exec.agent 在嵌套 one-shot 的 lineage 解析。
- 是否需要用户次日裁决:否。

## DEC-004 — T20 设计参数默认采用(2026-09-03,无人值守自动裁定)
- 依据:gp-22 规格 t20-design-spec.md 附裁决请求;三项均有建议默认,属设计参数非公共 API 变更,在"最小修改/可回滚"授权内。
- U-A:**Lead 豁免 write-scope**(协调者组装终稿,guard 对 role=lead return undefined)。
- U-B:**成员单写任务并发**(同一成员仅 1 个 in_progress 写任务;scope 判定不取并集),最小化重叠冲突。
- U-C:**保留 research/rev 与 research/task 两个 CAS 跟踪对象**(task=认领工作单元+owner/权限;rev=artifact 逐版内容修订线)。
- 记录:实现按上述默认执行;若用户次日不同意,因均为内部语义参数,改造成本低(纯逻辑层)。

## DEC-005 — T21/P3.2 设计参数默认采用(2026-09-03)
- C3 澄清:非待裁决——用户 2026-09-02 U1→D12(final_execution_plan §24.1)已接受"同族 flash/pro + 异质 prompt + 外部锚"三重补强;WBS T21 行"C3 待裁决"为过期措辞。
- 自动默认(可回滚):① 默认 5 角色集(red-method/red-stat/red-domain/red-skeptic/red-cross,2×pro+3×flash,全 spawn/fresh 只读);② roster SpawnMemberRequest 向后兼容扩展透传 persona/agentOptions/toolFilter。
- 异质杠杆排序:persona 字符串(最强)→ 角色化 prompt → model 铺开 → provider 选型;不伪装异质(同族簇显式上报)。
- 裁决纪律:fleet 只反不裁;任何 ≥N 阈值 T36 前一律 abstain;跨族仅 Golden Set 不达标后触发。
- 是否需要用户次日裁决:否(仅建议更正 WBS T21 行过期措辞)。

## 2026-09-03 21:5x — T20 汇合完成
- 3 commits:6e787a3(纯逻辑 79)+1357f13(deps)+ce5d0c0(adapter 95 含 16 host);独立复跑 vitest 95/tsc 0;oxlint 0。
- gp-31 独立审计在途。
