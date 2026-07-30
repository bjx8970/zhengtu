/** 职业履历资格配置的严格校验测试。 */

import { describe, expect, it } from 'vitest';
import { getConfigLoader } from '../loader';
import { CareerExperienceQualificationRulesSchema } from '../schemas';

describe('career experience qualification config', () => {
  it('defines each appointment type exactly once and returns defensive copies', () => {
    const loader = getConfigLoader();
    const first = loader.getCareerExperienceQualificationRules();
    const second = loader.getCareerExperienceQualificationRules();
    expect(first.appointmentTypes.map((rule) => rule.appointmentType).sort()).toEqual([
      'acting',
      'secondment',
      'substantive',
      'temporary',
    ]);
    const firstRule = first.appointmentTypes[0];
    const secondRule = second.appointmentTypes[0];
    if (!firstRule || !secondRule) throw new Error('Expected substantive qualification rule');
    firstRule.minDaysForRegionExperience = 999;
    expect(secondRule.minDaysForRegionExperience).not.toBe(999);
  });

  it('rejects missing, duplicate, unknown, and internally inconsistent rules', () => {
    const base = getConfigLoader().getCareerExperienceQualificationRules();
    expect(
      CareerExperienceQualificationRulesSchema.safeParse({
        appointmentTypes: base.appointmentTypes.filter(
          (rule) => rule.appointmentType !== 'substantive',
        ),
      }).success,
    ).toBe(false);
    expect(
      CareerExperienceQualificationRulesSchema.safeParse({
        appointmentTypes: [...base.appointmentTypes, base.appointmentTypes[0]],
      }).success,
    ).toBe(false);
    expect(
      CareerExperienceQualificationRulesSchema.safeParse({
        appointmentTypes: [{ ...base.appointmentTypes[0], appointmentType: 'unknown' }],
      }).success,
    ).toBe(false);
    expect(
      CareerExperienceQualificationRulesSchema.safeParse({
        appointmentTypes: base.appointmentTypes.map((rule, index) =>
          index === 0
            ? { ...rule, countsTowardRegionExperience: false, minDaysForRegionExperience: 1 }
            : rule,
        ),
      }).success,
    ).toBe(false);
  });
});
