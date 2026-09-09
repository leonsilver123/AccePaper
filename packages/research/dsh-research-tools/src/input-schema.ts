/**
 * Strict per-tool input schemas (Phase 1.1-R schema hardening).
 *
 * Every research tool declares a formal, closed input schema: whitelisted keys
 * (`additionalProperties:false` by construction), explicit required fields,
 * bounded strings/arrays/numbers, enums where the domain is closed, JSON-safe
 * value rejection (function/symbol/bigint/cyclic), nesting-depth and payload
 * size budgets. A tool's business function is NEVER called when validation
 * fails — validation runs first and returns the full violation list.
 *
 * Path-like fields (future tools that accept file paths) are validated against
 * absolute paths / `..` traversal / NUL / UNC / drive letters.
 *
 * Citation-verify note (single-owner boundary): its `ref`/`evidence`/`options`
 * payloads are core-owned branded types whose CONTENT contract is enforced by
 * `verifyCitation` in dsh-research-core (its own suite). The adapter enforces
 * the outer shape (required top keys), JSON-safety, depth/size budgets and
 * forbids unknown top-level keys — it does not duplicate the core schema.
 */
import { RESEARCH_TOOL_DIRECTORY } from './registry.ts'

/** Field rule DSL: closed object roots with no implicit openness anywhere. */
export type FieldRule =
  | { type: 'string'; required?: boolean; minLength?: number; maxLength?: number; enum?: readonly string[] }
  | { type: 'number'; required?: boolean; minimum?: number; maximum?: number; integer?: boolean }
  | { type: 'boolean'; required?: boolean }
  | { type: 'object'; required?: boolean; properties?: Record<string, FieldRule>; open?: boolean }
  | { type: 'array'; required?: boolean; minItems?: number; maxItems?: number; items: FieldRule }

/** Runtime limits shared by every tool input. */
export const INPUT_LIMITS = {
  maxDepth: 16,
  maxPayloadChars: 262_144, // 256 KiB serialized budget
  maxTopLevelKeys: 32,
} as const

/** True for values that can never be part of a JSON-safe input payload. */
export function isJsonSafe(value: unknown, seen?: Set<object>): boolean {
  const ancestors = seen ?? new Set<object>()
  const visit = (item: unknown, path: Set<object>): boolean => {
    if (item === null) return true
    switch (typeof item) {
      case 'string':
      case 'boolean':
        return true
      case 'number':
        return Number.isFinite(item)
      case 'undefined':
      case 'function':
      case 'symbol':
      case 'bigint':
        return false
      case 'object': {
        if (Buffer.isBuffer(item) || item instanceof Date) return false
        if (path.has(item)) return false // ancestor cycle, NOT shared sibling refs
        path.add(item)
        if (Array.isArray(item)) {
          for (const child of item) {
            if (!visit(child, path)) {
              path.delete(item)
              return false
            }
          }
        } else {
          for (const child of Object.values(item)) {
            if (!visit(child, path)) {
              path.delete(item)
              return false
            }
          }
        }
        path.delete(item)
        return true
      }
      default:
        return false
    }
  }
  return visit(value, ancestors)
}

/** Reject windows/posix absolute paths, `..`, NUL, UNC, and drive letters. */
export function isForbiddenPath(value: string): boolean {
  if (value.includes('\0')) return true
  if (/^([a-zA-Z]:[\\/]|[\\/][\\/]|\\\\|\/)/.test(value)) return true // drive/UNC/absolute
  return value.split(/[\\/]/).includes('..')
}

function typeName(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function validateNode(
  rule: FieldRule,
  value: unknown,
  path: string,
  violations: string[],
  depth: number,
): void {
  if (depth > INPUT_LIMITS.maxDepth) {
    violations.push(`${path}: exceeds max nesting depth ${INPUT_LIMITS.maxDepth}`)
    return
  }
  switch (rule.type) {
    case 'string': {
      if (typeof value !== 'string') {
        violations.push(`${path}: expected string, got ${typeName(value)}`)
        return
      }
      if (rule.minLength !== undefined && value.length < rule.minLength) {
        violations.push(`${path}: shorter than minLength ${rule.minLength}`)
      }
      if (rule.maxLength !== undefined && value.length > rule.maxLength) {
        violations.push(`${path}: longer than maxLength ${rule.maxLength}`)
      }
      if (rule.enum !== undefined && !rule.enum.includes(value)) {
        violations.push(`${path}: not one of ${rule.enum.join(',')}`)
      }
      return
    }
    case 'number': {
      if (typeof value !== 'number') {
        violations.push(`${path}: expected number, got ${typeName(value)}`)
        return
      }
      if (!Number.isFinite(value)) {
        violations.push(`${path}: expected a finite number`)
        return
      }
      if (rule.integer === true && !Number.isInteger(value)) {
        violations.push(`${path}: expected an integer`)
      }
      if (rule.minimum !== undefined && value < rule.minimum) {
        violations.push(`${path}: below minimum ${rule.minimum}`)
      }
      if (rule.maximum !== undefined && value > rule.maximum) {
        violations.push(`${path}: above maximum ${rule.maximum}`)
      }
      return
    }
    case 'boolean': {
      if (typeof value !== 'boolean') {
        violations.push(`${path}: expected boolean, got ${typeName(value)}`)
      }
      return
    }
    case 'object': {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        violations.push(`${path}: expected object, got ${typeName(value)}`)
        return
      }
      const record = value as Record<string, unknown>
      const props = rule.properties ?? {}
      if (rule.open !== true) {
        for (const key of Object.keys(record)) {
          if (!(key in props)) {
            violations.push(`${path}: unknown property '${key}' (additionalProperties:false)`)
          }
        }
      }
      for (const [key, sub] of Object.entries(props)) {
        const present = key in record
        if (!present) {
          if (sub.required === true) violations.push(`${path}: missing required property '${key}'`)
          continue
        }
        if (record[key] === undefined) {
          violations.push(`${path}.${key}: undefined is not a JSON-safe value`)
          continue
        }
        validateNode(sub, record[key], `${path}.${key}`, violations, depth + 1)
      }
      return
    }
    case 'array': {
      if (!Array.isArray(value)) {
        violations.push(`${path}: expected array, got ${typeName(value)}`)
        return
      }
      if (rule.minItems !== undefined && value.length < rule.minItems) {
        violations.push(`${path}: fewer than minItems ${rule.minItems}`)
      }
      if (rule.maxItems !== undefined && value.length > rule.maxItems) {
        violations.push(`${path}: more than maxItems ${rule.maxItems}`)
      }
      value.forEach((item, index) => {
        validateNode(rule.items, item, `${path}[${index}]`, violations, depth + 1)
      })
      return
    }
    default:
      violations.push(`${path}: unsupported rule`)
  }
}

function payloadTooLarge(value: unknown): string | undefined {
  const text = safeSerialize(value)
  if (text !== undefined && text.length > INPUT_LIMITS.maxPayloadChars) {
    return `payload exceeds ${INPUT_LIMITS.maxPayloadChars} chars`
  }
  return undefined
}

function safeSerialize(value: unknown): string | undefined {
  try {
    return JSON.stringify(value)
  } catch {
    return undefined
  }
}

function topLevelKeyCount(value: unknown): number {
  if (typeof value !== 'object' || value === null) return 0
  return Object.keys(value as Record<string, unknown>).length
}

/** Validate one tool input against its strict schema. Returns violations. */
export function validateResearchToolInput(toolId: string, input: unknown): string[] {
  const schema = RESEARCH_TOOL_INPUT_SCHEMAS[toolId]
  if (schema === undefined) return [`unknown research tool '${toolId}'`]
  if (!isJsonSafe(input)) return [`${toolId}: input contains non-JSON-safe values (function/symbol/bigint/undefined/cyclic/Buffer/Date)`]
  if (topLevelKeyCount(input) > INPUT_LIMITS.maxTopLevelKeys) {
    return [`${toolId}: top-level key count exceeds ${INPUT_LIMITS.maxTopLevelKeys}`]
  }
  const sizeIssue = payloadTooLarge(input)
  if (sizeIssue !== undefined) return [`${toolId}: ${sizeIssue}`]
  const violations: string[] = []
  validateNode(schema, input, toolId, violations, 0)
  return violations
}

// ── The seven strict schemas (closed roots; no unbounded object anywhere) ──

const FIGURE_KIND: readonly string[] = ['bar', 'line', 'scatter', 'area', 'pie', 'donut']
const NUMBER_LIMIT: FieldRule = { type: 'number', minimum: -1e15, maximum: 1e15 }

export const RESEARCH_TOOL_INPUT_SCHEMAS: Readonly<Record<string, FieldRule>> = {
  'literature-search': {
    type: 'object',
    required: true,
    properties: {
      topic: { type: 'string', required: true, minLength: 1, maxLength: 500 },
      maxResults: { type: 'number', integer: true, minimum: 1, maximum: 100 },
    },
  },
  'citation-verify': {
    type: 'object',
    required: true,
    properties: {
      claimId: { type: 'string', required: true, minLength: 1, maxLength: 128 },
      citationId: { type: 'string', required: true, minLength: 1, maxLength: 128 },
      ref: {
        type: 'object',
        required: true,
        open: true, // core-owned CitationRef: content schema owned by core verifyCitation
      },
      evidence: {
        type: 'object',
        required: true,
        open: true, // core-owned CitationEvidence (single-owner boundary, see header)
      },
      options: {
        type: 'object',
        required: true,
        open: true, // core-owned VerifyCitationOptions
      },
    },
  },
  'claim-construct': {
    type: 'object',
    required: true,
    properties: {
      assertion: { type: 'string', required: true, minLength: 1, maxLength: 2000 },
      claimId: { type: 'string', minLength: 1, maxLength: 64 },
      falsifiability: {
        type: 'object',
        open: true, // core-owned ClaimFalsifiability scaffold
      },
      note: { type: 'string', maxLength: 1000 },
      now: { type: 'number', minimum: 0 },
    },
  },
  ablation: {
    type: 'object',
    required: true,
    properties: {
      definition: {
        type: 'object',
        required: true,
        properties: {
          baselineIdentity: { type: 'string', required: true, minLength: 1, maxLength: 200 },
          variantIdentity: { type: 'string', required: true, minLength: 1, maxLength: 200 },
          removedOrReplacedComponents: {
            type: 'array',
            required: true,
            minItems: 1,
            maxItems: 20,
            items: {
              type: 'object',
              required: true,
              properties: {
                component: { type: 'string', required: true, minLength: 1, maxLength: 200 },
                action: { type: 'string', required: true, enum: ['removed', 'replaced'] },
                replacement: { type: 'string', maxLength: 200 },
              },
            },
          },
          dataset: {
            type: 'object',
            required: true,
            properties: {
              version: { type: 'string', minLength: 1, maxLength: 200 },
              split: { type: 'string', minLength: 1, maxLength: 100 },
              seed: { type: 'number', integer: true, minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
            },
          },
          metric: {
            type: 'object',
            required: true,
            properties: {
              name: { type: 'string', required: true, minLength: 1, maxLength: 200 },
              direction: { type: 'string', required: true, enum: ['higher_is_better', 'lower_is_better'] },
            },
          },
          repetitions: { type: 'number', integer: true, minimum: 1, maximum: 100 },
        },
      },
    },
  },
  figure: {
    type: 'object',
    required: true,
    properties: {
      kind: { type: 'string', required: true, enum: FIGURE_KIND },
      title: { type: 'string', required: true, minLength: 1, maxLength: 500 },
      width: { type: 'number', required: true, integer: true, minimum: 1, maximum: 16384 },
      height: { type: 'number', required: true, integer: true, minimum: 1, maximum: 16384 },
      series: {
        type: 'array',
        required: true,
        minItems: 1,
        maxItems: 32,
        items: {
          type: 'object',
          required: true,
          properties: {
            name: { type: 'string', required: true, minLength: 1, maxLength: 200 },
            unit: { type: 'string', maxLength: 32 },
            values: {
              type: 'array', required: true, minItems: 1, maxItems: 4096,
              items: NUMBER_LIMIT,
            },
          },
        },
      },
      axes: {
        type: 'object',
        properties: {
          xLabel: { type: 'string', maxLength: 200 },
          categories: { type: 'array', maxItems: 4096, items: { type: 'string', maxLength: 200 } },
          yLabel: { type: 'string', maxLength: 200 },
          yUnit: { type: 'string', maxLength: 32 },
        },
      },
      legend: {
        type: 'object',
        properties: {
          position: { type: 'string', enum: ['top', 'bottom', 'left', 'right', 'none'] },
          title: { type: 'string', maxLength: 200 },
        },
      },
      tokens: {
        type: 'object',
        properties: {
          palette: {
            type: 'array', maxItems: 64,
            items: { type: 'string', minLength: 1, maxLength: 64 },
          },
          fontFamily: { type: 'string', maxLength: 100 },
          fontSize: { type: 'number', integer: true, minimum: 1, maximum: 200 },
        },
      },
      seed: { type: 'number', integer: true, minimum: 0, maximum: 2 ** 31 - 1 },
    },
  },
  'three-line-table': {
    type: 'object',
    required: true,
    properties: {
      model: {
        type: 'object',
        required: true,
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 500 },
          columns: {
            type: 'array', required: true, minItems: 1, maxItems: 64,
            items: {
              type: 'object', required: true,
              properties: {
                header: { type: 'string', required: true, minLength: 1, maxLength: 200 },
                decimals: { type: 'number', integer: true, minimum: 0, maximum: 20 },
                unit: { type: 'string', maxLength: 32 },
                metricDirection: { type: 'string', enum: ['lower-is-better', 'higher-is-better'] },
              },
            },
          },
          rows: {
            type: 'array', required: true, minItems: 1, maxItems: 10_000,
            items: {
              type: 'array', required: true, minItems: 1, maxItems: 64,
              items: {
                type: 'object', required: true,
                properties: {
                  kind: { type: 'string', required: true, enum: ['text', 'number', 'meanSd', 'meanSdParen', 'formatted', 'missing'] },
                  text: { type: 'string', maxLength: 500 },
                  value: NUMBER_LIMIT,
                  mean: NUMBER_LIMIT,
                  sd: { type: 'number', minimum: 0, maximum: 1e15 },
                },
              },
            },
          },
          footnotes: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 500 } },
        },
      },
      target: { type: 'string', required: true, enum: ['markdown', 'latex'] },
    },
  },
  roadmap: {
    type: 'object',
    required: true,
    properties: {
      graph: {
        type: 'object',
        required: true,
        open: true, // RoadmapGraph shape owned by renderRoadmap/validateRoadmap (nodes carry kind/label/layer; edges from/to/label)
      },
      options: {
        type: 'object',
        properties: {
          format: { type: 'string', enum: ['mermaid', 'svg'] },
          title: { type: 'string', maxLength: 500 },
        },
      },
    },
  },
}

/** Ensure the schema table covers exactly the seven registered tools. */
export function assertSchemaTableComplete(): void {
  const toolIds = RESEARCH_TOOL_DIRECTORY.map(entry => entry.toolId)
  for (const toolId of toolIds) {
    if (!(toolId in RESEARCH_TOOL_INPUT_SCHEMAS)) {
      throw new Error(`[input-schema] missing strict schema for registered tool '${toolId}'`)
    }
  }
  const extra = Object.keys(RESEARCH_TOOL_INPUT_SCHEMAS).filter(id => !toolIds.includes(id))
  if (extra.length > 0) throw new Error(`[input-schema] schema for unknown tool(s): ${extra.join(',')}`)
}
