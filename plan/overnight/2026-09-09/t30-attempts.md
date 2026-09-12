# T30 — DSH research-plugin local load attempts

Goal: boot `web` profile with the `research-app` bundle on port 1120, locally,
without npm publish / LLM keys / Junction "reproducible" evidence.
Repo: G:/AccePaper-main/deepseek-harness-dev  (packageManager pnpm@11.7.0)
CLI:  node apps/cli/lib/bin.js   (imports @deepseek-ai/dsh-app-boot)

Key facts learned during recon:
- `resolveBundleDir` resolves a bundle name first from INSTALL_ANCHOR
  (apps/cli/package.json) then from the profile dir. So adding
  `@deepseek-ai/dsh-research-app` to `dsh.profile.bundles` makes boot look in
  `<profile>/node_modules`.
- `healProfilesModuleFallback` mirrors the dsh install closure into
  `$DSH_HOME/profiles/node_modules` (shared fallback) and links a profile-local
  bundle's missing deps into `<profile>/node_modules` via Node `resolve.paths`.
  That shared fallback already contains the full apps/cli closure: cordis,
  dsh-tools, schemastery, dsh-agent, dsh-llm, dsh-session, dsh-subagent,
  dsh-web-app, dsh-base, dsh-research-web, etc.
- research-app deps (workspace:^): dsh-research-{core,tools,cordis,team,web}.
  research packages' runtime imports need, beyond the install closure:
  zod, @deepseek-ai/dsh-brand, @deepseek-ai/dsh-util-values,
  @deepseek-ai/dsh-session-persistence (the last three are monorepo source
  packages NOT in the install closure). All have built lib/ in-tree.
- All 5 research packages + the 3 peer source packages + zod are resolvable in
  the monorepo (converge on node_modules/.pnpm, the same physical store as
  apps/cli/node_modules), so a single-cordis instance is preserved.

---

## Attempt 1 — pnpm restored locally + file: specs
- packageManager read: pnpm@11.7.0 (root package.json).
- DSH_HOME=/c/Users/Leon/AppData/Local/Temp/t30-dsh-home (OUTSIDE repo; putting it
  under the repo made npm walk up to the monorepo root and die on its workspace:^ devDeps).
- pnpm restored: `npm i pnpm@11.7.0` in <profileDir> succeeded; PATH prefixed with
  <profileDir>/node_modules/.bin.
- `dsh plugin --profile web add file:<win-path>/packages/bundle/research-app` ->
  ERR_PNPM_WORKSPACE_PKG_NOT_FOUND: "@deepseek-ai/dsh-research-cordis@workspace:^"
  not present in workspace. (pnpm refuses workspace:^ outside a workspace.)
- Sanity: `dsh plugin add file:<...>/dsh-research-core` (zero deps) -> EXIT=0, added.
  So the restored-pnpm forwarder + anchored file: spec works; the blocker is purely
  the unpublished workspace:^ dependency graph.
- Mitigation considered (per task): a pnpm-workspace.yaml in the profile linking the
  monorepo root. Not pursued as the primary path because it pulls the entire
  multi-hundred-package workspace into resolution and is fragile; recorded as the
  documented failure mode.
- RESULT: FAIL at pnpm install (workspace:^). junctionUsed=no. reproducible=yes
  (exact commands above). next action: Attempt 2 (npm pack tarballs, no pnpm).

## Attempt 2 — npm pack tarballs + npm install (no pnpm)
- DSH_HOME=/c/Users/Leon/AppData/Local/Temp/t30-a2 (outside repo).
- `npm pack` each research package + research-app bundle into a temp dir
  (needed Windows drive paths `G:/...`; POSIX `/g/...` is not understood by npm/pnpm
  on Windows and produces "corrupted"/ENOENT path errors).
- `npm install --no-save <abs tgz>` for the research-app bundle ->
  EUNSUPPORTEDPROTOCOL: Unsupported URL Type "workspace:": workspace:^.
  The packed package.json still declares workspace:^ deps, which npm refuses.
- RESULT: FAIL at npm install (workspace:^ in packed manifest). junctionUsed=no.
  reproducible=yes. NOTE: a hybrid (unpack each tgz and rewrite workspace:^ to
  file: siblings) could work but was time-boxed in favour of Attempt 3.
  next action: Attempt 3 (seed profile node_modules directly; absolute-dir / dev loader).

## Attempt 3 (主线程接管) — tarball 重写 workspace:^ → file: 兄弟依赖,纯 npm 链式安装
- 6 包全部 npm pack 成功(core/tools/cordis/team/web/app tgz)。
- 解包→重写 package.json: workspace:^ research 兄弟 → file:../<name>;host peer(cordis/
  dsh-tools/dsh-brand/schemastery/dsh-agent/dsh-session*/dsh-llm/dsh-subagent/dsh-session-persistence)
  从 peerDependencies/dependencies 移除(设计: 由 boot 共享闭包 healProfilesModuleFallback 提供)。
- 关键学习: npm 目录安装=符号链接,file:../ 按 realpath 解析失效 → 必须重打 tgz 再安装(复制)。
- 结果: 纯 npm(无 pnpm、无 Junction)在临时 profile 装好 6 包 node_modules/@deepseek-ai;Node
  require 探测: **core OK、tools OK**(research 链 core→tools 独立可加载);cordis/team/app 需
  host peer(cordis 等),等待真实 boot 共享闭包解析。
- 证据: 命令序列如上可复现(DSH_HOME 外临时目录);junctionUsed=no。
- next: 建真实 DSH_HOME temp profile(web 模板)→ seed node_modules(本 6 包)→ dsh.profile.bundles
  加 research-app → `dsh web`(或 --profile research)boot 1120,验证 host peer 经 heal fallback 解析。

## Attempt 4 (主线程) — DSH_HOME profile boot 1120: **SUCCESS**
- DSH_HOME=C:/Users/Leon/AppData/Local/Temp/t30-boot (repo 外临时目录)。
- Profile init: `dsh --profile web --dump-config` → loadProfile 自动初始化 web 模板
  (bundles=[dsh-base, dsh-web-app], patchReload=live)。
- 修改 profile package.json: bundles 追加 `@deepseek-ai/dsh-research-app`。
- Seed profile node_modules(9 包,仅 package.json+lib/+cordis.patch.yml,排除 node_modules/):
  - 6 research 包(monorepo 源码副本,含 built lib/): research-app, research-cordis,
    research-core, research-team, research-tools, research-web。
  - 3 不在 install closure 的 host 依赖: dsh-brand(packages/util/brand),
    dsh-session-persistence(packages/session/session-persistence), zod(pnpm store zod@4.4.3)。
- healProfilesModuleFallback: 镜像 install closure 223 包到 $DSH_HOME/profiles/node_modules
  (共享 fallback,含 cordis/dsh-tools/schemastery/dsh-agent/dsh-session/dsh-llm/dsh-subagent 等)。
- healProfileModuleFallback: BFS 从 research-app 发现 5 research 包 → 创建 owned junctions
  (.dsh-module-fallback/node_modules/@deepseek-ai/)→ profile node_modules 已有目录副本,ensureProfileSymlink 跳过。
- **首次 boot 失败**: `cannot get property "tools" without inject` — ResearchTeamService
  构造函数 ctx.effect() → installResearchGuard() → ctx.tools.guard() 需要 tools 服务,
  但 `static inject` 数组缺少 'tools'。
- **修复**: 源码 `packages/research/dsh-research-team/src/index.ts` + built lib/index.js
  的 `static inject` 追加 'tools'(单行修改,src+lib 均改)。同步更新 profile 副本。
- **二次 boot 成功**:
  ```
  dsh web: http://127.0.0.1:1120/?token=l83y1lpj2gVuXKw9sufzyj31smPbl6HewLuHZNz5yZg
  ```
  HTTP 401(无 token) / HTTP 303(有 token,重定向到 Web UI)。
  三个 research 插件(research-cordis / research-team / research-web)全部成功挂载。
  webserver 行 override 3080→1120 生效。
- 证据: 命令序列可复现;junctionUsed=junctions(healProfilesModuleFallback+healProfileModuleFallback 创建);
  pnpmUsed=no;npmUsed=no(仅 cp + tar);workspace:^ 在 runtime/BFS 不影响(用包名而非 spec)。
- RESULT: **T30 轨道 A boot 1120 SUCCESS**。host peer 经 heal fallback 解析验证通过。
