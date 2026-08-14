import { LactateStorage } from './storage';
import { createAnalyzer, LactateAnalyzer } from './analysis';
import { createSpotTestAnalyzer, SpotTestAnalyzer } from './spot/analyzer';
import { createParser, SpotTestParser } from './spot/parser';
import { LactateAnalysis, LactateTest, SpotTestAnalysis } from './types';

export interface LactateQueryOptions {
  athleteId?: string;
  dataDir?: string;
  testId?: string;
  compareToPrevious?: boolean;
}

export interface LactateQueryResult {
  currentAnalysis: LactateAnalysis | null;
  previousAnalysis: LactateAnalysis | null;
  comparison: {
    lt2Delta: number | null;
    ftpDelta: number | null;
    fthrDelta: number | null;
    interpretation: string;
  } | null;
}

export class LactateAPI {
  private storage: LactateStorage;
  private analyzer: LactateAnalyzer;
  private spotAnalyzer: SpotTestAnalyzer;
  private parser: SpotTestParser;

  constructor(athleteId: string, dataDir?: string) {
    this.storage = new LactateStorage(athleteId, dataDir);
    this.analyzer = createAnalyzer(athleteId);
    this.spotAnalyzer = createSpotTestAnalyzer();
    this.parser = createParser();
  }

  async analyzeLatestRampTest(): Promise<LactateAnalysis | null> {
    const test = await this.storage.getLatestRampTest();
    if (!test) return null;

    const existingAnalysis = await this.storage.getAnalysis(test.id);
    if (existingAnalysis) return existingAnalysis;

    const analysis = this.analyzer.analyze(test);
    await this.storage.saveAnalysis(analysis);
    return analysis;
  }

  async analyzeRampTest(testId: string): Promise<LactateAnalysis | null> {
    const test = await this.storage.getTest(testId);
    if (!test) return null;

    const existingAnalysis = await this.storage.getAnalysis(testId);
    if (existingAnalysis) return existingAnalysis;

    const analysis = this.analyzer.analyze(test);
    await this.storage.saveAnalysis(analysis);
    return analysis;
  }

  async query(options: LactateQueryOptions = {}): Promise<LactateQueryResult> {
    const athleteId = options.athleteId || 'default';
    const dataDir = options.dataDir;
    const testId = options.testId;
    const compareToPrevious = options.compareToPrevious ?? false;

    let currentAnalysis: LactateAnalysis | null;

    if (testId) {
      currentAnalysis = await this.analyzeRampTest(testId);
    } else {
      currentAnalysis = await this.analyzeLatestRampTest();
    }

    let previousAnalysis: LactateAnalysis | null = null;
    let comparison = null;

    if (compareToPrevious && currentAnalysis) {
      const tests = await this.storage.listTests('ramp');
      const currentIdx = tests.findIndex(t => t.id === currentAnalysis?.testId);
      
      if (currentIdx >= 0 && currentIdx < tests.length - 1) {
        const previousTest = tests[currentIdx + 1];
        previousAnalysis = await this.storage.getAnalysis(previousTest.id);
        
        if (!previousAnalysis) {
          previousAnalysis = this.analyzer.analyze(previousTest);
          await this.storage.saveAnalysis(previousAnalysis);
        }

        comparison = this.analyzer.compareToHistorical(currentAnalysis, previousAnalysis);
      }
    }

    return {
      currentAnalysis,
      previousAnalysis,
      comparison
    };
  }

  async analyzeSpotTest(
    readings: { power: number; heartrate: number; lactate: number }[],
    baselineTestId?: string
  ): Promise<SpotTestAnalysis | null> {
    let baselineTest: LactateTest | null;

    if (baselineTestId) {
      baselineTest = await this.storage.getTest(baselineTestId);
    } else {
      const tests = await this.storage.listTests('ramp');
      baselineTest = tests[0] || null;
    }

    if (!baselineTest || baselineTest.data.length < 3) {
      return null;
    }

    const baselineAnalysis = await this.storage.getAnalysis(baselineTest.id) 
      || this.analyzer.analyze(baselineTest);

    return this.spotAnalyzer.compareToBaseline(
      baselineTest.data,
      readings,
      baselineAnalysis.lt2.power || undefined
    );
  }

  parsePrescriptionFile(filePath: string) {
    return this.parser.parsePrescriptionFile(filePath);
  }

  extractSpotTestOrders(prescriptionPath: string) {
    const doc = this.parser.parsePrescriptionFile(prescriptionPath);
    if (!doc) return [];
    return this.parser.extractSpotTestOrders(doc);
  }

  async listTests(type?: 'ramp' | 'spot') {
    return this.storage.listTests(type);
  }

  async getTest(testId: string) {
    return this.storage.getTest(testId);
  }
}

export function createLactateAPI(athleteId?: string, dataDir?: string): LactateAPI {
  return new LactateAPI(athleteId || 'default', dataDir);
}

export { LactateAnalysis, LactateTest, SpotTestAnalysis };
