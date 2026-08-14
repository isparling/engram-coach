import { LactateTest, LactateAnalysis, DerivedThreshold, DataQuality, ConfidenceLevel, SpotReading, SpotComparison, ThresholdResult, LactatePoint, SpotTestAnalysis } from '../types';
import { detectAllMethods } from './methods';
import { computeConfidenceIntervals } from './confidence';
import { assessDataQuality, applyQualityAdjustment } from './quality';

export class LactateAnalyzer {
  private athleteId: string;

  constructor(athleteId: string) {
    this.athleteId = athleteId;
  }

  analyze(test: LactateTest): LactateAnalysis {
    const points = test.data;
    const qualityReport = assessDataQuality(points);

    const detection = detectAllMethods(points);

    const lt1 = this.enrichWithCI(detection.lt1, points, qualityReport.quality);
    const lt2 = this.enrichWithCI(detection.lt2, points, qualityReport.quality);

    const ftp = this.computeFTP(lt2, qualityReport.quality);
    const fthr = this.computeFTHR(lt2, qualityReport.quality);

    const methodsUsed = this.getMethodsUsed(detection);

    const analysis: LactateAnalysis = {
      athleteId: this.athleteId,
      testId: test.id,
      testType: test.testType,
      testDate: test.testDate,
      sport: test.sport,
      lt1: lt1 || this.emptyThreshold('lt1'),
      lt2: lt2 || this.emptyThreshold('lt2'),
      ftp,
      fthr,
      testQuality: qualityReport.quality,
      confidence: qualityReport.confidence,
      methodsUsed,
      dataQualityNotes: qualityReport.issues
    };

    return analysis;
  }

  private enrichWithCI(
    result: ThresholdResult | null,
    points: LactatePoint[],
    quality: DataQuality
  ): ThresholdResult | null {
    if (!result) return null;

    if (!result.method) return result;

    const ci = computeConfidenceIntervals(points, result.method);

    const adjustedCi80 = applyQualityAdjustment(ci.ci80, quality);
    const adjustedCi95 = applyQualityAdjustment(ci.ci95, quality);

    return {
      ...result,
      ci80: adjustedCi80,
      ci95: adjustedCi95
    };
  }

  private computeFTP(
    lt2: ThresholdResult | null,
    quality: DataQuality
  ): DerivedThreshold | null {
    if (!lt2 || !lt2.power) return null;

    const baseFtp = lt2.power * 0.95;

    let rangeMultiplier = 1.0;
    if (quality === 'marginal') rangeMultiplier = 1.15;
    if (quality === 'poor') rangeMultiplier = 1.25;

    const uncertainty = baseFtp * 0.03 * rangeMultiplier;

    return {
      value: Math.round(baseFtp),
      ci80: [
        Math.round(baseFtp - uncertainty),
        Math.round(baseFtp + uncertainty)
      ],
      ci95: [
        Math.round(baseFtp - uncertainty * 1.5),
        Math.round(baseFtp + uncertainty * 1.5)
      ],
      method: 'lt2-derived'
    };
  }

  private computeFTHR(
    lt2: ThresholdResult | null,
    quality: DataQuality
  ): DerivedThreshold | null {
    if (!lt2 || !lt2.heartrate) return null;

    const baseFthr = lt2.heartrate;

    let rangeMultiplier = 1.0;
    if (quality === 'marginal') rangeMultiplier = 1.2;
    if (quality === 'poor') rangeMultiplier = 1.4;

    const uncertainty = 3 * rangeMultiplier;

    return {
      value: Math.round(baseFthr),
      ci80: [
        Math.round(baseFthr - uncertainty),
        Math.round(baseFthr + uncertainty)
      ],
      ci95: [
        Math.round(baseFthr - uncertainty * 1.5),
        Math.round(baseFthr + uncertainty * 1.5)
      ],
      method: 'lt2-hr'
    };
  }

  private getMethodsUsed(detection: { lt1: ThresholdResult | null; lt2: ThresholdResult | null }): string[] {
    const methods: string[] = [];
    
    if (detection.lt1?.method) methods.push(detection.lt1.method);
    if (detection.lt2?.method && !methods.includes(detection.lt2.method)) {
      methods.push(detection.lt2.method);
    }
    
    return methods;
  }

  private emptyThreshold(target: 'lt1' | 'lt2'): ThresholdResult {
    return {
      power: null,
      heartrate: null,
      lactate: null,
      ci80: null,
      ci95: null,
      method: 'none',
      methodType: 'fallback'
    };
  }

  analyzeSpotTest(
    baselineLt2: number,
    readings: { power: number; heartrate: number; lactate: number }[],
    baselineLt1?: number
  ): SpotTestAnalysis {
    const spotReadings: SpotReading[] = readings.map(r => ({
      power: r.power,
      heartrate: r.heartrate,
      lactate: r.lactate
    }));

    const avgLactate = readings.reduce((sum, r) => sum + r.lactate, 0) / readings.length;
    const avgPower = readings.reduce((sum, r) => sum + r.power, 0) / readings.length;

    const delta = avgLactate - 2.5;

    let interpretation: string;
    let trend: 'improving' | 'stable' | 'declining';
    
    if (delta < -0.5) {
      interpretation = `Lactate ${delta.toFixed(1)} mmol/L below expected at ${avgPower}W - indicates improved aerobic efficiency`;
      trend = 'improving';
    } else if (delta > 1.0) {
      interpretation = `Lactate ${delta.toFixed(1)} mmol/L above expected at ${avgPower}W - lactate clearance may be compromised`;
      trend = 'declining';
    } else {
      interpretation = `Lactate within expected range at ${avgPower}W - stable aerobic function`;
      trend = 'stable';
    }

    let confidence: ConfidenceLevel;
    if (readings.length >= 2 && Math.abs(delta) < 0.5) {
      confidence = 'high';
    } else if (readings.length >= 1) {
      confidence = 'medium';
    } else {
      confidence = 'low';
    }

    const comparison: SpotComparison = {
      baselineLt2,
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

  compareToHistorical(
    current: LactateAnalysis,
    previous: LactateAnalysis | null
  ): { lt2Delta: number | null; ftpDelta: number | null; fthrDelta: number | null; interpretation: string } {
    if (!previous) {
      return {
        lt2Delta: null,
        ftpDelta: null,
        fthrDelta: null,
        interpretation: 'No previous test for comparison'
      };
    }

    const lt2Delta = current.lt2.power !== null && previous.lt2.power !== null
      ? current.lt2.power - previous.lt2.power
      : null;

    const ftpDelta = current.ftp !== null && previous.ftp !== null
      ? current.ftp.value - previous.ftp.value
      : null;

    const fthrDelta = current.fthr !== null && previous.fthr !== null
      ? current.fthr.value - previous.fthr.value
      : null;

    let interpretation = '';
    if (lt2Delta !== null) {
      if (lt2Delta > 5) {
        interpretation = `LT2 improved by ${lt2Delta}W - meaningful aerobic adaptation`;
      } else if (lt2Delta < -5) {
        interpretation = `LT2 decreased by ${Math.abs(lt2Delta)}W - monitor for detraining or fatigue`;
      } else {
        interpretation = `LT2 stable (${lt2Delta > 0 ? '+' : ''}${lt2Delta}W)`;
      }
    }

    return { lt2Delta, ftpDelta, fthrDelta, interpretation };
  }
}

export function createAnalyzer(athleteId: string): LactateAnalyzer {
  return new LactateAnalyzer(athleteId);
}
