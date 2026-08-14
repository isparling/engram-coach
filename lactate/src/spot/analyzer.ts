import { LactatePoint, SpotReading, SpotComparison, SpotTestAnalysis, ConfidenceLevel } from '../types';
import { detectAllMethods } from '../analysis/methods';

export class SpotTestAnalyzer {
  analyzeSpotReading(
    baselinePoints: LactatePoint[],
    currentReading: { power: number; heartrate: number; lactate: number },
    expectedPower?: number
  ): SpotReading {
    const sorted = [...baselinePoints].sort((a, b) => a.power - b.power);
    
    const expectedLactate = expectedPower 
      ? this.interpolateLactate(sorted, expectedPower)
      : this.interpolateLactateAtPower(sorted, currentReading.power);
    
    const delta = currentReading.lactate - (expectedLactate || 2.5);
    
    return {
      power: currentReading.power,
      heartrate: currentReading.heartrate,
      lactate: currentReading.lactate,
      expectedLactate: expectedLactate || undefined,
      deltaFromExpected: Math.round(delta * 10) / 10
    };
  }

  compareToBaseline(
    baselinePoints: LactatePoint[],
    readings: { power: number; heartrate: number; lactate: number }[],
    baselineLt2?: number
  ): SpotTestAnalysis {
    if (baselinePoints.length < 3) {
      return {
        readings: [],
        comparisonToBaseline: {
          baselineLt2: baselineLt2 || 0,
          currentReading: 0,
          delta: 0,
          interpretation: 'Insufficient baseline data'
        },
        trend: 'stable',
        confidence: 'low'
      };
    }

    const detection = detectAllMethods(baselinePoints);
    const baselineLt2Power = baselineLt2 || detection.lt2?.power || 0;

    const spotReadings: SpotReading[] = readings.map(r => 
      this.analyzeSpotReading(baselinePoints, r)
    );

    const avgLactate = readings.reduce((sum, r) => sum + r.lactate, 0) / readings.length;
    const avgPower = readings.reduce((sum, r) => sum + r.power, 0) / readings.length;
    
    const expectedLactateAtPower = this.interpolateLactateAtPower(baselinePoints, avgPower);
    const delta = avgLactate - (expectedLactateAtPower || 2.5);

    let interpretation: string;
    let trend: 'improving' | 'stable' | 'declining';
    
    if (delta < -0.5) {
      interpretation = `Lactate ${Math.abs(delta).toFixed(1)} mmol/L below expected at ${avgPower}W — indicates improved aerobic efficiency since baseline test`;
      trend = 'improving';
    } else if (delta > 1.0) {
      interpretation = `Lactate ${delta.toFixed(1)} mmol/L above expected at ${avgPower}W — lactate clearance may be compromised, monitor`;
      trend = 'declining';
    } else if (delta > 0.5) {
      interpretation = `Lactate ${delta.toFixed(1)} mmol/L slightly elevated at ${avgPower}W — slight deviation from baseline`;
      trend = 'stable';
    } else {
      interpretation = `Lactate within expected range at ${avgPower}W — stable aerobic function relative to baseline`;
      trend = 'stable';
    }

    let confidence: ConfidenceLevel;
    if (readings.length >= 2 && Math.abs(delta) < 0.5) {
      confidence = 'high';
    } else if (readings.length >= 1 && baselinePoints.length >= 5) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    const comparison: SpotComparison = {
      baselineLt2: baselineLt2Power,
      currentReading: Math.round(avgLactate * 10) / 10,
      delta: Math.round(delta * 10) / 10,
      interpretation
    };

    return {
      readings: spotReadings,
      comparisonToBaseline: comparison,
      trend,
      confidence
    };
  }

  analyzeTrend(
    spotTests: { date: string; readings: { power: number; heartrate: number; lactate: number }[] }[]
  ): { trend: 'improving' | 'stable' | 'declining'; delta: number; interpretation: string } {
    if (spotTests.length < 2) {
      return {
        trend: 'stable',
        delta: 0,
        interpretation: 'Need at least 2 spot tests to determine trend'
      };
    }

    const earliest = spotTests[0];
    const latest = spotTests[spotTests.length - 1];

    const avgLactateEarliest = earliest.readings.reduce((sum, r) => sum + r.lactate, 0) / earliest.readings.length;
    const avgLactateLatest = latest.readings.reduce((sum, r) => sum + r.lactate, 0) / latest.readings.length;

    const avgPowerEarliest = earliest.readings.reduce((sum, r) => sum + r.power, 0) / earliest.readings.length;
    const avgPowerLatest = latest.readings.reduce((sum, r) => sum + r.power, 0) / latest.readings.length;

    const powerNormalizedDelta = (avgLactateLatest - avgLactateEarliest) / ((avgPowerLatest + avgPowerEarliest) / 2) * 100;

    const delta = Math.round((avgLactateLatest - avgLactateEarliest) * 10) / 10;

    let trend: 'improving' | 'stable' | 'declining';
    let interpretation: string;

    if (powerNormalizedDelta < -10) {
      trend = 'improving';
      interpretation = `Lactate decreased by ${Math.abs(delta).toFixed(1)} mmol/L over ${spotTests.length} spot tests — clear aerobic improvement`;
    } else if (powerNormalizedDelta > 10) {
      trend = 'declining';
      interpretation = `Lactate increased by ${delta.toFixed(1)} mmol/L over ${spotTests.length} spot tests — monitor for detraining or fatigue`;
    } else {
      trend = 'stable';
      interpretation = `Lactate stable across ${spotTests.length} spot tests — no significant change in aerobic function`;
    }

    return { trend, delta, interpretation };
  }

  private interpolateLactateAtPower(points: LactatePoint[], targetPower: number): number | null {
    const sorted = [...points].sort((a, b) => a.power - b.power);
    return this.interpolateLactate(sorted, targetPower);
  }

  private interpolateLactate(points: LactatePoint[], targetPower: number): number | null {
    if (points.length < 2) return null;
    
    if (targetPower <= points[0].power) return points[0].lactate;
    if (targetPower >= points[points.length - 1].power) return points[points.length - 1].lactate;
    
    for (let i = 0; i < points.length - 1; i++) {
      if (points[i].power <= targetPower && points[i + 1].power >= targetPower) {
        const ratio = (targetPower - points[i].power) / (points[i + 1].power - points[i].power);
        return points[i].lactate + ratio * (points[i + 1].lactate - points[i].lactate);
      }
    }
    
    return null;
  }
}

export function createSpotTestAnalyzer(): SpotTestAnalyzer {
  return new SpotTestAnalyzer();
}
