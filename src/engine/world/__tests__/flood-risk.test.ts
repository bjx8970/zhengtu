import { describe, it, expect } from 'vitest';
import { computeFloodRiskMonthDelta } from '../flood-risk';

const rainyMonths = [5, 6, 7, 8];
const monthlyRise = 25;
const monthlyFall = 10;

describe('computeFloodRiskMonthDelta', () => {
  it('increases risk during rainy months', () => {
    const result = computeFloodRiskMonthDelta(0, 5, rainyMonths, monthlyRise, monthlyFall);
    expect(result.previous).toBe(0);
    expect(result.next).toBe(25);
  });

  it('decreases risk during non-rainy months', () => {
    const result = computeFloodRiskMonthDelta(30, 1, rainyMonths, monthlyRise, monthlyFall);
    expect(result.next).toBe(20);
  });

  it('clamps at 0 lower bound', () => {
    const result = computeFloodRiskMonthDelta(5, 1, rainyMonths, monthlyRise, monthlyFall);
    expect(result.next).toBe(0);
  });

  it('clamps at 100 upper bound', () => {
    const result = computeFloodRiskMonthDelta(90, 6, rainyMonths, monthlyRise, monthlyFall);
    expect(result.next).toBe(100);
  });

  it('returns previous equal to next when unused input', () => {
    // Already at 0 and non-rainy month with fall=10 -> clamped to 0
    const result = computeFloodRiskMonthDelta(0, 9, rainyMonths, monthlyRise, monthlyFall);
    expect(result.previous).toBe(0);
    expect(result.next).toBe(0);
  });

  it('accumulates correctly over multiple rainy months', () => {
    let value = 0;
    for (const month of [5, 6, 7, 8]) {
      const result = computeFloodRiskMonthDelta(
        value,
        month,
        rainyMonths,
        monthlyRise,
        monthlyFall,
      );
      value = result.next;
    }
    expect(value).toBe(100);
  });

  it('handles edge case: month at boundary (4, non-rainy)', () => {
    const result = computeFloodRiskMonthDelta(20, 4, rainyMonths, monthlyRise, monthlyFall);
    expect(result.metricId).toBe('flood_risk');
    expect(result.next).toBe(10);
  });

  it('handles edge case: month at boundary (9, non-rainy)', () => {
    const result = computeFloodRiskMonthDelta(20, 9, rainyMonths, monthlyRise, monthlyFall);
    expect(result.next).toBe(10);
  });
});
