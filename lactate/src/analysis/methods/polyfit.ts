import { LactatePoint, ThresholdResult } from '../../types';

export function fitPolynomial(x: number[], y: number[], degree: number): (x: number) => number {
  const n = x.length;
  const k = degree + 1;
  
  const X: number[][] = [];
  const Y: number[] = [];
  
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < k; j++) {
      row.push(Math.pow(x[i], j));
    }
    X.push(row);
    Y.push(y[i]);
  }
  
  const Xt = transpose(X);
  const XtX = multiply(Xt, X);
  const XtY = multiplyVector(Xt, Y);
  
  const coeffs = solveLinearSystem(XtX, XtY);
  
  return (val: number): number => {
    let result = 0;
    for (let j = 0; j < k; j++) {
      result += coeffs[j] * Math.pow(val, j);
    }
    return result;
  };
}

function transpose(matrix: number[][]): number[][] {
  return matrix[0].map((_, colIndex) => matrix.map(row => row[colIndex]));
}

function multiply(a: number[][], b: number[][]): number[][] {
  const result: number[][] = [];
  for (let i = 0; i < a.length; i++) {
    result[i] = [];
    for (let j = 0; j < b[0].length; j++) {
      let sum = 0;
      for (let k = 0; k < a[0].length; k++) {
        sum += a[i][k] * b[k][j];
      }
      result[i][j] = sum;
    }
  }
  return result;
}

function multiplyVector(matrix: number[][], vector: number[]): number[] {
  return matrix.map(row => 
    row.reduce((sum, val, idx) => sum + val * vector[idx], 0)
  );
}

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length;
  const aug = A.map((row, i) => [...row, b[i]]);
  
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(aug[k][i]) > Math.abs(aug[maxRow][i])) {
        maxRow = k;
      }
    }
    [aug[i], aug[maxRow]] = [aug[maxRow], aug[i]];
    
    if (Math.abs(aug[i][i]) < 1e-10) continue;
    
    for (let k = i + 1; k < n; k++) {
      const factor = aug[k][i] / aug[i][i];
      for (let j = i; j <= n; j++) {
        aug[k][j] -= factor * aug[i][j];
      }
    }
  }
  
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    if (Math.abs(aug[i][i]) < 1e-10) continue;
    x[i] = aug[i][n];
    for (let j = i + 1; j < n; j++) {
      x[i] -= aug[i][j] * x[j];
    }
    x[i] /= aug[i][i];
  }
  
  return x;
}

export function interpolateLactate(
  points: LactatePoint[], 
  targetPower: number
): number | null {
  if (points.length < 2) return null;
  
  const sorted = [...points].sort((a, b) => a.power - b.power);
  
  if (targetPower <= sorted[0].power) {
    return sorted[0].lactate;
  }
  if (targetPower >= sorted[sorted.length - 1].power) {
    return sorted[sorted.length - 1].lactate;
  }
  
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].power <= targetPower && sorted[i + 1].power >= targetPower) {
      const ratio = (targetPower - sorted[i].power) / (sorted[i + 1].power - sorted[i].power);
      return sorted[i].lactate + ratio * (sorted[i + 1].lactate - sorted[i].lactate);
    }
  }
  
  return null;
}

export function interpolateHeartrate(
  points: LactatePoint[], 
  targetPower: number
): number | null {
  if (points.length < 2) return null;
  
  const sorted = [...points].sort((a, b) => a.power - b.power);
  
  if (targetPower <= sorted[0].power) {
    return sorted[0].heartrate;
  }
  if (targetPower >= sorted[sorted.length - 1].power) {
    return sorted[sorted.length - 1].heartrate;
  }
  
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].power <= targetPower && sorted[i + 1].power >= targetPower) {
      const ratio = (targetPower - sorted[i].power) / (sorted[i + 1].power - sorted[i].power);
      return sorted[i].heartrate + ratio * (sorted[i + 1].heartrate - sorted[i].heartrate);
    }
  }
  
  return null;
}

export function predictLactateAtPower(
  polyFn: (x: number) => number,
  power: number
): number {
  return Math.max(0, polyFn(power));
}

export function normalizeData(points: LactatePoint[]): { x: number[], y: number[] } {
  const x = points.map(p => p.power);
  const y = points.map(p => p.lactate);
  
  const xMin = Math.min(...x);
  const xMax = Math.max(...x);
  const yMin = Math.min(...y);
  const yMax = Math.max(...y);
  
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;
  
  return {
    x: x.map(v => (v - xMin) / xRange),
    y: y.map(v => (v - yMin) / yRange)
  };
}

export function denormalizeX(normalized: number, x: number[]): number {
  const xMin = Math.min(...x);
  const xMax = Math.max(...x);
  return xMin + normalized * (xMax - xMin);
}

export function denormalizeY(normalized: number, y: number[]): number {
  const yMin = Math.min(...y);
  const yMax = Math.max(...y);
  return yMin + normalized * (yMax - yMin);
}
