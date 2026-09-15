# Agent Note: 可复现包是被写出来的,不是被提议的

Status: implemented

[English](2026-09-14-run-package-export.md) | 中文

## 问题

`E1-format` 的产物带一个 `reproduciblePackage` 字段,长这样:

```ts
reproduciblePackage: {
  produced: false,
  files: ['manuscript.md', 'experiment-tables.md', 'figures/figure-1.svg', 'roadmap.md', 'run-manifest.json'],
  note: 'PROPOSED package layout, NOT produced: no step writes these files…',
}
```

诚实之处在 `produced: false` 这个标志和那句说明上,而这两样都容易被丢掉:五个文件名摆在一份**已产出**的稿件旁边,一眼扫过去就是"运行产物"。仓库里没有任何东西写其中任何一个文件,所以"可复现包"命名的是一个提案而不是产物,而读者除了逐个去看,没有办法知道列出的文件哪些真的存在。

同一个缺口还有另一半:数字在运行内部本来就是可追溯的 —— `E1` 用的是 C 门禁裁定的**同一份**测量来算结果表 —— 但没有任何东西把这个事实以读者能核对的形式带出进程。

## 决定

两处改动,按"谁产出什么"来切分。

**`E1` 产出属于它自己的那些包内文件,以内容的形式。** 它的产物带 `packageFiles`(路径 → 正文的映射)和 `packageSources`(平行的、指名每个文件产出者的映射)。`roadmap.md` 是 mermaid 块,`figures/figure-1.svg` 是图工具渲染出的 SVG,`experiment-tables.md` 是三线表渲染结果,`manuscript.md` 是装配出的文档。

内容为空的路径被**省略**,而不是被声明。正是这条规则让"存在即内容"为真:上游步骤没跑,`E1` 对那个路径就什么都没有,而"声明了但为空"正是本次要替换掉的缺陷的缩小版。

**新增一个导出器把包写到盘上**(`dsh-research-team/src/runner/package-export.ts`)。它补上 `E1` 无法拥有的运行级文件 —— `run-summary.md`、`steps.json`、`claim-evidence.json`、`citations.json`、`experiment.json`、`reproducibility.md` —— 然后把整批写出:

- `planRunPackage(store, run)` 对文件系统是纯的:读 run store、返回内容,于是 spec 不需要目录就能对包做断言。
- `writeRunPackage(plan, directory)` 逐个写文件,再经 `statSync` 复核,零字节即拒绝。**manifest 最后写**,所以 manifest 存在就意味着它指名的文件都写过。
- manifest 记录每个文件的路径、字节数与 SHA-256,加上逐步记录(步骤、状态、attempt、通道、产出者、输出 slug、判据)与一个 `numberSources` 映射,指名每个数字从哪来。

`sanitizeForExport` 在写入前跑过每个值:**键名**表明携带密钥的字段被整条丢弃(而不是涂黑),机器路径被压成最后一段。manifest 不记录任何绝对目录。

**写到哪里是部署设置** —— `ResearchEngine` 的 `packageDirectory`,由 runner 侧服务读取。与 `casePackDirectory` 一样,它刻意**不是**请求字段:`runPipeline` 作为 Remote 方法可达,客户端提供的路径等于让浏览器决定宿主往哪写文件。导出失败会**报告**在 `snapshot.packageExport.error` 里,而不是被吞掉 —— 被告知"包存在"却在盘上找不到,比被告知导出失败更糟。

## 归属与边界

`E1` 拥有它自己的产物,因为装配它们的就是它。导出器拥有运行级文件与写盘,因为它是唯一同时看到整个运行与 store 的组件。store 只活在一次 `runPipeline` 调用期间,所以导出发生在那次调用**之内**,而不是事后的 `exportRun` 方法里。

## 考虑过的替代方案

**保留文件名清单,把 `produced` 翻成 true。** 否决:清单仍然只是关于文件的声明而不是文件本身,而且没有任何东西会去核对它。

**让导出器把包括稿件在内的一切都收集起来。** 否决:`E1` 已经从运行自己的产物装配出稿件与表格;在导出器里重新推导等于同一套装配的第二份实现,而两者可能不一致。

**导出后回填已记录产物上的 `reproduciblePackage`。** 否决:运行产物在步骤完成后是不可变的,事后改写会破坏"已记录的产物就是该步骤产出的东西"这一性质。

**每次运行结束都写包,给一个默认目录。** 否决:未配置的部署会开始写没人要的文件。没有目录就没有包,这是**声明**出来的而不是被推断的。

## 后果

**`citations.json` 交出的是工件,不是记录 —— 直到 2026-09-15。** 导出器写的是
`ledger: landscape?.records ?? landscape ?? null`。A1 的 landscape 工件把记录放在 `hits` 下,所以
`records` 根本不是字段,兜底永远胜出,文件里装的是**整个带标签的工件** —— `__producer`、`__kind`、
`__provenance`、语料说明一应俱全 —— 却挂在一个叫 "ledger" 的键下面。想找 DOI 的读者必须知道要穿过
`ledger.hits` 去拿,而文件里没有任何东西这么说。现在是 `landscape?.hits ?? null`。

有两件事让它一直看不见,也正是它被写在这里而不是只被修掉的原因:没有任何测试断言过这个文件的形状;
而那个兜底让**错的**答案看起来是**合理的** —— 一份满是看着像引用的内容、人不会看第二眼的文件。
它是被浏览器探针在真机运行上的 S4 断言找出来的:断言要行,拿到 0 行。


- manifest 指名的每个文件都真实存在、非空,并带一个读者能重算的 digest。spec **真实驱动一次 16 步运行**再写包,所以断言针对的是引擎产出的东西,而不是一个手搭的 store。
- `E1` 的产物不再含有一个能被读成"一次并未发生的导出"的字段。
- 停下的运行照样产出包:它记录运行停在哪里、为什么停 —— 那才是一次终于失败门禁的运行该有的诚实产物。
- 这个包是**合成**运行的记录。它自己的摘要这么写着;承载合成测量的文件则带着来自 Case Pack 的 `mock`/`synthetic_deterministic` 来源标注。
