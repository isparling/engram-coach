import { Command } from 'commander';
import * as path from 'path';
import { LactateStorage } from '../storage';
import { createAnalyzer } from '../analysis';
import { LactateAnalysis } from '../types';

export function createQueryCommand(): Command {
  const command = new Command('query');
  
  command
    .description('Query lactate analysis results')
    .option('--athlete-id <id>', 'Athlete ID', 'default')
    .option('--data-dir <dir>', 'Data directory', path.join(__dirname, '..', 'data', 'tests'))
    .option('--test-id <id>', 'Specific test ID')
    .option('--latest', 'Get latest test analysis')
    .option('--compare', 'Compare to previous test')
    .action(async (options) => {
      await runQuery(options);
    });

  return command;
}

async function runQuery(options: { 
  athleteId: string; 
  dataDir: string; 
  testId?: string;
  latest?: boolean;
  compare?: boolean;
}): Promise<void> {
  const storage = new LactateStorage(options.athleteId, options.dataDir);
  const analyzer = createAnalyzer(options.athleteId);

  let analysis: LactateAnalysis | null;

  if (options.testId) {
    analysis = await storage.getAnalysis(options.testId);
    if (!analysis) {
      console.error(`Analysis not found for test: ${options.testId}`);
      process.exit(1);
    }
  } else if (options.latest) {
    analysis = await storage.getLatestAnalysis();
    if (!analysis) {
      console.error('No analysis found');
      process.exit(1);
    }
  } else {
    const latestTest = await storage.getLatestRampTest();
    if (!latestTest) {
      console.error('No ramp tests found');
      process.exit(1);
    }
    analysis = await storage.getAnalysis(latestTest.id);
    if (!analysis) {
      analysis = analyzer.analyze(latestTest);
      await storage.saveAnalysis(analysis);
    }
  }

  console.log('\n=== Lactate Analysis Results ===\n');
  console.log(`Test ID: ${analysis.testId}`);
  console.log(`Date: ${analysis.testDate}`);
  console.log(`Type: ${analysis.testType}`);
  console.log(`Sport: ${analysis.sport}`);
  console.log(`Quality: ${analysis.testQuality} | Confidence: ${analysis.confidence}`);
  console.log(`Methods: ${analysis.methodsUsed.join(', ')}`);

  console.log('\n--- Thresholds ---\n');
  
  console.log(`LT1:`);
  if (analysis.lt1.power) {
    console.log(`  Power: ${analysis.lt1.power}W`);
    if (analysis.lt1.heartrate) console.log(`  Heart Rate: ${analysis.lt1.heartrate}bpm`);
    if (analysis.lt1.lactate) console.log(`  Lactate: ${analysis.lt1.lactate} mmol/L`);
    if (analysis.lt1.ci80) console.log(`  CI (80%): ${analysis.lt1.ci80[0]}-${analysis.lt1.ci80[1]}W`);
  } else {
    console.log('  Not detected');
  }

  console.log(`\nLT2:`);
  if (analysis.lt2.power) {
    console.log(`  Power: ${analysis.lt2.power}W`);
    if (analysis.lt2.heartrate) console.log(`  Heart Rate: ${analysis.lt2.heartrate}bpm`);
    if (analysis.lt2.lactate) console.log(`  Lactate: ${analysis.lt2.lactate} mmol/L`);
    if (analysis.lt2.ci80) console.log(`  CI (80%): ${analysis.lt2.ci80[0]}-${analysis.lt2.ci80[1]}W`);
  } else {
    console.log('  Not detected');
  }

  console.log('\n--- Derived Values ---\n');
  
  if (analysis.ftp) {
    console.log(`FTP: ${analysis.ftp.value}W`);
    console.log(`  CI (80%): ${analysis.ftp.ci80[0]}-${analysis.ftp.ci80[1]}W`);
    console.log(`  CI (95%): ${analysis.ftp.ci95[0]}-${analysis.ftp.ci95[1]}W`);
  }
  
  if (analysis.fthr) {
    console.log(`FTHR: ${analysis.fthr.value}bpm`);
    console.log(`  CI (80%): ${analysis.fthr.ci80[0]}-${analysis.fthr.ci80[1]}bpm`);
  }

  if (analysis.dataQualityNotes.length > 0) {
    console.log('\n--- Data Quality Notes ---\n');
    analysis.dataQualityNotes.forEach(note => console.log(`  - ${note}`));
  }

  if (options.compare) {
    const tests = await storage.listTests('ramp');
    if (tests.length > 1) {
      const previousTest = tests[1];
      const previousAnalysis = await storage.getAnalysis(previousTest.id);
      
      if (previousAnalysis) {
        const comparison = analyzer.compareToHistorical(analysis, previousAnalysis);
        
        console.log('\n--- Historical Comparison ---\n');
        console.log(`Previous Test: ${previousAnalysis.testDate}`);
        if (comparison.lt2Delta !== null) {
          console.log(`LT2 Change: ${comparison.lt2Delta > 0 ? '+' : ''}${comparison.lt2Delta}W`);
        }
        if (comparison.ftpDelta !== null) {
          console.log(`FTP Change: ${comparison.ftpDelta > 0 ? '+' : ''}${comparison.ftpDelta}W`);
        }
        console.log(`Interpretation: ${comparison.interpretation}`);
      }
    }
  }

  console.log('');
}

export { runQuery };
