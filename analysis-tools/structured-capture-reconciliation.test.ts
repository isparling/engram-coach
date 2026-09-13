/**
 * Reconciliation matrix tests for the explicit structured capture channel.
 *
 * One focused test per design classification: new keyed state, equivalent
 * no-change, newer supersede, compatible refine, same-effective-time
 * conflict blocked, unbound state blocked, append-only event, report claim
 * support, multiple-active ambiguity, and deterministic IDs/hashes.
 *
 * Every ready preview runs the REAL Engram `reconcileKnowledgeTransaction`
 * against a synthetic active space — plan hashes and record IDs are never
 * mocked.
 */

import { afterAll, describe, expect, it } from "vitest";
import { previewStructuredCapture } from "../engram-coach-structured-capture.ts";
import type { ReadyCapturePreview, StructuredChangeSet } from "../engram-coach-capture-types.ts";
import type { SyntheticCaptureSpace } from "./structured-capture-test-support.ts";
import {
  createSyntheticCaptureSpace,
  makeActiveStateRecord,
  makeChangeSet,
  testPreviewTools,
  writeRecord,
} from "./structured-capture-test-support.ts";

type PreviewResult =
  | ReadyCapturePreview
  | { status: "blocked"; errors: Array<{ code: string; message: string }> };

const spaces: SyntheticCaptureSpace[] = [];
afterAll(async () => {
  await Promise.all(spaces.splice(0).map((space) => space.destroy()));
});

async function freshSpace(): Promise<SyntheticCaptureSpace> {
  const space = await createSyntheticCaptureSpace();
  spaces.push(space);
  return space;
}

async function previewIn(
  space: SyntheticCaptureSpace,
  changeSet: StructuredChangeSet = makeChangeSet(),
): Promise<PreviewResult> {
  const result = await previewStructuredCapture(changeSet, testPreviewTools(space));
  if (result.status === "ready") return result;
  return {
    status: "blocked",
    errors: result.errors.map((error) => ({ code: error.code, message: error.message })),
  };
}

describe("explicit structured capture reconciliation matrix", () => {
  it("classifies a new keyed state as `new` with no retires", async () => {
    const space = await freshSpace();
    const preview = await previewIn(space);
    expect(preview.status).toBe("ready");
    if (preview.status !== "ready") return;
    expect(preview.changes).toEqual([
      {
        entityKey: "prescription:arc-a:workout-7f8c",
        recordRole: "state",
        classification: "new",
        creates: [expect.stringMatching(/^coach-[0-9a-f]{24}$/)],
        retires: [],
      },
    ]);
  });

  it("retains an explicit aggregate candidate with pack-owned item details", async () => {
    const space = await freshSpace();
    const tools = testPreviewTools(space);
    const result = await previewStructuredCapture(makeChangeSet(), tools);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.candidate.details["captureChannel"]).toBe("explicit");
    expect(result.candidate.status).toBe("candidate");
    expect(result.candidate.disposition).toBe("new");
    const items = result.candidate.details["items"];
    expect(Array.isArray(items)).toBe(true);
    if (!Array.isArray(items)) return;
    expect(Object.keys(items[0] as Record<string, unknown>).sort()).toEqual([
      "actionTargets", "artifact", "effectiveAt", "entityKey", "entityType",
      "recordId", "role", "sourceDocument", "sourceId", "statement", "value",
    ]);
  });

  it("scopes a candidate to the host-selected space rather than the pack id", async () => {
    const space = await createSyntheticCaptureSpace("athlete-training");
    spaces.push(space);
    const result = await previewStructuredCapture(makeChangeSet(), testPreviewTools(space));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.candidate.scope.space).toBe("athlete-training");
  });

  it("emits no mutations for an equivalent value (no-change)", async () => {
    const space = await freshSpace();
    await writeRecord(space, makeActiveStateRecord({
      id: "prescription-current",
      statement: "Thursday changes from 4x8 at 295 W to 3x8 at 285 W",
      details: {
        recordRole: "state",
        entityType: "prescription",
        entityKey: "prescription:arc-a:workout-7f8c",
        effectiveAt: "2026-08-25",
        sourceId: "legacy:migration:state:0",
        value: { intervals: 3, reps: 8, watts: 285 },
        artifact: { kind: "prescription", relativePath: "prescriptions/arc-a.yaml" },
        captureChannel: "explicit",
      },
    }));
    const result = await previewStructuredCapture(makeChangeSet(), testPreviewTools(space));
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.changes).toEqual([]);
    expect(result.planHash).toMatch(/^[0-9a-f]+$/);
  });

  it("classifies a later effective time over a different value as `supersede` and retires the prior record", async () => {
    const space = await freshSpace();
    await writeRecord(space, makeActiveStateRecord());
    const preview = await previewIn(space);
    expect(preview.status).toBe("ready");
    if (preview.status !== "ready") return;
    expect(preview.changes).toEqual([
      {
        entityKey: "prescription:arc-a:workout-7f8c",
        recordRole: "state",
        classification: "supersede",
        creates: [expect.stringMatching(/^coach-[0-9a-f]{24}$/)],
        retires: ["prescription-old"],
      },
    ]);
  });

  it("classifies a conflict-free strict superset as `refine`", async () => {
    const space = await freshSpace();
    await writeRecord(space, makeActiveStateRecord({
      details: {
        recordRole: "state",
        entityType: "prescription",
        entityKey: "prescription:arc-a:workout-7f8c",
        effectiveAt: "2026-08-25",
        sourceId: "legacy:migration:state:0",
        value: { intervals: 3, reps: 8 },
        artifact: { kind: "prescription", relativePath: "prescriptions/arc-a.yaml" },
        captureChannel: "explicit",
      },
    }));
    const changeSet = makeChangeSet();
    changeSet.state_changes[0].details = { intervals: 3, reps: 8, watts: 285 };
    const preview = await previewIn(space, changeSet);
    expect(preview.status).toBe("ready");
    if (preview.status !== "ready") return;
    expect(preview.changes).toEqual([
      {
        entityKey: "prescription:arc-a:workout-7f8c",
        recordRole: "state",
        classification: "refine",
        creates: [expect.stringMatching(/^coach-[0-9a-f]{24}$/)],
        retires: ["prescription-old"],
      },
    ]);
  });

  it("blocks a conflicting value at the same or earlier effective time without a proposal", async () => {
    const space = await freshSpace();
    await writeRecord(space, makeActiveStateRecord({
      details: {
        recordRole: "state",
        entityType: "prescription",
        entityKey: "prescription:arc-a:workout-7f8c",
        effectiveAt: "2026-08-25",
        sourceId: "legacy:migration:state:0",
        value: { intervals: 2, reps: 6, watts: 275 },
        artifact: { kind: "prescription", relativePath: "prescriptions/arc-a.yaml" },
        captureChannel: "explicit",
      },
    }));
    const changeSet = makeChangeSet();
    changeSet.state_changes[0].effective_at = "2026-08-24";
    const preview = await previewIn(space, changeSet);
    expect(preview.status).toBe("blocked");
    if (preview.status !== "blocked") return;
    expect(preview.errors.some((error) => error.code === "state_conflict")).toBe(true);
  });

  it("blocks an unbound state key instead of guessing identity", async () => {
    const space = await freshSpace();
    const preview = await previewIn(space, makeChangeSet({
      stateChanges: [{
        entity_type: "workout",
        key_components: {},
        effective_at: "2026-08-25",
        statement: "some workout state without a durable session id",
        details: {},
      }],
    }));
    expect(preview.status).toBe("blocked");
    if (preview.status !== "blocked") return;
    expect(preview.errors.some((error) => error.code === "change_set_key_unbound")).toBe(true);
  });

  it("appends an event without retiring or updating another record", async () => {
    const space = await freshSpace();
    await writeRecord(space, makeActiveStateRecord());
    const preview = await previewIn(space, makeChangeSet({
      events: [{
        entity_type: "consultation",
        effective_at: "2026-08-22",
        statement: "Prescription reduced after approved consultation because final-interval power faded 12%",
        action_targets: ["workout-7f8c"],
        details: {},
      }],
    }));
    expect(preview.status).toBe("ready");
    if (preview.status !== "ready") return;
    expect(preview.changes).toEqual([
      expect.objectContaining({ recordRole: "state", classification: "supersede" }),
      {
        entityKey: null,
        recordRole: "event",
        classification: "append",
        creates: [expect.stringMatching(/^coach-[0-9a-f]{24}$/)],
        retires: [],
      },
    ]);
  });

  it("creates a report claim that supports the current keyed state", async () => {
    const space = await freshSpace();
    await writeRecord(space, makeActiveStateRecord());
    const preview = await previewIn(space, makeChangeSet({
      reportClaims: [{
        entity_type: "race-conclusion",
        key_components: { entity_type: "prescription", arc_id: "arc-a", session_id: "workout-7f8c" },
        effective_at: "2026-08-22",
        statement: "Final-interval power fade confirms the reduced Thursday load was correct",
        source_document: "RACE_REPORT.md",
        details: {},
      }],
    }));
    expect(preview.status).toBe("ready");
    if (preview.status !== "ready") return;
    const claim = preview.changes.find((change) => change.recordRole === "report-claim");
    expect(claim).toBeDefined();
    expect(claim?.classification).toBe("support");
    expect(claim?.retires).toEqual([]);
  });

  it("retires the prior record preserving its sources, session, scope, relationships, and history", async () => {
    const space = await freshSpace();
    const prior = makeActiveStateRecord();
    await writeRecord(space, prior);
    const tools = testPreviewTools(space);
    const result = await previewStructuredCapture(makeChangeSet(), tools);
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    const retired = tools.plannedMutations.find(
      (mutation) => mutation.action === "update" && mutation.recordId === prior.id,
    );
    expect(retired).toBeDefined();
    if (retired === undefined) return;
    const created = tools.plannedMutations.find(
      (mutation) => mutation.action === "create"
        && mutation.after.relationships.supersedes.includes(prior.id),
    );
    expect(created).toBeDefined();
    // ONLY the status transition and one history entry are added; prior
    // sources, session, scope, relationships, statement, details, kind,
    // pack, and submittedAt are preserved verbatim.
    expect(retired.after.status).toBe("retired");
    expect(retired.after.sources).toEqual(prior.sources);
    expect(retired.after.session).toEqual(prior.session);
    expect(retired.after.scope).toEqual(prior.scope);
    expect(retired.after.relationships).toEqual(prior.relationships);
    expect(retired.after.statement).toBe(prior.statement);
    expect(retired.after.details).toEqual(prior.details);
    expect(retired.after.submittedAt).toBe(prior.submittedAt);
    expect(retired.after.history).toHaveLength(prior.history.length + 1);
    expect(retired.after.history.slice(0, prior.history.length)).toEqual(prior.history);
    expect(retired.after.history[retired.after.history.length - 1]).toEqual({
      event: "retired",
      relatedId: created?.recordId,
      submittedAt: result.candidate.submittedAt,
    });
  });

  it("blocks ambiguous_state when two active records share one exact key", async () => {
    const space = await freshSpace();
    await writeRecord(space, makeActiveStateRecord({ id: "prescription-old" }));
    await writeRecord(space, makeActiveStateRecord({ id: "prescription-old-two" }));
    const preview = await previewIn(space);
    expect(preview.status).toBe("blocked");
    if (preview.status !== "blocked") return;
    expect(preview.errors.some((error) => error.code === "ambiguous_state")).toBe(true);
  });

  it("produces identical record IDs and plan hashes across identical runs", async () => {
    // The real transaction binds each plan to its space fingerprint, so
    // identical hashes require the SAME binding — two sequential previews
    // of the same change set through the REAL reconcileKnowledgeTransaction
    // against one unchanged active space must hash identically (previews
    // never mutate disk state).
    const space = await freshSpace();
    await writeRecord(space, makeActiveStateRecord());
    const left = await previewIn(space);
    const right = await previewIn(space);
    expect(left.status).toBe("ready");
    expect(right.status).toBe("ready");
    if (left.status !== "ready" || right.status !== "ready") return;
    expect(left.planHash).toBe(right.planHash);
    expect(left.candidate.id).toBe(right.candidate.id);
    expect(left.changes).toEqual(right.changes);
  });

  it("classifies a re-import differing ONLY in nested key order as no-change", async () => {
    // Record serialization may reorder object keys at ANY depth. Canonical
    // comparison must sort keys recursively, so an identical re-import whose
    // nested objects arrive in a different byte order stays `no-change`
    // instead of raising state_conflict (array order stays significant).
    const space = await freshSpace();
    await writeRecord(space, makeActiveStateRecord({
      details: {
        recordRole: "state",
        entityType: "prescription",
        entityKey: "prescription:arc-a:workout-7f8c",
        effectiveAt: "2026-08-25",
        sourceId: "legacy:migration:state:0",
        value: {
          session: { cooldown: "10 min Z2", intervals: [{ power: 285, seconds: 480 }], warmup: "10 min Z1" },
          totalMin: 75,
        },
        artifact: { kind: "prescription", relativePath: "prescriptions/arc-a.yaml" },
        captureChannel: "explicit",
      },
    }));
    const changeSet = makeChangeSet();
    changeSet.state_changes[0].details = {
      totalMin: 75,
      session: { warmup: "10 min Z1", intervals: [{ power: 285, seconds: 480 }], cooldown: "10 min Z2" },
    };
    changeSet.state_changes[0].effective_at = "2026-08-25";
    const preview = await previewIn(space, changeSet);
    expect(preview.status).toBe("ready");
    if (preview.status !== "ready") return;
    expect(preview.changes).toEqual([]);
  });

  it("still classifies a genuine nested VALUE difference as a same-time conflict", async () => {
    // The recursive canonicalization must not become comparison-blind: a
    // changed nested value at the same effective time remains blocked.
    const space = await freshSpace();
    await writeRecord(space, makeActiveStateRecord({
      details: {
        recordRole: "state",
        entityType: "prescription",
        entityKey: "prescription:arc-a:workout-7f8c",
        effectiveAt: "2026-08-25",
        sourceId: "legacy:migration:state:0",
        value: {
          session: { intervals: [{ power: 285, seconds: 480 }], warmup: "10 min Z1" },
          totalMin: 75,
        },
        artifact: { kind: "prescription", relativePath: "prescriptions/arc-a.yaml" },
        captureChannel: "explicit",
      },
    }));
    const changeSet = makeChangeSet();
    changeSet.state_changes[0].details = {
      totalMin: 75,
      session: { warmup: "15 min Z1", intervals: [{ power: 285, seconds: 480 }] },
    };
    changeSet.state_changes[0].effective_at = "2026-08-25";
    const preview = await previewIn(space, changeSet);
    expect(preview.status).toBe("blocked");
    if (preview.status !== "blocked") return;
    expect(preview.errors.some((error) => error.code === "state_conflict")).toBe(true);
  });

  it("treats a reordered intervals ARRAY as a real difference, not a no-change", async () => {
    // Array order is meaningful (intervals are a sequence): reordering the
    // sequence must never canonicalize to the existing state.
    const space = await freshSpace();
    await writeRecord(space, makeActiveStateRecord({
      details: {
        recordRole: "state",
        entityType: "prescription",
        entityKey: "prescription:arc-a:workout-7f8c",
        effectiveAt: "2026-08-25",
        sourceId: "legacy:migration:state:0",
        value: {
          session: { intervals: [{ seconds: 300 }, { seconds: 480 }] },
          totalMin: 75,
        },
        artifact: { kind: "prescription", relativePath: "prescriptions/arc-a.yaml" },
        captureChannel: "explicit",
      },
    }));
    const changeSet = makeChangeSet();
    changeSet.state_changes[0].details = {
      totalMin: 75,
      session: { intervals: [{ seconds: 480 }, { seconds: 300 }] },
    };
    changeSet.state_changes[0].effective_at = "2026-08-25";
    const preview = await previewIn(space, changeSet);
    expect(preview.status).toBe("blocked");
    if (preview.status !== "blocked") return;
    expect(preview.errors.some((error) => error.code === "state_conflict")).toBe(true);
  });
});
