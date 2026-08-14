import { LactatePoint, ThresholdResult, ConfidenceInterval } from '../types';
import { fitPolynomial, predictLactateAtPower, interpolateHeartrate } from './methods/polyfit';

export interface BootstrapResult {
  pointEstimate: number;
  ci80: [number, number];
  ci95: [number, number];
  standardError: number;
}

export function bootstrapConfidenceInterval(
  points: LactatePoint[],
  targetFn: (pts: LactatePoint[]) => number,
  nBootstraps: number = 200
): BootstrapResult | null {
  if (points.length < 4) {
    return null;
  }

  const pointEstimate = targetFn(points);
  if (pointEstimate === null || isNaN(pointEstimate)) {
    return null;
  }

  const bootstrapEstimates: number[] = [];
  
  for (let i = 0; i < nBootstraps; i++) {
    const sample = bootstrapSample(points);
    
    try {
      const estimate = targetFn(sample);
      if (estimate !== null && !isNaN(estimate)) {
        bootstrapEstimates.push(estimate);
      }
    } catch {
      // Skip failed bootstrap samples
    }
  }

  if (bootstrapEstimates.length < 50) {
    return null;
  }

  bootstrapEstimates.sort((a, b) => a - b);

  const se = standardError(bootstrapEstimates);
  
  const p10 = percentile(bootstrapEstimates, 10);
  const p90 = percentile(bootstrapEstimates, 90);
  const p025 = percentile(bootstrapEstimates, 2.5);
  const p975 = percentile(bootstrapEstimates, 97.5);

  return {
    pointEstimate,
    ci80: [p10, p90],
    ci95: [p025, p975],
    standardError: se
  };
}

function bootstrapSample(points: LactatePoint[]): LactatePoint[] {
  const n = points.length;
  const indices: number[] = [];
  
  for (let i = 0; i < n; i++) {
    indices.push(Math.floor(Math.random() * n));
  }
  
  return indices.map(i => ({ ...points[i] }));
}

function percentile(arr: number[], p: number): number {
  const index = (p / 100) * (arr.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  
  if (lower === upper) {
    return arr[lower];
  }
  
  const fraction = index - lower;
  return arr[lower] + fraction * (arr[upper] - arr[lower]);
}

function standardError(arr: number[]): number {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / arr.length;
  return Math.sqrt(variance / arr.length);
}

export function computeConfidenceIntervals(
  points: LactatePoint[],
  method: string
): { ci80: [number, number] | null; ci95: [number, number] | null } {
  const targetFn = (pts: LactatePoint[]): number => {
    if (method.includes('dmax')) {
      return detectDmaxSimple(pts) ?? 0;
    } else if (method.includes('obla')) {
      const threshold = method.includes('2') ? 2.0 : method.includes('3') ? 3.0 : 4.0;
      return detectOBLASimple(pts, threshold) ?? 0;
    } else if (method.includes('log-log')) {
      return detectLogLogSimple(pts) ?? 0;
    }
    return detectDmaxSimple(pts) ?? 0;
  };

  const result = bootstrapConfidenceInterval(points, targetFn);
  
  if (!result) {
    return { ci80: null, ci95: null };
  }

  return {
    ci80: [Math.round(result.ci80[0]), Math.round(result.ci80[1])],
    ci95: [Math.round(result.ci95[0]), Math.round(result.ci95[1])]
  };
}

function detectDmaxSimple(points: LactatePoint[]): number | null {
  if (points.length < 4) return null;
  
  const sorted = [...points].sort((a, b) => a.power - b.power);
  const powers = sorted.map(p => p.power);
  const lactates = sorted.map(p => p.lactate);
  
  try {
    const poly = fitPolynomial(powers, lactates, 3);
    
    const startPoint = { x: powers[0], y: lactates[0] };
    const endPoint = { x: powers[powers.length - 1], y: lactates[lactates.length - 1] };
    const slope = (endPoint.y - startPoint.y) / (endPoint.x - startPoint.x);
    const intercept = startPoint.y - slope * startPoint.x;
    
    let maxDistance = 0;
    let dmaxPower = powers[Math.floor(powers.length / 2)];
    
    const minPower = Math.min(...powers);
    const maxPower = Math.max(...powers);
    const step = (maxPower - minPower) / 50;
    
    for (let power = minPower; power <= maxPower; power += step) {
      const predictedLactate = predictLactateAtPower(poly, power);
      const lineY = slope * power + intercept;
      const distance = Math.abs(predictedLactate - lineY);
      
      if (distance > maxDistance && predictedLactate > startPoint.y) {
        maxDistance = distance;
        dmaxPower = power;
      }
    }
    
    return dmaxPower;
  } catch {
    return null;
  }
}

function detectOBLASimple(points: LactatePoint[], threshold: number): number | null {
  if (points.length < 3) return null;
  
  const sorted = [...points].sort((a, b) => a.power - b.power);
  const powers = sorted.map(p => p.power);
  const lactates = sorted.map(p => p.lactate);
  
  try {
    const poly = fitPolynomial(powers, lactates, 3);
    
    const minPower = Math.min(...powers);
    const maxPower = Math.max(...powers);
    const step = (maxPower - minPower) / 100;
    
    for (let power = minPower; power <= maxPower; power += step) {
      const predictedLactate = predictLactateAtPower(poly, power);
      if (predictedLactate >= threshold) {
        return power;
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

function detectLogLogSimple(points: LactatePoint[]): number | null {
  if (points.length < 4) return null;
  
  const sorted = [...points].sort((a, b) => a.power - b.power);
  const powers = sorted.map(p => p.power);
  const lactates = sorted.map(p => Math.max(0.1, p.lactate));
  
  const logPowers = powers.map(p => Math.log(p));
  const logLactates = lactates.map(l => Math.log(l));
  
  let bestBreakpoint = 0;
  let bestR2 = 0;
  
  for (let i = 1; i < powers.length - 1; i++) {
    const x1 = logPowers.slice(0, i + 1);
    const y1 = logLactates.slice(0, i + 1);
    const x2 = logPowers.slice(i);
    const y2 = logLactates.slice(i);
    
    const r2_1 = linearRegressionR2(x1, y1);
    const r2_2 = linearRegressionR2(x2, y2);
    
    const combinedR2 = (r2_1 * x1.length + r2_2 * x2.length) / powers.length;
    
    if (combinedR2 > bestR2) {
      bestR2 = combinedR2;
      bestBreakpoint = i;
    }
  }
  
  return powers[bestBreakpoint];
}

function linearRegressionR2(x: number[], y: number[]): number {
  if (x.length < 2) return 0;
  
  const n = x.length;
  const sumX = x.reduce((a, b) => a + b, 0);
  const sumY = y.reduce((a, b) => a + b, 0);
  const sumXY = x.reduce((acc, xi, i) => acc + xi * y[i], 0);
  const sumX2 = x.reduce((acc, xi) => acc + xi * xi, 0);
  const sumY2 = y.reduce((acc, yi) => acc + yi * yi, 0);
  
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  
  const ssTot = y.reduce((acc, yi) => acc + Math.pow(yi - sumY / n, 2), 0);
  const ssRes = x.reduce((acc, xi, i) => 
    acc + Math.pow(y[i] - (slope * xi + intercept), 2), 0
  );
  
  if (ssTot === 0) return 0;
  return 1 - ssRes / ssTot;
}
