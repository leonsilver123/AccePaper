# 16 步 Mock E2E 复现说明(S1,2026-09-08)

## 复跑命令(仓库 G:\AccePaper-main\deepseek-harness-dev)
```bash
# 两条 E2E(在 tools 包 tests/e2e)
./node_modules/.bin/vitest run packages/research/dsh-research-tools/tests/e2e
# 全量 research(758)
./node_modules/.bin/vitest run packages/research
```
报告输出(仓库外):`G:\AccePaper-main\.workbuddy\tmp\e2e-out\{e2e-report,run-snapshot-*}`。

## 确定性(重放基础)
- E2E 断言:同 fixture 两次运行,时间戳剥离后字节一致(happy-path.spec)。
- Fixture executor 确定性:`FIXED_TS` + 固定种子;judge/experiment 纯函数无时钟/随机。
- 重放=以 fixture 重跑同一 run;当前以「同输入重跑断言一致」实现;正式 replay runner(录制 executor/verdict 并按序回放)列入 S1 后续,不与真实模型混淆。

## 覆盖了什么 / 没覆盖什么
- 覆盖:16 步编排、gate 单裁决源、hold_abstained、rollback/重试、E2 humanGate 停、确定性、审计 append-only、1 个真工具(figure)。
- 没覆盖:真实模型/文献/实验/真实论文内容(15 步 Fixture 显式标注)。E2 gated 停是特性,不是失败。
