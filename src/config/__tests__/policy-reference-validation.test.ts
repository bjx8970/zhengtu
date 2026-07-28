/** 政策固定效果引用校验的单元测试。 */

import { describe, expect, it } from 'vitest';
import { validatePolicyEffectReferences } from '../policy-reference-validation';
import type { PolicyDefinitionConfig } from '../../types/config';

const catalog = {
  institutionIds: new Set(['institution_ok']),
  regionIds: new Set(['region_ok']),
};

function makePolicy(): PolicyDefinitionConfig {
  return {
    id: 'reference_test',
    name: '引用测试',
    description: '测试',
    category: 'economic',
    tags: [],
    effectiveDelayDays: 0,
    approvalEffects: [],
    availabilityCondition: { all: [] },
    phases: [
      {
        id: 'phase',
        name: '阶段',
        description: '测试',
        durationDays: 1,
        entryEffects: [],
        completionEffects: [],
      },
    ],
  };
}

describe('validatePolicyEffectReferences', () => {
  it('拒绝不存在的固定机构和地区引用', () => {
    const policy = makePolicy();
    policy.approvalEffects.push({
      target: 'institution_metric',
      institutionRef: { source: 'fixed', institutionId: 'missing_institution' },
      metricId: 'count',
      operation: 'add',
      value: 1,
    });
    policy.phases[0]!.entryEffects.push({
      target: 'region_metric',
      regionRef: { source: 'fixed', regionId: 'missing_region' },
      metricId: 'count',
      operation: 'add',
      value: 1,
    });

    expect(validatePolicyEffectReferences([policy], catalog)).toEqual([
      '政策 "reference_test" approvalEffects[0] 引用的固定机构 "missing_institution" 不存在',
      '政策 "reference_test" phases.phase.entryEffects[0] 引用的固定地区 "missing_region" 不存在',
    ]);
  });
});
