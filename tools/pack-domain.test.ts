/**
 * Behavioral tests for the engram-coach domain model, extractor, and
 * reconciliation modules.
 *
 * Exercises the deterministic fallback path (no LLM helper), domain
 * validation, and semantic reconciliation against the coaching ontology.
 *
 * Uses `await import()` (dynamic) because these tests exercise module
 * loading boundaries — each test block re-imports to snapshot the
 * exported interface rather than relying on a cached module reference.
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Domain model
// ---------------------------------------------------------------------------

describe("engram-coach-domain", () => {
  it("exports all expected entity types", async () => {
    const mod = await import("../engram-coach-domain.ts");
    const types = mod.ENGRAM_COACH_ENTITY_TYPES;
    expect(types).toContain("workout-adaptation");
    expect(types).toContain("consultation");
    expect(types).toContain("block-review");
    expect(types).toContain("race-report");
    expect(types).toContain("season-review");
    expect(types).toContain("arc-plan");
    expect(types).toContain("lactate-test");
    expect(types).toContain("monitoring-capture");
    expect(types).toContain("intake-record");
    expect(types).toContain("prescription");
    expect(types).toContain("persona-fit");
    expect(types).toContain("calibration-point");
    expect(types).toContain("methodology");
    expect(types).toContain("session-execution");
    expect(types).toHaveLength(14);
  });

  it("exports the four supported generic personas", async () => {
    const mod = await import("../engram-coach-domain.ts");
    expect(mod.ENGRAM_COACH_PERSONAS).toEqual([
      "conservative",
      "aggressive",
      "polarized",
      "volume",
    ]);
  });

  it("exports all expected decision kinds", async () => {
    const mod = await import("../engram-coach-domain.ts");
    expect(mod.ENGRAM_COACH_DECISION_KINDS).toEqual([
      "workout-adaptation",
      "consultation-advice",
      "block-restructure",
      "arc-planning",
      "persona-change",
      "recovery-intervention",
      "threshold-update",
      "monitoring-capture",
      "profile-claim",
      "setup-decision",
    ]);
    expect(mod.ENGRAM_COACH_SKILLS).toEqual([
      "adapt-plan",
      "consult",
      "block-review",
      "race-analysis",
      "season-retrospective",
      "lessons-rollup",
      "monitoring-rollup",
      "lactate-analyze",
      "intake",
      "set-goal",
    ]);
  });

  it("maps every entity type to a skill", async () => {
    const mod = await import("../engram-coach-domain.ts");
    for (const entityType of mod.ENGRAM_COACH_ENTITY_TYPES) {
      expect(mod.ENTITY_TYPE_TO_SKILL[entityType]).toBeDefined();
    }
  });

  it("COACHING_TOPIC_HINTS covers all training signals", async () => {
    const mod = await import("../engram-coach-domain.ts");
    for (const signal of mod.ENGRAM_COACH_TRAINING_SIGNALS) {
      const hasHint = mod.COACHING_TOPIC_HINTS.some(
        (h: string) => signal.includes(h.replace(":", "")) || h.includes(signal),
      );
      // At minimum, every signal maps to at least one signal-relevant hint
      expect(hasHint).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Extractor — deterministic fallback
// ---------------------------------------------------------------------------

describe("engram-coach-extractor (deterministic)", () => {
  it("returns [] for empty narrative", async () => {
    const mod = await import("../engram-coach-extractor.ts");
    const turn = {
      session: { id: "test-session", host: "test" },
      turnIndex: 1,
      timestamp: new Date().toISOString(),
      narrative: "",
      toolCalls: [],
    };
    const result = await mod.engramCoachExtractor.extractCandidates(turn, {});
    expect(result).toEqual([]);
  });

  it("returns [] for non-coaching narrative", async () => {
    const mod = await import("../engram-coach-extractor.ts");
    const turn = {
      session: { id: "test-session", host: "test" },
      turnIndex: 1,
      timestamp: new Date().toISOString(),
      narrative: "Looking at photos from the weekend hike. Great views.",
      toolCalls: [],
    };
    const result = await mod.engramCoachExtractor.extractCandidates(turn, {});
    expect(result).toEqual([]);
  });

  it("ignores non-coaching content-post language", async () => {
    const mod = await import("../engram-coach-extractor.ts");
    const result = await mod.engramCoachExtractor.extractCandidates({
      session: { id: "test-session", host: "test" },
      turnIndex: 9,
      narrative: "Publish.",
      toolCalls: [],
    }, {});
    expect(result).toEqual([]);
  });

  it("detects race-report from race narrative", async () => {
    const mod = await import("../engram-coach-extractor.ts");
    const turn = {
      session: { id: "test-session", host: "test" },
      turnIndex: 2,
      timestamp: new Date().toISOString(),
      narrative:
        "The race went better than expected. Held 245W NP for 3 hours despite the headwind on lap 2.",
      toolCalls: [],
    };
    const result = await mod.engramCoachExtractor.extractCandidates(turn, {});
    expect(result).toHaveLength(1);
    const details = result[0].details as Record<string, unknown>;
    expect(details.entityType).toBe("race-report");
    expect(details.decisionKind).toBe("workout-adaptation");
    expect(details.extractionConfidence).toBe("low");
  });

  it("detects workout-adaptation from delta keywords", async () => {
    const mod = await import("../engram-coach-extractor.ts");
    const turn = {
      session: { id: "test-session", host: "test" },
      turnIndex: 3,
      timestamp: new Date().toISOString(),
      narrative:
        "I think we should modify the prescription for Thursday. Power fade was 12% on the last interval.",
      toolCalls: [],
    };
    const result = await mod.engramCoachExtractor.extractCandidates(turn, {});
    expect(result).toHaveLength(1);
    const details = result[0].details as Record<string, unknown>;
    expect(details.entityType).toBe("workout-adaptation");
    expect(details.decisionKind).toBe("workout-adaptation");
  });

  it("detects arc-plan from goal/target language", async () => {
    const mod = await import("../engram-coach-extractor.ts");
    const turn = {
      session: { id: "test-session", host: "test" },
      turnIndex: 4,
      timestamp: new Date().toISOString(),
      narrative:
        "My goal for this arc is to build toward an example endurance event. Target event is June 2027.",
    };
    const result = await mod.engramCoachExtractor.extractCandidates(turn, {});
    expect(result).toHaveLength(1);
    const details = result[0].details as Record<string, unknown>;
    expect(details.entityType).toBe("arc-plan");
  });

  it("detects lactate-test from threshold language", async () => {
    const mod = await import("../engram-coach-extractor.ts");
    const turn = {
      session: { id: "test-session", host: "test" },
      turnIndex: 5,
      timestamp: new Date().toISOString(),
      narrative:
        "Just got my lactate test results. LT2 is 245W, FTP at 258W. Up 10W from last test.",
      toolCalls: [],
    };
    const result = await mod.engramCoachExtractor.extractCandidates(turn, {});
    expect(result).toHaveLength(1);
    const details = result[0].details as Record<string, unknown>;
    expect(details.entityType).toBe("lactate-test");
    expect(details.decisionKind).toBe("threshold-update");
  });

  it("detects consultation from consult/advice language", async () => {
    const mod = await import("../engram-coach-extractor.ts");
    const turn = {
      session: { id: "test-session", host: "test" },
      turnIndex: 6,
      timestamp: new Date().toISOString(),
      narrative:
        "I need some advice. I've been fighting a cold and my HRV has dropped for 4 days straight.",
      toolCalls: [],
    };
    const result = await mod.engramCoachExtractor.extractCandidates(turn, {});
    expect(result).toHaveLength(1);
    const details = result[0].details as Record<string, unknown>;
    expect(details.entityType).toBe("consultation");
    expect(details.decisionKind).toBe("consultation-advice");
  });

  it("detects persona-fit from persona language", async () => {
    const mod = await import("../engram-coach-extractor.ts");
    const turn = {
      session: { id: "test-session", host: "test" },
      turnIndex: 7,
      timestamp: new Date().toISOString(),
      narrative:
        "I think the aggressive persona isn't working for me right now. Let's switch to conservative.",
      toolCalls: [],
    };
    const result = await mod.engramCoachExtractor.extractCandidates(turn, {});
    expect(result).toHaveLength(1);
    const details = result[0].details as Record<string, unknown>;
    expect(details.entityType).toBe("persona-fit");
    expect(details.decisionKind).toBe("persona-change");
  });

  it("enriches candidates with pack metadata", async () => {
    const mod = await import("../engram-coach-extractor.ts");
    const turn = {
      session: { id: "session-abc", host: "omp" },
      turnIndex: 8,
      timestamp: "2026-08-10T12:00:00Z",
      narrative:
        "HRV is trending down. RHR up 3bpm. Might need a recovery week.",
      toolCalls: [],
    };
    const result = await mod.engramCoachExtractor.extractCandidates(turn, {});
    const c = result[0];
    expect(c).toHaveProperty("id");
    expect(c).toHaveProperty("kind", "decision");
    expect(c).toHaveProperty("status", "candidate");
    expect((c as Record<string, unknown>).pack).toEqual({
      id: "engram-coach",
      version: "0.1.0",
    });
    expect((c as Record<string, unknown>).session).toEqual({
      id: "session-abc",
      host: "omp",
    });
    expect((c as Record<string, unknown>).sources).toEqual([
      { type: "engram-coach-extractor", ref: "session:session-abc" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("validateEnvelope", () => {
  it("accepts a valid envelope", async () => {
    const mod = await import("../engram-coach-reconciliation.ts");
    const envelope = {
      id: "test-1",
      kind: "decision",
      status: "candidate",
      statement: "Power fade observed on final interval",
      details: {
        entityType: "workout-adaptation",
        decisionKind: "workout-adaptation",
        turnIndex: 1,
      },
      scope: {
        space: "engram-coach",
        subjects: [],
        topics: ["coaching:observation"],
        contexts: [],
        dimensions: {},
      },
      pack: { id: "engram-coach", version: "0.1.0" },
      sources: [{ type: "test", ref: "test" }],
      session: { id: "s", host: "h" },
      submittedAt: new Date().toISOString(),
      disposition: "new",
    } as const;
    const result = mod.validateEnvelope(envelope as never);
    expect(result).toEqual({ ok: true, value: undefined });
  });

  it("rejects empty statement", async () => {
    const mod = await import("../engram-coach-reconciliation.ts");
    const envelope = {
      id: "test-2",
      kind: "decision",
      status: "candidate",
      statement: "",
      details: { entityType: "workout-adaptation", decisionKind: "workout-adaptation" },
      scope: { space: "c", subjects: [], topics: ["coaching:x"], contexts: [], dimensions: {} },
      pack: { id: "c", version: "1" },
      sources: [{ type: "t", ref: "t" }],
      session: { id: "s", host: "h" },
      submittedAt: new Date().toISOString(),
      disposition: "new",
    } as const;
    const result = mod.validateEnvelope(envelope as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].code).toBe("empty_statement");
    }
  });

  it("rejects unknown entity type", async () => {
    const mod = await import("../engram-coach-reconciliation.ts");
    const envelope = {
      id: "test-3",
      kind: "decision",
      status: "candidate",
      statement: "some observation",
      details: { entityType: "magic-coaching", decisionKind: "workout-adaptation" },
      scope: { space: "c", subjects: [], topics: ["coaching:x"], contexts: [], dimensions: {} },
      pack: { id: "c", version: "1" },
      sources: [{ type: "t", ref: "t" }],
      session: { id: "s", host: "h" },
      submittedAt: new Date().toISOString(),
      disposition: "new",
    } as const;
    const result = mod.validateEnvelope(envelope as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].code).toBe("unknown_entity_type");
    }
  });

  it("rejects unknown decision kind", async () => {
    const mod = await import("../engram-coach-reconciliation.ts");
    const envelope = {
      id: "test-4",
      kind: "decision",
      status: "candidate",
      statement: "some observation",
      details: {
        entityType: "workout-adaptation",
        decisionKind: "buy-more-gas-station-sushi",
      },
      scope: { space: "c", subjects: [], topics: ["coaching:x"], contexts: [], dimensions: {} },
      pack: { id: "c", version: "1" },
      sources: [{ type: "t", ref: "t" }],
      session: { id: "s", host: "h" },
      submittedAt: new Date().toISOString(),
      disposition: "new",
    } as const;
    const result = mod.validateEnvelope(envelope as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].code).toBe("unknown_decision_kind");
    }
  });

  it("rejects an unknown persona", async () => {
    const mod = await import("../engram-coach-reconciliation.ts");
    const envelope = {
      id: "test-5",
      kind: "decision",
      status: "candidate",
      statement: "some observation",
      details: {
        entityType: "persona-fit",
        decisionKind: "persona-change",
        persona: "invalid-persona",
      },
      scope: { space: "c", subjects: [], topics: ["coaching:x"], contexts: [], dimensions: {} },
      pack: { id: "c", version: "1" },
      sources: [{ type: "t", ref: "t" }],
      session: { id: "s", host: "h" },
      submittedAt: new Date().toISOString(),
      disposition: "new",
    } as const;
    const result = mod.validateEnvelope(envelope as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].code).toBe("unknown_persona");
    }
  });

  it("rejects unknown training phase", async () => {
    const mod = await import("../engram-coach-reconciliation.ts");
    const envelope = {
      id: "test-6",
      kind: "decision",
      status: "candidate",
      statement: "some observation",
      details: {
        entityType: "workout-adaptation",
        decisionKind: "workout-adaptation",
        trainingPhase: "mega-build",
      },
      scope: { space: "c", subjects: [], topics: ["coaching:x"], contexts: [], dimensions: {} },
      pack: { id: "c", version: "1" },
      sources: [{ type: "t", ref: "t" }],
      session: { id: "s", host: "h" },
      submittedAt: new Date().toISOString(),
      disposition: "new",
    } as const;
    const result = mod.validateEnvelope(envelope as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].code).toBe("unknown_training_phase");
    }
  });

  it("rejects unprefixed topic", async () => {
    const mod = await import("../engram-coach-reconciliation.ts");
    const envelope = {
      id: "test-7",
      kind: "decision",
      status: "candidate",
      statement: "some observation",
      details: { entityType: "workout-adaptation", decisionKind: "workout-adaptation" },
      scope: {
        space: "c",
        subjects: [],
        topics: ["my-unofficial-topic"],
        contexts: [],
        dimensions: {},
      },
      pack: { id: "c", version: "1" },
      sources: [{ type: "t", ref: "t" }],
      session: { id: "s", host: "h" },
      submittedAt: new Date().toISOString(),
      disposition: "new",
    } as const;
    const result = mod.validateEnvelope(envelope as never);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].code).toBe("unknown_topic_prefix");
    }
  });
});

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

function makeEnvelope(overrides: Record<string, unknown>) {
  return {
    id: "cand-1",
    kind: "decision" as const,
    status: "candidate" as const,
    statement: "test observation",
    details: {} as Record<string, unknown>,
    scope: { space: "c", subjects: [], topics: ["coaching:x"], contexts: [], dimensions: {} },
    pack: { id: "c", version: "1" },
    sources: [{ type: "t", ref: "t" }],
    session: { id: "s", host: "h" },
    submittedAt: new Date().toISOString(),
    disposition: "new" as const,
    ...overrides,
  };
}

function makeRecord(overrides: Record<string, unknown>) {
  return {
    ...makeEnvelope(overrides),
    schemaVersion: 0 as const,
    relationships: { supports: [], contradicts: [], refines: [], supersedes: [] },
    history: [],
  };
}

describe("reconcile", () => {
  it("accepts new candidate with no related records (disposition: new)", async () => {
    const mod = await import("../engram-coach-reconciliation.ts");
    const candidate = makeEnvelope({});
    const result = mod.reconcile({ candidate: candidate as never, related: [] });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.disposition).toBe("new");
    }
  });

  it("dedupes identical statement (disposition: no-change)", async () => {
    const mod = await import("../engram-coach-reconciliation.ts");
    const candidate = makeEnvelope({
      id: "cand-2",
      statement: "identical observation",
    });
    const related = [
      makeRecord({ id: "rec-1", statement: "identical observation" }),
    ];
    const result = mod.reconcile({ candidate: candidate as never, related: related as never });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.disposition).toBe("no-change");
    }
  });

  it("supersedes prior lactate test result", async () => {
    const mod = await import("../engram-coach-reconciliation.ts");
    const candidate = makeEnvelope({
      id: "cand-lt-new",
      statement: "LT2 now 255W, FTP 268W",
      details: { entityType: "lactate-test", decisionKind: "threshold-update" },
    });
    const related = [
      makeRecord({
        id: "rec-lt-old",
        statement: "LT2 at 245W, FTP 258W",
        details: { entityType: "lactate-test", decisionKind: "threshold-update" },
      }),
    ];
    const result = mod.reconcile({ candidate: candidate as never, related: related as never });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.disposition).toBe("supersede");
      expect(result.value.mutations).toHaveLength(1);
      const mutation = result.value.mutations[0];
      expect(mutation.action).toBe("update");
      expect(mutation.record.status).toBe("retired");
      expect(
        (mutation.record.details as Record<string, unknown>).supersededBy,
      ).toBe("cand-lt-new");
    }
  });

  it("supersedes prior persona-fit record", async () => {
    const mod = await import("../engram-coach-reconciliation.ts");
    const candidate = makeEnvelope({
      id: "cand-p-new",
      statement: "Switching to aggressive persona for build phase",
      details: { entityType: "persona-fit", decisionKind: "persona-change" },
    });
    const related = [
      makeRecord({
        id: "rec-p-old",
        statement: "Conservative persona selected during intake",
        details: { entityType: "persona-fit", decisionKind: "setup-decision" },
      }),
    ];
    const result = mod.reconcile({ candidate: candidate as never, related: related as never });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.disposition).toBe("supersede");
      expect(result.value.mutations).toHaveLength(1);
      expect(result.value.mutations[0].record.status).toBe("retired");
    }
  });

  it("refines same entity type with different statement", async () => {
    const mod = await import("../engram-coach-reconciliation.ts");
    const candidate = makeEnvelope({
      id: "cand-3",
      statement: "Another adaptation note for this block",
      details: { entityType: "workout-adaptation", decisionKind: "workout-adaptation" },
    });
    const related = [
      makeRecord({
        id: "rec-2",
        statement: "Initial adaptation record for this block",
        details: { entityType: "workout-adaptation", decisionKind: "workout-adaptation" },
      }),
    ];
    const result = mod.reconcile({ candidate: candidate as never, related: related as never });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.disposition).toBe("refine");
      expect(result.value.summary).toContain("workout-adaptation");
    }
  });

  it("supports complementary entity types from same skill", async () => {
    const mod = await import("../engram-coach-reconciliation.ts");
    const candidate = makeEnvelope({
      id: "cand-4",
      statement: "Session execution note for arc-plan cycle",
      details: { entityType: "session-execution", decisionKind: "workout-adaptation" },
    });
    const related = [
      makeRecord({
        id: "rec-4",
        statement: "Workout adaptation in same cycle",
        details: { entityType: "workout-adaptation", decisionKind: "workout-adaptation" },
      }),
    ];
    const result = mod.reconcile({ candidate: candidate as never, related: related as never });
    // session-execution and workout-adaptation both come from adapt-plan skill
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.disposition).toBe("support");
    }
  });
});

// ---------------------------------------------------------------------------
// relatedQuery
// ---------------------------------------------------------------------------

describe("relatedQuery", () => {
  it("builds query from entity type and persona", async () => {
    const mod = await import("../engram-coach-reconciliation.ts");
    const envelope = makeEnvelope({
      details: {
        entityType: "lactate-test",
        persona: "volume",
        trainingPhase: "build-1",
      },
    });
    const query = mod.relatedQuery(envelope as never);
    expect(query).toContain("lactate-test");
    expect(query).toContain("persona:volume");
    expect(query).toContain("phase:build-1");
  });

  it("falls back to statement when no details fields", async () => {
    const mod = await import("../engram-coach-reconciliation.ts");
    const envelope = makeEnvelope({
      details: {},
      statement: "power fade during threshold intervals",
    });
    const query = mod.relatedQuery(envelope as never);
    expect(query).toContain("power fade");
  });

  it("includes training signals in query", async () => {
    const mod = await import("../engram-coach-reconciliation.ts");
    const envelope = makeEnvelope({
      details: {
        entityType: "workout-adaptation",
        trainingSignals: ["hrv", "tsb", "decoupling"],
      },
    });
    const query = mod.relatedQuery(envelope as never);
    expect(query).toContain("hrv");
    expect(query).toContain("tsb");
    expect(query).toContain("decoupling");
  });
});

// ---------------------------------------------------------------------------
// Pack identity
// ---------------------------------------------------------------------------

describe("engram-coach-pack", () => {
  it("exports the published Engram Coach pack identity", async () => {
    const mod = await import("../engram-coach-pack.ts");
    expect(mod.engramCoachPack.id).toBe("engram-coach");
    expect(mod.default).toBe(mod.engramCoachPack);
  });
});