import { describe, it, expect } from 'vitest';
import { computeCorruptionReport } from '../corruption-report';

describe('computeCorruptionReport', () => {
  it('returns low index for high integrity, low corruption risk, high stability', () => {
    const result = computeCorruptionReport({
      integrity: 90,
      corruptionRisk: 0,
      stability: 90,
    });
    expect(result).toBeLessThanOrEqual(15);
  });

  it('returns high index for low integrity, high corruption risk, low stability', () => {
    const result = computeCorruptionReport({
      integrity: 10,
      corruptionRisk: 80,
      stability: 10,
    });
    expect(result).toBeGreaterThanOrEqual(80);
  });

  it('handles moderate scenario', () => {
    const result = computeCorruptionReport({
      integrity: 50,
      corruptionRisk: 30,
      stability: 50,
    });
    // (100-50)*0.5 + 30*0.3 + (100-50)*0.2 = 25 + 9 + 10 = 44
    expect(result).toBe(44);
  });

  it('clamps at 0 lower bound', () => {
    const result = computeCorruptionReport({
      integrity: 100,
      corruptionRisk: 0,
      stability: 100,
    });
    expect(result).toBe(0);
  });

  it('clamps at 100 upper bound', () => {
    const result = computeCorruptionReport({
      integrity: 0,
      corruptionRisk: 100,
      stability: 0,
    });
    expect(result).toBe(100);
  });

  it('returns integer value', () => {
    const result = computeCorruptionReport({
      integrity: 47,
      corruptionRisk: 33,
      stability: 52,
    });
    expect(Number.isInteger(result)).toBe(true);
  });
});
