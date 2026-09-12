# failures-and-rework
## F-01(2026-09-08):全量 pnpm run build 失败 → 修复(第 1 轮)
- 现象:build:lib(host face)tsc -b tsconfig.host.json exit 2;错误跨 research cordis/tools/team 的 tests(TS2375/2379/2353/6307/2717/18048 等)。
- 根因:tsconfig.host.json include 含 packages/*/*/tests/**,exclude 仅排 dsh-research-core/tests → 其余 research 三包 tests 被 host tsc 编译(历史上 research 扩包加入后全仓 host build 从未重跑);且 references 缺 team/tools → TS6307。
- 修复(工程修复候选提交):exclude 补 cordis/tools/team/tests(与 core 一致);references 补 team/tools。
- 验证:后台重跑 build:lib:host(4ozIjV)。通过后 → 独立提交(与 tsdown.config 3 文件一并?)——tsdown.config 3 文件在本修复中为 references+exclude 前置;将按独立工程修复提交(build 修复)。
- 复验:BUILD_HOST_EXIT 待查。
## F-02(2026-09-08):git commit 两次被环境 stash 机制干预(第二次 commit ref 事故)
- 现象:git commit 经 lefthook 后 exit 0 但 HEAD 未前进、文件仍 staged;fsck 出现 WIP on master(57820df)与 index on master(52c60d1)对象。
- 根因:外部机制(WorkBuddy 文件监控/自动 stash)在 commit 写 ref 阶段把变更 stash 成 WIP/index commit 并移走 ref 更新(历史事故复现,第二次)。
- 恢复:soft reset 回基线→补齐 staged→修正 lefthook 拦截的 4 个 member-delimiter-style 样式错误(hold-abstained.spec.ts inline type 分号→换行)→ 重新 commit → **61922e2 成功入 master**;tag checkpoint-t19a-p2 重打至 61922e2;bundle 双位置+list-heads 核验;fsck 干净。
- 教训再次坐实:commit 后必须立即核验 HEAD/ref;异常先查 reflog/fsck dangling,不盲目重试。
