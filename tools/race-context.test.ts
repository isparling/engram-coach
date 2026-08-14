import { describe, it, expect } from 'vitest';
import { extractRaceContext } from './race-context.js';

describe('extractRaceContext', () => {
  it('extracts weather, elevation, and course from full payload', () => {
    const details = {
      id: '12345',
      name: 'Example Gravel Event',
      distance: 168000,
      moving_time: 25200,
      total_elevation_gain: 1840,
      max_grade: 11.2,
      weather_summary: { temp_c: 24, wind_kph: 18, conditions: 'partly cloudy' },
    };
    const result = extractRaceContext(details);
    expect(result.weather).toEqual({ temp_c: 24, wind_kph: 18, conditions: 'partly cloudy' });
    expect(result.elevation).toEqual({ gain_m: 1840, max_grade_pct: 11.2 });
    expect(result.course).toEqual({ name: 'Example Gravel Event', distance_km: 168, duration_sec: 25200 });
  });

  it('returns weather: null when weather_summary is absent', () => {
    const details = {
      id: '12345',
      name: 'Local Loop',
      distance: 50000,
      moving_time: 7200,
      total_elevation_gain: 400,
      max_grade: 6,
    };
    const result = extractRaceContext(details);
    expect(result.weather).toBeNull();
    expect(result.course.name).toBe('Local Loop');
  });

  it('handles missing elevation fields with zero defaults', () => {
    const details = {
      id: '12345',
      name: 'Flat ride',
      distance: 30000,
      moving_time: 3600,
    };
    const result = extractRaceContext(details);
    expect(result.elevation).toEqual({ gain_m: 0, max_grade_pct: 0 });
  });

  it('handles partial weather_summary', () => {
    const details = {
      id: '12345', name: 'X', distance: 1000, moving_time: 100,
      weather_summary: { temp_c: 20 },
    };
    const result = extractRaceContext(details);
    expect(result.weather).toEqual({ temp_c: 20, wind_kph: null, conditions: null });
  });
});
