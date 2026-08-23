import { fileURLToPath } from 'url';
import { resolve } from 'path';
import { loadConfig, IntervalsIcuConfig } from './stream-analyze.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type MetricKey = 'hrv_rmssd' | 'hrv_sdnn';

export interface WellnessRecord {
  date: string;          // YYYY-MM-DD
  hrv_rmssd: number | null;
  hrv_sdnn: number | null;
}

export interface HrvTrendThresholds {
  green: number;        // z-score at/above this → green (default -0.5)
  green_watch: number;  // z-score at/above this → green-watch (default -1.0)
  amber: number;        // z-score at/above this → amber band (default -1.5)
  red: number;          // z-score below this → red hard floor (default -2.0)
}

export interface HrvTrendInput {
  targetDate: string;
  wellness: WellnessRecord[];   // sorted ascending by date
  metric: MetricKey;
  shortWindowDays: number;
  longWindowDays: number;
  trendWindowDays: number;
  analogTolerance: number;
  analogDedupDays: number;
  thresholds?: Partial<HrvTrendThresholds>;
}

export interface BaselinesResult {
  short_window_days: number;
  short_mean: number | null;
  short_sd: number | null;
  long_window_days: number;
  long_mean: number | null;
  long_sd: number | null;
}

export interface PositionResult {
  z_short: number | null;
  z_long: number | null;
  percentile_long: number | null;
}

export interface TrendResult {
  window_days: number;
  slope_per_day: number | null;
  direction: 'improving' | 'stable' | 'declining' | null;
  consecutive_days_below_long_mean: number;
}

export interface AnalogMatch {
  date: string;
  value: number;
  rebound_days_to_long_mean: number | null;
}

export interface AnalogsResult {
  tolerance: number;
  dedup_days: number;
  matches: AnalogMatch[];
  match_count: number;
  median_rebound_days: number | null;
  any_sustained_suppression: boolean;
}

export type ClassificationLabel =
  | 'green'
  | 'green-watch'
  | 'amber'
  | 'amber-red'
  | 'red'
  | 'insufficient_data';

export interface ClassificationResult {
  label: ClassificationLabel;
  reasoning: string;
}

export interface HrvTrendOutput {
  date: string;
  metric: MetricKey;
  current: number | null;
  baselines: BaselinesResult;
  position: PositionResult;
  trend: TrendResult;
  analogs: AnalogsResult;
  classification: ClassificationResult;
  errors: Record<string, string>;
}

// ── Math helpers ─────────────────────────────────────────────────────────────

export function sampleMean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function sampleStddev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = sampleMean(values);
  const variance = values.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

export function percentileRank(sortedValues: number[], target: number): number {
  if (sortedValues.length === 0) return 0;
  const count = sortedValues.filter(v => v <= target).length;
  return (count / sortedValues.length) * 100;
}

export function linearRegressionSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = sampleMean(values);
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i++) {
    numerator += (i - xMean) * (values[i] - yMean);
    denominator += (i - xMean) ** 2;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── computeBaselines ─────────────────────────────────────────────────────────

export function computeBaselines(
  history: number[],
  shortWindowDays: number,
  longWindowDays: number,
): BaselinesResult {
  const result: BaselinesResult = {
    short_window_days: shortWindowDays,
    short_mean: null,
    short_sd: null,
    long_window_days: longWindowDays,
    long_mean: null,
    long_sd: null,
  };

  const longSlice = history.slice(-longWindowDays);
  if (longSlice.length >= longWindowDays) {
    result.long_mean = round2(sampleMean(longSlice));
    result.long_sd = round2(sampleStddev(longSlice));
  }

  const shortSlice = history.slice(-shortWindowDays);
  if (shortSlice.length >= shortWindowDays) {
    result.short_mean = round2(sampleMean(shortSlice));
    result.short_sd = round2(sampleStddev(shortSlice));
  }

  return result;
}

// ── computePosition ──────────────────────────────────────────────────────────

export function computePosition(
  current: number,
  baselines: BaselinesResult,
  sortedLongWindow?: number[],
): PositionResult {
  const zShort =
    baselines.short_mean !== null && baselines.short_sd !== null && baselines.short_sd > 0
      ? round2((current - baselines.short_mean) / baselines.short_sd)
      : null;

  const zLong =
    baselines.long_mean !== null && baselines.long_sd !== null && baselines.long_sd > 0
      ? round2((current - baselines.long_mean) / baselines.long_sd)
      : null;

  const percentileLong =
    sortedLongWindow && sortedLongWindow.length > 0
      ? round2(percentileRank(sortedLongWindow, current))
      : null;

  return { z_short: zShort, z_long: zLong, percentile_long: percentileLong };
}

// ── computeTrend ─────────────────────────────────────────────────────────────

export function computeTrend(
  history: WellnessRecord[],
  targetDate: string,
  longMean: number | null,
  trendWindowDays: number,
  metric: MetricKey,
): TrendResult {
  const getValue = (r: WellnessRecord): number | null =>
    metric === 'hrv_rmssd' ? r.hrv_rmssd : r.hrv_sdnn;

  const relevant = history.filter(r => r.date <= targetDate);

  // Consecutive days below long_mean: walk backwards from target date
  let consecutive = 0;
  if (longMean !== null) {
    for (let i = relevant.length - 1; i >= 0; i--) {
      const val = getValue(relevant[i]);
      if (val === null) break;
      if (val < longMean) {
        consecutive++;
      } else {
        break;
      }
    }
  }

  // Trend window: last trendWindowDays records (including target date)
  const trendRecords = relevant.slice(-trendWindowDays);
  const trendValues = trendRecords.map(getValue).filter((v): v is number => v !== null);

  let slopePerDay: number | null = null;
  let direction: TrendResult['direction'] = null;

  if (trendValues.length >= 2) {
    slopePerDay = round2(linearRegressionSlope(trendValues));
    if (slopePerDay > 0.5) direction = 'improving';
    else if (slopePerDay < -0.5) direction = 'declining';
    else direction = 'stable';
  }

  return {
    window_days: trendWindowDays,
    slope_per_day: slopePerDay,
    direction,
    consecutive_days_below_long_mean: consecutive,
  };
}

// ── computeAnalogs ────────────────────────────────────────────────────────────

function deduplicateAnalogs(matches: AnalogMatch[], dedupDays: number): AnalogMatch[] {
  if (matches.length === 0) return [];
  const sorted = [...matches].sort((a, b) => a.date.localeCompare(b.date));
  const clusters: AnalogMatch[][] = [[sorted[0]]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const lastCluster = clusters[clusters.length - 1];
    const lastDate = lastCluster[lastCluster.length - 1].date;
    const msPerDay = 86_400_000;
    const daysDiff = Math.round(
      (new Date(current.date).getTime() - new Date(lastDate).getTime()) / msPerDay,
    );
    if (daysDiff <= dedupDays) {
      lastCluster.push(current);
    } else {
      clusters.push([current]);
    }
  }

  return clusters.map(cluster =>
    cluster.reduce((min, m) => (m.value < min.value ? m : min)),
  );
}

export function computeAnalogs(
  current: number,
  longMean: number,
  history: WellnessRecord[],
  tolerance: number,
  dedupDays: number,
  metric: MetricKey,
): AnalogsResult {
  const getValue = (r: WellnessRecord): number | null =>
    metric === 'hrv_rmssd' ? r.hrv_rmssd : r.hrv_sdnn;

  const REBOUND_MAX_DAYS = 7;
  const OUTPUT_CAP = 5;

  const rawMatches: AnalogMatch[] = [];
  for (let i = 0; i < history.length; i++) {
    const val = getValue(history[i]);
    if (val === null) continue;
    if (Math.abs(val - current) > tolerance) continue;

    let reboundDays: number | null = null;
    for (let d = 1; d <= REBOUND_MAX_DAYS; d++) {
      const next = history[i + d];
      if (!next) break;
      const nextVal = getValue(next);
      if (nextVal !== null && nextVal >= longMean) {
        reboundDays = d;
        break;
      }
    }

    rawMatches.push({ date: history[i].date, value: val, rebound_days_to_long_mean: reboundDays });
  }

  const deduplicated = deduplicateAnalogs(rawMatches, dedupDays);
  deduplicated.sort((a, b) => b.date.localeCompare(a.date));
  const matches = deduplicated.slice(0, OUTPUT_CAP);

  const anySupp = rawMatches.some(m => m.rebound_days_to_long_mean === null);
  const reboundTimes = matches
    .map(m => m.rebound_days_to_long_mean)
    .filter((v): v is number => v !== null);
  const medianRebound =
    reboundTimes.length === 0
      ? null
      : reboundTimes.slice().sort((a, b) => a - b)[Math.floor(reboundTimes.length / 2)];

  return {
    tolerance,
    dedup_days: dedupDays,
    matches,
    match_count: matches.length,
    median_rebound_days: medianRebound,
    any_sustained_suppression: anySupp,
  };
}

// ── classify ──────────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLDS: HrvTrendThresholds = {
  green: -0.5,
  green_watch: -1.0,
  amber: -1.5,
  red: -2.0,
};

export function classify(
  zLong: number | null,
  consecutive: number,
  analogs: AnalogsResult | null,
  thresholds: Partial<HrvTrendThresholds>,
): ClassificationResult {
  if (zLong === null) {
    return {
      label: 'insufficient_data',
      reasoning: 'Insufficient wellness history to compute z-score baseline.',
    };
  }

  const t: HrvTrendThresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const anySustained = analogs?.any_sustained_suppression ?? false;
  const zStr = round2(zLong).toFixed(2);

  if (zLong < t.red) {
    return {
      label: 'red',
      reasoning: `z_long ${zStr} is below hard floor (${t.red}); severe HRV suppression regardless of analog history.`,
    };
  }

  if (zLong < t.amber) {
    if (consecutive >= 3 || anySustained) {
      return {
        label: 'red',
        reasoning:
          `z_long ${zStr} in severe band (${t.amber}..${t.red}); ` +
          (consecutive >= 3 ? `${consecutive} consecutive days below long-mean; ` : '') +
          (anySustained ? 'prior analogs showed sustained suppression.' : ''),
      };
    }
    return {
      label: 'amber-red',
      reasoning:
        `z_long ${zStr} in severe band (${t.amber}..${t.red}); ` +
        `${consecutive} consecutive days below long-mean; ` +
        `prior analogs did not show sustained suppression.`,
    };
  }

  if (zLong < t.green_watch) {
    if (consecutive >= 3 && anySustained) {
      return {
        label: 'amber-red',
        reasoning:
          `z_long ${zStr} in moderate-suppression band; ` +
          `${consecutive} consecutive days below long-mean; ` +
          `prior analogs showed sustained suppression.`,
      };
    }
    return {
      label: 'amber',
      reasoning:
        `z_long ${zStr} in moderate-suppression band (${t.green_watch}..${t.amber}); ` +
        `${consecutive} consecutive days below long-mean; ` +
        (anySustained ? 'some analogs showed sustained suppression.' : 'analogs generally rebounded.'),
    };
  }

  if (zLong < t.green) {
    return {
      label: 'green-watch',
      reasoning:
        `z_long ${zStr} is near baseline (${t.green_watch}..${t.green}); mild suppression worth noting.`,
    };
  }

  return {
    label: 'green',
    reasoning: `z_long ${zStr} is at or above baseline (≥ ${t.green}); readiness unimpaired.`,
  };
}

// ── analyzeHrvTrend ───────────────────────────────────────────────────────────

export function analyzeHrvTrend(input: HrvTrendInput): HrvTrendOutput {
  const {
    targetDate, wellness, metric, shortWindowDays, longWindowDays,
    trendWindowDays, analogTolerance, analogDedupDays, thresholds = {},
  } = input;

  const errors: Record<string, string> = {};

  const getValue = (r: WellnessRecord): number | null =>
    metric === 'hrv_rmssd' ? r.hrv_rmssd : r.hrv_sdnn;

  const allSorted = [...wellness].sort((a, b) => a.date.localeCompare(b.date));
  const history = allSorted.filter(r => r.date < targetDate);
  const todayRecord = wellness.find(r => r.date === targetDate);
  const current = todayRecord ? getValue(todayRecord) : null;

  const numericHistory = history.map(getValue).filter((v): v is number => v !== null);

  const baselines = computeBaselines(numericHistory, shortWindowDays, longWindowDays);

  const longSlice = numericHistory.slice(-longWindowDays).sort((a, b) => a - b);
  const position =
    current !== null
      ? computePosition(current, baselines, baselines.long_mean !== null ? longSlice : undefined)
      : { z_short: null, z_long: null, percentile_long: null };

  const trend = computeTrend(allSorted, targetDate, baselines.long_mean, trendWindowDays, metric);

  let analogs: AnalogsResult = {
    tolerance: analogTolerance, dedup_days: analogDedupDays,
    matches: [], match_count: 0, median_rebound_days: null,
    any_sustained_suppression: false,
  };
  if (current !== null && baselines.long_mean !== null) {
    analogs = computeAnalogs(current, baselines.long_mean, allSorted, analogTolerance, analogDedupDays, metric);
    analogs.matches = analogs.matches.filter(m => m.date !== targetDate);
    analogs.match_count = analogs.matches.length;
  }

  const classification = classify(
    position.z_long,
    trend.consecutive_days_below_long_mean,
    analogs,
    thresholds,
  );

  return {
    date: targetDate,
    metric,
    current,
    baselines,
    position,
    trend,
    analogs,
    classification,
    errors,
  };
}

// ── fetchWellnessHistory ──────────────────────────────────────────────────────

interface WellnessApiRecord {
  id: string;
  hrv?: number | null;
  hrvSdnn?: number | null;
}

function authHeader(apiKey: string): string {
  return 'Basic ' + Buffer.from(`API_KEY:${apiKey}`).toString('base64');
}

export async function fetchWellnessHistory(
  config: IntervalsIcuConfig,
  oldest: string,
  newest: string,
): Promise<WellnessRecord[]> {
  const url =
    `https://intervals.icu/api/v1/athlete/${config.athlete_id}/wellness` +
    `?oldest=${oldest}&newest=${newest}`;
  const resp = await fetch(url, {
    headers: {
      Authorization: authHeader(config.api_key),
      Accept: 'application/json',
    },
  });
  if (!resp.ok) {
    throw new Error(`Intervals.icu wellness API returned ${resp.status}: ${resp.statusText}`);
  }
  const data: WellnessApiRecord[] = await resp.json();
  return data.map(r => ({
    date: r.id,
    hrv_rmssd: r.hrv ?? null,
    hrv_sdnn: r.hrvSdnn ?? null,
  }));
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function addDays(date: string, n: number): string {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function parseArgs(args: string[]): {
  configPath: string;
  targetDate: string;
  metric: MetricKey;
  shortWindowDays: number;
  longWindowDays: number;
  trendWindowDays: number;
  analogTolerance: number;
  analogDedupDays: number;
} {
  const flagValue = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
  };

  const configPath = flagValue('--config');
  if (!configPath) {
    process.stderr.write(
      'Usage: hrv-trend --config <path> [--date YYYY-MM-DD] [--metric hrv_rmssd|hrv_sdnn]\n' +
        '       [--short-window N] [--long-window N] [--trend-window N]\n' +
        '       [--analog-tolerance N] [--analog-dedup-days N]\n',
    );
    process.exit(1);
  }

  const todayStr = new Date().toISOString().split('T')[0];
  const targetDate = flagValue('--date') ?? todayStr;

  const metricRaw = flagValue('--metric') ?? 'hrv_rmssd';
  if (metricRaw !== 'hrv_rmssd' && metricRaw !== 'hrv_sdnn') {
    process.stderr.write(`Error: --metric must be hrv_rmssd or hrv_sdnn (got: ${metricRaw})\n`);
    process.exit(1);
  }

  return {
    configPath,
    targetDate,
    metric: metricRaw as MetricKey,
    shortWindowDays: Number(flagValue('--short-window') ?? 14),
    longWindowDays: Number(flagValue('--long-window') ?? 60),
    trendWindowDays: Number(flagValue('--trend-window') ?? 7),
    analogTolerance: Number(flagValue('--analog-tolerance') ?? 2),
    analogDedupDays: Number(flagValue('--analog-dedup-days') ?? 3),
  };
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectExecution) {
  const parsed = parseArgs(process.argv.slice(2));
  (async () => {
    try {
      const config = await loadConfig(parsed.configPath);
      const fetchDays = parsed.longWindowDays + 30;
      const oldest = addDays(parsed.targetDate, -fetchDays);
      const newest = parsed.targetDate;
      const wellness = await fetchWellnessHistory(config, oldest, newest);
      const result = analyzeHrvTrend({
        targetDate: parsed.targetDate,
        wellness,
        metric: parsed.metric,
        shortWindowDays: parsed.shortWindowDays,
        longWindowDays: parsed.longWindowDays,
        trendWindowDays: parsed.trendWindowDays,
        analogTolerance: parsed.analogTolerance,
        analogDedupDays: parsed.analogDedupDays,
      });
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  })();
}
