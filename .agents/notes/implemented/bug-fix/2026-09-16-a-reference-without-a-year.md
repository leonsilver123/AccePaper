# Agent Note: A reference without a year

Status: implemented

English | [中文](2026-09-16-a-reference-without-a-year.zh.md)

## Problem

Every reference the pipeline exported named a venue, a set of authors and a DOI, and no year. In one
real run's package, all 25 entries looked like this:

```json
{ "id": "W2995076523",
  "venue": "IEEE Transactions on Vehicular Technology",
  "title": "Compensation of Communication Delays in a Cooperative ACC System",
  "ref": { "kind": "doi", "id": "10.1109/tvt.2019.2960114", "authors": ["Haitao Xing", …] } }
```

A reader cannot place that in time, and a citation without a year is not a citation a journal
accepts. The catalogue had the year the whole time.

**Every layer of the chain knew about the year except the one that provided it.**

- `OpenAlexWork` declares `publication_year` (`openalex-adapter.ts:38`) and `toHit` never read it;
- `LiteratureHit` (`literature-search/adapter.ts:55`) had no `year` field to put it in — so the
  adapter had nowhere to hand it over even if it had read it;
- `buildReferences` (`registry.ts:702`) built `{title, venue, identifier, authors}` entries;
- `formatReference` (`paper-format.ts:302`) **already accepted and rendered `year`**, and its own
  doc comment says it is built from the fields "so a missing year or venue is visibly absent";
- E1 (`registry.ts:2932`) **already read `year`** off every entry.

The rendering half was written, tested and waiting. Nothing produced the value.

## Decision

The year travels with the hit, and an unknown year stays unknown.

`LiteratureHit.year?: number | undefined` is optional; `toHit` reads `work.publication_year`
through `asYear`, which accepts an integer in `[1000, 9999]` — including a numeric string, which
some proxies emit — and returns `undefined` for anything else. `buildReferences` carries it onto the
reference entry as a number, or as `null` when the catalogue did not state one.

**A fabricated year is not a missing field; it is a wrong citation.** A record whose year is `null`,
`"forthcoming"`, or `12020` gets no year, and the reference renders with the field visibly absent —
which is what `formatReference` was built to do. Coercing those to a number would have replaced a
visibly incomplete reference with one a reader has no way to question.

## Alternatives considered

**Widen `ResolvedCitationMetadata` in core.** Rejected as unnecessary: that type is the citation
identity chain's metadata (title, authors, retracted, ruleVersion) and the verifier compares it to
decide whether an identifier resolves to the record it claims. A year takes no part in identity, so
adding one there would put a display field inside a verification contract.

**Render "n.d." for an unknown year.** Rejected: `formatReference`'s contract is to state what is
missing by leaving it out, not by writing a string that reads like a value. `n.d.` is a citation
convention a reader must decode; an absent field needs no decoding.

**Put the year on the citation ref rather than on the hit.** Rejected: `LiteratureCitationRef` is
shaped as a structural subset of core's `CitationRef`, which carries an identifier and a title. The
year belongs to the record the catalogue returned, which is the hit.

**Leave the synthetic corpus without years.** Rejected: the fixture would then exercise only the
absent-year branch, and the renderer's year branch would be covered by the live catalogue alone —
which is the arrangement that let this defect live through 1700 passing tests.

## Consequences

- `tests/openalex-adapter.spec.ts` pins the year reaching the hit, a numeric-string year, and the
  three shapes that must NOT become one (`null`, an unparseable string, a five-digit year).
- `tests/e2e/closed-loop.spec.ts` pins the whole chain on a production run: every reference entry
  carries a number, and the first one appears in the assembled manuscript — the document a reader
  gets, not only the artifact behind it.
- The synthetic corpus states a year per row, so the fixture covers the renderer's year branch.
- **The export is not retroactive.** Packages already written keep their yearless references; the
  fix applies to runs after it.
