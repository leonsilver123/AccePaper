// @deepseek-ai/dsh-research-cordis — the evidence report the live acceptance leaves behind.
//
// WHY IT IS WRITTEN AT ALL. What the live run produces is evidence a person reads: which source was
// read, at which versions, from which file, at which place, with which hash, over which route and
// under which rules. Evidence nobody can open is not evidence, so the acceptance writes both files
// into the planning corpus rather than printing them into a test log.

import type { SourceRegistration } from '@deepseek-ai/dsh-research-core'
import type { ZoteroPassage } from '../src/zotero-provider.ts'

/** How much of the page the report quotes. */
const QUOTED_CHARACTERS = 600

/**
 * The evidence report one source produces, as the text the live acceptance writes.
 *
 * EVERY FIELD IS ONE THE CHAIN COMPARES, printed so a reader can check the chain without running it:
 * the identity the registry minted, the item's version, the attachment and ITS version, the locator,
 * the hash of the words and the hash of the reply they were taken out of. The two hashes are separate
 * on purpose — one is the evidence, the other is the tool's presentation of it.
 *
 * @param source - the registration the live read produced.
 * @param passage - the page that was read.
 * @param citeKey - the key the manuscript would cite it under.
 * @returns the report's text.
 */
export function reportOf(
  source: SourceRegistration,
  passage: ZoteroPassage,
  citeKey: string,
): string {
  const binding = source.evidence
  const marked = (value: string | undefined): string => `\`${value ?? '?'}\``
  return [
    '# Evidence report: one source, read from the configured library',
    '',
    `- registry identity: ${marked(source.identity)}`,
    `- external identifier: ${marked(`${source.ref.kind}:${source.ref.id}`)}`,
    `- citation key: ${marked(citeKey)}`,
    `- registry: ${marked(source.registry)}; acquisition: ${marked(source.acquisition)}`,
    `- item version: ${marked(binding?.sourceVersion)}`,
    `- attachment: ${marked(binding?.attachment?.key)} at version ${marked(binding?.attachment?.version)}`,
    `- locator: ${binding?.locator ?? '?'}`,
    `- evidence content SHA-256: ${marked(binding?.contentSha256)}`,
    `- retrieval route: ${marked(binding?.route)}; rule version: ${marked(binding?.ruleVersion)}`,
    `- tool reply SHA-256: ${marked(passage.audit.rawSha256)}`
      + ` (${String(passage.audit.rawLength)} characters, classified ${marked(passage.audit.classification)})`,
    '',
    '## What was read',
    '',
    `The first ${String(QUOTED_CHARACTERS)} characters of page ${String(passage.page)} of`
      + ` ${String(passage.totalPages)}, with the tool's own header removed:`,
    '',
    '```',
    passage.text.slice(0, QUOTED_CHARACTERS),
    '```',
    '',
    '## What this is not',
    '',
    "Whether this passage establishes any sentence is a reviewer's judgement, and no such judgement is",
    "recorded here. The tool's reply is kept whole beside the extracted words; the content hash above is",
    "over THIS text, and the reply's own hash is recorded separately.",
    '',
  ].join('\n')
}
