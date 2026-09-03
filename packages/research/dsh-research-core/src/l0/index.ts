/**
 * T07 L0 configurable literature routing — module public surface.
 *
 * Re-exports the l0-relevant frozen contract types + the module-local input /
 * adapter types + the pure {@link classifyL0} function and the mock fixture.
 * This is the l0 MODULE index, NOT the package src/index.ts (the main Agent
 * wires it into the package index in the A7->A8->A9 merge).
 *
 * L0 = source RISK + QUALITY tier ONLY. Nothing here asserts literature is
 * real or a claim is proven.
 */

export type {
  L0Classification,
  L0ClassificationStatus,
  L0SourceId,
  L0SourceType,
  L0Tier,
} from '../contracts.ts'
export { L0_ERROR_PREFIX } from '../contracts.ts'

export type {
  L0RoutingAdapter,
  L0RoutingDecision,
  L0SourceInput,
} from './types.ts'
export {
  classifyL0,
  createMockL0Adapter,
  mockL0Adapter,
  MOCK_L0_RULE_VERSION,
} from './routing.ts'
