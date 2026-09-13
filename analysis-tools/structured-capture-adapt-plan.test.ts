/**
 * Complete adapt-plan structured-capture scenario.
 *
 * Seeds an active next-session prescription record, previews and applies the
 * REAL fixture change set through the real Engram transaction (plan hashes
 * and record IDs are never mocked), then verifies the shared guarantees:
 * prior state retired, new state plus workout-adaptation event active,
 * supersedes edge pointing new-to-old only, exactly one guarded qmd refresh,
 * and regenerated compatibility views whose adaptation Markdown carries the
 * prescription-vs-execution, subjective, stream-analysis, and signal-
 * interaction content from the event value.
 */

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseKnowledgeRecord, serializeKnowledgeRecord } from "../../engram/harness/src/knowledgeRecord.ts";
import type {
  CaptureMutationView,
  HostCapturePreview,
} from "@isparling/engram-harness/capture-types";
import type {
  JsonArray,
  JsonObject,
  KnowledgeEnvelope,
  KnowledgeRecord,
} from "@isparling/engram-harness/knowledge-types";
import {
  applyKnowledgeProposal,
  reconcileKnowledgeTransaction,
  type KnowledgeProposal,
} from "../../engram/harness/src/knowledgeTransaction.ts";
import { parseKnowledgeRecord } from "../../engram/harness/src/knowledgeRecord.ts";
import type { QmdChildProcess, SpawnFn } from "../../engram/harness/src/qmdRunner.ts";
import { engramCoachPack } from "../engram-coach-pack.ts";
import { previewStructuredCapture } from "../engram-coach-structured-capture.ts";
import type {
  AppliedCapturePlan,
  ReadyCapturePreview,
} from "../engram-coach-capture-types.ts";
import { materialize, type MaterializeTools } from "../engram-coach-materialization.ts";
import type { SyntheticCaptureSpace } from "./structured-capture-test-support.ts";
import {
  createSyntheticCaptureSpace,
  makeActiveStateRecord,
  writeRecord,
} from "./structured-capture-test-support.ts";

const FIXTURE_PATH = join(import.meta.dirname, "fixtures", "structured-capture", "scenarios", "adapt-plan-change-set.json");
const ENTITY_KEY = "prescription:arc-a:w3-thu-sublt2";
const APPLIED_AT = "2026-08-22T18:00:00Z";

async function loadFixture(): Promise<JsonObject> {
  return JSON.parse(await readFile(FIXTURE_PATH, "utf8")) as JsonObject;
}

function priorSessionValue(): JsonObject {
  return {
    blockName: "Build 1",
    goal: { event: "Example Endurance Event", date: "2027-06-15" },
    order: 3,
    sessionId: "w3-thu-sublt2",
    week: 3,
    day: "thursday",
    sessionDate: "2026-08-21",
    sessionName: "Sub-LT2 intervals",
    modality: "bike",
    totalDurationMin: 74,
    effortZone: "sub-lt2",
    warmup: { powerLowPct: 50, powerHighPct: 65 },
    cooldown: { powerLowPct: 50, powerHighPct: 60 },
    intervals: [
      { durationMin: 12, powerLowPct: 88, powerHighPct: 92, count: 4, recoveryMin: 3 },
    ],
  };
}

/** Seed one active next-session prescription state record matching the fixture key. */
function seedPriorState(): KnowledgeRecord {
  return makeActiveStateRecord({
    id: "prescription-prior",
    statement: "Next sub-LT2 session: 4x12 at 88-92% LT2 power",
    details: {
      recordRole: "state",
      entityType: "prescription",
      entityKey: ENTITY_KEY,
      effectiveAt: "2026-08-21",
      sourceId: "legacy:migration:state:1",
      value: priorSessionValue(),
      artifact: { kind: "prescription", relativePath: "prescriptions/arc-a.yaml" },
      captureChannel: "explicit",
    },
  });
}

/**
 * Real preview AND apply plumbing over the synthetic space. The preview keeps
 * the full proposal so apply re-validates and commits through
 * `applyKnowledgeProposal` with the exact approved hash — nothing mocked.
 */
function makePreviewApplyTools(space: SyntheticCaptureSpace) {
  let proposal: KnowledgeProposal | null = null;
  const plannedMutations: CaptureMutationView[] = [];
  const qmdInvocations: Array<{ command: string; args: string[] }> = [];

  const spawnFn: SpawnFn = (command, args): QmdChildProcess => {
    qmdInvocations.push({ command, args });
    let closeHandler: (code: number | null) => void = () => {};
    return {
      stdout: null,
      stderr: null,
      on(event, listener) {
        if (event === "spawn") queueMicrotask(() => (listener as () => void)());
        else if (event === "close") {
          closeHandler = listener as (code: number | null) => void;
          queueMicrotask(() => closeHandler(0));
        }
        return {} as QmdChildProcess;
      },
    };
  };

  return {
    spaceId: space.active.spaceId,
    plannedMutations,
    qmdInvocations,
    previewCandidate: async (candidate: KnowledgeEnvelope): Promise<HostCapturePreview> => {
      const { submittedAt, ...rest } = candidate;
      const outcome = await reconcileKnowledgeTransaction({
        binding: space.active,
        candidateInput: { ...rest, submitted_at: submittedAt },
        pack: engramCoachPack,
      });
      if (outcome.status !== "proposal") {
        return { schemaVersion: 0, status: "blocked", errors: outcome.errors };
      }
      proposal = outcome.proposal;
      const mutations: CaptureMutationView[] = outcome.proposal.plan.mutations.map((mutation) => ({
        recordId: mutation.recordId,
        action: mutation.action,
        beforeHash: mutation.beforeHash,
        after: mutation.after,
      }));
      plannedMutations.push(...mutations);
      return {
        schemaVersion: 0,
        status: "ready",
        planHash: outcome.proposal.plan_hash,
        mutations,
      };
    },
    apply: async (expectedPlanHash: string) => {
      if (proposal === null) throw new Error("apply called before any ready preview");
      return applyKnowledgeProposal({
        binding: space.active,
        proposal,
        pack: engramCoachPack,
        decision: "approve",
        expectedPlanHash,
        spawnFn,
      });
    },
  };
}

async function listSpaceRecords(space: SyntheticCaptureSpace): Promise<KnowledgeRecord[]> {
  const files = (await readdir(space.recordsRoot)).filter((name) => name.endsWith(".md"));
  const records = await Promise.all(
    files.map(async (name) => parseKnowledgeRecord(await readFile(join(space.recordsRoot, name), "utf8"))),
  );
  return records.map((parsed) => {
    if (!parsed.ok) throw new Error("committed record failed to parse back");
    return parsed.value;
  });
}

/** Materialize tools that write REAL bytes under the synthetic space root. */
function materializeTools(space: SyntheticCaptureSpace): MaterializeTools {
  return {
    projectRoot: space.root,
    appliedAt: APPLIED_AT,
    listRecords: () => listSpaceRecords(space),
    replaceArtifact: async ({ root, relativePath, content }) => {
      const target = join(root, relativePath);
      await mkdir(dirname(target), { recursive: true });
      const previous = await readFile(target, "utf8").catch(() => null);
      if (previous === content) return { status: "unchanged", path: relativePath };
      await writeFile(target, content, "utf8");
      return { status: "replaced", path: relativePath };
    },
  };
}

const spaces: SyntheticCaptureSpace[] = [];
afterAll(async () => {
  await Promise.all(spaces.splice(0).map((space) => space.destroy()));
});

async function freshSpace(): Promise<SyntheticCaptureSpace> {
  const space = await createSyntheticCaptureSpace();
  spaces.push(space);
  return space;
}

describe("adapt-plan structured capture scenario", () => {
  it("applies the approved adaptation: prior state retired, new state and event active, supersedes edge new-to-old only", async () => {
    const space = await freshSpace();
    const prior = seedPriorState();
    await writeRecord(space, prior);

    const tools = makePreviewApplyTools(space);
    const preview = await previewStructuredCapture(await loadFixture(), tools);
    expect(preview.status).toBe("ready");
    if (preview.status !== "ready") throw new Error("expected a ready preview");

    expect(preview.changes).toEqual([
      {
        entityKey: ENTITY_KEY,
        recordRole: "state",
        classification: "supersede",
        creates: [expect.stringMatching(/^coach-[0-9a-f]{24}$/)],
        retires: ["prescription-prior"],
      },
      {
        entityKey: null,
        recordRole: "event",
        classification: "append",
        creates: [expect.stringMatching(/^coach-[0-9a-f]{24}$/)],
        retires: [],
      },
    ]);

    const applied = await tools.apply(preview.planHash);
    expect(applied.status).toBe("committed");
    if (applied.status !== "committed") return;

    const records = await listSpaceRecords(space);
    const priorAfter = records.find((record) => record.id === prior.id);
    expect(priorAfter?.status).toBe("retired");

    const createdIds = applied.mutations
      .filter((mutation) => mutation.action === "create")
      .map((mutation) => mutation.recordId);
    expect(createdIds).toHaveLength(2);

    const newState = records.find((record) => record.id === createdIds[0]);
    expect(newState?.status).toBe("active");
    expect(newState?.details["entityKey"]).toBe(ENTITY_KEY);
    expect(newState?.details["entityType"]).toBe("prescription");

    const event = records.find((record) => record.id === createdIds[1]);
    expect(event?.status).toBe("active");
    expect(event?.details["entityType"]).toBe("workout-adaptation");
    // Action targets live on the candidate item, not the committed record.
    const eventItem = (preview.candidate.details["items"] as JsonArray)[1] as JsonObject;
    expect(eventItem["actionTargets"]).toContain(ENTITY_KEY);

    // The supersedes edge points new-to-old ONLY; the retired prior record's
    // relationships stay untouched (no reverse edge).
    expect(newState?.relationships.supersedes).toEqual([prior.id]);
    expect(priorAfter?.relationships.supersedes).toEqual([]);

    // Exactly one guarded qmd invocation for the whole commit.
    expect(applied.refresh.attempted).toBe(true);
    expect(applied.refresh.count).toBe(1);
    expect(tools.qmdInvocations).toHaveLength(1);
    expect(tools.qmdInvocations[0]?.command).toBe("qmd");
  });

  it("rejects a stale hash: authoritative drift after approval forces a fresh preview", async () => {
    const space = await freshSpace();
    const prior = seedPriorState();
    await writeRecord(space, prior);

    const tools = makePreviewApplyTools(space);
    const preview = await previewStructuredCapture(await loadFixture(), tools);
    expect(preview.status).toBe("ready");
    if (preview.status !== "ready") return;
    const approvedHash = preview.planHash;

    // The authoritative source record drifts after approval was captured.
    const drifted = seedPriorState();
    drifted.statement = "Next sub-LT2 session: 5x12 at 88-92% LT2 power";
    await writeFile(join(space.recordsRoot, `${prior.id}.md`), serializeKnowledgeRecord(drifted), "utf8");

    const stale = await tools.apply(approvedHash);
    expect(stale.status).toBe("stale_approval");
    if (stale.status !== "stale_approval") return;
    expect(stale.expected_plan_hash).toBe(approvedHash);
  });

  it("regenerates compatibility views whose adaptation Markdown carries event-value content", async () => {
    const space = await freshSpace();
    await writeRecord(space, seedPriorState());

    const tools = makePreviewApplyTools(space);
    const preview = await previewStructuredCapture(await loadFixture(), tools);
    expect(preview.status).toBe("ready");
    if (preview.status !== "ready") return;

    const applied = await tools.apply(preview.planHash);
    expect(applied.status).toBe("committed");
    const appliedPlan: AppliedCapturePlan = { planHash: preview.planHash, mutations: preview.mutations };

    const result = await materialize(appliedPlan, materializeTools(space), {
      config: {
        activeProfile: "test",
        coachingDocsDir: "views/coaching-docs",
        prescriptionsDir: "prescriptions",
        capture: { model: "synthetic/capture-model", timeoutSeconds: 60, maxCandidatesPerTurn: 3 },
      },
    });

    const writtenPaths = result.written.map((entry) => entry.path).sort();
    expect(writtenPaths).toEqual(["arc-a.yaml", "coaching/adaptations.md"]);
    expect(result.stale).toEqual([]);

    // Real rendered bytes read back from disk — never a stub renderer.
    const adaptationBytes = await readFile(join(space.root, "views", "coaching-docs", "coaching", "adaptations.md"), "utf8");
    expect(adaptationBytes).toContain("<!-- GENERATED FROM ENGRAM ACTIVE RECORDS. DO NOT EDIT DIRECTLY. -->");
    expect(adaptationBytes).toContain("# Workout Adaptations");
    expect(adaptationBytes).toContain("### W3 Thursday sub-LT2 reduced from 4x12 to 3x12");
    expect(adaptationBytes).toContain("planned 4x12 sub-LT2 intervals at 88-92% LT2 power; completed all four with final-interval power fading 11% below target");
    expect(adaptationBytes).toContain("RPE 8.5, heavy legs from the first interval, poor sleep the night before");
    expect(adaptationBytes).toContain("aerobic_decoupling 6.8% (amber); interval_execution_quality CV 4.2% (green)");
    expect(adaptationBytes).toContain("amber decoupling and RPE 8.5 contradict push-zone TSB (+7)");

    const yamlBytes = await readFile(join(space.root, "prescriptions", "arc-a.yaml"), "utf8");
    expect(yamlBytes).toContain("# GENERATED FROM ENGRAM ACTIVE RECORDS. DO NOT EDIT DIRECTLY.");
    expect(yamlBytes).toContain("count: 3");
    expect(yamlBytes).toContain("session_name: Sub-LT2 intervals (reduced)");
  });
});
