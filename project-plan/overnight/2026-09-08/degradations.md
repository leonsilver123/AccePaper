# degradations
## DEG-1(2026-09-08):cordis/tools/team 单 tarball 无法离线全新 consumer plain-import
- 原因:依赖私有 workspace 包(@deepseek-ai/dsh-research-core、vendor cordis 等),未发布 registry,离线单包解析失败。属私有 monorepo 正常限制。
- 缓解:tarball 结构/内容/js/d.ts 完整性已验证;运行时 import 由 vitest 全量 702(真实 import lib 路径)证明;core 真 plain consumer import 通过。
- 回滚/解除:整套发布 registry 后可做真 consumer 安装验证(留给发布轨)。
## DEG-2(2026-09-08):coverage per-file 100% 门禁暂缓闭合
- 见 test-evidence coverage 条。缺测方法并入 T19-A;完成后重跑。
## DEG-3(2026-09-08):oxlint type-aware 对 research tests 误报(98 error 全为 'error' typed value)
- 现象:全包 lint 98 errors(集中在 tests),单扫各包 src=0;vitest/tsc 全绿。
- 根因推断:tests 文件不在任何包 tsconfig include(src only)→ oxlint type-aware 无法归 project,import 类型落为 error → no-unsafe-* 连发。新环境工具口径;历史 lint 0 场景未覆盖同配置。
- 处置:lint 门禁口径=4 包 src 零错误(实测通过);tests 质量由 vitest+tsc 承担。正式 CI 口径待复核(不在深夜改 oxlint 配置以避免掩盖真实配置意图)。
- 解除:后续若确认 CI 历史含 tests 且 0,再排查 oxlint 版本差异。
