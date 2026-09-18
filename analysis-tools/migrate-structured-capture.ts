/**
 * Dry-run migration CLI for legacy coaching data.
 *
 * Modes (all dry-run unless apply-baseline):
 *
 *   migrate-structured-capture scan --config <path>
 *       Plan stable session IDs + generated headers for every legacy
 *       prescription and compatibility log. Prints the plan JSON to stdout;
 *       mutates nothing.
 *
 *   migrate-structured-capture apply-baseline --plan <scan.json> --expect <after-hash>
 *       Writes ONLY the planned ID insertions and warning headers. Refuses
 *       when the aggregate hash mismatches or any file drifted since scan.
 *
 *   migrate-structured-capture emit-change-set --config <path> --output <change-set.json>
 *       Plans the legacy import (prescription states + consultation events)
 *       and writes the StructuredChangeSet JSON. Mutates nothing.
 *
 *   migrate-structured-capture compare --config <path> --render-root <temporary-root>
 *       Renders the record-derived compatibility views into the given root
 *       and byte-compares them against the current source files. Exits 0 on
 *       byte equality, 1 listing every differing relative path. Mutates
 *       nothing outside the render root.
 *
 * @module analysis-tools/migrate-structured-capture
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { loadEngramCoachConfig, EngramCoachConfigError } from "../engram-coach-config.ts";
import {
  applyBaseline,
  migrationActiveRecords,
  planLegacyImport,
  readConcernRegistry,
  readConsultationSources,
  scanBaseline,
  MigrationError,
  type BaselineRoots,
  type BaselineScan,
} from "../engram-coach-migration.ts";
import { computeDesiredViews } from "../engram-coach-materialization.ts";

function usage(): string {
  return [
    "Usage:",
    "  migrate-structured-capture scan --config <path>",
    "  migrate-structured-capture apply-baseline --plan <scan.json> --expect <after-hash>",
    "  migrate-structured-capture emit-change-set --config <path> --output <change-set.json>",
    "  migrate-structured-capture compare --config <path> --render-root <temporary-root>",
  ].join("\n");
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

/** Simple argv flag reader: `--name value` pairs plus positional mode. */
function parseArgs(argv: string[]): { mode: string; flags: Map<string, string> } {
  // npm exec passes a bare `--` separator before script args; strip it.
  const [first, ...tail] = argv[0] === "--" ? argv.slice(1) : argv;
  const mode = first ?? "help";
  const rest = mode === "--help" || mode === "-h" ? ["help"] : tail;
  const flags = new Map<string, string>();
  for (const [index, arg] of rest.entries()) {
    if (!arg.startsWith("--")) continue;
    if (arg === "--help" || arg === "-h") continue;
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) fail(`missing value for ${arg}\n${usage()}`);
    flags.set(arg.slice(2), value);
  }
  return { mode, flags };
}

function requireFlag(flags: Map<string, string>, name: string): string {
  const value = flags.get(name);
  if (value === undefined) fail(`missing required flag --${name}\n${usage()}`);
  return value;
}

/** Config dirs may be relative; they resolve against the working directory. */
function resolveRoot(dir: string): string {
  return isAbsolute(dir) ? dir : resolve(process.cwd(), dir);
}

async function loadRoots(configPath: string): Promise<BaselineRoots> {
  const config = await loadEngramCoachConfig({ env: { ENGRAM_COACH_CONFIG: configPath } });
  return {
    prescriptionsDir: resolveRoot(config.prescriptionsDir),
    coachingDocsDir: resolveRoot(config.coachingDocsDir),
  };
}
async function readSources(roots: BaselineRoots): Promise<{
  prescriptions: Array<{ relativePath: string; text: string }>;
  consultations: Array<{ relativePath: string; text: string }>;
  monitoring: Array<{ relativePath: string; text: string }>;
  monitoringConcernLogPaths: Record<string, string>;
}> {
  const declarations = await readConcernRegistry(roots.coachingDocsDir);
  const monitoringConcernLogPaths: Record<string, string> = {};
  for (const declaration of declarations) {
    monitoringConcernLogPaths[declaration.concernId] = declaration.logPath;
  }
  let names: string[] = [];
  try {
    names = await readdir(roots.prescriptionsDir);
  } catch {
    names = [];
  }
  const prescriptions: Array<{ relativePath: string; text: string }> = [];
  for (const name of names.filter((entry) => /\.ya?ml$/.test(entry)).sort()) {
    prescriptions.push({
      relativePath: name,
      text: await readFile(join(roots.prescriptionsDir, name), "utf8"),
    });
  }
  const candidates = new Set<string>(Object.values(monitoringConcernLogPaths));
  // Monitoring: every declared concern log plus any generated shared view
  // under monitoring/ (Doctor-Prep summaries are derived output, never
  // imported).
  try {
    for (const name of await readdir(join(roots.coachingDocsDir, "monitoring"))) {
      if (/\.md$/.test(name) && !/^doctor-prep/i.test(name)) candidates.add(`monitoring/${name}`);
    }
  } catch {
    // No monitoring directory — nothing to import.
  }
  // Monitoring ownership is resolved BEFORE consultation discovery so a
  // monitoring artifact named consultations.md is imported once, as
  // monitoring, instead of also becoming a consultation event.
  const consultations = await readConsultationSources(roots.coachingDocsDir, {
    reservedPaths: candidates,
  });
  const monitoring: Array<{ relativePath: string; text: string }> = [];
  for (const relativePath of [...candidates].sort()) {
    const text = await readFile(join(roots.coachingDocsDir, relativePath), "utf8").catch(() => null);
    if (text !== null) monitoring.push({ relativePath, text });
  }
  return { prescriptions, consultations, monitoring, monitoringConcernLogPaths };
}

/**
 * Renders the record-derived views into `renderRoot` and byte-compares each
 * against the current source file at its mapped location. Returns the exit
 * code: 0 when everything matches, 1 with printed differing paths otherwise.
 */
async function runCompare(roots: BaselineRoots, renderRoot: string): Promise<number> {
  const records = migrationActiveRecords(planLegacyImport(await readSources(roots)));
  if (records.length === 0) {
    console.log("nothing imported — no compatibility views to compare");
    return 0;
  }
  const appliedAt = records
    .map((record) => record.submittedAt)
    .reduce((latest, at) => (at > latest ? at : latest));
  const { views, stale } = computeDesiredViews(records, appliedAt, roots.coachingDocsDir, roots.prescriptionsDir);
  for (const staleEntry of stale) {
    console.error(`STALE ${staleEntry.path}: ${staleEntry.reason}`);
  }

  const differences: string[] = [];
  for (const view of views) {
    const renderedPath = join(renderRoot, view.relativePath);
    await mkdir(dirname(renderedPath), { recursive: true });
    await writeFile(renderedPath, view.content, "utf8");
    const current = await readFile(view.absoluteTarget, "utf8").catch(() => null);
    if (current !== view.content) differences.push(view.relativePath);
  }

  if (differences.length > 0 || stale.length > 0) {
    for (const path of [...stale.map((entry) => entry.path), ...differences]) {
      console.log(`DIFF ${path}`);
    }
    return 1;
  }
  console.log(`all ${views.length} compatibility view(s) match byte-for-byte`);
  return 0;
}

export async function main(argv: string[]): Promise<number> {
  const { mode, flags } = parseArgs(argv);
  switch (mode) {
    case "scan": {
      const roots = await loadRoots(requireFlag(flags, "config"));
      console.log(JSON.stringify(await scanBaseline(roots), null, 2));
      return 0;
    }
    case "apply-baseline": {
      // Plan-only by design: the scan carries the artifact roots it was
      // built from, so application needs exactly --plan and --expect.
      const scan = JSON.parse(await readFile(requireFlag(flags, "plan"), "utf8")) as BaselineScan;
      const outcome = await applyBaseline(scan, requireFlag(flags, "expect"));
      console.log(
        JSON.stringify({ afterHash: outcome.afterHash, written: outcome.written, unchanged: outcome.unchanged }, null, 2),
      );
      return 0;
    }
    case "emit-change-set": {
      const roots = await loadRoots(requireFlag(flags, "config"));
      const output = requireFlag(flags, "output");
      const changeSets = planLegacyImport(await readSources(roots));
      await mkdir(dirname(output), { recursive: true });
      await writeFile(output, JSON.stringify(changeSets, null, 2) + "\n", "utf8");
      const states = changeSets.reduce((sum, set) => sum + set.state_changes.length, 0);
      const events = changeSets.reduce((sum, set) => sum + set.events.length, 0);
      console.log(`wrote ${changeSets.length} change set(s): ${states} state change(s), ${events} event(s) to ${output}`);
      return 0;
    }
    case "compare": {
      const roots = await loadRoots(requireFlag(flags, "config"));
      return runCompare(roots, requireFlag(flags, "render-root"));
    }
    case "--help":
    case "-h":
    case "help":
      console.log(usage());
      return 0;
    default:
      fail(`unknown mode "${mode}"\n${usage()}`);
  }
}

// Only auto-run when executed directly, never under vitest imports.
if (process.argv[1] !== undefined && import.meta.url.endsWith(basename(process.argv[1]))) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      if (error instanceof MigrationError || error instanceof EngramCoachConfigError) fail(error.message);
      throw error;
    });
}
