# Agent Note: 一条没有年份的参考文献

Status: implemented

[English](2026-09-16-a-reference-without-a-year.md) | 中文

## Problem

流水线导出的每一条参考文献都有 venue、有一组作者、有一个 DOI,**没有年份**。一次真实运行的包
里,25 条全是这个样子:

```json
{ "id": "W2995076523",
  "venue": "IEEE Transactions on Vehicular Technology",
  "title": "Compensation of Communication Delays in a Cooperative ACC System",
  "ref": { "kind": "doi", "id": "10.1109/tvt.2019.2960114", "authors": ["Haitao Xing", …] } }
```

读者没法把它放进时间里,而没有年份的引用也不是期刊会接收的引用。日期**目录一直都有**。

**这条链上每一层都知道年份,除了那个提供它的人。**

- `OpenAlexWork` 声明了 `publication_year`(`openalex-adapter.ts:38`),而 `toHit` 从不读它;
- `LiteratureHit`(`literature-search/adapter.ts:55`)**没有 year 字段**可以放它 —— 所以即便读了,
  适配器也无处交付;
- `buildReferences`(`registry.ts:702`)构造的是 `{title, venue, identifier, authors}`;
- `formatReference`(`paper-format.ts:302`)**早就接受并渲染 `year`**,它自己的文档注释写着它按字段
  构造,"于是缺失的年份或 venue 是**可见地**缺失的";
- E1(`registry.ts:2932`)**早就从每个条目读 `year`**。

渲染那一半写好了、测过了、在等着。没有任何东西产出那个值。

## Decision

年份跟着 hit 走,而未知的年份保持未知。

`LiteratureHit.year?: number | undefined` 可选;`toHit` 经 `asYear` 读 `work.publication_year`,后者
接受 `[1000, 9999]` 区间内的整数(也包括某些代理会发出的数字字符串),其余一律返回 `undefined`。
`buildReferences` 把它作为数字带上引用条目,目录没说时带 `null`。

**被编造出来的年份不是缺失字段,而是一条错误引用。** 一条 year 为 `null`、`"forthcoming"` 或
`12020` 的记录拿不到年份,引用就以**可见缺失**的样子渲染 —— 这正是 `formatReference` 被写成要做的
事。把它们强行转成数字,等于把一条看起来不完整的引用换成一条读者无从质疑的引用。

## Alternatives considered

**扩 core 的 `ResolvedCitationMetadata`。** 拒绝,没有必要:那个类型是引用身份链的元数据(title、
authors、retracted、ruleVersion),校验器比对它来判断一个标识符是否解析到它所声称的那条记录。
年份不参与身份判断,把它加进去等于在一个校验契约里放一个展示字段。

**未知年份渲染成 "n.d."。** 拒绝:`formatReference` 的契约是靠**省略**说明缺失,而不是写一个读起来
像值的字符串。`n.d.` 是一条需要读者解码的引用惯例;缺失的字段不需要解码。

**把年份放在 citation ref 上,而不是 hit 上。** 拒绝:`LiteratureCitationRef` 的形状是 core 的
`CitationRef` 的结构子集,后者带一个标识符和一个标题。年份属于目录返回的那条记录,也就是 hit。

**合成语料不给年份。** 拒绝:那样 fixture 只会跑到"年份缺失"那一条分支,渲染器的年份分支就只被
实时目录练到 —— 而这正是让这个缺陷活过 1700 条通过测试的安排。

## Consequences

- `tests/openalex-adapter.spec.ts` 钉住年份到达 hit、数字字符串年份、以及**三种不得变成年份**的形状
  (`null`、无法解析的字符串、五位数年份)。
- `tests/e2e/closed-loop.spec.ts` 在一次 production 运行上钉住整条链:每个引用条目都带数字,且第一条
  出现在汇编后的手稿里 —— 读者拿到的**文档**,而不只是它背后的工件。
- 合成语料逐行给出年份,于是 fixture 覆盖到渲染器的年份分支。
- **导出不追溯。** 已经写出的包保留它们没有年份的引用;这个修复只对之后的运行生效。
