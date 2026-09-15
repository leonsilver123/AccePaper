# Agent Note: The reproducible package is written, not proposed

Status: implemented

English | [中文](2026-09-14-run-package-export.zh.md)

## Problem

`E1-format`'s artifact carried a `reproduciblePackage` field shaped like this:

```ts
reproduciblePackage: {
  produced: false,
  files: ['manuscript.md', 'experiment-tables.md', 'figures/figure-1.svg', 'roadmap.md', 'run-manifest.json'],
  note: 'PROPOSED package layout, NOT produced: no step writes these files…',
}
```

The honesty was in the `produced: false` flag and the note, and both were easy to lose: five filenames beside a produced manuscript read as run output at a glance. Nothing in the repository wrote any of them, so "reproducible package" named a proposal rather than a product, and a reader had no way to tell which of the listed files existed except by looking.

The other half of the same gap: the numbers were already traceable inside the run — `E1` computes the results table from the same measurement the C gate adjudicated — but nothing carried that fact out of the process in a form a reader could check.

## Decision

Two changes, split along what produces what.

**`E1` produces the package files it owns, as CONTENT.** Its artifact carries `packageFiles`, a map of path to body, and `packageSources`, a parallel map naming the producer of each. `roadmap.md` is a mermaid block, `figures/figure-1.svg` is the SVG the figure tool rendered, `experiment-tables.md` is the three-line-table render, `manuscript.md` is the assembled document.

A path whose content is empty is **omitted**, never declared. That is the rule that makes "presence means content" true: an upstream step that did not run leaves E1 with nothing for that path, and a declared-but-empty file is the defect this replaced in miniature.

**A new exporter writes the package to disk** (`dsh-research-team/src/runner/package-export.ts`). It adds the run-level files E1 cannot own — `run-summary.md`, `steps.json`, `claim-evidence.json`, `citations.json`, `experiment.json`, `reproducibility.md` — and then writes everything:

- `planRunPackage(store, run)` is pure with respect to the filesystem; it reads the run store and returns content, so a spec asserts on the package without a directory.
- `writeRunPackage(plan, directory)` writes each file, re-reads it through `statSync`, and refuses a zero-byte result. The manifest is written **last**, so a manifest that exists means the files it names were written.
- The manifest records each file's path, byte count and SHA-256, plus the per-step record (step, status, attempt, channel, producer, output slugs, verdicts) and a `numberSources` map naming where each figure came from.

`sanitizeForExport` runs over every value before it is written: a field whose KEY names a secret is dropped outright rather than redacted, and a machine path is reduced to its final segment. The manifest records no absolute directory.

**Where it writes is a deployment setting**, `packageDirectory` on `ResearchEngine`, read by the runner-side service. Like `casePackDirectory` it is deliberately not a request field: `runPipeline` is reachable as a Remote method, and a client-supplied path would let a browser choose where the host writes files. A failed export is reported in `snapshot.packageExport.error` rather than swallowed — a caller told a package exists who finds none has been misled.

## Admission and ownership

`E1` owns its own products because it is what assembles them. The exporter owns the run-level files and the writing, because it is the only component that sees the whole run and the store at the same time. The store lives for one `runPipeline` call, which is why the export happens inside that call rather than in a later `exportRun` method.

## Alternatives considered

**Keep the filename list and flip `produced` to true.** Rejected: the list would still be a claim about files rather than the files, and nothing would check it.

**Have the exporter gather everything, including the manuscript.** Rejected: E1 already assembles the manuscript and the table from the run's own artifacts; re-deriving them in the exporter would be a second implementation of the same assembly, and the two could disagree.

**Patch `reproduciblePackage` on the recorded artifact after the export.** Rejected: run artifacts are immutable once a step completes, and rewriting one after the fact would break the property that a recorded artifact is what the step produced.

**Write the package whenever a run finishes, with a default directory.** Rejected: an unconfigured deployment would start writing files nobody asked for. No directory means no package, which is stated rather than inferred.

## Consequences

**`citations.json` shipped the artifact, not the records, until 2026-09-15.** The exporter wrote
`ledger: landscape?.records ?? landscape ?? null`. A1's landscape artifact carries its records under
`hits`, so `records` was never a field, the fallback always won, and the file held the whole LABELLED
artifact — `__producer`, `__kind`, `__provenance`, the corpus note and all — under a key that says
"ledger". A reader looking for a DOI had to know to reach through `ledger.hits`, and nothing in the
file said so. It is `landscape?.hits ?? null` now.

Two things kept it invisible, and they are the reason it is written down here rather than just fixed:
no test asserted the file's shape, and the fallback made the wrong answer a *plausible* one — a file
full of citation-looking content that a person would not look at twice. It was found by the browser
probe's S4 assertions on a real run, which asked for rows and got zero.


- Every file the manifest names really exists, is non-empty, and carries a digest a reader can recompute. The spec drives a REAL 16-step run and then writes the package, so the assertion is against what the engine produced rather than against a hand-built store.
- `E1`'s artifact no longer contains a field that can be read as an export that did not happen.
- A stopped run still produces a package: it documents where the run stopped and why, which is the honest artifact of a run that ended on a failed gate.
- The package is a record of a SYNTHETIC run. Its own summary says so, and the files holding synthetic measurements carry the pack's `mock`/`synthetic_deterministic` provenance where they came from it.
