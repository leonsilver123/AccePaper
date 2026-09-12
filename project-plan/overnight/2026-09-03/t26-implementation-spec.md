# T26(P4.2) dsh-research-web 双面包插件——实现级规格

> 产出:实现级规格,git 恢复合入后可照此直接建包。只读侦察(HEAD=deepseek-harness-recovered 分支 overnight/2026-09-03;模板事实已由 t26-exports-verdict 复核)。前端位置已冻结:conversation.view 新 tab id='research'(DEC-001,U3 定案;方案 A,t25-slot-verdict)。
> 本阶段范围(g):仅双面包骨架 + 空 ResearchView 占位。T27 pipeline/figure/table/gate/adversarial 子面板**不实现、不声明 slot**,下一任务。

## (a) 包位置与命名
- 目录:`packages/research/dsh-research-web`(与 dsh-research-{core,tools,team} 同组;两层深,命中 tsdown 工作区 glob `packages/*/*`)。
- 包名:`@deepseek-ai/dsh-research-web`(对齐同组 research 命名;dsh.client 机制按 package.json 字段驱动,不依赖 dsh-client-* 前缀)。
- 版本 `0.1.2-alpha.4`(与 ui-skill/dsh-research-tools 现行一致);`private: true`(同 research 组,仓库内消费)。

## (b) 文件树(逐字段模板=ui-skill/trajectory 同款)
```
packages/research/dsh-research-web/
├─ package.json        # 见 (b1);exports 六项复制 ui-skill/package.json:16-27
├─ tsconfig.json       # 见 (b2)
├─ tsdown.config.ts    # clientBundle('@deepseek-ai/dsh-research-web', ['lib/types/index.js'])
├─ src/
│  ├─ index.ts                    # Node 半(空 apply;ui-trajectory/src/index.ts 样板)
│  ├─ css-modules.d.ts            # ui-skill/src/css-modules.d.ts 逐字(*.module.css / *.css)
│  └─ client/
│     ├─ index.ts                 # 浏览器半入口:apply + export const inject(见 d/e)
│     ├─ locales.ts               # NS='research'; zh/en 字典(view.research/placeholder 键);type ResearchKey=keyof typeof zh
│     └─ ResearchView.tsx         # 空占位视图
└─ tests/
   └─ browser-plugin.client.spec.ts  # (可选,建议)trajectory client-bundle spec 改编
```
(b1) package.json 关键字段:`"type":"module","main":"lib/index.js","types":"lib/types/index.d.ts"`;`exports`={`.`:{types `lib/types/index.d.ts`,default `lib/index.js`},`./client`:{types `lib/types/client/index.d.ts`,default `lib/client.js`},`./src/*`,`./package.json`};`files`=["lib/index.js","lib/client.js","lib/types/**/*.d.ts"];scripts `bundle:"tsdown"`,`watch:"tsdown --watch"`;peer `@deepseek-ai/cordis: workspace:^`;devDeps=实际 import 的 workspace 包+`@deepseek-ai/cordis`+`@types/react`+`react`+`react-dom`(ui-skill devDeps 子集)。
(b2) tsconfig.json:`extends "../../../tsconfig.base.client.json"`;`rootDir:"src"`,`outDir:"lib/types"`;include `["src"]`;references(仅实际类型依赖):`../../../vendor/cordis`、`../../client/locale`、`../../client/ui-slots`、`../../client/ui-renderer`、`../../client/ui-conversation`(ui-trajectory/tsconfig.json 相对参照,research 组深一层用 `../../client/*`)。
(b3) 根级接线(建包必需,2 行):tsconfig.client.json `references` 增 `{ "path":"./packages/research/dsh-research-web" }`(任意处,建议 line 104 前);若含 .client.spec.ts 测试则其 `include` 增 `"packages/research/dsh-research-web/src/css-modules.d.ts"`(仿 extensions/ui-cordis 先例)。tsdown 工作区 glob 自动纳入,无需改根 tsdown.config.ts。

## (c) dsh.client 声明 + './client' 子路径
- `"dsh":{"client":{"platform":"web","inject":[...]}}`;`inject` 顺序=激活序边,复刻 ui-trajectory 五条(已知 conversation.view 消费方可运行):`@deepseek-ai/dsh-api-session-controller`、`@deepseek-ai/dsh-client-locale`、`@deepseek-ai/dsh-client-ui-conversation`、`@deepseek-ai/dsh-client-ui-renderer`、`@deepseek-ai/dsh-client-ui-session`。react/cordis/store/ui-slots/ui-primitives 为基线,**勿列**。
- 有 dsh.client 必带 `./client` 子路径且 default=lib/client.js(缺失→启动抛错;platform≠'web'→静默跳过)。

## (d) conversation.view 注册(浏览器半 apply 核心)
```ts
export const inject = ['slots','sessions','uiSession','uiConversation','locale'] // ui-trajectory 同款服务面
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-research-web: dictionaries')
  const t = ctx.locale.bind(NS)
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view', id: 'research', order: 20,
    locale: NS, label: () => t('view.research'),
    // 无 children/store/inject —— T27 子面板再随 register children 自声明,勿抢申 slot 行
  }, ResearchView))
}
```
- 类型侧 import(type-only,value 禁):`type {}` from `@deepseek-ai/dsh-client-ui-conversation/client`(SlotMap 行)、`.../ui-renderer/client`(ctx.slots)、`.../locale/client`(ctx.locale);`type {}` declare module '@deepseek-ai/dsh-client-ui-slots' { LocaleNamespaceMap{ research: ResearchKey } }`(对齐 ui-skill client/index.ts:78-84)。
- `ResearchViewProps = ConvViewProps & PropsLocale<'research'>`(TrajectoryView.tsx:129-135 去 InjectFace/PropsRenderSlots 版);占位渲染 + 内联 module css。
- 与 chat(order0)/trajectory(order10)并存:conversation.view 是 list/session,view tab 条在 ≥2 view 时出现;id 'research'/order 20 不冲突,无需改任何 shipped 包。

## (e) 浏览器半纪律
- 禁跨插件 value-import(purity gate,tsdown.client.ts resolveId dsh-client-bundle-purity):一律 `import type {}` 取类型合并;运行时协作走 `ctx.*` 服务。非基线运行时依赖才进 `dsh.client.external`(本骨架无)。
- CSS:`.module.css` 打包内联为 factory 注入样式(lightningcss),`files` 无需 css;虚拟 loader 处理 import 解析。
- Node/浏览器半不互 import value;跨半共享 const/type 仅在单侧声明 + 类型 re-export。

## (f) 验收命令(合入 master 后、建包现场执行)
1. 前置:`pnpm install` 解析新 workspace 引用。
2. 类型产 lib/types:`pnpm --filter @deepseek-ai/dsh-research-web exec tsc -b`(或根 `tsc -b tsconfig.client.json`)。
3. 双工件 + purity gate:`DSH_BUILD_FACE=client pnpm --filter @deepseek-ai/dsh-research-web bundle` → 产出 `lib/index.js`+`lib/client.js`,任一 @deepseek-ai value-import 即红。
4. dev watch(face 未设):`pnpm --filter @deepseek-ai/dsh-research-web watch` 直编 `src/client/index.ts`。
5. 冒烟(若含 spec):先 build 再 `pnpm vitest run packages/research/dsh-research-web/tests/browser-plugin.client.spec.ts`,断言 register 后 conversation.view 出现 'research' 项。
6. 人工:切到含会话 UI,见新 tab '科研'(≥2 view 才出 tab 条),点入为空占位、不炸控制台。

## (g) 本阶段范围(锁)
- 交付物:上述 8 源文件 + 根接线 1-2 行。空 ResearchView 占位文本 + module.css。
- 明确不做:T27 pipeline 进度/figure/table/gate/adversarial 子面板、自声明子 slot、uiSession.provide hooks、composer dock(B)/approval detail(C)/tool.call.toolview(D) 任何注册;数据源解析。研究 tool 包(dsh-research-tools)仅类型可引,本骨架不 import。

## (h) 风险分级
- P0:无。
- P1:无阻断;不新增用户裁决项(U3 已冻结)。唯一"运行可见性"前提=插件名须进宿主运行时插件使能清单(类比 ui-trajectory 靠用户 cordis.yml 加载)——属部署组合配置,非本包文件,合入后由接线方确认,记档即可。
- P2:①漏根接线(tsconfig.client.json references/css include)→ 不进 client 类型方案或测试被 css 类型卡住;②浏览器半 value-import 违反 purity gate(建包红,可捕);③漏 platform:'web'(静默跳过)/漏 './client'(启动抛错),均有构建/启动期测试可捕;④tsconfig references 与 devDeps 只许列实际 import,勿贪多(多列 refs 无 harm 但漂移);⑤trajectory 五条 inject 有两条(api-session-controller/ui-session)本骨架未直接消费——保留以锁运行序与 T27 hooks 通路,勿自行裁剪。⑥WBS T26 行 J2 过期措辞更正(t26-exports-verdict(d)-P2①)仍待执行。

## 实现前裁决项
- 无(预期无)。前端位置(U3/DEC-001)、方案 A、模板 ui-skill/trajectory、order 20 均已定案。唯一需接线方备忘的是 (h)P1 的宿主使能清单登记,非阻塞。
