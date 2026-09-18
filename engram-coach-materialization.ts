/**
 * engram-coach materialization — deterministic compatibility-view rendering.
 *
 * After a hash-bound apply commits records, this module regenerates the
 * non-authoritative compatibility views athletes, coaches, and skills still
 * read today: prescription YAML blocks, consultation/adaptation logs,
 * monitoring logs, and doctor-prep summaries. Rendering is a pure function of
 * the active, temporally effective record set: same records in any order
 * produce byte-identical files, and rerunning materialization against an
 * unchanged record set reapplies nothing (`replaceArtifact` byte-compare
 * reports every path unchanged).
 *
 * Record contract consumed here (pack-owned `details`, written by explicit
 * capture):
 *   { recordRole, entityType, entityKey, effectiveAt, sourceId, value,
 *     artifact: { kind, relativePath }, captureChannel }
 *
 * `details.artifact.kind` selects the renderer:
 *   - "prescription":   one active state record per planned session; value
 *     carries blockName, goal?, order?, sessionId, week, day, sessionDate,
 *     sessionName, modality?, totalDurationMin?, effortZone?, warmup?,
 *     cooldown?, intervals?. Sessions group by relativePath into one YAML file
 *     whose field order matches PRESCRIPTION_FORMAT.md exactly.
 *   - "consultation":   append-only event records; value carries
 *     legacyMarkdown? (preserved verbatim) or title?/summary.
 *   - "adaptation":     append-only event records; same value contract as
 *     consultation.
 *   - "monitoring":     monitoring state and event records for one log file;
 *     value carries concernId, signal, and either legacyMarkdown? or
 *     status?/note?.
 *   - "doctor-prep":    declaration records naming the summary target; the
 *     summary itself renders from all active monitoring state plus
 *     chronological monitoring events.
 *
 * A failing artifact never aborts the remaining independent artifacts: every
 * failed view lands in `stale` and retries idempotently. Record commit stays
 * authoritative regardless of materialization outcome.
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  JsonObject,
  JsonValue,
  KnowledgeRecord,
} from "@isparling/engram-harness/knowledge-types";
import type {
  AppliedCapturePlan,
  ArtifactReplacementResult,
  MaterializationResult,
} from "./engram-coach-capture-types.ts";
import { loadEngramCoachConfig, type EngramCoachRuntimeConfig } from "./engram-coach-config.ts";
import { canonicalJson } from "./engram-coach-structured-capture.ts";
type YamlModule = typeof import("yaml");

/**
 * Bun-compiled OMP cannot resolve bare dependencies from a pack imported
 * after extension startup. Prefer native resolution, then anchor the same
 * CommonJS load to the dependency's on-disk package manifest.
 */
function loadYamlModule(): YamlModule {
  const requireFromPack = createRequire(import.meta.url);
  try {
    return requireFromPack("yaml") as YamlModule;
  } catch (resolutionError) {
    let directory = dirname(fileURLToPath(import.meta.url));
    while (true) {
      const manifestPath = resolve(directory, "node_modules", "yaml", "package.json");
      if (existsSync(manifestPath)) {
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { main?: unknown };
        if (typeof manifest.main === "string") {
          return requireFromPack(resolve(dirname(manifestPath), manifest.main)) as YamlModule;
        }
      }
      const parent = dirname(directory);
      if (parent === directory) throw resolutionError;
      directory = parent;
    }
  }
}

const { Document: YamlDocument, isMap, isScalar, isSeq } = loadYamlModule();
type YamlDocument = InstanceType<YamlModule["Document"]>;

/** Host mechanics supplied by the OMP extension — no coaching ontology here. */
export type MaterializeTools = {
  listRecords(): Promise<KnowledgeRecord[]>;
  replaceArtifact(request: {
    root: string;
    relativePath: string;
    content: string;
  }): Promise<ArtifactReplacementResult>;
  projectRoot: string;
  /** One captured apply timestamp (ISO); bounds temporal effectiveness. */
  appliedAt: string;
};

const PRESCRIPTION_HEADER = "# GENERATED FROM ENGRAM ACTIVE RECORDS. DO NOT EDIT DIRECTLY.\n";
const MARKDOWN_HEADER = "<!-- GENERATED FROM ENGRAM ACTIVE RECORDS. DO NOT EDIT DIRECTLY. -->\n";

export const ARTIFACT_KINDS = [
  "prescription",
  "consultation",
  "adaptation",
  "monitoring",
  "doctor-prep",
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

// ---------------------------------------------------------------------------
// Narrowing helpers over untyped JSON payloads
// ---------------------------------------------------------------------------

function isObject(value: JsonValue | undefined): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function asNumber(value: JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// ---------------------------------------------------------------------------
// Active-view record selection
// ---------------------------------------------------------------------------

type MaterializationRecord = {
  record: KnowledgeRecord;
  role: string;
  artifactKind: ArtifactKind;
  relativePath: string;
  effectiveAt: string;
  sourceId: string;
  id: string;
  value: { [key: string]: JsonValue };
};

/**
 * Keeps only active, temporally effective records carrying a pack-owned
 * artifact pointer. Records with an unparseable effective time never become
 * temporally effective, so they are excluded rather than guessed about.
 */
export function selectMaterializableRecords(
  records: readonly KnowledgeRecord[],
  appliedAt: string,
): MaterializationRecord[] {
  const appliedMs = Date.parse(appliedAt);
  const selected: MaterializationRecord[] = [];
  for (const record of records) {
    if (record.status !== "active") continue;
    const details = isObject(record.details) ? record.details : undefined;
    if (!details || details.captureChannel !== "explicit") continue;
    const artifact = details.artifact;
    if (!isObject(artifact)) continue;
    const kind = asString(artifact.kind);
    const relativePath = asString(artifact.relativePath);
    const effectiveAt = asString(details.effectiveAt);
    const sourceId = asString(details.sourceId);
    if (
      kind === null ||
      relativePath === null ||
      effectiveAt === null ||
      sourceId === null ||
      !(ARTIFACT_KINDS as readonly string[]).includes(kind)
    ) {
      continue;
    }
    const effectiveMs = Date.parse(effectiveAt);
    if (Number.isNaN(effectiveMs) || Number.isNaN(appliedMs) || effectiveMs > appliedMs) continue;
    selected.push({
      record,
      role: asString(details.recordRole) ?? "",
      artifactKind: kind as ArtifactKind,
      relativePath,
      effectiveAt,
      sourceId,
      id: record.id,
      value: isObject(details.value) ? details.value : {},
    });
  }
  return selected;
}

// ---------------------------------------------------------------------------
// Prescription YAML rendering
// ---------------------------------------------------------------------------

type PowerBand = { lowPct: number | null; highPct: number | null };

type PrescriptionSession = {
  blockName: string;
  goal: JsonValue | null;
  order: number;
  sessionId: string;
  week: number;
  day: string;
  sessionDate: string;
  sessionName: string;
  modality: string | null;
  totalDurationMin: number | null;
  effortZone: string | null;
  warmup: PowerBand;
  cooldown: PowerBand;
  intervals: Array<{
    present: ReadonlySet<string>;
    durationMin: number | null;
    powerLowPct: number | null;
    powerHighPct: number | null;
    count: number | null;
    recoveryMin: number | null;
    recoveryPowerLowPct: number | null;
    recoveryPowerHighPct: number | null;
    extraFields: { [key: string]: JsonValue } | null;
    presentation: { [key: string]: JsonValue } | null;
  }>;
  extraFields: { [key: string]: JsonValue } | null;
  documentFields: { [key: string]: JsonValue } | null;
  documentPresentation: { [key: string]: JsonValue } | null;
  presentation: { [key: string]: JsonValue } | null;
};

function parsePowerBand(value: JsonValue | undefined): PowerBand {
  if (!isObject(value)) return { lowPct: null, highPct: null };
  return { lowPct: asNumber(value.powerLowPct), highPct: asNumber(value.powerHighPct) };
}

/** Parses one prescription session value; null means structurally invalid. */
function parsePrescriptionSession(value: { [key: string]: JsonValue }): PrescriptionSession | null {
  const blockName = asString(value.blockName);
  const sessionId = asString(value.sessionId);
  const week = asNumber(value.week);
  const day = asString(value.day);
  const sessionDate = asString(value.sessionDate);
  const sessionName = asString(value.sessionName);
  if (
    blockName === null ||
    sessionId === null ||
    week === null ||
    day === null ||
    sessionDate === null ||
    sessionName === null
  ) {
    return null;
  }
  const rawIntervals = value.intervals;
  const intervals: PrescriptionSession["intervals"] = [];
  if (rawIntervals !== undefined) {
    if (!Array.isArray(rawIntervals)) return null;
    for (const rawInterval of rawIntervals) {
      if (!isObject(rawInterval)) return null;
      // A modeled numeric is optional and may be explicitly null: a
      // continuous effort has no rep recovery, and a legacy watt band
      // carries no FTP percentages. Rendering must reproduce exactly what
      // the source had, so presence is tracked separately from value.
      const present = new Set(
        ["durationMin", "powerLowPct", "powerHighPct", "count", "recoveryMin"].filter(
          (key) => rawInterval[key] !== undefined,
        ),
      );
      intervals.push({
        present,
        durationMin: asNumber(rawInterval.durationMin),
        powerLowPct: asNumber(rawInterval.powerLowPct),
        powerHighPct: asNumber(rawInterval.powerHighPct),
        count: asNumber(rawInterval.count),
        recoveryMin: asNumber(rawInterval.recoveryMin),
        recoveryPowerLowPct: asNumber(rawInterval.recoveryPowerLowPct),
        recoveryPowerHighPct: asNumber(rawInterval.recoveryPowerHighPct),
        extraFields: isObject(rawInterval.extraFields) ? rawInterval.extraFields : null,
        presentation: isObject(rawInterval.presentation) ? rawInterval.presentation : null,
      });
    }
  }
  return {
    blockName,
    goal: value.goal ?? null,
    order: asNumber(value.order) ?? 0,
    sessionId,
    week,
    day,
    sessionDate,
    sessionName,
    modality: asString(value.modality),
    totalDurationMin: asNumber(value.totalDurationMin),
    effortZone: asString(value.effortZone),
    warmup: parsePowerBand(value.warmup),
    cooldown: parsePowerBand(value.cooldown),
    intervals,
    extraFields: isObject(value.extraFields) ? value.extraFields : null,
    documentFields: isObject(value.documentFields) ? value.documentFields : null,
    documentPresentation: isObject(value.documentPresentation) ? value.documentPresentation : null,
    presentation: isObject(value.presentation) ? value.presentation : null,
  };
}

/**
 * Renders the prescription YAML for one relative path from its active session
 * records. Field order follows PRESCRIPTION_FORMAT.md: block_name, document
 * extras, goal, sessions ordered by `order` then `sessionId`; within a
 * session, week, day, session_date, session_name, modality,
 * total_duration_min, effort_zone, warmup/cooldown bands, session extras,
 * then intervals. Inconsistent blockName, goal, document extras, or document
 * comments across the group is an error, never a silent pick.
 *
 * Unmodeled fields and authored comments captured at import are written back,
 * so a migrated file keeps its rationale and any authoring the format doc
 * does not model. Comments are per-record: a skill that supersedes a session
 * writes its own, so a stale comment can never contradict mutated data.
 */
export function renderPrescriptionView(
  records: readonly MaterializationRecord[],
): { ok: true; content: string } | { ok: false; reason: string } {
  const where = records[0]?.relativePath ?? "<unknown>";
  const sessions: PrescriptionSession[] = [];
  for (const entry of records) {
    const session = parsePrescriptionSession(entry.value);
    if (session === null) {
      return { ok: false, reason: `invalid prescription session value in record ${entry.id}` };
    }
    sessions.push(session);
  }
  const blockNames = new Set(sessions.map((session) => session.blockName));
  if (blockNames.size !== 1) {
    return { ok: false, reason: `inconsistent blockName across active records for ${where}` };
  }
  const goals = new Set(sessions.map((session) => canonicalJson(session.goal)));
  if (goals.size !== 1) {
    return { ok: false, reason: `inconsistent goal across active records for ${where}` };
  }
  sessions.sort((left, right) =>
    left.order !== right.order ? left.order - right.order : left.sessionId < right.sessionId ? -1 : left.sessionId > right.sessionId ? 1 : 0,
  );

  const documentFields = new Set(sessions.map((session) => canonicalJson(session.documentFields)));
  if (documentFields.size !== 1) {
    return { ok: false, reason: `inconsistent documentFields across active records for ${where}` };
  }
  const documentPresentations = new Set(
    sessions.map((session) => canonicalJson(session.documentPresentation)),
  );
  if (documentPresentations.size !== 1) {
    return { ok: false, reason: `inconsistent documentPresentation across active records for ${where}` };
  }

  const document: { [key: string]: JsonValue } = { block_name: sessions[0].blockName };
  for (const [key, entry] of Object.entries(sessions[0].documentFields ?? {})) {
    document[key] = entry;
  }
  const goal = sessions[0].goal;
  if (isObject(goal)) document.goal = goal;
  document.sessions = sessions.map((session): JsonValue => {
    const rendered: { [key: string]: JsonValue } = {
      session_id: session.sessionId,
      week: session.week,
      day: session.day,
      session_date: session.sessionDate,
      session_name: session.sessionName,
    };
    if (session.modality !== null) rendered.modality = session.modality;
    if (session.totalDurationMin !== null) rendered.total_duration_min = session.totalDurationMin;
    if (session.effortZone !== null) rendered.effort_zone = session.effortZone;
    if (session.warmup.lowPct !== null) rendered.warmup_power_low_pct = session.warmup.lowPct;
    if (session.warmup.highPct !== null) rendered.warmup_power_high_pct = session.warmup.highPct;
    if (session.cooldown.lowPct !== null) rendered.cooldown_power_low_pct = session.cooldown.lowPct;
    if (session.cooldown.highPct !== null) rendered.cooldown_power_high_pct = session.cooldown.highPct;
    for (const [key, entry] of Object.entries(session.extraFields ?? {})) {
      rendered[key] = entry;
    }
    if (session.intervals.length > 0) {
      rendered.intervals = session.intervals.map((interval): JsonValue => {
        const item: { [key: string]: JsonValue } = {};
        if (interval.present.has("durationMin")) item.duration_min = interval.durationMin;
        if (interval.present.has("powerLowPct")) item.power_low_pct = interval.powerLowPct;
        if (interval.present.has("powerHighPct")) item.power_high_pct = interval.powerHighPct;
        if (interval.present.has("count")) item.count = interval.count;
        if (interval.present.has("recoveryMin")) item.recovery_min = interval.recoveryMin;
        if (interval.recoveryPowerLowPct !== null) item.recovery_power_low_pct = interval.recoveryPowerLowPct;
        if (interval.recoveryPowerHighPct !== null) item.recovery_power_high_pct = interval.recoveryPowerHighPct;
        for (const [key, entry] of Object.entries(interval.extraFields ?? {})) {
          item[key] = entry;
        }
        return orderedByKeyOrder(item, interval.presentation);
      });
    }
    return orderedByKeyOrder(rendered, session.presentation);
  });

  // A yaml Document carries the comments; lineWidth 0 keeps long statements
  // unwrapped so output is stable across yaml versions.
  const out = new YamlDocument(
    orderedByKeyOrder(document, sessions[0].documentPresentation),
  );
  applyPrescriptionComments(out, sessions);
  return { ok: true, content: PRESCRIPTION_HEADER + out.toString({ lineWidth: 0 }) };
}

/**
 * Reorders one rendered mapping to the key order captured at import, so
 * unmodeled fields keep the position the athlete wrote them in. Keys with no
 * captured position (a session_id inserted by the baseline, or a field a
 * skill adds later) keep their canonical order at the end.
 */
function orderedByKeyOrder(
  rendered: { [key: string]: JsonValue },
  presentation: { [key: string]: JsonValue } | null,
): { [key: string]: JsonValue } {
  const order = presentation?.keyOrder;
  if (!Array.isArray(order)) return rendered;
  const wanted = order.filter((key): key is string => typeof key === "string");
  const ordered: { [key: string]: JsonValue } = {};
  for (const key of wanted) {
    if (Object.hasOwn(rendered, key)) ordered[key] = rendered[key] as JsonValue;
  }
  for (const [key, entry] of Object.entries(rendered)) {
    if (!Object.hasOwn(ordered, key)) ordered[key] = entry;
  }
  return ordered;
}

/** Reattaches captured comments and blank-line separation to the output. */
function applyPrescriptionComments(
  out: YamlDocument,
  sessions: readonly PrescriptionSession[],
): void {
  const documentPresentation = sessions[0]?.documentPresentation ?? null;
  const contents: unknown = out.contents;
  if (documentPresentation !== null) {
    const leading = asString(documentPresentation.comment);
    if (leading !== null) out.commentBefore = leading;
    const trailing = asString(documentPresentation.trailingComment);
    if (trailing !== null) out.comment = trailing;
    applyMapPresentation(
      contents,
      documentPresentation.fieldComments,
      documentPresentation.fieldInlineComments,
      documentPresentation.fieldSpaceBefore,
    );
  }
  const sessionsSeq = isMap(contents) ? contents.get("sessions", true) : undefined;
  if (!isSeq(sessionsSeq)) return;
  if (documentPresentation !== null) {
    const seqComment = asString(documentPresentation.sessionsComment);
    if (seqComment !== null) sessionsSeq.commentBefore = seqComment;
    const seqInline = asString(documentPresentation.sessionsInlineComment);
    if (seqInline !== null) sessionsSeq.comment = seqInline;
    if (documentPresentation.sessionsSpaceBefore === true) sessionsSeq.spaceBefore = true;
  }
  sessions.forEach((session, index) => {
    const sessionNode: unknown = sessionsSeq.items[index];
    applyNodePresentation(sessionNode, session.presentation);
    const intervalsSeq = isMap(sessionNode) ? sessionNode.get("intervals", true) : undefined;
    if (!isSeq(intervalsSeq)) return;
    session.intervals.forEach((interval, intervalIndex) => {
      applyNodePresentation(intervalsSeq.items[intervalIndex], interval.presentation);
    });
  });
}

/** Applies one node's own comments and spacing plus its immediate keys'. */
function applyNodePresentation(node: unknown, presentation: { [key: string]: JsonValue } | null): void {
  if (presentation === null) return;
  if (isMap(node) || isSeq(node)) {
    const before = asString(presentation.comment);
    if (before !== null) node.commentBefore = before;
    const inline = asString(presentation.inlineComment);
    if (inline !== null) node.comment = inline;
    if (presentation.spaceBefore === true) node.spaceBefore = true;
  }
  applyMapPresentation(
    node,
    presentation.fieldComments,
    presentation.fieldInlineComments,
    presentation.fieldSpaceBefore,
  );
}

function applyMapPresentation(
  node: unknown,
  before: JsonValue | undefined,
  inline: JsonValue | undefined,
  spaced: JsonValue | undefined,
): void {
  if (!isMap(node)) return;
  for (const pair of node.items) {
    if (!isScalar(pair.key)) continue;
    const key = String(pair.key.value);
    const beforeText = isObject(before) ? asString(before[key]) : null;
    if (beforeText !== null) pair.key.commentBefore = beforeText;
    const inlineText = isObject(inline) ? asString(inline[key]) : null;
    if (inlineText !== null) {
      // Inline comments render from the value node when it is a scalar.
      if (isScalar(pair.value)) pair.value.comment = inlineText;
      else pair.key.comment = inlineText;
    }
    if (isObject(spaced) && spaced[key] === true) pair.key.spaceBefore = true;
  }
}

// ---------------------------------------------------------------------------
// Chronological Markdown rendering
// ---------------------------------------------------------------------------

/** Sort key shared by every chronological renderer: (effectiveAt, sourceId, id). */
function chronological(left: MaterializationRecord, right: MaterializationRecord): number {
  if (left.effectiveAt !== right.effectiveAt) return left.effectiveAt < right.effectiveAt ? -1 : 1;
  if (left.sourceId !== right.sourceId) return left.sourceId < right.sourceId ? -1 : 1;
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

/** Body of a legacy import is preserved verbatim; new events render from typed fields. */
function eventBody(entry: MaterializationRecord): string {
  const legacy = asString(entry.value.legacyMarkdown);
  if (legacy !== null) return legacy.trimEnd();
  const title = asString(entry.value.title);
  const summary = asString(entry.value.summary);
  const lines: string[] = [];
  if (title !== null) lines.push(`### ${title}`, "");
  if (summary !== null) lines.push(summary);
  else if (title === null) lines.push(entry.record.statement);
  return lines.join("\n");
}

function renderChronologicalEntries(entries: readonly MaterializationRecord[]): string {
  return [...entries]
    .sort(chronological)
    .map((entry) => {
      // Only verbatim legacy imports carry their ORIGINAL heading label as
      // `value.title` next to `legacyMarkdown`; preferring it over the opaque
      // source id lets a legacy round trip re-render byte-identically.
      // Typed events always render the source id.
      const isLegacyImport =
        asString(entry.value.legacyMarkdown) !== null && asString(entry.value.sourcePath) !== null;
      const label = isLegacyImport ? asString(entry.value.title) ?? entry.sourceId : entry.sourceId;
      return `## ${entry.effectiveAt} — ${label}\n\n${eventBody(entry)}`;
    })
    .join("\n\n");
}

/** Consultation log: consultation events for one relative path, chronological. */
export function renderConsultationLog(records: readonly MaterializationRecord[]): string {
  return MARKDOWN_HEADER + "# Consultations\n\n" + renderChronologicalEntries(records) + "\n";
}

/** Adaptation log: workout-adaptation events for one relative path, chronological. */
export function renderAdaptationLog(records: readonly MaterializationRecord[]): string {
  return MARKDOWN_HEADER + "# Workout Adaptations\n\n" + renderChronologicalEntries(records) + "\n";
}

// ---------------------------------------------------------------------------
// Monitoring log and doctor-prep summary rendering
// ---------------------------------------------------------------------------

function concernKey(entry: MaterializationRecord): string {
  const concernId = asString(entry.value.concernId) ?? "unassigned";
  const signal = asString(entry.value.signal) ?? "unspecified";
  return `${concernId} / ${signal}`;
}

function monitoringLine(entry: MaterializationRecord): string {
  const legacy = asString(entry.value.legacyMarkdown);
  if (legacy !== null) return legacy.trimEnd();
  const status = asString(entry.value.status);
  const note = asString(entry.value.note);
  const parts = [
    `- ${entry.effectiveAt}`,
    entry.role === "state" ? "state" : "event",
    entry.sourceId,
    status ?? "",
    note ?? "",
  ].filter((part) => part.length > 0);
  return parts.join(" — ").replace(/^(.*?) — /, "$1 ").trimEnd();
}

/**
 * Monitoring log: monitoring state plus events for one relative path,
 * grouped by concern/signal, chronological within each group, groups sorted
 * alphabetically.
 */
export function renderMonitoringLog(records: readonly MaterializationRecord[]): string {
  const groups = new Map<string, MaterializationRecord[]>();
  for (const entry of records) {
    const key = concernKey(entry);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [entry]);
    else group.push(entry);
  }
  const sections = [...groups.keys()].sort().map((key) => {
    const entries = [...(groups.get(key) ?? [])].sort(chronological);
    return `## ${key}\n\n${entries.map(monitoringLine).join("\n")}`;
  });
  return MARKDOWN_HEADER + "# Monitoring Log\n\n" + sections.join("\n\n") + "\n";
}

function latestStateByConcern(records: readonly MaterializationRecord[]): Map<string, MaterializationRecord> {
  const latest = new Map<string, MaterializationRecord>();
  for (const entry of records) {
    if (entry.role !== "state") continue;
    const key = concernKey(entry);
    const current = latest.get(key);
    if (current === undefined || chronological(current, entry) < 0) latest.set(key, entry);
  }
  return latest;
}

/**
 * Doctor-prep summary: current monitoring state per concern followed by the
 * full chronological monitoring history. Consumes the doctor-prep declaration
 * records only to learn the target paths; the content derives entirely from
 * active monitoring state plus chronological events.
 */
export function renderDoctorPrepSummary(
  declarations: readonly MaterializationRecord[],
  monitoring: readonly MaterializationRecord[],
): string {
  void declarations;
  const states = latestStateByConcern(monitoring);
  const events = [...monitoring].filter((entry) => entry.role !== "state").sort(chronological);
  const sections = [...states.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, state]) => {
      const status = asString(state.value.status);
      const note = asString(state.value.note);
      const summaryLines = [`Current state: ${status ?? "unknown"}${note === null ? "" : ` — ${note}`}`];
      const concernEvents = events.filter((entry) => concernKey(entry) === key);
      if (concernEvents.length > 0) {
        summaryLines.push("", concernEvents.map(monitoringLine).join("\n"));
      }
      return `## ${key}\n\n${summaryLines.join("\n")}`;
    });
  return MARKDOWN_HEADER + "# Doctor Preparation Summary\n\n" + sections.join("\n\n") + "\n";
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

type DesiredView = { kind: ArtifactKind; relativePath: string; absoluteTarget: string; content: string };

function pathWithinArtifactRoot(kind: ArtifactKind, relativePath: string): string {
  return kind === "prescription"
    ? relativePath.replace(/^prescriptions\//, "")
    : relativePath;
}

/**
 * Computes the complete desired view set from the active record set.
 * Render-level problems (invalid values, inconsistent metadata) surface as
 * stale entries keyed by relative path instead of aborting other views.
 */
export function computeDesiredViews(
  records: readonly KnowledgeRecord[],
  appliedAt: string,
  coachingDocsRoot: string,
  prescriptionsRoot: string,
  ): { views: DesiredView[]; stale: Array<{ path: string; reason: string }> } {
  const usable = selectMaterializableRecords(records, appliedAt);

  const byKind = new Map<ArtifactKind, Map<string, MaterializationRecord[]>>();
  for (const entry of usable) {
    let paths = byKind.get(entry.artifactKind);
    if (paths === undefined) {
      paths = new Map();
      byKind.set(entry.artifactKind, paths);
    }
    const group = paths.get(entry.relativePath);
    if (group === undefined) paths.set(entry.relativePath, [entry]);
    else group.push(entry);
  }

  const stale: Array<{ path: string; reason: string }> = [];
  const renderInto = (
    kind: ArtifactKind,
    relativePath: string,
    group: MaterializationRecord[],
    render: () => { ok: true; content: string } | { ok: false; reason: string },
  ) => {
    const outcome = render();
    if (outcome.ok) {
      const root = kind === "prescription" ? prescriptionsRoot : coachingDocsRoot;
      views.push({
        kind,
        relativePath,
        absoluteTarget: resolve(root, pathWithinArtifactRoot(kind, relativePath)),
        content: outcome.content,
      });
    } else {
      stale.push({ path: relativePath, reason: outcome.reason });
    }
  };

  const views: DesiredView[] = [];
  for (const [kind, paths] of byKind) {
    for (const [relativePath, group] of paths) {
      if (kind === "prescription") {
        renderInto(kind, relativePath, group, () => renderPrescriptionView(group));
      } else if (kind === "consultation") {
        renderInto(kind, relativePath, group, () => ({ ok: true, content: renderConsultationLog(group) }));
      } else if (kind === "adaptation") {
        renderInto(kind, relativePath, group, () => ({ ok: true, content: renderAdaptationLog(group) }));
      } else if (kind === "monitoring") {
        renderInto(kind, relativePath, group, () => ({ ok: true, content: renderMonitoringLog(group) }));
      }
    }
  }

  const declarations = usable.filter((entry) => entry.artifactKind === "doctor-prep");
  const monitoring = usable.filter((entry) => entry.artifactKind === "monitoring");
  for (const declaration of declarations) {
    views.push({
      kind: "doctor-prep",
      relativePath: declaration.relativePath,
      absoluteTarget: resolve(coachingDocsRoot, declaration.relativePath),
      content: renderDoctorPrepSummary(declarations, monitoring),
    });
  }

  // Deterministic write order regardless of record or grouping iteration order.
  views.sort((left, right) =>
    left.absoluteTarget < right.absoluteTarget ? -1 : left.absoluteTarget > right.absoluteTarget ? 1 : 0,
  );
  return { views, stale };
}

function resolveRoot(dir: string, projectRoot: string): string {
  return isAbsolute(dir) ? dir : resolve(projectRoot, dir);
}

/**
 * Regenerates every compatibility view from the active record set. Loads
 * records once, computes the complete desired view set, sorts artifact
 * operations by absolute target, and applies each through the host's
 * byte-comparing replacement. Never touches qmd. One artifact failure does
 * not stop the others: failures land in `stale` and retry idempotently.
 * The optional injected config exists for tests; production callers omit it.
 */
export async function materialize(
  appliedPlan: AppliedCapturePlan,
  tools: MaterializeTools,
  options: { config?: EngramCoachRuntimeConfig } = {},
): Promise<MaterializationResult> {
  void appliedPlan;
  const config = options.config ?? await loadEngramCoachConfig();
  const prescriptionsRoot = resolveRoot(config.prescriptionsDir, tools.projectRoot);
  const coachingDocsRoot = resolveRoot(config.coachingDocsDir, tools.projectRoot);
  const records = await tools.listRecords();
  const { views, stale } = computeDesiredViews(
    records,
    tools.appliedAt,
    coachingDocsRoot,
    prescriptionsRoot,
  );

  const written: ArtifactReplacementResult[] = [];
  const unchanged: ArtifactReplacementResult[] = [];
  const staleResults = [...stale];
  for (const view of views) {
    try {
      const outcome = await tools.replaceArtifact({
        root: view.kind === "prescription" ? prescriptionsRoot : coachingDocsRoot,
        relativePath: pathWithinArtifactRoot(view.kind, view.relativePath),
        content: view.content,
      });
      if (outcome.status === "replaced") written.push(outcome);
      else unchanged.push(outcome);
    } catch (error) {
      staleResults.push({
        path: view.relativePath,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { written, unchanged, stale: staleResults };
}

