# Batch 2 git 对象库损坏 — 事故记录与恢复(blocker)

## 事故时间与触发
2026-09-03 ~18:38–19:15。T16 figure 提交时 staged lint hook 运行期间,git 仓库对象库损坏。

## 根因分析(证据链)
1. `.git/objects/pack/` 原只有一个 pack(pack-280774e8,含批次1基线 c6731f7,19.6MB,checksum 校验通过)。
2. 9/3 期间(16:15 后)曾有 git gc 创建**第二个 pack**(含 9/3 全部对象:wave0 613521f→wave1 d33e424→QD/T15),该 pack **从未被 WorkBuddy modify_backup 备份 → 永久丢失**。
3. 丢失的 pack 承载的松散对象在被 gc 删除时,部分被 modify_backup 备份(337 个 `12.d.*` + 9 个 `12.m.*`),已全部恢复回 `.git/objects`。
4. 验证:恢复后的 pack 仅含 c6731f7 一个 commit(verify-pack + checksum 双重确认);reflog 中 32 个提交的 commit 对象大多已恢复,但 **613521f / 96ff257 / ebed4cf 三个 commit 对象无任何备份,永久丢失**;eabc3d2、528135c、17c77bf 等提交对象存在但所引 tree 部分缺失(9/3 pack 丢失所致)。

## 已执行的恢复动作
1. 从 modify_backup 恢复 pack-280774e8 → checksum MATCH,index-pack --verify 通过。
2. 批量恢复松散对象:337(`12.d`)+ 9(`12.m` 中 9 个有效)+ 9(穷尽匹配)= 恢复后 hash-path mismatch 清零。
3. 清理无效对象(9 个内容≠文件名的中间态)、所有 `*.lock`、`tmp_obj_*` 临时文件。
4. 删除损坏的 `.git/index`(其 cache-tree 引用缺失对象)→ 从工作树重建。
5. master 强制指向**完整可达基线** `c6731f7`(10150 对象,rev-list 零 error 验证)。
6. `git reset --mixed HEAD` 重建 index → status 65 项 = 工作树相对 c6731f7 的真实差异(含 wave0 包改名 research-core→dsh-research-core 等)。
7. 完整备份当前 .git → `D:/1/dsh-git-recovery-backup/git-191317`(24MB)。

## 内容保全验证(核心资产 100% 完好)
- figure spec 1407 行 / three-line spec 1467 行(lint 修复后版本)✅
- 全部工具 src/tests、index.ts 接线、shared.ts ✅
- tools 包 tsc exit 0 零错误 ✅(恢复后复测)
- 恢复前 research 三包 509/509 绿(待恢复收口后复测)

## 历史影响
- 永久丢失的提交对象:613521f(wave0 冻结)、96ff257(wave0 契约修正)、ebed4cf(T12-T14 集成出口)。对应内容全部保留在工作树。
- 已 PASS 的第一组 6 提交(b25947e/07a1e77/528135c/d33e424/ebed4cf/17c77bf)与 QD/T15 提交对象大多已恢复存在,但因父链断 + 部分 tree 缺失,无法以原始哈希自然闭合 → 需历史重建决策。

## 恢复决策(主 Agent)
工作树 = 最终真相(内容完整)。执行:**以 c6731f7 为根,将工作树(清理残留后)按原计划粒度重建提交**,提交信息中如实标注恢复性质。figure/three-line 保持独立提交。原始哈希与对应关系记录于本文件,供审计对照。

## 审计对照(丢失 → 内容去向)
| 丢失对象 | 性质 | 内容去向 |
|---|---|---|
| 613521f | wave0 契约冻结 | 工作树 contracts.ts(经改名后 dsh-research-core) |
| 96ff257 | wave0 Q1 契约修正 | 同上 |
| ebed4cf | T12-T14 集成(index.ts + surface-lock spec) | 工作树 src/index.ts + tests/entry/public-surface.spec.ts(主 Agent 已重新接线 6 工具) |
