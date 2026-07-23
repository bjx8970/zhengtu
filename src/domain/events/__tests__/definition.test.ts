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
    expect(errors.some((e) => e.includes('institutionId') && e.includes('不可达'))).toBe(true);
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
});
