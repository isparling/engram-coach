/**
 * Shared synthetic record corpus for materialization golden tests and the
 * fixture-generation script. Kept out of the test module so plain Bun/tsx
 * scripts can import it without pulling in vitest.
 */

import type {
  JsonObject,
  JsonValue,
  KnowledgeRecord,
} from "@isparling/engram-harness/knowledge-types";
import type { EngramCoachRuntimeConfig } from "../engram-coach-config.ts";

export const TEST_CONFIG: EngramCoachRuntimeConfig = {
  activeProfile: "test",
  coachingDocsDir: "coaching-docs",
  prescriptionsDir: "prescriptions",
  capture: { model: "synthetic/capture-model", timeoutSeconds: 60, maxCandidatesPerTurn: 3 },
};

export const APPLIED_AT = "2026-08-22T12:00:00Z";

let recordCounter = 0;

function makeRecord(input: {
  role: string;
  entityType: string;
  effectiveAt: string;
  sourceId: string;
  status?: KnowledgeRecord["status"];
  artifactKind: string;
  relativePath: string;
  value: JsonObject;
}): KnowledgeRecord {
  recordCounter += 1;
  const id = `rec-${recordCounter.toString().padStart(3, "0")}`;
  const effectiveAt = input.effectiveAt;
  return {
    id,
    schemaVersion: 0,
    kind: "decision",
    status: input.status ?? "active",
    statement: `${input.role} ${input.entityType}`,
    details: {
      recordRole: input.role,
      entityType: input.entityType,
      entityKey: null,
      effectiveAt,
      sourceId: input.sourceId,
      value: input.value,
      artifact: { kind: input.artifactKind, relativePath: input.relativePath },
      captureChannel: "explicit",
    },
    scope: { space: "test-space", subjects: [], topics: [], contexts: [], dimensions: {} },
    pack: { id: "engram-coach", version: "0.1.0" },
    sources: [{ type: "skill", ref: input.sourceId }],
    session: { id: "sess-test", host: "test" },
    submittedAt: effectiveAt,
    disposition: "new",
    relationships: { supports: [], contradicts: [], refines: [], supersedes: [] },
    history: [],
  };
}

export const BUILD_GOAL: JsonValue = { event: "Example Endurance Event", date: "2027-06-15" };

export function buildRecords(): KnowledgeRecord[] {
  return [
    // --- prescription: blocks/build_1.yaml (two sessions + goal) ---
    makeRecord({
      role: "state",
      entityType: "prescription",
      effectiveAt: "2026-08-18T00:00:00Z",
      sourceId: "s-set-goal:1:explicit:0",
      artifactKind: "prescription",
      relativePath: "blocks/build_1.yaml",
      value: {
        blockName: "build_1",
        goal: BUILD_GOAL,
        order: 1,
        sessionId: "workout-7f8c",
        week: 3,
        day: "Thu",
        sessionDate: "2026-08-27",
        sessionName: "W3_SubLT2",
        totalDurationMin: 120,
        warmup: { powerLowPct: 40, powerHighPct: 65 },
        cooldown: { powerLowPct: 35, powerHighPct: 45 },
        intervals: [
          {
            durationMin: 10,
            powerLowPct: 85,
            powerHighPct: 92,
            count: 3,
            recoveryMin: 5,
            recoveryPowerLowPct: 45,
            recoveryPowerHighPct: 55,
          },
        ],
      },
    }),
    makeRecord({
      role: "state",
      entityType: "prescription",
      effectiveAt: "2026-08-18T00:00:00Z",
      sourceId: "s-set-goal:1:explicit:1",
      artifactKind: "prescription",
      relativePath: "blocks/build_1.yaml",
      value: {
        blockName: "build_1",
        goal: BUILD_GOAL,
        order: 2,
        sessionId: "workout-a91d",
        week: 3,
        day: "Sat",
        sessionDate: "2026-08-29",
        sessionName: "W3_LongRide",
        modality: "run",
        totalDurationMin: 240,
        effortZone: "Z1-Z2",
      },
    }),
    // Retired prior state for workout-7f8c — must be excluded.
    makeRecord({
      role: "state",
      entityType: "prescription",
      effectiveAt: "2026-08-01T00:00:00Z",
      sourceId: "s-old:1:explicit:0",
      status: "retired",
      artifactKind: "prescription",
      relativePath: "blocks/build_1.yaml",
      value: {
        blockName: "build_1",
        order: 9,
        sessionId: "workout-7f8c-old",
        week: 3,
        day: "Fri",
        sessionDate: "2026-08-28",
        sessionName: "W3_Old",
        totalDurationMin: 60,
      },
    }),
    // Not yet effective at APPLIED_AT — excluded from the current view.
    makeRecord({
      role: "state",
      entityType: "prescription",
      effectiveAt: "2026-09-15T00:00:00Z",
      sourceId: "s-future:1:explicit:0",
      artifactKind: "prescription",
      relativePath: "blocks/build_1.yaml",
      value: {
        blockName: "build_1",
        goal: BUILD_GOAL,
        order: 3,
        sessionId: "workout-b200",
        week: 4,
        day: "Tue",
        sessionDate: "2026-09-15",
        sessionName: "W4_Intervals",
        totalDurationMin: 135,
      },
    }),
    // --- prescription: second path proves grouping ---
    makeRecord({
      role: "state",
      entityType: "prescription",
      effectiveAt: "2026-07-01T00:00:00Z",
      sourceId: "s-base:1:explicit:0",
      artifactKind: "prescription",
      relativePath: "blocks/base.yaml",
      value: {
        blockName: "base",
        order: 1,
        sessionId: "workout-base-1",
        week: 1,
        day: "Wed",
        sessionDate: "2026-07-08",
        sessionName: "W1_Easy",
        totalDurationMin: 90,
        effortZone: "Z1-Z2",
      },
    }),
    // --- consultation events (chronological ordering incl. legacy body) ---
    makeRecord({
      role: "event",
      entityType: "consultation",
      effectiveAt: "2026-07-21T09:00:00Z",
      sourceId: "s-consult:1:explicit:0",
      artifactKind: "consultation",
      relativePath: "consultations.md",
      value: {
        legacyMarkdown:
          "## 2026-07-21 — imported entry\n\nImported legacy consultation body that must survive verbatim.\n",
      },
    }),
    makeRecord({
      role: "event",
      entityType: "consultation",
      effectiveAt: "2026-08-02T09:00:00Z",
      sourceId: "s-consult:2:explicit:0",
      artifactKind: "consultation",
      relativePath: "consultations.md",
      value: { summary: "Fatigue flagged after race; scheduled down week." },
    }),
    makeRecord({
      role: "event",
      entityType: "consultation",
      effectiveAt: "2026-08-02T09:00:00Z",
      sourceId: "s-consult:2:explicit:1",
      artifactKind: "consultation",
      relativePath: "consultations.md",
      value: {
        title: "Sleep disruption follow-up",
        summary: "Kept volume flat; revisit HRV trend next week.",
      },
    }),
    // --- adaptation events ---
    makeRecord({
      role: "event",
      entityType: "workout-adaptation",
      effectiveAt: "2026-08-19T17:30:00Z",
      sourceId: "s-adapt:1:explicit:0",
      artifactKind: "adaptation",
      relativePath: "adaptation.md",
      value: {
        legacyMarkdown: "Adapted W2_Intervals: power band widened after RPE 9 report.\n",
      },
    }),
    makeRecord({
      role: "event",
      entityType: "workout-adaptation",
      effectiveAt: "2026-08-21T17:30:00Z",
      sourceId: "s-adapt:2:explicit:0",
      artifactKind: "adaptation",
      relativePath: "adaptation.md",
      value: {
        title: "W3_SubLT2 swap",
        summary: "Moved Thursday session to Friday; athlete traveling.",
      },
    }),
    // --- monitoring state + events ---
    makeRecord({
      role: "state",
      entityType: "monitoring-capture",
      effectiveAt: "2026-08-20T08:00:00Z",
      sourceId: "s-monitor-state:1:explicit:0",
      artifactKind: "monitoring",
      relativePath: "monitoring.md",
      value: {
        concernId: "sleep-quality",
        signal: "hrv",
        status: "watch",
        note: "Below baseline for 4 days.",
      },
    }),
    makeRecord({
      role: "event",
      entityType: "monitoring-capture",
      effectiveAt: "2026-08-10T08:00:00Z",
      sourceId: "s-monitor-event:0:explicit:0",
      artifactKind: "monitoring",
      relativePath: "monitoring.md",
      value: {
        concernId: "sleep-quality",
        signal: "hrv",
        legacyMarkdown: "- 2026-08-10 hrv dipped 12% below baseline\n",
      },
    }),
    makeRecord({
      role: "event",
      entityType: "monitoring-capture",
      effectiveAt: "2026-08-15T08:00:00Z",
      sourceId: "s-monitor-event:1:explicit:0",
      artifactKind: "monitoring",
      relativePath: "monitoring.md",
      value: { concernId: "sleep-quality", signal: "hrv", status: "normal", note: "Back to baseline." },
    }),
    makeRecord({
      role: "event",
      entityType: "monitoring-capture",
      effectiveAt: "2026-08-16T08:00:00Z",
      sourceId: "s-monitor-event:2:explicit:0",
      artifactKind: "monitoring",
      relativePath: "monitoring.md",
      value: {
        concernId: "left-calf",
        signal: "soreness",
        status: "treat",
        note: "Calf tightness post long run.",
      },
    }),
    // --- doctor-prep summary declaration ---
    makeRecord({
      role: "state",
      entityType: "monitoring-capture",
      effectiveAt: "2026-08-20T08:00:00Z",
      sourceId: "s-doctor-prep:1:explicit:0",
      artifactKind: "doctor-prep",
      relativePath: "doctor-prep.md",
      value: {},
    }),
  ];
}


export { makeRecord };
