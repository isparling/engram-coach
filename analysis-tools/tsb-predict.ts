import { fileURLToPath } from 'url';
import { resolve } from 'path';

interface DayProjection {
  day: number;
  tss: number;
  ctl: number;
  atl: number;
  tsb: number;
}

interface Projection {
  initial: { ctl: number; atl: number; tsb: number };
  projections: DayProjection[];
}

interface ProjectionOptions {
  ctlTau?: number;
  atlTau?: number;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function projectTSB(
  ctl: number,
  atl: number,
  tssSequence: number[],
  options?: ProjectionOptions,
): Projection {
  const ctlTau = options?.ctlTau ?? 42;
  const atlTau = options?.atlTau ?? 7;

  const projections: DayProjection[] = [];
  let currentCtl = ctl;
  let currentAtl = atl;

  for (let i = 0; i < tssSequence.length; i++) {
    const tss = tssSequence[i];
    currentCtl = currentCtl * (1 - 1 / ctlTau) + tss / ctlTau;
    currentAtl = currentAtl * (1 - 1 / atlTau) + tss / atlTau;
    const roundedCtl = round1(currentCtl);
    const roundedAtl = round1(currentAtl);
    projections.push({
      day: i + 1,
      tss,
      ctl: roundedCtl,
      atl: roundedAtl,
      tsb: round1(roundedCtl - roundedAtl),
    });
  }

  return {
    initial: { ctl, atl, tsb: round1(ctl - atl) },
    projections,
  };
}

// --- CLI entry point ---
function parseArgs(args: string[]): {
  ctl: number;
  atl: number;
  tss: number[];
  ctlTau?: number;
  atlTau?: number;
} {
  const flagValue = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
  };

  const ctl = flagValue('--ctl');
  const atl = flagValue('--atl');
  const tss = flagValue('--tss');

  if (ctl === undefined || atl === undefined || tss === undefined) {
    process.stderr.write(
      'Usage: tsb-predict --ctl <number> --atl <number> --tss <n1,n2,...> [--ctl-tau <n>] [--atl-tau <n>]\n',
    );
    process.exit(1);
  }

  const ctlNum = Number(ctl);
  const atlNum = Number(atl);
  if (isNaN(ctlNum) || isNaN(atlNum)) {
    process.stderr.write('Error: --ctl and --atl must be numbers\n');
    process.exit(1);
  }

  const tssValues = tss.split(',').map(Number);
  if (tssValues.some(isNaN)) {
    process.stderr.write('Error: --tss values must be numbers (e.g., --tss 100,0,50)\n');
    process.exit(1);
  }

  return {
    ctl: ctlNum,
    atl: atlNum,
    tss: tssValues,
    ctlTau: flagValue('--ctl-tau') ? Number(flagValue('--ctl-tau')) : undefined,
    atlTau: flagValue('--atl-tau') ? Number(flagValue('--atl-tau')) : undefined,
  };
}

// Only run CLI when executed directly (not imported)
const isDirectExecution =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isDirectExecution) {
  const parsed = parseArgs(process.argv.slice(2));
  const result = projectTSB(parsed.ctl, parsed.atl, parsed.tss, {
    ctlTau: parsed.ctlTau,
    atlTau: parsed.atlTau,
  });
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
