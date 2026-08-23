import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { resolve } from 'path';

const script = resolve(import.meta.dirname, 'tsb-predict.ts');

function run(args: string): { stdout: string; parsed: unknown } {
  const stdout = execSync(`npx tsx ${script} ${args}`, {
    encoding: 'utf-8',
    cwd: resolve(import.meta.dirname),
  });
  return { stdout, parsed: JSON.parse(stdout) };
}

describe('CLI', () => {
  it('produces JSON output for basic invocation', () => {
    const { parsed } = run('--ctl 80 --atl 60 --tss 100');
    expect(parsed).toHaveProperty('initial');
    expect(parsed).toHaveProperty('projections');
  });

  it('handles multi-day TSS sequence', () => {
    const { parsed } = run('--ctl 80 --atl 60 --tss 100,0,50') as { parsed: { projections: unknown[] } };
    expect(parsed.projections).toHaveLength(3);
  });

  it('accepts custom time constants', () => {
    const { parsed } = run('--ctl 80 --atl 60 --tss 100 --ctl-tau 30 --atl-tau 5');
    expect(parsed).toHaveProperty('projections');
  });

  it('exits with error on missing required args', () => {
    expect(() => run('--ctl 80')).toThrow();
  });
});
