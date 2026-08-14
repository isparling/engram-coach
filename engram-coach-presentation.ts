/**
 * engram-coach profile presentation — deterministic, record-derived athlete
 * profile projection and audience authorization policy.
 *
 * Implements the PresentationPack interface: a single retrieval policy that
 * scopes guarded retrieval to active engram-coach records, one `athlete-profile`
 * view whose projection is built only from the statements and details already
 * present on the retrieved records (no inferred facts, diagnoses, or
 * prescriptions), and four audiences that gate which records each role may
 * see before that projection is adapted into a delivery draft.
 *
 * `athlete`, `coach`, and `self-coach` authorize every record the retrieval
 * policy accepts. `clinician` is narrower: monitoring captures, lactate
 * tests, and any record (including workout adaptations) that carries a
 * health-relevant training signal.
 *
 * @module engram-coach-presentation
 */

import type {
  KnowledgeRecord,
  PresentationPack,
  SemanticProjection,
  AudienceAdaptationInput,
  PresentationDraft,
} from "@isparling/engram-harness/knowledge-types";

// Duplicated locally (mirrors the same constants in `engram-coach-pack.ts`
// and `engram-coach-extractor.ts`) so this module never needs to import the
// pack composition module — `engram-coach-pack.ts` imports this module to
// assemble the full pack, and a reverse import would create a cycle.
export const engramCoachPackId = "engram-coach";
export const engramCoachPackVersion = "0.1.0";

// ---------------------------------------------------------------------------
// Clinician authorization — monitoring captures, lactate tests, and any
// record (workout adaptations included) carrying a health-relevant signal.
// `record.details` is an untyped `JsonObject`; every read below narrows via
// `typeof`/`Array.isArray`/direct literal comparison instead of asserting
// the payload into the domain's `EngramCoachDetails` shape.
// ---------------------------------------------------------------------------

const CLINICIAN_TRAINING_SIGNALS: Readonly<Record<string, true>> = {
  hrv: true,
  rhr: true,
  "lactate-threshold": true,
  sleep: true,
  stress: true,
  illness: true,
  injury: true,
};

function hasClinicalSignal(record: KnowledgeRecord): boolean {
  const value = record.details.trainingSignals;
  if (!Array.isArray(value)) return false;
  return value.some((signal) => typeof signal === "string" && CLINICIAN_TRAINING_SIGNALS[signal] === true);
}

// ---------------------------------------------------------------------------
// Retrieval policy — scope every query and profile enumeration to active
// engram-coach records only.
// ---------------------------------------------------------------------------

const retrievalPolicy: PresentationPack["retrievalPolicy"] = {
  allowedSourceClasses: ["engram-coach"],
  queryStrategy: ({ query }) => query,
  classifySource: () => "engram-coach",
  relevanceThreshold: null,
  isEligible: (record) =>
    record.status === "active" && record.pack.id === engramCoachPackId,
  includePresentations: false,
};

// ---------------------------------------------------------------------------
// `athlete-profile` view — deterministic, record-derived projection.
// ---------------------------------------------------------------------------

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function projectAthleteProfile(records: readonly KnowledgeRecord[]): SemanticProjection {
  const facts = uniqueSorted(records.map((record) => record.statement));
  const uncertainty = uniqueSorted(
    records
      .filter((record) => record.details.extractionConfidence === "low")
      .map((record) => record.statement),
  );
  const activeRecommendations = records.filter(
    (record) => record.status === "active" && record.kind === "recommendation",
  );
  const actions = uniqueSorted(activeRecommendations.map((record) => record.statement));
  const recommendationIds = uniqueSorted(activeRecommendations.map((record) => record.id));

  return {
    title: "Engram coach athlete profile",
    summary:
      "Deterministic projection of active, retrieval-eligible engram-coach records for the requesting audience.",
    facts,
    requiredFacts: [...facts],
    uncertainty,
    actions,
    recommendationIds,
  };
}

const athleteProfileView: PresentationPack["views"][number] = {
  id: "athlete-profile",
  version: 1,
  scope: "space",
  retrievalQuery: (requestedQuery) => requestedQuery ?? "",
  project: projectAthleteProfile,
};

// ---------------------------------------------------------------------------
// Audiences — authorization plus a draft adaptation that carries the
// projection's facts, uncertainty, actions, and recommendation IDs forward
// unchanged. No audience adds content the projection did not already derive
// from the authorized records.
// ---------------------------------------------------------------------------

function adaptFromProjection(title: string) {
  return ({ projection }: AudienceAdaptationInput): PresentationDraft => ({
    title,
    summary: projection.summary,
    facts: [...projection.facts],
    uncertainty: [...projection.uncertainty],
    actions: [...projection.actions],
    recommendationIds: [...projection.recommendationIds],
  });
}

const athleteAudience: PresentationPack["audiences"][number] = {
  id: "athlete",
  version: 1,
  authorize: retrievalPolicy.isEligible,
  adapt: adaptFromProjection("Athlete profile"),
};

const coachAudience: PresentationPack["audiences"][number] = {
  id: "coach",
  version: 1,
  authorize: retrievalPolicy.isEligible,
  adapt: adaptFromProjection("Coach profile"),
};

const selfCoachAudience: PresentationPack["audiences"][number] = {
  id: "self-coach",
  version: 1,
  authorize: retrievalPolicy.isEligible,
  adapt: adaptFromProjection("Self-coach profile"),
};

const clinicianAudience: PresentationPack["audiences"][number] = {
  id: "clinician",
  version: 1,
  authorize: (record) => {
    if (!retrievalPolicy.isEligible(record)) return false;
    const entityType = record.details.entityType;
    if (entityType === "monitoring-capture" || entityType === "lactate-test") return true;
    return hasClinicalSignal(record);
  },
  adapt: adaptFromProjection("Clinician profile"),
};

// ---------------------------------------------------------------------------
// Deliveries
// ---------------------------------------------------------------------------

const deliveries: PresentationPack["deliveries"] = [
  { id: "profile-markdown", version: 1, format: "markdown", maxWords: 5000, retain: true },
];

// ---------------------------------------------------------------------------
// The engram-coach PresentationPack facet.
// ---------------------------------------------------------------------------

export const engramCoachPresentation: PresentationPack = {
  id: engramCoachPackId,
  version: engramCoachPackVersion,
  retrievalPolicy,
  views: [athleteProfileView],
  audiences: [athleteAudience, coachAudience, selfCoachAudience, clinicianAudience],
  deliveries,
};

export default engramCoachPresentation;
