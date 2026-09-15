# Agent Note: The JSDoc reader stripped one space, so a present tag was reported missing

Status: implemented

English | [中文](2026-09-15-jsdoc-reader-one-space.zh.md)

## Problem

`scripts/jsdoc.ts` normalizes each line of a doc block with `/^\s*\*?\s?/` — at most **one** space after the asterisk. Standard JSDoc, and this repository's older files, write two: ` *  @param x - …`.

The consequence is not a formatting quibble; it is a wrong answer about the input.

- **`parseTags` did not see the tag at all.** After a one-space strip the line is ` @param x - …`, which does not match the anchored `/^@param\s+/`, so the tag is not registered. `verify-export-jsdoc` then reports `is missing @param x` for a tag that is **visibly present** three lines above the declaration. Measured while documenting the research packages: 13 such tags in `dsh-research-team` alone were reported missing and were in fact already written, and the same class appeared in the other three packages.
- **`parseJsDoc` read the tag as description prose.** A line it does not recognize as a tag falls through into the description, so `gen-config-catalog` and `gen-persistence-catalog` would print a parameter tag as a sentence of the block's prose.
- **Neither behaviour was recorded anywhere.** `.agents/notes/README.md`'s format section states no spacing rule, and `scripts/jsdoc.ts` had no test. The trap was findable only by being told about it, which is how this batch found it.

A gate that reports a present tag as absent is wrong about its own input: a reader who trusts the message writes a second tag beside the one already there, or deletes a correct one as a "duplicate" the gate never reported.

## Decision

**Strip the whole leading run of whitespace after the asterisk** — `\s*` in place of `\s?`, in both normalizers in `scripts/jsdoc.ts`. This is the spelling JSDoc's own tooling accepts; the one-space limit was an implementation artifact with no rule behind it, and it is not a formatting standard this repository states or enforces.

Six cases now pin the reader in `scripts/jsdoc.spec.ts`, covering both spellings for tags, for description prose, and for a tag's continuation line.

## Alternatives considered

**Keep strict parsing and fail loud on a two-space tag.** Rejected: it would invent a formatting rule the repository does not state, and reject files that are valid JSDoc. Failing loud is for input that violates a contract; here there was no contract, only a parser that could not read it.

**Leave the parser and document the two-space trap where writers would meet it.** Rejected: the gate would keep giving a false answer about a well-formed block, and the documentation would be teaching readers to work around a defect instead of removing it. The trap is also invisible at the point it bites — the block looks right.

**Convert every two-space tag in the tree to one space and stop there.** Rejected as the fix, though it is what the batch did in the files it touched: it leaves the reader unable to parse a form that its own repository contains, so the next writer who copies an old block re-arms the trap.

**Also enforce one space with a lint rule.** Not taken: nothing asks for one spelling, and a second mechanism guarding a preference the repository never stated adds a rule to maintain for no contract.

## Consequences

**Behaviour on the current tree is unchanged, and that is measured.** All four consumers produce identical output after the change: `verify-export-jsdoc` stays at zero, and both catalogs report up to date. What changed is what the reader does with input the tree does not currently contain — which is precisely the input that produced the false reports.

**The list-item path was affected too.** `parseJsDoc` decides "this line begins a list item" on the line as it stands after normalization, not trimmed, so an item indented past the asterisk was not recognized as one. The widened strip fixes that path as a side effect; the last case in the spec pins it.

**The gate's answer and the parsed answer now agree.** `verify-export-jsdoc` no longer reports a tag that its own reader can now see, which is the property that made this worth fixing rather than documenting.
