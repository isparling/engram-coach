/**
 * engram-coach ambient capture handler — candidate-only persistence.
 *
 * The extension calls this at awaited OMP `session_stop` with the latest user
 * turn. Extraction itself lives in `engram-coach-ambient-capture.ts`; this
 * module owns what happens to the result:
 *
 *   - canonical key derivation that never authorizes replacement;
 *   - suppression of ambient candidates the explicit channel already applied
 *     in this same turn;
 *   - deterministic IDs plus create-only writes, so re-settling a turn cannot
 *     duplicate a draft;
 *   - a single scoped index refresh.
 *
 * Every record written here is `status: "candidate"` with empty relationship
 * arrays. Ambient extraction proposes; it never retires or supersedes an
 * active record before review. Every failure becomes a warning rather than an
 * exception, so a slow or broken extraction model can never block the
 * coaching response or the explicit Phase 5 path.
 */

import { createHash } from "node:crypto";
import { join } from "node:path";
import type {
  JsonObject,
  KnowledgeEnvelope,
  KnowledgeRelationships,
  TurnContext,
  TurnToolCall,
} from "@isparling/engram-harness/knowledge-types";
import type { CompletionRequest } from "@isparling/engram-harness/capture-types";
import type { CaptureSummary } from "./engram-coach-capture-types.ts";
import {
  extractAmbientCandidates,
  type AmbientCandidate,
} from "./engram-coach-ambient-capture.ts";
import { loadEngramCoachConfig, type EngramCoachRuntimeConfig } from "./engram-coach-config.ts";
import { deriveCanonicalEntityKey } from "./engram-coach-keys.ts";
import { validateEnvelope } from "./engram-coach-reconciliation.ts";

/**
 * Host mechanics supplied by the extension. It owns no coaching ontology: it
 * only spawns the isolated completion, confines writes to the records root,
 * and refreshes the scoped index.
 */
export type CaptureTools = {
  recordsRoot: string;
  spaceId: string;
  projectRoot: string;
  writeFile(path: string, content: string): Promise<void>;
  refreshIndex(): Promise<void>;
  complete(request: CompletionRequest): Promise<string>;
};

export type { CaptureSummary } from "./engram-coach-capture-types.ts";

// ---------------------------------------------------------------------------
// Duplicate suppression from explicit tool provenance
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Entity keys a successful `engram_capture_apply` already committed in this
 * same turn. Membership is decided at runtime over an unbounded key space, so
 * a Set is the right structure here.
 */
export function appliedEntityKeys(toolCalls: readonly TurnToolCall[]): Set<string> {
  const keys = new Set<string>();
  for (const call of toolCalls) {
    if (call.tool !== "engram_capture_apply") continue;
    const result = call.result;
    const parsed = typeof result === "string" ? safeJson(result) : result;
    if (!isObject(parsed)) continue;
    const status = parsed.status;
    if (status !== "committed" && status !== "no-change" && status !== "records-committed") continue;
    for (const key of stringArray(parsed.entity_keys)) keys.add(key);
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Record construction
// ---------------------------------------------------------------------------

function canonicalJson(value: unknown): string {
  if (value === undefined || value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

/**
 * Deterministic ambient record ID. Session, the stable turn index, the
 * candidate index, and canonical candidate content all participate, so
 * re-settling the same turn with the same extraction reproduces the same ID —
 * which is what makes create-only writes idempotent instead of duplicating.
 */
export function ambientRecordId(
  sessionId: string,
  turnIndex: number,
  candidateIndex: number,
  candidate: AmbientCandidate,
): string {
  const digest = createHash("sha256")
    .update(canonicalJson({
      sessionId,
      turnIndex,
      candidateIndex,
      kind: candidate.kind,
      statement: candidate.statement,
      entityType: candidate.entityType,
      keyedEntityType: candidate.keyedEntityType,
      keyComponents: candidate.keyComponents,
      effectiveAt: candidate.effectiveAt,
    }))
    .digest("hex")
    .slice(0, 24);
  return `coach-ambient-${digest}`;
}

const EMPTY_RELATIONSHIPS: KnowledgeRelationships = {
  supports: [],
  contradicts: [],
  refines: [],
  supersedes: [],
};

function serializeDraftRecord(envelope: KnowledgeEnvelope): string {
  return [
    "---",
    "schema_version: 0",
    `id: ${canonicalJson(envelope.id)}`,
    `kind: ${canonicalJson(envelope.kind)}`,
    `status: ${canonicalJson(envelope.status)}`,
    `statement: ${canonicalJson(envelope.statement)}`,
    `details: ${canonicalJson(envelope.details)}`,
    `scope: ${canonicalJson(envelope.scope)}`,
    `pack: ${canonicalJson(envelope.pack)}`,
    `sources: ${canonicalJson(envelope.sources)}`,
    `session: ${canonicalJson(envelope.session)}`,
    `submitted_at: ${canonicalJson(envelope.submittedAt)}`,
    `disposition: ${canonicalJson(envelope.disposition)}`,
    `relationships: ${canonicalJson(EMPTY_RELATIONSHIPS)}`,
    "history: []",
    "---",
    "## Statement",
    "",
    envelope.statement,
    "",
  ].join("\n");
}

function submittedDate(turnTimestamp: string): string {
  return /^\d{4}-\d{2}-\d{2}/.exec(turnTimestamp)?.[0] ?? turnTimestamp;
}

function isAlreadyPresent(error: unknown): boolean {
  return isObject(error) && error.code === "EEXIST";
}

/**
 * Build the candidate envelope. A derivable key is recorded so review can find
 * the entity it concerns; an underivable one records the diagnostic instead.
 * Either way the record stays a candidate with empty relationships.
 */
function buildEnvelope(
  candidate: AmbientCandidate,
  id: string,
  entityKey: string | null,
  bindingError: string | null,
  turn: TurnContext,
  tools: CaptureTools,
  config: EngramCoachRuntimeConfig,
): KnowledgeEnvelope {
  const details: JsonObject = {
    captureChannel: "ambient",
    entityKey,
    activeProfile: config.activeProfile,
  };
  if (candidate.entityType !== null) details.entityType = candidate.entityType;
  if (candidate.effectiveAt !== null) details.effectiveAt = candidate.effectiveAt;
  if (Object.keys(candidate.keyComponents).length > 0) {
    details.keyComponents = candidate.keyComponents;
  }
  if (bindingError !== null) details.bindingError = bindingError;

  return {
    id,
    kind: candidate.kind,
    status: "candidate",
    statement: candidate.statement,
    details,
    scope: {
      space: tools.spaceId,
      subjects: candidate.subjects,
      topics: candidate.topics,
      contexts: [],
      dimensions: {},
    },
    pack: { id: "engram-coach", version: "0.1.0" },
    sources: [
      { type: "session", ref: `session:${turn.session.id}/turn:${turn.turnIndex}` },
      { type: "inference", ref: `llm-inference:${config.capture.model}` },
    ],
    session: turn.session,
    submittedAt: submittedDate(turn.timestamp),
    disposition: "new",
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/** Ambient capture for one settled turn. Always resolves. */
export async function captureFromTurn(
  turn: TurnContext,
  tools: CaptureTools,
): Promise<CaptureSummary> {
  const summary: CaptureSummary = { created: [], existing: [], invalid: [], warnings: [] };

  const userText = turn.narrative.trim();
  if (userText.length === 0) return summary;

  let config: EngramCoachRuntimeConfig;
  try {
    config = await loadEngramCoachConfig({ projectRoot: tools.projectRoot });
  } catch (error) {
    summary.warnings.push(`ambient capture is not configured: ${String(error)}`);
    return summary;
  }

  const extraction = await extractAmbientCandidates(userText, config, tools);
  summary.warnings.push(...extraction.warnings);
  if (extraction.candidates.length === 0) return summary;

  const alreadyApplied = appliedEntityKeys(turn.toolCalls);

  for (const [index, candidate] of extraction.candidates.entries()) {
    let entityKey: string | null = null;
    let bindingError: string | null = null;
    if (candidate.keyedEntityType !== null) {
      const derived = deriveCanonicalEntityKey({
        entity_type: candidate.keyedEntityType,
        key_components: candidate.keyComponents,
      });
      if (derived.kind === "bound") entityKey = derived.key;
      else bindingError = derived.reason;
    }

    // The explicit channel already captured this key in this same turn, under
    // athlete approval. Unrelated candidates from the turn are untouched.
    if (entityKey !== null && alreadyApplied.has(entityKey)) continue;

    const id = ambientRecordId(turn.session.id, turn.turnIndex, index, candidate);
    const envelope = buildEnvelope(candidate, id, entityKey, bindingError, turn, tools, config);

    const validation = validateEnvelope(envelope);
    if (!validation.ok) {
      summary.invalid.push({
        id: envelope.id,
        errors: validation.errors.map((error) => `${error.field ?? "envelope"}: ${error.message}`),
      });
      continue;
    }

    try {
      await tools.writeFile(
        join(tools.recordsRoot, `${envelope.id}.md`),
        serializeDraftRecord(envelope),
      );
      summary.created.push(envelope.id);
    } catch (error) {
      if (isAlreadyPresent(error)) {
        summary.existing.push(envelope.id);
        continue;
      }
      summary.warnings.push(`ambient draft write failed for ${envelope.id}: ${String(error)}`);
    }
  }

  if (summary.created.length > 0 || summary.existing.length > 0) {
    try {
      await tools.refreshIndex();
    } catch (error) {
      summary.warnings.push(`ambient index refresh failed: ${String(error)}`);
    }
  }
  return summary;
}
