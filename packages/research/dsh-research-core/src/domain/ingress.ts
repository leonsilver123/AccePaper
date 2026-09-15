/**
 * The vocabulary every domain-object parser shares: a typed parse result, stable failure codes,
 * and the primitive readers those parsers are built from.
 *
 * Domain objects cross three boundaries this package cannot type: a file, a model's JSON, and a
 * queued record. `Trust TypeScript at typed same-process boundaries` does not reach any of them,
 * so each gets a parser that reads `unknown` and either returns the object or names what was
 * wrong with it. The parsers return a failure rather than throwing, because a caller reading a
 * stored record needs to report which field was bad, not to catch an exception whose message it
 * would have to re-parse.
 *
 * The readers below never coerce. A number that arrives as a string is not read as a number, and
 * a hash of the wrong length is not trimmed to fit: both are the class of lenient reading that
 * makes an invalid record look valid.
 */

import type { ContentHash, InputDigest } from './ids.ts'
import { DOMAIN_ERROR_PREFIX } from './ids.ts'

/** Why a domain object was refused at the boundary. */
export type DomainFailureCode =
  | `${typeof DOMAIN_ERROR_PREFIX}NOT_AN_OBJECT`
  | `${typeof DOMAIN_ERROR_PREFIX}MISSING_FIELD`
  | `${typeof DOMAIN_ERROR_PREFIX}BAD_FIELD`
  | `${typeof DOMAIN_ERROR_PREFIX}UNKNOWN_SCHEMA`
  | `${typeof DOMAIN_ERROR_PREFIX}MISSING_CONTENT_HASH`
  | `${typeof DOMAIN_ERROR_PREFIX}BAD_REFERENCE`

/** A refused parse: what was wrong, in a sentence a reader can act on. */
export interface DomainParseFailure {
  readonly ok: false
  readonly code: DomainFailureCode
  readonly reason: string
}

/** The result of reading one domain object off an untyped boundary. */
export type Parsed<T> = { readonly ok: true; readonly value: T } | DomainParseFailure

/**
 * Build a refusal.
 *
 * @param code - the failure class.
 * @param reason - the sentence the caller reports.
 * @returns the refusal.
 */
export function refuse(code: DomainFailureCode, reason: string): DomainParseFailure {
  return { ok: false, code, reason }
}

/**
 * Build an acceptance.
 *
 * @param value - the parsed object.
 * @returns the acceptance carrying it.
 */
export function accept<T>(value: T): Parsed<T> {
  return { ok: true, value }
}

/**
 * Read a value as a plain record, or undefined.
 *
 * Arrays are excluded deliberately: an array is an object to `typeof`, and reading one as a
 * record would let `[]` pass for an empty record.
 *
 * @param value - the value to read.
 * @returns the record, or undefined when the value is not one.
 */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

/**
 * Read a required non-empty string field.
 *
 * @param source - the record to read from.
 * @param field - the field name.
 * @returns the string, or undefined when the field is absent, empty, or not a string.
 */
export function stringField(source: Record<string, unknown>, field: string): string | undefined {
  const value = source[field]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Read a required finite number field.
 *
 * @param source - the record to read from.
 * @param field - the field name.
 * @returns the number, or undefined when the field is absent or not a finite number.
 */
export function numberField(source: Record<string, unknown>, field: string): number | undefined {
  const value = source[field]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/**
 * Read a required non-negative integer field.
 *
 * @param source - the record to read from.
 * @param field - the field name.
 * @returns the integer, or undefined when the field is absent or is not one.
 */
export function countField(source: Record<string, unknown>, field: string): number | undefined {
  const value = source[field]
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}

/**
 * Read a required array field of unknown entries.
 *
 * @param source - the record to read from.
 * @param field - the field name.
 * @returns the array, or undefined when the field is absent or is not an array.
 */
export function arrayField(source: Record<string, unknown>, field: string): ReadonlyArray<unknown> | undefined {
  const value = source[field]
  return Array.isArray(value) ? value : undefined
}

/** A lower-case hex SHA-256. */
const HASH = /^[0-9a-f]{64}$/u

/**
 * Whether a value is a well-formed content hash.
 *
 * @param value - the value to test.
 * @returns true when it is 64 lower-case hex characters.
 */
export function isContentHash(value: unknown): value is ContentHash {
  return typeof value === 'string' && HASH.test(value)
}

/**
 * Whether a value is a well-formed input digest.
 *
 * @param value - the value to test.
 * @returns true when it is 64 lower-case hex characters.
 */
export function isInputDigest(value: unknown): value is InputDigest {
  return isContentHash(value)
}
