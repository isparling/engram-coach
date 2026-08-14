import { LactatePoint, DataQuality, ConfidenceLevel } from '../types';

export interface QualityReport {
  quality: DataQuality;
  confidence: ConfidenceLevel;
  issues: string[];
  score: number;
}

export function assessDataQuality(points: LactatePoint[]): QualityReport {
  const issues: string[] = [];
  let score = 100;

  if (points.length < 4) {
    issues.push('Insufficient data points for reliable analysis');
    score -= 30;
  } else if (points.length < 6) {
    issues.push('Limited data points - confidence reduced');
    score -= 15;
  }

  const sorted = [...points].sort((a, b) => a.power - b.power);
  const powers = sorted.map(p => p.power);
  const lactates = sorted.map(p => p.lactate);
  const heartrates = sorted.map(p => p.heartrate);

  const powerRange = Math.max(...powers) - Math.min(...powers);
  if (powerRange < 50) {
    issues.push('Power range too narrow for reliable threshold detection');
    score -= 25;
  } else if (powerRange < 100) {
    issues.push('Limited power range - may affect accuracy');
    score -= 10;
  }

  const lactateVariance = calculateVariance(lactates);
  if (lactateVariance < 1) {
    issues.push('Lactate values show minimal variation');
    score -= 20;
  }

  const outliers = detectOutliers(lactates);
  if (outliers.length > 0) {
    issues.push(`Detected ${outliers.length} potential outlier(s)`);
    score -= outliers.length * 10;
  }

  const hrTrend = checkHeartrateMonotonicity(heartrates, powers);
  if (!hrTrend.isMonotonic) {
    issues.push('Heart rate shows unusual pattern - may indicate data quality issues');
    score -= 10;
  }

  if (lactates.some(l => l < 0.5)) {
    issues.push('Suspiciously low lactate values detected');
    score -= 15;
  }

  if (lactates.some(l => l > 12)) {
    issues.push('Very high lactate values - may indicate test termination issues');
    score -= 10;
  }

  const laSlope = calculateSlope(powers, lactates);
  if (laSlope < 0.01) {
    issues.push('Lactate shows minimal increase with power - atypical response');
    score -= 15;
  }

  score = Math.max(0, score);

  let quality: DataQuality;
  if (score >= 80) {
    quality = 'good';
  } else if (score >= 50) {
    quality = 'marginal';
  } else {
    quality = 'poor';
  }

  let confidence: ConfidenceLevel;
  if (score >= 80 && points.length >= 5) {
    confidence = 'high';
  } else if (score >= 50 && points.length >= 4) {
    confidence = 'medium';
  } else {
    confidence = 'low';
  }

  return {
    quality,
    confidence,
    issues,
    score
  };
}

function calculateVariance(arr: number[]): number {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return arr.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / arr.length;
}

function detectOutliers(lactates: number[]): number[] {
  const mean = lactates.reduce((a, b) => a + b, 0) / lactates.length;
  const std = Math.sqrt(calculateVariance(lactates));
  
  const outliers: number[] = [];
  lactates.forEach((la, idx) => {
    if (Math.abs(la - mean) > 2 * std && std > 0) {
      outliers.push(idx);
    }
  });
  
  return outliers;
}

function checkHeartrateMonotonicity(
  heartrates: number[], 
  powers: number[]
): { isMonotonic: boolean; violations: number } {
  let violations = 0;
  
  for (let i = 1; i < heartrates.length; i++) {
    const powerDiff = powers[i] - powers[i - 1];
    const hrDiff = heartrates[i] - heartrates[i - 1];
    
    if (powerDiff > 10 && hrDiff < -2) {
      violations++;
    }
  }
  
  return {
    isMonotonic: violations <= 1,
    violations
  };
}

function calculateSlope(x: number[], y: number[]): number {
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
  
  const denominator = n * sumX2 - sumX * sumX;
  if (denominator === 0) return 0;
  
  return (n * sumXY - sumX * sumY) / denominator;
}

export function applyQualityAdjustment(
  ci: [number, number] | null,
  quality: DataQuality
): [number, number] | null {
  if (!ci) return null;
  
  const range = ci[1] - ci[0];
  let multiplier = 1.0;
  
  if (quality === 'marginal') {
    multiplier = 1.3;
  } else if (quality === 'poor') {
    multiplier = 1.6;
  }
  
  const center = (ci[0] + ci[1]) / 2;
  const adjustedRange = range * multiplier;
  
  return [
    Math.round(center - adjustedRange / 2),
    Math.round(center + adjustedRange / 2)
  ];
}
