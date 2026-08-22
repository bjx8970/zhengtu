/** 个人任务模板 Schema 约束测试：并行语义与配置契约。 */

import { describe, expect, it } from 'vitest';
import { PersonalTaskTemplateArraySchema } from '../schemas';
import type { PersonalTaskTemplate } from '../../types/config';

function makeTask(overrides?: Partial<PersonalTaskTemplate>): PersonalTaskTemplate {
  return {
    id: 'task_schema_test',
    name: '测试任务',
    type: 'training',
    durationDays: 5,
    category: 'routine',
    cooldownDays: 0,
    budgetDelta: 5,
    effects: [],
    repeatPolicy: 'repeatable',
    ...overrides,
  };
}

describe('PersonalTaskTemplateArraySchema', () => {
  it('接受合法任务（含可选 allowParallel）', () => {
    const result = PersonalTaskTemplateArraySchema.safeParse([
      makeTask(),
      makeTask({ id: 'task_parallel', category: 'minor', cooldownDays: 7, allowParallel: true }),
    ]);
    expect(result.success).toBe(true);
  });

  it('once 任务配置 allowParallel=true 被拒绝（契约优先）', () => {
    const result = PersonalTaskTemplateArraySchema.safeParse([
      makeTask({ repeatPolicy: 'once', allowParallel: true }),
    ]);
    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0]?.message).toContain(
      'once 任务不允许并行',
    );
  });

  it('拒绝负数预算成本，避免以任务伪造无限预算 producer', () => {
    expect(PersonalTaskTemplateArraySchema.safeParse([makeTask({ budgetDelta: -1 })]).success).toBe(
      false,
    );
  });
});
