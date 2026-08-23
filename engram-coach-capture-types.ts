/**
 * engram-coach typed capture domain input.
 *
 * These types cross the OMP tool boundary as JSON, so JSON-facing domain
 * inputs use snake_case. Skills provide domain values and artifact metadata
 * but never record IDs, lifecycle statuses, relationship arrays, or
 * retirement targets — those are pack-owned.
 *
 * Host mechanics DTOs are imported as types from
 * `@isparling/engram-harness/capture-types` and never duplicated here.
 *
 * @module engram-coach-capture-types
 */

import type {
  ArtifactReplacementResult,
  CaptureMutationView,
  CompletionRequest,
  HostCaptureApply,
  HostCapturePreview,
} from "@isparling/engram-harness/capture-types";
import type { JsonObject, KnowledgeError } from "@isparling/engram-harness/knowledge-types";
import type { EngramCoachSkill } from "./engram-coach-domain.ts";

/** Current schema version for every structured capture payload. */
export const SCHEMA_VERSION = 0;

// ---------------------------------------------------------------------------
// Explicit skill capture — typed domain input
// ---------------------------------------------------------------------------

export type RecordRole = "state" | "event" | "report-claim";

export type StructuredCaptureSource = {
  skill: EngramCoachSkill;
  session_id: string;
  turn_id: number;
};

export type StructuredStateChange = {
  entity_type: "workout" | "prescription" | "threshold" | "persona" | "monitoring";
  key_components: JsonObject;
  effective_at: string;
  statement: string;
  details: JsonObject;
};

export type StructuredEvent = {
  entity_type: "consultation" | "workout-adaptation" | "monitoring-event";
  effective_at: string;
  statement: string;
  action_targets: string[];
  details: JsonObject;
};

export type StructuredReportClaim = {
  entity_type:
    | "race-conclusion"
    | "block-conclusion"
    | "season-conclusion"
    | "methodology-conclusion"
    | "arc-conclusion";
  key_components: JsonObject;
  effective_at: string;
  statement: string;
  source_document: string;
  details: JsonObject;
};

export type StructuredChangeSet = {
  schema_version: 0;
  source: StructuredCaptureSource;
  state_changes: StructuredStateChange[];
  events: StructuredEvent[];
  report_claims: StructuredReportClaim[];
};

/** Builds an empty, well-formed change set for a skill session/turn. */
export function makeEmptyChangeSet(source: StructuredCaptureSource): StructuredChangeSet {
  return {
    schema_version: SCHEMA_VERSION,
    source,
    state_changes: [],
    events: [],
    report_claims: [],
  };
}

// ---------------------------------------------------------------------------
// Preview — JSON-safe ready/blocked union
// ---------------------------------------------------------------------------

/**
 * Pack-facing capture preview, mirroring the host DTO union: a ready preview
 * carries the exact plan hash the athlete approves plus the record mutations
 * it would commit; a blocked preview carries validation errors and never
 * reaches Phase 4 presentation.
 */
export type CapturePreview = HostCapturePreview;

// ---------------------------------------------------------------------------
// Apply — the committed plan handed to materialization
// ---------------------------------------------------------------------------

/**
 * The applied-plan input to materialization: the host's apply result after a
 * successful commit, carrying the approved plan hash and the exact record
 * mutations that were committed. Materialization retry is idempotent and
 * never reapplies these record mutations.
 */
export type AppliedCapturePlan = Pick<HostCaptureApply, "planHash" | "mutations">;

// ---------------------------------------------------------------------------
// Ambient capture summary
// ---------------------------------------------------------------------------

/**
 * Result of ambient conversation capture. `warnings` carries visible,
 * non-blocking diagnostics — LLM timeout, cancellation, model failure, or
 * unrepaired JSON produce no draft and only a warning.
 */
export type CaptureSummary = {
  created: string[];
  existing: string[];
  invalid: Array<{ id: string; errors: string[] }>;
  warnings: string[];
};

// ---------------------------------------------------------------------------
// Materialization result
// ---------------------------------------------------------------------------

/**
 * Outcome of regenerating compatibility views after a committed apply.
 * `written` and `unchanged` mirror the host's artifact-replacement result;
 * `stale` lists views whose regeneration failed and must be retried
 * idempotently — record commit remains authoritative regardless.
 */
export type MaterializationResult = {
  written: ArtifactReplacementResult[];
  unchanged: ArtifactReplacementResult[];
  stale: Array<{ path: string; reason: string }>;
};

// Re-exported host mechanics DTOs for sibling capture modules (ambient
// completion uses CompletionRequest; reconciliation consumes
// CaptureMutationView). Types only — no runtime surface.
export type {
  ArtifactReplacementResult,
  CaptureMutationView,
  CompletionRequest,
  HostCapturePreview,
  KnowledgeError,
};
