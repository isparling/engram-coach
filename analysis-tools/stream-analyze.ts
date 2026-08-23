import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { readFile } from 'fs/promises';

// --- Interfaces ---

export interface IntervalsIcuConfig {
  api_key: string;
  athlete_id: string;
}

export interface IntervalBoundary {
  index: number;
  type: string;
  startIndex: number;
  endIndex: number;
}

export interface DecouplingResult {
  half1: { avg_watts: number; avg_hr: number; ef: number };
  half2: { avg_watts: number; avg_hr: number; ef: number };
  decoupling_pct: number;
}

export interface HrRecoveryInterval {
  index: number;
  end_hr: number;
  drop_60s: number | null;
  drop_120s: number | null;
}

export interface HrRecoveryResult {
  intervals: HrRecoveryInterval[];
  trend: 'improving' | 'stable' | 'declining';
}

export interface IntervalCvEntry {
  index: number;
  avg_watts: number;
  cv_pct: number;
}

export interface IntervalCvResult {
  intervals: IntervalCvEntry[];
}

export interface FadeSegment {
  label: string;
  np: number;
  avg_hr: number;
  ef: number;
  duration_sec: number;
}

export interface FadeResult {
  segments: FadeSegment[];
  np_slope_w_per_hr: number;
  ef_slope_per_hr: number;
  largest_drop: { from: string; to: string; np_delta_pct: number } | null;
}

export interface SegmentBoundary {
  start: number;
  end: number;
  label: string;
}

export interface ZoneThreshold {
  zone: string;
  max_pct_ftp: number;
}

export interface ZoneEntry {
  zone: string;
  pct: number;
  seconds: number;
}

export interface TimeInZoneResult {
  zones: ZoneEntry[];
}

export interface NpDistributionResult {
  np: number;
  avg: number;
  vi: number;
  p20: number;
  p50: number;
  p80: number;
  p95: number;
}

export interface LapBoundary {
  n: number;
  type: string;
  startIndex: number;
  endIndex: number;
}

export interface LapEntry {
  n: number;
  sec: number;
  avg_w: number;
  np: number;
  avg_hr: number;
  max_hr: number;
  is_rest: boolean;
}

export interface RegimeBreak {
  after_lap: number;
  delta_w: number;
  note: string;
}

export interface LapTrendsResult {
  laps: LapEntry[];
  power_slope_w_per_lap: number;
  hr_drift_bpm_per_lap: number;
  fastest_lap: { n: number; avg_w: number };
  slowest_lap: { n: number; avg_w: number };
  first_third_avg_w: number;
  middle_third_avg_w: number;
  last_third_avg_w: number;
  regime_breaks: RegimeBreak[];
}

export interface ActivitySummaryForCompare {
  activity_id: string;
  date: string;
  np: number;
  avg_hr: number;
  decoupling_pct: number;
  duration_sec: number;
}

export interface SimComparison {
  sim_activity_id: string;
  sim_date: string;
  np_delta_pct: number;
  hr_delta_bpm: number;
  decoupling_delta_pct: number;
  duration_delta_min: number;
}

export interface SimCompareResult {
  comparisons: SimComparison[];
}

export interface StreamAnalysisOutput {
  activity_id: string;
  duration_sec: number;
  analyses: {
    decoupling?: DecouplingResult;
    hr_recovery?: HrRecoveryResult;
    interval_cv?: IntervalCvResult;
    fade?: FadeResult;
    time_in_zone?: TimeInZoneResult;
    np_distribution?: NpDistributionResult;
    lap_trends?: LapTrendsResult;
    sim_compare?: SimCompareResult;
  };
  errors: Record<string, string>;
}

// --- Helpers ---

function round(n: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(n * factor) / factor;
}

function mean(arr: number[]): number {
  return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}

function stddev(arr: number[]): number {
  const avg = mean(arr);
  const variance = arr.reduce((sum, v) => sum + (v - avg) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

export function linearSlope(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 2) return 0;
  const xMean = mean(xs);
  const yMean = mean(ys);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - xMean) * (ys[i] - yMean);
    den += (xs[i] - xMean) ** 2;
  }
  return den > 0 ? num / den : 0;
}

function stripNulls(
  ...arrays: (number | null)[][]
): number[][] {
  const len = arrays[0].length;
  const indices: number[] = [];
  for (let i = 0; i < len; i++) {
    if (arrays.every((arr) => arr[i] !== null && arr[i] !== undefined)) {
      indices.push(i);
    }
  }
  return arrays.map((arr) => indices.map((i) => arr[i] as number));
}

function formatSec(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}:${m.toString().padStart(2, '0')}`;
}

function normalizedPower(watts: number[]): number {
  if (watts.length < 30) return mean(watts);
  const rolling: number[] = [];
  for (let i = 29; i < watts.length; i++) {
    let sum = 0;
    for (let j = i - 29; j <= i; j++) sum += watts[j];
    rolling.push(sum / 30);
  }
  const fourthPowers = rolling.map((v) => v ** 4);
  return Math.pow(mean(fourthPowers), 0.25);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

export function computeNpDistribution(rawWatts: (number | null)[]): NpDistributionResult {
  const watts = rawWatts.filter((v): v is number => v !== null && v !== undefined);
  if (watts.length === 0) {
    throw new Error('No watts data for NP distribution');
  }
  const np = normalizedPower(watts);
  const avg = mean(watts);
  const vi = avg > 0 ? np / avg : 0;
  const sorted = [...watts].sort((a, b) => a - b);
  return {
    np: round(np, 0),
    avg: round(avg, 1),
    vi: round(vi, 3),
    p20: round(percentile(sorted, 20), 0),
    p50: round(percentile(sorted, 50), 0),
    p80: round(percentile(sorted, 80), 0),
    p95: round(percentile(sorted, 95), 0),
  };
}

export function resolveFadeSegments(
  durationSec: number,
  mode: 'default' | number | number[],
): SegmentBoundary[] {
  if (Array.isArray(mode)) {
    const result: SegmentBoundary[] = [];
    for (let i = 0; i < mode.length - 1; i++) {
      result.push({
        start: mode[i],
        end: mode[i + 1],
        label: `${formatSec(mode[i])}–${formatSec(mode[i + 1])}`,
      });
    }
    return result;
  }
  let count: number;
  if (mode === 'default') {
    count = durationSec > 6 * 3600 ? Math.ceil(durationSec / 3600) : 4;
  } else {
    count = mode;
  }
  const segLen = Math.floor(durationSec / count);
  const result: SegmentBoundary[] = [];
  for (let i = 0; i < count; i++) {
    const start = i * segLen;
    const end = i === count - 1 ? durationSec : (i + 1) * segLen;
    result.push({ start, end, label: `${formatSec(start)}–${formatSec(end)}` });
  }
  return result;
}

export function computeFade(
  rawWatts: (number | null)[],
  rawHr: (number | null)[],
  segmentation: 'default' | number | number[] = 'default',
): FadeResult {
  const [watts, hr] = stripNulls(rawWatts, rawHr);
  const duration = watts.length;
  const boundaries = resolveFadeSegments(duration, segmentation);
  if (boundaries.length === 0 || boundaries.some((b) => b.end - b.start < 60)) {
    throw new Error(
      `Activity too short for fade segmentation (${duration}s, ${boundaries.length} segments)`,
    );
  }
  // Compute unrounded per-segment values
  const raw: { label: string; np: number; avgHr: number; ef: number; durationSec: number; midpointHr: number }[] = [];
  for (const b of boundaries) {
    const segWatts = watts.slice(b.start, b.end);
    const segHr = hr.slice(b.start, b.end);
    if (segWatts.length === 0) continue;
    const np = normalizedPower(segWatts);
    const avgHr = mean(segHr);
    const ef = avgHr > 0 ? np / avgHr : 0;
    raw.push({
      label: b.label,
      np,
      avgHr,
      ef,
      durationSec: segWatts.length,
      midpointHr: (b.start + b.end) / 2 / 3600,
    });
  }
  // Slopes via linear regression over midpoint hours
  const xs = raw.map((r) => r.midpointHr);
  const npSlope = linearSlope(xs, raw.map((r) => r.np));
  const efSlope = linearSlope(xs, raw.map((r) => r.ef));
  // Largest drop tracker — null until a negative delta is observed
  let largestDrop: { from: string; to: string; np_delta_pct: number } | null = null;
  for (let i = 1; i < raw.length; i++) {
    const prev = raw[i - 1];
    const cur = raw[i];
    const deltaPct = prev.np > 0 ? ((cur.np - prev.np) / prev.np) * 100 : 0;
    if (deltaPct < 0 && (largestDrop === null || deltaPct < largestDrop.np_delta_pct)) {
      largestDrop = { from: prev.label, to: cur.label, np_delta_pct: round(deltaPct, 1) };
    }
  }
  // Round at the final return
  const segments: FadeSegment[] = raw.map((r) => ({
    label: r.label,
    np: round(r.np, 0),
    avg_hr: round(r.avgHr, 0),
    ef: round(r.ef, 3),
    duration_sec: r.durationSec,
  }));
  return {
    segments,
    np_slope_w_per_hr: round(npSlope, 1),
    ef_slope_per_hr: round(efSlope, 4),
    largest_drop: largestDrop,
  };
}

export const DEFAULT_ZONE_THRESHOLDS: ZoneThreshold[] = [
  { zone: 'Z1', max_pct_ftp: 0.55 },
  { zone: 'Z2', max_pct_ftp: 0.75 },
  { zone: 'Z3', max_pct_ftp: 0.90 },
  { zone: 'Z4', max_pct_ftp: 1.05 },
  { zone: 'Z5', max_pct_ftp: 1.20 },
  { zone: 'Z6', max_pct_ftp: 1.50 },
  { zone: 'Z7', max_pct_ftp: Infinity },
];

export function computeTimeInZone(
  rawWatts: (number | null)[],
  ftp: number,
  zones: ZoneThreshold[] = DEFAULT_ZONE_THRESHOLDS,
): TimeInZoneResult {
  if (!Number.isFinite(ftp) || ftp <= 0) {
    throw new Error('FTP not available — cannot compute time in zone');
  }
  const watts = rawWatts.filter((v): v is number => v !== null && v !== undefined);
  const counts = new Map<string, number>();
  for (const z of zones) counts.set(z.zone, 0);
  for (const w of watts) {
    const pct = w / ftp;
    for (const z of zones) {
      if (pct <= z.max_pct_ftp) {
        counts.set(z.zone, (counts.get(z.zone) ?? 0) + 1);
        break;
      }
    }
  }
  const total = watts.length;
  const result: ZoneEntry[] = zones.map((z) => {
    const seconds = counts.get(z.zone) ?? 0;
    return {
      zone: z.zone,
      pct: total > 0 ? round((seconds / total) * 100, 1) : 0,
      seconds,
    };
  });
  return { zones: result };
}

// --- Config ---

export async function loadConfig(configPath: string): Promise<IntervalsIcuConfig> {
  const raw = await readFile(configPath, 'utf-8');
  const config = JSON.parse(raw);
  const icu = config.intervals_icu;
  if (!icu || typeof icu.api_key !== 'string' || typeof icu.athlete_id !== 'string') {
    throw new Error(
      `Missing or invalid intervals_icu config in ${configPath}. ` +
        'Expected { api_key: string, athlete_id: string }',
    );
  }
  if (icu.api_key === 'REPLACE_WITH_YOUR_API_KEY') {
    throw new Error(
      `intervals_icu.api_key in ${configPath} is still the placeholder value. ` +
        'Replace it with your actual Intervals.icu API key.',
    );
  }
  return { api_key: icu.api_key, athlete_id: icu.athlete_id };
}

// --- API ---

function authHeader(apiKey: string): string {
  return 'Basic ' + Buffer.from(`API_KEY:${apiKey}`).toString('base64');
}

export async function fetchStreams(
  config: IntervalsIcuConfig,
  activityId: string,
): Promise<{ watts: (number | null)[]; heartrate: (number | null)[] }> {
  const url = `https://intervals.icu/api/v1/activity/${activityId}/streams?types=watts,heartrate`;
  const resp = await fetch(url, {
    headers: { Authorization: authHeader(config.api_key), Accept: 'application/json' },
  });
  if (!resp.ok) {
    throw new Error(`Intervals.icu streams API returned ${resp.status}: ${resp.statusText}`);
  }
  const data = await resp.json();
  // Intervals.icu returns either an array of {type, data} stream objects,
  // or an object keyed by stream type. Handle both.
  const extract = (key: string): (number | null)[] => {
    if (Array.isArray(data)) {
      const entry = data.find((s: { type?: string }) => s?.type === key);
      if (!entry) return [];
      return Array.isArray(entry) ? entry : (entry.data ?? []);
    }
    const stream = data[key];
    if (!stream) return [];
    return Array.isArray(stream) ? stream : (stream.data ?? []);
  };
  return { watts: extract('watts'), heartrate: extract('heartrate') };
}

export async function fetchIntervals(
  config: IntervalsIcuConfig,
  activityId: string,
): Promise<IntervalBoundary[]> {
  const url = `https://intervals.icu/api/v1/activity/${activityId}/intervals`;
  const resp = await fetch(url, {
    headers: { Authorization: authHeader(config.api_key), Accept: 'application/json' },
  });
  if (!resp.ok) {
    throw new Error(`Intervals.icu intervals API returned ${resp.status}: ${resp.statusText}`);
  }
  const raw = await resp.json();
  const data: unknown[] = Array.isArray(raw) ? raw : (raw?.icu_intervals ?? []);
  let workIndex = 0;
  const intervals: IntervalBoundary[] = [];
  for (const item of data) {
    const rec = item as Record<string, unknown>;
    const type = String(rec.type ?? rec.label ?? '');
    if (type === 'WORK' || type === 'Work' || type === 'work') {
      workIndex++;
      intervals.push({
        index: workIndex,
        type: 'WORK',
        startIndex: Number(rec.start_index ?? rec.startIndex ?? 0),
        endIndex: Number(rec.end_index ?? rec.endIndex ?? 0),
      });
    }
  }
  return intervals;
}

export async function fetchAllIntervals(
  config: IntervalsIcuConfig,
  activityId: string,
): Promise<LapBoundary[]> {
  const url = `https://intervals.icu/api/v1/activity/${activityId}/intervals`;
  const resp = await fetch(url, {
    headers: { Authorization: authHeader(config.api_key), Accept: 'application/json' },
  });
  if (!resp.ok) {
    throw new Error(`Intervals.icu intervals API returned ${resp.status}: ${resp.statusText}`);
  }
  const raw = await resp.json();
  const data: unknown[] = Array.isArray(raw) ? raw : (raw?.icu_intervals ?? []);
  return data.map((item, i) => {
    const rec = item as Record<string, unknown>;
    return {
      n: i + 1,
      type: String(rec.type ?? rec.label ?? 'WORK').toUpperCase(),
      startIndex: Number(rec.start_index ?? rec.startIndex ?? 0),
      endIndex: Number(rec.end_index ?? rec.endIndex ?? 0),
    };
  });
}

export function classifyRestLaps(
  rawWatts: (number | null)[],
  rawHr: (number | null)[],
  laps: LapBoundary[],
  ftp: number,
): boolean[] {
  return laps.map((lap) => {
    const wSlice = rawWatts
      .slice(lap.startIndex, lap.endIndex + 1)
      .filter((v): v is number => v !== null && v !== undefined);
    const hrSlice = rawHr
      .slice(lap.startIndex, lap.endIndex + 1)
      .filter((v): v is number => v !== null && v !== undefined);
    const avgW = wSlice.length > 0 ? mean(wSlice) : 0;
    const explicitRest = lap.type === 'REST' || lap.type === 'RECOVERY';
    let autoRest = false;
    if (Number.isFinite(ftp) && ftp > 0 && avgW / ftp < 0.4 && hrSlice.length >= 60) {
      const firstHalf = mean(hrSlice.slice(0, Math.floor(hrSlice.length / 2)));
      const secondHalf = mean(hrSlice.slice(Math.floor(hrSlice.length / 2)));
      autoRest = secondHalf < firstHalf - 5;
    }
    return explicitRest || autoRest;
  });
}

export function filterStreamsByRestLaps(
  rawWatts: (number | null)[],
  rawHr: (number | null)[],
  laps: LapBoundary[],
  isRestFlags: boolean[],
): { watts: (number | null)[]; hr: (number | null)[] } {
  const workingIndices: number[] = [];
  for (let i = 0; i < laps.length; i++) {
    if (!isRestFlags[i]) {
      for (let j = laps[i].startIndex; j <= laps[i].endIndex; j++) {
        workingIndices.push(j);
      }
    }
  }
  return {
    watts: workingIndices.map((i) => rawWatts[i] ?? null),
    hr: workingIndices.map((i) => rawHr[i] ?? null),
  };
}

export function computeLapTrends(
  rawWatts: (number | null)[],
  rawHr: (number | null)[],
  laps: LapBoundary[],
  ftp: number,
): LapTrendsResult {
  if (laps.length === 0) {
    throw new Error('No laps found for lap-trends analysis');
  }
  const isRestFlags = classifyRestLaps(rawWatts, rawHr, laps, ftp);
  const lapEntries: LapEntry[] = [];
  for (let i = 0; i < laps.length; i++) {
    const lap = laps[i];
    const wSlice = rawWatts
      .slice(lap.startIndex, lap.endIndex + 1)
      .filter((v): v is number => v !== null && v !== undefined);
    const hrSlice = rawHr
      .slice(lap.startIndex, lap.endIndex + 1)
      .filter((v): v is number => v !== null && v !== undefined);
    if (wSlice.length === 0) continue;
    const avgW = mean(wSlice);
    const np = normalizedPower(wSlice);
    const avgHr = hrSlice.length > 0 ? mean(hrSlice) : 0;
    const maxHr = hrSlice.length > 0 ? Math.max(...hrSlice) : 0;
    lapEntries.push({
      n: lap.n,
      sec: lap.endIndex - lap.startIndex + 1,
      avg_w: round(avgW, 0),
      np: round(np, 0),
      avg_hr: round(avgHr, 0),
      max_hr: round(maxHr, 0),
      is_rest: isRestFlags[i],
    });
  }
  const workLaps = lapEntries.filter((l) => !l.is_rest);
  if (workLaps.length === 0) {
    throw new Error('No non-rest laps found for trends');
  }
  const xs = workLaps.map((_, i) => i);
  const powerSlope = linearSlope(xs, workLaps.map((l) => l.avg_w));
  const hrSlope = linearSlope(xs, workLaps.map((l) => l.avg_hr));
  const fastest = workLaps.reduce((a, b) => (a.avg_w > b.avg_w ? a : b));
  const slowest = workLaps.reduce((a, b) => (a.avg_w < b.avg_w ? a : b));
  const totalSec = workLaps.reduce((s, l) => s + l.sec, 0);
  const thirdSec = totalSec / 3;
  const thirds: number[][] = [[], [], []];
  let cumSec = 0;
  for (const lap of workLaps) {
    const tIdx = cumSec < thirdSec ? 0 : cumSec < 2 * thirdSec ? 1 : 2;
    thirds[tIdx].push(lap.avg_w);
    cumSec += lap.sec;
  }
  const regimeBreaks: RegimeBreak[] = [];
  for (let i = 3; i < workLaps.length; i++) {
    const trailing = (workLaps[i - 1].avg_w + workLaps[i - 2].avg_w + workLaps[i - 3].avg_w) / 3;
    const cur = workLaps[i].avg_w;
    if (trailing > 0 && (cur - trailing) / trailing < -0.1) {
      regimeBreaks.push({
        after_lap: workLaps[i - 1].n,
        delta_w: round(cur - trailing, 0),
        note: 'sustained drop',
      });
    }
  }
  return {
    laps: lapEntries,
    power_slope_w_per_lap: round(powerSlope, 1),
    hr_drift_bpm_per_lap: round(hrSlope, 2),
    fastest_lap: { n: fastest.n, avg_w: fastest.avg_w },
    slowest_lap: { n: slowest.n, avg_w: slowest.avg_w },
    first_third_avg_w: thirds[0].length > 0 ? round(mean(thirds[0]), 0) : 0,
    middle_third_avg_w: thirds[1].length > 0 ? round(mean(thirds[1]), 0) : 0,
    last_third_avg_w: thirds[2].length > 0 ? round(mean(thirds[2]), 0) : 0,
    regime_breaks: regimeBreaks,
  };
}

// --- Compute functions ---

const MIN_DECOUPLING_SAMPLES = 2700; // 45 min at 1 Hz

export function computeDecoupling(
  rawWatts: (number | null)[],
  rawHr: (number | null)[],
): DecouplingResult {
  const [watts, hr] = stripNulls(rawWatts, rawHr);
  if (watts.length < MIN_DECOUPLING_SAMPLES) {
    throw new Error(
      `Session too short for decoupling: ${watts.length}s (need ${MIN_DECOUPLING_SAMPLES}s / 45 min)`,
    );
  }
  const half = Math.floor(watts.length / 2);
  const w1 = watts.slice(0, half);
  const hr1 = hr.slice(0, half);
  const w2 = watts.slice(half);
  const hr2 = hr.slice(half);

  const avgW1 = mean(w1);
  const avgHr1 = mean(hr1);
  const avgW2 = mean(w2);
  const avgHr2 = mean(hr2);

  const ef1 = avgHr1 > 0 ? avgW1 / avgHr1 : 0;
  const ef2 = avgHr2 > 0 ? avgW2 / avgHr2 : 0;
  const decoupling = ef1 > 0 ? ((ef1 - ef2) / ef1) * 100 : 0;

  return {
    half1: { avg_watts: round(avgW1, 1), avg_hr: round(avgHr1, 1), ef: round(ef1, 3) },
    half2: { avg_watts: round(avgW2, 1), avg_hr: round(avgHr2, 1), ef: round(ef2, 3) },
    decoupling_pct: round(decoupling, 2),
  };
}

export function computeHrRecovery(
  rawHr: (number | null)[],
  intervals: IntervalBoundary[],
): HrRecoveryResult {
  if (intervals.length === 0) {
    throw new Error('No work intervals found for HR recovery analysis');
  }

  const results: HrRecoveryInterval[] = [];
  for (const interval of intervals) {
    const endIdx = interval.endIndex;
    const endHr = rawHr[endIdx];
    if (endHr === null || endHr === undefined) continue;

    const hr60 = endIdx + 60 < rawHr.length ? rawHr[endIdx + 60] : null;
    const hr120 = endIdx + 120 < rawHr.length ? rawHr[endIdx + 120] : null;

    results.push({
      index: interval.index,
      end_hr: round(endHr, 0),
      drop_60s: hr60 !== null && hr60 !== undefined ? round(endHr - hr60, 0) : null,
      drop_120s: hr120 !== null && hr120 !== undefined ? round(endHr - hr120, 0) : null,
    });
  }

  let trend: 'improving' | 'stable' | 'declining' = 'stable';
  if (results.length >= 2) {
    const first = results[0].drop_60s;
    const last = results[results.length - 1].drop_60s;
    if (first !== null && last !== null) {
      const diff = last - first;
      if (diff > 3) trend = 'improving';
      else if (diff < -3) trend = 'declining';
    }
  }

  return { intervals: results, trend };
}

export function computeIntervalCv(
  rawWatts: (number | null)[],
  intervals: IntervalBoundary[],
): IntervalCvResult {
  if (intervals.length === 0) {
    throw new Error('No work intervals found for interval CV analysis');
  }

  const results: IntervalCvEntry[] = [];
  for (const interval of intervals) {
    const slice = rawWatts
      .slice(interval.startIndex, interval.endIndex + 1)
      .filter((v): v is number => v !== null && v !== undefined);

    if (slice.length === 0) continue;

    const avg = mean(slice);
    const cv = avg > 0 ? (stddev(slice) / avg) * 100 : 0;

    results.push({
      index: interval.index,
      avg_watts: round(avg, 1),
      cv_pct: round(cv, 1),
    });
  }

  return { intervals: results };
}

// --- Orchestrator ---

const KNOWN_ANALYSES = [
  'decoupling',
  'hr_recovery',
  'interval_cv',
  'fade',
  'time_in_zone',
  'np_distribution',
  'lap_trends',
  'sim_compare',
] as const;
type AnalysisKey = (typeof KNOWN_ANALYSES)[number];

export interface AnalyzeOptions {
  fadeSegmentation?: 'default' | number | number[];
  ftp?: number;
  zones?: ZoneThreshold[];
  laps?: LapBoundary[];
  simCompareTarget?: ActivitySummaryForCompare;
  simCompareSims?: ActivitySummaryForCompare[];
  movingOnly?: boolean;
}

export async function analyzeStreams(
  config: IntervalsIcuConfig,
  activityId: string,
  analyses: string[],
  options: AnalyzeOptions = {},
): Promise<StreamAnalysisOutput> {
  const output: StreamAnalysisOutput = {
    activity_id: activityId,
    duration_sec: 0,
    analyses: {},
    errors: {},
  };

  const needsStreams = analyses.some((a) =>
    ['decoupling', 'hr_recovery', 'interval_cv', 'fade', 'time_in_zone', 'np_distribution', 'lap_trends'].includes(a),
  );
  const needsIntervals = analyses.some((a) => ['hr_recovery', 'interval_cv'].includes(a));
  const needsAllLaps = analyses.includes('lap_trends') || options.movingOnly;

  let streams: { watts: (number | null)[]; heartrate: (number | null)[] } | null = null;
  let filteredStreams: { watts: (number | null)[]; hr: (number | null)[] } | null = null;
  let intervals: IntervalBoundary[] | null = null;
  let allLaps: LapBoundary[] | null = options.laps ?? null;

  if (needsStreams) {
    try {
      streams = await fetchStreams(config, activityId);
      output.duration_sec = Math.max(streams.watts.length, streams.heartrate.length);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      for (const a of analyses) output.errors[a] = `Stream fetch failed: ${msg}`;
      return output;
    }
  }

  if (needsIntervals) {
    try {
      intervals = await fetchIntervals(config, activityId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      for (const a of analyses) {
        if (['hr_recovery', 'interval_cv'].includes(a)) {
          output.errors[a] = `Interval fetch failed: ${msg}`;
        }
      }
    }
  }

  if (needsAllLaps && !allLaps) {
    try {
      allLaps = await fetchAllIntervals(config, activityId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (analyses.includes('lap_trends')) output.errors['lap_trends'] = `Lap fetch failed: ${msg}`;
      if (options.movingOnly) {
        for (const a of analyses) {
          if (['decoupling', 'fade', 'time_in_zone', 'np_distribution'].includes(a)) {
            output.errors[a] = `Lap fetch failed (required for --moving-only): ${msg}`;
          }
        }
      }
    }
  }

  if (options.movingOnly && streams && allLaps && !filteredStreams) {
    const isRestFlags = classifyRestLaps(streams.watts, streams.heartrate, allLaps, options.ftp ?? 0);
    filteredStreams = filterStreamsByRestLaps(streams.watts, streams.heartrate, allLaps, isRestFlags);
    if (filteredStreams.watts.length === 0) {
      for (const a of analyses) {
        if (['decoupling', 'fade', 'time_in_zone', 'np_distribution'].includes(a)) {
          output.errors[a] = 'No non-rest data found for --moving-only';
        }
      }
    }
  }

  for (const analysis of analyses as AnalysisKey[]) {
    if (output.errors[analysis]) continue;

    try {
      switch (analysis) {
        case 'decoupling': {
          const s = options.movingOnly ? filteredStreams : (streams ? { watts: streams.watts, hr: streams.heartrate } : null);
          if (!s) { output.errors[analysis] = 'No stream data'; break; }
          output.analyses.decoupling = computeDecoupling(s.watts, s.hr);
          break;
        }

        case 'hr_recovery':
          if (!streams) { output.errors[analysis] = 'No stream data'; break; }
          if (!intervals) { output.errors[analysis] = 'No interval data'; break; }
          output.analyses.hr_recovery = computeHrRecovery(streams.heartrate, intervals);
          break;

        case 'interval_cv':
          if (!streams) { output.errors[analysis] = 'No stream data'; break; }
          if (!intervals) { output.errors[analysis] = 'No interval data'; break; }
          output.analyses.interval_cv = computeIntervalCv(streams.watts, intervals);
          break;

        case 'fade': {
          const s = options.movingOnly ? filteredStreams : (streams ? { watts: streams.watts, hr: streams.heartrate } : null);
          if (!s) { output.errors[analysis] = 'No stream data'; break; }
          output.analyses.fade = computeFade(s.watts, s.hr, options.fadeSegmentation);
          break;
        }

        case 'time_in_zone': {
          const s = options.movingOnly ? filteredStreams : (streams ? { watts: streams.watts, hr: streams.heartrate } : null);
          if (!s) { output.errors[analysis] = 'No stream data'; break; }
          if (!options.ftp || options.ftp <= 0) { output.errors[analysis] = 'ftp not available'; break; }
          output.analyses.time_in_zone = computeTimeInZone(s.watts, options.ftp, options.zones);
          break;
        }

        case 'np_distribution': {
          const s = options.movingOnly ? filteredStreams : (streams ? { watts: streams.watts, hr: streams.heartrate } : null);
          if (!s) { output.errors[analysis] = 'No stream data'; break; }
          output.analyses.np_distribution = computeNpDistribution(s.watts);
          break;
        }

        case 'lap_trends':
          if (!streams) { output.errors[analysis] = 'No stream data'; break; }
          if (!allLaps) { output.errors[analysis] = 'No lap data'; break; }
          if (!options.ftp || options.ftp <= 0) { output.errors[analysis] = 'ftp not available'; break; }
          output.analyses.lap_trends = computeLapTrends(streams.watts, streams.heartrate, allLaps, options.ftp);
          break;

        case 'sim_compare':
          if (!options.simCompareTarget) { output.errors[analysis] = 'sim compare target not provided'; break; }
          output.analyses.sim_compare = computeSimCompare(options.simCompareTarget, options.simCompareSims ?? []);
          break;
      }
    } catch (err) {
      output.errors[analysis] = err instanceof Error ? err.message : String(err);
    }
  }

  return output;
}

// --- computeSimCompare ---

export function computeSimCompare(
  target: ActivitySummaryForCompare,
  sims: ActivitySummaryForCompare[],
): SimCompareResult {
  const comparisons: SimComparison[] = sims.map((sim) => ({
    sim_activity_id: sim.activity_id,
    sim_date: sim.date,
    np_delta_pct: sim.np > 0 ? round(((target.np - sim.np) / sim.np) * 100, 1) : 0,
    hr_delta_bpm: round(target.avg_hr - sim.avg_hr, 0),
    decoupling_delta_pct: round(target.decoupling_pct - sim.decoupling_pct, 1),
    duration_delta_min: round((target.duration_sec - sim.duration_sec) / 60, 0),
  }));
  return { comparisons };
}

// --- CLI ---

export type StreamAnalyzeCliArgs = {
  activityId: string;
  analyses: string[];
  configPath: string;
  fadeSegmentation: 'default' | number | number[];
  ftp?: number;
  movingOnly: boolean;
  simCompareTargetPath?: string;
  simCompareSimsPath?: string;
};

export function parseStreamAnalyzeArgs(args: string[]): StreamAnalyzeCliArgs {
  const flagValue = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
  };

  const activityId = flagValue('--activity-id');
  const analysesRaw = flagValue('--analyses');

  if (!activityId || !analysesRaw) {
    process.stderr.write(
      'Usage: stream-analyze --activity-id <id> --analyses <a1,a2,...> [--config <path>]\n' +
        '       [--fade-segments <N|t1,t2,...>] [--ftp-override <watts>] [--moving-only]\n' +
        '       [--sim-compare-target <path.json>] [--sim-compare-sims <path.json>]\n' +
        `  Available analyses: ${KNOWN_ANALYSES.join(', ')}\n`,
    );
    process.exit(1);
  }

  const analyses = analysesRaw.split(',');
  const unknown = analyses.filter((a) => !(KNOWN_ANALYSES as readonly string[]).includes(a));
  if (unknown.length > 0) {
    process.stderr.write(
      `Unknown analyses: ${unknown.join(', ')}\n  Available: ${KNOWN_ANALYSES.join(', ')}\n`,
    );
    process.exit(1);
  }

  const toolDir = dirname(fileURLToPath(import.meta.url));
  const configPath = flagValue('--config') ?? resolve(toolDir, '..', 'config.json');

  const fadeRaw = flagValue('--fade-segments');
  let fadeSegmentation: 'default' | number | number[] = 'default';
  if (fadeRaw) {
    if (fadeRaw.includes(',')) {
      fadeSegmentation = fadeRaw.split(',').map((s) => Number(s));
    } else {
      const n = Number(fadeRaw);
      if (!Number.isNaN(n)) fadeSegmentation = n;
    }
  }

  const ftpRaw = flagValue('--ftp-override');
  const ftp = ftpRaw ? Number(ftpRaw) : undefined;

  const movingOnly = args.includes('--moving-only');

  return {
    activityId,
    analyses,
    configPath,
    fadeSegmentation,
    ftp,
    movingOnly,
    simCompareTargetPath: flagValue('--sim-compare-target'),
    simCompareSimsPath: flagValue('--sim-compare-sims'),
  };
}

// Only run CLI when executed directly (not imported)
const isDirectExecution =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectExecution) {
  const parsed = parseStreamAnalyzeArgs(process.argv.slice(2));
  (async () => {
    try {
      const config = await loadConfig(parsed.configPath);
      const options: AnalyzeOptions = {
        fadeSegmentation: parsed.fadeSegmentation,
        ftp: parsed.ftp,
        movingOnly: parsed.movingOnly,
      };
      if (parsed.simCompareTargetPath) {
        const raw = await readFile(parsed.simCompareTargetPath, 'utf-8');
        options.simCompareTarget = JSON.parse(raw);
      }
      if (parsed.simCompareSimsPath) {
        const raw = await readFile(parsed.simCompareSimsPath, 'utf-8');
        options.simCompareSims = JSON.parse(raw);
      }
      const result = await analyzeStreams(config, parsed.activityId, parsed.analyses, options);
      process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  })();
}
