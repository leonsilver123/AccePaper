# 审计台账 2026-09-09

## T23 external anchor(只读审计,t23-audit) — ACCEPT
- 零 P0/P1;P2×1(桥接不构成可用 external anchor,fail-safe 静默 abstain,文档登记);P3×5(补测:anchorToVerification 不 mutate 输入/空 ref 抛 ANCHOR_UNKNOWN_KEY/lookup 无共享态/signal frozen 断言/makeInconclusiveAnchorSignal 三类保留标记)
- 8 项核查:非 verdict/无伪装/不复制 GateB/fail-closed/不升级 claim/不改 T22/T24/契约兼容/确定性 全 ACCEPT
- 证据:anchor spec 24 tests;src/anchor/{types,fixture,index}.ts
