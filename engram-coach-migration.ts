/**
 * engram-coach idempotent legacy migration planning.
 *
 * Two concerns, both dry-run by default:
 *
 * 1. Baseline ID insertion — every prescription session gains a durable
 *    `session_id` (inserted before `week`) and every compatibility file
 *    gains the exact generated-warning header, preserving every other byte
 *    (comments, quoting, ordering). Application is hash-bound: the caller
 *    must present the `afterHash` shown during preview, and the on-disk
 *    bytes must still hash to the previewed `beforeHash`.
 * 2. Legacy import planning — existing prescription sessions become ONE
 *    state change each; consultation history becomes append-only events.
 *    Source identity derives from the normalized relative path plus the
 *    YAML/markdown entry index, so reruns are stable and never duplicate.
 *
 * @module engram-coach-migration
 */

import type { Dirent } from "node:fs";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import type { YAMLMap } from "yaml";
import type { JsonObject, JsonValue } from "@isparling/engram-harness/knowledge-types";
import {
  SCHEMA_VERSION,
  type StructuredChangeSet,
  type StructuredEvent,
  type StructuredStateChange,
} from "./engram-coach-capture-types.ts";

/** Exact generated warning headers, byte-identical to the materializers. */
export const GENERATED_PRESCRIPTION_HEADER =
  "# GENERATED FROM ENGRAM ACTIVE RECORDS. DO NOT EDIT DIRECTLY.\n";
export const GENERATED_MARKDOWN_HEADER =
  "<!-- GENERATED FROM ENGRAM ACTIVE RECORDS. DO NOT EDIT DIRECTLY. -->\n";

/** Skill recorded on migration change sets (import runs through intake). */
export const MIGRATION_SKILL = "intake" as const;

/** Raised on structurally invalid legacy input or refused applications. */
export class MigrationError extends Error {}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/**
 * Deterministic workout identity for a legacy session with no explicit
 * `session_id`: derived from the normalized relative path plus the
 * zero-based session index, so the same file always yields the same ID.
 */
export function migratedSessionId(relativePath: string, index: number): string {
  const sourceId = `prescription:${relativePath}#sessions/${index}`;
  return `workout-${createHash("sha256").update(sourceId).digest("hex").slice(0, 16)}`;
}

// ---------------------------------------------------------------------------
// Baseline planning (stable IDs + warning headers)
// ---------------------------------------------------------------------------

export type BaselineFilePlan = {
  /** Path of the file relative to its artifact root. */
  relativePath: string;
  beforeHash: string;
  afterHash: string;
  beforeText: string;
  afterText: string;
  changed: boolean;
};

type IdInsertion = { offset: number; text: string };

/**
 * Plans one prescription baseline: prepend the generated header when
 * missing, assign deterministic `session_id` values before `week` for every
 * session lacking one, preserve every other byte. Duplicate explicit IDs
 * fail hard instead of silently renaming.
 */
export function planPrescriptionBaseline(relativePath: string, text: string): BaselineFilePlan {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    throw new MigrationError(`${relativePath}: unparseable prescription YAML (${doc.errors[0]?.message ?? "unknown"})`);
  }
  const sessions = doc.get("sessions", true);
  if (!isSeq(sessions)) {
    throw new MigrationError(`${relativePath}: no sessions list`);
  }

  const explicitIds: string[] = [];
  for (const item of sessions.items) {
    if (!isMap(item)) continue;
    const raw = item.get("session_id", true);
    if (raw !== undefined && typeof raw.value === "string" && raw.value.trim().length > 0) {
      explicitIds.push(raw.value);
    }
  }
  const seen = new Set<string>();
  for (const id of explicitIds) {
    if (seen.has(id)) {
      throw new MigrationError(`${relativePath}: duplicate session_id "${id}" — fix the source file by hand`);
    }
    seen.add(id);
  }

  const insertions: IdInsertion[] = [];
  sessions.items.forEach((item, index) => {
    if (!isMap(item)) return;
    // Validate every pair up front — before any early return — because a
    // keyless pair anywhere in the session mapping makes the source
    // structurally unusable even when that session already has an ID and
    // `week` would anchor fine.
    for (const pair of item.items) {
      const key = pair.key;
      // YAML admits two no-key shapes: a pair with no key node at all and
      // an explicitly empty (`:`-only) key. Either makes the session
      // structurally unusable, so raise instead of silently skipping.
      if (key == null || (isScalar(key) && key.value == null)) {
        throw new MigrationError(`${relativePath}: session ${index} has a malformed entry with no key`);
      }
    }
    const existing = item.get("session_id", true);
    if (existing !== undefined && typeof existing.value === "string" && existing.value.trim().length > 0) return;
    const offset = findKeyOffset(item, "week");
    if (offset === null) {
      throw new MigrationError(`${relativePath}: session ${index} has no week field to anchor session_id`);
    }
    const indent = lineIndent(text, offset);
    const id = migratedSessionId(relativePath, index);
    if (seen.has(id)) {
      throw new MigrationError(`${relativePath}: derived session_id "${id}" collides with an existing ID`);
    }
    seen.add(id);
    insertions.push({ offset, text: `session_id: ${id}\n${indent}` });
  });

  let body = text;
  for (const insertion of [...insertions].sort((left, right) => right.offset - left.offset)) {
    body = body.slice(0, insertion.offset) + insertion.text + body.slice(insertion.offset);
  }
  const afterText = text.startsWith(GENERATED_PRESCRIPTION_HEADER) ? body : GENERATED_PRESCRIPTION_HEADER + body;
  const changed = afterText !== text;
  return {
    relativePath,
    beforeHash: sha256Hex(text),
    afterHash: sha256Hex(afterText),
    beforeText: text,
    afterText,
    changed,
  };
}

/**
 * Plans a Markdown compatibility-log baseline: only the generated warning
 * header is added when missing; content, entries, and comments are untouched.
 */
export function planMarkdownLogBaseline(relativePath: string, text: string): BaselineFilePlan {
  const afterText = text.startsWith(GENERATED_MARKDOWN_HEADER) ? text : GENERATED_MARKDOWN_HEADER + text;
  const changed = afterText !== text;
  return {
    relativePath,
    beforeHash: sha256Hex(text),
    afterHash: sha256Hex(afterText),
    beforeText: text,
    afterText,
    changed,
  };
}

/** Start offset of the scalar key exactly equal to `name` on a parsed mapping, or null when no pair provides a usable anchor. */
function findKeyOffset(map: YAMLMap, name: string): number | null {
  for (const pair of map.items) {
    const key = pair.key;
    if (key === null || !isScalar(key) || key.value !== name || key.range == null) continue;
    return key.range[0];
  }
  return null;
}

/** Whitespace prefix of the line containing `offset`. */
function lineIndent(text: string, offset: number): string {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  // Continuation lines must align with the anchor key's column, not the
  // line's leading whitespace — `week` may sit after a `- ` sequence dash.
  return " ".repeat(Math.max(0, offset - lineStart));
}

// ---------------------------------------------------------------------------
// Scan / apply over artifact roots
// ---------------------------------------------------------------------------

export type BaselineRoots = {
  prescriptionsDir: string;
  coachingDocsDir: string;
};

export type BaselineScan = {
  /** Artifact roots captured at scan time so apply-baseline needs no config. */
  roots: BaselineRoots;
  /** Aggregate hash binding the whole plan: SHA-256 over canonical JSON of per-file `{relativePath, afterHash}` rows. */
  afterHash: string;
  files: Array<{ rootKind: "prescriptions" | "coaching-docs"; plan: BaselineFilePlan }>;
};


async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

export type ConsultationSource = {
  relativePath: string;
  text: string;
};

const CONSULTATION_LOG_FILENAME = "consultations.md";

/** Node errno code, when the thrown value carries one. */
function errnoCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = error.code;
  return typeof code === "string" ? code : null;
}

/**
 * Recursively reads every consultation log below the coaching docs root.
 *
 * An absent root is a clean no-op; every other traversal failure propagates,
 * so a permission or I/O error can never present an incomplete corpus as a
 * complete migration. Symlinked entries are skipped rather than followed,
 * which keeps traversal free of cycles and root escapes.
 *
 * `reservedPaths` yields ownership to a caller that already claims a path —
 * registry-declared monitoring artifacts — so one file is never planned
 * twice under two entity types.
 */
export async function readConsultationSources(
  coachingDocsDir: string,
  options: { reservedPaths?: ReadonlySet<string> } = {},
): Promise<ConsultationSource[]> {
  const reserved = options.reservedPaths ?? new Set<string>();
  const sources: ConsultationSource[] = [];

  async function visit(absoluteDir: string, relativeDir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(absoluteDir, { withFileTypes: true });
    } catch (error) {
      if (errnoCode(error) === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      const relativePath =
        relativeDir.length === 0 ? entry.name : `${relativeDir}/${entry.name}`;
      if (entry.isDirectory()) {
        await visit(join(absoluteDir, entry.name), relativePath);
        continue;
      }
      if (
        !entry.isFile() ||
        entry.name !== CONSULTATION_LOG_FILENAME ||
        reserved.has(relativePath)
      ) {
        continue;
      }
      const text = await readIfExists(join(absoluteDir, entry.name));
      if (text !== null) sources.push({ relativePath, text });
    }
  }

  await visit(coachingDocsDir, "");
  // Code-unit ordering, not locale collation: the plan order and its
  // aggregate hash must be identical on every host.
  sources.sort((left, right) =>
    left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0,
  );
  return sources;
}

/** Relative paths the monitoring migration owns: declared logs and summaries. */
function monitoringOwnedPaths(
  declarations: readonly MonitoringConcernDeclaration[],
): string[] {
  return [
    ...new Set(
      declarations.flatMap((declaration) =>
        [declaration.logPath, declaration.doctorPrepPath].filter(
          (path): path is string => path !== null,
        ),
      ),
    ),
  ].sort();
}

/**
 * Dry-run scan of every legacy prescription, compatibility log, and
 * registry-declared monitoring artifact (concern logs plus Doctor-Prep
 * summaries) under the configured roots. Never mutates anything.
 */
export async function scanBaseline(roots: BaselineRoots): Promise<BaselineScan> {
  const files: BaselineScan["files"] = [];
  let names: string[] = [];
  try {
    names = await readdir(roots.prescriptionsDir);
  } catch {
    names = [];
  }
  for (const name of names.filter((entry) => /\.ya?ml$/.test(entry)).sort()) {
    const text = await readIfExists(join(roots.prescriptionsDir, name));
    if (text === null) continue;
    files.push({ rootKind: "prescriptions", plan: planPrescriptionBaseline(name, text) });
  }
  // Monitoring ownership is resolved BEFORE consultation discovery so a
  // declared artifact named consultations.md is planned once, as monitoring.
  const declarations = await readConcernRegistry(roots.coachingDocsDir);
  const monitoringPaths = monitoringOwnedPaths(declarations);
  const consultations = await readConsultationSources(roots.coachingDocsDir, {
    reservedPaths: new Set(monitoringPaths),
  });
  for (const source of consultations) {
    files.push({
      rootKind: "coaching-docs",
      plan: planMarkdownLogBaseline(source.relativePath, source.text),
    });
  }

  // Registry-driven monitoring artifacts join the SAME hash-bound baseline
  // plan: every declared concern log and Doctor-Prep Summary gets the
  // generated header (header-only, content untouched) before cutover.
  for (const relativePath of monitoringPaths) {
    const text = await readIfExists(join(roots.coachingDocsDir, relativePath));
    if (text === null) continue;
    files.push({ rootKind: "coaching-docs", plan: planMarkdownLogBaseline(relativePath, text) });
  }

  const afterHash = scanAfterHash(files);
  return { roots, afterHash, files };
}

function scanAfterHash(files: BaselineScan["files"]): string {
  const rows = files.map((entry) => ({
    relativePath: entry.plan.relativePath,
    afterHash: entry.plan.afterHash,
  }));
  return sha256Hex(JSON.stringify(rows));
}

export type AppliedBaselineEntry = { relativePath: string; written: boolean };
export type AppliedBaseline = {
  afterHash: string;
  written: AppliedBaselineEntry[];
  unchanged: string[];
};

/**
 * Applies a scanned baseline to disk. Refuses unless the presented hash
 * matches the scan's aggregate `afterHash` AND every file still hashes to
 * its planned `beforeHash` — any drift means the athlete must re-scan.
 */
export async function applyBaseline(
  scan: BaselineScan,
  expectAfterHash: string,
): Promise<AppliedBaseline> {
  const roots = scan.roots;
  if (expectAfterHash !== scan.afterHash) {
    throw new MigrationError(
      `after-hash mismatch: plan expects ${scan.afterHash}, got ${expectAfterHash} — re-run scan`,
    );
  }
  // Plan self-integrity: every planned text must still hash to its own
  // afterHash, so a tampered or corrupted plan file is refused even when its
  // aggregate hash was recomputed consistently around the tampering.
  const inconsistent = scan.files.filter((entry) => sha256Hex(entry.plan.afterText) !== entry.plan.afterHash);
  if (inconsistent.length > 0) {
    throw new MigrationError(
      `refusing to apply: plan afterText does not match its own afterHash for: ${inconsistent.map((e) => e.plan.relativePath).join(", ")}`,
    );
  }
  const stale: string[] = [];
  for (const entry of scan.files) {
    const absolute = entry.rootKind === "prescriptions"
      ? join(roots.prescriptionsDir, basenamePrescription(entry.plan.relativePath))
      : join(roots.coachingDocsDir, entry.plan.relativePath);
    const current = await readFile(absolute, "utf8").catch(() => null);
    if (current === null || sha256Hex(current) !== entry.plan.beforeHash) {
      stale.push(entry.plan.relativePath);
    }
  }
  if (stale.length > 0) {
    throw new MigrationError(`refusing to apply: source files changed since scan: ${stale.join(", ")}`);
  }
  const written: AppliedBaselineEntry[] = [];
  const unchanged: string[] = [];
  for (const entry of scan.files) {
    if (!entry.plan.changed) {
      unchanged.push(entry.plan.relativePath);
      continue;
    }
    const absolute = entry.rootKind === "prescriptions"
      ? join(roots.prescriptionsDir, basenamePrescription(entry.plan.relativePath))
      : join(roots.coachingDocsDir, entry.plan.relativePath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, entry.plan.afterText, "utf8");
    written.push({ relativePath: entry.plan.relativePath, written: true });
  }
  return { afterHash: scan.afterHash, written, unchanged };
}

/** Prescription plans are keyed by bare filename within the flat prescriptions dir. */
function basenamePrescription(relativePath: string): string {
  return basename(relativePath);
}

// ---------------------------------------------------------------------------
// Legacy import planning (StructuredChangeSet)
// ---------------------------------------------------------------------------

function migrationSourceSessionId(relativePath: string): string {
  const digest = createHash("sha256").update(relativePath).digest("hex").slice(0, 16);
  return `migration-${digest}`;
}

function singleLine(raw: string): string {
  return raw.replace(/[\r\n]+/g, " ").trim();
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Recursively converts an unknown value into the JSON data model. Returns
 * undefined when the value itself is outside the model (undefined, function,
 * symbol, bigint, non-finite number); nested out-of-model entries are dropped.
 * Cyclic references — reachable from YAML anchors/aliases — are dropped the
 * same way, via the set of containers on the current conversion path.
 */
function toJsonValue(value: unknown, ancestors: Set<object> = new Set()): JsonValue | undefined {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  if (typeof value !== "object" || ancestors.has(value)) return undefined;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const entries: JsonValue[] = [];
      for (const entry of value) {
        const converted = toJsonValue(entry, ancestors);
        if (converted !== undefined) entries.push(converted);
      }
      return entries;
    }
    const objectValue: JsonObject = {};
    for (const [key, entry] of Object.entries(value)) {
      const converted = toJsonValue(entry, ancestors);
      if (converted !== undefined) objectValue[key] = converted;
    }
    return objectValue;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Converts one parsed legacy session into the camelCase materializer value
 * shape (`details.value`), carrying provenance metadata alongside.
 */
function sessionValue(
  raw: { [key: string]: unknown },
  meta: { arcId: string; sessionId: string; order: number; relativePath: string },
  docMeta: { blockName: string; goal: JsonValue | null },
): JsonObject {
  const value: JsonObject = {
    blockName: docMeta.blockName,
    sessionId: meta.sessionId,
    order: meta.order,
    week: asNumber(raw.week),
    day: singleLine(asString(raw.day) ?? ""),
    sessionDate: asString(raw.session_date) ?? "",
    sessionName: singleLine(asString(raw.session_name) ?? ""),
  };
  if (asString(raw.modality) !== null) value.modality = raw.modality as string;
  if (asNumber(raw.total_duration_min) !== null) value.totalDurationMin = raw.total_duration_min as number;
  if (asString(raw.effort_zone) !== null) value.effortZone = raw.effort_zone as string;
  // Document-level goal wins; a per-session goal is honored as fallback.
  // toJsonValue cuts alias cycles instead of overflowing on them.
  const goalSource = docMeta.goal !== null ? docMeta.goal : raw.goal;
  if (goalSource !== undefined && goalSource !== null && typeof goalSource === "object") {
    const goalValue = toJsonValue(goalSource);
    if (goalValue !== undefined) value.goal = goalValue;
  }
  const warmup = powerBandField(raw.warmup_power_low_pct, raw.warmup_power_high_pct);
  if (warmup !== null) value.warmup = warmup;
  const cooldown = powerBandField(raw.cooldown_power_low_pct, raw.cooldown_power_high_pct);
  if (cooldown !== null) value.cooldown = cooldown;
  if (Array.isArray(raw.intervals)) {
    value.intervals = raw.intervals.map((interval) => intervalValue(interval));
  }
  value.artifactRelativePath = meta.relativePath;
  value.sourcePath = meta.relativePath;
  return value;
}

function intervalValue(raw: unknown): JsonObject {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const interval = raw as { [key: string]: unknown };
  const value: JsonObject = {
    durationMin: asNumber(interval.duration_min),
    powerLowPct: asNumber(interval.power_low_pct),
    powerHighPct: asNumber(interval.power_high_pct),
    count: asNumber(interval.count),
    recoveryMin: asNumber(interval.recovery_min),
  };
  if (asNumber(interval.recovery_power_low_pct) !== null) {
    value.recoveryPowerLowPct = interval.recovery_power_low_pct as number;
  }
  if (asNumber(interval.recovery_power_high_pct) !== null) {
    value.recoveryPowerHighPct = interval.recovery_power_high_pct as number;
  }
  return value;
}

function powerBandField(low: unknown, high: unknown): JsonObject | null {
  if (asNumber(low) === null && asNumber(high) === null) return null;
  const band: JsonObject = {};
  if (asNumber(low) !== null) band.powerLowPct = low as number;
  if (asNumber(high) !== null) band.powerHighPct = high as number;
  return band;
}

/** Arc ID for one prescription file: the bare filename without extension. */
export function arcIdFor(relativePath: string): string {
  return basename(relativePath).replace(/\.ya?ml$/, "");
}

/**
 * Maps every session of one legacy prescription to exactly ONE state change
 * with full `details.value`, arc/session key components, block metadata, and
 * order. Throws {@link MigrationError} on structurally unusable input.
 */
export function planPrescriptionImport(relativePath: string, text: string): StructuredStateChange[] {
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    throw new MigrationError(`${relativePath}: unparseable prescription YAML (${doc.errors[0]?.message ?? "unknown"})`);
  }
  const parsed = doc.toJS() as { [key: string]: unknown };
  const blockName = asString(parsed.block_name);
  const rawSessions = parsed.sessions;
  if (!Array.isArray(rawSessions) || rawSessions.length === 0) {
    throw new MigrationError(`${relativePath}: no sessions list`);
  }
  const arcId = arcIdFor(relativePath);
  return rawSessions.map((rawUnknown, index): StructuredStateChange => {
    if (typeof rawUnknown !== "object" || rawUnknown === null || Array.isArray(rawUnknown)) {
      throw new MigrationError(`${relativePath}: session ${index} is not a mapping`);
    }
    const raw = rawUnknown as { [key: string]: unknown };
    const sessionId = asString(raw.session_id)?.trim() || migratedSessionId(relativePath, index);
    const effectiveAt = asString(raw.session_date);
    if (effectiveAt === null || Number.isNaN(Date.parse(effectiveAt))) {
      throw new MigrationError(`${relativePath}: session ${index} has no parseable session_date`);
    }
    const sessionName = singleLine(asString(raw.session_name) ?? `session ${index}`);
    const statement = singleLine(`Legacy planned session ${sessionName} (${blockName ?? arcId}) on ${effectiveAt}`);
    return {
      entity_type: "prescription",
      key_components: { arc_id: arcId, session_id: sessionId },
      effective_at: effectiveAt,
      statement,
      details: sessionValue(raw, { arcId, sessionId, order: index, relativePath }, {
        blockName: singleLine(blockName ?? arcId),
        goal: typeof parsed.goal === "object" && parsed.goal !== null ? (parsed.goal as JsonValue) : null,
      }),
    };
  });
}

const EARLIEST_ISO_DATE = /\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?/;
const UNPARSEABLE_EFFECTIVE_AT = "1970-01-01";

function earliestDateIn(text: string): string {
  const match = EARLIEST_ISO_DATE.exec(text);
  const candidate = match?.[0];
  return candidate !== undefined && !Number.isNaN(Date.parse(candidate)) ? candidate : UNPARSEABLE_EFFECTIVE_AT;
}

/**
 * Maps legacy consultation history to append-only events, one per
 * `## `-heading entry; when no entry boundaries exist the entire file is
 * imported as ONE event carrying `details.value.legacyMarkdown` verbatim
 * rather than inventing structure.
 */
export function planConsultationImport(relativePath: string, text: string): StructuredEvent[] {
  const content = text.startsWith(GENERATED_MARKDOWN_HEADER)
    ? text.slice(GENERATED_MARKDOWN_HEADER.length)
    : text;
  if (content.trim().length === 0) return [];
  const lines = content.split("\n");
  const headings: number[] = [];
  for (const [index, line] of lines.entries()) {
    if (/^##\s+\S/.test(line)) headings.push(index);
  }
  if (headings.length === 0) {
    return [
      {
        entity_type: "consultation",
        effective_at: earliestDateIn(content),
        statement: "Legacy consultation history imported verbatim",
        action_targets: [],
        details: {
          legacyMarkdown: content,
          sourcePath: relativePath,
          compatibility_path: relativePath,
        },
      },
    ];
  }
  return headings.map((start, position): StructuredEvent => {
    const end = position + 1 < headings.length ? headings[position + 1] : lines.length;
    const headingRest = singleLine(lines[start].replace(/^##\s+/, ""));
    const firstToken = headingRest.split(/\s+/)[0] ?? "";
    const effectiveAt = !Number.isNaN(Date.parse(firstToken)) ? firstToken : earliestDateIn(lines.slice(start, end).join("\n"));
    const remainder = headingRest.slice(firstToken.length).replace(/^\s*[—-]\s*/, "").trim();
    const body = lines.slice(start + 1, end).join("\n").replace(/^\n/, "").trimEnd();
    const value: JsonObject = {
      legacyMarkdown: body.length > 0 ? body : headingRest,
      sourcePath: relativePath,
      compatibility_path: relativePath,
    };
    if (remainder.length > 0 && remainder !== headingRest) value.title = remainder;
    return {
      entity_type: "consultation",
      effective_at: effectiveAt,
      statement: remainder.length > 0 ? remainder : `Legacy consultation entry ${position}`,
      action_targets: [],
      details: value,
    };
  });
}

// ---------------------------------------------------------------------------
// Monitoring migration — registry-driven concern log / doctor-prep planning
// ---------------------------------------------------------------------------

/** One declared monitoring concern from `tracking/concerns.yaml`. */
export type MonitoringConcernDeclaration = {
  concernId: string;
  active: boolean;
  /** Concern log path relative to the coaching docs root. */
  logPath: string;
  /** Declared Doctor-Prep Summary path, when the registry declares one. */
  doctorPrepPath: string | null;
};

const CONCERNS_REGISTRY_RELPATH = "tracking/concerns.yaml";

function scalarField(map: YAMLMap, name: string): string | null {
  const value = map.get(name);
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Reads the declared monitoring-concern registry. An absent registry is a
 * clean no-op (`[]`); a malformed one raises instead of guessing.
 */
export async function readConcernRegistry(
  coachingDocsDir: string,
): Promise<MonitoringConcernDeclaration[]> {
  const text = await readIfExists(join(coachingDocsDir, CONCERNS_REGISTRY_RELPATH));
  if (text === null) return [];
  const doc = parseDocument(text);
  if (doc.errors.length > 0) {
    throw new MigrationError(`unparseable concerns registry (${doc.errors[0]?.message ?? "unknown"})`);
  }
  const root = doc.contents;
  if (!isMap(root)) {
    throw new MigrationError(`${CONCERNS_REGISTRY_RELPATH}: top level must be a mapping`);
  }
  const registryDoctorPrep = scalarField(root, "doctor_prep");
  const seq = root.get("concerns");
  if (seq === undefined) return [];
  if (!isSeq(seq)) {
    throw new MigrationError(`${CONCERNS_REGISTRY_RELPATH}: "concerns" must be a list`);
  }
  const declarations: MonitoringConcernDeclaration[] = [];
  for (const item of seq.items) {
    if (!isMap(item)) {
      throw new MigrationError(`${CONCERNS_REGISTRY_RELPATH}: every concern must be a mapping`);
    }
    const concernId = scalarField(item, "id");
    if (concernId === null) {
      throw new MigrationError(`${CONCERNS_REGISTRY_RELPATH}: a concern is missing its id`);
    }
    const active = item.get("active", true);
    const activeValue: unknown = isScalar(active) ? active.value : undefined;
    declarations.push({
      concernId,
      active: activeValue !== false,
      logPath: scalarField(item, "log") ?? `monitoring/${concernId}.md`,
      doctorPrepPath: scalarField(item, "doctor_prep") ?? registryDoctorPrep,
    });
  }
  return declarations;
}

// -- Entry parsing ----------------------------------------------------------

const MONITORING_SIGNAL_FALLBACK = "general";

/** Lower-case slug for human-readable signal names; empty input falls back. */
function slugSignal(raw: string): string {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  return slug.length > 0 ? slug : MONITORING_SIGNAL_FALLBACK;
}

type ParsedMonitoringEntry = {
  role: "state" | "event";
  effectiveAt: string;
  concernId: string;
  signal: string;
  status: string | null;
  note: string | null;
  /** Verbatim body of an unparseable legacy entry — never re-derived. */
  legacyMarkdown: string | null;
  /** Document order, used only as a tie-break for equal effective times. */
  order: number;
};

function tableCells(line: string): string[] {
  return line
    .replace(/^\s*\|/, "")
    .replace(/\|\s*$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function isTableLine(line: string): boolean {
  return /^\s*\|/.test(line);
}

/**
 * Parses one legacy concern-log (or generated monitoring view) into ordered
 * entries. Accepted forms:
 * - Markdown tables: header row maps columns (`date`, `signal`, `status`,
 *   `notes`/`note`); each data row becomes one typed observation event.
 *   Unrecognized columns ride inside the note as `name=value` pairs so no
 *   data silently drops.
 * - Generated grouped views: `## <concern> / <signal>` sections whose
 *   `- <date> state|event <sourceId> — status — note` bullets parse back
 *   into typed entries; any non-bullet prose block stays verbatim.
 * - Dated freeform sections: `## <date> — title` prose becomes ONE event
 *   preserving the body in `legacyMarkdown`.
 * `## Doctor-Prep Summary` sections are derived view content and are never
 * imported.
 */
export function planMonitoringEntries(
  fallbackConcernId: string,
  text: string,
): ParsedMonitoringEntry[] {
  const body = text.startsWith(GENERATED_MARKDOWN_HEADER)
    ? text.slice(GENERATED_MARKDOWN_HEADER.length)
    : text;
  const lines = body.split("\n");

  // Split into `## `-headed sections; leading content shares title null.
  const sections: Array<{ title: string | null; start: number; end: number }> = [];
  let currentTitle: string | null = null;
  let currentStart = 0;
  for (const [index, line] of lines.entries()) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading !== null) {
      sections.push({ title: currentTitle, start: currentStart, end: index });
      currentTitle = heading[1] ?? "";
      currentStart = index + 1;
    }
  }
  sections.push({ title: currentTitle, start: currentStart, end: lines.length });

  const entries: ParsedMonitoringEntry[] = [];
  let order = 0;
  const push = (entry: Omit<ParsedMonitoringEntry, "order">): void => {
    entries.push({ ...entry, order: order });
    order += 1;
  };

  for (const section of sections) {
    const sectionLines = lines.slice(section.start, section.end);
    if (section.title !== null && /doctor[- ]prep/i.test(section.title)) continue;

    const grouped = section.title === null ? null : /^([^/]+)\s*\/\s*(.+)$/.exec(section.title);
    if (grouped !== null) {
      const concernId = (grouped[1] ?? "").trim();
      const signal = slugSignal(grouped[2] ?? "");
      let block: string[] = [];
      const flushBlock = (): void => {
        const prose = block.join("\n").trimEnd();
        block = [];
        if (prose.length === 0) return;
        push({
          role: "event",
          effectiveAt: earliestDateIn(prose),
          concernId,
          signal,
          status: null,
          note: null,
          legacyMarkdown: prose,
        });
      };
      for (const line of sectionLines) {
        // Rendered monitoring lines are `- <date> <role> — <sourceId> —
        // status — note` (the renderer's first-dash rewrite); accept the
        // sourceId with or without the leading dash for robustness.
        const bullet = /^-\s+(\S+)\s+(state|event)\s+(?:—\s+)?\S+(?:\s+—\s+(.*))?$/.exec(line);
        if (bullet !== null) {
          flushBlock();
          const dateToken = bullet[1] ?? "";
          const remainder = bullet[3] ?? "";
          const parts = remainder.split(" — ");
          push({
            role: bullet[2] === "state" ? "state" : "event",
            effectiveAt: !Number.isNaN(Date.parse(dateToken))
              ? dateToken
              : earliestDateIn(line),
            concernId,
            signal,
            status: parts[0]?.length ? parts[0] : null,
            note: parts.length > 1 ? parts.slice(1).join(" — ") : null,
            legacyMarkdown: null,
          });
          continue;
        }
        if (isTableLine(line)) {
          flushBlock();
          continue;
        }
        if (line.trim().length === 0) {
          flushBlock();
          continue;
        }
        block.push(line);
      }
      flushBlock();
      continue;
    }

    // Legacy form: markdown tables plus dated freeform sections.
    const headerRow = sectionLines.findIndex((line) => isTableLine(line));
    if (headerRow >= 0) {
      const headers = tableCells(sectionLines[headerRow] ?? "").map((name) => name.toLowerCase());
      const column = (name: string): number => headers.indexOf(name);
      const dateColumn = column("date");
      const signalColumn = column("signal");
      const statusColumn = column("status");
      const noteColumn = headers.findIndex((name) => name === "notes" || name === "note");
      for (const line of sectionLines.slice(headerRow + 1)) {
        if (!isTableLine(line)) continue;
        const cells = tableCells(line);
        if (cells.every((cell) => /^[:\s-]*$/.test(cell))) continue; // separator row
        const cellAt = (index: number): string | null =>
          index >= 0 && index < cells.length && cells[index] !== undefined && cells[index] !== ""
            ? cells[index]
            : null;
        const extras: string[] = [];
        for (const [index, name] of headers.entries()) {
          if ([dateColumn, signalColumn, statusColumn, noteColumn].includes(index)) continue;
          const value = cellAt(index);
          if (value !== null) extras.push(`${name}=${value}`);
        }
        const noteParts = [cellAt(noteColumn), ...extras].filter((part) => part !== null);
        const date = cellAt(dateColumn);
        push({
          role: "event",
          effectiveAt:
            date !== null && !Number.isNaN(Date.parse(date))
              ? date
              : earliestDateIn(line),
          concernId: fallbackConcernId,
          signal: slugSignal(cellAt(signalColumn) ?? ""),
          status: cellAt(statusColumn),
          note: noteParts.length > 0 ? noteParts.join("; ") : null,
          legacyMarkdown: null,
        });
      }
      continue;
    }

    if (section.title !== null) {
      const prose = sectionLines.filter((line) => !isTableLine(line)).join("\n").trim();
      if (prose.length === 0) continue;
      const headingRest = section.title.replace(/^##\s+/, "");
      const firstToken = headingRest.split(/\s+/)[0] ?? "";
      push({
        role: "event",
        effectiveAt: !Number.isNaN(Date.parse(firstToken))
          ? firstToken
          : earliestDateIn(prose),
        concernId: fallbackConcernId,
        signal: slugSignal(/signal:\s*([A-Za-z0-9 _-]+)/.exec(prose)?.[1] ?? ""),
        status: null,
        note: null,
        legacyMarkdown: prose,
      });
    }
  }
  return entries;
}

function monitoringEventStatement(concernId: string, signal: string, effectiveAt: string): string {
  return `Observed ${concernId} ${signal} on ${effectiveAt}`;
}

function monitoringStateStatement(concernId: string, signal: string, status: string | null): string {
  return `Current ${concernId} ${signal} status: ${status ?? "unknown"}`;
}

/**
 * Deterministic change-set session ID for one (log path, concern, signal)
 * import partition: an item's identity therefore derives from the concern
 * ID, its signal, the declared relative path, and the per-role entry index.
 */
export function migratedMonitoringSourceSessionId(
  relativePath: string,
  concernId: string,
  signal: string,
): string {
  return migrationSourceSessionId(`${relativePath}#${concernId}#${signal}`);
}

/**
 * Plans the legacy monitoring import for ONE source file as one change set
 * per (concern × signal) partition. Typed rows become append-only
 * `monitoring-event` observations; when a signal has typed history but no
 * explicit current-state entry, its newest row additionally becomes the
 * keyed `monitoring:<concern-id>:<signal>` state. Unparseable bodies are
 * preserved verbatim in `details.value.legacyMarkdown`.
 *
 * Identity anchoring: every partition hashes the concern's DECLARED legacy
 * log path (from `concernLogPaths`, defaulting to the canonical
 * `monitoring/<concern-id>.md`) plus its concern ID and signal, with a
 * per-role entry index — so re-importing entries that moved into generated
 * shared views yields identical identities and never duplicates.
 */
export function planMonitoringImport(input: {
  relativePath: string;
  concernId: string;
  text: string;
  /** Declared concern-log path per concern ID (registry-driven override). */
  concernLogPaths?: Record<string, string>;
}): StructuredChangeSet[] {
  const parsed = planMonitoringEntries(input.concernId, input.text);
  if (parsed.length === 0) return [];
  const byPartition = new Map<string, { concernId: string; signal: string; entries: ParsedMonitoringEntry[] }>();
  for (const entry of parsed) {
    const key = `${entry.concernId}\u0000${entry.signal}`;
    const group = byPartition.get(key);
    if (group === undefined) byPartition.set(key, { concernId: entry.concernId, signal: entry.signal, entries: [entry] });
    else group.entries.push(entry);
  }

  const changeSets: StructuredChangeSet[] = [];
  for (const partitionKey of [...byPartition.keys()].sort()) {
    const partition = byPartition.get(partitionKey);
    if (partition === undefined) continue;
    const identityPath = input.concernLogPaths?.[partition.concernId] ?? `monitoring/${partition.concernId}.md`;
    const sorted = [...partition.entries].sort((left, right) => {
      if (left.effectiveAt !== right.effectiveAt) {
        return left.effectiveAt < right.effectiveAt ? -1 : 1;
      }
      return left.order - right.order;
    });

    const events = sorted
      .filter((entry) => entry.role === "event")
      .map((entry): StructuredEvent => {
        const details: JsonObject = { concernId: entry.concernId, signal: entry.signal };
        if (entry.status !== null) details["status"] = entry.status;
        if (entry.note !== null) details["note"] = entry.note;
        if (entry.legacyMarkdown !== null) details["legacyMarkdown"] = entry.legacyMarkdown;
        details["sourcePath"] = input.relativePath;
        return {
          entity_type: "monitoring-event",
          effective_at: entry.effectiveAt,
          statement: monitoringEventStatement(entry.concernId, entry.signal, entry.effectiveAt),
          action_targets: [],
          details,
        };
      });

    const explicitStates = sorted.filter((entry) => entry.role === "state");
    const stateEntries: ParsedMonitoringEntry[] = [...explicitStates];
    // Current-state derivation belongs to the concern's OWN log: shared
    // generated views re-import history without inventing new state.
    const derivesState = input.relativePath === identityPath;
    if (derivesState && explicitStates.length === 0) {
      // Legacy tables carry no explicit current state: the newest typed row
      // per signal becomes it. Untyped (verbatim) bodies never invent state.
      const newestTyped = [...sorted]
        .reverse()
        .find((entry) => entry.role === "event" && entry.legacyMarkdown === null);
      if (newestTyped !== undefined) {
        stateEntries.push({ ...newestTyped, role: "state", order: newestTyped.order });
      }
    }
    const stateChanges = stateEntries.map((entry): StructuredStateChange => {
      const details: JsonObject = { concernId: entry.concernId, signal: entry.signal };
      if (entry.status !== null) details["status"] = entry.status;
      if (entry.note !== null) details["note"] = entry.note;
      return {
        entity_type: "monitoring",
        key_components: { concern_id: entry.concernId, signal: entry.signal },
        effective_at: entry.effectiveAt,
        statement: monitoringStateStatement(entry.concernId, entry.signal, entry.status),
        details,
      };
    });

    changeSets.push(
      fileChangeSet(
        input.relativePath,
        stateChanges,
        events,
        migratedMonitoringSourceSessionId(identityPath, partition.concernId, partition.signal),
      ),
    );
  }
  return changeSets;
}

function fileChangeSet(
  relativePath: string,
  stateChanges: StructuredStateChange[],
  events: StructuredEvent[],
  sessionId: string = migrationSourceSessionId(relativePath),
): StructuredChangeSet {
  return {
    schema_version: SCHEMA_VERSION,
    // One change set per legacy FILE (or per file × concern × signal
    // partition for monitoring) so every item's derived source ID
    // (`migration-<hash>:0:<role>:<entry-index>`) embeds the identity inputs
    // plus the entry index — adding or removing other legacy files never
    // shifts existing identity.
    source: { skill: MIGRATION_SKILL, session_id: sessionId, turn_id: 0 },
    state_changes: stateChanges,
    events,
    report_claims: [],
  };
}

/**
 * Builds one migration change set PER legacy source file. Source identity is
 * the normalized relative path hashed into the change-set session ID plus
 * the per-file YAML/markdown entry index, so reruns of the same corpus (and
 * corpora that gain or lose unrelated files) are stable and never duplicate.
 */
export function planLegacyImport(input: {
  prescriptions?: Array<{ relativePath: string; text: string }>;
  consultations?: Array<{ relativePath: string; text: string }>;
  monitoring?: Array<{ relativePath: string; concernId?: string; text: string }>;
  /** Declared concern-log path per concern ID (registry-driven override). */
  monitoringConcernLogPaths?: Record<string, string>;
}): StructuredChangeSet[] {
  const changeSets: StructuredChangeSet[] = [];
  for (const file of input.prescriptions ?? []) {
    changeSets.push(fileChangeSet(file.relativePath, planPrescriptionImport(file.relativePath, file.text), []));
  }
  for (const file of input.consultations ?? []) {
    const events = planConsultationImport(file.relativePath, file.text);
    if (events.length > 0) changeSets.push(fileChangeSet(file.relativePath, [], events));
  }
  for (const file of input.monitoring ?? []) {
    const concernId =
      file.concernId ?? basename(file.relativePath).replace(/\.md$/, "");
    changeSets.push(
      ...planMonitoringImport({
        relativePath: file.relativePath,
        concernId,
        text: file.text,
        concernLogPaths: input.monitoringConcernLogPaths,
      }),
    );
  }
  return changeSets;
}

// ---------------------------------------------------------------------------
// Import records — the active record set an approved import apply commits
// ---------------------------------------------------------------------------

import type { KnowledgeRecord } from "@isparling/engram-harness/knowledge-types";
import {
  validateChangeSet,
  engramCoachPackId,
  engramCoachPackVersion,
} from "./engram-coach-structured-capture.ts";

function toJsonObject(value: JsonValue): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

/**
 * Validates a planned import change set and projects every normalized item
 * into the ACTIVE explicit knowledge record an approved apply would commit,
 * so dry-run comparison renders exactly what production would render.
 */
export function migrationActiveRecords(
  changeSet: StructuredChangeSet | StructuredChangeSet[],
): KnowledgeRecord[] {
  const sets = Array.isArray(changeSet) ? changeSet : [changeSet];
  return sets.flatMap((set) => activeRecordsOfOne(set));
}

function activeRecordsOfOne(changeSet: StructuredChangeSet): KnowledgeRecord[] {
  const validated = validateChangeSet(toJsonObject(changeSet));
  if (!validated.ok) {
    throw new MigrationError(`invalid import change set: ${JSON.stringify(validated.errors)}`);
  }
  return validated.items.map((item): KnowledgeRecord => ({
    schemaVersion: 0,
    id: item.recordId,
    kind: "decision",
    status: "active",
    statement: item.statement,
    details: toJsonObject({
      recordRole: item.role,
      entityType: item.entityType,
      entityKey: item.entityKey,
      effectiveAt: item.effectiveAt,
      sourceId: item.sourceId,
      value: item.value,
      artifact: item.artifact,
      captureChannel: "explicit",
    }),
    scope: {
      space: "engram-coach",
      subjects: [],
      topics: ["coaching:capture"],
      contexts: [],
      dimensions: {},
    },
    pack: { id: engramCoachPackId, version: engramCoachPackVersion },
    sources: [{ type: "engram-coach-capture", ref: item.sourceId }],
    session: { id: changeSet.source.session_id, host: "omp" },
    submittedAt: item.effectiveAt,
    disposition: "new",
    relationships: { supports: [], contradicts: [], refines: [], supersedes: [] },
    history: [{ event: "created", relatedId: item.recordId, submittedAt: item.effectiveAt }],
  }));
}
