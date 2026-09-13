/**
 * engram-coach domain-aware validation and reconciliation.
 *
 * Implements the KnowledgePack facets with full awareness of the coaching
 * domain ontology defined in engram-coach-domain.ts.
 *
 * - validateEnvelope: validates candidates against known entity types,
 *   decision kinds, statement requirements, and detail structure.
 * - reconcile: understands semantic relationships between candidates and
 *   existing knowledge — threshold updates supersede prior thresholds,
 *   same-block observations support each other, duplicate statements are
 *   deduped, and identical claims from different sources get merged.
 *
 * @module engram-coach-reconciliation
 */

import type {
  JsonObject,
  JsonValue,
  KnowledgeDisposition,
  KnowledgeEnvelope,
  KnowledgeError,
  KnowledgeRelationships,
  KnowledgeResult,
  PackMutation,
  PackReconciliation,
  PackReconcileInput,
  KnowledgeRecord,
  RelatedRecordSelection,
} from "@isparling/engram-harness/knowledge-types";
import {
  ENGRAM_COACH_ENTITY_TYPES,
  ENGRAM_COACH_DECISION_KINDS,
  ENGRAM_COACH_TRAINING_PHASES,
  ENGRAM_COACH_PERSONAS,
  ENTITY_TYPE_TO_SKILL,
  type EngramCoachDetails,
  type EngramCoachEntityType,
} from "./engram-coach-domain.ts";
import { canonicalJson } from "./engram-coach-structured-capture.ts";

// ---------------------------------------------------------------------------
// Known destination topics used when validating scope topics.
// ---------------------------------------------------------------------------

const KNOWN_TOPIC_PREFIXES = [
  "coaching:",
  "training:",
  "physiology:",
  "health:",
  "planning:",
  "monitoring:",
  "content:",
];

/**
 * Validate an engram-coach knowledge envelope against the domain ontology.
 *
 * Checks:
 * - Statement is non-empty and within length limits
 * - entityType is a known engram-coach entity type
 * - decisionKind is a known engram-coach decision kind
 * - trainingPhase (if present) is a known phase
 * - persona (if present) is a known persona
 * - topics use known prefixes
 */
export function validateEnvelope(
  envelope: KnowledgeEnvelope,
): KnowledgeResult<void> {
  const errors: Array<{ kind: "validation"; code: string; field?: string; message: string }> = [];

  // --- Statement checks ---
  const statement = envelope.statement?.trim() ?? "";
  if (!statement) {
    errors.push({
      kind: "validation",
      code: "empty_statement",
      field: "statement",
      message: "statement must not be empty",
    });
  }
  if (statement.length > 5000) {
    errors.push({
      kind: "validation",
      code: "statement_too_long",
      field: "statement",
      message: "statement must be at most 5000 characters",
    });
  }

  // --- Details checks ---
  const details = envelope.details as Partial<EngramCoachDetails> | undefined;

  if (details) {
    const entityType = details.entityType;
    if (entityType && !((ENGRAM_COACH_ENTITY_TYPES as readonly string[]).includes(entityType))) {
      errors.push({
        kind: "validation",
        code: "unknown_entity_type",
        field: "details.entityType",
        message: `"${entityType}" is not a known engram-coach entity type`,
      });
    }

    const decisionKind = details.decisionKind;
    if (decisionKind && !((ENGRAM_COACH_DECISION_KINDS as readonly string[]).includes(decisionKind))) {
      errors.push({
        kind: "validation",
        code: "unknown_decision_kind",
        field: "details.decisionKind",
        message: `"${decisionKind}" is not a known engram-coach decision kind`,
      });
    }

    const trainingPhase = details.trainingPhase;
    if (trainingPhase && !((ENGRAM_COACH_TRAINING_PHASES as readonly string[]).includes(trainingPhase))) {
      errors.push({
        kind: "validation",
        code: "unknown_training_phase",
        field: "details.trainingPhase",
        message: `"${trainingPhase}" is not a known training phase`,
      });
    }

    const persona = details.persona;
    if (persona && !((ENGRAM_COACH_PERSONAS as readonly string[]).includes(persona))) {
      errors.push({
        kind: "validation",
        code: "unknown_persona",
        field: "details.persona",
        message: `"${persona}" is not a known persona`,
      });
    }
  }

  // --- Topic checks ---
  if (envelope.scope?.topics) {
    for (const topic of envelope.scope.topics) {
      const hasKnownPrefix = KNOWN_TOPIC_PREFIXES.some((p) => topic.startsWith(p));
      if (!hasKnownPrefix) {
        errors.push({
          kind: "validation",
          code: "unknown_topic_prefix",
          field: "scope.topics",
          message: `topic "${topic}" does not use a known prefix`,
        });
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, value: undefined };
}

/**
 * Infer the entity type from a knowledge record's details.
 */
function entityTypeFromRecord(record: KnowledgeRecord): EngramCoachEntityType | null {
  const details = record.details as Partial<EngramCoachDetails> | undefined;
  return details?.entityType ?? null;
}

/**
 * Domain-aware reconciliation.
 *
 * Understands semantic relationships:
 * - Same entity type + same scope + similar statement → support (refine)
 * - Threshold update for same athlete → supersede prior threshold
 * - Identical statement across different sources → support (merge)
 * - Different entity types → new (independent observation)
 * - No related records → accept as new
 */
export function reconcile(
  input: PackReconcileInput,
): KnowledgeResult<PackReconciliation> {
  if (input.candidate.details["captureChannel"] === "explicit") return reconcileExplicit(input);

  const candidate = input.candidate;
  const related = input.related;
  const candidateDetails = candidate.details as Partial<EngramCoachDetails> | undefined;
  const candidateEntityType = candidateDetails?.entityType;

  // No related records → accept as new
  if (related.length === 0) {
    return {
      ok: true,
      value: {
        disposition: "new",
        summary: candidateEntityType
          ? `engram-coach accepted new ${candidateEntityType} observation`
          : "engram-coach accepted new coaching observation",
        mutations: [],
      },
    };
  }

  // --- Semantic matching against related records ---
  const latest = related[0];
  const latestDetails = latest.details as Partial<EngramCoachDetails> | undefined;
  const latestEntityType = latestDetails?.entityType;

  // 1. Identical statement → no-change (dedupe)
  if (latest.statement === candidate.statement) {
    return {
      ok: true,
      value: {
        disposition: "no-change",
        summary: "duplicate of an existing coaching observation",
        mutations: [],
      },
    };
  }

  // 2. Same entity type — refine or support
  if (candidateEntityType && candidateEntityType === latestEntityType) {
    // Threshold updates supersede prior thresholds for the same athlete
    if (candidateEntityType === "lactate-test") {
      return {
        ok: true,
        value: {
          disposition: "supersede",
          summary: `new lactate test result supersedes prior threshold values`,
          mutations: [
            {
              action: "update",
              record: {
                ...latest,
                status: "retired",
                details: {
                  ...(latest.details as Record<string, unknown>),
                  supersededBy: candidate.id,
                  supersededAt: candidate.submittedAt,
                },
              },
            },
          ],
        },
      };
    }

    // Persona changes supersede prior persona
    if (candidateEntityType === "persona-fit") {
      return {
        ok: true,
        value: {
          disposition: "supersede",
          summary: `persona decision supersedes prior persona-fit record`,
          mutations: [
            {
              action: "update",
              record: {
                ...latest,
                status: "retired",
                details: {
                  ...(latest.details as Record<string, unknown>),
                  supersededBy: candidate.id,
                  supersededAt: candidate.submittedAt,
                },
              },
            },
          ],
        },
      };
    }

    // Same entity type, different statement → refine (new info on same topic)
    return {
      ok: true,
      value: {
        disposition: "refine",
        summary: `additional ${candidateEntityType} observation refines prior record`,
        mutations: [],
      },
    };
  }

  // 3. Different entity types, same outcome scope
  if (candidateEntityType && latestEntityType && candidateEntityType !== latestEntityType) {
    // Different entity type but complementary scope → support
    const skillCandidate = ENTITY_TYPE_TO_SKILL[candidateEntityType];
    const skillLatest = ENTITY_TYPE_TO_SKILL[latestEntityType];

    if (skillCandidate === skillLatest) {
      return {
        ok: true,
        value: {
          disposition: "support",
          summary: `${candidateEntityType} observation supports prior ${latestEntityType} record from same skill`,
          mutations: [],
        },
      };
    }
  }

  // 4. Unrelated records → accept as new
  return {
    ok: true,
    value: {
      disposition: "new",
      summary: "engram-coach accepted a coaching observation (no direct relationship to prior records)",
      mutations: [],
    },
  };
}

// ---------------------------------------------------------------------------
// Explicit capture channel — exact selection and per-item reconciliation
// ---------------------------------------------------------------------------

const engramCoachPackId = "engram-coach";

type ExplicitItem = {
  sourceId: string;
  recordId: string;
  role: string;
  entityType: string;
  entityKey: string | null;
  effectiveAt: string;
  statement: string;
  value: JsonObject;
  artifact: JsonObject;
  actionTargets?: JsonValue;
  sourceDocument?: JsonValue;
};

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: JsonValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Narrow the aggregate candidate's `details.items` array back into typed
 * items. The array was built by `buildAggregateCandidate`, so every entry
 * already satisfies the shape; anything else fails closed.
 */
function explicitItems(envelope: KnowledgeEnvelope): ExplicitItem[] | null {
  const rawItems = envelope.details["items"];
  if (!Array.isArray(rawItems)) return null;
  const items: ExplicitItem[] = [];
  for (const raw of rawItems) {
    if (!isJsonObject(raw)) return null;
    const artifact = raw["artifact"];
    const value = raw["value"];
    const sourceId = asString(raw["sourceId"]);
    const recordId = asString(raw["recordId"]);
    const role = asString(raw["role"]);
    const entityType = asString(raw["entityType"]);
    const statement = asString(raw["statement"]);
    const effectiveAt = asString(raw["effectiveAt"]);
    if (sourceId === null || recordId === null || role === null || entityType === null || statement === null || effectiveAt === null || !isJsonObject(artifact) || !isJsonObject(value)) {
      return null;
    }
    items.push({
      sourceId,
      recordId,
      role,
      entityType,
      entityKey: asString(raw["entityKey"]),
      effectiveAt,
      statement,
      value,
      artifact,
      actionTargets: raw["actionTargets"],
      sourceDocument: raw["sourceDocument"],
    });
  }
  return items;
}

function validationError(code: string, message: string): KnowledgeError {
  return { kind: "validation", code, message };
}

function activeByKey(records: readonly KnowledgeRecord[]): Map<string, KnowledgeRecord[]> {
  const byKey = new Map<string, KnowledgeRecord[]>();
  for (const record of records) {
    if (record.status !== "active") continue;
    const key = asString(record.details["entityKey"]);
    if (key === null) continue;
    const existing = byKey.get(key);
    if (existing === undefined) byKey.set(key, [record]);
    else existing.push(record);
  }
  return byKey;
}

function effectiveTime(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

/** True when the candidate value keeps every current entry identical AND adds at least one new entry. */
function isStrictSuperset(currentValue: JsonObject, candidateValue: JsonObject): boolean {
  for (const [key, item] of Object.entries(currentValue)) {
    if (!(key in candidateValue) || canonicalJson(candidateValue[key]) !== canonicalJson(item)) return false;
  }
  return Object.keys(candidateValue).length > Object.keys(currentValue).length;
}
/** Fill every relationship edge; a partial input leaves unused edges empty. */
function completeRelationships(partial: Partial<KnowledgeRelationships>): KnowledgeRelationships {
  return { supports: [], contradicts: [], refines: [], supersedes: [], ...partial };
}

function createdExplicitRecord(
  candidate: KnowledgeEnvelope,
  item: ExplicitItem,
  disposition: KnowledgeDisposition,
  relatedEdges: Partial<KnowledgeRelationships>,
  relatedId: string,
): KnowledgeRecord {
  return {
    schemaVersion: 0,
    id: item.recordId,
    kind: item.role === "event" ? "evidence" : item.role === "report-claim" ? "claim" : "decision",
    status: "active",
    statement: item.statement,
    details: {
      recordRole: item.role,
      entityType: item.entityType,
      entityKey: item.entityKey,
      effectiveAt: item.effectiveAt,
      sourceId: item.sourceId,
      value: item.value,
      artifact: item.artifact,
      captureChannel: "explicit",
    },
    scope: candidate.scope,
    pack: candidate.pack,
    sources: [{ type: "engram-coach-capture", ref: item.sourceId }],
    session: candidate.session,
    submittedAt: candidate.submittedAt,
    disposition,
    relationships: completeRelationships(relatedEdges),
    history: [{ event: "created", relatedId, submittedAt: candidate.submittedAt }],
  };
}

function retiredCopy(current: KnowledgeRecord, retiredBy: string, submittedAt: string): KnowledgeRecord {
  // Preserves sources, session, scope, relationships, and history verbatim;
  // adds ONLY the status transition and one retirement history entry.
  return {
    ...current,
    status: "retired",
    history: [...current.history, { event: "retired", relatedId: retiredBy, submittedAt }],
  };
}

/**
 * Reconcile an explicit aggregate candidate against exact-key related
 * records using the design's rules 1-7:
 *   1. events append, never updating another record;
 *   2. no active exact key → create active state/report claim;
 *   3. equal canonical value → no mutation (state) or support edge (claim);
 *   4. conflict-free strict superset → refine + retire current;
 *   5. later effective time → supersede + retire current;
 *   6. same/earlier time with conflicting values → validation error;
 *   7. more than one active exact-key record → ambiguous_state error.
 */
function reconcileExplicit(input: PackReconcileInput): KnowledgeResult<PackReconciliation> {
  const items = explicitItems(input.candidate);
  if (items === null) {
    return { ok: false, errors: [validationError("explicit_items_invalid", "explicit candidate details.items is missing or malformed")] };
  }
  const errors: KnowledgeError[] = [];
  const mutations: PackMutation[] = [];
  const actives = activeByKey(input.related);
  for (const item of items) {
    if (item.role !== "state" && item.role !== "event" && item.role !== "report-claim") {
      errors.push(validationError("explicit_role_invalid", `item ${item.sourceId} has unknown recordRole ${item.role}`));
      continue;
    }
    if (item.role === "event") {
      // Deterministic record ids make an identical re-import of the same
      // source entry the SAME event, not a new one: equal id plus equal
      // canonical value and effective time dedupes to no mutation. Anything
      // else falls through to a create that still fails closed at the host
      // when the id already exists.
      const twin = input.related.find((record) => record.id === item.recordId);
      if (
        twin !== undefined
        && isJsonObject(twin.details["value"])
        && item.effectiveAt === asString(twin.details["effectiveAt"])
        && canonicalJson(item.value) === canonicalJson(twin.details["value"])
      ) {
        continue;
      }
      mutations.push({
        action: "create",
        record: createdExplicitRecord(input.candidate, item, "new", {}, item.recordId),
      });
      continue;
    }
    const key = item.entityKey;
    if (key === null) {
      errors.push(validationError("explicit_key_unbound", `item ${item.sourceId} has no bound canonical entity key`));
      continue;
    }
    const current = actives.get(key) ?? [];
    if (current.length > 1) {
      errors.push(validationError("ambiguous_state", `${current.length} active records share entity key ${key}; approval blocked pending correction`));
      continue;
    }
    const prior = current[0];
    if (prior === undefined) {
      mutations.push({
        action: "create",
        record: createdExplicitRecord(input.candidate, item, "new", {}, item.recordId),
      });
      continue;
    }
    const priorValue = prior.details["value"];
    if (!isJsonObject(priorValue)) {
      errors.push(validationError("explicit_value_invalid", `active record ${prior.id} has a non-object details.value`));
      continue;
    }
    if (item.role === "report-claim") {
      mutations.push({
        action: "create",
        record: createdExplicitRecord(input.candidate, item, "support", { supports: [prior.id] }, prior.id),
      });
      continue;
    }
    if (canonicalJson(item.value) === canonicalJson(priorValue) && item.effectiveAt === asString(prior.details["effectiveAt"])) {
      continue;
    }
    if (isStrictSuperset(priorValue, item.value)) {
      mutations.push({
        action: "create",
        record: createdExplicitRecord(input.candidate, item, "refine", { refines: [prior.id] }, prior.id),
      });
      mutations.push({ action: "update", record: retiredCopy(prior, item.recordId, input.candidate.submittedAt) });
      continue;
    }
    if (effectiveTime(item.effectiveAt) > effectiveTime(asString(prior.details["effectiveAt"]) ?? "")) {
      mutations.push({
        action: "create",
        record: createdExplicitRecord(input.candidate, item, "supersede", { supersedes: [prior.id] }, prior.id),
      });
      mutations.push({ action: "update", record: retiredCopy(prior, item.recordId, input.candidate.submittedAt) });
      continue;
    }
    errors.push(validationError(
      "state_conflict",
      `item ${item.sourceId} conflicts with active record ${prior.id} at the same or earlier effective time; approval blocked pending correction`,
    ));
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      disposition: "new",
      summary: `explicit capture planned ${mutations.filter((mutation) => mutation.action === "create").length} record(s)`,
      mutations,
    },
  };
}

/**
 * Related-record selection for the coaching pack.
 *
 * Explicit aggregate candidates (`details.captureChannel === "explicit"`)
 * use EXACT mode: records from this pack whose `details.entityKey` is one
 * of the candidate's bound keys — semantic search never selects identity.
 * Legacy generic envelopes keep the coaching search query until ambient
 * review promotion uses structured records.
 */
export function selectRelatedRecords(envelope: KnowledgeEnvelope): RelatedRecordSelection {
  if (envelope.details["captureChannel"] === "explicit") {
    const items = explicitItems(envelope) ?? [];
    const keys = [...new Set(items.map((item) => item.entityKey).filter((key): key is string => key !== null))];
    const keySet: Record<string, true> = {};
    for (const key of keys) keySet[key] = true;
    // Append-only events are typically unbound, so their deterministic
    // record ids are the only exact identity for recognizing an identical
    // re-import of the same source entry.
    const idSet: Record<string, true> = {};
    for (const item of items) idSet[item.recordId] = true;
    const descriptions = [
      keys.length > 0 ? `exact entity keys: ${keys.join(", ")}` : "explicit capture without bound entity keys",
      Object.keys(idSet).length > 0 ? "candidate record ids" : null,
    ];
    return {
      mode: "exact",
      description: descriptions.filter((part): part is string => part !== null).join("; "),
      matches: (record) =>
        record.pack.id === engramCoachPackId
        && ((typeof record.details["entityKey"] === "string"
          && keySet[record.details["entityKey"] as string] === true)
          || idSet[record.id] === true),
    };
  }
  return { mode: "search", query: coachingQuery(envelope) };
}

/**
 * Build a query string from an envelope for finding related records
 * (legacy generic envelopes only).
 */
function coachingQuery(envelope: KnowledgeEnvelope): string {
  const details = envelope.details as Partial<EngramCoachDetails> | undefined;
  const entityType = details?.entityType;
  const persona = details?.persona;
  const trainingPhase = details?.trainingPhase;
  const trainingSignals = details?.trainingSignals;

  const parts: string[] = [];

  if (entityType) parts.push(entityType);
  if (persona) parts.push(`persona:${persona}`);
  if (trainingPhase) parts.push(`phase:${trainingPhase}`);
  if (trainingSignals && trainingSignals.length > 0) {
    parts.push(trainingSignals.slice(0, 3).join(" "));
  }

  // Fall back to statement content
  const statement = envelope.statement?.trim() ?? "";
  if (parts.length === 0 && statement) {
    parts.push(statement.slice(0, 100));
  } else if (parts.length === 0) {
    parts.push("coaching observation");
  }

  return parts.join(" ");
}