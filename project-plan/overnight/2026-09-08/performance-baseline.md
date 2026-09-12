# Performance baseline — 16-step mock happy path(2026-09-08,S9)

> 一次性测量,非优化承诺。机器:Windows 10.0.26200 x64,node v22.22.2(managed),tsx 运行
> 复用 e2e driveAll(15 fixture + 1 real figure tool)。

## 结果(100 runs)
| 指标 | 值 |
|---|---|
| runs | 100 |
| 到达 E2 gated 比例 | 100/100 |
| total | 1197.55 ms |
| mean | 11.98 ms/run |
| median | 11.76 ms |
| p95 | 13.59 ms |
| min / max | 10.41 / 21.86 ms |
| heap (after) | ~10 MB |
| RSS | ~86 MB |

## 说明与后续测量项
- 每 run 16 步 + gate(verdict fixture)+ 审计;真实 figure 工具在 D1 执行(SVG+PNG 写临时)。
- 未测:recovery path 耗时(预期 > happy,因含 rollback/重试)、cold start、导出耗时、100 小 run 内存曲线 → 记入待办(明早可在 demo 后补跑)。
- 明显退化未观察到;无证据不做优化(遵循 S9 纪律)。
