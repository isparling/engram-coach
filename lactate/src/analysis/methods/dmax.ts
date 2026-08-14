import { LactatePoint, ThresholdResult } from '../../types';
import { 
  fitPolynomial, 
  interpolateHeartrate, 
  predictLactateAtPower 
} from './polyfit';

export function detectDmax(
  points: LactatePoint[], 
  targetLactate: number = 4.0
): ThresholdResult | null {
  if (points.length < 4) {
    return null;
  }

  try {
    const sorted = [...points].sort((a, b) => a.power - b.power);
    const powers = sorted.map(p => p.power);
    const lactates = sorted.map(p => p.lactate);
    
    const poly = fitPolynomial(powers, lactates, 3);
    
    const startPoint = { x: powers[0], y: lactates[0] };
    const endPoint = { x: powers[powers.length - 1], y: lactates[lactates.length - 1] };
    
    const slope = (endPoint.y - startPoint.y) / (endPoint.x - startPoint.x);
    const intercept = startPoint.y - slope * startPoint.x;
    
    let maxDistance = 0;
    let dmaxPower = powers[Math.floor(powers.length / 2)];
    let dmaxLactate = poly(dmaxPower);
    
    const minPower = Math.min(...powers);
    const maxPower = Math.max(...powers);
    const step = (maxPower - minPower) / 100;
    
    for (let power = minPower; power <= maxPower; power += step) {
      const predictedLactate = predictLactateAtPower(poly, power);
      const lineY = slope * power + intercept;
      const distance = Math.abs(predictedLactate - lineY);
      
      if (distance > maxDistance && predictedLactate > startPoint.y) {
        maxDistance = distance;
        dmaxPower = power;
        dmaxLactate = predictedLactate;
      }
    }
    
    const hrAtPower = interpolateHeartrate(sorted, dmaxPower);
    
    return {
      power: Math.round(dmaxPower),
      heartrate: hrAtPower !== null ? Math.round(hrAtPower) : null,
      lactate: Math.round(dmaxLactate * 10) / 10,
      ci80: null,
      ci95: null,
      method: 'dmax',
      methodType: 'primary'
    };
  } catch (error) {
    return null;
  }
}

export function detectModifiedDmax(points: LactatePoint[]): ThresholdResult | null {
  if (points.length < 4) {
    return null;
  }

  try {
    const sorted = [...points].sort((a, b) => a.power - b.power);
    const powers = sorted.map(p => p.power);
    const lactates = sorted.map(p => p.lactate);
    
    const baseline = Math.min(...lactates);
    const firstIncreaseIdx = lactates.findIndex((l, i) => 
      i > 0 && l > baseline + 0.5
    );
    
    if (firstIncreaseIdx > 0) {
      const relevantPoints = sorted.slice(firstIncreaseIdx - 1);
      return detectDmax(relevantPoints, 4.0);
    }
    
    return detectDmax(sorted, 4.0);
  } catch {
    return null;
  }
}

export function detectExpDmax(points: LactatePoint[]): ThresholdResult | null {
  if (points.length < 4) {
    return null;
  }

  try {
    const sorted = [...points].sort((a, b) => a.power - b.power);
    const powers = sorted.map(p => p.power);
    const lactates = sorted.map(p => Math.max(0.1, p.lactate));
    
    const logLactates = lactates.map(l => Math.log(l));
    
    const poly = fitPolynomial(powers, logLactates, 2);
    
    const expPoly = (x: number): number => Math.exp(poly(x));
    
    const startPoint = { x: powers[0], y: logLactates[0] };
    const endPoint = { x: powers[powers.length - 1], y: logLactates[logLactates.length - 1] };
    
    const slope = (endPoint.y - startPoint.y) / (endPoint.x - startPoint.x);
    const intercept = startPoint.y - slope * startPoint.x;
    
    let maxDistance = 0;
    let expDmaxPower = powers[Math.floor(powers.length / 2)];
    
    const minPower = Math.min(...powers);
    const maxPower = Math.max(...powers);
    const step = (maxPower - minPower) / 100;
    
    for (let power = minPower; power <= maxPower; power += step) {
      const predictedLogLa = poly(power);
      const lineY = slope * power + intercept;
      const distance = Math.abs(predictedLogLa - lineY);
      
      if (distance > maxDistance) {
        maxDistance = distance;
        expDmaxPower = power;
      }
    }
    
    const expDmaxLactate = expPoly(expDmaxPower);
    const hrAtPower = interpolateHeartrate(sorted, expDmaxPower);
    
    return {
      power: Math.round(expDmaxPower),
      heartrate: hrAtPower !== null ? Math.round(hrAtPower) : null,
      lactate: Math.round(expDmaxLactate * 10) / 10,
      ci80: null,
      ci95: null,
      method: 'exp-dmax',
      methodType: 'primary'
    };
  } catch {
    return null;
  }
}
