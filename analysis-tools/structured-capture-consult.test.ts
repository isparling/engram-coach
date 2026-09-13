/**
 * Complete consult cutover scenario.
 *
 * Drives the REAL path end-to-end against a synthetic active space: seed an
 * active prescription record and its source YAML, preview a synthetic consult
 * change set through the real pack + guarded transaction, approve the REAL
 * plan hash (never mocked), then assert every design guarantee:
 *
 *   - prior prescription state retired; new state and consultation event active;
 *   - the supersedes edge points new -> old ONLY (never old -> new);
 *   - the guarded qmd refresh was attempted exactly once;
 *     committed records with generated headers;
 *   - a same-turn ambient response carrying the applied entity key produces
 *     NO duplicate ambient candidate.
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { JsonObject, KnowledgeEnvelope, KnowledgeRecord } from "@isparling/engram-harness/knowledge-types";
import { afterAll, describe, expect, it } from "vitest";
import type {
  ArtifactReplacementResult,
  CaptureMutationView,
} from "@isparling/engram-harness/capture-types";
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
import { materialize, type MaterializeTools } from "../engram-coach-materialization.ts";
import { appliedEntityKeys } from "../capture-handler.ts";
import type { SyntheticCaptureSpace } from "./structured-capture-test-support.ts";
import {
  createSyntheticCaptureSpace,
  makeActiveStateRecord,
  testPreviewTools,
  writeRecord,
} from "./structured-capture-test-support.ts";

const APPLIED_AT = "2026-08-26T12:00:00Z";

async function loadConsultChangeSet(): Promise<JsonObject> {
  const text = await readFile(
    join(import.meta.dirname, "fixtures", "structured-capture", "scenarios", "consult-change-set.json"),
    "utf8",
  );
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("consult-change-set.json must contain a JSON object");
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

const spaces: SyntheticCaptureSpace[] = [];
afterAll(async () => {
  await Promise.all(spaces.splice(0).map((space) => space.destroy()));
});

describe("consult approved capture scenario", () => {
  it("previews, applies the exact plan hash, retires prior state, refreshes once, regenerates views, and suppresses the duplicate ambient candidate", async () => {
    const space = await createSyntheticCaptureSpace();
    spaces.push(space);

    // Seed: one ACTIVE prescription state record plus its source YAML view.
    const prior = makeActiveStateRecord();
    await writeRecord(space, prior);
    const prescriptionsRoot = join(space.root, "prescriptions");
    await mkdir(prescriptionsRoot, { recursive: true });
    const sourceYamlPath = join(prescriptionsRoot, "arc-a.yaml");
    const sourceYaml = "# GENERATED FROM ENGRAM ACTIVE RECORDS. DO NOT EDIT DIRECTLY.\nsessions:\n  - session_id: workout-7f8c\n    watts: 295\n";
    await writeFile(sourceYamlPath, sourceYaml, "utf8");

    // Phase 4: preview through the REAL pack + guarded transaction.
    const tools = testPreviewTools(space);
    const preview = await previewStructuredCapture(await loadConsultChangeSet(), tools);
    expect(preview.status).toBe("ready");
    if (preview.status !== "ready") return;
    const ready: ReadyCapturePreview = preview;

    // The plan must retire the prior record and create the replacement.
    expect(ready.changes).toEqual([
      expect.objectContaining({
        entityKey: "prescription:arc-a:workout-7f8c",
        recordRole: "state",
        classification: "supersede",
        retires: [prior.id],
      }),
      expect.objectContaining({ recordRole: "event", classification: "append" }),
    ]);

    const candidate = tools.previews[0];
    if (candidate === undefined) throw new Error("preview produced no candidate envelope");
    const proposal = await recomputeProposal(space, candidate);

    // Phase 5: apply with only the approved hash; count qmd invocations.
    const spawn = makeAlwaysSucceedsSpawnFn("Indexed: 2 new, 0 updated, 0 unchanged, 0 removed");
    const applied = await applyKnowledgeProposal({
      binding: space.active,
      proposal,
      decision: "approve",
      expectedPlanHash: ready.planHash,
      pack: engramCoachPack,
      spawnFn: spawn.spawnFn,
    });
    expect(applied.status).toBe("committed");
    if (applied.status !== "committed") return;
    expect(applied.plan_hash).toBe(ready.planHash);

    // Guarded qmd refresh: attempted exactly once, one indexing pass.
    expect(applied.refresh.attempted).toBe(true);
    expect(applied.refresh.count).toBe(1);
    expect(spawn.calls).toHaveLength(1);

    // Record mutations: prior retired in place, replacement supersedes old
    // (new -> old ONLY), consultation event appended without replacing.
    const retired = applied.mutations.find(
      (mutation) => mutation.action === "update" && mutation.recordId === prior.id,
    );
    expect(retired).toBeDefined();
    if (retired === undefined) return;
    expect(retired.after.status).toBe("retired");
    expect(retired.after.relationships.supersedes).toEqual([]);
    const createdState = applied.mutations.find(
      (mutation) =>
        mutation.action === "create" && mutation.after.details["recordRole"] === "state",
    );
    expect(createdState).toBeDefined();
    if (createdState === undefined) return;
    expect(createdState.after.status).toBe("active");
    expect(createdState.after.relationships.supersedes).toEqual([prior.id]);
    const createdEvent = applied.mutations.find(
      (mutation) =>
        mutation.action === "create" && mutation.after.details["recordRole"] === "event",
    );
    expect(createdEvent).toBeDefined();
    if (createdEvent === undefined) return;

    // Committed on-disk truth matches the mutation set.
    const committedFiles = (await readdir(space.recordsRoot)).filter((f) => f.endsWith(".md"));
    const committed: KnowledgeRecord[] = [];
    for (const file of committedFiles) {
      const parsed = parseKnowledgeRecord(await readFile(join(space.recordsRoot, file), "utf8"));
      if (!parsed.ok) throw new Error(`unparseable committed record ${file}`);
      committed.push(parsed.value);
    }
    expect(committed.find((r) => r.id === prior.id)?.status).toBe("retired");
    expect(committed.find((r) => r.id === createdState.recordId)?.relationships.supersedes)
      .toEqual([prior.id]);
    expect(committed.find((r) => r.id === createdEvent.recordId)?.status).toBe("active");

    // Regenerate compatibility views from the committed records alone.
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
    const writtenPaths = matz.written.map((w) => w.path);
    expect(writtenPaths).toContain("arc-a.yaml");
    expect(writtenPaths).toContain("coaching/consultations.md");

    const regeneratedYaml = await readFile(sourceYamlPath, "utf8");
    expect(regeneratedYaml.startsWith("# GENERATED FROM ENGRAM ACTIVE RECORDS. DO NOT EDIT DIRECTLY.\n")).toBe(true);
    expect(regeneratedYaml).toContain("workout-7f8c");
    expect(regeneratedYaml).not.toContain("295");

    const consultationsView = await readFile(join(config.coachingDocsDir, "coaching", "consultations.md"), "utf8");
    expect(consultationsView.startsWith("<!-- GENERATED FROM ENGRAM ACTIVE RECORDS. DO NOT EDIT DIRECTLY. -->\n")).toBe(true);
    expect(consultationsView).toContain("Athlete consulted about heavy legs");

    // Same-turn ambient response carrying the applied entity key: the host
    // apply result in turn.toolCalls suppresses the duplicate candidate.
    const turnToolCall = {
      tool: "engram_capture_apply",
      input: { plan_hash: applied.plan_hash },
      result: JSON.stringify({
        plan_hash: applied.plan_hash,
        status: "committed",
        entity_keys: ["prescription:arc-a:workout-7f8c"],
      }),
    };
    const suppressed = appliedEntityKeys([turnToolCall]);
    expect(suppressed.has("prescription:arc-a:workout-7f8c")).toBe(true);
    // And nothing else from the turn leaks into suppression.
    expect(suppressed.size).toBe(1);
  });

  it("rejects a mismatched expected hash instead of applying (stale approval)", async () => {
    const space = await createSyntheticCaptureSpace();
    spaces.push(space);
    await writeRecord(space, makeActiveStateRecord());
    const tools = testPreviewTools(space);
    const preview = await previewStructuredCapture(await loadConsultChangeSet(), tools);
    expect(preview.status).toBe("ready");
    if (preview.status !== "ready") return;
    const candidate = tools.previews[0];
    if (candidate === undefined) throw new Error("preview produced no candidate envelope");
    const proposal = await recomputeProposal(space, candidate);
    const outcome = await applyKnowledgeProposal({
      binding: space.active,
      proposal,
      decision: "approve",
      expectedPlanHash: "deadbeef".repeat(8),
      pack: engramCoachPack,
      spawnFn: makeAlwaysSucceedsSpawnFn("Indexed: 0 new, 0 updated, 0 unchanged, 0 removed").spawnFn,
    });
    expect(outcome.status).toBe("stale_approval");
    // Nothing was written: only the seeded record exists.
    const files = (await readdir(space.recordsRoot)).filter((f) => f.endsWith(".md"));
    expect(files).toHaveLength(1);
  });
});
