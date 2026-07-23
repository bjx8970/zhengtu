/**
 * 领域契约负向测试
 *
 * 证明非法配置被 Schema 严格拒绝：
 * - 条件表达式：未知字段、类型错配、缺失必填值
 * - 效果定义：目标-操作错配、缺失 subjectId
 * - 信号快照：未知信号类型、缺失载荷字段
 * - 事件链：分支状态往返
 */
import { describe, it, expect } from 'vitest';
import { ConditionExpressionSchema, EffectDefinitionSchema } from '../../domain/conditions';
import { DomainSignalSnapshotSchema } from '../../domain/governance/types';

describe('ConditionExpression 负向测试', () => {
  it('拒绝未知 signalField', () => {
    const invalid = { signalField: 'nonExistentField', op: 'eq', value: 1 };
    expect(ConditionExpressionSchema.safeParse(invalid).success).toBe(false);
  });

  it('接受合法 signalField（字符串 ID + eq + string）', () => {
    const valid = { signalField: 'actionId', op: 'eq', value: 'test' };
    expect(ConditionExpressionSchema.safeParse(valid).success).toBe(true);
  });

  it('拒绝字符串 ID 字段使用数值比较', () => {
    const invalid = { signalField: 'actionId', op: 'gte', value: 5 };
    expect(ConditionExpressionSchema.safeParse(invalid).success).toBe(false);
  });

  it('拒绝字符串 ID 字段使用 number 值', () => {
    const invalid = { signalField: 'actionId', op: 'eq', value: 42 };
    expect(ConditionExpressionSchema.safeParse(invalid).success).toBe(false);
  });

  it('接受数值字段使用数值比较', () => {
    const valid = { signalField: 'year', op: 'gte', value: 2020 };
    expect(ConditionExpressionSchema.safeParse(valid).success).toBe(true);
  });

  it('拒绝数值字段使用 string 值', () => {
    const invalid = { signalField: 'year', op: 'eq', value: '2026' };
    expect(ConditionExpressionSchema.safeParse(invalid).success).toBe(false);
  });

  it('拒绝可空字段使用数值比较', () => {
    const invalid = { signalField: 'optionId', op: 'gt', value: true };
    expect(ConditionExpressionSchema.safeParse(invalid).success).toBe(false);
  });

  it('接受可空字段使用 eq + string', () => {
    const valid = { signalField: 'optionId', op: 'eq', value: 'opt_1' };
    expect(ConditionExpressionSchema.safeParse(valid).success).toBe(true);
  });

  it('接受可空字段使用 eq + null（自动事件无选项）', () => {
    const valid = { signalField: 'optionId', op: 'eq', value: null };
    expect(ConditionExpressionSchema.safeParse(valid).success).toBe(true);
  });

  it('接受可空字段使用 neq + null（首次任职）', () => {
    const valid = { signalField: 'previousPositionId', op: 'neq', value: null };
    expect(ConditionExpressionSchema.safeParse(valid).success).toBe(true);
  });

  it('拒绝可空字段使用数值比较', () => {
    const invalid = { signalField: 'optionId', op: 'gt', value: 5 };
    expect(ConditionExpressionSchema.safeParse(invalid).success).toBe(false);
  });

  it('拒绝可空字段使用 number 值', () => {
    const invalid = { signalField: 'previousPositionId', op: 'eq', value: 42 };
    expect(ConditionExpressionSchema.safeParse(invalid).success).toBe(false);
  });

  it('拒绝 tier 字段使用 null 值（tier 是普通字符串字段）', () => {
    const invalid = { signalField: 'tier', op: 'eq', value: null };
    expect(ConditionExpressionSchema.safeParse(invalid).success).toBe(false);
  });

  it('接受 tier 字段使用 eq + string', () => {
    const valid = { signalField: 'tier', op: 'eq', value: 'excellent' };
    expect(ConditionExpressionSchema.safeParse(valid).success).toBe(true);
  });

  it('拒绝 careerCheck years_in_position + string value', () => {
    const invalid = { careerCheck: 'years_in_position', value: 'five', op: 'gte' };
    expect(ConditionExpressionSchema.safeParse(invalid).success).toBe(false);
  });

  it('拒绝 careerCheck institution_level + number value', () => {
    const invalid = { careerCheck: 'institution_level', value: 123 };
    expect(ConditionExpressionSchema.safeParse(invalid).success).toBe(false);
  });

  it('拒绝 careerCheck institution_level + 非法枚举值', () => {
    const invalid = { careerCheck: 'institution_level', value: 'galaxy' };
    expect(ConditionExpressionSchema.safeParse(invalid).success).toBe(false);
  });

  it('接受 careerCheck institution_level + 合法枚举值', () => {
    const valid = { careerCheck: 'institution_level', value: 'county' };
    expect(ConditionExpressionSchema.safeParse(valid).success).toBe(true);
  });

  it('拒绝 policyState status_is + number', () => {
    const invalid = { policyState: 'pol_1', check: 'status_is', value: 42 };
    expect(ConditionExpressionSchema.safeParse(invalid).success).toBe(false);
  });

  it('拒绝 policyState status_is + 非法状态字符串', () => {
    const invalid = { policyState: 'pol_1', check: 'status_is', value: 'unknown_status' };
    expect(ConditionExpressionSchema.safeParse(invalid).success).toBe(false);
  });

  it('接受 policyState status_is + 合法状态', () => {
    const valid = { policyState: 'pol_1', check: 'status_is', value: 'implementing' };
    expect(ConditionExpressionSchema.safeParse(valid).success).toBe(true);
  });

  it('拒绝 policyState metric_gte + string', () => {
    const invalid = { policyState: 'pol_1', check: 'metric_gte', value: 'high' };
    expect(ConditionExpressionSchema.safeParse(invalid).success).toBe(false);
  });

  it('拒绝 eventHistory count_gte 缺失 value', () => {
    const invalid = { eventHistory: 'evt_1', check: 'count_gte' };
    expect(ConditionExpressionSchema.safeParse(invalid).success).toBe(false);
  });

  it('接受 eventHistory occurred 无 value', () => {
    const valid = { eventHistory: 'evt_1', check: 'occurred' };
    expect(ConditionExpressionSchema.safeParse(valid).success).toBe(true);
  });

  it('拒绝 eventHistory occurred 携带多余 value', () => {
    const invalid = { eventHistory: 'evt_1', check: 'occurred', value: 5 };
    expect(ConditionExpressionSchema.safeParse(invalid).success).toBe(false);
  });

  it('拒绝 experience region_count + string value', () => {
    const invalid = { experience: 'region_count', op: 'gte', value: 'two' };
    expect(ConditionExpressionSchema.safeParse(invalid).success).toBe(false);
  });

  it('拒绝 experience has_institution + number value', () => {
    const invalid = { experience: 'has_institution', op: 'eq', value: 42 };
    expect(ConditionExpressionSchema.safeParse(invalid).success).toBe(false);
  });

  it('拒绝 fact is_true 携带 value', () => {
    const invalid = { fact: 'is_corrupt', op: 'is_true', value: 999 };
    expect(ConditionExpressionSchema.safeParse(invalid).success).toBe(false);
  });

  it('拒绝 fact eq 缺失 value', () => {
    const invalid = { fact: 'is_corrupt', op: 'eq' };
    expect(ConditionExpressionSchema.safeParse(invalid).success).toBe(false);
  });

  it('拒绝条件对象包含冲突字段（all + fact）', () => {
    const invalid = { all: [], fact: 'x', op: 'is_true' };
    expect(ConditionExpressionSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('EffectDefinition 负向测试', () => {
  it('拒绝 character.vigor + append', () => {
    const invalid = { target: 'character.vigor', operation: 'append', value: 'x', subjectId: 'y' };
    expect(EffectDefinitionSchema.safeParse(invalid).success).toBe(false);
  });

  it('拒绝 world.fact + multiply', () => {
    const invalid = { target: 'world.fact', operation: 'multiply', value: 2 };
    expect(EffectDefinitionSchema.safeParse(invalid).success).toBe(false);
  });

  it('拒绝 world.fact + set 缺失 subjectId', () => {
    const invalid = { target: 'world.fact', operation: 'set', value: true };
    expect(EffectDefinitionSchema.safeParse(invalid).success).toBe(false);
  });

  it('接受 world.fact + set + subjectId', () => {
    const valid = { target: 'world.fact', operation: 'set', value: true, subjectId: 'is_corrupt' };
    expect(EffectDefinitionSchema.safeParse(valid).success).toBe(true);
  });

  it('拒绝具名指标缺失 subjectId', () => {
    const invalid = { target: 'career.specialty', operation: 'add', value: 5 };
    expect(EffectDefinitionSchema.safeParse(invalid).success).toBe(false);
  });

  it('接受具名指标 + subjectId', () => {
    const valid = {
      target: 'career.specialty',
      operation: 'add',
      value: 5,
      subjectId: 'economics',
    };
    expect(EffectDefinitionSchema.safeParse(valid).success).toBe(true);
  });

  it('拒绝 assessment.score + set', () => {
    const invalid = { target: 'assessment.score', operation: 'set', value: 100 };
    expect(EffectDefinitionSchema.safeParse(invalid).success).toBe(false);
  });

  it('接受 assessment.score + add', () => {
    const valid = { target: 'assessment.score', operation: 'add', value: 3 };
    expect(EffectDefinitionSchema.safeParse(valid).success).toBe(true);
  });

  it('拒绝 character.vigor + string value', () => {
    const invalid = { target: 'character.vigor', operation: 'add', value: 'ten' };
    expect(EffectDefinitionSchema.safeParse(invalid).success).toBe(false);
  });

  it('拒绝未知 target', () => {
    const invalid = { target: 'unknown.target', operation: 'add', value: 1 };
    expect(EffectDefinitionSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('DomainSignalSnapshot 负向测试', () => {
  it('拒绝未知信号类型', () => {
    const invalid = { signalType: 'unknown.signal', occurredAtDay: 10, data: {} };
    expect(DomainSignalSnapshotSchema.safeParse(invalid).success).toBe(false);
  });

  it('拒绝 action.completed 缺失 actionInstanceId', () => {
    const invalid = {
      signalType: 'action.completed',
      occurredAtDay: 10,
      data: { actionId: 'a1', deptId: 'd1', regionId: 'r1', institutionId: 'i1' },
    };
    expect(DomainSignalSnapshotSchema.safeParse(invalid).success).toBe(false);
  });

  it('接受完整 action.completed', () => {
    const valid = {
      signalType: 'action.completed',
      occurredAtDay: 10,
      data: {
        actionInstanceId: 'ai1',
        actionId: 'a1',
        deptId: 'd1',
        regionId: 'r1',
        institutionId: 'i1',
      },
    };
    expect(DomainSignalSnapshotSchema.safeParse(valid).success).toBe(true);
  });

  it('拒绝 appointment.changed 缺失 previousPositionId', () => {
    const invalid = {
      signalType: 'appointment.changed',
      occurredAtDay: 10,
      data: { experienceId: 'e1', positionId: 'p1', institutionId: 'i1', regionId: 'r1' },
    };
    expect(DomainSignalSnapshotSchema.safeParse(invalid).success).toBe(false);
  });

  it('接受 appointment.changed 含 null previousPositionId', () => {
    const valid = {
      signalType: 'appointment.changed',
      occurredAtDay: 10,
      data: {
        experienceId: 'e1',
        positionId: 'p1',
        institutionId: 'i1',
        regionId: 'r1',
        previousPositionId: null,
      },
    };
    expect(DomainSignalSnapshotSchema.safeParse(valid).success).toBe(true);
  });

  it('拒绝 event.resolved 缺失 eventInstanceId', () => {
    const invalid = {
      signalType: 'event.resolved',
      occurredAtDay: 10,
      data: { eventId: 'ev1', optionId: 'opt1' },
    };
    expect(DomainSignalSnapshotSchema.safeParse(invalid).success).toBe(false);
  });

  it('接受 event.resolved 含 null optionId（自动事件）', () => {
    const valid = {
      signalType: 'event.resolved',
      occurredAtDay: 10,
      data: { eventInstanceId: 'ei1', eventId: 'ev1', optionId: null },
    };
    expect(DomainSignalSnapshotSchema.safeParse(valid).success).toBe(true);
  });

  it('拒绝信号快照携带未知额外字段', () => {
    const invalid = {
      signalType: 'world.metric_changed',
      occurredAtDay: 10,
      data: { metricId: 'm1', value: 5 },
      extraField: 'should_not_exist',
    };
    expect(DomainSignalSnapshotSchema.safeParse(invalid).success).toBe(false);
  });
});
