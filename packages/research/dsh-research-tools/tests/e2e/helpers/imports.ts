/**
 * T19-A P4/P5 E2E — centralized relative SOURCE imports.
 *
 * These tests live in `@deepseek-ai/dsh-research-tools/tests/e2e/` and must NOT modify
 * any production `src/` (core/tools/team/cordis). The core public entry
 * (`@deepseek-ai/dsh-research-core`) does not export `runStep`/`pipeline`, so the driver
 * consumes the minimal execution pipeline directly from core's source via a relative
 * import (read-only). All other engine APIs (state-machine, steps, host) are also imported
 * relatively for a single, auditable import surface. The REAL figure tool is imported from
 * this same package's source.
 *
 * Depths (from `dsh-research-tools/tests/e2e/`):
 *   helpers/  → ../../../../../research/dsh-research-core/...   (6 ups to repo root)
 *   spec file→ ../../../../research/dsh-research-core/...       (5 ups to repo root)
 *   figure    → ../../../src/tools/figure/index.ts             (3 ups into this pkg)
 */

// ── Core execution pipeline (NOT exported from the public core entry) ──
import { runStep } from '../../../../../research/dsh-research-core/src/engine/pipeline.ts'
export { runStep }

// ── Core state-machine API (read-only consumption, no re-implementation) ──
import {
  appendAuditEvent,
  canStart,
  completeStep,
  createRun,
  getArtifact,
  getAuditHistory,
  getRunSnapshot,
  isComplete,
  rollback,
  setRunInput,
  startStep,
  submitGateVerdict,
} from '../../../../../research/dsh-research-core/src/engine/state-machine.ts'
export {
  appendAuditEvent,
  canStart,
  completeStep,
  createRun,
  getArtifact,
  getAuditHistory,
  getRunSnapshot,
  isComplete,
  rollback,
  setRunInput,
  startStep,
  submitGateVerdict,
}

// ── Core step graph + host trust channel (read-only) ──
import { STEP_BY_ID, STEPS } from '../../../../../research/dsh-research-core/src/engine/steps.ts'
export { STEP_BY_ID, STEPS }
import {
  _resetApprovalChannelForTests,
  createHostApprovalChannel,
} from '../../../../../research/dsh-research-core/src/host.ts'
export { _resetApprovalChannelForTests, createHostApprovalChannel }

// ── Core types (read-only) ──
import type {
  AuditEvent,
  GateOutcome,
  GateVerdict,
  ResearchRunStore,
  StepDefinition,
  StepStatus,
  TrinityComponent,
} from '../../../../../research/dsh-research-core/src/engine/types.ts'
export type {
  AuditEvent,
  GateOutcome,
  GateVerdict,
  ResearchRunStore,
  StepDefinition,
  StepStatus,
  TrinityComponent,
}

// ── REAL figure tool (same package, pure call) ──
import { renderFigure } from '../../../src/tools/figure/index.ts'
export { renderFigure }
