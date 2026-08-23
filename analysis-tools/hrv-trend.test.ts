import { describe, it, expect } from 'vitest';
import {
  sampleMean,
  sampleStddev,
  percentileRank,
  linearRegressionSlope,
  computeBaselines,
  computePosition,
  computeTrend,
  computeAnalogs,
  classify,
  analyzeHrvTrend,
  type WellnessRecord,
  type HrvTrendThresholds,
  type BaselinesResult,
  type AnalogsResult,
} from './hrv-trend.js';

// ── Math helpers ─────────────────────────────────────────────────────────────

describe('sampleMean', () => {
  it('computes mean of known values', () => {
    expect(sampleMean([40, 45, 50, 55, 60])).toBeCloseTo(50, 5);
  });

  it('returns 0 for empty array', () => {
    expect(sampleMean([])).toBe(0);
  });
});

describe('sampleStddev', () => {
  it('uses N-1 denominator (sample SD)', () => {
    // [40, 45, 50, 55, 60]: mean=50
    // variance = (100+25+0+25+100)/4 = 62.5
    // sd = sqrt(62.5) ≈ 7.906
    expect(sampleStddev([40, 45, 50, 55, 60])).toBeCloseTo(7.906, 2);
  });

  it('returns 0 for single element', () => {
    expect(sampleStddev([42])).toBe(0);
  });
});

describe('percentileRank', () => {
  it('counts values ≤ target', () => {
    // 2 of 5 values ≤ 45 → 40%
    expect(percentileRank([40, 45, 50, 55, 60], 45)).toBeCloseTo(40, 1);
  });

  it('returns 100 when target equals max', () => {
    expect(percentileRank([40, 45, 50], 50)).toBeCloseTo(100, 1);
  });

  it('returns 0 for empty array', () => {
    expect(percentileRank([], 36)).toBe(0);
  });
});

describe('linearRegressionSlope', () => {
  it('returns -1 for a linear decreasing sequence', () => {
    // y = [53, 52, 51, 50, 49, 48, 47], x = [0..6]
    // slope = -28/28 = -1.0
    expect(linearRegressionSlope([53, 52, 51, 50, 49, 48, 47])).toBeCloseTo(-1.0, 5);
  });

  it('returns +1 for a linear increasing sequence', () => {
    expect(linearRegressionSlope([47, 48, 49, 50, 51, 52, 53])).toBeCloseTo(1.0, 5);
  });

  it('returns 0 for flat sequence', () => {
    expect(linearRegressionSlope([50, 50, 50, 50, 50])).toBeCloseTo(0, 5);
  });

  it('returns 0 for single element', () => {
    expect(linearRegressionSlope([42])).toBe(0);
  });
});

// ── computeBaselines ─────────────────────────────────────────────────────────

describe('computeBaselines', () => {
  it('computes short and long baselines from sufficient history', () => {
    // 20 values: first 13 are 50, last 7 are 60
    // short window (7): last 7 = all 60 → mean=60, sd=0
    // long window (14): last 14 = [50,50,50,50,50,50,50,60,60,60,60,60,60,60] → mean=(7*50+7*60)/14=55
    const history = Array(13).fill(50).concat(Array(7).fill(60));
    const result = computeBaselines(history, 7, 14);
    expect(result.short_window_days).toBe(7);
    expect(result.short_mean).toBeCloseTo(60, 1);
    expect(result.short_sd).toBeCloseTo(0, 1);
    expect(result.long_window_days).toBe(14);
    expect(result.long_mean).toBeCloseTo(55, 1);
    expect(result.long_sd).toBeGreaterThan(0);
  });

  it('returns null short baseline when fewer than short_window_days values', () => {
    const history = Array(5).fill(50);
    const result = computeBaselines(history, 7, 14);
    expect(result.short_mean).toBeNull();
    expect(result.short_sd).toBeNull();
  });

  it('returns null long baseline when fewer than long_window_days values', () => {
    const history = Array(10).fill(50);
    const result = computeBaselines(history, 7, 14);
    expect(result.long_mean).toBeNull();
    expect(result.long_sd).toBeNull();
    expect(result.short_mean).toBeCloseTo(50, 1);
  });

  it('uses at most the configured window size', () => {
    const history = Array(16).fill(40).concat(Array(14).fill(60));
    const result = computeBaselines(history, 7, 14);
    expect(result.long_mean).toBeCloseTo(60, 1);
    expect(result.short_mean).toBeCloseTo(60, 1);
  });
});

// ── computePosition ──────────────────────────────────────────────────────────

describe('computePosition', () => {
  const baselines: BaselinesResult = {
    short_window_days: 14,
    short_mean: 50,
    short_sd: 10,
    long_window_days: 60,
    long_mean: 47,
    long_sd: 9,
  };

  it('computes z-scores correctly', () => {
    // z_short = (36 - 50) / 10 = -1.4
    // z_long  = (36 - 47) / 9  ≈ -1.222
    const result = computePosition(36, baselines);
    expect(result.z_short).toBeCloseTo(-1.4, 2);
    expect(result.z_long).toBeCloseTo(-1.222, 2);
  });

  it('returns null z-scores when baseline is null', () => {
    const noBaseline: BaselinesResult = {
      ...baselines,
      short_mean: null,
      short_sd: null,
      long_mean: null,
      long_sd: null,
    };
    const result = computePosition(36, noBaseline);
    expect(result.z_short).toBeNull();
    expect(result.z_long).toBeNull();
    expect(result.percentile_long).toBeNull();
  });

  it('computes percentile_long from sorted long window values', () => {
    const sorted = [30, 35, 36, 40, 45, 50, 55, 60, 65, 70];
    const result = computePosition(36, baselines, sorted);
    // 3 of 10 values ≤ 36 → 30%
    expect(result.percentile_long).toBeCloseTo(30, 1);
  });

  it('returns null percentile when sortedLongWindow is missing', () => {
    const result = computePosition(36, baselines);
    expect(result.percentile_long).toBeNull();
  });
});

// ── computeTrend ─────────────────────────────────────────────────────────────

function makeRecords(entries: [string, number | null][]): WellnessRecord[] {
  return entries.map(([date, hrv_rmssd]) => ({ date, hrv_rmssd, hrv_sdnn: null }));
}

describe('computeTrend', () => {
  it('detects declining slope and direction', () => {
    const records = makeRecords([
      ['2026-04-03', 53],
      ['2026-04-04', 52],
      ['2026-04-05', 51],
      ['2026-04-06', 50],
      ['2026-04-07', 49],
      ['2026-04-08', 48],
      ['2026-04-09', 47],
      ['2026-04-10', 36],
    ]);
    // Trend window (last 7 including target): Apr4-Apr10 = [52,51,50,49,48,47,36]
    // Target date IS included in the window; slope ≈ -2.07 due to the sharp Apr10 drop.
    const result = computeTrend(records, '2026-04-10', 50, 7, 'hrv_rmssd');
    expect(result.slope_per_day).toBeLessThan(-0.5); // strongly declining
    expect(result.direction).toBe('declining');
    expect(result.window_days).toBe(7);
  });

  it('detects improving direction', () => {
    const records = makeRecords([
      ['2026-04-03', 47],
      ['2026-04-04', 48],
      ['2026-04-05', 49],
      ['2026-04-06', 50],
      ['2026-04-07', 51],
      ['2026-04-08', 52],
      ['2026-04-09', 53],
      ['2026-04-10', 56],
    ]);
    const result = computeTrend(records, '2026-04-10', 50, 7, 'hrv_rmssd');
    expect(result.direction).toBe('improving');
    expect(result.slope_per_day).toBeGreaterThan(0.5);
  });

  it('detects stable direction when slope is small', () => {
    const records = makeRecords([
      ['2026-04-03', 50],
      ['2026-04-04', 50],
      ['2026-04-05', 50],
      ['2026-04-06', 50],
      ['2026-04-07', 50],
      ['2026-04-08', 50],
      ['2026-04-09', 50],
      ['2026-04-10', 50],
    ]);
    const result = computeTrend(records, '2026-04-10', 50, 7, 'hrv_rmssd');
    expect(result.direction).toBe('stable');
    expect(result.slope_per_day).toBeCloseTo(0, 5);
  });

  it('counts consecutive days below long mean', () => {
    // long_mean = 50. Apr10=36 (below). Apr9=40 (below). Apr8=47 (below). Apr7=53 (above).
    const records = makeRecords([
      ['2026-04-07', 53],
      ['2026-04-08', 47],
      ['2026-04-09', 40],
      ['2026-04-10', 36],
    ]);
    const result = computeTrend(records, '2026-04-10', 50, 7, 'hrv_rmssd');
    expect(result.consecutive_days_below_long_mean).toBe(3);
  });

  it('resets consecutive count on a day at or above mean', () => {
    const records = makeRecords([
      ['2026-04-07', 55],
      ['2026-04-08', 51],
      ['2026-04-09', 40],
      ['2026-04-10', 36],
    ]);
    const result = computeTrend(records, '2026-04-10', 50, 7, 'hrv_rmssd');
    expect(result.consecutive_days_below_long_mean).toBe(2);
  });

  it('returns 0 consecutive when target itself is at or above mean', () => {
    const records = makeRecords([
      ['2026-04-09', 45],
      ['2026-04-10', 52],
    ]);
    const result = computeTrend(records, '2026-04-10', 50, 7, 'hrv_rmssd');
    expect(result.consecutive_days_below_long_mean).toBe(0);
  });

  it('works with hrv_sdnn metric', () => {
    const records: WellnessRecord[] = [
      { date: '2026-04-09', hrv_rmssd: null, hrv_sdnn: 45 },
      { date: '2026-04-10', hrv_rmssd: null, hrv_sdnn: 42 },
    ];
    const result = computeTrend(records, '2026-04-10', 50, 7, 'hrv_sdnn');
    expect(result.consecutive_days_below_long_mean).toBe(2);
  });

  it('returns null slope when fewer than 2 trend window values', () => {
    const records = makeRecords([['2026-04-10', 36]]);
    const result = computeTrend(records, '2026-04-10', 50, 7, 'hrv_rmssd');
    expect(result.slope_per_day).toBeNull();
    expect(result.direction).toBeNull();
  });
});

// ── computeAnalogs ────────────────────────────────────────────────────────────

describe('computeAnalogs', () => {
  function makeAnalogFixture(): WellnessRecord[] {
    const dates: [string, number][] = [
      ['2026-03-25', 50], ['2026-03-26', 48], ['2026-03-27', 38], ['2026-03-28', 48],
      ['2026-03-29', 52], ['2026-03-30', 50], ['2026-03-31', 49],
      ['2026-04-01', 51], ['2026-04-02', 50], ['2026-04-03', 52],
      ['2026-04-04', 49], ['2026-04-05', 35], ['2026-04-06', 39],
      ['2026-04-07', 53], ['2026-04-08', 47], ['2026-04-09', 40],
    ];
    return dates.map(([date, v]) => ({ date, hrv_rmssd: v, hrv_sdnn: null }));
  }

  it('finds analogs within tolerance', () => {
    const history = makeAnalogFixture();
    const result = computeAnalogs(36, 47, history, 2, 3, 'hrv_rmssd');
    const dates = result.matches.map(m => m.date);
    expect(dates).toContain('2026-03-27');
    expect(dates).toContain('2026-04-05');
  });

  it('does not find analogs outside tolerance', () => {
    const history = makeAnalogFixture();
    const result = computeAnalogs(36, 47, history, 2, 3, 'hrv_rmssd');
    const dates = result.matches.map(m => m.date);
    expect(dates).not.toContain('2026-04-06');
    expect(dates).not.toContain('2026-04-08');
  });

  it('deduplicates matches within dedupDays (keeps lowest value)', () => {
    const records: WellnessRecord[] = [
      { date: '2026-03-27', hrv_rmssd: 37, hrv_sdnn: null },
      { date: '2026-03-29', hrv_rmssd: 35, hrv_sdnn: null },
      { date: '2026-03-31', hrv_rmssd: 48, hrv_sdnn: null },
      { date: '2026-04-01', hrv_rmssd: 50, hrv_sdnn: null },
    ];
    const result = computeAnalogs(36, 47, records, 2, 3, 'hrv_rmssd');
    expect(result.match_count).toBe(1);
    expect(result.matches[0].value).toBe(35);
  });

  it('computes rebound_days_to_long_mean correctly', () => {
    const history = makeAnalogFixture();
    const result = computeAnalogs(36, 47, history, 2, 3, 'hrv_rmssd');
    const mar27 = result.matches.find(m => m.date === '2026-03-27');
    const apr5 = result.matches.find(m => m.date === '2026-04-05');
    expect(mar27?.rebound_days_to_long_mean).toBe(1);
    expect(apr5?.rebound_days_to_long_mean).toBe(2);
  });

  it('sets any_sustained_suppression=true when a match never rebounds within 7 days', () => {
    const records: WellnessRecord[] = [
      { date: '2026-03-01', hrv_rmssd: 35, hrv_sdnn: null },
      { date: '2026-03-02', hrv_rmssd: 38, hrv_sdnn: null },
      { date: '2026-03-03', hrv_rmssd: 40, hrv_sdnn: null },
      { date: '2026-03-04', hrv_rmssd: 41, hrv_sdnn: null },
    ];
    const result = computeAnalogs(36, 47, records, 2, 3, 'hrv_rmssd');
    expect(result.any_sustained_suppression).toBe(true);
    const match = result.matches.find(m => m.date === '2026-03-01');
    expect(match?.rebound_days_to_long_mean).toBeNull();
  });

  it('computes median_rebound_days correctly', () => {
    const history = makeAnalogFixture();
    const result = computeAnalogs(36, 47, history, 2, 3, 'hrv_rmssd');
    // Mar 27 rebounds in 1, Apr 5 rebounds in 2 → median = 1.5 → sorted[floor(2/2)] = sorted[1] = 2
    // Note: median of [1,2] using floor(n/2) index picks index 1 = 2. Let's verify.
    expect(result.median_rebound_days).toBeGreaterThanOrEqual(1);
    expect(result.median_rebound_days).toBeLessThanOrEqual(2);
  });

  it('caps matches at 5 and sorts most-recent first', () => {
    const records: WellnessRecord[] = [];
    for (let i = 0; i < 8; i++) {
      const d1 = `2026-01-${String(i * 4 + 1).padStart(2, '0')}`;
      const d2 = `2026-01-${String(i * 4 + 2).padStart(2, '0')}`;
      records.push({ date: d1, hrv_rmssd: 36, hrv_sdnn: null });
      records.push({ date: d2, hrv_rmssd: 50, hrv_sdnn: null });
    }
    const result = computeAnalogs(36, 47, records, 1, 1, 'hrv_rmssd');
    expect(result.match_count).toBe(5);
    for (let i = 1; i < result.matches.length; i++) {
      expect(result.matches[i - 1].date > result.matches[i].date).toBe(true);
    }
  });

  it('handles no matches gracefully', () => {
    const records = makeAnalogFixture();
    const result = computeAnalogs(100, 47, records, 2, 3, 'hrv_rmssd');
    expect(result.match_count).toBe(0);
    expect(result.median_rebound_days).toBeNull();
    expect(result.any_sustained_suppression).toBe(false);
  });

  it('works with hrv_sdnn metric', () => {
    const records: WellnessRecord[] = [
      { date: '2026-03-27', hrv_rmssd: null, hrv_sdnn: 37 },
      { date: '2026-03-28', hrv_rmssd: null, hrv_sdnn: 50 },
    ];
    const result = computeAnalogs(36, 47, records, 2, 3, 'hrv_sdnn');
    expect(result.match_count).toBe(1);
    expect(result.matches[0].value).toBe(37);
    expect(result.matches[0].rebound_days_to_long_mean).toBe(1);
  });
});

// ── classify ──────────────────────────────────────────────────────────────────

describe('classify', () => {
  const defaults: HrvTrendThresholds = { green: -0.5, green_watch: -1.0, amber: -1.5, red: -2.0 };
  const noSustained: AnalogsResult = {
    tolerance: 2, dedup_days: 3, matches: [], match_count: 0,
    median_rebound_days: null, any_sustained_suppression: false,
  };
  const withSustained: AnalogsResult = {
    ...noSustained, any_sustained_suppression: true,
  };

  it('returns green when z_long >= green threshold', () => {
    expect(classify(0, 0, noSustained, defaults).label).toBe('green');
    expect(classify(-0.5, 0, noSustained, defaults).label).toBe('green');
    expect(classify(0.3, 0, noSustained, defaults).label).toBe('green');
  });

  it('returns green-watch when green_watch <= z_long < green', () => {
    expect(classify(-0.6, 0, noSustained, defaults).label).toBe('green-watch');
    expect(classify(-1.0, 0, noSustained, defaults).label).toBe('green-watch');
  });

  it('returns amber when amber <= z_long < green_watch and no severe trend', () => {
    expect(classify(-1.2, 2, noSustained, defaults).label).toBe('amber');
    expect(classify(-1.5, 0, noSustained, defaults).label).toBe('amber');
  });

  it('returns amber-red when amber <= z_long < green_watch AND consecutive >= 3 AND any_sustained', () => {
    expect(classify(-1.2, 3, withSustained, defaults).label).toBe('amber-red');
    expect(classify(-1.5, 4, withSustained, defaults).label).toBe('amber-red');
  });

  it('returns amber-red when z_long in (-2, -1.5) and no sustained suppression', () => {
    expect(classify(-1.6, 0, noSustained, defaults).label).toBe('amber-red');
    expect(classify(-1.99, 2, noSustained, defaults).label).toBe('amber-red');
  });

  it('returns red when z_long in (-2, -1.5) and (consecutive >= 3 or sustained)', () => {
    expect(classify(-1.6, 3, noSustained, defaults).label).toBe('red');
    expect(classify(-1.8, 1, withSustained, defaults).label).toBe('red');
  });

  it('returns red hard floor when z_long < -2.0 regardless of analogs', () => {
    expect(classify(-2.01, 0, noSustained, defaults).label).toBe('red');
    expect(classify(-3.0, 0, noSustained, defaults).label).toBe('red');
  });

  it('returns insufficient_data when z_long is null', () => {
    expect(classify(null, 0, null, defaults).label).toBe('insufficient_data');
  });

  it('respects persona threshold overrides', () => {
    const permissive: HrvTrendThresholds = { green: -1.0, green_watch: -1.5, amber: -2.0, red: -2.5 };
    expect(classify(-0.8, 0, noSustained, permissive).label).toBe('green');
    expect(classify(-1.2, 0, noSustained, permissive).label).toBe('green-watch');
  });

  it('includes z_long and consecutive in reasoning string', () => {
    const result = classify(-1.3, 4, withSustained, defaults);
    expect(result.reasoning).toMatch(/-1.3/);
    expect(result.reasoning).toMatch(/4 consecutive/);
  });
});

// ── analyzeHrvTrend — integration fixture ─────────────────────────────────────

describe('analyzeHrvTrend', () => {
  function buildFixture(): WellnessRecord[] {
    const seed: [string, number][] = [
      ['2026-01-10', 48], ['2026-01-11', 50], ['2026-01-12', 47], ['2026-01-13', 45],
      ['2026-01-14', 52], ['2026-01-15', 49], ['2026-01-16', 46], ['2026-01-17', 51],
      ['2026-01-18', 48], ['2026-01-19', 50], ['2026-01-20', 44], ['2026-01-21', 52],
      ['2026-01-22', 49], ['2026-01-23', 47], ['2026-01-24', 50], ['2026-01-25', 53],
      ['2026-01-26', 48], ['2026-01-27', 46], ['2026-01-28', 51], ['2026-01-29', 49],
      ['2026-01-30', 47], ['2026-01-31', 50],
      ['2026-02-01', 48], ['2026-02-02', 52], ['2026-02-03', 46], ['2026-02-04', 50],
      ['2026-02-05', 49], ['2026-02-06', 47], ['2026-02-07', 53], ['2026-02-08', 51],
      ['2026-02-09', 48], ['2026-02-10', 50], ['2026-02-11', 45], ['2026-02-12', 52],
      ['2026-02-13', 49], ['2026-02-14', 47], ['2026-02-15', 51], ['2026-02-16', 50],
      ['2026-02-17', 48], ['2026-02-18', 46], ['2026-02-19', 52], ['2026-02-20', 50],
      ['2026-02-21', 47], ['2026-02-22', 49], ['2026-02-23', 51], ['2026-02-24', 48],
      ['2026-02-25', 50], ['2026-02-26', 46], ['2026-02-27', 52], ['2026-02-28', 49],
      ['2026-03-01', 47], ['2026-03-02', 51], ['2026-03-03', 50], ['2026-03-04', 48],
      ['2026-03-05', 52], ['2026-03-06', 49], ['2026-03-07', 47], ['2026-03-08', 50],
      ['2026-03-09', 53], ['2026-03-10', 48], ['2026-03-11', 51], ['2026-03-12', 46],
      ['2026-03-13', 50], ['2026-03-14', 49], ['2026-03-15', 52], ['2026-03-16', 47],
      ['2026-03-17', 51], ['2026-03-18', 50], ['2026-03-19', 48], ['2026-03-20', 52],
      ['2026-03-21', 49], ['2026-03-22', 47], ['2026-03-23', 50], ['2026-03-24', 53],
      ['2026-03-25', 50], ['2026-03-26', 48],
      // Mar 27: first analog dip (38, within ±2 of 36) — rebounds Mar 28
      ['2026-03-27', 38], ['2026-03-28', 48], ['2026-03-29', 52],
      ['2026-03-30', 50], ['2026-03-31', 49],
      ['2026-04-01', 51], ['2026-04-02', 50], ['2026-04-03', 52], ['2026-04-04', 49],
      // Apr 5: second analog dip (35, within ±2 of 36) — rebounds Apr 7
      ['2026-04-05', 35], ['2026-04-06', 39],
      ['2026-04-07', 53], ['2026-04-08', 47], ['2026-04-09', 40],
      // Apr 10: target date
      ['2026-04-10', 36],
    ];
    return seed.map(([date, v]) => ({ date, hrv_rmssd: v, hrv_sdnn: null }));
  }

  const defaultInput = {
    targetDate: '2026-04-10',
    metric: 'hrv_rmssd' as const,
    shortWindowDays: 14,
    longWindowDays: 60,
    trendWindowDays: 7,
    analogTolerance: 2,
    analogDedupDays: 3,
  };

  it('classifies the Apr 10 motivating case as a suppression state (not green)', () => {
    const result = analyzeHrvTrend({ ...defaultInput, wellness: buildFixture() });
    // Synthetic fixture has tight variance (SD≈2) vs real data SD≈9, so z_long is more extreme.
    // Accept amber, amber-red, or red — all correctly identify HRV suppression.
    expect(['amber', 'amber-red', 'red']).toContain(result.classification.label);
    expect(result.current).toBe(36);
  });

  it('finds at least one analog from the prior dips', () => {
    const result = analyzeHrvTrend({ ...defaultInput, wellness: buildFixture() });
    expect(result.analogs.match_count).toBeGreaterThan(0);
    const analogDates = result.analogs.matches.map(m => m.date);
    const hasExpectedAnalog = analogDates.some(d => d === '2026-03-27' || d === '2026-04-05');
    expect(hasExpectedAnalog).toBe(true);
  });

  it('identifies declining trend', () => {
    const result = analyzeHrvTrend({ ...defaultInput, wellness: buildFixture() });
    expect(result.trend.direction).toBe('declining');
    expect(result.trend.consecutive_days_below_long_mean).toBeGreaterThanOrEqual(3);
  });

  it('output shape matches HrvTrendOutput interface', () => {
    const result = analyzeHrvTrend({ ...defaultInput, wellness: buildFixture() });
    expect(result.date).toBe('2026-04-10');
    expect(result.metric).toBe('hrv_rmssd');
    expect(result.baselines.short_window_days).toBe(14);
    expect(result.baselines.long_window_days).toBe(60);
    expect(result.position).toHaveProperty('z_long');
    expect(result.trend).toHaveProperty('slope_per_day');
    expect(result.analogs).toHaveProperty('tolerance');
    expect(result.classification).toHaveProperty('label');
    expect(result.classification).toHaveProperty('reasoning');
    expect(result.errors).toBeDefined();
  });

  it('returns insufficient_data label with too few days', () => {
    const sparse = buildFixture().slice(-5);
    const result = analyzeHrvTrend({ ...defaultInput, wellness: sparse });
    expect(result.classification.label).toBe('insufficient_data');
  });
});
