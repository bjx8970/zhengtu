import { describe, it, expect } from 'vitest';
import { createInitialState } from '../game-store';

describe('createInitialState', () => {
  it('creates valid default state', () => {
    const state = createInitialState();
    expect(state.currentLevel).toBe(1);
    expect(state.currentCareerLine).toBe('admin');
    expect(state.slots.available).toBe(3);
    expect(state.slots.max).toBe(3);
    expect(state.time.year).toBe(2024);
    expect(state.time.month).toBe(1);
    expect(state.time.day).toBe(1);
    expect(state.time.granularity).toBe('day');
  });

  it('merges overrides', () => {
    const state = createInitialState({
      characterName: '测试角色',
      currentLevel: 3,
    });
    expect(state.characterName).toBe('测试角色');
    expect(state.currentLevel).toBe(3);
    expect(state.slots.available).toBe(3);
  });

  it('initializes faction reputation to zero', () => {
    const state = createInitialState();
    expect(state.factions.alignment).toBe('independent');
    expect(state.factions.reputation.reform).toBe(0);
    expect(state.factions.reputation.pragmatic).toBe(0);
    expect(state.factions.reputation.conservative).toBe(0);
  });

  it('initializes empty relations', () => {
    const state = createInitialState();
    expect(Object.keys(state.relations.classmates)).toHaveLength(0);
    expect(Object.keys(state.relations.colleagues)).toHaveLength(0);
  });
});
