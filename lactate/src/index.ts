#!/usr/bin/env node

import { Command } from 'commander';
import { createImportCommand } from './cli/import';
import { createQueryCommand } from './cli/query';
import { createListCommand } from './cli/list';

const program = new Command();

program
  .name('lactate')
  .description('Lightweight lactate analysis tool for Engram Coach')
  .version('1.0.0');

program.addCommand(createImportCommand());
program.addCommand(createQueryCommand());
program.addCommand(createListCommand());

export { LactateStorage, SpotTestOrderStorage } from './storage';
export { LactateAnalyzer, createAnalyzer } from './analysis';
export * from './types';

if (require.main === module) {
  program.parse(process.argv);
}
