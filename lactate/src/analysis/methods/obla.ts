import { LactatePoint, ThresholdResult } from '../../types';
import { fitPolynomial, interpolateHeartrate, predictLactateAtPower } from './polyfit';

export function detectOBLA(
  points: LactatePoint[], 
  thresholdLactate: number = 4.0
): ThresholdResult | null {
  if (points.length < 3) {
    return null;
  }

  try {
    const sorted = [...points].sort((a, b) => a.power - b.power);
    const powers = sorted.map(p => p.power);
    const lactates = sorted.map(p => p.lactate);
    
    if (lactates.every(l => l < thresholdLactate)) {
      const maxPower = powers[powers.length - 1];
      const hrAtMax = interpolateHeartrate(sorted, maxPower);
      return {
        power: Math.round(maxPower),
        heartrate: hrAtMax !== null ? Math.round(hrAtMax) : null,
        lactate: Math.round(lactates[lactates.length - 1] * 10) / 10,
        ci80: null,
        ci95: null,
        method: `obla_${thresholdLactate}_extrapolated`,
        methodType: 'fallback'
      };
    }
    
    const poly = fitPolynomial(powers, lactates, 3);
    
    let oblaPower: number | null = null;
    
    const minPower = Math.min(...powers);
    const maxPower = Math.max(...powers);
    const step = (maxPower - minPower) / 200;
    
    for (let power = minPower; power <= maxPower; power += step) {
      const predictedLactate = predictLactateAtPower(poly, power);
      
      if (predictedLactate >= thresholdLactate) {
        oblaPower = power;
        break;
      }
    }
    
    if (oblaPower === null) {
      const maxLa = Math.max(...lactates);
      if (maxLa > thresholdLactate) {
        for (let i = 0; i < sorted.length - 1; i++) {
          if (sorted[i].lactate < thresholdLactate && sorted[i + 1].lactate >= thresholdLactate) {
            const ratio = (thresholdLactate - sorted[i].lactate) / 
              (sorted[i + 1].lactate - sorted[i].lactate);
            oblaPower = sorted[i].power + ratio * (sorted[i + 1].power - sorted[i].power);
            break;
          }
        }
      }
    }
    
    if (oblaPower === null) {
      return null;
    }
    
    const hrAtPower = interpolateHeartrate(sorted, oblaPower);
    
    return {
      power: Math.round(oblaPower),
      heartrate: hrAtPower !== null ? Math.round(hrAtPower) : null,
      lactate: thresholdLactate,
      ci80: null,
      ci95: null,
      method: `obla_${thresholdLactate}`,
      methodType: 'primary'
    };
  } catch {
    return null;
  }
}

export function detectOBLA2(points: LactatePoint[]): ThresholdResult | null {
  return detectOBLA(points, 2.0);
}

export function detectOBLA4(points: LactatePoint[]): ThresholdResult | null {
  return detectOBLA(points, 4.0);
}

export function detectOBLA3(points: LactatePoint[]): ThresholdResult | null {
  return detectOBLA(points, 3.0);
}

export function detectBaselinePlus(
  points: LactatePoint[],
  baselineOffset: number = 1.0
): ThresholdResult | null {
  if (points.length < 3) {
    return null;
  }

  try {
    const sorted = [...points].sort((a, b) => a.power - b.power);
    const lactates = sorted.map(p => p.lactate);
    
    const baseline = Math.min(...lactates);
    const threshold = baseline + baselineOffset;
    
    return detectOBLA(sorted, threshold);
  } catch {
    return null;
  }
}
