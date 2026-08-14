import { LactatePoint, ThresholdResult } from '../../types';
import { interpolateHeartrate } from './polyfit';

export function detectLogLog(points: LactatePoint[]): ThresholdResult | null {
  if (points.length < 4) {
    return null;
  }

  try {
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
    
    const breakpointPower = powers[bestBreakpoint];
    const hrAtPower = interpolateHeartrate(sorted, breakpointPower);
    const lactateAtPower = lactates[bestBreakpoint];
    
    return {
      power: Math.round(breakpointPower),
      heartrate: hrAtPower !== null ? Math.round(hrAtPower) : null,
      lactate: Math.round(lactateAtPower * 10) / 10,
      ci80: null,
      ci95: null,
      method: 'log-log',
      methodType: 'primary'
    };
  } catch {
    return null;
  }
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

export function detectLogLogSegmented(
  points: LactatePoint[]
): { lt1: ThresholdResult | null; lt2: ThresholdResult | null } {
  if (points.length < 5) {
    return { lt1: null, lt2: null };
  }

  try {
    const sorted = [...points].sort((a, b) => a.power - b.power);
    const powers = sorted.map(p => p.power);
    const lactates = sorted.map(p => Math.max(0.1, p.lactate));
    const heartrates = sorted.map(p => p.heartrate);
    
    const logPowers = powers.map(p => Math.log(p));
    const logLactates = lactates.map(l => Math.log(l));
    
    let bestBreakpoints: [number, number] = [1, powers.length - 2];
    let bestR2 = 0;
    
    for (let i = 1; i < powers.length - 2; i++) {
      for (let j = i + 1; j < powers.length - 1; j++) {
        const x1 = logPowers.slice(0, i + 1);
        const y1 = logLactates.slice(0, i + 1);
        const x2 = logPowers.slice(i, j + 1);
        const y2 = logLactates.slice(i, j + 1);
        const x3 = logPowers.slice(j);
        const y3 = logLactates.slice(j);
        
        const r2_1 = linearRegressionR2(x1, y1);
        const r2_2 = linearRegressionR2(x2, y2);
        const r2_3 = linearRegressionR2(x3, y3);
        
        const weights = [x1.length, x2.length, x3.length];
        const combinedR2 = (
          r2_1 * weights[0] + 
          r2_2 * weights[1] + 
          r2_3 * weights[2]
        ) / powers.length;
        
        if (combinedR2 > bestR2) {
          bestR2 = combinedR2;
          bestBreakpoints = [i, j];
        }
      }
    }
    
    const lt1Power = powers[bestBreakpoints[0]];
    const lt2Power = powers[bestBreakpoints[1]];
    
    const lt1: ThresholdResult = {
      power: Math.round(lt1Power),
      heartrate: interpolateHeartrate(sorted, lt1Power) !== null 
        ? Math.round(interpolateHeartrate(sorted, lt1Power)!) 
        : null,
      lactate: Math.round(lactates[bestBreakpoints[0]] * 10) / 10,
      ci80: null,
      ci95: null,
      method: 'log-log-ltp1',
      methodType: 'primary'
    };
    
    const lt2: ThresholdResult = {
      power: Math.round(lt2Power),
      heartrate: interpolateHeartrate(sorted, lt2Power) !== null 
        ? Math.round(interpolateHeartrate(sorted, lt2Power)!) 
        : null,
      lactate: Math.round(lactates[bestBreakpoints[1]] * 10) / 10,
      ci80: null,
      ci95: null,
      method: 'log-log-ltp2',
      methodType: 'primary'
    };
    
    return { lt1, lt2 };
  } catch {
    return { lt1: null, lt2: null };
  }
}
