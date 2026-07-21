/**
 * 存档严格解码器测试
 *
 * 覆盖场景：
 * - 当前版本完整 Envelope 可以加载
 * - 裸 PlayerSave 被识别为不兼容旧存档并拒绝
 * - 较低 schemaVersion 被拒绝
 * - 未来 schemaVersion 被拒绝
 * - 缺失 Envelope 元数据被拒绝
 * - 损坏的当前版本状态被拒绝
 * - 不兼容存档不会被静默覆盖（创建备份）
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { decodeCurrentSave, decodeCurrentSaveData, wrapSaveEnvelope } from '../index';
import { CURRENT_SCHEMA_VERSION, CURRENT_CONTENT_VERSION } from '../../../types/save';
import { createInitialState } from '../../game-store';

describe('存档严格解码器', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('decodeCurrentSave', () => {
    it('当前版本完整 Envelope 可以加载', () => {
      const state = createInitialState({ characterName: '测试角色' });
      const envelope = wrapSaveEnvelope(state);
      const raw = JSON.stringify(envelope);

      const result = decodeCurrentSave(raw);
      expect(result.success).toBe(true);
      expect(result.state?.characterName).toBe('测试角色');
    });

    it('JSON 解析失败返回 invalid_json 并创建备份', () => {
      const result = decodeCurrentSave('invalid json{{{');
      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_json');
      expect(result.backupKey).toBeDefined();
      expect(localStorage.getItem(result.backupKey!)).toBe('invalid json{{{');
    });

    it('裸 PlayerSave 被识别为不兼容旧存档', () => {
      const legacySave = createInitialState();
      const raw = JSON.stringify(legacySave);

      const result = decodeCurrentSave(raw);
      expect(result.success).toBe(false);
      expect(result.error).toBe('legacy_save_unsupported');
      expect(result.detail).toContain('不兼容旧存档');
      // 创建了备份
      expect(result.backupKey).toBeDefined();
    });

    it('较低 schemaVersion 被拒绝', () => {
      const oldEnvelope = {
        schemaVersion: 0,
        contentVersion: '3.0.0',
        revision: 1,
        savedAt: Date.now(),
        state: createInitialState(),
      };

      const result = decodeCurrentSave(JSON.stringify(oldEnvelope));
      expect(result.success).toBe(false);
      expect(result.error).toBe('legacy_save_unsupported');
    });

    it('未来 schemaVersion 被拒绝', () => {
      const futureEnvelope = {
        schemaVersion: 99,
        contentVersion: '99.0.0',
        revision: 1,
        savedAt: Date.now(),
        state: createInitialState(),
      };

      const result = decodeCurrentSave(JSON.stringify(futureEnvelope));
      expect(result.success).toBe(false);
      expect(result.error).toBe('future_version');
      expect(result.detail).toContain('高于当前支持');
    });

    it('缺失 Envelope 元数据被拒绝', () => {
      const incomplete = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        // 缺失 contentVersion, revision, savedAt, state
      };

      const result = decodeCurrentSave(JSON.stringify(incomplete));
      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_envelope');
    });

    it('损坏的当前版本状态被拒绝', () => {
      const corrupted = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        contentVersion: CURRENT_CONTENT_VERSION,
        revision: 1,
        savedAt: Date.now(),
        state: { invalid: 'data' },
      };

      const result = decodeCurrentSave(JSON.stringify(corrupted));
      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_envelope');
      expect(result.detail).toContain('验证失败');
    });

    it('不兼容存档创建只读备份', () => {
      const legacySave = createInitialState();
      const raw = JSON.stringify(legacySave);

      const result = decodeCurrentSave(raw);
      expect(result.success).toBe(false);
      expect(result.backupKey).toBeDefined();

      // 备份确实存在于 localStorage
      if (result.backupKey) {
        const backed = localStorage.getItem(result.backupKey);
        expect(backed).toBe(raw);
      }
    });
  });

  describe('decodeCurrentSaveData', () => {
    it('非对象数据返回 invalid_envelope', () => {
      expect(decodeCurrentSaveData(null).error).toBe('invalid_envelope');
      expect(decodeCurrentSaveData(42).error).toBe('invalid_envelope');
      expect(decodeCurrentSaveData('string').error).toBe('invalid_envelope');
    });

    it('当前版本 Envelope 数据可以解码', () => {
      const state = createInitialState();
      const envelope = wrapSaveEnvelope(state);

      const result = decodeCurrentSaveData(envelope);
      expect(result.success).toBe(true);
      expect(result.state).toBeDefined();
    });
  });

  describe('wrapSaveEnvelope', () => {
    it('正确封装 SaveEnvelope', () => {
      const state = createInitialState();
      const envelope = wrapSaveEnvelope(state, 5);

      expect(envelope.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      expect(envelope.revision).toBe(6);
      expect(envelope.state).toBe(state);
      expect(envelope.savedAt).toBeGreaterThan(0);
      expect(envelope.contentVersion).toBe('2026.07.1');
    });
  });

  describe('严格模式拒绝未知字段', () => {
    it('Envelope 顶层未知字段被拒绝', () => {
      const state = createInitialState();
      const envelope = { ...wrapSaveEnvelope(state), unknownField: 'hack' };

      const result = decodeCurrentSave(JSON.stringify(envelope));
      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_envelope');
    });

    it('state 顶层未知字段被拒绝', () => {
      const state = createInitialState();
      const envelope = wrapSaveEnvelope({ ...state, hackedField: 123 } as typeof state);

      const result = decodeCurrentSave(JSON.stringify(envelope));
      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_envelope');
    });

    it('state.time 中的未知字段被拒绝', () => {
      const state = createInitialState();
      (state.time as unknown as Record<string, unknown>).newField = 'data';
      const envelope = wrapSaveEnvelope(state);

      const result = decodeCurrentSave(JSON.stringify(envelope));
      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_envelope');
    });

    it('slots.primary.occupants[0] 中的未知字段被拒绝', () => {
      const state = createInitialState();
      state.slots.primary.occupants[0] = {
        actionId: 'test',
        deptId: 'dept',
        actionName: '测试',
        category: 'minor',
        startedAtDay: 0,
        durationDays: 3,
        cooldownDays: 7,
        hackedProp: true,
      } as never;
      const envelope = wrapSaveEnvelope(state);

      const result = decodeCurrentSave(JSON.stringify(envelope));
      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_envelope');
    });

    it('careerHistory 项中的未知字段被拒绝', () => {
      const state = createInitialState();
      state.careerHistory = [
        {
          positionId: 'admin_l1_0',
          positionName: '科员',
          level: 1,
          careerLine: 'admin',
          startYear: 2012,
          endYear: 2015,
          assessmentResults: [],
          archived: false,
          unknownProp: 'x',
        } as never,
      ];
      const envelope = wrapSaveEnvelope(state);

      const result = decodeCurrentSave(JSON.stringify(envelope));
      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_envelope');
    });
  });

  describe('晋升状态机一致性校验', () => {
    it('promotionStage 与 promotionState.currentStage 矛盾时拒绝', () => {
      const state = createInitialState();
      state.promotionStage = 'democratic_vote' as never;
      state.promotionState = {
        targetPositionId: 'admin_l2_0',
        targetLevel: 2,
        currentStage: 'probation' as never, // 与顶层矛盾
        stageResults: {},
      };
      const envelope = wrapSaveEnvelope(state);

      const result = decodeCurrentSave(JSON.stringify(envelope));
      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_envelope');
    });

    it('非法 currentStage 字符串被拒绝', () => {
      const state = createInitialState();
      state.promotionStage = 'invalid_stage' as never;
      state.promotionState = {
        targetPositionId: 'admin_l2_0',
        targetLevel: 2,
        currentStage: 'invalid_stage' as never,
        stageResults: {},
      };
      const envelope = wrapSaveEnvelope(state);

      const result = decodeCurrentSave(JSON.stringify(envelope));
      expect(result.success).toBe(false);
      expect(result.error).toBe('invalid_envelope');
    });

    it('合法且一致的活动阶段能正常解码', () => {
      const state = createInitialState();
      state.promotionStage = 'democratic_vote' as never;
      state.promotionState = {
        targetPositionId: 'admin_l2_0',
        targetLevel: 2,
        currentStage: 'democratic_vote' as never,
        stageResults: {},
      };
      const envelope = wrapSaveEnvelope(state);

      const result = decodeCurrentSave(JSON.stringify(envelope));
      expect(result.success).toBe(true);
    });

    it('idle + promotionState null 能正常解码', () => {
      const state = createInitialState();
      // 默认就是 idle + null
      const envelope = wrapSaveEnvelope(state);

      const result = decodeCurrentSave(JSON.stringify(envelope));
      expect(result.success).toBe(true);
    });
  });
});
