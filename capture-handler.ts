import { join } from "node:path";
import type {
  HostSessionProvenance,
  JsonObject,
  JsonValue,
  KnowledgeDisposition,
  KnowledgeEnvelope,
  KnowledgeKind,
  KnowledgeRelationships,
  KnowledgeSource,
  TurnContext,
} from "@isparling/engram-harness/knowledge-types";
import { engramCoachExtractor } from "./engram-coach-extractor.ts";
import { validateEnvelope } from "./engram-coach-reconciliation.ts";

export type CaptureTools = {
  recordsRoot: string;
  spaceId: string;
  writeFile(path: string, content: string): Promise<void>;
  refreshIndex(): Promise<void>;
};

export type CaptureSummary = {
  created: string[];
  existing: string[];
  invalid: Array<{ id: string; errors: string[] }>;
};

const KNOWLEDGE_KINDS: readonly KnowledgeKind[] = [
  "evidence",
  "claim",
  "interpretation",
  "decision",
  "recommendation",
];
const DISPOSITIONS: readonly KnowledgeDisposition[] = [
  "new",
  "support",
  "contradict",
  "refine",
  "supersede",
  "no-change",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isObject(value) && Object.values(value).every(isJsonValue);
}

function isJsonObject(value: unknown): value is JsonObject {
  return isObject(value) && Object.values(value).every(isJsonValue);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function dimensions(value: unknown): Record<string, string[]> {
  if (!isObject(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string[]] => Array.isArray(entry[1]) && entry[1].every((item) => typeof item === "string")),
  );
}

function sources(value: unknown): KnowledgeSource[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isObject(item) || typeof item.type !== "string" || typeof item.ref !== "string") return [];
    return [{ type: item.type, ref: item.ref }];
  });
}

function session(value: unknown, fallback: HostSessionProvenance): HostSessionProvenance {
  if (!isObject(value) || typeof value.id !== "string" || typeof value.host !== "string") return fallback;
  return { id: value.id, host: value.host };
}

function knowledgeKind(value: unknown): KnowledgeKind {
  return typeof value === "string" && (KNOWLEDGE_KINDS as readonly string[]).includes(value)
    ? value as KnowledgeKind
    : "claim";
}

function disposition(value: unknown): KnowledgeDisposition {
  return typeof value === "string" && (DISPOSITIONS as readonly string[]).includes(value)
    ? value as KnowledgeDisposition
    : "new";
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null) return "null";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

function serializeDraftRecord(envelope: KnowledgeEnvelope): string {
  const relationships: KnowledgeRelationships = {
    supports: [],
    contradicts: [],
    refines: [],
    supersedes: [],
  };
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
    `relationships: ${canonicalJson(relationships)}`,
    "history: []",
    "---",
    "## Statement",
    "",
    envelope.statement,
    "",
  ].join("\n");
}

function draftId(turn: TurnContext, index: number): string {
  const sessionId = turn.session.id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `engram-coach-${sessionId || "session"}-turn-${turn.turnIndex}-${index}`;
}

function submittedDate(value: unknown, turnTimestamp: string): string {
  const raw = typeof value === "string" ? value : turnTimestamp;
  return /^\d{4}-\d{2}-\d{2}/.exec(raw)?.[0] ?? new Date().toISOString().slice(0, 10);
}

function isAlreadyPresent(error: unknown): boolean {
  return isObject(error) && error.code === "EEXIST";
}

export async function captureFromTurn(
  turn: TurnContext,
  tools: CaptureTools,
): Promise<CaptureSummary> {
  const summary: CaptureSummary = { created: [], existing: [], invalid: [] };
  const candidates = await engramCoachExtractor.extractCandidates(turn, {});

  for (const [index, candidate] of candidates.entries()) {
    const raw = isObject(candidate) ? candidate : {};
    const rawScope = isObject(raw.scope) ? raw.scope : {};
    const rawPack = isObject(raw.pack) ? raw.pack : {};
    const statement = typeof raw.statement === "string"
      ? raw.statement.trim().replace(/\s*\r?\n+\s*/g, " ")
      : "";
    const envelope: KnowledgeEnvelope = {
      id: draftId(turn, index),
      kind: knowledgeKind(raw.kind),
      status: "candidate",
      statement,
      details: isJsonObject(raw.details) ? raw.details : {},
      scope: {
        space: tools.spaceId,
        subjects: stringArray(rawScope.subjects),
        topics: stringArray(rawScope.topics),
        contexts: stringArray(rawScope.contexts),
        dimensions: dimensions(rawScope.dimensions),
      },
      pack: {
        id: typeof rawPack.id === "string" ? rawPack.id : "engram-coach",
        version: typeof rawPack.version === "string" ? rawPack.version : "0.1.0",
      },
      sources: sources(raw.sources),
      session: session(raw.session, turn.session),
      submittedAt: submittedDate(raw.submittedAt ?? raw.submitted_at, turn.timestamp),
      disposition: disposition(raw.disposition),
    };

    const validation = validateEnvelope(envelope);
    if (!validation.ok) {
      summary.invalid.push({
        id: envelope.id,
        errors: validation.errors.map((error) => `${error.field ?? "envelope"}: ${error.message}`),
      });
      continue;
    }

    const path = join(tools.recordsRoot, `${envelope.id}.md`);
    try {
      await tools.writeFile(path, serializeDraftRecord(envelope));
      summary.created.push(envelope.id);
    } catch (error) {
      if (isAlreadyPresent(error)) {
        summary.existing.push(envelope.id);
        continue;
      }
      throw error;
    }
  }

  if (summary.created.length > 0 || summary.existing.length > 0) await tools.refreshIndex();
  return summary;
}
