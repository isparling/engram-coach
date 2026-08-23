/**
 * engram-coach explicit structured capture — deterministic aggregate
 * candidate construction and preview projection.
 *
 * A skill emits a typed `StructuredChangeSet` (domain input only: no record
 * IDs, statuses, relationships, or retirement targets). This module is the
 * ONLY place those change sets become Engram candidates:
 *
 * 1. The change set is validated field by field into real types.
 * 2. Each item's canonical entity key is derived by the pack via
 *    `deriveCanonicalEntityKey` — an unbound key blocks the whole preview
 *    rather than guessing identity.
 * 3. Each item gets a deterministic source ID
 *    (`<session_id>:<turn_id>:<channel>:<index>`) and record ID
 *    (`coach-` + first 24 hex chars of SHA-256 over canonical JSON of
 *    `{ sourceId, role, canonicalKey, statement }`).
 * 4. ONE aggregate candidate envelope (`details.captureChannel: "explicit"`)
 *    carries the normalized items to the host transaction path; the host's
 *    guarded reconciler classifies every item against exact-key related
 *    records and returns a plan + hash.
 *
 * `previewStructuredCapture` projects that plan into the Phase 4 preview:
 * a ready result carries the plan hash, the private aggregate candidate
 * (retained by the extension, never shown to the model), per-entity change
 * rows derived from planned roles/statuses/relationship edges, and sorted
 * compatibility artifact paths; a blocked result carries host errors
 * verbatim and never reaches presentation.
 *
 * @module engram-coach-structured-capture
 */

import { createHash } from "node:crypto";
import type { CaptureMutationView, HostCapturePreview } from "@isparling/engram-harness/capture-types";
import type {
  JsonObject,
  JsonValue,
  KnowledgeEnvelope,
  KnowledgeError,
} from "@isparling/engram-harness/knowledge-types";
import {
  SCHEMA_VERSION,
  type BlockedCapturePreview,
  type CaptureChangeView,
  type CapturePreview,
  type ReadyCapturePreview,
  type RecordRole,
  type StructuredChangeSet,
  type StructuredEvent,
  type StructuredReportClaim,
  type StructuredStateChange,
} from "./engram-coach-capture-types.ts";
import { ENGRAM_COACH_SKILLS, type EngramCoachSkill } from "./engram-coach-domain.ts";
import { deriveCanonicalEntityKey, type KeyedEntityType } from "./engram-coach-keys.ts";

export const engramCoachPackId = "engram-coach";
export const engramCoachPackVersion = "0.1.0";

// ---------------------------------------------------------------------------
// Normalized items — the pack-owned shape carried on the aggregate candidate
// ---------------------------------------------------------------------------

/** Compatibility artifact metadata stored at `details.artifact`. */
export type CaptureArtifactRef = { kind: string; relativePath: string };

/**
 * One normalized change-set item. Carries everything the reconciler and
 * materializers need: pack-derived identity, lifecycle-independent content,
 * and the artifact view it will regenerate. Stored as an entry of the
 * aggregate candidate's `details.items` array.
 */
export type NormalizedCaptureItem = {
  sourceId: string;
  recordId: string;
  role: RecordRole;
  entityType: string;
  /** Bound canonical key, or null when the role has no keyed identity. */
  entityKey: string | null;
  effectiveAt: string;
  statement: string;
  value: JsonObject;
  artifact: CaptureArtifactRef;
  actionTargets: string[];
  sourceDocument: string | null;
};

// ---------------------------------------------------------------------------
// Canonical JSON + deterministic hashing
// ---------------------------------------------------------------------------

/** Sorted-key, whitespace-free JSON — the canonical byte form for hashing. */
export function canonicalJson(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, item]) => `${canonicalJson(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha24Hex(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 24);
}

/**
 * Record ID for one normalized item: `coach-` plus the first 24 hex chars
 * of SHA-256 over canonical JSON of `{ sourceId, role, canonicalKey,
 * statement }`. Identical inputs therefore always produce identical IDs.
 */
export function deriveRecordId(input: {
  sourceId: string;
  role: RecordRole;
  canonicalKey: string | null;
  statement: string;
}): string {
  return `coach-${sha24Hex(canonicalJson({
    sourceId: input.sourceId,
    role: input.role,
    canonicalKey: input.canonicalKey,
    statement: input.statement,
  }))}`;
}

// ---------------------------------------------------------------------------
// Strict validation of the JSON-facing change set
// ---------------------------------------------------------------------------

function validationError(code: string, field: string, message: string): KnowledgeError {
  return { kind: "validation", code, field, message };
}

type InvalidChangeSet = { ok: false; errors: KnowledgeError[] };

function isObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(parent: JsonObject, key: string, field: string, errors: KnowledgeError[]): string | null {
  const value = parent[key];
  if (typeof value !== "string" || value.trim().length === 0 || /[\r\n]/.test(value)) {
    errors.push(validationError("change_set_field_invalid", field, `${field} must be a non-empty single-line string`));
    return null;
  }
  return value;
}

function dateString(parent: JsonObject, key: string, field: string, errors: KnowledgeError[]): string | null {
  const value = parent[key];
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    errors.push(validationError("change_set_field_invalid", field, `${field} must be a parseable date or timestamp`));
    return null;
  }
  return value;
}

function jsonObject(parent: JsonObject, key: string, field: string, errors: KnowledgeError[]): JsonObject {
  const value = parent[key];
  if (!isObject(value)) {
    errors.push(validationError("change_set_field_invalid", field, `${field} must be a JSON object`));
    return {};
  }
  return value;
}

function stringArray(parent: JsonObject, key: string, field: string, errors: KnowledgeError[]): string[] {
  const value = parent[key];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || /[\r\n]/.test(item))) {
    errors.push(validationError("change_set_field_invalid", field, `${field} must be an array of single-line strings`));
    return [];
  }
  return value as string[];
}

const KEYED_ENTITY_TYPES: readonly KeyedEntityType[] = [
  "workout",
  "prescription",
  "threshold",
  "persona",
  "monitoring",
];
const EVENT_ENTITY_TYPES = ["consultation", "workout-adaptation", "monitoring-event"] as const;
type EventEntityType = (typeof EVENT_ENTITY_TYPES)[number];
const CLAIM_ENTITY_TYPES = [
  "race-conclusion",
  "block-conclusion",
  "season-conclusion",
  "methodology-conclusion",
  "arc-conclusion",
] as const;

function validateSource(changeSet: JsonObject, errors: KnowledgeError[]): { skill: EngramCoachSkill; sessionId: string; turnId: number } | null {
  const source = changeSet["source"];
  if (!isObject(source)) {
    errors.push(validationError("change_set_source_invalid", "source", "source must be a JSON object"));
    return null;
  }
  const skill = nonEmptyString(source, "skill", "source.skill", errors);
  if (skill === null || !(ENGRAM_COACH_SKILLS as readonly string[]).includes(skill)) {
    errors.push(validationError("change_set_skill_unknown", "source.skill", `"${String(source["skill"])}" is not a known engram-coach skill`));
  }
  const sessionId = nonEmptyString(source, "session_id", "source.session_id", errors);
  const rawTurn = source["turn_id"];
  if (typeof rawTurn !== "number" || !Number.isInteger(rawTurn) || rawTurn < 0) {
    errors.push(validationError("change_set_field_invalid", "source.turn_id", "source.turn_id must be a non-negative integer"));
  }
  if (skill === null || sessionId === null || typeof rawTurn !== "number" || !Number.isInteger(rawTurn) || rawTurn < 0) {
    return null;
  }
  return { skill: skill as EngramCoachSkill, sessionId, turnId: rawTurn };
}

function validateStateChange(
  raw: JsonValue,
  index: number,
  sessionId: string,
  turnId: number,
  errors: KnowledgeError[],
): StructuredStateChange | null {
  const field = `state_changes[${index}]`;
  if (!isObject(raw)) {
    errors.push(validationError("change_set_item_invalid", field, `${field} must be a JSON object`));
    return null;
  }
  const entityType = raw["entity_type"];
  if (typeof entityType !== "string" || !(KEYED_ENTITY_TYPES as readonly string[]).includes(entityType)) {
    errors.push(validationError("change_set_entity_type_invalid", `${field}.entity_type`, `${field}.entity_type must be one of ${KEYED_ENTITY_TYPES.join(", ")}`));
    return null;
  }
  const statement = nonEmptyString(raw, "statement", `${field}.statement`, errors);
  const effectiveAt = dateString(raw, "effective_at", `${field}.effective_at`, errors);
  const keyComponents = jsonObject(raw, "key_components", `${field}.key_components`, errors);
  const details = jsonObject(raw, "details", `${field}.details`, errors);
  if (statement === null || effectiveAt === null) return null;
  return {
    entity_type: entityType as StructuredStateChange["entity_type"],
    key_components: keyComponents,
    effective_at: effectiveAt,
    statement,
    details,
  };
}

function normalizeStateItem(
  change: StructuredStateChange,
  index: number,
  sessionId: string,
  turnId: number,
): NormalizedCaptureItem | { unbound: string } {
  const derived = deriveCanonicalEntityKey({ entity_type: change.entity_type, key_components: change.key_components });
  if (derived.kind === "unbound") return { unbound: derived.reason };
  const sourceId = `${sessionId}:${turnId}:state:${index}`;
  return {
    sourceId,
    recordId: deriveRecordId({ sourceId, role: "state", canonicalKey: derived.key, statement: change.statement }),
    role: "state",
    entityType: change.entity_type,
    entityKey: derived.key,
    effectiveAt: change.effective_at,
    statement: change.statement,
    value: change.details,
    artifact: stateArtifact(change.entity_type, change.key_components),
    actionTargets: [],
    sourceDocument: null,
  };
}

function stateArtifact(entityType: KeyedEntityType, components: JsonObject): CaptureArtifactRef {
  const component = (name: string): string => {
    const value = components[name];
    return typeof value === "string" ? value : "current";
  };
  switch (entityType) {
    case "prescription":
      return { kind: "prescription", relativePath: `prescriptions/${component("arc_id")}.yaml` };
    case "workout":
      return { kind: "prescription", relativePath: `prescriptions/${component("session_id")}.yaml` };
    case "monitoring":
      return { kind: "monitoring", relativePath: `monitoring/${component("concern_id")}.md` };
    case "threshold":
      return { kind: "doctor-prep", relativePath: "monitoring/thresholds.md" };
    case "persona":
      return { kind: "doctor-prep", relativePath: "profiles/persona.md" };
  }
}

function validateEvent(
  raw: JsonValue,
  index: number,
  sessionId: string,
  turnId: number,
  errors: KnowledgeError[],
): NormalizedCaptureItem | null {
  const field = `events[${index}]`;
  if (!isObject(raw)) {
    errors.push(validationError("change_set_item_invalid", field, `${field} must be a JSON object`));
    return null;
  }
  const entityType = raw["entity_type"];
  if (typeof entityType !== "string" || !(EVENT_ENTITY_TYPES as readonly string[]).includes(entityType)) {
    errors.push(validationError("change_set_entity_type_invalid", `${field}.entity_type`, `${field}.entity_type must be one of ${EVENT_ENTITY_TYPES.join(", ")}`));
    return null;
  }
  const statement = nonEmptyString(raw, "statement", `${field}.statement`, errors);
  const effectiveAt = dateString(raw, "effective_at", `${field}.effective_at`, errors);
  const details = jsonObject(raw, "details", `${field}.details`, errors);
  const actionTargets = stringArray(raw, "action_targets", `${field}.action_targets`, errors);
  if (statement === null || effectiveAt === null) return null;
  const sourceId = `${sessionId}:${turnId}:event:${index}`;
  return {
    sourceId,
    recordId: deriveRecordId({ sourceId, role: "event", canonicalKey: null, statement }),
    role: "event",
    entityType,
    entityKey: null,
    effectiveAt,
    statement,
    value: details,
    artifact: eventArtifact(entityType as EventEntityType),
    actionTargets,
    sourceDocument: null,
  };
}

function eventArtifact(entityType: EventEntityType): CaptureArtifactRef {
  switch (entityType) {
    case "consultation":
      return { kind: "consultation", relativePath: "coaching/consultations.md" };
    case "workout-adaptation":
      return { kind: "adaptation", relativePath: "coaching/adaptations.md" };
    case "monitoring-event":
      return { kind: "monitoring", relativePath: "monitoring/events.md" };
  }
}

function validateReportClaim(
  raw: JsonValue,
  index: number,
  sessionId: string,
  turnId: number,
  errors: KnowledgeError[],
): NormalizedCaptureItem | null {
  const field = `report_claims[${index}]`;
  if (!isObject(raw)) {
    errors.push(validationError("change_set_item_invalid", field, `${field} must be a JSON object`));
    return null;
  }
  const entityType = raw["entity_type"];
  if (typeof entityType !== "string" || !(CLAIM_ENTITY_TYPES as readonly string[]).includes(entityType)) {
    errors.push(validationError("change_set_entity_type_invalid", `${field}.entity_type`, `${field}.entity_type must be one of ${CLAIM_ENTITY_TYPES.join(", ")}`));
    return null;
  }
  const statement = nonEmptyString(raw, "statement", `${field}.statement`, errors);
  const effectiveAt = dateString(raw, "effective_at", `${field}.effective_at`, errors);
  const sourceDocument = nonEmptyString(raw, "source_document", `${field}.source_document`, errors);
  const keyComponents = jsonObject(raw, "key_components", `${field}.key_components`, errors);
  const details = jsonObject(raw, "details", `${field}.details`, errors);
  if (statement === null || effectiveAt === null || sourceDocument === null) return null;

  // A claim supports/refines/supersedes a keyed STATE record, so its
  // identity link is the state entity named inside key_components
  // ({ entity_type, ...components }). An unbound claim key blocks the
  // preview instead of letting an unanchored conclusion touch state.
  const { entity_type: _targetType, ...identityComponents } = keyComponents;
  const targetEntityType = keyComponents["entity_type"];
  let entityKey: string | null = null;
  if (typeof targetEntityType === "string" && (KEYED_ENTITY_TYPES as readonly string[]).includes(targetEntityType)) {
    const derived = deriveCanonicalEntityKey({
      entity_type: targetEntityType as KeyedEntityType,
      key_components: identityComponents,
    });
    if (derived.kind === "bound") entityKey = derived.key;
  }
  if (entityKey === null) {
    errors.push(validationError(
      "change_set_claim_unbound",
      `${field}.key_components`,
      `${field} requires key_components naming a bound state entity (entity_type plus its durable components)`,
    ));
    return null;
  }

  const sourceId = `${sessionId}:${turnId}:report-claim:${index}`;
  return {
    sourceId,
    recordId: deriveRecordId({ sourceId, role: "report-claim", canonicalKey: entityKey, statement }),
    role: "report-claim",
    entityType,
    entityKey,
    effectiveAt,
    statement,
    value: details,
    artifact: { kind: "doctor-prep", relativePath: `reports/${entityType}.md` },
    actionTargets: [],
    sourceDocument,
  };
}

export type ValidatedChangeSet = {
  ok: true;
  skill: EngramCoachSkill;
  sessionId: string;
  turnId: number;
  items: NormalizedCaptureItem[];
};

/**
 * Validate a raw JSON change set and derive every normalized item. Returns
 * ALL validation errors, with unbound state keys reported as blocking
 * errors — ambiguity never guesses.
 */
export function validateChangeSet(changeSet: JsonObject): ValidatedChangeSet | InvalidChangeSet {
  const errors: KnowledgeError[] = [];
  if (!isObject(changeSet)) {
    return { ok: false, errors: [validationError("change_set_invalid", "change_set", "change set must be a JSON object")] };
  }
  if (changeSet["schema_version"] !== SCHEMA_VERSION) {
    errors.push(validationError("change_set_schema_version", "schema_version", `schema_version must be ${SCHEMA_VERSION}`));
  }
  const source = validateSource(changeSet, errors);

  const rawStates = Array.isArray(changeSet["state_changes"]) ? changeSet["state_changes"] : [];
  if (!Array.isArray(changeSet["state_changes"])) {
    errors.push(validationError("change_set_field_invalid", "state_changes", "state_changes must be an array"));
  }
  const rawEvents = Array.isArray(changeSet["events"]) ? changeSet["events"] : [];
  if (!Array.isArray(changeSet["events"])) {
    errors.push(validationError("change_set_field_invalid", "events", "events must be an array"));
  }
  const rawClaims = Array.isArray(changeSet["report_claims"]) ? changeSet["report_claims"] : [];
  if (!Array.isArray(changeSet["report_claims"])) {
    errors.push(validationError("change_set_field_invalid", "report_claims", "report_claims must be an array"));
  }

  const items: NormalizedCaptureItem[] = [];
  if (source !== null) {
    rawStates.forEach((raw, index) => {
      const change = validateStateChange(raw, index, source.sessionId, source.turnId, errors);
      if (change === null) return;
      const normalized = normalizeStateItem(change, index, source.sessionId, source.turnId);
      if ("unbound" in normalized) {
        errors.push(validationError("change_set_key_unbound", `state_changes[${index}].key_components`, normalized.unbound));
        return;
      }
      items.push(normalized);
    });
    rawEvents.forEach((raw, index) => {
      const item = validateEvent(raw, index, source.sessionId, source.turnId, errors);
      if (item !== null) items.push(item);
    });
    rawClaims.forEach((raw, index) => {
      const item = validateReportClaim(raw, index, source.sessionId, source.turnId, errors);
      if (item !== null) items.push(item);
    });
  }

  if (errors.length > 0 || source === null) return { ok: false, errors };
  if (items.length === 0) {
    errors.push(validationError("change_set_empty", "state_changes", "a change set must contain at least one state change, event, or report claim"));
    return { ok: false, errors };
  }
  return { ok: true, skill: source.skill, sessionId: source.sessionId, turnId: source.turnId, items };
}

// ---------------------------------------------------------------------------
// Aggregate candidate construction
// ---------------------------------------------------------------------------

/**
 * Build the ONE aggregate candidate envelope for a validated change set.
 * Deterministic: identical change sets produce identical candidate IDs,
 * item record IDs, and (with the same binding and disk state) identical
 * plan hashes. The submission date is derived from the change set's own
 * latest explicit effective date — NEVER from ambient wall-clock time,
 * which would make otherwise identical previews hash differently.
 */
export function buildAggregateCandidate(valid: ValidatedChangeSet): KnowledgeEnvelope {
  const today = valid.items
    .map((item) => item.effectiveAt)
    .sort((left, right) => left.localeCompare(right))
    [valid.items.length - 1]!
    .slice(0, 10);
  const idSeed = canonicalJson({
    skill: valid.skill,
    sessionId: valid.sessionId,
    turnId: valid.turnId,
    items: valid.items.map((item) => ({ sourceId: item.sourceId, recordId: item.recordId })),
  });
  const counts = {
    state: valid.items.filter((item) => item.role === "state").length,
    event: valid.items.filter((item) => item.role === "event").length,
    claim: valid.items.filter((item) => item.role === "report-claim").length,
  };
  return {
    id: `coach-${sha24Hex(idSeed)}`,
    kind: "decision",
    status: "candidate",
    statement: `explicit capture: ${valid.skill} (${counts.state} state, ${counts.event} event, ${counts.claim} report claim)`,
    // Pack-owned aggregate details. `items` mirrors NormalizedCaptureItem
    // exactly; the reconciler narrows them back defensively.
    details: {
      captureChannel: "explicit",
      skill: valid.skill,
      turnIndex: valid.turnId,
      extractionConfidence: "high",
      sessionId: valid.sessionId,
      items: valid.items,
    },
    scope: {
      space: engramCoachPackId,
      subjects: [],
      topics: ["coaching:capture"],
      contexts: [],
      dimensions: {},
    },
    pack: { id: engramCoachPackId, version: engramCoachPackVersion },
    sources: [{ type: "engram-coach-capture", ref: `${valid.sessionId}:turn:${valid.turnId}` }],
    session: { id: valid.sessionId, host: "omp" },
    submittedAt: today,
    disposition: "new",
  };
}

// ---------------------------------------------------------------------------
// Preview tools + projection
// ---------------------------------------------------------------------------

/**
 * Host mechanics supplied by the OMP extension. The extension owns NO
 * coaching ontology — it runs the guarded core transaction for the
 * binding-selected pack and hands back the DTO union verbatim.
 */
export type PreviewTools = {
  previewCandidate(candidate: KnowledgeEnvelope): Promise<HostCapturePreview>;
};

function itemRoleFromRecord(record: { details: JsonObject }): RecordRole {
  const role = record.details["recordRole"];
  return role === "event" || role === "report-claim" ? role : "state";
}

function classificationForCreate(record: { details: JsonObject; relationships: { refines: string[]; supersedes: string[]; supports: string[] } }): CaptureChangeView["classification"] {
  if (record.relationships.supersedes.length > 0) return "supersede";
  if (record.relationships.refines.length > 0) return "refine";
  if (record.relationships.supports.length > 0) return "support";
  return itemRoleFromRecord(record) === "event" ? "append" : "new";
}

function projectChanges(mutations: readonly CaptureMutationView[]): CaptureChangeView[] {
  const views: CaptureChangeView[] = [];
  const createsByRecordId = new Map<string, { record: CaptureMutationView["after"]; view: CaptureChangeView }>();
  for (const mutation of mutations) {
    if (mutation.action !== "create") continue;
    const sourceId = mutation.after.details["sourceId"];
    if (typeof sourceId !== "string") continue;
    const view: CaptureChangeView = {
      entityKey: typeof mutation.after.details["entityKey"] === "string" ? mutation.after.details["entityKey"] as string : null,
      recordRole: itemRoleFromRecord(mutation.after),
      classification: classificationForCreate(mutation.after),
      creates: [mutation.recordId],
      retires: [],
    };
    createsByRecordId.set(mutation.recordId, { record: mutation.after, view });
    views.push(view);
  }
  // The CREATED record carries the supersedes/refines edges pointing at the
  // retired record; the retired copy preserves its PRIOR relationships
  // verbatim. So a retirement attaches to whichever change view's created
  // record references it — never as a separate row.
  for (const mutation of mutations) {
    if (mutation.action !== "update" || mutation.after.status !== "retired") continue;
    const owner = [...createsByRecordId.values()].find(({ record }) =>
      record.relationships.supersedes.includes(mutation.recordId)
      || record.relationships.refines.includes(mutation.recordId));
    owner?.view.retires.push(mutation.recordId);
  }
  return views;
}

/**
 * Project an explicit change set into the Phase 4 capture preview.
 *
 * Validates the change set, builds the deterministic aggregate candidate,
 * and hands it to the host's guarded transaction via `tools.previewCandidate`.
 * Host errors come back verbatim as a blocked preview. A ready preview
 * groups planned mutations by `details.sourceId`, derives classifications
 * from relationship edges, lists sorted compatibility artifact paths, and
 * retains the aggregate candidate ONLY in the internal `candidate` field.
 */
export async function previewStructuredCapture(
  changeSet: JsonObject,
  tools: PreviewTools,
): Promise<CapturePreview> {
  const valid = validateChangeSet(changeSet);
  if (!valid.ok) return { schemaVersion: 0, status: "blocked" as const, errors: valid.errors };
  const candidate = buildAggregateCandidate(valid);
  const host = await tools.previewCandidate(candidate);
  if (host.status === "blocked") return { schemaVersion: 0, status: "blocked" as const, errors: host.errors };
  const artifacts = [...new Set(
    host.mutations
      .filter((mutation) => mutation.action === "create")
      .map((mutation) => mutation.after.details["artifact"])
      .filter((artifact): artifact is { [key: string]: JsonValue } => isObject(artifact))
      .map((artifact) => artifact["relativePath"])
      .filter((path): path is string => typeof path === "string"),
  )].sort((left, right) => left.localeCompare(right));
  const ready: ReadyCapturePreview = {
    schemaVersion: 0,
    status: "ready",
    planHash: host.planHash,
    candidate,
    changes: projectChanges(host.mutations),
    artifacts,
  };
  return ready;
}
