# 环境基线复验记录 — 2026-09-08(阶段 0)

> 唯一可信仓库:G:\AccePaper-main\deepseek-harness-dev(由 bundle 重建,master=7ce683b)
> 旧仓库(master/master1/recovered/stable)保持只读归档,不再引用。

## 环境版本
| 项 | 值 |
|---|---|
| Node | v22.22.2(managed:C:\Users\Leon\.workbuddy\binaries\node\versions\22.22.2-2) |
| pnpm | 11.7.0(corepack 按 package.json packageManager 自动) |
| Python | 3.13.14 |
| OS | Windows 10.0.26200 |
| git | PortableGit(经 bundle 恢复) |

## 复验结果
| # | 项 | 结果 |
|---|---|---|
| 1 | 固定唯一仓库 | ✅ deepseek-harness-dev |
| 2 | 旧仓库只读归档 | ✅ 未改动 |
| 3 | HEAD=7ce683b | ✅ `7ce683b` |
| 4 | git fsck --full | ✅ 零 error/missing |
| 5 | pnpm install --frozen-lockfile | ✅ exit 0(23s,store 缓存;首装需 1.5GB) |
| 6 | core→cordis→tools→team 构建 | ✅ lib/index.js+host.js 产出(cordis/tools/team **新增 tsdown.config.ts 脚手架**,暂未入库) |
| 7 | 702 测试 | ✅ 25 files / 702 passed(4.61s) |
| 8 | typecheck(tsc -b 4 包) | ✅ exit 0(自动构建上游引用链 d.ts) |
| 9 | coverage per-file 100% | ⚠️ 见下(差异项) |
| 10 | pack/unpacked smoke | ✅ core tgz 含 lib js+d.ts |
| 11 | Mock dsh web smoke | ⏸ PENDING(需 web client lib 构建;建议并入 T32 前验证,避免先投入大构建) |
| 12 | 环境版本记录 | ✅ 本文档 |
| 13 | tag + bundle | ✅ tag=baseline-verified-20260908;bundle ×2(plan/ + .workbuddy/tmp/),list-heads 核验:master 与 tag 均在 =7ce683b |

## 差异项(coverage,需决策)
- 现象:702 测试全绿,但 per-file 100% 门禁在 **Node 22** 下报多处未达标(例:state-machine.ts branches 84.57%、team journal.ts branches 87.5%、cordis index.ts functions 59.09%)。
- 推断:历史"per-file 100%"达成于 **Node v24**(原 D:\1 环境 v24.18.0);v8 coverage 的分支/函数计数随 Node 版本存在差异。commit 内容一致,怀疑为覆盖率引擎语义差异而非真实代码回归。
- 处理建议:安装 managed Node v24 后复跑 coverage,对齐历史口径;若仍不达标再逐文件定位(测试债 vs 真实缺口)。
- 结论:在本环境重新标记"当前有效基线"为:**测试 702 ✅ / typecheck ✅ / coverage ⚠️(待 Node24 复核)**。

## 更新(2026-09-08 02:1x,A 固化)
- ⚠️ 旧 tag `baseline-verified-20260908` 仅为**部分验证快照**(当时 index 未重建、3 个 tsdown.config.ts 未入库、coverage 未闭合)。不移动/删除该 tag。阶段 0 全证据通过后另建 `baseline-verified-20260908-v2`。
- 3 个新增 tsdown.config.ts(cordis/tools/team)为未提交工作树内容,patch 已存双位置:plan/tsdown-configs-cordis-tools-team.patch + .workbuddy/tmp/(54 行)。是否保留待 B 审计裁决。
- 修复:git index 已重建(reset --mixed HEAD,8937 条目,225s),工作树干净(仅 3 ?? 新配置)。
