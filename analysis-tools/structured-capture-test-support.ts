/**
 * Synthetic active-space + explicit-capture fixtures for structured capture
 * tests. Reusable by later scenario tests (apply, materialization).
 *
 * Builds a real `ActiveSpace` over an ephemeral temp directory, writes real
 * serialized records into its records root, and provides a
 * `previewCandidate` tool that runs the REAL Engram
 * `reconcileKnowledgeTransaction` against the REAL engram-coach pack — no
 * mocked plan hashes, no mocked reconciliation.
 *
 * @module analysis-tools/structured-capture-test-support
 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CaptureMutationView, HostCapturePreview } from "@isparling/engram-harness/capture-types";
import type { JsonObject, KnowledgeEnvelope, KnowledgeRecord } from "@isparling/engram-harness/knowledge-types";
import { reconcileKnowledgeTransaction } from "../../engram/harness/src/knowledgeTransaction.ts";
import { parseKnowledgeRecord, serializeKnowledgeRecord } from "../../engram/harness/src/knowledgeRecord.ts";
import type { ActiveSpace } from "../../engram/harness/src/spaceRegistry.ts";
import { engramCoachPack } from "../engram-coach-pack.ts";
import type { PreviewTools } from "../engram-coach-structured-capture.ts";
import { SCHEMA_VERSION, type StructuredChangeSet } from "../engram-coach-capture-types.ts";

export const SYNTHETIC_SPACE_ID = "engram-coach";

export type SyntheticCaptureSpace = {
  active: ActiveSpace;
  root: string;
  recordsRoot: string;
  destroy(): Promise<void>;
};

let spaceCounter = 0;

/**
 * Create an ephemeral synthetic active space for the engram-coach pack.
 * Exact-mode related-record retrieval never invokes qmd, so no qmd
 * collection is registered.
 */
export async function createSyntheticCaptureSpace(spaceId = SYNTHETIC_SPACE_ID): Promise<SyntheticCaptureSpace> {
  spaceCounter += 1;
  const root = await mkdtemp(join(tmpdir(), `engram-coach-capture-${spaceCounter}-`));
  const recordsRoot = join(root, "records");
  await mkdir(recordsRoot, { recursive: true });
  const active: ActiveSpace = {
    recordsRoot,
    qmdConfigDir: join(root, "qmd-config"),
    qmdCacheHome: join(root, "qmd-cache"),
    qmdCollectionName: `engram-coach-capture-${spaceCounter}`,
    spaceId,
    spaceRoot: root,
    manifestPath: join(root, "space.json"),
    bindingPath: join(root, "binding.json"),
    sessionsDir: join(root, "sessions"),
    readRoots: [root],
    writeRoots: [recordsRoot],
    allowedModels: [],
    credentialEnv: [],
    knowledgeSchemaVersion: "0",
    packs: [{ id: engramCoachPack.id, version: engramCoachPack.version }],
  };
  return {
    active,
    root,
    recordsRoot,
    destroy: () => rm(root, { recursive: true, force: true }),
  };
}

/** Parse a serialized record fixture and write it as `<id>.md` in the space's records root. */
export async function writeRecord(space: SyntheticCaptureSpace, record: KnowledgeRecord): Promise<void> {
  const parsed = parseKnowledgeRecord(serializeKnowledgeRecord(record));
  if (!parsed.ok) throw new Error(`synthetic record ${record.id} does not serialize cleanly`);
  await writeFile(join(space.recordsRoot, `${record.id}.md`), serializeKnowledgeRecord(record), "utf8");
}

type RecordOverrides = Partial<Omit<KnowledgeRecord, "details">> & { details?: JsonObject };

/**
 * Build a synthetic ACTIVE explicit state record with the exact pack-owned
 * details shape the capture path writes. Defaults describe one prescription
 * session; override any field per scenario.
 */
export function makeActiveStateRecord(overrides: RecordOverrides = {}): KnowledgeRecord {
  return {
    schemaVersion: 0,
    id: "prescription-old",
    kind: "decision",
    status: "active",
    statement: "Thursday prescription: 4x8 at 295 W",
    details: {
      recordRole: "state",
      entityType: "prescription",
      entityKey: "prescription:arc-a:workout-7f8c",
      effectiveAt: "2026-08-24",
      sourceId: "legacy:migration:state:0",
      value: { intervals: 4, reps: 8, watts: 295 },
      artifact: { kind: "prescription", relativePath: "prescriptions/arc-a.yaml" },
      captureChannel: "explicit",
    },
    scope: {
      space: SYNTHETIC_SPACE_ID,
      subjects: [],
      topics: ["coaching:capture"],
      contexts: [],
      dimensions: {},
    },
    pack: { id: engramCoachPack.id, version: engramCoachPack.version },
    sources: [{ type: "engram-coach-capture", ref: "legacy:migration:state:0" }],
    session: { id: "omp-session", host: "omp" },
    submittedAt: "2026-08-01",
    disposition: "new",
    relationships: { supports: [], contradicts: [], refines: [], supersedes: [] },
    history: [{ event: "created", relatedId: "prescription-old", submittedAt: "2026-08-01" }],
    ...overrides,
    ...(overrides.details === undefined ? {} : { details: overrides.details }),
  };
}

/** Build a well-formed change set with one prescription state change by default. */
export function makeChangeSet(overrides: {
  sessionId?: string;
  turnId?: number;
  stateChanges?: StructuredChangeSet["state_changes"];
  events?: StructuredChangeSet["events"];
  reportClaims?: StructuredChangeSet["report_claims"];
} = {}): StructuredChangeSet {
  return {
    schema_version: SCHEMA_VERSION,
    source: { skill: "consult", session_id: overrides.sessionId ?? "omp-session", turn_id: overrides.turnId ?? 0 },
    state_changes: overrides.stateChanges ?? [
      {
        entity_type: "prescription",
        key_components: { arc_id: "arc-a", session_id: "workout-7f8c" },
        effective_at: "2026-08-25",
        statement: "Thursday changes from 4x8 at 295 W to 3x8 at 285 W",
        details: { intervals: 3, reps: 8, watts: 285 },
      },
    ],
    events: overrides.events ?? [],
    report_claims: overrides.reportClaims ?? [],
  };
}

/**
 * Preview tools backed by the REAL guarded core transaction against the
 * given synthetic space and the REAL engram-coach pack.
 */
export function testPreviewTools(space: SyntheticCaptureSpace): PreviewTools & {
  previews: KnowledgeEnvelope[];
  plannedMutations: CaptureMutationView[];
} {
  const previews: KnowledgeEnvelope[] = [];
  const plannedMutations: CaptureMutationView[] = [];
  return {
    previews,
    plannedMutations,
    spaceId: space.active.spaceId,
    previewCandidate: async (candidate): Promise<HostCapturePreview> => {
      previews.push(candidate);
      const { submittedAt, ...rest } = candidate;
      const outcome = await reconcileKnowledgeTransaction({
        binding: space.active,
        // Host envelope validation consumes the wire form (`submitted_at`).
        candidateInput: { ...rest, submitted_at: submittedAt },
        pack: engramCoachPack,
      });
      if (outcome.status === "proposal") {
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
      }
      return { schemaVersion: 0, status: "blocked", errors: outcome.errors };
    },
  };
}
