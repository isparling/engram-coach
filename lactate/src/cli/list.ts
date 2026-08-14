import { Command } from 'commander';
import * as path from 'path';
import { LactateStorage } from '../storage';

export function createListCommand(): Command {
  const command = new Command('list');
  
  command
    .description('List stored lactate tests')
    .option('--athlete-id <id>', 'Athlete ID', 'default')
    .option('--data-dir <dir>', 'Data directory', path.join(__dirname, '..', 'data', 'tests'))
    .option('--type <type>', 'Filter by type: ramp or spot')
    .action(async (options) => {
      await runList(options);
    });

  return command;
}

async function runList(options: { 
  athleteId: string; 
  dataDir: string; 
  type?: string;
}): Promise<void> {
  const storage = new LactateStorage(options.athleteId, options.dataDir);

  const tests = await storage.listTests(options.type);

  if (tests.length === 0) {
    console.log('No tests found');
    return;
  }

  console.log('\n=== Stored Lactate Tests ===\n');
  console.log(`ID                 | Date       | Type  | Sport     | Points | Quality`);
  console.log(`-------------------|------------|-------|-----------|--------|--------`);

  for (const test of tests) {
    const quality = test.metadata?.qualityFlags?.join(', ') || '-';
    console.log(
      `${test.id.slice(0, 17).padEnd(18)} | ${test.testDate} | ${test.testType.padEnd(5)} | ${test.sport.padEnd(9)} | ${String(test.data.length).padEnd(6)} | ${quality}`
    );
  }

  console.log('');
}

export { runList };
