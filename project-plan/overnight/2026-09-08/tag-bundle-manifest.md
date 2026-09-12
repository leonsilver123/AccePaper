# tag/bundle manifest(2026-09-08,第八项裁决)

> 全部保留,不删除/不移动旧 tag。去重建议待 T19-B+T23+T26 稳定里程碑后提交。

## Tags(共 9)
| tag | commit | tree | 对应任务 |
|---|---|---|---|
| post-batch1-observed(旧) | 见 git | — | 批次1 观测基线(历史) |
| recovery-verified-20260904(旧) | 见 git | — | 9/4 恢复基线(历史) |
| baseline-verified-20260908 | 7ce683b | 1e487da4… | 阶段0 部分验证快照(不移动) |
| baseline-verified-20260908-v2 | 7138620 | — | 阶段0 工程修复后 |
| checkpoint-t19a-p2-20260908 | 61922e2 | — | T19-A P1-P2 hold_abstained |
| checkpoint-t19a-p3-20260908 | 73c4dda | — | T19-A P3 pipeline |
| checkpoint-t19a-e2e-20260908 | 5f2410d | — | 16 步 Mock E2E |
| checkpoint-t22-t24-20260908 | eaee215 | — | T22/T24 |
| checkpoint-t18-20260908 | aa85f32 | — | T18 roadmap |

> 注:晨报摘要"tags×4"不准确;本表为准确计数(旧 2 + 新 7)。

## Bundles(20260908 新增 7 个,每处双位置 = plan/ + .workbuddy/tmp/)
| bundle | sha256(12) | size | 含 heads(master + tag) |
|---|---|---|---|
| dsh-verified-20260908 | 265cbd7e7f82 | 19919147 | master=7ce683b; baseline-verified-20260908 |
| dsh-verified-v2-20260908 | d0f24ffe7f60 | 19920228 | master=7138620; -v2 |
| dsh-t19a-p2-20260908 | 01cb6c6d283d | 19927015 | master=61922e2; checkpoint-t19a-p2 |
| dsh-t19a-p3-20260908 | e287072b0cc2 | 19935319 | master=73c4dda; checkpoint-t19a-p3 |
| dsh-t19a-e2e-20260908 | 371fb435a010 | 19952119 | master=5f2410d; checkpoint-t19a-e2e |
| dsh-t22t24-20260908 | 2d2293b3ea1d | 19960199 | master=eaee215; checkpoint-t22-t24 |
| dsh-t18-20260908 | 9f19dde6da4a | 19967094 | master=aa85f32; checkpoint-t18 |

历史 bundle(仅 plan/,不删):dsh-post-overnight-20260904(80955488c134)、dsh-recovered-20260904(138f8bd79460)。

## Patches
- plan/tsdown-configs-cordis-tools-team.patch(双位置)= 3 个 tsdown.config 的备份。

> heads 已逐 bundle list-heads 核验(见 execution-ledger);master 与对应 tag 均指向同 commit。
