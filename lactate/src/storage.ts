import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { 
  LactateTest, 
  SpotTestOrder, 
  AthleteConfig,
  LactateAnalysis 
} from './types';

const DEFAULT_DATA_DIR = path.join(__dirname, '..', 'data', 'tests');

export class LactateStorage {
  private dataDir: string;
  private athleteId: string;

  constructor(athleteId: string, dataDir?: string) {
    this.athleteId = athleteId;
    this.dataDir = dataDir || DEFAULT_DATA_DIR;
    this.ensureDirectory();
  }

  private ensureDirectory(): void {
    const athleteDir = this.getAthleteDir();
    if (!fs.existsSync(athleteDir)) {
      fs.mkdirSync(athleteDir, { recursive: true });
    }
  }

  private getAthleteDir(): string {
    return path.join(this.dataDir, this.athleteId);
  }

  private getTestsDir(): string {
    return path.join(this.getAthleteDir(), 'tests');
  }

  private getAnalysisDir(): string {
    return path.join(this.getAthleteDir(), 'analysis');
  }

  async saveTest(test: Omit<LactateTest, 'id'>): Promise<LactateTest> {
    this.ensureDirectory();
    
    const id = uuidv4();
    const fullTest: LactateTest = { ...test, id };
    
    const testsDir = this.getTestsDir();
    if (!fs.existsSync(testsDir)) {
      fs.mkdirSync(testsDir, { recursive: true });
    }

    const filePath = path.join(testsDir, `${id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(fullTest, null, 2));
    
    return fullTest;
  }

  async getTest(id: string): Promise<LactateTest | null> {
    const filePath = path.join(this.getTestsDir(), `${id}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as LactateTest;
  }

  async listTests(testType?: string): Promise<LactateTest[]> {
    const testsDir = this.getTestsDir();
    if (!fs.existsSync(testsDir)) {
      return [];
    }

    const files = fs.readdirSync(testsDir).filter(f => f.endsWith('.json'));
    const tests: LactateTest[] = [];

    for (const file of files) {
      const content = fs.readFileSync(path.join(testsDir, file), 'utf-8');
      const test = JSON.parse(content) as LactateTest;
      if (!testType || test.testType === testType) {
        tests.push(test);
      }
    }

    return tests.sort((a, b) => 
      new Date(b.testDate).getTime() - new Date(a.testDate).getTime()
    );
  }

  async getLatestRampTest(): Promise<LactateTest | null> {
    const tests = await this.listTests('ramp');
    return tests[0] || null;
  }

  async getAllRampTests(): Promise<LactateTest[]> {
    return this.listTests('ramp');
  }

  async getSpotTests(ref?: string): Promise<LactateTest[]> {
    const tests = await this.listTests('spot');
    if (ref) {
      return tests.filter(t => t.spotTestRef === ref);
    }
    return tests;
  }

  async saveAnalysis(analysis: LactateAnalysis): Promise<void> {
    const analysisDir = this.getAnalysisDir();
    if (!fs.existsSync(analysisDir)) {
      fs.mkdirSync(analysisDir, { recursive: true });
    }

    const filePath = path.join(analysisDir, `${analysis.testId}_analysis.json`);
    fs.writeFileSync(filePath, JSON.stringify(analysis, null, 2));
  }

  async getAnalysis(testId: string): Promise<LactateAnalysis | null> {
    const filePath = path.join(this.getAnalysisDir(), `${testId}_analysis.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as LactateAnalysis;
  }

  async getLatestAnalysis(): Promise<LactateAnalysis | null> {
    const analysisDir = this.getAnalysisDir();
    if (!fs.existsSync(analysisDir)) {
      return null;
    }

    const files = fs.readdirSync(analysisDir)
      .filter(f => f.endsWith('_analysis.json'))
      .sort((a, b) => b.localeCompare(a));

    if (files.length === 0) return null;
    
    const content = fs.readFileSync(path.join(analysisDir, files[0]), 'utf-8');
    return JSON.parse(content) as LactateAnalysis;
  }

  async deleteTest(id: string): Promise<boolean> {
    const testPath = path.join(this.getTestsDir(), `${id}.json`);
    if (!fs.existsSync(testPath)) {
      return false;
    }
    fs.unlinkSync(testPath);
    return true;
  }
}

export class SpotTestOrderStorage {
  private ordersDir: string;

  constructor(ordersDir: string) {
    this.ordersDir = ordersDir;
  }

  async saveOrder(order: SpotTestOrder): Promise<void> {
    if (!fs.existsSync(this.ordersDir)) {
      fs.mkdirSync(this.ordersDir, { recursive: true });
    }

    const filePath = path.join(this.ordersDir, `${order.sessionName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(order, null, 2));
  }

  async getOrder(sessionName: string): Promise<SpotTestOrder | null> {
    const filePath = path.join(this.ordersDir, `${sessionName}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content) as SpotTestOrder;
  }

  async listOrders(): Promise<SpotTestOrder[]> {
    if (!fs.existsSync(this.ordersDir)) {
      return [];
    }

    const files = fs.readdirSync(this.ordersDir).filter(f => f.endsWith('.json'));
    const orders: SpotTestOrder[] = [];

    for (const file of files) {
      const content = fs.readFileSync(path.join(this.ordersDir, file), 'utf-8');
      orders.push(JSON.parse(content));
    }

    return orders;
  }
}

export function getAthleteConfig(configPath?: string): AthleteConfig {
  const defaultConfig: AthleteConfig = {
    athleteId: 'default',
    dataDir: DEFAULT_DATA_DIR,
    ordersDir: path.join(DEFAULT_DATA_DIR, '..', 'spot-test-orders')
  };

  if (!configPath) {
    return defaultConfig;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(content);
    return {
      athleteId: config.active_profile || 'default',
      dataDir: path.dirname(configPath),
      ordersDir: path.join(path.dirname(configPath), 'spot-test-orders')
    };
  } catch {
    return defaultConfig;
  }
}
