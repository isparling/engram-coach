/**
 * engram-coach ambient extraction — the LLM-only capture channel.
 *
 * At awaited OMP `session_stop` the extension hands this pack the latest user
 * turn and a bounded, isolated `complete()` mechanic backed by a child OMP
 * process. This module owns the prompt, the strict response schema, response
 * validation, and the single repair attempt. Persistence, key derivation, and
 * duplicate suppression live in `capture-handler.ts`.
 *
 * Two rules shape everything here:
 *
 *   1. Strict JSON only. Markdown fences are rejected rather than stripped: a
 *      fenced reply means the model ignored the contract, and quietly
 *      repairing it here would hide that from the one repair attempt.
 *   2. No deterministic fallback. A timeout, a cancellation, a model failure,
 *      or a second invalid response yields a visible warning and no
 *      candidates — never a keyword-derived transcript excerpt.
 *
 * See `engram-coach-structured-capture.ts` for the explicit, hash-bound
 * channel that skills use for facts they already structured.
 */

import type {
  JsonObject,
  JsonValue,
  KnowledgeKind,
} from "@isparling/engram-harness/knowledge-types";
import type { CompletionRequest } from "@isparling/engram-harness/capture-types";
import type { EngramCoachRuntimeConfig } from "./engram-coach-config.ts";
import type { KeyedEntityType } from "./engram-coach-keys.ts";
import { ENGRAM_COACH_ENTITY_TYPES } from "./engram-coach-domain.ts";

// ---------------------------------------------------------------------------
// Warning vocabulary
// ---------------------------------------------------------------------------

export const AMBIENT_INVALID_JSON_WARNING =
  "ambient capture returned invalid JSON after one repair attempt";
export const AMBIENT_CANCELLED_WARNING = "ambient capture was cancelled before completion";
export const AMBIENT_TIMEOUT_WARNING = "ambient capture timed out before completion";
export const AMBIENT_MODEL_FAILED_WARNING = "ambient capture model call failed";

/**
 * Map a host completion failure onto one stable warning. The host
 * distinguishes cancellation, timeout, and model failure by message prefix;
 * anything else is reported as a model failure with its detail attached.
 */
export function completionWarning(error: unknown): string {
  const message = String(error);
  if (message.includes("capture_cancelled")) return AMBIENT_CANCELLED_WARNING;
  if (message.includes("capture_timeout")) return AMBIENT_TIMEOUT_WARNING;
  if (message.includes("capture_model_failed")) return AMBIENT_MODEL_FAILED_WARNING;
  return `${AMBIENT_MODEL_FAILED_WARNING}: ${message}`;
}

// ---------------------------------------------------------------------------
// Response contract
// ---------------------------------------------------------------------------

const KNOWLEDGE_KINDS: readonly KnowledgeKind[] = [
  "evidence",
  "claim",
  "interpretation",
  "decision",
  "recommendation",
];

/** State entity types that can carry a canonical key. */
const KEYED_ENTITY_TYPES: readonly KeyedEntityType[] = [
  "workout",
  "prescription",
  "threshold",
  "persona",
  "monitoring",
];

export const MAX_STATEMENT_LENGTH = 512;

/** One validated ambient candidate, before it becomes an envelope. */
export type AmbientCandidate = {
  kind: KnowledgeKind;
  statement: string;
  entityType: string | null;
  keyedEntityType: KeyedEntityType | null;
  keyComponents: JsonObject;
  effectiveAt: string | null;
  subjects: string[];
  topics: string[];
};

/** Host mechanic this module needs: one bounded, isolated completion. */
export type AmbientCompleter = {
  complete(request: CompletionRequest): Promise<string>;
};

const RESPONSE_SCHEMA = `{
  "candidates": [
    {
      "kind": "evidence | claim | interpretation | decision | recommendation",
      "statement": "one atomic sentence, at most ${MAX_STATEMENT_LENGTH} characters",
      "entity_type": "${ENGRAM_COACH_ENTITY_TYPES.join(" | ")}",
      "keyed_entity_type": "${KEYED_ENTITY_TYPES.join(" | ")} | null",
      "key_components": { "session_id": "...", "arc_id": "...", "sport": "...", "concern_id": "...", "signal": "..." },
      "effective_at": "YYYY-MM-DD or null",
      "subjects": ["..."],
      "topics": ["..."]
    }
  ]
}`;

const SYSTEM_PROMPT = [
  "You extract durable coaching knowledge from one athlete message.",
  "You reply with a single JSON object and nothing else.",
  "You never wrap the JSON in Markdown fences, prose, or explanation.",
  "You never invent facts that the message does not state or clearly imply.",
].join(" ");

export function extractionPrompt(
  config: EngramCoachRuntimeConfig,
  userText: string,
  maxCandidates: number,
): string {
  return [
    "Extract durable coaching knowledge from the athlete's latest message.",
    "",
    `Active athlete profile: ${config.activeProfile}`,
    `Return at most ${maxCandidates} candidate(s). Return zero candidates when the message carries no durable coaching fact.`,
    "",
    "Each statement must be one atomic, self-contained sentence — not a transcript excerpt.",
    "Set `keyed_entity_type` and `key_components` only when the message names the entity unambiguously; otherwise use null and an empty object.",
    "",
    "Respond with exactly this JSON shape:",
    RESPONSE_SCHEMA,
    "",
    "Athlete message:",
    userText,
  ].join("\n");
}

function repairPrompt(original: string, errors: readonly string[]): string {
  return [
    "Your previous response was not valid for the required schema.",
    "",
    "Validation errors:",
    ...errors.map((error) => `- ${error}`),
    "",
    "Your previous response:",
    original,
    "",
    "Reply again with a single valid JSON object matching exactly this shape, and nothing else:",
    RESPONSE_SCHEMA,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Strict parsing and validation
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true;
  const type = typeof value;
  if (type === "string" || type === "number" || type === "boolean") return true;
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isObject(value) && Object.values(value).every(isJsonValue);
}

function jsonObject(value: unknown): JsonObject {
  if (!isObject(value)) return {};
  const result: JsonObject = {};
  for (const [key, item] of Object.entries(value)) {
    if (isJsonValue(item)) result[key] = item;
  }
  return result;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

/**
 * One-line, length-capped statement. Ambient statements are atomic facts, so
 * embedded newlines are collapsed rather than preserved.
 */
function normalizeStatement(value: string): string {
  return value.trim().replace(/\s*\r?\n+\s*/g, " ").slice(0, MAX_STATEMENT_LENGTH);
}

export type AmbientParseOutcome =
  | { ok: true; candidates: AmbientCandidate[] }
  | { ok: false; errors: string[] };

/** Parse and validate one raw model response against the strict schema. */
export function parseAmbientResponse(raw: string, maxCandidates: number): AmbientParseOutcome {
  const text = raw.trim();
  if (text.length === 0) return { ok: false, errors: ["response was empty"] };
  if (text.startsWith("```")) {
    return { ok: false, errors: ["response was wrapped in a Markdown fence; reply with bare JSON"] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`response was not valid JSON: ${String(error)}`] };
  }
  if (!isObject(parsed)) {
    return { ok: false, errors: ["top-level value must be a JSON object"] };
  }
  const rawCandidates = parsed.candidates;
  if (!Array.isArray(rawCandidates)) {
    return { ok: false, errors: ['"candidates" must be an array'] };
  }

  const errors: string[] = [];
  const candidates: AmbientCandidate[] = [];
  for (const [index, entry] of rawCandidates.entries()) {
    if (!isObject(entry)) {
      errors.push(`candidates[${index}] must be an object`);
      continue;
    }
    const rawStatement = entry.statement;
    if (typeof rawStatement !== "string" || rawStatement.trim().length === 0) {
      errors.push(`candidates[${index}].statement must be a nonempty string`);
      continue;
    }
    const kind = entry.kind;
    if (typeof kind !== "string" || !(KNOWLEDGE_KINDS as readonly string[]).includes(kind)) {
      errors.push(`candidates[${index}].kind must be one of ${KNOWLEDGE_KINDS.join(", ")}`);
      continue;
    }
    const rawEntityType = entry.entity_type;
    if (rawEntityType !== undefined && rawEntityType !== null && typeof rawEntityType !== "string") {
      errors.push(`candidates[${index}].entity_type must be a string or null`);
      continue;
    }
    if (
      typeof rawEntityType === "string" &&
      !(ENGRAM_COACH_ENTITY_TYPES as readonly string[]).includes(rawEntityType)
    ) {
      errors.push(`candidates[${index}].entity_type "${rawEntityType}" is not a known entity type`);
      continue;
    }
    const rawKeyed = entry.keyed_entity_type;
    if (
      rawKeyed !== undefined && rawKeyed !== null &&
      !(KEYED_ENTITY_TYPES as readonly string[]).includes(String(rawKeyed))
    ) {
      errors.push(
        `candidates[${index}].keyed_entity_type must be one of ${KEYED_ENTITY_TYPES.join(", ")} or null`,
      );
      continue;
    }
    const rawEffectiveAt = entry.effective_at;
    if (
      rawEffectiveAt !== undefined && rawEffectiveAt !== null &&
      !(typeof rawEffectiveAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(rawEffectiveAt))
    ) {
      errors.push(`candidates[${index}].effective_at must be YYYY-MM-DD or null`);
      continue;
    }

    candidates.push({
      kind: kind as KnowledgeKind,
      statement: normalizeStatement(rawStatement),
      entityType: typeof rawEntityType === "string" ? rawEntityType : null,
      keyedEntityType: typeof rawKeyed === "string" ? rawKeyed as KeyedEntityType : null,
      keyComponents: jsonObject(entry.key_components),
      effectiveAt: typeof rawEffectiveAt === "string" ? rawEffectiveAt : null,
      subjects: stringArray(entry.subjects),
      topics: stringArray(entry.topics),
    });
  }

  if (errors.length > 0) return { ok: false, errors };
  // The cap is pack policy, not a model promise: trim rather than reject.
  return { ok: true, candidates: candidates.slice(0, maxCandidates) };
}

// ---------------------------------------------------------------------------
// Extraction with exactly one repair attempt
// ---------------------------------------------------------------------------

export type AmbientExtraction = {
  candidates: AmbientCandidate[];
  warnings: string[];
};

/**
 * Run the configured extraction model over the latest user text. A malformed
 * first response earns exactly one repair prompt carrying the concrete
 * validation errors. A second malformed response, a timeout, a cancellation,
 * or a model failure yields zero candidates and one warning.
 */
export async function extractAmbientCandidates(
  userText: string,
  config: EngramCoachRuntimeConfig,
  tools: AmbientCompleter,
): Promise<AmbientExtraction> {
  const maxCandidates = config.capture.maxCandidatesPerTurn;
  const request: CompletionRequest = {
    model: config.capture.model,
    prompt: extractionPrompt(config, userText, maxCandidates),
    system: SYSTEM_PROMPT,
    timeoutSeconds: config.capture.timeoutSeconds,
  };

  let response: string;
  try {
    response = await tools.complete(request);
  } catch (error) {
    return { candidates: [], warnings: [completionWarning(error)] };
  }

  const first = parseAmbientResponse(response, maxCandidates);
  if (first.ok) return { candidates: first.candidates, warnings: [] };

  let repaired: string;
  try {
    repaired = await tools.complete({
      ...request,
      prompt: repairPrompt(response, first.errors),
    });
  } catch (error) {
    return { candidates: [], warnings: [completionWarning(error)] };
  }

  const second = parseAmbientResponse(repaired, maxCandidates);
  if (second.ok) return { candidates: second.candidates, warnings: [] };
  return { candidates: [], warnings: [AMBIENT_INVALID_JSON_WARNING] };
}
