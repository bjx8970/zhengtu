/** Phase 3 验收配置的严格解析、引用完整性与 producer 覆盖测试。 */

import { describe, expect, it } from 'vitest';
import { getConfigLoader } from '../loader';
import {
  Phase3AcceptanceConfigSchema,
  validatePhase3AcceptanceReferences,
} from '../phase3-acceptance';

function createCatalog() {
  const loader = getConfigLoader();
  return {
    positions: loader.getAllPositions(),
    personalTasks: loader.getAllPersonalTaskTemplates(),
    careerOpportunities: loader.getAllCareerOpportunityDefinitions(),
    events: loader.getAllEventDefinitions(),
    policies: loader.getAllPolicyDefinitions(),
    rankProgressionRuleIds: loader.getAllCivilServiceRankProgressionRules().map((rule) => rule.id),
  };
}

describe('Phase 3 acceptance config', () => {
  it('strictly records the locked stage positions and milestone windows', () => {
    const config = getConfigLoader().getPhase3AcceptanceConfig();
    expect(config.stagePositionIds).toEqual({
      clerk: 'admin_l1_0',
      townshipDeputy: 'admin_l2_0',
      townshipChief: 'admin_l3_0',
    });
    expect(config.milestones).toEqual({
      probationPassed: { minDay: 360, maxDay: 450 },
      firstRankPromotion: { minDay: 360, maxDay: 450 },
      townshipDeputyAppointment: { minDay: 720, maxDay: 810 },
      sectionMember4Promotion: { minDay: 1080, maxDay: 1170 },
      townshipChiefOpportunity: { minDay: 1440, maxDay: 1530 },
    });
    expect(
      Phase3AcceptanceConfigSchema.safeParse({ ...config, unexpectedField: true }).success,
    ).toBe(false);
  });

  it('resolves every declared formal entrypoint and positive KPI producer', () => {
    const config = getConfigLoader().getPhase3AcceptanceConfig();
    expect(validatePhase3AcceptanceReferences(config, createCatalog())).toEqual([]);
    expect(config.requiredKpiProducers.map((requirement) => requirement.kpiId)).toEqual([
      'office_efficiency',
      'livelihood_score',
      'agricultural_output',
    ]);
  });

  it('rejects missing formal content and tasks that do not produce the declared KPI', () => {
    const config = getConfigLoader().getPhase3AcceptanceConfig();
    const entrypoint = config.entrypoints[0];
    const producerRequirement = config.requiredKpiProducers[0];
    if (!entrypoint || !producerRequirement)
      throw new Error('Expected Phase 3 acceptance fixtures');
    entrypoint.contentId = 'missing_task';
    producerRequirement.personalTaskIds = ['task_induction_training'];
    expect(validatePhase3AcceptanceReferences(config, createCatalog())).toEqual(
      expect.arrayContaining([
        expect.stringContaining('missing_task'),
        expect.stringContaining('task_induction_training does not produce office_efficiency'),
      ]),
    );
  });

  it('returns a defensive copy from ConfigLoader', () => {
    const loader = getConfigLoader();
    const first = loader.getPhase3AcceptanceConfig();
    first.stagePositionIds.clerk = 'mutated';
    expect(loader.getPhase3AcceptanceConfig().stagePositionIds.clerk).toBe('admin_l1_0');
  });
});
