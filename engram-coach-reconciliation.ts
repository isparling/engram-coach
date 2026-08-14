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
  KnowledgeEnvelope,
  KnowledgeResult,
  PackReconciliation,
  PackReconcileInput,
  KnowledgeRecord,
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

/**
 * Build a query string from an envelope for finding related records.
 */
export function relatedQuery(envelope: KnowledgeEnvelope): string {
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