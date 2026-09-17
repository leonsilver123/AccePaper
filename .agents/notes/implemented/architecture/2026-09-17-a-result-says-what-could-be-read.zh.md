# Agent Note: 质量结果说明「读到了什么」,不只说明「发现了什么」

Status: implemented

[English](2026-09-17-a-result-says-what-could-be-read.md) | 中文

## 问题

包清单携带 `qualityFindings`,而出货运行里它是 `[]`。这份列表由五条精确规则产出 —— 正文从不引用的对象、正文引用了而文档没有的对象、正文从不使用的参考文献表、一句没有任何引用的「前人工作」陈述、一句把测量变化的方向说反了的话 —— 而空列表只是**能读这份稿件的那些规则**的输出。读者会把它当成对论文的判定,而这正是复核拒绝的读法:「`qualityFindings: []` 只能报告已覆盖检查未发现问题。没有真实 PDF、没有正确静态图件、未知期刊必需规则或生产成功路径未验证,都不得宣称插件已能生成 TRC 投稿版本。」

这种混淆在一次运行内部就真实存在。`no-literature-position` 读的是「带参考文献表却一句不引」;一份**没有**参考文献表的文档产生同样的沉默。`metric-misread` 只对引用了本次测量变化的那句话生效;结果一节从不写出那个数字的稿件产生同样的沉默。`uncited-object` 读的是 float 名册;没有 float 的草稿产生同样的沉默。四种不同的事实 —— 一致、无物可读、从未运行、根本不是这条基线的问题 —— 全都渲染成 `[]`。

## 决定

- **`reportPaperQuality(input)` 是生产入口**,返回 `PaperQualityReport`:findings、每条规则一个 `QualityCheck`(带 `outcome`:`no-defect-found` | `defect-found` | `not-applicable` | `not-executed`,以及答不出来时的理由)、`needsDomainReview` 的问题、以及一句 `summary`。
- **规则是一张表**(`QUALITY_RULES`),于是覆盖清单不可能比跑过的规则更短。无物可读的检查会说明它需要什么:没有参考文献表、没有一句话陈述测量变化、没有 float 名册、没有草稿。
- **`needsDomainReview` 是数据而不是散文**(`DOMAIN_REVIEW_ITEMS`):这个主张是否值得检验、方法是否回答了论文的问题、每一条被引来源是否真的说了引用它的那句话所声称的内容、图是否易读、正文是否声称了测量支撑不了的东西。每一条都由人来回答,而且无论精确比较有没有发现任何东西都会被报出。
- **summary 说明这份报告**是什么**:`no defect found by the 3 check(s) that could read this manuscript; 2 check(s) could not run, and 5 question(s) need a domain reviewer` —— 永远不会说论文好。
- **清单携带这份报告**(`RunPackageManifest.quality`),因为包是读者收到的东西,而一条没有覆盖清单的空列表正是本条要替换掉的读法。
- **保留 `reviewPaperQuality`** 作为「只要 findings」的视图,并在文档里这么写:既有的逐条规则用例直接驱动规则,而只想要缺陷的调用者不必读过覆盖清单。

## 考虑过的其他做法

- **保留 `qualityFindings`,旁边加一个 `qualityCoverage` 字段。** 拒绝:两个必须一起读才有意义的字段,正是空列表被单独读出来的方式,而那就是要修的缺陷。
- **每条规则只报一个布尔 `ran`。** 拒绝:「不适用」和「未执行」的补救方式不同 —— 前者是关于稿件的事实,后者是关于运行的事实 —— 而布尔值让两者读起来是同一种沉默。
- **按稿件逐份推导领域问题,而不是用固定清单。** 拒绝:一条基线回答不了哪些问题,是这条基线的属性,不是某一篇论文的;逐份推导会让它看起来像一个发现。

## 后果

- **包的空发现列表现在随产出它的东西同行** —— `tests/package-export.spec.ts` 断言五条检查、没有 `defect-found`、评审问题、以及 summary 的措辞。
- **三种状态由测试区分**:`tests/paper-quality.spec.ts` 驱动一份与测量一致的稿件、和一份结果一节从不陈述测量值的稿件,断言两者都没有 findings,并断言它们的 `metric-misread` 结果与 summary 不同。
- **这里没有覆盖的。** 规则集没有变:覆盖清单说的是**这五条**规则里哪些读到了稿件,而不是一篇论文还需要哪些检查。领域问题被点名而没有作答 —— 把评审人的回答记在某条 item id 上还没有做。

## 文件

- `packages/research/dsh-research-team/src/runner/paper-quality.ts`(`reportPaperQuality`、`QUALITY_RULES`、`DOMAIN_REVIEW_ITEMS`、`QualityCheck`、`PaperQualityReport`)、`runner/package-export.ts`(清单以 `quality` 取代 `qualityFindings`)。
- 测试:`tests/paper-quality.spec.ts`、`tests/package-export.spec.ts`。
