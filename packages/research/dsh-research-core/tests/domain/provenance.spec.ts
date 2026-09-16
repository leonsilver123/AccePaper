/**
 * Tests for the evidence-profile decision: which source classes may carry a gate under which
 * profile, and the submittability that follows from the profile rather than from a run's contents.
 *
 * The acceptance requirement these cases are evidence for is that a production profile refuses
 * formally-correct synthetic evidence: a fixture record with every field well formed is still a
 * refusal, and the refusal happens at admission rather than being left to a gate to notice.
 */

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_EVIDENCE_PROFILE,
  EVIDENCE_PROFILES,
  SOURCE_ACCESS_LEVELS,
  SOURCE_CLASSES,
  admitAsEvidence,
  isEvidenceProfile,
  isSourceAccess,
  isSourceClass,
  evidenceEligibilityOf,
} from '../../src/domain/provenance.ts'

describe('the declared vocabulary is closed', () => {
  it('rejects anything that does not name a declared class, access level, or profile', () => {
    const undeclared: readonly unknown[] = ['', 'nonsense', 'Fixture', 1, 0, null, undefined, {}, [], true]
    for (const value of undeclared) {
      expect(isSourceClass(value), String(value)).toBe(false)
      expect(isSourceAccess(value), String(value)).toBe(false)
      expect(isEvidenceProfile(value), String(value)).toBe(false)
    }
  })

  it('accepts every declared member', () => {
    for (const value of SOURCE_CLASSES) expect(isSourceClass(value)).toBe(true)
    for (const value of SOURCE_ACCESS_LEVELS) expect(isSourceAccess(value)).toBe(true)
    for (const value of EVIDENCE_PROFILES) expect(isEvidenceProfile(value)).toBe(true)
  })
})

describe('production refuses a class that cannot carry a claim', () => {
  it('REFUSES fixture and model_generated evidence with DSH_EVIDENCE_NOT_PRODUCTION_GRADE', () => {
    const offered: ReadonlyArray<{ sourceClass: 'fixture' | 'model_generated'; producer: string }> = [
      { sourceClass: 'fixture', producer: 'fixture-harness' },
      { sourceClass: 'model_generated', producer: 'dsh-research-model' },
    ]
    for (const provenance of offered) {
      const admission = admitAsEvidence('production', provenance)
      expect(admission.disposition).toBe('refused')
      expect(admission.code).toBe('DSH_EVIDENCE_NOT_PRODUCTION_GRADE')
      // The refusal names what was offered, so a reader of the audit trail can see which producer
      // supplied the value that could not carry the gate.
      expect(admission.reason).toContain(provenance.sourceClass)
      expect(admission.reason).toContain(provenance.producer)
    }
  })

  it('REFUSES a fixture claiming full-text access: the class is decided before the access level', () => {
    const admission = admitAsEvidence('production', {
      sourceClass: 'fixture',
      producer: 'fixture-harness',
      sourceAccess: 'full-text',
    })
    expect(admission.disposition).toBe('refused')
    expect(admission.code).toBe('DSH_EVIDENCE_NOT_PRODUCTION_GRADE')
  })

  it('refuses no class other than the two synthetic ones', () => {
    // Pinned as a set rather than as two examples: adding a class to the union without deciding
    // whether a production gate may rest on it fails here.
    const refused = SOURCE_CLASSES.filter(
      sourceClass => admitAsEvidence('production', { sourceClass, producer: 'probe' }).disposition === 'refused',
    )
    expect(refused).toEqual(['fixture', 'model_generated'])
  })
})

describe('production holds a source that was located but not read', () => {
  it('returns PENDING, and not refused, for literature read below full text', () => {
    for (const sourceAccess of SOURCE_ACCESS_LEVELS.filter(level => level !== 'full-text')) {
      const admission = admitAsEvidence('production', {
        sourceClass: 'literature',
        producer: 'crossref-adapter',
        sourceAccess,
      })
      // An unread source is evidence still being gathered. Reporting it as refused would report
      // the claim as contradicted by a source nobody has read.
      expect(admission.disposition, sourceAccess).toBe('pending')
      expect(admission.code).toBe('DSH_EVIDENCE_PENDING_SOURCE_ACCESS')
      expect(admission.reason).toContain(sourceAccess)
    }
  })

  it('ADMITS literature read in full', () => {
    const admission = admitAsEvidence('production', {
      sourceClass: 'literature',
      producer: 'crossref-adapter',
      sourceAccess: 'full-text',
    })
    expect(admission.disposition).toBe('admitted')
    expect(admission.code).toBe('DSH_EVIDENCE_ADMITTED')
    expect(admission.reason).toContain('full-text')
  })
})

describe('production admits the classes a research result can come from', () => {
  it('ADMITS simulation evidence: a simulation may be the research result itself', () => {
    const admission = admitAsEvidence('production', { sourceClass: 'simulation', producer: 'traffic-model-v3' })
    expect(admission.disposition).toBe('admitted')
    expect(admission.code).toBe('DSH_EVIDENCE_ADMITTED')
  })

  it('ADMITS imported and measured evidence, which carry no access level', () => {
    for (const sourceClass of ['imported', 'measured'] as const) {
      expect(admitAsEvidence('production', { sourceClass, producer: 'bench-rig' }).disposition, sourceClass).toBe(
        'admitted',
      )
    }
  })
})

describe('evaluation runs everything and submits nothing', () => {
  it('ADMITS fixture evidence under evaluation, whose whole output is unsubmittable', () => {
    const admission = admitAsEvidence('evaluation', { sourceClass: 'fixture', producer: 'fixture-harness' })
    expect(admission.disposition).toBe('admitted')
    expect(admission.code).toBe('DSH_EVIDENCE_ADMITTED')
    expect(admission.reason).toContain('not submittable')
    // The permission to run and the permission to publish are separate: the profile that admits
    // synthetic evidence is exactly the profile whose output may not be submitted.
    expect(evidenceEligibilityOf('evaluation').eligible).toBe(false)
    expect(evidenceEligibilityOf('production').eligible).toBe(true)
    expect(evidenceEligibilityOf('evaluation').reason).toContain('synthetic evidence')
  })

  it('admits every declared class under evaluation', () => {
    for (const sourceClass of SOURCE_CLASSES) {
      expect(admitAsEvidence('evaluation', { sourceClass, producer: 'probe' }).disposition, sourceClass).toBe(
        'admitted',
      )
    }
  })

  it('defaults an undeclared profile to the unsubmittable one', () => {
    // The permissive default must not become a published claim, so `production` is reachable only
    // by stating it.
    expect(DEFAULT_EVIDENCE_PROFILE).toBe('evaluation')
    expect(evidenceEligibilityOf(DEFAULT_EVIDENCE_PROFILE).eligible).toBe(false)
    expect(EVIDENCE_PROFILES).toEqual(['production', 'evaluation'])
  })
})
