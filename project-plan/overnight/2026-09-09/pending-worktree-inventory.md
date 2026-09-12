# pending-worktree-inventory — 2026-09-09 01:1x (Wave 0)

现场基线(与任务书一致): HEAD=`fa890f3` (tree `861a95c`),分支 master,工作树含未提交混合变更。

## 1. 只读盘点结果

### tracked 变更(6 文件, +50/−6)
| 文件 | 归属 | 说明 |
|---|---|---|
| `packages/research/dsh-research-cordis/tsconfig.json` | 支撑修复 | +reference ../dsh-research-core(审计1 P2 修复) |
| `packages/research/dsh-research-tools/tsconfig.json` | 支撑修复 | +reference ../dsh-research-core(同上) |
| `packages/research/dsh-research-tools/src/tools/roadmap/validate.ts` | 支撑修复 | T18 JSDoc 事实修正(审计4 P3①) |
| `packages/research/dsh-research-team/package.json` | T19-B | +`@deepseek-ai/dsh-research-tools` workspace dep(runner 需要) |
| `pnpm-lock.yaml` | 共享面 | team→tools importer + dsh-research-web importer(install3 已装) |
| `tsconfig.client.json` | T26 共享面 | +web references +css-modules.d.ts include |

### untracked(源码 24 文件 + 1 安装日志)
| 目录 | 归属 | 文件 |
|---|---|---|
| `packages/research/dsh-research-team/src/anchor/` | T23 | types.ts / fixture.ts / index.ts |
| `packages/research/dsh-research-team/tests/anchor.spec.ts` | T23 | 24 测试 |
| `packages/research/dsh-research-team/src/runner/` | T19-B | types.ts registry.ts verdict.ts drive.ts report.ts anchor-fixture.ts |
| `packages/research/dsh-research-team/tests/e2e/helpers/drive.ts` | T19-B | e2e 驱动镜像 |
| `packages/research/dsh-research-web/` | T26 | 17 文件(package/tsconfig/tsdown/src/tests) |
| `.workbuddy-install3.log` | 未知/临时 | 安装日志,不提交 |

注:web 包内 `lib/`、`node_modules/`、`*.tsbuildinfo` 被 .gitignore 忽略,不在快照。

## 2. 归属裁决(与昨日台账一致)
1. 支撑修复 = cordis/tools tsconfig + validate.ts JSDoc。
2. T23 = anchor 3 文件 + anchor.spec.ts。仅依赖 core 公共 entry(adjudicate/ClaimId),**不需** tools dep。
3. T26 = web 包 + tsconfig.client.json。
4. T19-B = runner 6 文件 + e2e helper + team package.json(tools dep)。
5. 共享面 = pnpm-lock.yaml(+team tools importer +web importer),tsconfig.client.json。
6. 未知归属 = `.workbuddy-install3.log`(临时,忽略)。

## 3. 快照一致性
- 00:37 两份既有快照(`.workbuddy/tmp/pending-snapshot/` 与 `plan/overnight/2026-09-08/pending-snapshot-backup/`)互为副本:SHA-256 全同(tracked patch=74df5518…,untracked tgz=4dbaeb9a…)。
- 新生成 fresh 快照与旧快照内容级比对:tracked patch 逐字节一致(74df5518…);untracked 仅 `.workbuddy-install3.log` 文件多出(其余 24 源文件逐字节一致)→ 无源码漂移。旧 tgz 含目录条目导致归档哈希不同(94af vs 4dba),非内容漂移。

## 4. 备份(不依赖 .workbuddy/tmp)
- **A 副本(仓库外持久,G 盘,同盘)**: `G:\AccePaper-main\plan\overnight\2026-09-09\backup\`(tracked-changes.patch / untracked.tgz / untracked-list.txt / head.txt / tree.txt / SHA256SUMS.txt)
- **B 副本(不同物理盘 D:)** : `D:\AccePaper-overnight-backup\2026-09-09\`(sha256sum 复验 OK,与 A 哈希一致)
- 声明:G 盘内副本 = 同盘副本;D 盘副本 = 真实第二物理盘灾备。HEAD=fa890f3 有 tag/bundle(见 tag-bundle-manifest 惯例),恢复路径完整。

## 5. git 健康
- `git fsck` 干净;无活动 lock(`index.lock.stale-1788794292` 为历史残留命名文件,不影响操作);HEAD/ORIG_HEAD/index 正常。
- refs: master=fa890f3;origin/master=7ce683b(未推送,符合"不 push"纪律);tags 保留至 checkpoint-t18/t19a-e2e/t22-t24 等。

## 6. 后台进程
- 端口 1120 有 LISTENING PID 632(疑似前一 session 遗留 DSH web/1120 进程;身份待查,tasklist 过滤器未返回)。未擅杀;Wave 5/8 若需占用 1120 再处理并登记。
- 无 node/pnpm/vitest 前台进程可见(Git Bash ps 覆盖有限,以 lock 状态为准)。

## 7. T19-B typecheck 阻塞根因(已定位)
`src/runner/drive.ts`:
- L39 `import { runStep } from '../../../../dsh-research-core/src/engine/pipeline.ts'`(跨包相对导入 → TS2307/rootDir)
- L28 从 core 公共 entry import `appendAuditEvent`(index.ts 未导出 → TS2305)
- L46-49 从 `./registry.ts` import `STEPS, STEP_BY_ID`(registry.ts 未定义 → TS2305)
修复路径(对应 Wave 2 core API):core 公共 entry 增量导出 `runStep` + 只读 16 步访问器;drive 改用公共导入。另:drive.ts 手动 appendAuditEvent('gate-verdict') 与 submitGateVerdict 内部审计**重复** → Wave 3 需移除(核心已内置 gate-verdict/gate-abstention/step-completed 审计,无需通用 append 导出)。

## 8. 其余半成品状态(昨日台账背书)
- T23 anchor 24 测试,team 243 绿(待独立审计)。
- T26 web 纯逻辑 12/12 绿;web tsc -b exit 0(install3 后);共享面 tsconfig.client.json 已由主 Agent 完成(未提交)。
- T19-B E2E spec 未写;registry/verdict/report 已具备,drive 待 core API 汇合。
- 五审计(1-5)零 P0/P1,审计4 P3① JSDoc 已当场修正(在本清单 tracked 变更中)。
