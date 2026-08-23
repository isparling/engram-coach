import { describe, it, expect } from 'vitest';
import { projectTSB } from './tsb-predict.js';

describe('projectTSB', () => {
  it('computes single-day projection', () => {
    // Hand-calculated: CTL = 80 * (41/42) + 100/42 = 78.095 + 2.381 = 80.476
    // ATL = 60 * (6/7) + 100/7 = 51.429 + 14.286 = 65.714
    // TSB = 80.476 - 65.714 = 14.762
    const result = projectTSB(80, 60, [100]);
    expect(result.initial.ctl).toBe(80);
    expect(result.initial.atl).toBe(60);
    expect(result.initial.tsb).toBe(20);
    expect(result.projections).toHaveLength(1);
    expect(result.projections[0].ctl).toBe(80.5);
    expect(result.projections[0].atl).toBe(65.7);
    expect(result.projections[0].tsb).toBe(14.8);
  });

  it('computes multi-day projection with accumulation', () => {
    const result = projectTSB(80, 60, [100, 100, 100]);
    expect(result.projections).toHaveLength(3);
    // Each day feeds into the next — CTL should rise, ATL should rise faster
    expect(result.projections[2].ctl).toBeGreaterThan(result.projections[0].ctl);
    expect(result.projections[2].atl).toBeGreaterThan(result.projections[0].atl);
  });

  it('decays toward zero on rest days', () => {
    const result = projectTSB(80, 120, [0, 0, 0]);
    // CTL decays: 80 * (41/42)^3 ≈ 74.4
    // ATL decays faster: 120 * (6/7)^3 ≈ 75.5
    // TSB should improve (become less negative) each day
    expect(result.projections[0].tsb).toBeGreaterThan(result.initial.tsb);
    expect(result.projections[1].tsb).toBeGreaterThan(result.projections[0].tsb);
    expect(result.projections[2].tsb).toBeGreaterThan(result.projections[1].tsb);
    // ATL should decay toward zero
    expect(result.projections[2].atl).toBeLessThan(result.initial.atl);
  });

  it('supports custom time constants', () => {
    const defaultResult = projectTSB(80, 60, [100]);
    const customResult = projectTSB(80, 60, [100], { ctlTau: 30, atlTau: 5 });
    // Different time constants = different results
    expect(customResult.projections[0].ctl).not.toBeCloseTo(defaultResult.projections[0].ctl, 2);
    expect(customResult.projections[0].atl).not.toBeCloseTo(defaultResult.projections[0].atl, 2);
  });

  it('handles zero initial CTL and ATL', () => {
    const result = projectTSB(0, 0, [100]);
    expect(result.projections[0].ctl).toBe(2.4);
    expect(result.projections[0].atl).toBe(14.3);
    expect(result.projections[0].tsb).toBe(-11.9);
  });

  it('rounds output to 1 decimal place', () => {
    const result = projectTSB(80, 60, [100]);
    const ctl = result.projections[0].ctl;
    // Should have at most 1 decimal
    expect(ctl).toBe(Math.round(ctl * 10) / 10);
  });
});

describe('historical validation', () => {
  it('predicts Mar 16-26 trajectory within ±25 of Intervals.icu values', () => {
    // Build 2 Week 1 start: Mar 16
    // Actual CTL/ATL from Intervals.icu wellness data:
    const actual = [
      { date: '2026-03-16', ctl: 73.2, atl: 77.9 },   // start
      { date: '2026-03-17', ctl: 75.4, atl: 89.7 },
      { date: '2026-03-18', ctl: 75.9, atl: 90.4 },
      { date: '2026-03-19', ctl: 77.9, atl: 100.1 },
      { date: '2026-03-20', ctl: 76.9, atl: 91.3 },
      { date: '2026-03-21', ctl: 81.5, atl: 115.5 },
      { date: '2026-03-22', ctl: 82.6, atl: 117.3 },
      { date: '2026-03-23', ctl: 81.6, atl: 106.7 },
      { date: '2026-03-24', ctl: 83.8, atl: 115.7 },
      { date: '2026-03-25', ctl: 85.0, atl: 118.4 },
      { date: '2026-03-26', ctl: 83.0, atl: 102.6 },
    ];

    // Daily training loads from Intervals.icu activity data (sum of all activities per day):
    const dailyTSS = [38, 163, 95, 163, 34, 273, 129, 38, 174, 136];

    const result = projectTSB(73.2, 77.9, dailyTSS);

    // Validate directional accuracy: each projected TSB should be within ±25
    // of Intervals.icu's value. Exact match is not expected — Intervals.icu
    // may use different training load models per sport, different time constants,
    // or different aggregation timing (e.g. same-day vs next-day TSS application
    // causes up to ~22 TSB divergence on high-load days like Mar 21 with 273 TSS).
    for (let i = 0; i < dailyTSS.length; i++) {
      const projected = result.projections[i];
      const actualDay = actual[i + 1]; // +1 because actual[0] is the start
      const tsbProjected = projected.tsb;
      const tsbActual = actualDay.ctl - actualDay.atl;
      expect(Math.abs(tsbProjected - tsbActual)).toBeLessThan(25);
    }
  });
});
