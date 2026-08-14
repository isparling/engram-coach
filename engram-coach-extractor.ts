/**
 * engram-coach LLM-powered knowledge extractor.
 *
 * Implements the KnowledgeExtractor interface using the Engram harness LLM helper
 * when available. For each turn, the LLM analyzes the conversation and
 * produces structured coaching-aware candidates classified into engram-coach's
 * domain ontology (entity types, decision kinds, training signals, phases,
 * personas). Falls back to deterministic keyword matching when the LLM
 * helper is absent.
 *
 * @module engram-coach-extractor
 */

import type { TurnContext, PackHelpers } from "@isparling/engram-harness/knowledge-types";
import {
  ENGRAM_COACH_ENTITY_TYPES,
  ENGRAM_COACH_DECISION_KINDS,
  ENGRAM_COACH_TRAINING_SIGNALS,
  ENGRAM_COACH_TRAINING_PHASES,
  ENGRAM_COACH_PERSONAS,
  COACHING_TOPIC_HINTS,
  type EngramCoachDetails,
  type EngramCoachEntityType,
  type EngramCoachDecisionKind,
} from "./engram-coach-domain.ts";

export const engramCoachPackId = "engram-coach";
export const engramCoachPackVersion = "0.1.0";

/**
 * System prompt for the LLM-powered extractor.
 *
 * Instructs the LLM to analyze a conversation turn and produce structured
 * coaching observations classified into the engram-coach domain ontology.
 */
const EXTRACTION_SYSTEM_PROMPT = `You are a coaching domain classifier embedded in the engram-coach coaching system. Your task is to analyze conversation turns and extract structured knowledge candidates about coaching decisions.

## Domain ontology

### Entity types — what kind of coaching artifact or concept this turn is about:
${ENGRAM_COACH_ENTITY_TYPES.map((t) => `- ${t}`).join("\n")}

### Decision kinds — what type of coaching judgment is being rendered:
${ENGRAM_COACH_DECISION_KINDS.map((k) => `- ${k}`).join("\n")}

### Training signals — physiological metrics mentioned:
${ENGRAM_COACH_TRAINING_SIGNALS.map((s) => `- ${s}`).join("\n")}

### Training phases:
${ENGRAM_COACH_TRAINING_PHASES.map((p) => `- ${p}`).join("\n")}

### Personas:
${ENGRAM_COACH_PERSONAS.map((p) => `- ${p}`).join("\n")}

## Classification rules

1. Return an empty JSON array \`[]\` if this turn contains no coaching-relevant content. Coaching-relevant means: training data, workout execution, adaptation decisions, race/event planning, consultation/advice, health signals (illness/injury/sleep/nutrition), monitoring concerns, goal/arc planning, coaching setup (intake/persona), lactate analysis, or block/season reviews.

2. Each candidate must be a JSON object with these fields:
   - \`entityType\`: one of the entity types above
   - \`decisionKind\`: one of the decision kinds above
   - \`statement\`: a concise, factual one-sentence statement of what was observed or decided (max 300 chars)
   - \`trainingSignals\`: array of signal names mentioned (or empty array)
   - \`trainingPhase\`: training phase if identifiable, else null
   - \`persona\`: persona if mentioned or obvious from context, else null
   - \`topics\`: 1-4 topic labels useful for retrieval (e.g., "interval fade", "sweet spot prescription", "LT2 update", "HRV suppression")

3. For \`statement\`, prefer concrete observations over generic ones:
   - GOOD: "Athlete reported RPE 8.5 on final interval with power fade >10%"
   - BAD: "Athlete had a hard workout"
   - GOOD: "Athlete switched persona from conservative to aggressive for build phase"
   - BAD: "Persona change"

4. Return at most 3 candidates per turn. Prioritize candidates that represent decisions or new observations over routine status updates.

5. Return ONLY the JSON array. No preamble, no explanation, no markdown.`;

/**
 * Deterministic fallback: check if the turn narrative mentions coaching
 * topics. Returns the most likely entity type based on matched terms.
 */
function coachingRelevantEntityType(text: string): EngramCoachEntityType | null {
  const lower = text.toLowerCase();

  // Simple greedy: return null if no topic matched
  if (!COACHING_TOPIC_HINTS.some((hint) => lower.includes(hint))) {
    return null;
  }

  // Map topics to entity types
  // Arc-planning: goal+arc/target is most specific — check first
  if (
    (lower.includes("goal") || lower.includes("arc")) &&
    (lower.includes("target") || lower.includes("methodology"))
  ) {
    return "arc-plan";
  }
  if (lower.includes("race") && (lower.includes("report") || lower.includes("analysis"))) {
    return "race-report";
  }
  if (lower.includes("block") && (lower.includes("review") || lower.includes("summary"))) {
    return "block-review";
  }
  if (lower.includes("season") && (lower.includes("review") || lower.includes("retrospective"))) {
    return "season-review";
  }
  if (lower.includes("consult") || lower.includes("advice") || lower.includes("question about")) {
    return "consultation";
  }
  if (lower.includes("intake") || lower.includes("setup") || lower.includes("onboard")) {
    return "intake-record";
  }
  if (lower.includes("adapt") || lower.includes("modify") || lower.includes("delta") || lower.includes("prescription")) {
    return "workout-adaptation";
  }
  if (lower.includes("lactate") || lower.includes("threshold") || lower.includes("lt1") || lower.includes("lt2")) {
    return "lactate-test";
  }
  if (lower.includes("monitor") || lower.includes("concern") || lower.includes("symptom") || lower.includes("tracking")) {
    return "monitoring-capture";
  }
  if (lower.includes("persona") || lower.includes("philosophy")) {
    return "persona-fit";
  }
  if (lower.includes("lesson") || lower.includes("calibration") || lower.includes("profile") || lower.includes("rollup")) {
    return "calibration-point";
  }
  if (lower.includes("race") || lower.includes("event")) {
    return "race-report";
  }

  // Generic coaching observation
  return "session-execution";
}

function deterministicDecisionKind(entityType: EngramCoachEntityType): EngramCoachDecisionKind {
  const map: Record<EngramCoachEntityType, EngramCoachDecisionKind> = {
    "workout-adaptation": "workout-adaptation",
    consultation: "consultation-advice",
    "block-review": "block-restructure",
    "race-report": "workout-adaptation",
    "season-review": "arc-planning",
    "arc-plan": "arc-planning",
    "lactate-test": "threshold-update",
    "monitoring-capture": "monitoring-capture",
    "intake-record": "setup-decision",
    prescription: "arc-planning",
    "persona-fit": "persona-change",
    "calibration-point": "profile-claim",
    methodology: "arc-planning",
    "session-execution": "workout-adaptation",
  };
  return map[entityType];
}

/**
 * Parse the LLM's JSON response into candidate objects.
 * Returns empty array on any parse failure.
 */
function parseLlmResponse(raw: string): Record<string, unknown>[] {
  const trimmed = raw.trim();

  // Strip markdown code fences if present
  const jsonStr = trimmed.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");

  try {
    const parsed = JSON.parse(jsonStr);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

/**
 * The engram-coach extractor facet.
 *
 * Uses LLM when available (via PackHelpers.llm.complete) to produce
 * coaching-aware candidates classified into the domain ontology.
 * Falls back to deterministic keyword matching without LLM.
 */
export const engramCoachExtractor = {
  id: engramCoachPackId,
  version: engramCoachPackVersion,

  async extractCandidates(
    turn: TurnContext,
    helpers: PackHelpers,
  ): Promise<Record<string, unknown>[]> {
    const narrative = turn.narrative?.trim() ?? "";
    if (!narrative) return [];

    // -------------------------------------------------------------------------
    // LLM path
    // -------------------------------------------------------------------------
    if (helpers.llm?.complete) {
      try {
        const raw = await helpers.llm.complete(
          `Analyze this conversation turn and extract coaching knowledge candidates as JSON:\n\n${narrative}`,
          { system: EXTRACTION_SYSTEM_PROMPT },
        );

        const candidates = parseLlmResponse(raw);
        if (candidates.length > 0) {
          // Enrich each candidate with pack metadata
          return candidates.map((c, i) => {
            const entityType = (c.entityType as EngramCoachEntityType) ?? "session-execution";
            const decisionKind = (c.decisionKind as EngramCoachDecisionKind) ?? "workout-adaptation";
            const statement = (c.statement as string) ?? narrative.slice(0, 300);
            const topics = (c.topics as string[]) ?? ["coaching:observation"];

            const details: EngramCoachDetails = {
              skill: undefined,
              entityType,
              decisionKind,
              trainingSignals: c.trainingSignals as EngramCoachDetails["trainingSignals"],
              trainingPhase: c.trainingPhase as EngramCoachDetails["trainingPhase"],
              persona: c.persona as EngramCoachDetails["persona"],
              turnIndex: turn.turnIndex,
              extractionConfidence: "high",
            };

            return {
              id: `engram-coach-turn-${turn.turnIndex}-${i}-${Date.now()}`,
              kind: "decision",
              status: "candidate",
              disposition: "new",
              scope: {
                space: engramCoachPackId,
                subjects: [],
                topics,
                contexts: [],
                dimensions: {},
              },
              pack: { id: engramCoachPackId, version: engramCoachPackVersion },
              sources: [
                { type: "engram-coach-extractor", ref: `session:${turn.session.id}` },
                { type: "llm-inference", ref: `turn:${turn.turnIndex}` },
              ],
              session: turn.session,
              submittedAt: turn.timestamp,
              details: details as unknown as Record<string, unknown>,
              statement: statement.slice(0, 512),
            };
          });
        }
      } catch {
        // LLM call failed — fall through to deterministic path
      }
    }

    // -------------------------------------------------------------------------
    // Deterministic fallback path
    // -------------------------------------------------------------------------
    if (narrative.length === 0) return [];

    const entityType = coachingRelevantEntityType(narrative);
    if (!entityType) return [];

    const decisionKind = deterministicDecisionKind(entityType);

    const details: EngramCoachDetails = {
      skill: undefined,
      entityType,
      decisionKind,
      turnIndex: turn.turnIndex,
      extractionConfidence: "low",
    };

    const id = `engram-coach-turn-${turn.turnIndex}-${Date.now()}`;
    return [
      {
        id,
        kind: "decision",
        status: "candidate",
        disposition: "new",
        scope: {
          space: engramCoachPackId,
          subjects: [],
          topics: ["coaching:observation"],
          contexts: [],
          dimensions: {},
        },
        pack: { id: engramCoachPackId, version: engramCoachPackVersion },
        sources: [
          { type: "engram-coach-extractor", ref: `session:${turn.session.id}` },
        ],
        session: turn.session,
        submittedAt: turn.timestamp,
        details: details as unknown as Record<string, unknown>,
        statement: narrative.slice(0, 300),
      },
    ];
  },
};