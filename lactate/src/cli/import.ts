import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { LactateStorage } from '../storage';
import { LactatePoint, Sport, TestSource } from '../types';
import { createAnalyzer } from '../analysis';

interface ImportOptions {
  type: 'ramp' | 'spot';
  date?: string;
  sport?: string;
  source?: string;
  ref?: string;
  device?: string;
  conditions?: string;
}

export function createImportCommand(): Command {
  const command = new Command('import');
  
  command
    .description('Import lactate test data from CSV')
    .requiredOption('-f, --file <path>', 'CSV file path (or - for stdin)')
    .requiredOption('-t, --type <type>', 'Test type: ramp or spot')
    .option('-d, --date <date>', 'Test date (ISO-8601 format)', new Date().toISOString().split('T')[0])
    .option('-s, --sport <sport>', 'Sport: cycling, running, or swimming', 'cycling')
    .option('-S, --source <source>', 'Source: lab, field, or spot', 'field')
    .option('-r, --ref <ref>', 'Reference for spot tests (e.g., session name)')
    .option('--device <device>', 'Lactate measuring device')
    .option('--conditions <conditions>', 'Test conditions')
    .option('--athlete-id <id>', 'Athlete ID', 'default')
    .option('--data-dir <dir>', 'Data directory', path.join(__dirname, '..', 'data', 'tests'))
    .action(async (options) => {
      await runImport(options);
    });

  return command;
}

async function runImport(options: ImportOptions & { file: string; athleteId: string; dataDir: string }): Promise<void> {
  let csvContent: string;
  
  if (options.file === '-') {
    csvContent = fs.readFileSync(0, 'utf-8');
  } else {
    if (!fs.existsSync(options.file)) {
      console.error(`Error: File not found: ${options.file}`);
      process.exit(1);
    }
    csvContent = fs.readFileSync(options.file, 'utf-8');
  }

  const points = parseCSV(csvContent);
  
  if (points.length < 2) {
    console.error('Error: Need at least 2 data points');
    process.exit(1);
  }

  const sport = (options.sport || 'cycling') as Sport;
  const source = (options.source || 'field') as TestSource;

  const storage = new LactateStorage(options.athleteId, options.dataDir);

  const test = await storage.saveTest({
    athleteId: options.athleteId,
    testType: options.type,
    testDate: options.date || new Date().toISOString().split('T')[0],
    sport,
    source,
    data: points,
    metadata: {
      device: options.device,
      conditions: options.conditions
    },
    spotTestRef: options.ref
  });

  console.log(`Saved test: ${test.id}`);
  console.log(`Date: ${test.testDate}`);
  console.log(`Points: ${points.length}`);
  console.log(`Power range: ${Math.min(...points.map(p => p.power))}W - ${Math.max(...points.map(p => p.power))}W`);
  console.log(`Lactate range: ${Math.min(...points.map(p => p.lactate)).toFixed(1)} - ${Math.max(...points.map(p => p.lactate)).toFixed(1)} mmol/L`);

  const analyzer = createAnalyzer(options.athleteId);
  const analysis = analyzer.analyze(test);
  
  await storage.saveAnalysis(analysis);

  console.log('\nAnalysis Results:');
  console.log(`  LT1: ${analysis.lt1.power ? `${analysis.lt1.power}W @ ${analysis.lt1.heartrate}bpm` : 'not detected'} (${analysis.lt1.method})`);
  console.log(`  LT2: ${analysis.lt2.power ? `${analysis.lt2.power}W @ ${analysis.lt2.heartrate}bpm` : 'not detected'} (${analysis.lt2.method})`);
  console.log(`  FTP: ${analysis.ftp ? `${analysis.ftp.value}W (CI: ${analysis.ftp.ci80[0]}-${analysis.ftp.ci80[1]})` : 'N/A'}`);
  console.log(`  FTHR: ${analysis.fthr ? `${analysis.fthr.value}bpm` : 'N/A'}`);
  console.log(`  Quality: ${analysis.testQuality}, Confidence: ${analysis.confidence}`);
  
  if (analysis.dataQualityNotes.length > 0) {
    console.log('\nData Quality Notes:');
    analysis.dataQualityNotes.forEach(note => console.log(`  - ${note}`));
  }
}

function parseCSV(content: string): LactatePoint[] {
  const lines = content.trim().split('\n');
  
  if (lines.length < 2) {
    throw new Error('CSV must have header and at least one data row');
  }

  const header = lines[0].toLowerCase().split(',').map(h => h.trim());
  const powerIdx = header.findIndex(h => h === 'power' || h === 'watts' || h === 'w');
  const hrIdx = header.findIndex(h => h === 'heartrate' || h === 'hr' || h === 'bpm');
  const lactateIdx = header.findIndex(h => h === 'lactate' || h === 'la' || h === 'lactatemeasurement');

  if (powerIdx === -1 || lactateIdx === -1) {
    throw new Error('CSV must have power and lactate columns');
  }

  const points: LactatePoint[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',').map(v => v.trim());
    
    if (values.length < 2) continue;
    
    const power = parseFloat(values[powerIdx]);
    const lactate = parseFloat(values[lactateIdx]);
    const heartrate = hrIdx !== -1 ? parseFloat(values[hrIdx]) : 0;

    if (isNaN(power) || isNaN(lactate)) {
      console.warn(`Warning: Skipping invalid row ${i + 1}`);
      continue;
    }

    points.push({
      power: Math.round(power),
      heartrate: isNaN(heartrate) ? 0 : Math.round(heartrate),
      lactate: Math.round(lactate * 10) / 10
    });
  }

  return points;
}

export { runImport };
