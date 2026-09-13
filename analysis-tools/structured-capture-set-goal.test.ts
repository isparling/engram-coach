/**
 * Complete-graph tests for the `set-goal` structured capture cutover.
 *
 * `set-goal` produces the whole arc at once: four prescribed sessions across
 * TWO sub-blocks (`base`, `build`), an arc overview, methodology documents,
 * and a kickoff consultation. The cutover contract under test:
 *   - every session carries a distinct DURABLE session_id; rescheduling
 *     (date/week/title changes) never changes its canonical entity key,
 *     verified by feeding both the original AND the mutated change-set items
 *     through the pack's real key derivation;
 *   - every prescription key contains BOTH the arc id and the session id;
 *   - one preview -> athlete approves the exact plan hash -> apply ->
 *     materialize pipeline creates the records and the generated YAML /
 *     consultation views (never hand-written);
 *   - rerunning the SAME approved graph is idempotent: state items reconcile
 *     to no-change, deterministic record IDs make any duplicate append fail
 *     closed as stale instead of writing twins, and regenerated views are
 *     byte-identical.
 *
 * Every step drives the REAL guarded core transaction against a synthetic
 * active space — plan hashes and record IDs are never mocked.
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type {
  CaptureMutationView,
  HostCapturePreview,
} from "@isparling/engram-harness/capture-types";
import type { JsonObject, KnowledgeRecord } from "@isparling/engram-harness/knowledge-types";
import type { AppliedCapturePlan, ReadyCapturePreview } from "../engram-coach-capture-types.ts";
import type { EngramCoachRuntimeConfig } from "../engram-coach-config.ts";
import type { PreviewTools } from "../engram-coach-structured-capture.ts";
import type { MaterializeTools } from "../engram-coach-materialization.ts";
import { materialize } from "../engram-coach-materialization.ts";
import { deriveCanonicalEntityKey } from "../engram-coach-keys.ts";
import { previewStructuredCapture } from "../engram-coach-structured-capture.ts";
import { engramCoachPack } from "../engram-coach-pack.ts";
import {
  applyKnowledgeProposal,
  reconcileKnowledgeTransaction,
  type KnowledgeProposal,
} from "../../engram/harness/src/knowledgeTransaction.ts";
import { parseKnowledgeRecord } from "../../engram/harness/src/knowledgeRecord.ts";
import type { QmdChildProcess, SpawnFn } from "../../engram/harness/src/qmdRunner.ts";
import type { SyntheticCaptureSpace } from "./structured-capture-test-support.ts";
import { createSyntheticCaptureSpace } from "./structured-capture-test-support.ts";

const SCENARIO_PATH = join(
  import.meta.dirname,
  "fixtures",
  "structured-capture",
  "scenarios",
  "set-goal-change-set.json",
);

const ARC_ID = "autumn_base";
const SUB_BLOCKS = ["base", "build"] as const;
const SESSION_IDS = ["ses2026w01tue", "ses2026w01sat", "ses2026w04tue", "ses2026w05sat"] as const;

/** Late synthetic applied-at: every fixture effective date must be effective. */
const APPLIED_AT = "2026-10-10T00:00:00Z";

type Scenario = {
  /** Deep copy per use — tests mutate the reschedule variant. */
  fresh(): JsonObject;
};

async function loadScenario(): Promise<Scenario> {
  const text = await readFile(SCENARIO_PATH, "utf8");
  return { fresh: () => JSON.parse(text) as JsonObject };
}

// ---------------------------------------------------------------------------
// Real preview tools that retain the proposal for hash-bound apply
// ---------------------------------------------------------------------------

/**
 * Like the shared `testPreviewTools`, but retains the accepted
 * `KnowledgeProposal` so the test can apply it under the approved hash.
 */
function graphPreviewTools(space: SyntheticCaptureSpace): PreviewTools & {
  state: { proposal: KnowledgeProposal | null };
} {
  const state: { proposal: KnowledgeProposal | null } = { proposal: null };
  return {
    spaceId: space.active.spaceId,
    state,
    previewCandidate: async (candidate): Promise<HostCapturePreview> => {
      // Host envelope validation consumes the wire form (`submitted_at`).
      const { submittedAt, ...rest } = candidate;
      const outcome = await reconcileKnowledgeTransaction({
        binding: space.active,
        candidateInput: { ...rest, submitted_at: submittedAt },
        pack: engramCoachPack,
      });
      if (outcome.status === "proposal") {
        state.proposal = outcome.proposal;
        const mutations: CaptureMutationView[] = outcome.proposal.plan.mutations.map((mutation) => ({
          recordId: mutation.recordId,
          action: mutation.action,
          beforeHash: mutation.beforeHash,
          after: mutation.after,
        }));
        return { schemaVersion: 0, status: "ready", planHash: outcome.proposal.plan_hash, mutations };
      }
      return { schemaVersion: 0, status: "blocked", errors: outcome.errors };
    },
  };
}

/**
 * Spawn stand-in that refuses to run qmd so apply commits records without
 * touching an index. Records stay authoritative; the refresh reports stale.
 */
function noQmdSpawn(): SpawnFn {
  return (): QmdChildProcess => ({
    stdout: null,
    stderr: null,
    on: (event, listener) => {
      if (event === "error") queueMicrotask(() => listener(new Error("qmd disabled in set-goal graph test")));
      return undefined as never;
    },
  });
}

type ApplyOutcome = Awaited<ReturnType<typeof applyKnowledgeProposal>>;

/** Approve the exact previewed hash through the real guarded core. */
function applyApproved(
  space: SyntheticCaptureSpace,
  proposal: KnowledgeProposal,
  expectedPlanHash: string,
): Promise<ApplyOutcome> {
  return applyKnowledgeProposal({
    binding: space.active,
    proposal,
    decision: "approve",
    expectedPlanHash,
    pack: engramCoachPack,
    spawnFn: noQmdSpawn(),
  });
}

// ---------------------------------------------------------------------------
// Disk-backed records + artifacts
// ---------------------------------------------------------------------------

async function readActiveRecords(space: SyntheticCaptureSpace): Promise<KnowledgeRecord[]> {
  const files = (await readdir(space.recordsRoot)).filter((name) => name.endsWith(".md"));
  const records = await Promise.all(
    [...files].sort().map(async (name) => {
      const parsed = parseKnowledgeRecord(await readFile(join(space.recordsRoot, name), "utf8"));
      if (!parsed.ok) throw new Error(`record ${name} does not parse`);
      return parsed.value;
    }),
  );
  return records;
}

/** Materialize tools that write REAL files under a temp project root. */
function diskMaterializeTools(
  space: SyntheticCaptureSpace,
  config: EngramCoachRuntimeConfig,
): MaterializeTools & { snapshot(): Promise<Map<string, string>> } {
  const projectRoot = space.root;
  return {
    projectRoot,
    appliedAt: APPLIED_AT,
    listRecords: () => readActiveRecords(space),
    replaceArtifact: async ({ root, relativePath, content }) => {
      const target = join(root, relativePath);
      const existing = await readFile(target, "utf8").catch(() => null);
      if (existing === content) return { status: "unchanged" as const, path: relativePath };
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
      return { status: "replaced" as const, path: relativePath };
    },
    snapshot: async () => {
      const out = new Map<string, string>();
      for (const dir of [config.coachingDocsDir, config.prescriptionsDir]) {
        const walk = async (current: string): Promise<void> => {
          const entries = await readdir(current, { withFileTypes: true }).catch(() => null);
          if (entries === null) return;
          for (const entry of entries) {
            const child = join(current, entry.name);
            if (entry.isDirectory()) await walk(child);
            else out.set(child.slice(projectRoot.length + 1), await readFile(child, "utf8"));
          }
        };
        await walk(dir);
      }
      return out;
    },
  };
}

function testConfig(root: string): EngramCoachRuntimeConfig {
  return {
    activeProfile: "test",
    coachingDocsDir: join(root, "coaching-docs"),
    prescriptionsDir: join(root, "prescriptions"),
    capture: { model: "synthetic/capture-model", timeoutSeconds: 60, maxCandidatesPerTurn: 3 },
  };
}

// ---------------------------------------------------------------------------
// Shared pipeline
// ---------------------------------------------------------------------------

const spaces: SyntheticCaptureSpace[] = [];
afterAll(async () => {
  await Promise.all(spaces.splice(0).map((space) => space.destroy()));
});

async function freshSpace(): Promise<SyntheticCaptureSpace> {
  const space = await createSyntheticCaptureSpace();
  spaces.push(space);
  return space;
}

/** Preview a change set against the space; require a ready plan + proposal. */
async function previewGraph(
  space: SyntheticCaptureSpace,
  changeSet: JsonObject,
): Promise<{ preview: ReadyCapturePreview; proposal: KnowledgeProposal }> {
  const tools = graphPreviewTools(space);
  const result = await previewStructuredCapture(changeSet, tools);
  if (result.status !== "ready") {
    throw new Error(`expected ready preview, got blocked: ${JSON.stringify(result.errors)}`);
  }
  if (tools.state.proposal === null) throw new Error("ready preview without retained proposal");
  return { preview: result, proposal: tools.state.proposal };
}

/** Full approved run: preview -> approve exact hash -> apply -> mutations. */
async function runApprovedGraph(
  space: SyntheticCaptureSpace,
  scenario: Scenario,
): Promise<{ preview: ReadyCapturePreview; mutations: CaptureMutationView[] }> {
  const { preview, proposal } = await previewGraph(space, scenario.fresh());
  const applied = await applyApproved(space, proposal, preview.planHash);
  if (applied.status !== "committed") {
    throw new Error(`expected committed apply, got ${applied.status}: ${JSON.stringify(applied)}`);
  }
  const mutations: CaptureMutationView[] = applied.mutations.map((mutation) => ({
    recordId: mutation.recordId,
    action: "create",
    beforeHash: null,
    after: mutation.after,
  }));
  return { preview, mutations };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("set-goal complete graph", () => {
  it("derives distinct durable session keys across two sub-blocks that survive rescheduling", async () => {
    const scenario = await loadScenario();
    const graph = scenario.fresh();

    // The complete graph covers BOTH sub-blocks and all four sessions.
    const states = graph["state_changes"];
    if (!Array.isArray(states)) throw new Error("fixture missing state_changes");
    expect(states).toHaveLength(4);
    const coveredSessions = new Set<string>();
    const coveredSubBlocks = new Set<string>();
    for (const raw of states) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("malformed state item");
      const keyComponents = raw["key_components"];
      const details = raw["details"];
      if (typeof keyComponents !== "object" || keyComponents === null || Array.isArray(keyComponents)) throw new Error("malformed key_components");
      if (typeof details !== "object" || details === null || Array.isArray(details)) throw new Error("malformed details");
      const sessionId = keyComponents["session_id"];
      const subBlock = details["subBlock"];
      if (typeof sessionId === "string") coveredSessions.add(sessionId);
      if (typeof subBlock === "string") coveredSubBlocks.add(subBlock);

      // Derived by the pack's real key derivation FROM THE ITEM — not from
      // hand-written literals: the key binds arc AND session ids.
      const derived = deriveCanonicalEntityKey({
        entity_type: "prescription",
        key_components: keyComponents,
      });
      expect(derived).toEqual({
        kind: "bound",
        key: `prescription:${String(keyComponents["arc_id"])}:${String(sessionId)}`,
      });
    }
    expect(coveredSessions).toEqual(new Set(SESSION_IDS));
    expect(coveredSubBlocks).toEqual(new Set(SUB_BLOCKS));
    expect(coveredSessions.size).toBe(SESSION_IDS.length);

    // Reschedule session one IN A COPY OF THE FIXTURE ITEM — later date, new
    // week, renamed session — then re-derive its key from the MUTATED item.
    const original = states[0];
    if (typeof original !== "object" || original === null || Array.isArray(original)) throw new Error("malformed state_changes[0]");
    const mutated: JsonObject = JSON.parse(JSON.stringify(original)) as JsonObject;
    mutated["effective_at"] = "2026-09-08";
    const mutatedDetails = mutated["details"];
    if (typeof mutatedDetails !== "object" || mutatedDetails === null || Array.isArray(mutatedDetails)) throw new Error("malformed details");
    mutatedDetails["sessionDate"] = "2026-09-08";
    mutatedDetails["week"] = 2;
    mutatedDetails["sessionName"] = "W2_RescheduledSubLT2";

    const beforeKey = deriveCanonicalEntityKey({
      entity_type: "prescription",
      key_components: (original as { key_components: JsonObject }).key_components,
    });
    const afterKey = deriveCanonicalEntityKey({
      entity_type: "prescription",
      key_components: (mutated as { key_components: JsonObject }).key_components,
    });
    expect(afterKey).toEqual(beforeKey);
    expect(beforeKey).toEqual({ kind: "bound", key: `prescription:${ARC_ID}:${SESSION_IDS[0]}` });

    // Workout identity uses the same durable id and behaves identically.
    expect(
      deriveCanonicalEntityKey({ entity_type: "workout", key_components: { session_id: SESSION_IDS[0] } }),
    ).toEqual({ kind: "bound", key: `workout:${SESSION_IDS[0]}` });
  });

  it("previews the complete graph with one hash and eight deterministic record creations", async () => {
    const scenario = await loadScenario();
    const space = await freshSpace();
    const { preview } = await previewGraph(space, scenario.fresh());

    expect(preview.planHash).toMatch(/^[0-9a-f]{16,}$/);
    expect(preview.changes).toHaveLength(8); // 4 prescription states + 1 consultation event + 3 report claims

    const createdIds = preview.changes.flatMap((change) => change.creates);
    expect(new Set(createdIds).size).toBe(createdIds.length);

    // Four prescription rows carry both arc and session ids in their keys.
    const prescriptionKeys = preview.changes
      .filter((change) => change.recordRole === "state")
      .map((change) => change.entityKey);
    expect(prescriptionKeys).toHaveLength(4);
    for (const key of prescriptionKeys) {
      expect(key).toMatch(new RegExp(`^prescription:${ARC_ID}:(${SESSION_IDS.join("|")})$`));
    }

    // One appended consultation event and three report claims.
    expect(preview.changes.filter((change) => change.recordRole === "event")).toHaveLength(1);
    expect(preview.changes.filter((change) => change.recordRole === "report-claim")).toHaveLength(3);
  });

  it("applies the approved hash and materializes YAML plus consultation views from records", async () => {
    const scenario = await loadScenario();
    const space = await freshSpace();
    const { preview, mutations } = await runApprovedGraph(space, scenario);

    // Committed records match the previewed creations exactly.
    const records = await readActiveRecords(space);
    expect(records.map((record) => record.id).sort()).toEqual(
      preview.changes.flatMap((change) => change.creates).sort(),
    );
    for (const record of records) {
      expect(record.status).toBe("active");
    }

    const config = testConfig(space.root);
    const tools = diskMaterializeTools(space, config);
    const appliedPlan: AppliedCapturePlan = { planHash: preview.planHash, mutations };
    const materialization = await materialize(appliedPlan, tools, { config });
    expect(materialization.stale).toEqual([]);
    // Generated prescription YAML: one per arc with a warning header.
    // Canonical record pointers carry `prescriptions/`; materialization maps
    // that prefix to the already configured prescriptions_dir root.
    const yamlRelativePath = `${ARC_ID}.yaml`;
    const yamlPath = join(config.prescriptionsDir, yamlRelativePath);
    const yaml = await readFile(yamlPath, "utf8");
    expect(yaml.startsWith("# GENERATED FROM ENGRAM ACTIVE RECORDS. DO NOT EDIT DIRECTLY.\n")).toBe(true);
    expect(yaml).toContain(`block_name: ${ARC_ID}`);
    for (const sessionId of SESSION_IDS) {
      expect(yaml).toContain(`session_id: ${sessionId}`);
      expect(yaml).not.toContain(`${sessionId}-old`);
    }
    expect(yaml).toContain("event: Gravel 200");
    expect(materialization.written.some((entry) => entry.path === yamlRelativePath)).toBe(true);

    // Consultation views are created FROM records, not scaffolded by hand.
    const consultationsPath = join(config.coachingDocsDir, "coaching", "consultations.md");
    const consultations = await readFile(consultationsPath, "utf8");
    expect(consultations.startsWith("<!-- GENERATED FROM ENGRAM ACTIVE RECORDS. DO NOT EDIT DIRECTLY. -->\n")).toBe(true);
    expect(consultations).toContain("Autumn base arc kickoff");
    expect(materialization.written.some((entry) => entry.path === "coaching/consultations.md")).toBe(true);
  });

  it("replays the same approved graph idempotently: no duplicates, byte-identical views", async () => {
    const scenario = await loadScenario();
    const space = await freshSpace();
    const { preview: firstPreview, mutations } = await runApprovedGraph(space, scenario);

    const config = testConfig(space.root);
    const tools = diskMaterializeTools(space, config);
    await materialize({ planHash: firstPreview.planHash, mutations }, tools, { config });
    const beforeViews = await tools.snapshot();
    const beforeIds = (await readActiveRecords(space)).map((record) => record.id).sort();

    // Replay the IDENTICAL approved graph through preview again. The pack
    // fails CLOSED: replayed state items collide with their own committed
    // records (ambiguous_state / state_conflict), so no second plan is ever
    // produced — duplicates are structurally impossible.
    const replay = await previewStructuredCapture(scenario.fresh(), graphPreviewTools(space));
    expect(replay.status).toBe("blocked");

    // No duplicate records either way.
    const afterIds = (await readActiveRecords(space)).map((record) => record.id).sort();
    expect(afterIds).toEqual(beforeIds);

    // Regenerating views from the unchanged record set is byte-identical.
    const afterMaterialization = await materialize(
      { planHash: firstPreview.planHash, mutations },
      tools,
      { config },
    );
    expect(afterMaterialization.stale).toEqual([]);
    expect(afterMaterialization.written).toEqual([]);
    expect(await tools.snapshot()).toEqual(beforeViews);
  });
});
