# T26(P4.2) 双面包 exports 事实核验报告（J2/F-W7）

> 只读侦察，仓库零改动。核验对象 deepseek-harness-master。日期 2026-09-03。供 P4.2 双面包插件构建引用。

## (a) 双面包插件事实惯例

**目录双 half 布局**：每个 ui 插件包
- `src/index.ts`＝Node ESM 主机半（仅浏览器插件多为空 `apply()`，如 ui-layout/src/index.ts:4；ui-chat 在此半注册宿主 settings schema，src/index.ts:13-20；另 re-export 跨半共享 const/type）
- `src/client/index.ts`＝浏览器插件半（`inject=[cordis services]` + `apply(ctx)` 注册 slots/服务/词典，如 ui-chat/src/client/apply.ts:54）

**构建**：共享预设 `clientBundle(id, ['lib/types/index.js'])`（packages/client/tsdown.client.ts:107-124）一发产出双工件：Node 半 `lib/index.js`（esm/node，clientLibraryConfig:216-244）；浏览器半 `lib/client.js`（**cjs** format + platform browser，clientConfig:428-571，entryFileNames 钉死 'client.js'，banner `window.__ModuleLoader__.load({id,factory:require=>{...}})` :566-568）。tsc 先发 `lib/types`，entry 消费 `lib/types/*.js`。

**package.json 契约（ui-trajectory/ui-approval/ui-chat/ui-tool/ui-skill 逐字同款，以 ui-skill/package.json:16-27 为准）**：
```json
"type":"module","main":"lib/index.js","types":"lib/types/index.d.ts",
"exports":{ ".":{"types":"./lib/types/index.d.ts","default":"./lib/index.js"},
  "./client":{"types":"./lib/types/client/index.d.ts","default":"./lib/client.js"},
  "./src/*":"./src/*","./package.json":"./package.json" },
"files":["lib/index.js","lib/client.js","lib/types/**/*.d.ts"]
```

**dsh.client 声明**（ui-skill/package.json:28-39）：`{ "inject":[按序 module-table 包名], "platform":"web" }`。
消费方＝client-modules Node 半（packages/client/modules/src/index.ts）：parseDshClient:200-221 逐字段校验；`platform!=='web'` 整包跳过（resolveMeta:756）；`exports["./client"]` 只读 **default** 串（clientExportOf:223-234）；有 dsh.client 而无 "./client" → 启动即抛（:762）；inject＝激活序边（“被依赖行必须先于消费者”:450）；路由 `/plugins/<id>/client.js`（:255,:308）。
基线模块表 PLATFORM_MODULES＝react 族/cordis/store/ui-slots/ui-primitives（client/web/src/platform.ts:8-13），不属 './client' 插件。

**两类包区分**：插件包＝clientBundle+dsh.client+'./client'；基线库＝staticLinked（ui-slots/ui-primitives/store/web shell）纯 esm-browser，**无 dsh.client、无 './client'**（ui-slots/package.json:16-23 仅 `.`/`./src/*`/package.json）。

## (b) J2“不准确”实例与根因

**历史**：A1 曾将 R70/J2 判为“`./client` exports 不存在/不准确”，AUD-01 复核推翻——v1.1 §7.1 引用**正确**，ui-skill/package.json:21-24 实存 `"./client":{types,default}`；已返工更正 5 份 plan 并从 blocker 移除（07_audit_findings.md:25,89；01_fact_baseline.md:51,127；05_execution_wbs.md:20 F-W7）。**结论：仓库内不存在 exports 指向/命名错误实例，J2 是审计误判而非代码缺陷。**

**真正的“不准确”陷阱（可复现实例）**：对基线库导入 `/client` 子路径——`import '@deepseek-ai/dsh-client-ui-slots/client'` → `ERR_PACKAGE_PATH_NOT_EXPORTED`（ui-slots/package.json 无此 subpath）。`./client` 有效性**按包类条件成立**，且依赖“三名锁步”：tsdown 输出名（'client.js'）== exports default（lib/client.js）== 服务路由（/plugins/<id>/client.js）；types 依赖 tsc 真实产出 lib/types/client/index.d.ts。预设统一保证锁步；手写 tsdown 改输出名/漏 default 会 boot 抛错或 404。另注意：`type:module` 下 lib/client.js（CJS 闭包）仅供浏览器 loader 拉取，Node 永不 import；'.'与'./client'不可跨面混用。

## (c) dsh-research-web 的 exports 设计（直接可用）

按 ui-skill 模板逐字段复刻即可（这是 F-W7 明示模板）：
1. **目录**：置于 `packages/<group>/dsh-research-web`（两层深，满足预设 glob `packages/*/*/package.json`，tsdown.client.ts:352）；tsdown.config.ts 单行 `export default clientBundle('<pkgName>', ['lib/types/index.js'])`；src/index.ts=Node 半（可空 apply），src/client/index.ts=浏览器插件入口。
2. **package.json**：复制 (a) 的 exports/files/main/types 六项；`dsh.client` 给 `platform:"web"` + `inject` 列出运行时前置 module 行（服务经 ctx 依赖的 conversation/layout/renderer/session/locale/api-controllers 等；react/cordis/store/ui-slots/ui-primitives 为基线自动，**勿列**）。
3. **浏览器半禁跨插件 value-import**（purity gate，tsdown.client.ts:489-500）：一律 `import type {}` 取类型合并；运行时协作走 `ctx.*` services。确需非基线运行时依赖才加 `dsh.client.external`，且核对 loader 表键与序。
4. **CSS**：`.module.css`/`?inline`/裸 `.css` 均打包内联为 factory 注入样式，`files` 无需 css。
5. **验收命令**：`DSH_BUILD_FACE=client pnpm --filter <pkg> build` 发 Node+client 双工件过 purity gate；dev watch（face 未设）直编 `src/client/index.ts`。
6. 包名建议沿用 WBS `dsh-research-web` 全名，勿省略 `/client` 语义约定（export subpath 必须叫 `./client`）。

## (d) 风险分级

- **P0：无。**
- **P1：无阻断**（J2 已由 AUD-01 证伪并移除 blocker，F-W7 结论“以 ui-skill 为模板，无阻断”复核成立）。
- **P2**：①WBS T26 行阻断格“J2 ./client exports 不准确(F-W7)”为**过期措辞**，应改“无阻断(AUD-01 已纠正)”，建议顺手更正防误读；②P4 落地主要风险是**跨插件 value-import 违反 purity gate**（双面包最大坑，需按 c-3 纪律执行）；③漏配 `platform:'web'` 会被静默跳过、漏 `./client` 会 boot 抛错——均有构建/启动期测试可捕，故仅 P2。
