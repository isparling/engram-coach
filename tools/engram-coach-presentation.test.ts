/**
 * Behavioral tests for the engram-coach profile presentation module:
 * audience authorization and the deterministic `athlete-profile` view
 * projection.
 *
 * See `tools/pack-domain.test.ts` for the domain model, extractor,
 * validation, and reconciliation test suites.
 */

import { describe, it, expect } from "vitest";
import type {
  KnowledgeRecord,
  KnowledgeKind,
  KnowledgeStatus,
  JsonObject,
} from "@isparling/engram-harness/knowledge-types";
import { engramCoachPresentation } from "../engram-coach-presentation.ts";
import { engramCoachPack } from "../engram-coach-pack.ts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRecord(options: {
  id: string;
  kind: KnowledgeKind;
  statement: string;
  details: JsonObject;
  status?: KnowledgeStatus;
}): KnowledgeRecord {
  return {
    id: options.id,
    kind: options.kind,
    status: options.status ?? "active",
    statement: options.statement,
    details: options.details,
    scope: {
      space: "engram-coach-presentation-test",
      subjects: ["athlete-1"],
      topics: ["coaching:profile"],
      contexts: [],
      dimensions: {},
    },
    pack: { id: "engram-coach", version: "0.1.0" },
    sources: [{ type: "engram-coach", ref: options.id }],
    session: { id: "session-1", host: "test-host" },
    submittedAt: "2026-08-14T00:00:00.000Z",
    disposition: "new",
    schemaVersion: 0,
    relationships: { supports: [], contradicts: [], refines: [], supersedes: [] },
    history: [],
  };
}

const monitoring = makeRecord({
  id: "rec-monitoring-1",
  kind: "evidence",
  statement: "HRV trend flagged for review this week.",
  details: {
    entityType: "monitoring-capture",
    decisionKind: "monitoring-capture",
    turnIndex: 0,
    extractionConfidence: "low",
  },
});

const lactateTest = makeRecord({
  id: "rec-lactate-1",
  kind: "decision",
  statement: "LT2 measured at 255W, FTP set to 268W.",
  details: {
    entityType: "lactate-test",
    decisionKind: "threshold-update",
    turnIndex: 1,
    extractionConfidence: "high",
  },
});

const arcPlan = makeRecord({
  id: "rec-arc-1",
  kind: "decision",
  statement: "12-week build arc targeting the fall marathon.",
  details: {
    entityType: "arc-plan",
    decisionKind: "arc-planning",
    turnIndex: 2,
    extractionConfidence: "high",
  },
});

const healthAdaptation = makeRecord({
  id: "rec-adapt-1",
  kind: "decision",
  statement: "Cut Thursday's threshold session short after low HRV.",
  details: {
    entityType: "workout-adaptation",
    decisionKind: "workout-adaptation",
    trainingSignals: ["hrv"],
    turnIndex: 3,
    extractionConfidence: "high",
  },
});

const recommendation = makeRecord({
  id: "rec-recommend-1",
  kind: "recommendation",
  statement: "Add an extra recovery day before the next key session.",
  details: {
    entityType: "workout-adaptation",
    decisionKind: "workout-adaptation",
    turnIndex: 4,
    extractionConfidence: "high",
  },
});

const broadRecords = [monitoring, lactateTest, arcPlan, healthAdaptation, recommendation];

function audience(id: string) {
  const definition = engramCoachPresentation.audiences.find((candidate) => candidate.id === id);
  if (definition === undefined) throw new Error(`missing audience: ${id}`);
  return definition;
}

function view(id: string) {
  const definition = engramCoachPresentation.views.find((candidate) => candidate.id === id);
  if (definition === undefined) throw new Error(`missing view: ${id}`);
  return definition;
}

// ---------------------------------------------------------------------------
// Audience authorization
// ---------------------------------------------------------------------------

describe("engram-coach-presentation audiences", () => {
  it("authorizes athlete, coach, and self-coach for every eligible record", () => {
    expect(audience("athlete").authorize(arcPlan)).toBe(true);
    expect(audience("coach").authorize(arcPlan)).toBe(true);
    expect(audience("self-coach").authorize(lactateTest)).toBe(true);
  });

  it("scopes clinician authorization to health-relevant records", () => {
    expect(audience("clinician").authorize(arcPlan)).toBe(false);
    expect(audience("clinician").authorize(monitoring)).toBe(true);
    expect(audience("clinician").authorize(healthAdaptation)).toBe(true);
  });

  it("does not authorize inactive records for any audience", () => {
    const retired = makeRecord({
      id: "rec-retired-1",
      kind: "decision",
      statement: "Retired threshold update.",
      details: { entityType: "lactate-test", decisionKind: "threshold-update", turnIndex: 5, extractionConfidence: "high" },
      status: "retired",
    });
    expect(audience("athlete").authorize(retired)).toBe(false);
    expect(audience("clinician").authorize(retired)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// `athlete-profile` view projection
// ---------------------------------------------------------------------------

describe("engram-coach-presentation athlete-profile view", () => {
  it("projects facts, uncertainty, actions, and recommendation IDs directly from the source records", () => {
    const projection = view("athlete-profile").project(broadRecords);
    const expectedFacts = [...new Set(broadRecords.map((record) => record.statement))].sort((left, right) =>
      left.localeCompare(right),
    );

    expect(projection.facts).toEqual(expectedFacts);
    expect(projection.requiredFacts).toEqual(expectedFacts);
    expect(projection.uncertainty).toEqual([monitoring.statement]);
    expect(projection.actions).toEqual([recommendation.statement]);
    expect(projection.recommendationIds).toEqual([recommendation.id]);
  });

  it("adapts the broad-audience projection for athlete, coach, and self-coach without introducing new actions", () => {
    const projection = view("athlete-profile").project(broadRecords);

    for (const audienceId of ["athlete", "coach", "self-coach"]) {
      const draft = audience(audienceId).adapt({
        projection,
        delivery: engramCoachPresentation.deliveries[0],
        records: broadRecords,
      });

      expect(draft.facts).toEqual(projection.facts);
      for (const fact of projection.facts) {
        expect(draft.facts).toContain(fact);
      }
      expect(draft.actions).toEqual(projection.actions);
      expect(draft.recommendationIds).toEqual(projection.recommendationIds);
    }
  });

  it("excludes records the clinician audience does not authorize from its projection", () => {
    const clinicianRecords = broadRecords.filter((record) => audience("clinician").authorize(record));
    const projection = view("athlete-profile").project(clinicianRecords);

    expect(projection.facts).not.toContain(arcPlan.statement);
    expect(projection.facts).toContain(monitoring.statement);
    expect(projection.facts).toContain(healthAdaptation.statement);
  });
});

// ---------------------------------------------------------------------------
// Pack composition
// ---------------------------------------------------------------------------

describe("engram-coach-pack presentation composition", () => {
  it("composes the presentation facets into the full pack surface", () => {
    expect(engramCoachPack.retrievalPolicy).toBe(engramCoachPresentation.retrievalPolicy);
    expect(engramCoachPack.views).toBe(engramCoachPresentation.views);
    expect(engramCoachPack.audiences).toBe(engramCoachPresentation.audiences);
    expect(engramCoachPack.deliveries).toBe(engramCoachPresentation.deliveries);
  });
});
