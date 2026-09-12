# Batch 2 Wave-1 P2 恢复提交审计报告(独立只读)

- 审计对象:恢复提交 `96c7f1c`(batch 2 wave-0 + wave-1 P2 RECOVERY),父提交 `c6731f7`(批次1基线)
- 事故背景:`D:\1\plan\batch2-git-recovery-blocker.md`;原分工具提交对象丢失,内容原样并入 96c7f1c
- 审计方式:纯只读(git ls-tree/show/grep/fsck/status/log + 文件阅读),零文件写入
- 包根路径说明:交付文件位于 git 树 `packages/research/dsh-research-tools/` 下(后表已含此前缀)

## 1. 文件完整性逐项核对(96c7f1c tree,blob 均非空)

| 交付项 | 文件 | 状态 | blob 大小(bytes) |
|---|---|---|---|
| wave1-1 | src/tools/literature-search/index.ts | ✅ | 12084 |
| wave1-1 | src/tools/literature-search/adapter.ts | ✅ | 5238 |
| wave1-1 | src/tools/literature-search/mock.ts | ✅ | 9050 |
| wave1-1 | src/tools/citation-verify/index.ts | ✅ | 5364 |
| wave1-1 | src/tools/claim-construct/index.ts | ✅ | 7399 |
| T15 | src/tools/ablation/index.ts | ✅ | 26281 |
| T15 | src/tools/ablation/adapter.ts | ✅ | 7753 |
| T15 | src/tools/ablation/mock.ts | ✅ | 6662 |
| T16 | src/tools/figure/ — 9/9 | ✅ | adapter 6674 / color 4131 / font5x7 6445 / index 26149 / pathguard 7435 / png 9702 / raster 15843 / scale 4032 / svg 15101 |
| T17 | src/tools/three-line-table/index.ts | ✅ | 51243 |
| 集成 | src/index.ts | ✅ | 3676(6 工具 export 块 + shared,见 §2) |
| shared | src/shared.ts | ✅ | 2066 |
| 集成测试 | tests/entry/public-surface.spec.ts | ✅ | 6814 |
| T16 测试 | tests/figure/figure.spec.ts | ✅ | 53289 |
| T17 测试 | tests/three-line-table/three-line-table.spec.ts | ✅ | 54474 |
| T15 测试 | tests/ablation/ablation.spec.ts | ✅ | 32813 |
| 补充测试 | tests/literature-search/mock.spec.ts | ✅ | 9398 |

结果:全部 16 关键文件 + figure 9 文件存在且非空,无缺失、无空 blob。

## 2. 内容质量抽查

- `figure.spec.ts` = **1407 行** ✅(符合 v8-ignore 超长注释修复后预期)
- `three-line-table.spec.ts` = **1467 行** ✅
- `src/index.ts` = 59 行,含 6 个工具 export 块注释(literature-search/citation-verify/claim-construct/ablation/figure/three-line-table)+ shared `export {}`,注释逐块声明职责与冻结约束 ✅
- 抽查行数:ablation.spec 789 / public-surface 153 / mock.spec 210,均正常。

## 3. 冻结约束抽查(tools src + tests 只读 grep/阅读)

| 约束 | 结果 |
|---|---|
| v8-ignore 滥用 | ✅ 0 处(v8-ignore 全包 grep 零命中) |
| Date.now() 兜底 | ⚠️ 2 处,均**带理由注释**:citation-verify/index.ts:96(`input.timestamp ?? Date.now()`,注释声明"caller 注入优先、省略时才兜底"、已由 citation-verify-tool.spec.ts:266 覆盖);claim-construct/index.ts:167(`input.now ?? Date.now()`,JSDoc 声明"唯一非确定部分",已由 claim-construct.spec.ts:200 覆盖)。同 C2 审计(batch2-wave1-p2-tools-audit.md §6)判定"无合规问题"。其余工具(literature-search/ablation/figure/three-line-table)均为强制注入、无兜底。 |
| 真实密钥/网络调用 | ✅ 无(fetch/http/axios/key/Bearer 等零命中) |
| 状态机逻辑引用 | ✅ 无实际逻辑引用;仅注释性否定声明("no state-machine",index.ts 亦注明绝不推进批次1状态机) |
| figure png.ts 依赖 | ✅ 仅 `import { deflateSync } from 'node:zlib'`(built-in),零第三方运行时依赖;package.json 仅 workspace 内部依赖 @deepseek-ai/dsh-research-core |

## 4. 仓库健康检查

- `git fsck --full --no-reflogs`:**零 broken link / zero missing objects**;提交 96c7f1c 全树 8911 文件可解析。⚠️ exit=1,根因:9 个 **hash-path mismatch** 松对象 + 约 50 个 dangling(blob/tree/commit)——已核实均**不可达**(rev-list --all 不含),系事故残留碎屑,不影响本提交内容完整性。
- `git log --oneline -2`:`96c7f1c` ← `c6731f7`,父提交核实无误 ✅
- `git status --porcelain`:**空** ✅(工作树干净,无未提交变更)
- 96c7f1c 位于 master,HEAD,无 reflog 分叉。

## 5. 发现问题分级

- **P0:无**
- **P1:无**(内容完整、约束合规、提交链正确)
- **P2(非阻塞,共 2 项)**
  1. git 对象库残留 9 个 hash-path mismatch 松对象 + 约 50 个 dangling 对象,`git fsck` exit=1。均为不可达碎屑(事故残留),不影响提交内容;建议后续在写操作批次执行 `git gc --prune` 清理(本审计只读,不做)。
  2. T13/T14 各 1 处 Date.now() 兜底带理由注释并已有测试覆盖——与 C2 审计既有判定一致,记录备查;若按更严字面"零兜底"口径,可于后续 wave 移除,非本批 blocker。

## 结论

**PASS**。恢复提交 96c7f1c 内容完整(无缺失/空文件),质量抽查与冻结约束抽查通过,仓库健康无 broken link,工作树干净。P2 项均为非阻塞备注,不影响本批收口。

## 收口补充(主 Agent,审计后)
- 审计报告的 P2 备注已处理:9 个 hash-path mismatch 无效对象(恢复脚本误放的 12.m 中间态文件)已删除。
- 复核:fsck 零 error / 零 broken link / 零 missing;59 个 dangling(原分工具提交对象 525fbd4/53b4a44 等)按事故记录作为审计对照资产**保留**,不 prune。
- 收口门禁(最终提交 96c7f1c):tools tsc exit 0;research 三包 509/509 绿;工作树干净。
- 终局:**PASS**,本批(batch2 P2 第二组 + QD)收口完成。
