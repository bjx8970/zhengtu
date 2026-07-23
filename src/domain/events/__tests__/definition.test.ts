/**
 * 事件定义与配置验证测试
 *
 * 覆盖：
 * - EventDefinitionSchema 约束（概率/权重/延迟/互斥/严格字段）
 * - validateEventDefinitions 引用完整性与循环检测
 */
import { describe, it, expect } from 'vitest';
import { EventDefinitionSchema } from '../definition';
import type { EventDefinition } from '../definition';
import { validateEventDefinitions } from '../validation';
import {
  DOMAIN_SIGNALS,
  DomainSignalSnapshotSchema,
  SIGNAL_TYPE_PAYLOAD_FIELDS,
} from '../../governance/types';

/** 构造一个合法的事件定义 */
function makeEvent(override?: Partial<EventDefinition>): EventDefinition {
  return {
    id: 'test_event',
    chainId: null,
    nodeId: null,
    title: '测试事件',
    description: '描述',
    category: 'emergency',
    priority: 'normal',
    presentation: 'blocking',
    trigger: { sources: ['world.metric_changed'] },
    repeatPolicy: { mode: 'repeatable' },
    activation: {},
    options: [{ id: 'opt_1', label: '选项一', description: '', effects: [] }],
    ...override,
  };
}

describe('EventDefinitionSchema 约束', () => {
  it('合法定义可解析', () => {
    expect(EventDefinitionSchema.safeParse(makeEvent()).success).toBe(true);
  });

  it('未知字段被拒绝（.strict）', () => {
    const invalid = { ...makeEvent(), unknownField: 'x' };
    expect(EventDefinitionSchema.safeParse(invalid).success).toBe(false);
  });

  it('sources 为空被拒绝', () => {
    const invalid = makeEvent({ trigger: { sources: [] } });
    expect(EventDefinitionSchema.safeParse(invalid).success).toBe(false);
  });

  it('非法概率被拒绝（> 1）', () => {
    const invalid = makeEvent({ trigger: { sources: ['world.metric_changed'], probability: 1.5 } });
    expect(EventDefinitionSchema.safeParse(invalid).success).toBe(false);
  });

  it('非法权重被拒绝（<= 0）', () => {
    const invalid = makeEvent({ trigger: { sources: ['world.metric_changed'], weight: 0 } });
    expect(EventDefinitionSchema.safeParse(invalid).success).toBe(false);
  });

  it('非法延迟被拒绝（负数）', () => {
    const invalid = makeEvent({ activation: { delayDays: -1 } });
    expect(EventDefinitionSchema.safeParse(invalid).success).toBe(false);
  });

  it('delayDays 与 delayRange 同时存在被拒绝', () => {
    const invalid = makeEvent({ activation: { delayDays: 3, delayRange: { min: 1, max: 5 } } });
    expect(EventDefinitionSchema.safeParse(invalid).success).toBe(false);
  });

  it('delayRange.min > max 被拒绝', () => {
    const invalid = makeEvent({ activation: { delayRange: { min: 5, max: 1 } } });
    expect(EventDefinitionSchema.safeParse(invalid).success).toBe(false);
  });

  it('deadlineDays 非正被拒绝', () => {
    const invalid = makeEvent({ activation: { deadlineDays: 0 } });
    expect(EventDefinitionSchema.safeParse(invalid).success).toBe(false);
  });
});

describe('validateEventDefinitions 引用完整性', () => {
  it('合法配置通过', () => {
    expect(validateEventDefinitions([makeEvent()])).toEqual([]);
  });

  it('重复事件 ID 被拒绝', () => {
    const events = [makeEvent(), makeEvent()];
    const errors = validateEventDefinitions(events);
    expect(errors.some((e) => e.includes('重复的事件 ID'))).toBe(true);
  });

  it('重复选项 ID 被拒绝', () => {
    const event = makeEvent({
      options: [
        { id: 'dup', label: 'a', description: '', effects: [] },
        { id: 'dup', label: 'b', description: '', effects: [] },
      ],
    });
    const errors = validateEventDefinitions([event]);
    expect(errors.some((e) => e.includes('重复的选项 ID'))).toBe(true);
  });

  it('automatic 事件带玩家选项被拒绝', () => {
    const event = makeEvent({ presentation: 'automatic' });
    const errors = validateEventDefinitions([event]);
    expect(errors.some((e) => e.includes('automatic'))).toBe(true);
  });

  it('blocking 事件无选项被拒绝', () => {
    const event = makeEvent({ presentation: 'blocking', options: [] });
    const errors = validateEventDefinitions([event]);
    expect(errors.some((e) => e.includes('至少需要一个选项'))).toBe(true);
  });

  it('不存在的后续事件引用被拒绝', () => {
    const event = makeEvent({
      options: [
        {
          id: 'opt_1',
          label: 'a',
          description: '',
          effects: [],
          schedule: [{ eventId: 'ghost', delayDays: 5 }],
        },
      ],
    });
    const errors = validateEventDefinitions([event]);
    expect(errors.some((e) => e.includes('ghost'))).toBe(true);
  });

  it('once_per_chain 无 chainId 被拒绝', () => {
    const event = makeEvent({ repeatPolicy: { mode: 'once_per_chain' }, chainId: null });
    const errors = validateEventDefinitions([event]);
    expect(errors.some((e) => e.includes('once_per_chain'))).toBe(true);
  });

  it('即时循环被拒绝（A → A）', () => {
    const event = makeEvent({
      id: 'A',
      options: [
        {
          id: 'opt_1',
          label: 'a',
          description: '',
          effects: [],
          schedule: [{ eventId: 'A', delayDays: 0 }],
        },
      ],
    });
    const errors = validateEventDefinitions([event]);
    expect(errors.some((e) => e.includes('循环'))).toBe(true);
  });

  it('间接即时循环被拒绝（A → B → A）', () => {
    const a = makeEvent({
      id: 'A',
      options: [
        {
          id: 'o',
          label: 'a',
          description: '',
          effects: [],
          schedule: [{ eventId: 'B', delayDays: 0 }],
        },
      ],
    });
    const b = makeEvent({
      id: 'B',
      options: [
        {
          id: 'o',
          label: 'b',
          description: '',
          effects: [],
          schedule: [{ eventId: 'A', delayDays: 0 }],
        },
      ],
    });
    const errors = validateEventDefinitions([a, b]);
    expect(errors.some((e) => e.includes('循环'))).toBe(true);
  });

  it('有正延迟的循环不视为即时循环', () => {
    const a = makeEvent({
      id: 'A',
      options: [
        {
          id: 'o',
          label: 'a',
          description: '',
          effects: [],
          schedule: [{ eventId: 'B', delayDays: 5 }],
        },
      ],
    });
    const b = makeEvent({
      id: 'B',
      options: [
        {
          id: 'o',
          label: 'b',
          description: '',
          effects: [],
          schedule: [{ eventId: 'A', delayDays: 5 }],
        },
      ],
    });
    const errors = validateEventDefinitions([a, b]);
    expect(errors.some((e) => e.includes('循环'))).toBe(false);
  });

  it('automatic 事件缺失 automaticOutcome 被拒绝', () => {
    const event = makeEvent({ presentation: 'automatic', options: [] });
    const errors = validateEventDefinitions([event]);
    expect(errors.some((e) => e.includes('automaticOutcome'))).toBe(true);
  });

  it('automatic 事件携带 automaticOutcome 通过', () => {
    const event = makeEvent({
      presentation: 'automatic',
      options: [],
      automaticOutcome: {
        effects: [{ target: 'character', field: 'vigor', operation: 'add', value: 5 }],
      },
    });
    const errors = validateEventDefinitions([event]);
    expect(errors).toEqual([]);
  });

  it('blocking 事件携带 automaticOutcome 被拒绝', () => {
    const event = makeEvent({
      presentation: 'blocking',
      automaticOutcome: { effects: [] },
    });
    const errors = validateEventDefinitions([event]);
    expect(errors.some((e) => e.includes('不得有 automaticOutcome'))).toBe(true);
  });

  it('trigger.sources 与条件 signal 字段不兼容被拒绝', () => {
    // world.metric_changed 载荷无 institutionId，条件却读取 institutionId
    const event = makeEvent({
      trigger: {
        sources: ['world.metric_changed'],
        condition: { signalField: 'institutionId', op: 'eq', value: 'x' },
      },
    });
    const errors = validateEventDefinitions([event]);
    expect(errors.some((e) => e.includes('institutionId') && e.includes('不可达'))).toBe(true);
  });

  it('trigger.sources 与条件 signal 字段兼容通过', () => {
    // appointment.changed 载荷含 institutionId
    const event = makeEvent({
      trigger: {
        sources: ['appointment.changed'],
        condition: { signalField: 'institutionId', op: 'eq', value: 'x' },
      },
    });
    const errors = validateEventDefinitions([event]);
    expect(errors.some((e) => e.includes('不可达'))).toBe(false);
  });

  it('效果 signal 来源引用不兼容字段被拒绝', () => {
    // world.metric_changed 无 institutionId，机构指标 signal 引用不可达
    const event = makeEvent({
      trigger: { sources: ['world.metric_changed'] },
      options: [
        {
          id: 'o',
          label: 'a',
          description: '',
          effects: [
            {
              target: 'institution_metric',
              institutionRef: { source: 'signal', field: 'institutionId' },
              metricId: 'm',
              operation: 'add',
              value: 1,
            },
          ],
        },
      ],
    });
    const errors = validateEventDefinitions([event]);
    expect(errors.some((e) => e.includes('institutionId') && e.includes('所有触发来源'))).toBe(
      true,
    );
  });

  it('fixed 机构引用未知 ID 被拒绝', () => {
    const event = makeEvent({
      options: [
        {
          id: 'o',
          label: 'a',
          description: '',
          effects: [
            {
              target: 'institution_metric',
              institutionRef: { source: 'fixed', institutionId: 'ghost_inst' },
              metricId: 'm',
              operation: 'add',
              value: 1,
            },
          ],
        },
      ],
    });
    const knownIds = {
      institutionIds: new Set(['real_inst']),
      regionIds: new Set(['real_region']),
    };
    const errors = validateEventDefinitions([event], knownIds);
    expect(errors.some((e) => e.includes('ghost_inst'))).toBe(true);
  });

  it('fixed 机构引用已知 ID 通过', () => {
    const event = makeEvent({
      options: [
        {
          id: 'o',
          label: 'a',
          description: '',
          effects: [
            {
              target: 'institution_metric',
              institutionRef: { source: 'fixed', institutionId: 'real_inst' },
              metricId: 'm',
              operation: 'add',
              value: 1,
            },
          ],
        },
      ],
    });
    const knownIds = {
      institutionIds: new Set(['real_inst']),
      regionIds: new Set(['real_region']),
    };
    const errors = validateEventDefinitions([event], knownIds);
    expect(errors.some((e) => e.includes('real_inst'))).toBe(false);
  });

  it('多来源效果 signal 引用字段不在所有来源被拒绝', () => {
    // world.metric_changed 无 regionId，appointment.changed 有；效果 regionRef signal 在部分来源结算会失败
    const event = makeEvent({
      trigger: { sources: ['world.metric_changed', 'appointment.changed'] },
      options: [
        {
          id: 'o',
          label: 'a',
          description: '',
          effects: [
            {
              target: 'region_metric',
              regionRef: { source: 'signal', field: 'regionId' },
              metricId: 'm',
              operation: 'add',
              value: 1,
            },
          ],
        },
      ],
    });
    const errors = validateEventDefinitions([event]);
    expect(errors.some((e) => e.includes('regionId') && e.includes('所有触发来源'))).toBe(true);
  });

  it('多来源效果 signal 引用字段在所有来源存在通过', () => {
    // action.completed 与 appointment.changed 都含 regionId
    const event = makeEvent({
      trigger: { sources: ['action.completed', 'appointment.changed'] },
      options: [
        {
          id: 'o',
          label: 'a',
          description: '',
          effects: [
            {
              target: 'region_metric',
              regionRef: { source: 'signal', field: 'regionId' },
              metricId: 'm',
              operation: 'add',
              value: 1,
            },
          ],
        },
      ],
    });
    const errors = validateEventDefinitions([event]);
    expect(errors.some((e) => e.includes('所有触发来源'))).toBe(false);
  });

  it('后续调度条件引用不兼容信号字段被拒绝', () => {
    // world.metric_changed 无 institutionId，后续条件却读取 institutionId
    const event = makeEvent({
      trigger: { sources: ['world.metric_changed'] },
      options: [
        {
          id: 'o',
          label: 'a',
          description: '',
          effects: [],
          schedule: [
            {
              eventId: 'followup_event',
              delayDays: 5,
              condition: { signalField: 'institutionId', op: 'eq', value: 'x' },
            },
          ],
        },
      ],
    });
    const followup = makeEvent({ id: 'followup_event' });
    const errors = validateEventDefinitions([event, followup]);
    expect(errors.some((e) => e.includes('institutionId') && e.includes('不可达'))).toBe(true);
  });

  it('all 引用分属不同来源的字段被拒绝（永久不可达）', () => {
    // actionId 仅在 action.completed，score 仅在 assessment.completed，无来源同时含有两者
    const event = makeEvent({
      trigger: {
        sources: ['action.completed', 'assessment.completed'],
        condition: {
          all: [
            { signalField: 'actionId', op: 'eq', value: 'x' },
            { signalField: 'score', op: 'gte', value: 80 },
          ],
        },
      },
    });
    const errors = validateEventDefinitions([event]);
    expect(errors.some((e) => e.includes('all') && e.includes('不可达'))).toBe(true);
  });

  it('all 引用共存于同一来源的字段通过', () => {
    // actionId 和 deptId 都在 action.completed
    const event = makeEvent({
      trigger: {
        sources: ['action.completed', 'assessment.completed'],
        condition: {
          all: [
            { signalField: 'actionId', op: 'eq', value: 'x' },
            { signalField: 'deptId', op: 'eq', value: 'y' },
          ],
        },
      },
    });
    const errors = validateEventDefinitions([event]);
    expect(errors.some((e) => e.includes('all') && e.includes('不可达'))).toBe(false);
  });

  it('not(signalField) 在部分来源缺失字段被拒绝（避免 not(false) 错误触发）', () => {
    // institutionId 仅在 appointment.changed，world.metric_changed 缺失
    // not(institutionId eq x) 在 world.metric_changed 触发时会因 not(false)=true 错误触发
    const event = makeEvent({
      trigger: {
        sources: ['world.metric_changed', 'appointment.changed'],
        condition: {
          not: { signalField: 'institutionId', op: 'eq', value: 'x' },
        },
      },
    });
    const errors = validateEventDefinitions([event]);
    expect(errors.some((e) => e.includes('not') && e.includes('institutionId'))).toBe(true);
  });

  it('not(signalField) 在所有来源都有字段通过', () => {
    // regionId 在 action.completed 和 appointment.changed 都存在
    const event = makeEvent({
      trigger: {
        sources: ['action.completed', 'appointment.changed'],
        condition: {
          not: { signalField: 'regionId', op: 'eq', value: 'x' },
        },
      },
    });
    const errors = validateEventDefinitions([event]);
    expect(errors.some((e) => e.includes('not') && e.includes('regionId'))).toBe(false);
  });
});

describe('SIGNAL_TYPE_PAYLOAD_FIELDS 一致性', () => {
  it('信号字段映射覆盖所有领域信号且与 Schema 一致', () => {
    // 映射的键须与 DOMAIN_SIGNALS 完全一致
    const mappedSignals = Object.keys(SIGNAL_TYPE_PAYLOAD_FIELDS).sort();
    const domainSignals = [...DOMAIN_SIGNALS].sort();
    expect(mappedSignals).toEqual(domainSignals);

    // 每个信号类型的字段须与 DomainSignalSnapshotSchema 的 data 形状一致
    for (const signalType of DOMAIN_SIGNALS) {
      const branch = DomainSignalSnapshotSchema.options.find(
        (o) => o.shape.signalType.value === signalType,
      );
      expect(branch, `signal ${signalType} branch`).toBeDefined();
      const schemaFields = Object.keys(branch!.shape.data.shape).sort();
      const mappedFields = [...SIGNAL_TYPE_PAYLOAD_FIELDS[signalType]].sort();
      expect(mappedFields, `signal ${signalType} fields`).toEqual(schemaFields);
    }
  });
});
