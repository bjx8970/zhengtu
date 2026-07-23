/**
 * ConfigLoader 事件加载测试
 *
 * 覆盖：全量加载、按 ID 查询、按信号查询、未知 ID、返回数据不污染全局配置。
 */
import { describe, it, expect } from 'vitest';
import { getConfigLoader } from '../loader';

describe('ConfigLoader 事件加载', () => {
  const loader = getConfigLoader();

  it('全量事件加载', () => {
    const events = loader.getAllEventDefinitions();
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.id === 'flood_emergency')).toBe(true);
  });

  it('按 ID 查询事件', () => {
    const event = loader.getEventDefinition('flood_emergency');
    expect(event).not.toBeNull();
    expect(event?.title).toBe('防汛抗洪');
    expect(event?.options.length).toBe(3);
  });

  it('未知 ID 返回 null', () => {
    expect(loader.getEventDefinition('nonexistent_event')).toBeNull();
  });

  it('按信号查询事件', () => {
    const events = loader.getEventDefinitionsBySignal('world.metric_changed');
    expect(events.some((e) => e.id === 'flood_emergency')).toBe(true);
  });

  it('无事件匹配的信号返回空数组', () => {
    const events = loader.getEventDefinitionsBySignal('policy.approved');
    expect(Array.isArray(events)).toBe(true);
  });

  it('返回数据不污染全局配置（修改返回值不影响后续查询）', () => {
    const event1 = loader.getEventDefinition('flood_emergency');
    expect(event1).not.toBeNull();
    // 修改返回值的标题
    event1!.title = '被篡改的标题';
    event1!.options.push({ id: 'injected', label: 'x', description: '', effects: [] });

    // 再次查询应得到原始数据
    const event2 = loader.getEventDefinition('flood_emergency');
    expect(event2?.title).toBe('防汛抗洪');
    expect(event2?.options.length).toBe(3);
  });

  it('按信号查询的返回值同样隔离', () => {
    const events1 = loader.getEventDefinitionsBySignal('world.metric_changed');
    const flood1 = events1.find((e) => e.id === 'flood_emergency');
    flood1!.title = '篡改';

    const events2 = loader.getEventDefinitionsBySignal('world.metric_changed');
    const flood2 = events2.find((e) => e.id === 'flood_emergency');
    expect(flood2?.title).toBe('防汛抗洪');
  });
});
