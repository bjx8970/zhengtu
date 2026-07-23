/**
 * Schema 2 与领域模型集成测试
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
import { CURRENT_SCHEMA_VERSION } from '../../types/save';
import { getConfigLoader } from '../../config/loader';
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
        regionId: 'region_qingyun_town',
        responsibleInstitutionId: 'township_govt_01',
        currentPhaseId: 'phase_1',
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
    // 履历已清空
    expect(state.career.experiences.length).toBe(0);
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
