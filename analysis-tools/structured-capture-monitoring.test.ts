/**
 * Task 12 scenario tests: monitoring logs and doctor-prep summaries behind
 * structured capture.
 *
 * Every scenario drives the REAL preview → exact-hash approval → apply →
 * materialize pipeline against a synthetic active space and the real
 * engram-coach pack. Plan hashes and record IDs are never mocked.
 *
 * Covered contracts:
 * - new monitoring signal state (`monitoring:<concern-id>:<signal>`);
 * - newer state supersedes the prior active record;
 * - observation events append without replacement;
 * - ONE preview and ONE approval cover a consult plus its due monitoring
 *   contributions merged into a single change set;
 * - no active/due concern merges EMPTY arrays without a second preview;
 * - deterministic (byte-stable under reordered input) monitoring log and
 *   doctor-prep summary rendering;
 * - same-hash materialization retry is idempotent;
 * - legacy monitoring history imports idempotently through the real path.
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ArtifactReplacementResult, CaptureMutationView } from "@isparling/engram-harness/capture-types";
import type { JsonObject, KnowledgeEnvelope, KnowledgeRecord } from "@isparling/engram-harness/knowledge-types";
import { afterAll, describe, expect, it } from "vitest";
import {
  applyKnowledgeProposal,
  reconcileKnowledgeTransaction,
} from "../../engram/harness/src/knowledgeTransaction.ts";
import { parseKnowledgeRecord } from "../../engram/harness/src/knowledgeRecord.ts";
import { makeAlwaysSucceedsSpawnFn } from "../../engram/harness/test/fakes.ts";
import { engramCoachPack } from "../engram-coach-pack.ts";
import { previewStructuredCapture } from "../engram-coach-structured-capture.ts";
import type {
  AppliedCapturePlan,
  ReadyCapturePreview,
} from "../engram-coach-capture-types.ts";
import {
  materialize,
  renderDoctorPrepSummary,
  renderMonitoringLog,
  selectMaterializableRecords,
  type MaterializeTools,
} from "../engram-coach-materialization.ts";
import { migrationActiveRecords, planLegacyImport } from "../engram-coach-migration.ts";
import { makeRecord } from "./materialization-test-support.ts";
import type { SyntheticCaptureSpace } from "./structured-capture-test-support.ts";
import {
  createSyntheticCaptureSpace,
  makeActiveStateRecord,
  testPreviewTools,
  writeRecord,
} from "./structured-capture-test-support.ts";

const APPLIED_AT = "2026-08-26T12:00:00Z";

async function loadMonitoringChangeSet(): Promise<JsonObject> {
  const text = await readFile(
    join(import.meta.dirname, "fixtures", "structured-capture", "scenarios", "monitoring-change-set.json"),
    "utf8",
  );
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("monitoring-change-set.json must contain a JSON object");
  }
  return parsed as JsonObject;
}

/** Real-disk host mechanics for materialization inside the synthetic space. */
function diskMaterializeTools(space: SyntheticCaptureSpace): MaterializeTools {
  return {
    projectRoot: space.root,
    appliedAt: APPLIED_AT,
    listRecords: async (): Promise<KnowledgeRecord[]> => {
      const files = await readdir(space.recordsRoot);
      const records: KnowledgeRecord[] = [];
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        const parsed = parseKnowledgeRecord(await readFile(join(space.recordsRoot, file), "utf8"));
        if (!parsed.ok) throw new Error(`unparseable committed record ${file}`);
        records.push(parsed.value);
      }
      return records;
    },
    replaceArtifact: async (request): Promise<ArtifactReplacementResult> => {
      const target = join(request.root, request.relativePath);
      let previous: string | null = null;
      try {
        previous = await readFile(target, "utf8");
      } catch {
        previous = null;
      }
      if (previous === request.content) {
        return { status: "unchanged", path: request.relativePath };
      }
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, request.content, "utf8");
      return { status: "replaced", path: request.relativePath };
    },
  };
}

/** Recompute the proposal through the REAL transaction so it can be applied. */
async function recomputeProposal(space: SyntheticCaptureSpace, candidate: KnowledgeEnvelope) {
  const { submittedAt, ...rest } = candidate;
  const outcome = await reconcileKnowledgeTransaction({
    binding: space.active,
    candidateInput: { ...rest, submitted_at: submittedAt },
    pack: engramCoachPack,
  });
  if (outcome.status !== "proposal") {
    throw new Error(`reconcile did not propose: ${outcome.status}`);
  }
  return outcome.proposal;
}

/** Prior ACTIVE monitoring state for one concern/signal key. */
function priorHrvState(): KnowledgeRecord {
  return makeActiveStateRecord({
    id: "monitoring-hrv-old",
    statement: "Current sleep-quality hrv status: normal",
    submittedAt: "2026-07-16",
    details: {
      recordRole: "state",
      entityType: "monitoring",
      entityKey: "monitoring:sleep-quality:hrv",
      effectiveAt: "2026-07-16",
      sourceId: "migration-legacy:0:state:0",
      value: {
        concernId: "sleep-quality",
        signal: "hrv",
        status: "normal",
        note: "Back to baseline after the down week.",
      },
      artifact: { kind: "monitoring", relativePath: "monitoring/sleep-quality.md" },
      captureChannel: "explicit",
    },
    sources: [{ type: "engram-coach-capture", ref: "migration-legacy:0:state:0" }],
  });
}

const spaces: SyntheticCaptureSpace[] = [];
afterAll(async () => {
  await Promise.all(spaces.splice(0).map((space) => space.destroy()));
});

describe("monitoring capture scenarios", () => {
  it("covers prescription, consultation, AND due monitoring with exactly ONE preview and ONE approval", async () => {
    const space = await createSyntheticCaptureSpace();
    spaces.push(space);

    // Seed: prior ACTIVE monitoring state for the due signal.
    const prior = priorHrvState();
    await writeRecord(space, prior);

    // Phase 4: ONE preview of the MERGED change set (parent consult items +
    // monitoring-rollup contribution mode output).
    const tools = testPreviewTools(space);
    const preview = await previewStructuredCapture(await loadMonitoringChangeSet(), tools);
    expect(preview.status).toBe("ready");
    if (preview.status !== "ready") return;
    const ready: ReadyCapturePreview = preview;

    // Exactly one preview was produced for everything.
    expect(tools.previews).toHaveLength(1);

    // Plan shape: prescription supersession, monitoring supersession (newer
    // signal state retires the prior active record), then two appends.
    expect(ready.changes).toEqual([
      expect.objectContaining({
        entityKey: "prescription:arc-a:workout-7f8c",
        recordRole: "state",
        classification: "new",
      }),
      expect.objectContaining({
        entityKey: "monitoring:sleep-quality:hrv",
        recordRole: "state",
        classification: "supersede",
        retires: [prior.id],
      }),
      expect.objectContaining({ recordRole: "event", classification: "append" }),
      expect.objectContaining({ recordRole: "event", classification: "append" }),
    ]);

    // ONE approval: apply carries ONLY the exact previewed hash.
    const candidate = tools.previews[0];
    if (candidate === undefined) throw new Error("preview produced no candidate envelope");
    const proposal = await recomputeProposal(space, candidate);
    const applied = await applyKnowledgeProposal({
      binding: space.active,
      proposal,
      decision: "approve",
      expectedPlanHash: ready.planHash,
      pack: engramCoachPack,
      spawnFn: makeAlwaysSucceedsSpawnFn("Indexed: 4 new, 0 updated, 0 unchanged, 0 removed").spawnFn,
    });
    expect(applied.status).toBe("committed");
    if (applied.status !== "committed") return;
    expect(applied.plan_hash).toBe(ready.planHash);

    // Newer monitoring state supersedes the prior record; events append.
    const retired = applied.mutations.find(
      (mutation) => mutation.action === "update" && mutation.recordId === prior.id,
    );
    expect(retired?.after.status).toBe("retired");
    const newState = applied.mutations.find(
      (mutation) =>
        mutation.action === "create" &&
        mutation.after.details["entityKey"] === "monitoring:sleep-quality:hrv",
    );
    expect(newState?.after.relationships.supersedes).toEqual([prior.id]);
    const monitoringEvents = applied.mutations.filter(
      (mutation) =>
        mutation.action === "create" && mutation.after.details["entityType"] === "monitoring-event",
    );
    expect(monitoringEvents).toHaveLength(1);
    expect(monitoringEvents[0]?.after.relationships.supersedes).toEqual([]);

    // Materialize regenerates every compatibility view from committed records.
    const config = {
      activeProfile: "test",
      coachingDocsDir: space.root,
      prescriptionsDir: join(space.root, "prescriptions"),
      capture: { model: "synthetic/capture-model", timeoutSeconds: 60, maxCandidatesPerTurn: 3 },
    };
    const appliedPlan: AppliedCapturePlan = {
      planHash: applied.plan_hash,
      mutations: applied.mutations.map(
        (mutation): CaptureMutationView => ({
          recordId: mutation.recordId,
          action: mutation.action,
          beforeHash: mutation.beforeHash,
          after: mutation.after,
        }),
      ),
    };
    const matz = await materialize(appliedPlan, diskMaterializeTools(space), { config });
    expect(matz.stale).toEqual([]);
    const writtenPaths = matz.written.map((entry) => entry.path);
    expect(writtenPaths).toContain("arc-a.yaml");
    expect(writtenPaths).toContain("coaching/consultations.md");
    expect(writtenPaths).toContain("monitoring/sleep-quality.md");
    expect(writtenPaths).toContain("monitoring/events.md");

    const monitoringLog = await readFile(join(config.coachingDocsDir, "monitoring", "sleep-quality.md"), "utf8");
    expect(monitoringLog.startsWith("<!-- GENERATED FROM ENGRAM ACTIVE RECORDS. DO NOT EDIT DIRECTLY. -->\n")).toBe(true);
    expect(monitoringLog).toContain("## sleep-quality / hrv");
    expect(monitoringLog).toContain("watch");

    // Same-hash retry: re-running ONLY materialization with the SAME applied
    // plan is idempotent and never previews or mutates records again.
    const retry = await materialize(appliedPlan, diskMaterializeTools(space), { config });
    expect(retry.stale).toEqual([]);
    expect(retry.written).toEqual([]);
    expect(retry.unchanged.map((entry) => entry.path).sort()).toEqual([
      "arc-a.yaml",
      "coaching/consultations.md",
      "monitoring/events.md",
      "monitoring/sleep-quality.md",
    ]);
    expect(tools.previews).toHaveLength(1);
  });

  it("merges EMPTY monitoring contributions without producing a second preview or extra plan rows", async () => {
    const space = await createSyntheticCaptureSpace();
    spaces.push(space);

    // No concern active/due: contribution collection returns empty arrays.
    const merged = await loadMonitoringChangeSet();
    const parentOnly: JsonObject = {
      ...merged,
      state_changes: ((merged["state_changes"] ?? []) as JsonObject[]).filter(
        (change) => change["entity_type"] !== "monitoring",
      ),
      events: ((merged["events"] ?? []) as JsonObject[]).filter(
        (event) => event["entity_type"] !== "monitoring-event",
      ),
    };

    const tools = testPreviewTools(space);
    const preview = await previewStructuredCapture(parentOnly, tools);
    expect(preview.status).toBe("ready");
    if (preview.status !== "ready") return;

    // ONE preview; the plan carries only the parent consult items.
    expect(tools.previews).toHaveLength(1);
    expect(preview.changes).toHaveLength(2);
    expect(preview.changes.map((change) => [change.recordRole, change.entityKey])).toEqual([
      ["state", "prescription:arc-a:workout-7f8c"],
      ["event", null],
    ]);
  });

  it("renders monitoring views byte-deterministically under reordered input", () => {
    const buildCorpus = (): KnowledgeRecord[] => [
      makeRecord({
        role: "state",
        entityType: "monitoring",
        effectiveAt: "2026-08-20T08:00:00Z",
        sourceId: "s-state-b:1:explicit:0",
        artifactKind: "monitoring",
        relativePath: "monitoring/left-calf.md",
        value: { concernId: "left-calf", signal: "soreness", status: "treat", note: "Tight post long run." },
      }),
      makeRecord({
        role: "state",
        entityType: "monitoring",
        effectiveAt: "2026-08-10T08:00:00Z",
        sourceId: "s-state-a:1:explicit:0",
        artifactKind: "monitoring",
        relativePath: "monitoring/sleep-quality.md",
        value: { concernId: "sleep-quality", signal: "hrv", status: "watch", note: "Below baseline." },
      }),
      makeRecord({
        role: "event",
        entityType: "monitoring-event",
        effectiveAt: "2026-08-02T08:00:00Z",
        sourceId: "s-ev-2:0:explicit:0",
        artifactKind: "monitoring",
        relativePath: "monitoring/events.md",
        value: { concernId: "sleep-quality", signal: "hrv", status: "watch", note: "First dip observed." },
      }),
      makeRecord({
        role: "event",
        entityType: "monitoring-event",
        effectiveAt: "2026-08-15T08:00:00Z",
        sourceId: "s-ev-1:0:explicit:0",
        artifactKind: "monitoring",
        relativePath: "monitoring/events.md",
        value: { concernId: "left-calf", signal: "soreness", status: "treat", note: "Flare during intervals." },
      }),
    ];
    const forward = buildCorpus();
    const reversed = [...buildCorpus()].reverse();

    // Renderers consume MaterializationRecords — project through the real
    // selection path first.
    const forwardView = selectMaterializableRecords(forward, APPLIED_AT);
    const reversedView = selectMaterializableRecords(reversed, APPLIED_AT);

    const forwardLog = renderMonitoringLog(forwardView);
    expect(renderMonitoringLog(reversedView)).toBe(forwardLog);
    const forwardPrep = renderDoctorPrepSummary([], forwardView);
    expect(renderDoctorPrepSummary([], reversedView)).toBe(forwardPrep);

    // Groups sort alphabetically; entries sort chronologically inside groups.
    const groupOrder = forwardLog.split("\n").filter((line) => line.startsWith("## "));
    expect(groupOrder).toEqual(["## left-calf / soreness", "## sleep-quality / hrv"]);
    const hrvSection = forwardLog.slice(forwardLog.indexOf("## sleep-quality / hrv"));
    expect(hrvSection.indexOf("- 2026-08-10")).toBeGreaterThan(hrvSection.indexOf("- 2026-08-02"));

    // Doctor-prep shows the LATEST state per concern plus full event history.
    expect(forwardPrep).toContain("Current state: watch — Below baseline.");
    expect(forwardPrep).toContain("- 2026-08-02");
    expect(forwardPrep).toContain("- 2026-08-15");
    // Sections sort alphabetically by concern/signal key.
    const prepGroups = forwardPrep.split("\n").filter((line) => line.startsWith("## "));
    expect(prepGroups).toEqual(["## left-calf / soreness", "## sleep-quality / hrv"]);
  });

  it("imports legacy monitoring history idempotently through the real preview and apply path", async () => {
    const space = await createSyntheticCaptureSpace();
    spaces.push(space);
    const legacyText = await readFile(
      join(import.meta.dirname, "fixtures", "structured-capture", "migration", "monitoring-before.md"),
      "utf8",
    );

    const monitoringInput = [
      { relativePath: "monitoring/sleep-quality.md", concernId: "sleep-quality", text: legacyText },
    ];
    // One change set per (file × concern × signal) partition: typed hrv
    // history plus the unparseable flare body under its fallback signal.
    const firstSets = planLegacyImport({ monitoring: monitoringInput });
    expect(firstSets).toHaveLength(2);
    const hrvSet = firstSets.find((set) => set.state_changes.length > 0);
    if (hrvSet === undefined) throw new Error("no hrv partition planned");
    expect(hrvSet.state_changes).toHaveLength(1);
    expect(hrvSet.state_changes[0]?.key_components).toEqual({ concern_id: "sleep-quality", signal: "hrv" });
    const allEvents = firstSets.flatMap((set) => set.events);
    expect(allEvents).toHaveLength(3);
    const flare = allEvents.find((event) => event.effective_at === "2026-06-20");
    expect(flare?.details["legacyMarkdown"]).toContain("No parseable columns in this entry.");

    // Idempotent PLANNING: identical bytes yield identical change sets.
    const rerunSets = planLegacyImport({ monitoring: monitoringInput });
    expect(JSON.stringify(rerunSets)).toBe(JSON.stringify(firstSets));

    // Real approval path: each partition previews and applies through the
    // REAL tools with its exact hash.
    const tools = testPreviewTools(space);
    const createdIds: string[] = [];
    for (const changeSet of firstSets) {
      const preview = await previewStructuredCapture(changeSet, tools);
      expect(preview.status).toBe("ready");
      if (preview.status !== "ready") return;
      const candidate = tools.previews[0];
      if (candidate === undefined) throw new Error("preview produced no candidate envelope");
      tools.previews.length = 0;
      const proposal = await recomputeProposal(space, candidate);
      const applied = await applyKnowledgeProposal({
        binding: space.active,
        proposal,
        decision: "approve",
        expectedPlanHash: preview.planHash,
        pack: engramCoachPack,
        spawnFn: makeAlwaysSucceedsSpawnFn("Indexed: 4 new, 0 updated, 0 unchanged, 0 removed").spawnFn,
      });
      expect(applied.status).toBe("committed");
      if (applied.status !== "committed") return;
      createdIds.push(
        ...applied.mutations.filter((mutation) => mutation.action === "create").map((mutation) => mutation.recordId),
      );
    }

    // Re-import after commit dedupes by construction: identical record IDs.
    const committedIds = createdIds.sort();
    expect(committedIds).toHaveLength(4);
    const rerunRecords = migrationActiveRecords(rerunSets);
    expect(rerunRecords.map((record) => record.id).sort()).toEqual(committedIds);
  });
});
