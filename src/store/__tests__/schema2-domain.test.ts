/**
 * 当前存档 Schema 与领域模型集成测试
 *
 * 覆盖：
 * - Schema 2 完整往返
 * - Schema 1 拒绝并备份
 * - 领域契约完整性
 * - 36 职位配置引用完整性
 * - NEW_GAME 隔离性
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createInitialState, createTestStore } from '../game-store';
import { decodeCurrentSave, wrapSaveEnvelope, validatePlayerSave } from '../save-codec';
import { CURRENT_CONTENT_VERSION, CURRENT_SCHEMA_VERSION } from '../../types/save';
import { getConfigLoader } from '../../config/loader';
import { createActionExecutableSnapshot } from '../action-executable-snapshot';
import type { AppointmentCareerOpportunity } from '../../domain/career/state';
import { expireCareerOpportunity } from '../../engine/career/career-opportunity-lifecycle';
import {
  INSTITUTION_LEVELS,
  POSITION_DOMAINS,
  LEADERSHIP_RANKS,
  CIVIL_SERVICE_RANKS,
  INSTITUTION_LEVEL_LABELS,
  POSITION_DOMAIN_LABELS,
  LEADERSHIP_RANK_LABELS,
  CIVIL_SERVICE_RANK_LABELS,
} from '../../domain/career/types';
import { POLICY_STATUSES, DOMAIN_SIGNALS } from '../../domain/governance/types';
import { EVENT_PRIORITIES, EVENT_PRESENTATIONS } from '../../domain/events/types';
import { EFFECT_TARGET_DISCRIMINANTS } from '../../domain/conditions';

describe('Schema 2 存档', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('createInitialState 生成合法 Schema 2 状态', () => {
    const state = createInitialState();
    const validation = validatePlayerSave(state);
    expect(validation.valid).toBe(true);
  });

  it('Schema 2 完整往返（encode → decode）', () => {
    const state = createInitialState();
    state.character.characterName = '测试角色';
    const envelope = wrapSaveEnvelope(state);
    const json = JSON.stringify(envelope);
    const result = decodeCurrentSave(json);
    expect(result.success).toBe(true);
    expect(result.state?.character.characterName).toBe('测试角色');
  });

  it('expired career opportunity survives a save/load round trip', () => {
    const state = createInitialState();
    const opportunity: AppointmentCareerOpportunity = {
      id: 'expired-opportunity',
      definitionId: 'expired-definition',
      type: 'leadership_vacancy',
      status: 'available',
      source: {
        sourceType: 'system',
        sourceId: 'test-source',
        signalId: null,
        description: 'test',
      },
      sourceSignal: null,
      target: {
        positionId: 'test-position',
        positionName: 'Test position',
        institutionId: 'test-institution',
        institutionName: 'Test institution',
        regionId: 'test-region',
        institutionLevel: 'township',
        positionDomain: 'local_governance',
        leadershipRank: 'none',
      },
      appointmentType: 'substantive',
      appointmentReason: 'promotion',
      appearedAtDay: 0,
      expiresAtDay: 1,
      acceptedAtDay: null,
      rejectedAtDay: null,
      resolvedAtDay: null,
      cancelledAtDay: null,
      requiresSelection: true,
      eligibilityConditions: [],
      finalOutcome: null,
      reason: 'test',
    };
    const expired = expireCareerOpportunity(opportunity, 1);
    expect(expired.success).toBe(true);
    if (!expired.opportunity) throw new Error('Expected expired opportunity');
    state.career.opportunities = [expired.opportunity];

    const result = decodeCurrentSave(JSON.stringify(wrapSaveEnvelope(state)));

    expect(result.success).toBe(true);
    expect(result.state?.career.opportunities[0]).toMatchObject({
      status: 'expired',
      expiresAtDay: 1,
      resolvedAtDay: null,
    });
  });

  it('active career opportunity and selection process survive a save/load round trip', () => {
    const state = createInitialState();
    state.time.totalDaysPlayed = 12;
    state.career.opportunities = [
      {
        id: 'selection-opportunity',
        definitionId: 'township_deputy_leadership_vacancy',
        type: 'leadership_vacancy',
        status: 'in_process',
        source: {
          sourceType: 'assessment',
          sourceId: 'assessment-2026',
          signalId: 'assessment-2026',
          description: '年度考核',
        },
        sourceSignal: {
          signalId: 'assessment-2026',
          signalType: 'assessment.completed',
          occurredAtDay: 10,
          data: { year: 2026, score: 85, tier: '称职' },
        },
        target: {
          positionId: 'admin_l2_0',
          positionName: '副镇长',
          institutionId: 'township_govt_01',
          institutionName: '青云镇人民政府',
          regionId: 'region_qingyun_town',
          institutionLevel: 'township',
          positionDomain: 'local_governance',
          leadershipRank: 'township_deputy',
        },
        appointmentType: 'substantive',
        appointmentReason: 'promotion',
        appearedAtDay: 10,
        expiresAtDay: 40,
        acceptedAtDay: 10,
        rejectedAtDay: null,
        resolvedAtDay: null,
        cancelledAtDay: null,
        requiresSelection: true,
        eligibilityConditions: [],
        finalOutcome: null,
        reason: '年度考核完成后出现的乡科级副职岗位空缺',
      },
    ];
    state.career.activeProcess = {
      id: 'selection-process',
      type: 'leadership_selection',
      status: 'active',
      opportunityId: 'selection-opportunity',
      currentStage: 'democratic_recommendation',
      startedAtDay: 10,
      completedAtDay: null,
      stageResults: [
        {
          stage: 'eligibility_review',
          resolvedAtDay: 11,
          outcome: 'passed',
          score: 90,
          detail: '资格审查通过',
        },
      ],
    };

    const result = decodeCurrentSave(JSON.stringify(wrapSaveEnvelope(state)));

    expect(result.success).toBe(true);
    expect(result.state?.career.opportunities[0]).toMatchObject({
      id: 'selection-opportunity',
      status: 'in_process',
      acceptedAtDay: 10,
    });
    expect(result.state?.career.activeProcess).toMatchObject({
      id: 'selection-process',
      currentStage: 'democratic_recommendation',
      stageResults: [{ stage: 'eligibility_review', outcome: 'passed' }],
    });
  });

  it('Schema 6 非空时间轴 continuation 可完整往返', () => {
    const state = createInitialState();
    state.time.totalDaysPlayed = 30;
    state.time.pendingContinuation = {
      absoluteDay: 30,
      remainingNodes: [
        { type: 'monthly_settlement', absoluteDay: 30, month: 7, year: 2012 },
        { type: 'annual_assessment', absoluteDay: 30, year: 2012 },
      ],
    };
    const result = decodeCurrentSave(JSON.stringify(wrapSaveEnvelope(state)));
    expect(result.success).toBe(true);
    expect(result.state?.time.pendingContinuation).toEqual(state.time.pendingContinuation);
  });

  it('Schema 6 拒绝错误日期、重复或乱序 continuation 节点', () => {
    const cases = [
      {
        absoluteDay: 31,
        remainingNodes: [{ type: 'event_deadline' as const, absoluteDay: 31 }],
      },
      {
        absoluteDay: 30,
        remainingNodes: [
          { type: 'event_deadline' as const, absoluteDay: 30 },
          { type: 'event_deadline' as const, absoluteDay: 30 },
        ],
      },
      {
        absoluteDay: 30,
        remainingNodes: [
          { type: 'annual_assessment' as const, absoluteDay: 30, year: 2012 },
          { type: 'monthly_settlement' as const, absoluteDay: 30, month: 7, year: 2012 },
        ],
      },
    ];
    for (const pendingContinuation of cases) {
      const state = createInitialState();
      state.time.totalDaysPlayed = 30;
      state.time.pendingContinuation = pendingContinuation;
      const result = decodeCurrentSave(JSON.stringify(wrapSaveEnvelope(state)));
      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_envelope');
    }
  });

  it('Schema 5→6 确定性迁移执行中行动及来源上下文', () => {
    const state = createInitialState();
    const department = getConfigLoader()
      .resolvePositionDepartments(state.career.appointment.positionId)
      .find((item) => item.actions.some((action) => action.id === 'document_processing'));
    const action = department?.actions.find((item) => item.id === 'document_processing');
    expect(department).toBeDefined();
    expect(action).toBeDefined();
    if (!department || !action) return;
    state.actions.slots.primary.occupants[0] = {
      instanceId: 'schema6-only',
      actionId: action.id,
      deptId: department.id,
      actionName: action.name,
      originPositionId: state.career.appointment.positionId,
      originInstitutionId: state.career.appointment.institutionId,
      originRegionId: state.career.appointment.regionId,
      category: action.category,
      startedAtDay: 7,
      durationDays: action.durationDays,
      cooldownDays: action.cooldownDays,
      executableSnapshot: createActionExecutableSnapshot(
        department,
        action,
        '2026.07.3',
        getConfigLoader().getGameConfig().attributeBounds,
      ),
    };
    const schema5Envelope = JSON.parse(JSON.stringify(wrapSaveEnvelope(state))) as Record<
      string,
      unknown
    >;
    schema5Envelope.schemaVersion = 5;
    schema5Envelope.contentVersion = '2026.07.3';
    const legacyState = schema5Envelope.state as Record<string, unknown>;
    const legacyTime = legacyState.time as Record<string, unknown>;
    delete legacyTime.pendingContinuation;
    const legacyActions = legacyState.actions as Record<string, unknown>;
    const legacySlots = legacyActions.slots as Record<string, unknown>;
    const primary = legacySlots.primary as Record<string, unknown>;
    const occupants = primary.occupants as Array<Record<string, unknown> | null>;
    const occupant = occupants[0];
    expect(occupant).not.toBeNull();
    if (!occupant) return;
    delete occupant.instanceId;
    delete occupant.originPositionId;
    delete occupant.originInstitutionId;
    delete occupant.originRegionId;
    delete occupant.executableSnapshot;

    const result = decodeCurrentSave(JSON.stringify(schema5Envelope));
    expect(result.success).toBe(true);
    expect(result.state?.time.pendingContinuation).toBeNull();
    expect(result.state?.actions.slots.primary.occupants[0]).toMatchObject({
      instanceId: 'legacy-action-primary-0-7-document_processing',
      originPositionId: state.career.appointment.positionId,
      originInstitutionId: state.career.appointment.institutionId,
      originRegionId: state.career.appointment.regionId,
      startedAtDay: 7,
      durationDays: action.durationDays,
      executableSnapshot: {
        contentVersion: '2026.07.3',
        department: { id: department.id, name: department.name },
        action,
        attributeBounds: getConfigLoader().getGameConfig().attributeBounds,
      },
    });
  });

  it('Schema 5→6 无法解析在途行动时拒绝迁移并保留备份', () => {
    const state = createInitialState();
    const department = getConfigLoader().resolvePositionDepartments(
      state.career.appointment.positionId,
    )[0];
    expect(department).toBeDefined();
    if (!department) return;
    const action = department.actions[0];
    expect(action).toBeDefined();
    if (!action) return;
    state.actions.slots.primary.occupants[0] = {
      instanceId: 'schema6-only',
      actionId: action.id,
      deptId: department.id,
      actionName: action.name,
      originPositionId: state.career.appointment.positionId,
      originInstitutionId: state.career.appointment.institutionId,
      originRegionId: state.career.appointment.regionId,
      category: action.category,
      startedAtDay: 7,
      durationDays: action.durationDays,
      cooldownDays: action.cooldownDays,
      executableSnapshot: createActionExecutableSnapshot(
        department,
        action,
        '2026.07.3',
        getConfigLoader().getGameConfig().attributeBounds,
      ),
    };
    const schema5Envelope = JSON.parse(JSON.stringify(wrapSaveEnvelope(state))) as Record<
      string,
      unknown
    >;
    schema5Envelope.schemaVersion = 5;
    schema5Envelope.contentVersion = '2026.07.3';
    const legacyState = schema5Envelope.state as Record<string, unknown>;
    delete (legacyState.time as Record<string, unknown>).pendingContinuation;
    const legacySlots = (legacyState.actions as Record<string, unknown>).slots as Record<
      string,
      unknown
    >;
    const primary = legacySlots.primary as Record<string, unknown>;
    const occupant = (primary.occupants as Array<Record<string, unknown> | null>)[0];
    expect(occupant).not.toBeNull();
    if (!occupant) return;
    occupant.actionId = 'removed_action';
    delete occupant.instanceId;
    delete occupant.originPositionId;
    delete occupant.originInstitutionId;
    delete occupant.originRegionId;
    delete occupant.executableSnapshot;
    const json = JSON.stringify(schema5Envelope);

    const result = decodeCurrentSave(json);

    expect(result.success).toBe(false);
    expect(result.error).toBe('migration_failed');
    expect(result.backupKey).toBeDefined();
    if (!result.backupKey) return;
    expect(localStorage.getItem(result.backupKey)).toBe(json);
  });

  it('Schema 6→7 确定性补齐任职与职级运行时字段', () => {
    const state = createInitialState();
    const envelope = JSON.parse(JSON.stringify(wrapSaveEnvelope(state))) as Record<string, unknown>;
    envelope.schemaVersion = 6;
    envelope.contentVersion = '2026.07.4';
    const career = (envelope.state as Record<string, unknown>).career as Record<string, unknown>;
    const appointment = career.appointment as Record<string, unknown>;
    delete appointment.appointmentId;
    delete appointment.appointmentReason;
    delete appointment.sourceOpportunityId;
    delete career.civilServiceRankStartedAtDay;
    delete career.civilServiceRankHistory;
    delete career.restrictions;
    const metrics = ((envelope.state as Record<string, unknown>).world as Record<string, unknown>)
      .metrics as Record<string, unknown>;
    delete metrics['rank_quota.clerk_1'];
    metrics['rank_quota.section_4'] = 7;

    const result = decodeCurrentSave(JSON.stringify(envelope));

    expect(result.success).toBe(true);
    expect(result.state?.career.appointment).toMatchObject({
      appointmentId: `legacy-appointment-${state.career.appointment.positionId}-0`,
      appointmentReason: 'initial_assignment',
      sourceOpportunityId: null,
    });
    expect(result.state?.career).toMatchObject({
      civilServiceRankStartedAtDay: 0,
      civilServiceRankHistory: [],
      restrictions: [],
    });
    expect(result.state?.world.metrics).toMatchObject({
      ...getConfigLoader().getInitialCivilServiceRankQuotaMetrics(),
      'rank_quota.section_4': 7,
    });
  });

  it('Schema 7 → 8 migrates every historical career experience', () => {
    const state = createInitialState();
    const openExperience = { ...state.career.experiences[0]! } as Record<string, unknown>;
    delete openExperience.appointmentId;
    delete openExperience.appointmentType;
    delete openExperience.sourceOpportunityId;
    delete openExperience.endReason;
    const historicalExperience = {
      ...openExperience,
      id: 'historical-experience',
      startedAtDay: 0,
      endedAtDay: 10,
      appointmentReason: 'temporary_assignment',
    };
    const envelope = JSON.parse(JSON.stringify(wrapSaveEnvelope(state))) as Record<string, unknown>;
    envelope.schemaVersion = 7;
    envelope.contentVersion = '2026.07.5';
    const career = (envelope.state as Record<string, unknown>).career as Record<string, unknown>;
    career.experiences = [historicalExperience, openExperience];

    const result = decodeCurrentSave(JSON.stringify(envelope));

    expect(result.success).toBe(true);
    expect(result.state?.career.experiences).toHaveLength(2);
    expect(result.state?.career.experiences[0]).toMatchObject({
      id: 'historical-experience',
      appointmentId: 'legacy-appointment-historical-experience-0',
      appointmentType: 'temporary',
      sourceOpportunityId: null,
      endReason: null,
    });
  });

  it('Schema 8 → 9 expands the legacy probation end into an auditable lifecycle', () => {
    const state = createInitialState();
    const envelope = JSON.parse(JSON.stringify(wrapSaveEnvelope(state))) as Record<string, unknown>;
    envelope.schemaVersion = 8;
    envelope.contentVersion = '2026.07.8';
    const career = (envelope.state as Record<string, unknown>).career as Record<string, unknown>;
    const appointment = career.appointment as Record<string, unknown>;
    delete appointment.probation;
    appointment.probationEndsAtDay = 360;

    const result = decodeCurrentSave(JSON.stringify(envelope));

    expect(result.success).toBe(true);
    expect(result.state?.career.appointment.probation).toEqual({
      status: 'active',
      startedAtDay: 0,
      endsAtDay: 360,
      extensionCount: 0,
      completedActionCount: 0,
      resolvedAtDay: null,
      outcomeReason: null,
      evaluations: [],
    });
  });

  it('Schema 10 旧内容存档清除无法证明来源的预置未来职数', () => {
    const state = createInitialState();
    state.assessments.annualAssessments = [];
    for (const rule of getConfigLoader().getAllCivilServiceRankProgressionRules()) {
      const quota = rule.quotaRequirement;
      if (quota) state.world.metrics[quota.metricId] = quota.requiredValue;
    }
    state.world.metrics.unrelated_metric = 42;
    const envelope = { ...wrapSaveEnvelope(state), contentVersion: '2026.08.2' };

    const result = decodeCurrentSave(JSON.stringify(envelope));

    expect(result.success).toBe(true);
    expect(result.state?.assessments.annualAssessments).toEqual([]);
    expect(result.state?.world.metrics).toMatchObject(
      getConfigLoader().getInitialCivilServiceRankQuotaMetrics(),
    );
    expect(result.state?.world.metrics.unrelated_metric).toBe(42);
  });

  it('Schema 10 当前内容存档保留年度 producer 已取得的职数', () => {
    const state = createInitialState();
    state.assessments.annualAssessments.push({ year: 2012, score: 75, tier: '称职' });
    state.world.metrics['rank_quota.clerk_1'] = 1;
    const envelope = wrapSaveEnvelope(state);
    expect(envelope.contentVersion).toBe(CURRENT_CONTENT_VERSION);

    const result = decodeCurrentSave(JSON.stringify(envelope));

    expect(result.success).toBe(true);
    expect(result.state?.world.metrics['rank_quota.clerk_1']).toBe(1);
  });

  it('Schema 10 乡镇治理内容迁移保留预算和在途执行快照', () => {
    const state = createInitialState();
    const store = createTestStore(state);
    store.dispatch({
      type: 'START_PERSONAL_TASK',
      taskId: 'task_policy_study',
      tierKey: 'primary',
      _idFactory: () => 'governance-migration-task',
    });
    const before = store.getRawState();
    const envelope = {
      ...wrapSaveEnvelope(before),
      contentVersion: '2026.08.4',
    };

    const result = decodeCurrentSave(JSON.stringify(envelope));

    expect(result.success).toBe(true);
    expect(result.state?.remainingBudget).toBe(before.remainingBudget);
    expect(result.state?.actions.slots.primary.occupants[0]).toEqual(
      before.actions.slots.primary.occupants[0],
    );
  });

  it('Schema 10 旧副职流程被取消并保留审计，其他机会不受影响', () => {
    const state = createInitialState();
    state.time.totalDaysPlayed = 600;
    const base: AppointmentCareerOpportunity = {
      id: 'legacy-deputy',
      definitionId: 'township_deputy_leadership_vacancy',
      type: 'leadership_vacancy',
      status: 'in_process',
      source: {
        sourceType: 'assessment',
        sourceId: 'assessment:2027',
        signalId: 'signal-1',
        description: 'assessment.completed',
      },
      sourceSignal: {
        signalId: 'signal-1',
        signalType: 'assessment.completed',
        occurredAtDay: 540,
        data: { year: 2027, score: 80, tier: '称职' },
      },
      target: {
        positionId: 'admin_l2_0',
        positionName: '副镇长',
        institutionId: 'township_govt_01',
        institutionName: '青云镇人民政府',
        regionId: 'region_qingyun_town',
        institutionLevel: 'township',
        positionDomain: 'local_governance',
        leadershipRank: 'township_deputy',
      },
      appointmentType: 'substantive',
      appointmentReason: 'promotion',
      appearedAtDay: 540,
      expiresAtDay: 810,
      acceptedAtDay: 550,
      rejectedAtDay: null,
      resolvedAtDay: null,
      cancelledAtDay: null,
      requiresSelection: true,
      eligibilityConditions: [],
      finalOutcome: null,
      reason: '旧版无条件机会',
    };
    state.career.opportunities = [
      base,
      {
        ...structuredClone(base),
        id: 'unrelated',
        definitionId: 'other-definition',
        status: 'available',
        acceptedAtDay: null,
      },
    ];
    state.career.activeProcess = {
      id: 'legacy-process',
      type: 'leadership_selection',
      status: 'active',
      opportunityId: base.id,
      currentStage: 'organization_inspection',
      startedAtDay: 550,
      completedAtDay: null,
      stageResults: [],
    };
    const result = decodeCurrentSave(
      JSON.stringify({ ...wrapSaveEnvelope(state), contentVersion: '2026.08.3' }),
    );

    expect(result.success).toBe(true);
    expect(result.state?.career.opportunities[0]).toMatchObject({
      status: 'cancelled',
      acceptedAtDay: null,
      cancelledAtDay: 600,
    });
    expect(result.state?.career.opportunities[1]?.status).toBe('available');
    expect(result.state?.career.activeProcess).toBeNull();
    expect(result.state?.career.completedProcesses.at(-1)).toMatchObject({
      id: 'legacy-process',
      status: 'cancelled',
      completedAtDay: 600,
      stageResults: [{ stage: 'organization_inspection', outcome: 'cancelled' }],
    });
  });

  it('Schema 9 旧内容迁移在覆盖内容版本前清除预置未来职数', () => {
    const state = createInitialState();
    for (const rule of getConfigLoader().getAllCivilServiceRankProgressionRules()) {
      const quota = rule.quotaRequirement;
      if (quota) state.world.metrics[quota.metricId] = quota.requiredValue;
    }
    state.world.metrics.unrelated_metric = 73;
    const envelope = {
      ...wrapSaveEnvelope(state),
      schemaVersion: 9,
      contentVersion: '2026.08.1',
    } as Record<string, unknown>;
    const actions = (envelope.state as Record<string, unknown>).actions as Record<string, unknown>;
    delete actions.personalTasks;

    const result = decodeCurrentSave(JSON.stringify(envelope));

    expect(result.success).toBe(true);
    expect(result.state?.actions.personalTasks).toEqual({
      cooldownUntilDays: {},
      completedCounts: {},
      totalCompleted: 0,
    });
    expect(result.state?.world.metrics).toMatchObject(
      getConfigLoader().getInitialCivilServiceRankQuotaMetrics(),
    );
    expect(result.state?.world.metrics.unrelated_metric).toBe(73);
  });

  it('rejects career opportunities with invalid lifecycle dates during strict decode', () => {
    const invalidOpportunities: Array<Partial<AppointmentCareerOpportunity>> = [
      { status: 'available', acceptedAtDay: 1 },
      { status: 'accepted' },
      { status: 'in_process' },
      { status: 'rejected' },
      { status: 'resolved', resolvedAtDay: 1, finalOutcome: 'appointed' },
      { status: 'expired', expiresAtDay: null },
      { status: 'cancelled' },
      { status: 'cancelled', acceptedAtDay: 1, cancelledAtDay: 2 },
    ];
    for (const patch of invalidOpportunities) {
      const state = createInitialState();
      const opportunity: AppointmentCareerOpportunity = {
        id: 'invalid-lifecycle',
        definitionId: 'invalid-lifecycle-definition',
        type: 'leadership_vacancy',
        status: 'available',
        source: {
          sourceType: 'system',
          sourceId: 'test-source',
          signalId: null,
          description: 'test',
        },
        sourceSignal: null,
        target: {
          positionId: 'test-position',
          positionName: 'test position',
          institutionId: 'test-institution',
          institutionName: 'test institution',
          regionId: 'test-region',
          institutionLevel: 'township',
          positionDomain: 'local_governance',
          leadershipRank: 'none',
        },
        appointmentType: 'substantive',
        appointmentReason: 'promotion',
        appearedAtDay: 0,
        expiresAtDay: 10,
        acceptedAtDay: null,
        rejectedAtDay: null,
        resolvedAtDay: null,
        cancelledAtDay: null,
        requiresSelection: true,
        eligibilityConditions: [],
        finalOutcome: null,
        reason: 'test',
        ...patch,
      };
      state.career.opportunities = [opportunity];
      const result = decodeCurrentSave(JSON.stringify(wrapSaveEnvelope(state)));
      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_envelope');
    }
  });

  it('Schema 6→7 拒绝非空机会或进行中的职业流程并保留备份', () => {
    const cases: Array<{ careerField: 'opportunities' | 'activeProcess'; value: unknown }> = [
      { careerField: 'opportunities', value: [{}] },
      { careerField: 'activeProcess', value: {} },
    ];
    for (const { careerField, value } of cases) {
      const envelope = JSON.parse(JSON.stringify(wrapSaveEnvelope(createInitialState()))) as Record<
        string,
        unknown
      >;
      envelope.schemaVersion = 6;
      envelope.contentVersion = '2026.07.4';
      const career = (envelope.state as Record<string, unknown>).career as Record<string, unknown>;
      career[careerField] = value;
      const json = JSON.stringify(envelope);

      const result = decodeCurrentSave(json);

      expect(result.success).toBe(false);
      expect(result.error).toBe('migration_failed');
      expect(result.backupKey).toBeDefined();
      if (!result.backupKey) continue;
      expect(localStorage.getItem(result.backupKey)).toBe(json);
    }
  });

  it('Schema 1 存档被拒绝并创建备份', () => {
    const schema1Envelope = {
      schemaVersion: 1,
      contentVersion: '2026.07.1',
      revision: 0,
      savedAt: Date.now(),
      state: { currentPositionId: 'admin_l1_0', currentLevel: 1 },
    };
    const json = JSON.stringify(schema1Envelope);
    const result = decodeCurrentSave(json);
    expect(result.success).toBe(false);
    expect(result.error).toBe('legacy_save_unsupported');
    expect(result.backupKey).toBeDefined();
    // 验证备份存在
    expect(localStorage.getItem(result.backupKey!)).toBe(json);
  });

  it('未来 Schema 被拒绝', () => {
    const futureEnvelope = {
      schemaVersion: CURRENT_SCHEMA_VERSION + 1,
      contentVersion: '2026.07.1',
      revision: 0,
      savedAt: Date.now(),
      state: {},
    };
    const result = decodeCurrentSave(JSON.stringify(futureEnvelope));
    expect(result.success).toBe(false);
    expect(result.error).toBe('future_version');
  });

  it('Schema 2 存档确定性迁移至 Schema 3', () => {
    // 构造一个 Schema 2 存档（治理指标为扁平结构）
    const state = createInitialState();
    state.character.characterName = '迁移测试';
    const schema2Envelope = {
      schemaVersion: 2,
      contentVersion: '2026.07.1',
      revision: 3,
      savedAt: Date.now(),
      state: {
        ...state,
        governance: {
          ...state.governance,
          // Schema 2 扁平指标（旧结构）
          institutionMetrics: { legacy_flat_metric: 42 },
          regionMetrics: {},
        },
      },
    };
    const result = decodeCurrentSave(JSON.stringify(schema2Envelope));
    // 迁移成功
    expect(result.success).toBe(true);
    expect(result.state?.character.characterName).toBe('迁移测试');
    // 治理指标被重置为空嵌套集合（扁平结构无有效解释）
    expect(result.state?.governance.institutionMetrics).toEqual({});
    expect(result.state?.governance.regionMetrics).toEqual({});
  });

  it('Schema 4 含政策实例时明确迁移失败并保留原始备份', () => {
    const state = createInitialState();
    const schema4Envelope = {
      ...wrapSaveEnvelope(state),
      schemaVersion: 4,
      contentVersion: '2026.07.2',
      state: {
        ...state,
        governance: {
          ...state.governance,
          policies: [
            {
              instanceId: 'legacy_policy_1',
              policyId: 'industrial_park_support',
              status: 'approved',
              regionId: 'region_qingyun_town',
              responsibleInstitutionId: 'township_govt_01',
            },
          ],
        },
      },
    };
    const json = JSON.stringify(schema4Envelope);
    const result = decodeCurrentSave(json);

    expect(result.success).toBe(false);
    expect(result.error).toBe('migration_failed');
    expect(result.backupKey).toBeDefined();
    expect(localStorage.getItem(result.backupKey!)).toBe(json);
  });

  it('旧职业字段被 .strict() 拒绝', () => {
    const state = createInitialState();
    // 注入旧字段
    const corrupted = { ...state, currentLevel: 3, currentCareerLine: 'admin' };
    const envelope = wrapSaveEnvelope(corrupted as typeof state);
    const result = decodeCurrentSave(JSON.stringify(envelope));
    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid_envelope');
  });

  it('裸 PlayerSave（无 Envelope）被拒绝', () => {
    const state = createInitialState();
    const result = decodeCurrentSave(JSON.stringify(state));
    expect(result.success).toBe(false);
    expect(result.error).toBe('legacy_save_unsupported');
  });
});

describe('领域契约完整性', () => {
  it('所有领域枚举 ID 唯一', () => {
    const allEnums = [
      INSTITUTION_LEVELS,
      POSITION_DOMAINS,
      LEADERSHIP_RANKS,
      CIVIL_SERVICE_RANKS,
      POLICY_STATUSES,
      DOMAIN_SIGNALS,
      EVENT_PRIORITIES,
      EVENT_PRESENTATIONS,
      EFFECT_TARGET_DISCRIMINANTS,
    ];
    for (const enumArr of allEnums) {
      const set = new Set(enumArr);
      expect(set.size).toBe(enumArr.length);
    }
  });

  it('所有领域枚举有完整中文标签', () => {
    for (const key of INSTITUTION_LEVELS) {
      expect(INSTITUTION_LEVEL_LABELS[key]).toBeTruthy();
    }
    for (const key of POSITION_DOMAINS) {
      expect(POSITION_DOMAIN_LABELS[key]).toBeTruthy();
    }
    for (const key of LEADERSHIP_RANKS) {
      expect(LEADERSHIP_RANK_LABELS[key]).toBeTruthy();
    }
    for (const key of CIVIL_SERVICE_RANKS) {
      expect(CIVIL_SERVICE_RANK_LABELS[key]).toBeTruthy();
    }
  });

  it('领导职务层次按行政层级从低到高排序', () => {
    expect(LEADERSHIP_RANKS[0]).toBe('none');
    expect(LEADERSHIP_RANKS[LEADERSHIP_RANKS.length - 1]).toBe('national_chief');
  });

  it('公务员职级从低到高排序', () => {
    expect(CIVIL_SERVICE_RANKS[0]).toBe('clerk_2');
    expect(CIVIL_SERVICE_RANKS[CIVIL_SERVICE_RANKS.length - 1]).toBe('inspector_1');
  });
});

describe('36 职位配置引用完整性', () => {
  const loader = getConfigLoader();

  it('全部 36 个职位可通过 ID 查询', () => {
    const positions = loader.getAllPositions();
    expect(positions.length).toBe(36);
    for (const pos of positions) {
      expect(loader.getPositionById(pos.id)).not.toBeNull();
    }
  });

  it('所有职位 ID 唯一', () => {
    const positions = loader.getAllPositions();
    const ids = new Set(positions.map((p) => p.id));
    expect(ids.size).toBe(36);
  });

  it('所有机构引用存在', () => {
    const positions = loader.getAllPositions();
    for (const pos of positions) {
      expect(loader.getInstitutionById(pos.institutionId)).not.toBeNull();
    }
  });

  it('所有部门模板引用可解析', () => {
    const positions = loader.getAllPositions();
    for (const pos of positions) {
      expect(() => loader.resolvePositionDepartments(pos.id)).not.toThrow();
    }
  });

  it('所有 KPI 模板引用可解析', () => {
    const positions = loader.getAllPositions();
    for (const pos of positions) {
      expect(() => loader.resolvePositionKpis(pos.id)).not.toThrow();
    }
  });

  it('配置中不存在旧字段 level/careerLine', () => {
    const positions = loader.getAllPositions();
    for (const pos of positions) {
      expect(pos).not.toHaveProperty('level');
      expect(pos).not.toHaveProperty('careerLine');
      expect(pos).not.toHaveProperty('promotionRequirements');
    }
  });

  it('未知 ID 查询返回 null 而非回退', () => {
    expect(loader.getPositionById('nonexistent_id')).toBeNull();
    expect(loader.getInstitutionById('nonexistent_inst')).toBeNull();
  });
});

describe('NEW_GAME 隔离性', () => {
  it('NEW_GAME 不继承旧存档的事件、政策和履历', () => {
    const store = createTestStore();

    // 先加载一个有内容的存档
    const oldState = createInitialState();
    oldState.character.characterName = '旧角色';
    oldState.career.experiences = [
      {
        id: 'exp_1',
        appointmentId: 'appointment-exp_1',
        positionId: 'admin_l2_0',
        positionNameSnapshot: '副镇长',
        institutionId: 'township_govt_01',
        institutionNameSnapshot: '青云镇人民政府',
        institutionLevel: 'township',
        regionId: 'region_qingyun_town',
        positionDomain: 'local_governance',
        leadershipRank: 'township_deputy',
        startedAtDay: 0,
        endedAtDay: 360,
        appointmentReason: 'promotion',
        appointmentType: 'substantive',
        sourceOpportunityId: null,
        endReason: 'promotion',
        assessmentResults: [],
      },
    ];
    oldState.governance.policies = [
      {
        instanceId: 'pol_1',
        policyId: 'test_policy',
        status: 'implementing',
        proposedAtDay: 0,
        approvedAtDay: 10,
        effectiveAtDay: 20,
        currentPhaseId: 'phase_1',
        phaseEnteredAtDay: 20,
        nextMilestoneAtDay: 50,
        suspendedAtDay: null,
        accumulatedSuspendedDays: 0,
        completedAtDay: null,
        failedAtDay: null,
        repealedAtDay: null,
        originContext: {
          positionId: 'admin_l2_0',
          institutionId: 'township_govt_01',
          regionId: 'region_qingyun_town',
          institutionLevel: 'township',
          positionDomain: 'local_governance',
          leadershipRank: 'township_deputy',
          experienceId: 'exp_1',
        },
        snapshot: {
          policyId: 'test_policy',
          name: '测试政策',
          description: '',
          category: 'economic',
          tags: [],
          effectiveDelayDays: 0,
          approvalEffects: [],
          phases: [],
          contentVersion: 'test',
        },
        metrics: {},
      },
    ];
    store.dispatch({ type: 'LOAD_SAVE', save: oldState });

    // 执行 NEW_GAME
    store.dispatch({
      type: 'NEW_GAME',
      data: { characterName: '新角色', gender: '男' },
    });

    const state = store.getRawState();
    // 新角色名
    expect(state.character.characterName).toBe('新角色');
    // 新建游戏立即创建唯一的初始开放履历。
    expect(state.career.experiences).toHaveLength(1);
    expect(state.career.experiences[0]?.appointmentId).toBe(state.career.appointment.appointmentId);
    // 政策已清空
    expect(state.governance.policies.length).toBe(0);
    // 事件已清空
    expect(state.events.pending.length).toBe(0);
    expect(state.events.history.length).toBe(0);
    // 任职重置为初始
    expect(state.career.appointment.positionId).toBe('admin_l1_0');
    expect(state.career.appointment.leadershipRank).toBe('none');
  });
});
