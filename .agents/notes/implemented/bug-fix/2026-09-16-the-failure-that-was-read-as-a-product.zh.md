# Agent Note: 那次被读成产物的失败

Status: implemented

[English](2026-09-16-the-failure-that-was-read-as-a-product.md) | 中文

## Problem

有两处把失败变成了成功。两处都是对照 `project-plan/architecture-review-2026-09-15/` 做完成度复核时
查出来的,而且与 D4 那个解析器缺陷是同一个物种:有东西出错了,而流水线记下的是它成功了。

**1. 超时结束了 attempt,却把活留在那里跑。** `runStep` 把**调用方的** `AbortSignal` 交给执行体。
超时时它把 attempt 结算为 `timeout`,别的什么都不做 —— 于是执行体无从得知自己的时间到了。它继续
攥着一次模型调用、一个子进程或一次仿真,而那个结果会被当作迟到结果丢掉,attempt 自己的记录里只
写着这一步超时了。

**2. 失败的轮次把它的部分文本返回了。** `LlmProseWriter.write` 把失败原因读在**零长度分支里面**:

```ts
const text = assistantTextFrom(events)
if (text.length === 0) {
  const failure = lastTurnErrorFrom(events)
  if (failure !== undefined) throw new Error(`... failed before the model produced text: ${failure}`)
  throw new Error('... the model produced no text')
}
return { text, ... }
```

只要有文本,就足以返回一个产物。一个会话的第一轮写了几句、第二轮死掉 —— 流中途的 provider 错误、
被取消的请求、再也没回来的工具调用 —— 就会带着那几句 resolve,而该步认证了一段没有任何轮次写完的
散文。唯一记录原因的地方,是一条没人读的 `turn/end`。

## Decision

**执行体的取消是它自己的。** `runStep` 为每次 attempt 建一个 `AbortController`;调用方的 abort 与
超时都会 abort 它,而执行体拿到的就是它的 signal。超时把**预算**写成 abort 的 reason,于是执行体
能报告"超过了 N ms 预算",而不是一个光秃秃的取消。

**失败的轮次就是失败的写入。** 失败检查先跑,消息里同时带原因与被拒的未完成文本长度。而失败读的是
**最后一条** turn end:`lastTurnErrorFrom` 现在每遇到一条 `turn/end` 就重置自己的答案,于是"更早一轮
失败、更后一轮成功"是一个**恢复了**的会话,不是失败的会话。旧实现返回日志里最近的一次失败 —— 那会
把一个恢复了的会话判成失败。

## Alternatives considered

**超时后等待执行体收尾。** 暂拒:它需要自己的一个界(否则一个无视 signal 的步骤会把这个超时本来
要防的挂起重新引回来),而流水线没有第二个界可以给它。这条限制写进了 README —— 超时**取消**,不等。

**只在超时时 abort,仍然把调用方的 signal 交给执行体。** 拒绝:执行体只有一条 signal 可以查,而它要
回答的问题是"我还该继续跑吗" —— 调用方走了、或者预算用完了,答案都是不该。

**保留失败检查的位置,在上面再加一条。** 拒绝:两条检查一个含义,它们就是这样漂移的。写入不得返回
文本只有一个理由,而它现在只在一个地方。

**把日志里任何一次失败的轮次都当成写入失败。** 拒绝:会话可以跨轮恢复,判它失败等于把一个写完的
回答报成失败 —— 那正是被修的这个缺陷的镜像。

## Consequences

- `tests/pipeline.spec.ts` 钉住:执行体拿到一条 signal、超时会 abort 它、reason 里写明预算。
- `tests/llm-prose-writer.spec.ts` 钉住两轮的形状:第一轮写出文本并索要一个工具,第二轮死掉,写入
  被拒且消息里点名了部分文本的长度。
- 两处拒绝都保住了本来就能工作的情形:迟到的结果仍然被丢弃而不是被写入,而一个正常结束却没有文本
  的轮次仍然报"没有文本",不是报失败。
- **查出这些的那次复核是 `project-plan/architecture-review-2026-09-15/REMEDIATION-STATUS-2026-09-16.md`**,
  它也记下了这份 plan 还要求过、却没有拿到的东西。
