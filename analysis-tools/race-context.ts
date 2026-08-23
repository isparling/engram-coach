import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';
import { loadConfig } from './stream-analyze.js';
import type { IntervalsIcuConfig } from './stream-analyze.js';

export interface RaceWeather {
  temp_c: number | null;
  wind_kph: number | null;
  conditions: string | null;
}

export interface RaceElevation {
  gain_m: number;
  max_grade_pct: number;
}

export interface RaceCourse {
  name: string;
  distance_km: number;
  duration_sec: number;
}

export interface RaceContext {
  weather: RaceWeather | null;
  elevation: RaceElevation;
  course: RaceCourse;
}

export function extractRaceContext(details: Record<string, unknown>): RaceContext {
  const ws = details.weather_summary as Record<string, unknown> | undefined;
  const weather: RaceWeather | null = ws
    ? {
        temp_c: typeof ws.temp_c === 'number' ? ws.temp_c : null,
        wind_kph: typeof ws.wind_kph === 'number' ? ws.wind_kph : null,
        conditions: typeof ws.conditions === 'string' ? ws.conditions : null,
      }
    : null;
  const elevation: RaceElevation = {
    gain_m: typeof details.total_elevation_gain === 'number' ? details.total_elevation_gain : 0,
    max_grade_pct: typeof details.max_grade === 'number' ? details.max_grade : 0,
  };
  const distanceM = typeof details.distance === 'number' ? details.distance : 0;
  const course: RaceCourse = {
    name: typeof details.name === 'string' ? details.name : '',
    distance_km: Math.round((distanceM / 1000) * 10) / 10,
    duration_sec: typeof details.moving_time === 'number' ? details.moving_time : 0,
  };
  return { weather, elevation, course };
}

export async function fetchActivityDetails(
  config: IntervalsIcuConfig,
  activityId: string,
): Promise<Record<string, unknown>> {
  const url = `https://intervals.icu/api/v1/activity/${activityId}`;
  const auth = 'Basic ' + Buffer.from(`API_KEY:${config.api_key}`).toString('base64');
  const resp = await fetch(url, { headers: { Authorization: auth, Accept: 'application/json' } });
  if (!resp.ok) {
    throw new Error(`Intervals.icu activity API returned ${resp.status}: ${resp.statusText}`);
  }
  return await resp.json();
}

function parseArgs(args: string[]): { activityId: string; configPath: string } {
  const flagValue = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
  };
  const activityId = flagValue('--activity-id');
  if (!activityId) {
    process.stderr.write('Usage: race-context --activity-id <id> [--config <path>]\n');
    process.exit(1);
  }
  const toolDir = dirname(fileURLToPath(import.meta.url));
  const configPath = flagValue('--config') ?? resolve(toolDir, '..', 'config.json');
  return { activityId, configPath };
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (isDirectExecution) {
  const parsed = parseArgs(process.argv.slice(2));
  (async () => {
    try {
      const config = await loadConfig(parsed.configPath);
      const details = await fetchActivityDetails(config, parsed.activityId);
      const context = extractRaceContext(details);
      process.stdout.write(JSON.stringify(context, null, 2) + '\n');
    } catch (err) {
      process.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(1);
    }
  })();
}
