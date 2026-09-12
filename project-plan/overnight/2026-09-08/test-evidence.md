# test-evidence
## 阶段0 证据(2026-09-08)
- fsck --full:零 error/missing(dev,master=7ce683b)
- pnpm install --frozen-lockfile:exit 0,23s(pnpm 11.7.0)
- 构建:core/cordis/tools/team tsdown lib 成功(31-36ms each;core host.js+state-machine chunk)
- tsc -b 四包:全部 exit 0(上游引用链 d.ts 自动构建)
- vitest:25 files/702 passed(4.61s)
- coverage(Node22 与 Node24.18.0 对照):702 均过;per-file 100% 门禁**两版本一致不达**(state-machine branches 84.57、cordis index funcs 59.09、host.ts、journal.ts、l0/routing.ts、verify.ts 等)。lib 路径 0 混入统计;uncovered 为真实 src 函数体/分支。结论:**真实缺测、非 Node 版本差异、非产物映射**。处置:不凑数;adapter 方法缺测并入 T19-A 契约测试(同一语义);coverage 子项 DEFERRED 至 T19-A 合入后复验。旧 tag baseline-verified-20260908 标记部分验证;最终 v2 待建。
- pack:四包 tgz 生成,污染 0,js/d.ts 齐全(core 3js/15dts incl host+chunk;cordis 1/1;tools 1/20;team 1/15)
- core plain-node consumer import:main(export CITATION_*/...)+./host(仅 createHostApprovalChannel)通过
- 限制:pnpm --pack-destination 必须相对路径(/g/ 被 node 解析为 G:\g 已清理);cordis/tools/team 含私有 workspace deps,单 tgz 离线无法独立 plain-import(见 degradations)
- 环境:node22.22.2+node24.18.0(便携,未动系统)/pnpm 11.7.0/python3.13.14/win10.0.26200
- build:全量 pnpm run build 后台(build-full.log)
## 阶段0 关闭补充(2026-09-08 03:3x)
- build:lib:host exit 0(F-01 修复:tsconfig.host.json references+exclude);build:lib:client exit 0;build:web exit 0(apps/web/dist 生成)
- 工程修复提交 7138620(4 files,lefthook 过)
- dsh web smoke(--profile web --port 1120):ready 日志含 URL;无 token 401;token 交换 303;带 cookie 首页 200 text/html;favicon 200;受控关闭后 1120 连接拒绝、无残留 node 进程
- oxlint:4 包 src 全 0;tests 98 error 均为 'error' typed value(type-aware 无 tsconfig 归属误报)→ DEG-3
- v2:git tag baseline-verified-20260908-v2 @ 7138620;bundle dsh-verified-v2-20260908.bundle 双位置;list-heads 核验 master+tag(v2)+旧 tag 齐全
## S10 完整恢复演练(bundle→fresh→全链,16:59-17:07 通过)
- clone dsh-t18-20260908.bundle → HEAD=aa85f32, TREE=4a64dfad…, LOCK_SHA=b84ae3ff1906d19a
- frozen install exit 0;research 4 包 tsdown×4 exit 0;tsc -b×4 exit 0;vitest **770/770**;pnpm run build(host+client+web)exit 0;pack core/cordis/tools/team exit 0;core plain-node consumer import exit 0
- web smoke:脚本内子进程时序未探到端口(000),temp 手动复测 **401**(ready 日志+鉴权活,服务正常)→ 判定通过(日志 s10-full.log + s10-web2.log)
- 结论:阶段0 的 S10 完整恢复演练证据齐(结构+内容+build+test+pack+web);full restore 关闭项达成
