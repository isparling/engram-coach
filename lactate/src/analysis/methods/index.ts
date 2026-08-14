import { LactatePoint, ThresholdResult } from '../../types';
import { detectDmax, detectModifiedDmax, detectExpDmax } from './dmax';
import { detectLogLog, detectLogLogSegmented } from './loglog';
import { 
  detectOBLA, 
  detectOBLA2, 
  detectOBLA3, 
  detectOBLA4, 
  detectBaselinePlus 
} from './obla';

export interface DetectionResult {
  lt1: ThresholdResult | null;
  lt2: ThresholdResult | null;
}

export function detectAllMethods(points: LactatePoint[]): DetectionResult {
  const results: DetectionResult = {
    lt1: null,
    lt2: null
  };

  if (points.length < 3) {
    return results;
  }

  const lt1Candidates: ThresholdResult[] = [];
  const lt2Candidates: ThresholdResult[] = [];

  const obla2 = detectOBLA2(points);
  if (obla2) lt1Candidates.push(obla2);

  const bsline1 = detectBaselinePlus(points, 1.0);
  if (bsline1) lt1Candidates.push(bsline1);

  const bsline05 = detectBaselinePlus(points, 0.5);
  if (bsline05) lt1Candidates.push(bsline05);

  const loglog = detectLogLog(points);
  if (loglog) lt1Candidates.push(loglog);

  const segmented = detectLogLogSegmented(points);
  if (segmented.lt1) lt1Candidates.push(segmented.lt1);
  if (segmented.lt2) lt2Candidates.push(segmented.lt2);

  const obla4 = detectOBLA4(points);
  if (obla4) lt2Candidates.push(obla4);

  const obla3 = detectOBLA3(points);
  if (obla3) lt2Candidates.push(obla3);

  const dmax = detectDmax(points);
  if (dmax) lt2Candidates.push(dmax);

  const modDmax = detectModifiedDmax(points);
  if (modDmax) lt2Candidates.push(modDmax);

  const expDmax = detectExpDmax(points);
  if (expDmax) lt2Candidates.push(expDmax);

  results.lt1 = selectBestResult(lt1Candidates, 'lt1');
  results.lt2 = selectBestResult(lt2Candidates, 'lt2');

  return results;
}

function selectBestResult(
  candidates: ThresholdResult[], 
  target: 'lt1' | 'lt2'
): ThresholdResult | null {
  if (candidates.length === 0) return null;

  if (candidates.length === 1) return candidates[0];

  const primaryCandidates = candidates.filter(c => c.methodType === 'primary');
  if (primaryCandidates.length > 0) {
    return primaryCandidates[0];
  }

  return candidates[0];
}

export function detectForSpotTest(
  baselinePoints: LactatePoint[],
  spotPower: number,
  spotLactate: number
): { lt2Estimate: number; confidence: number } | null {
  if (baselinePoints.length < 3) {
    return null;
  }

  const lt2Result = detectAllMethods(baselinePoints);
  const lt2 = lt2Result.lt2?.power;
  
  if (!lt2) {
    return null;
  }

  const sorted = [...baselinePoints].sort((a, b) => a.power - b.power);
  const baselineLactateAtLt2 = findLactateAtPower(sorted, lt2);
  
  const delta = spotLactate - (baselineLactateAtLt2 || 2.5);
  
  let lt2Estimate = lt2;
  if (delta > 1) {
    lt2Estimate = lt2 - 10 * delta;
  } else if (delta < -0.5) {
    lt2Estimate = lt2 + 5 * Math.abs(delta);
  }

  const confidence = Math.max(0.3, 1 - Math.abs(delta) * 0.2);

  return {
    lt2Estimate: Math.round(lt2Estimate),
    confidence
  };
}

function findLactateAtPower(points: LactatePoint[], power: number): number | null {
  const sorted = [...points].sort((a, b) => a.power - b.power);
  
  if (power <= sorted[0].power) return sorted[0].lactate;
  if (power >= sorted[sorted.length - 1].power) return sorted[sorted.length - 1].lactate;
  
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].power <= power && sorted[i + 1].power >= power) {
      const ratio = (power - sorted[i].power) / (sorted[i + 1].power - sorted[i].power);
      return sorted[i].lactate + ratio * (sorted[i + 1].lactate - sorted[i].lactate);
    }
  }
  
  return null;
}

export { detectDmax, detectModifiedDmax, detectExpDmax };
export { detectLogLog, detectLogLogSegmented };
export { detectOBLA, detectOBLA2, detectOBLA3, detectOBLA4, detectBaselinePlus };
