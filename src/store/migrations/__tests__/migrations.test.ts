/**
 * 存档迁移框架测试
 *
 * 覆盖场景：
 * - 版本检测
 * - v0 → v1 迁移
 * - 迁移失败处理
 * - SaveEnvelope 封装
 * - Schema 验证
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectSchemaVersion,
  migrateSave,
  wrapSaveEnvelope,
  validatePlayerSave,
  extractPlayerSave,
} from '../index';
import { CURRENT_SCHEMA_VERSION } from '../../../types/save';
import { createInitialState } from '../../game-store';

describe('存档迁移框架', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe('detectSchemaVersion', () => {
    it('识别 SaveEnvelope 格式的版本号', () => {
      const envelope = {
        schemaVersion: 1,
        contentVersion: '4.0.0',
        revision: 1,
        savedAt: Date.now(),
        state: createInitialState(),
      };
      expect(detectSchemaVersion(envelope)).toBe(1);
    });

    it('识别无版本号的旧存档为 v0', () => {
      const legacySave = createInitialState();
      expect(detectSchemaVersion(legacySave)).toBe(0);
    });

    it('无法识别的数据返回 -1', () => {
      expect(detectSchemaVersion(null)).toBe(-1);
      expect(detectSchemaVersion({})).toBe(-1);
      expect(detectSchemaVersion({ foo: 'bar' })).toBe(-1);
    });
  });

  describe('migrateSave', () => {
    it('迁移 v0 旧存档：删除临时字段', () => {
      const legacySave = createInitialState() as unknown as Record<string, unknown>;
      legacySave._pendingDeviationMultiplier = 0.8;
      legacySave.pendingStyleConflict = true;

      const raw = JSON.stringify(legacySave);
      const result = migrateSave(raw);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.migratedFrom).toBe(0);
        const state = result.state as unknown as Record<string, unknown>;
        expect(state._pendingDeviationMultiplier).toBeUndefined();
        expect(state.pendingStyleConflict).toBeUndefined();
      }
    });

    it('迁移 v0 旧存档：为槽位行动补充 runtimeSnapshot', () => {
      const legacySave = createInitialState();
      legacySave.slots.primary.occupants[0] = {
        actionId: 'test',
        deptId: 'dept',
        actionName: '测试行动',
        category: 'minor',
        startedAtDay: 0,
        durationDays: 3,
        cooldownDays: 7,
      };

      const raw = JSON.stringify(legacySave);
      const result = migrateSave(raw);

      expect(result.success).toBe(true);
      if (result.success) {
        const occupant = result.state.slots.primary.occupants[0];
        expect(occupant?.runtimeSnapshot).toEqual({
          effectivenessMultiplier: 1,
          styleConflictTriggered: false,
        });
      }
    });

    it('已是最新版本直接返回', () => {
      const state = createInitialState();
      const envelope = wrapSaveEnvelope(state);
      const raw = JSON.stringify(envelope);
      const result = migrateSave(raw);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.migratedFrom).toBe(CURRENT_SCHEMA_VERSION);
      }
    });

    it('JSON 解析失败返回错误', () => {
      const result = migrateSave('invalid json{{{');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('JSON 解析失败');
      }
    });

    it('无法识别的格式返回错误', () => {
      const result = migrateSave(JSON.stringify({ foo: 'bar' }));
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toContain('无法识别');
      }
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
    });
  });

  describe('validatePlayerSave', () => {
    it('验证合法 PlayerSave', () => {
      const state = createInitialState();
      const result = validatePlayerSave(state);
      expect(result.valid).toBe(true);
    });

    it('拒绝缺少必要字段的数据', () => {
      const result = validatePlayerSave({ foo: 'bar' });
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('extractPlayerSave', () => {
    it('从 SaveEnvelope 提取 state', () => {
      const state = createInitialState();
      const envelope = wrapSaveEnvelope(state);
      const extracted = extractPlayerSave(envelope);
      expect(extracted).toBe(state);
    });

    it('从裸 PlayerSave 直接返回', () => {
      const state = createInitialState();
      const extracted = extractPlayerSave(state);
      expect(extracted).toBe(state);
    });

    it('无效数据返回 null', () => {
      expect(extractPlayerSave(null)).toBeNull();
      expect(extractPlayerSave({})).toBeNull();
    });
  });
});
