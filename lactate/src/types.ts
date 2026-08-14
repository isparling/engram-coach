export type Sport = 'cycling' | 'running' | 'swimming';
export type TestType = 'ramp' | 'spot';
export type TestSource = 'lab' | 'field' | 'spot';
export type DataQuality = 'good' | 'marginal' | 'poor';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface LactatePoint {
  power: number;
  heartrate: number;
  lactate: number;
}

export interface LactateTest {
  id: string;
  athleteId: string;
  testType: TestType;
  testDate: string;
  sport: Sport;
  source: TestSource;
  data: LactatePoint[];
  metadata: TestMetadata;
  spotTestRef?: string;
}

export interface TestMetadata {
  device?: string;
  conditions?: string;
  notes?: string;
  qualityFlags?: string[];
}

export interface SpotTestOrder {
  sessionName: string;
  intervalRef: number;
  sampleTimesMin: number[];
  reason: string;
  orderedAt: string;
}

export interface ThresholdResult {
  power: number | null;
  heartrate: number | null;
  lactate: number | null;
  ci80: [number, number] | null;
  ci95: [number, number] | null;
  method: string;
  methodType: 'primary' | 'fallback';
}

export interface LactateAnalysis {
  athleteId: string;
  testId: string;
  testType: TestType;
  testDate: string;
  sport: Sport;
  lt1: ThresholdResult;
  lt2: ThresholdResult;
  ftp: DerivedThreshold | null;
  fthr: DerivedThreshold | null;
  testQuality: DataQuality;
  confidence: ConfidenceLevel;
  methodsUsed: string[];
  dataQualityNotes: string[];
  spotTestAnalysis?: SpotTestAnalysis;
}

export interface DerivedThreshold {
  value: number;
  ci80: [number, number];
  ci95: [number, number];
  method: string;
}

export interface SpotTestAnalysis {
  readings: SpotReading[];
  comparisonToBaseline: SpotComparison;
  trend: 'improving' | 'stable' | 'declining';
  confidence: ConfidenceLevel;
}

export interface SpotReading {
  power: number;
  heartrate: number;
  lactate: number;
  expectedLactate?: number;
  deltaFromExpected?: number;
}

export interface SpotComparison {
  baselineLt2: number;
  currentReading: number;
  delta: number;
  interpretation: string;
}

export interface AnalysisMethod {
  name: string;
  detect: (points: LactatePoint[]) => ThresholdResult | null;
  primaryTarget: 'lt1' | 'lt2';
}

export interface ConfidenceInterval {
  value: number;
  ci80: [number, number];
  ci95: [number, number];
}

export interface AthleteConfig {
  athleteId: string;
  dataDir: string;
  ordersDir: string;
}
