/** 试用期评估引擎测试。 */

import { describe, expect, it } from 'vitest';
import type { AppointmentProbation, CareerRestriction } from '../../../domain/career/state';
import type { ProbationConfig } from '../../../types/config';
import { createAppointmentProbation, evaluateProbation } from '../probation-evaluation';

const config: ProbationConfig = {
  durationDays: 360,
  minimumCompletedActions: 1,
  passScoreThreshold: 50,
  extensionScoreThreshold: 35,
  extensionDays: 90,
  maxExtensions: 1,
  attributeWeights: { competence: 0.3, diligence: 0.3, integrity: 0.25, stability: 0.15 },
  disqualifyingRestrictionTypes: ['disciplinary_action'],
};
const attributes = { competence: 50, diligence: 50, integrity: 50, stability: 50 };

function probation(overrides: Partial<AppointmentProbation> = {}): AppointmentProbation {
  return { ...createAppointmentProbation(0, config), completedActionCount: 1, ...overrides };
}

function evaluate(
  current: AppointmentProbation | null,
  currentDay: number,
  restrictions: CareerRestriction[] = [],
) {
  return evaluateProbation({ currentDay, probation: current, attributes, restrictions, config });
}

describe('probation evaluation', () => {
  it('does not settle before the configured due day', () => {
    expect(evaluate(probation(), 359)).toEqual({ success: false, failure: 'not_due' });
  });

  it('passes exactly on the due day and keeps an audit record', () => {
    const result = evaluate(probation(), 360);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.outcome).toBe('passed');
    expect(result.probation).toMatchObject({
      status: 'passed',
      resolvedAtDay: 360,
      extensionCount: 0,
    });
    expect(result.evaluation).toMatchObject({
      evaluatedAtDay: 360,
      score: 50,
      completedActionCount: 1,
      unmetRequirements: [],
    });
  });

  it('extends an incomplete but remediable probation once', () => {
    const result = evaluate(probation({ completedActionCount: 0 }), 360);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.outcome).toBe('extended');
    expect(result.probation).toMatchObject({
      status: 'active',
      endsAtDay: 450,
      extensionCount: 1,
      resolvedAtDay: null,
    });
    expect(result.evaluation.unmetRequirements).toContain('minimum_completed_actions');
  });

  it('fails immediately below the extension floor and records the consequence', () => {
    const result = evaluateProbation({
      currentDay: 360,
      probation: probation({ completedActionCount: 0 }),
      attributes: { competence: 0, diligence: 0, integrity: 0, stability: 0 },
      restrictions: [],
      config,
    });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.outcome).toBe('failed');
    expect(result.probation.status).toBe('failed');
    expect(result.probation.outcomeReason).toContain('终止本次任职');
  });

  it('fails at the extension limit instead of extending indefinitely', () => {
    const result = evaluate(
      probation({ endsAtDay: 450, extensionCount: 1, completedActionCount: 0 }),
      450,
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.outcome).toBe('failed');
    expect(result.probation.extensionCount).toBe(1);
  });

  it('treats an active disqualifying restriction as an unmet requirement', () => {
    const result = evaluate(probation(), 360, [
      {
        id: 'restriction',
        type: 'disciplinary_action',
        startedAtDay: 300,
        endsAtDay: 400,
        reason: '处分期内',
        sourceType: 'system',
        sourceId: null,
      },
    ]);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.outcome).toBe('extended');
    expect(result.evaluation.unmetRequirements).toContain('disqualifying_restriction');
  });

  it('fails safely for terminal, incomplete and invalid inputs', () => {
    expect(evaluate(null, 360)).toEqual({ success: false, failure: 'not_active' });
    expect(evaluate(probation({ status: 'passed', resolvedAtDay: 360 }), 360)).toEqual({
      success: false,
      failure: 'not_active',
    });
    const invalidConfig = { ...config, extensionDays: 0 };
    expect(
      evaluateProbation({
        currentDay: 360,
        probation: probation(),
        attributes,
        restrictions: [],
        config: invalidConfig,
      }),
    ).toEqual({ success: false, failure: 'invalid_config' });
  });
});
