# Agent Note: A start command is recoverable, or it is not idempotent

Status: implemented

English | [中文](2026-09-16-a-start-command-is-recoverable.zh.md)

## Problem

`startRun`'s idempotency was a `Map<string, ResearchRunStart>` written AFTER the run had been saved.
Two consequences, both of them the opposite of what an idempotency key is for:

- **Two calls arriving together both missed it.** The map was written after an `await`, so a second
  call could run to its own lookup while the first was still saving, and both created a run.
- **A restart could not answer a retry at all.** The map died with the process, so a caller whose
  response was lost — the exact case the key exists for — had no way to be told which run its command
  had produced, and the only safe-looking answer left was a second study.

A third gap was quiet: the same id carrying DIFFERENT research was answered with the first run, so a
caller could be handed a study it did not ask for and had no way to notice.

## Decision

**The answer to a command is recorded beside the runs it names, and the in-flight answer is
registered before anything is awaited.**

- `StartCommandRecord` (`{commandId, runId, paramsDigest, startedAt}`) is written to
  `<snapshotDirectory>/commands/<commandId>.json`, by write-and-rename, **before the run it names is
  saved**. A start whose record cannot be written FAILS: a command that cannot be recovered is worse
  than one that did not run, because the caller would hold an id nothing can look up.
- **The order of those two writes is the window between them.** Written the other way round, a
  process dying after the run's first save and before the record left a study on disk with nothing
  naming its command, and the retry — finding no record — started a second one. Written first, the
  retry always finds something, and the window's worst case is a command id that has to be replaced:
  a record whose run is missing is reported (`persisted: false`, naming the missing run) and never
  re-run, because a study that was begun may have produced something.
- **A start that did not happen takes its record back**, from the path it wrote it to rather than
  from a re-resolved directory — the snapshot root is a deployment fact read live, and a root that
  moved between the two writes would otherwise send the removal to the wrong place. If the removal
  fails the record stays, which is the safe direction: the retry refuses instead of duplicating.
- `startRun` registers a promise synchronously — `startCommandOnce` runs to its first `await` before
  the map is written, and no other call can interleave with that synchronous block — so a second
  arrival waits for the first answer instead of creating a run. A failed start deletes the entry,
  because nothing was recorded and the id is free again.
- **A digest of what the command asked for travels with it.** Retries compare equal; the same id with
  different research is refused, naming why. Across a restart the digest comes from the record.
- **A record whose run is gone is not a success.** The receipt says `persisted: false` and names the
  missing run, because "your command is known" and "your study is findable" are two facts.
- **The command id must be able to name a file** (`[A-Za-z0-9_-]{1,128}`): it becomes a path segment,
  and it is refused rather than sanitised — a sanitised id is a different id, and the next retry
  would not find it.

## Alternatives considered

**Keep the map, and add a lock.** A mutex around the lookup-and-save pair closes the concurrent
window without any durable record. It loses on the half that matters more: a restart still cannot
answer the retry, and the lock says nothing about whether the id was used for a different study.

**Store the command on the run's own snapshot.** The record would live in the run's directory rather
than its own, which reads as neater until the lookup: the lookup is BY COMMAND ID, and a run
directory is named by run id. Finding a command would mean listing every run and reading each one.

**Answer a changed request with the first run, and document it.** It is what the code did. It loses
because the caller cannot tell the difference between "my retry" and "my second study" — the digest
comparison is the only thing that can, and the refusal names which of the two it saw.

**Sanitise an unusable command id.** Stripping the characters would let the call proceed with an id
the caller never sent, so its retry — which sends the original — would create a second study. The
refusal is the only answer that keeps the id meaning one thing.

## Consequences

- The snapshot directory now holds a `commands/` subtree beside the run directories. A deployment
  with no snapshot directory configured records nothing, and its starts already fail (`persisted`
  cannot be true), so there is no silent loss of the guarantee.
- Reading an unreadable record THROWS rather than returning "no such command": an absent record
  means the command was never sent here, while an unreadable one means this deployment cannot be
  told — and treating the second as the first is how a retry becomes a second study.
- `startCommands` still grows for the life of the process. A deployment that starts many runs wants
  it evicted by age; nothing here does that yet, and the durable record is what makes eviction safe
  when it is added.
