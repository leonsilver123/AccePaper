# Agent Note:C 门禁裁的是**声明的**阈值,不是解析出来的数字

Status: implemented

[English](2026-09-14-threshold-declared-not-parsed.md) | 中文

## 问题

C 门禁判定一条书面预测是否被实验满足,它裁三个输入,其中两个是**声明的**:`metricKey`,以及带 `direction` 与 `bound` 的 `PredictionCommitment`。第三个 —— 阈值,即"至少 20%"里的 20% —— 是从预测的**散文**里**解析**出来的。模块自己的注释就写着:"The gate grades two declared bits plus a parsed number."

解析出来的阈值可以属于别的东西。句子写出的百分数附着在另一个量上,门禁就拿一个 claim **从未施加于被测量**的数字去评分。审计者保持声明逐字节相同、只改散文里的数字:5% 与 20% 判 `supported`,99% 判 `refuted`。另有审计者用 `The platoon mean headway shall fall by at least 20% together with the platoon minimum time-to-collision` 拿到 `supported`(20% 属于车头时距),以及用 `; that outcome is forbidden` 结尾的从句拿到同样的结果。可达集合是**开放**的:`while` 是子句边界而它的同义词 `whilst` 不是;`together with`/`along with`/`as well as`/`plus`/`relative to`/`compared with`,以及一个不带任何连接词的分词附加语,全部绕开它。

用**收窄句子可接受形状**来关闭这一类,有四次尝试被实测,四次都死在同一件事上 —— 判别材料是**述谓结构**,而每一个字面代理量都是开放类:

- **扩子句边界表**:不封闭,而且会误拒诚实句 —— `The platoon minimum time-to-collision together with the platoon mean headway shall fall by at least 20%` 由两个主语共用一个阈值,会被 HOLD。
- **要求被测量短语出现在方向结构之前**:会拒掉 `The insertion of one AV shall lower the platoon minimum time-to-collision by at least 20%` —— 干预作主语、被测量作宾语,是陈述效果最自然的英文,且出货 pack schema 明文接受。
- **要求被测量短语是谓词的论元**:需要它前面那个复合名词前置修饰语,而那是开放类(每个 pack 都能给自己的车队起名)。而且**是论元不等于附着**:`The intervention shall lower the platoon minimum time-to-collision thereby reducing the platoon mean headway by at least 20%` 满足论元地位,却把数字绑在车头时距上。
- **收窄到唯一模板**:`The minimum time-to-collision is unaffected though the mean headway shall drop by at least 20%` 满足模板,照样逃逸。

## 决定

把阈值**声明**出来。`PredictionCommitment` 与 `direction`、`bound` 并列携带 `thresholdPct`,判决是**声明与实测**的函数。散文把数字放在哪里不再决定任何事,所以这一类不需要被关闭 —— 它不再存在。

散文保留两项职责:必须**恰好一次**地写出声明的数字(两个值之间的**等式**,不是对句子的读取),以及它携带的 anchor 字面量与方向词仍与声明做**字符串相等**比较;不一致即 HOLD。

子句范围**保留,但主张被降级**。`measuringClause` 定位的是字面量**从哪里读**的子句 —— 因为第二个子句可以合法地携带自己的数字或 anchor,整句读会误拒这样的诚实句。它**不再**声称子句内的字面量**是关于**这个量的;那正是四次尝试未能建立、而模块如今不再主张的东西。切不开与切得过细,两种失败都到不了判决。

`case-pack.ts` 在**加载期**校验声明,残缺即拒,错误码 `CASE_PACK_COMMITMENT_INVALID`:声明了却缺 `thresholdPct` 是**自包含的畸形材料**,不是证据缺口;把它读成"没有声明"会让 run 因一个 pack 从未陈述的原因而 hold。未经校验的阈值是可测的:`thresholdPct: 0` 或负值时,**任何移动都满足**一条 `at-least` claim。完全不声明 commitment 仍然合法,claim 因此不可裁。

## 考虑过的其他方案

**把逃逸记为已知限度、机制不动。** 否决:门禁写下的证据仍会说"the measurement supports the prediction",而支撑它的数字来自另一个量。那是系统对**自己的 claim-实验关系**说的一句假话,本仓库的前提不允许;只有在阈值无法搬动时,才退而求其次去收窄措辞。

**让散文完全不携带数字,使这一类不可能存在。** 同一想法的更强形式,并且连一致性检查一起删掉。为更小的改动否决:下游有三处消费者读散文数字(`red-stat`、`thresholdLabel`、提示词),散文里没有数字就得从声明补给他们。

**继续收窄句子形状。** 依上面四次实测否决。每次收窄也要付出真实句子的代价,而代价是可测的:及物句式与共用主语的并列都是诚实英文,且出货 schema 明文接受。

**让声明本身可对句子验证。** 不可能:那是同一个问题上移一层。`subject` 对散文验证就是附着问题,而附着正是任何字面规则都无法建立的东西。

## 后果

这是一次**持久格式断裂**。`PredictionCommitment` 写在 claim 工件上、由恢复路径读回;携带两字段 commitment 的旧快照恢复后 C 通道 hold。按 pre-release 立场这是允许的,但**它是断裂,不是"读得更严"**。

管线里少了一道检查。旧门禁拒绝"字面量挂到别的量上"的句子 —— 那是附着检查的**副作用**而非它的目的,但它**确实是管线里唯一拒绝它们的**。一句对被测量作了错误描述的预测,如今会不受阻拦地进入 `red-stat` 的 `found:` 行、进入正文、进入导出包。此处按**产品层损失**接受,而非门禁层损失。
