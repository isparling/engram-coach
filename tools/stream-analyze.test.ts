import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { resolve } from 'path';
import {
  computeDecoupling,
  computeHrRecovery,
  computeIntervalCv,
  computeFade,
  resolveFadeSegments,
  computeTimeInZone,
  DEFAULT_ZONE_THRESHOLDS,
  computeNpDistribution,
  computeLapTrends,
  computeSimCompare,
  classifyRestLaps,
  filterStreamsByRestLaps,
} from './stream-analyze.js';
import type { IntervalBoundary, LapBoundary, ActivitySummaryForCompare } from './stream-analyze.js';

// --- computeDecoupling ---

describe('computeDecoupling', () => {
  it('computes positive decoupling when HR drifts up', () => {
    // 3000 samples (50 min): constant 200W, HR rises from 140 to 160
    const watts: number[] = Array(3000).fill(200);
    const hr: number[] = Array.from({ length: 3000 }, (_, i) => 140 + (20 * i) / 2999);
    const result = computeDecoupling(watts, hr);
    expect(result.decoupling_pct).toBeGreaterThan(0);
    expect(result.half1.avg_watts).toBe(200);
    expect(result.half2.avg_watts).toBe(200);
    expect(result.half1.avg_hr).toBeLessThan(result.half2.avg_hr);
    // EF should be higher in first half (lower HR at same power)
    expect(result.half1.ef).toBeGreaterThan(result.half2.ef);
  });

  it('returns ~0% decoupling when HR is constant', () => {
    const watts: number[] = Array(3000).fill(200);
    const hr: number[] = Array(3000).fill(145);
    const result = computeDecoupling(watts, hr);
    expect(result.decoupling_pct).toBeCloseTo(0, 1);
  });

  it('returns negative decoupling when HR drops', () => {
    const watts: number[] = Array(3000).fill(200);
    const hr: number[] = Array.from({ length: 3000 }, (_, i) => 160 - (20 * i) / 2999);
    const result = computeDecoupling(watts, hr);
    expect(result.decoupling_pct).toBeLessThan(0);
  });

  it('throws on session shorter than 45 min', () => {
    const watts: number[] = Array(2000).fill(200);
    const hr: number[] = Array(2000).fill(145);
    expect(() => computeDecoupling(watts, hr)).toThrow(/too short/i);
  });

  it('strips null values before computing', () => {
    // 3000 non-null samples with some nulls sprinkled in
    const watts: (number | null)[] = Array(3200).fill(200);
    const hr: (number | null)[] = Array(3200).fill(145);
    // Add 200 nulls — after stripping, 3000 remain
    for (let i = 0; i < 200; i++) {
      watts[i * 16] = null;
    }
    const result = computeDecoupling(watts, hr);
    expect(result.decoupling_pct).toBeCloseTo(0, 1);
  });
});

// --- computeHrRecovery ---

describe('computeHrRecovery', () => {
  function makeHr(length: number, base: number): (number | null)[] {
    return Array(length).fill(base);
  }

  const twoIntervals: IntervalBoundary[] = [
    { index: 1, type: 'WORK', startIndex: 100, endIndex: 700 },
    { index: 2, type: 'WORK', startIndex: 800, endIndex: 1400 },
  ];

  it('computes HR drops at 60s and 120s', () => {
    // HR at 170 during work, drops to 145 at 60s and 130 at 120s
    const hr: (number | null)[] = Array(2000).fill(130);
    // Set interval end HR
    hr[700] = 170;
    hr[760] = 145; // 60s after interval 1
    hr[820] = 130; // 120s after interval 1
    hr[1400] = 175;
    hr[1460] = 150; // 60s after interval 2
    hr[1520] = 135; // 120s after interval 2

    const result = computeHrRecovery(hr, twoIntervals);
    expect(result.intervals).toHaveLength(2);
    expect(result.intervals[0].end_hr).toBe(170);
    expect(result.intervals[0].drop_60s).toBe(25);
    expect(result.intervals[0].drop_120s).toBe(40);
    expect(result.intervals[1].end_hr).toBe(175);
    expect(result.intervals[1].drop_60s).toBe(25);
    expect(result.intervals[1].drop_120s).toBe(40);
  });

  it('classifies trend as declining when recovery worsens', () => {
    const hr: (number | null)[] = Array(2000).fill(130);
    hr[700] = 170;
    hr[760] = 140; // drop_60s = 30 (good)
    hr[820] = 130;
    hr[1400] = 175;
    hr[1460] = 155; // drop_60s = 20 (worse) — diff = 20-30 = -10 < -3
    hr[1520] = 145;

    const result = computeHrRecovery(hr, twoIntervals);
    expect(result.trend).toBe('declining');
  });

  it('classifies trend as improving when recovery gets better', () => {
    const hr: (number | null)[] = Array(2000).fill(130);
    hr[700] = 170;
    hr[760] = 155; // drop_60s = 15
    hr[820] = 140;
    hr[1400] = 175;
    hr[1460] = 150; // drop_60s = 25 — diff = 25-15 = 10 > 3
    hr[1520] = 135;

    const result = computeHrRecovery(hr, twoIntervals);
    expect(result.trend).toBe('improving');
  });

  it('returns null for drop_120s when data is too short', () => {
    const hr: (number | null)[] = Array(780).fill(130);
    hr[700] = 170;
    hr[760] = 145;
    // No data at 820 (array too short)

    const intervals: IntervalBoundary[] = [
      { index: 1, type: 'WORK', startIndex: 100, endIndex: 700 },
    ];
    const result = computeHrRecovery(hr, intervals);
    expect(result.intervals[0].drop_60s).toBe(25);
    expect(result.intervals[0].drop_120s).toBeNull();
  });

  it('returns stable trend for single interval', () => {
    const hr: (number | null)[] = Array(1000).fill(130);
    hr[700] = 170;
    hr[760] = 145;
    hr[820] = 130;

    const intervals: IntervalBoundary[] = [
      { index: 1, type: 'WORK', startIndex: 100, endIndex: 700 },
    ];
    const result = computeHrRecovery(hr, intervals);
    expect(result.trend).toBe('stable');
  });

  it('throws when no intervals provided', () => {
    expect(() => computeHrRecovery(Array(1000).fill(130), [])).toThrow(/no work intervals/i);
  });
});

// --- computeIntervalCv ---

describe('computeIntervalCv', () => {
  const intervals: IntervalBoundary[] = [
    { index: 1, type: 'WORK', startIndex: 0, endIndex: 99 },
    { index: 2, type: 'WORK', startIndex: 150, endIndex: 249 },
  ];

  it('returns 0% CV for constant power', () => {
    const watts: (number | null)[] = Array(300).fill(250);
    const result = computeIntervalCv(watts, intervals);
    expect(result.intervals).toHaveLength(2);
    expect(result.intervals[0].cv_pct).toBe(0);
    expect(result.intervals[0].avg_watts).toBe(250);
  });

  it('computes correct CV for known distribution', () => {
    // Alternating 200/300 => mean=250, stddev=50, CV=20%
    const watts: (number | null)[] = Array(300).fill(250);
    for (let i = 0; i < 100; i++) {
      watts[i] = i % 2 === 0 ? 200 : 300;
    }
    const result = computeIntervalCv(watts, intervals);
    expect(result.intervals[0].cv_pct).toBeCloseTo(20, 0);
    expect(result.intervals[0].avg_watts).toBe(250);
  });

  it('skips null values within intervals', () => {
    const watts: (number | null)[] = Array(300).fill(250);
    watts[10] = null;
    watts[20] = null;
    const result = computeIntervalCv(watts, intervals);
    // Should still compute, just with fewer samples
    expect(result.intervals[0].cv_pct).toBe(0);
    expect(result.intervals[0].avg_watts).toBe(250);
  });

  it('throws when no intervals provided', () => {
    expect(() => computeIntervalCv(Array(300).fill(250), [])).toThrow(/no work intervals/i);
  });
});

// --- computeFade ---

describe('resolveFadeSegments', () => {
  it('returns hourly boundaries for >6h duration with default mode', () => {
    const segments = resolveFadeSegments(8 * 3600, 'default');
    expect(segments.length).toBe(8);
    expect(segments[0]).toEqual({ start: 0, end: 3600, label: '0:00–1:00' });
    expect(segments[7]).toEqual({ start: 7 * 3600, end: 8 * 3600, label: '7:00–8:00' });
  });

  it('returns quartiles for <=6h duration with default mode', () => {
    const segments = resolveFadeSegments(4 * 3600, 'default');
    expect(segments.length).toBe(4);
    expect(segments[0].start).toBe(0);
    expect(segments[3].end).toBe(4 * 3600);
  });

  it('returns N equal segments when given a number', () => {
    const segments = resolveFadeSegments(7200, 4);
    expect(segments.length).toBe(4);
    expect(segments[0]).toEqual({ start: 0, end: 1800, label: '0:00–0:30' });
    expect(segments[3]).toEqual({ start: 5400, end: 7200, label: '1:30–2:00' });
  });

  it('returns custom boundaries when given an array', () => {
    const segments = resolveFadeSegments(43200, [0, 14400, 28800, 43200]);
    expect(segments.length).toBe(3);
    expect(segments[0]).toEqual({ start: 0, end: 14400, label: '0:00–4:00' });
    expect(segments[2]).toEqual({ start: 28800, end: 43200, label: '8:00–12:00' });
  });
});

describe('computeFade', () => {
  it('computes per-segment NP, avg HR, EF and slopes', () => {
    const watts: number[] = [
      ...Array(3600).fill(250),
      ...Array(3600).fill(230),
      ...Array(3600).fill(210),
    ];
    const hr: number[] = [
      ...Array(3600).fill(150),
      ...Array(3600).fill(155),
      ...Array(3600).fill(160),
    ];
    const result = computeFade(watts, hr, 3);
    expect(result.segments.length).toBe(3);
    expect(result.segments[0].avg_hr).toBe(150);
    expect(result.segments[2].avg_hr).toBe(160);
    expect(result.segments[0].np).toBeGreaterThan(result.segments[2].np);
    expect(result.np_slope_w_per_hr).toBeLessThan(0);
    expect(result.ef_slope_per_hr).toBeLessThan(0);
    expect(result.largest_drop).not.toBeNull();
    expect(result.largest_drop!.np_delta_pct).toBeLessThan(0);
  });

  it('throws when duration is too short for requested segmentation', () => {
    const watts: number[] = Array(60).fill(200);
    const hr: number[] = Array(60).fill(140);
    expect(() => computeFade(watts, hr, 4)).toThrow(/too short/i);
  });

  it('returns null largest_drop when power is monotone non-decreasing', () => {
    const watts: number[] = [
      ...Array(3600).fill(220),
      ...Array(3600).fill(230),
      ...Array(3600).fill(240),
    ];
    const hr: number[] = Array(10800).fill(150);
    const result = computeFade(watts, hr, 3);
    expect(result.largest_drop).toBeNull();
    expect(result.np_slope_w_per_hr).toBeGreaterThan(0);
  });

  it('handles null values via stripNulls', () => {
    const watts: (number | null)[] = [
      ...Array(3600).fill(250),
      ...Array(3600).fill(250),
    ];
    const hr: (number | null)[] = [
      ...Array(3600).fill(150),
      ...Array(3600).fill(150),
    ];
    watts[100] = null;
    hr[200] = null;
    const result = computeFade(watts, hr, 2);
    expect(result.segments.length).toBe(2);
    expect(result.np_slope_w_per_hr).toBeCloseTo(0, 0);
  });
});

// --- computeTimeInZone ---

describe('computeTimeInZone', () => {
  it('puts all time in Z2 when power is steady at 65% FTP', () => {
    const ftp = 250;
    const watts: number[] = Array(3600).fill(0.65 * ftp);
    const result = computeTimeInZone(watts, ftp);
    const z2 = result.zones.find((z) => z.zone === 'Z2');
    expect(z2?.pct).toBeCloseTo(100, 0);
    expect(z2?.seconds).toBe(3600);
  });

  it('distributes across zones for varied power', () => {
    const ftp = 250;
    const watts: number[] = [
      ...Array(1200).fill(100), // Z1 (40%)
      ...Array(1200).fill(180), // Z2 (72%)
      ...Array(1200).fill(280), // Z5 (112%)
    ];
    const result = computeTimeInZone(watts, ftp);
    const z1 = result.zones.find((z) => z.zone === 'Z1')!;
    const z2 = result.zones.find((z) => z.zone === 'Z2')!;
    const z5 = result.zones.find((z) => z.zone === 'Z5')!;
    expect(z1.seconds).toBe(1200);
    expect(z2.seconds).toBe(1200);
    expect(z5.seconds).toBe(1200);
  });

  it('throws when FTP is zero or missing', () => {
    const watts: number[] = Array(60).fill(150);
    expect(() => computeTimeInZone(watts, 0)).toThrow(/ftp/i);
  });

  it('accepts custom zone thresholds', () => {
    const ftp = 250;
    const watts: number[] = Array(3600).fill(0.55 * ftp);
    const customZones = [
      { zone: 'Z1', max_pct_ftp: 0.6 },
      { zone: 'Z2', max_pct_ftp: 0.85 },
      { zone: 'Z3', max_pct_ftp: 1.5 },
    ];
    const result = computeTimeInZone(watts, ftp, customZones);
    expect(result.zones.find((z) => z.zone === 'Z1')!.pct).toBeCloseTo(100, 0);
  });
});

// --- CLI argument validation ---

describe('CLI', () => {
  const script = resolve(import.meta.dirname, 'stream-analyze.ts');

  it('exits with error on missing required args', () => {
    expect(() =>
      execSync(`npx tsx ${script} --activity-id foo`, {
        encoding: 'utf-8',
        cwd: resolve(import.meta.dirname),
        stdio: 'pipe',
      }),
    ).toThrow();
  });

  it('exits with error on unknown analysis name', () => {
    expect(() =>
      execSync(`npx tsx ${script} --activity-id foo --analyses bogus`, {
        encoding: 'utf-8',
        cwd: resolve(import.meta.dirname),
        stdio: 'pipe',
      }),
    ).toThrow();
  });

  it('exits with error when no args provided', () => {
    expect(() =>
      execSync(`npx tsx ${script}`, {
        encoding: 'utf-8',
        cwd: resolve(import.meta.dirname),
        stdio: 'pipe',
      }),
    ).toThrow();
  });

  it('parses --moving-only without configuration', async () => {
    const { parseStreamAnalyzeArgs } = await import('./stream-analyze.ts');
    expect(parseStreamAnalyzeArgs([
      '--activity-id', 'example-activity',
      '--analyses', 'decoupling',
      '--moving-only',
    ])).toMatchObject({
      activityId: 'example-activity',
      analyses: ['decoupling'],
      movingOnly: true,
    });
  });
});

describe('computeLapTrends', () => {
  function makeLaps(count: number, baseStart = 0, lapLen = 1800): LapBoundary[] {
    return Array.from({ length: count }, (_, i) => ({
      n: i + 1,
      type: 'WORK',
      startIndex: baseStart + i * lapLen,
      endIndex: baseStart + (i + 1) * lapLen - 1,
    }));
  }

  it('computes per-lap rows and detects fastest/slowest', () => {
    const laps = makeLaps(5);
    const watts: number[] = [];
    for (let i = 0; i < 5; i++) {
      watts.push(...Array(1800).fill(250 - i * 5));
    }
    const hr: number[] = Array(9000).fill(150);
    const result = computeLapTrends(watts, hr, laps, 250);
    expect(result.laps.length).toBe(5);
    expect(result.fastest_lap.n).toBe(1);
    expect(result.slowest_lap.n).toBe(5);
    expect(result.power_slope_w_per_lap).toBeLessThan(0);
  });

  it('flags regime breaks when power drops >10% from trailing 3-lap average', () => {
    const laps = makeLaps(8);
    const watts: number[] = [];
    for (let i = 0; i < 4; i++) watts.push(...Array(1800).fill(250));
    for (let i = 0; i < 4; i++) watts.push(...Array(1800).fill(200));
    const hr: number[] = Array(8 * 1800).fill(150);
    const result = computeLapTrends(watts, hr, laps, 250);
    expect(result.regime_breaks.length).toBeGreaterThan(0);
    expect(result.regime_breaks[0].after_lap).toBe(4);
  });

  it('marks laps with avg power <40% FTP and HR dropping as rest', () => {
    const laps: LapBoundary[] = [
      { n: 1, type: 'WORK', startIndex: 0, endIndex: 1799 },
      { n: 2, type: 'REST', startIndex: 1800, endIndex: 3599 },
      { n: 3, type: 'WORK', startIndex: 3600, endIndex: 5399 },
    ];
    const watts: number[] = [
      ...Array(1800).fill(250),
      ...Array(1800).fill(80),
      ...Array(1800).fill(250),
    ];
    const hr: number[] = [
      ...Array(1800).fill(160),
      ...Array.from({ length: 1800 }, (_, i) => 160 - (40 * i) / 1799),
      ...Array(1800).fill(160),
    ];
    const result = computeLapTrends(watts, hr, laps, 250);
    expect(result.laps[1].is_rest).toBe(true);
    expect(result.laps[0].is_rest).toBe(false);
  });

  it('computes first/middle/last third averages', () => {
    const laps = makeLaps(6);
    const watts: number[] = [
      ...Array(3600).fill(250),
      ...Array(3600).fill(240),
      ...Array(3600).fill(230),
    ];
    const hr: number[] = Array(10800).fill(150);
    const result = computeLapTrends(watts, hr, laps, 250);
    expect(result.first_third_avg_w).toBe(250);
    expect(result.middle_third_avg_w).toBe(240);
    expect(result.last_third_avg_w).toBe(230);
  });
});

// --- classifyRestLaps ---

describe('classifyRestLaps', () => {
  it('flags explicit REST type laps as rest', () => {
    const laps: LapBoundary[] = [
      { n: 1, type: 'WORK', startIndex: 0, endIndex: 999 },
      { n: 2, type: 'REST', startIndex: 1000, endIndex: 1999 },
    ];
    const watts: number[] = [...Array(1000).fill(250), ...Array(1000).fill(80)];
    const hr: number[] = [...Array(1000).fill(150), ...Array(1000).fill(140)];
    const flags = classifyRestLaps(watts, hr, laps, 250);
    expect(flags[0]).toBe(false);
    expect(flags[1]).toBe(true);
  });

  it('auto-detects rest when power <40% FTP and HR is dropping', () => {
    const laps: LapBoundary[] = [
      { n: 1, type: 'WORK', startIndex: 0, endIndex: 999 },
      { n: 2, type: 'WORK', startIndex: 1000, endIndex: 2599 },
    ];
    const watts: number[] = [...Array(1000).fill(250), ...Array(1600).fill(80)];
    const hr: number[] = [
      ...Array(1000).fill(150),
      ...Array.from({ length: 1600 }, (_, i) => 150 - (20 * i) / 1599),
    ];
    const flags = classifyRestLaps(watts, hr, laps, 250);
    expect(flags[0]).toBe(false);
    expect(flags[1]).toBe(true);
  });

  it('does not auto-flag when HR is stable despite low power', () => {
    const laps: LapBoundary[] = [
      { n: 1, type: 'WORK', startIndex: 0, endIndex: 999 },
      { n: 2, type: 'WORK', startIndex: 1000, endIndex: 2599 },
    ];
    const watts: number[] = [...Array(1000).fill(250), ...Array(1600).fill(80)];
    const hr: number[] = [...Array(1000).fill(150), ...Array(1600).fill(150)];
    const flags = classifyRestLaps(watts, hr, laps, 250);
    expect(flags[1]).toBe(false);
  });

  it('flags RECOVERY type as rest', () => {
    const laps: LapBoundary[] = [
      { n: 1, type: 'RECOVERY', startIndex: 0, endIndex: 999 },
    ];
    const watts: number[] = Array(1000).fill(100);
    const hr: number[] = Array(1000).fill(130);
    const flags = classifyRestLaps(watts, hr, laps, 250);
    expect(flags[0]).toBe(true);
  });
});

// --- filterStreamsByRestLaps ---

describe('filterStreamsByRestLaps', () => {
  it('concatenates non-rest segments', () => {
    const laps: LapBoundary[] = [
      { n: 1, type: 'WORK', startIndex: 0, endIndex: 2 },
      { n: 2, type: 'REST', startIndex: 3, endIndex: 4 },
      { n: 3, type: 'WORK', startIndex: 5, endIndex: 7 },
    ];
    const watts: (number | null)[] = [10, 20, 30, 5, 6, 40, 50, 60];
    const hr: (number | null)[] = [100, 110, 120, 90, 80, 130, 140, 150];
    const result = filterStreamsByRestLaps(watts, hr, laps, [false, true, false]);
    expect(result.watts).toEqual([10, 20, 30, 40, 50, 60]);
    expect(result.hr).toEqual([100, 110, 120, 130, 140, 150]);
  });

  it('returns empty arrays when all laps are rest', () => {
    const laps: LapBoundary[] = [
      { n: 1, type: 'REST', startIndex: 0, endIndex: 2 },
      { n: 2, type: 'REST', startIndex: 3, endIndex: 5 },
    ];
    const watts: (number | null)[] = [1, 2, 3, 4, 5, 6];
    const hr: (number | null)[] = [10, 20, 30, 40, 50, 60];
    const result = filterStreamsByRestLaps(watts, hr, laps, [true, true]);
    expect(result.watts).toEqual([]);
    expect(result.hr).toEqual([]);
  });

  it('returns all data when no laps are rest', () => {
    const laps: LapBoundary[] = [
      { n: 1, type: 'WORK', startIndex: 0, endIndex: 2 },
      { n: 2, type: 'WORK', startIndex: 3, endIndex: 5 },
    ];
    const watts: (number | null)[] = [10, 20, 30, 40, 50, 60];
    const hr: (number | null)[] = [100, 200, 300, 400, 500, 600];
    const result = filterStreamsByRestLaps(watts, hr, laps, [false, false]);
    expect(result.watts).toEqual([10, 20, 30, 40, 50, 60]);
    expect(result.hr).toEqual([100, 200, 300, 400, 500, 600]);
  });
});

describe('computeNpDistribution', () => {
  it('computes percentiles correctly for known distribution', () => {
    const watts = Array.from({ length: 100 }, (_, i) => i + 1);
    const result = computeNpDistribution(watts);
    expect(result.p20).toBeCloseTo(20, 0);
    expect(result.p50).toBeCloseTo(50, 0);
    expect(result.p80).toBeCloseTo(80, 0);
    expect(result.p95).toBeCloseTo(95, 0);
    expect(result.avg).toBeCloseTo(50.5, 0);
  });

  it('VI equals NP/avg ratio', () => {
    const watts = Array(60).fill(200);
    const result = computeNpDistribution(watts);
    expect(result.vi).toBeCloseTo(1.0, 2);
  });

  it('strips null values', () => {
    const watts: (number | null)[] = [...Array(60).fill(200), null, null];
    const result = computeNpDistribution(watts);
    expect(result.avg).toBe(200);
  });
});

describe('computeSimCompare', () => {
  it('returns empty comparisons when sim list is empty', () => {
    const target: ActivitySummaryForCompare = {
      activity_id: 'race1', date: '2026-05-01', np: 250, avg_hr: 160, decoupling_pct: 4, duration_sec: 25200,
    };
    const result = computeSimCompare(target, []);
    expect(result.comparisons).toEqual([]);
  });

  it('computes per-sim deltas with correct sign', () => {
    const target: ActivitySummaryForCompare = {
      activity_id: 'race1', date: '2026-05-01', np: 240, avg_hr: 165, decoupling_pct: 6, duration_sec: 25200,
    };
    const sims: ActivitySummaryForCompare[] = [
      { activity_id: 'sim1', date: '2026-04-26', np: 250, avg_hr: 158, decoupling_pct: 4, duration_sec: 18000 },
    ];
    const result = computeSimCompare(target, sims);
    expect(result.comparisons.length).toBe(1);
    const c = result.comparisons[0];
    expect(c.sim_activity_id).toBe('sim1');
    expect(c.np_delta_pct).toBeCloseTo(-4, 1);
    expect(c.hr_delta_bpm).toBe(7);
    expect(c.decoupling_delta_pct).toBe(2);
    expect(c.duration_delta_min).toBe(120);
  });
});
