/**
 * Behavior tests for the report-claim capture channel (race-analysis,
 * block-review, season-retrospective).
 *
 * Contract under test:
 *   - An approved report claim retains `source_document` on the normalized
 *     item inside the aggregate candidate and carries
 *     `recordRole: "report-claim"`.
 *   - A claim whose structured value matches the current exact-key state
 *     creates an ACTIVE record with `supports: [current.id]` — it never
 *     retires or supersedes the state it corroborates.
 *   - `materialize` NEVER writes a canonical narrative document:
 *     `RACE_REPORT.md`, block `SUMMARY.md`, or `SEASON_REVIEW.md` appear in
 *     no materialization result and no artifact is written for them.
 *
 * Every step drives the REAL path: `previewStructuredCapture` over the real
 * guarded core transaction against a synthetic active space, verbatim
 * application of the proposed mutation records into that space's records
 * root (what the host apply commits), then the real `materialize`.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { KnowledgeRecord } from "@isparling/engram-harness/knowledge-types";
import type {
  AppliedCapturePlan,
  ArtifactReplacementResult,
  CaptureMutationView,
  ReadyCapturePreview,
} from "../engram-coach-capture-types.ts";
import type { EngramCoachRuntimeConfig } from "../engram-coach-config.ts";
import { materialize, type MaterializeTools } from "../engram-coach-materialization.ts";
import { parseKnowledgeRecord } from "../../engram/harness/src/knowledgeRecord.ts";
import { previewStructuredCapture } from "../engram-coach-structured-capture.ts";
import {
  createSyntheticCaptureSpace,
  makeActiveStateRecord,
  testPreviewTools,
  writeRecord,
  type SyntheticCaptureSpace,
} from "./structured-capture-test-support.ts";

const FIXTURE = join(
  import.meta.dirname,
  "fixtures",
  "structured-capture",
  "scenarios",
  "report-claims-change-set.json",
);

const CANONICAL_REPORT_PATHS = [
  /(^|\/)RACE_REPORT\.md$/i,
  /(^|\/)SUMMARY\.md$/i,
  /(^|\/)SEASON_REVIEW\.md$/i,
];

const spaces: SyntheticCaptureSpace[] = [];
afterAll(async () => {
  await Promise.all(spaces.splice(0).map((space) => space.destroy()));
});

async function freshSpace(): Promise<SyntheticCaptureSpace> {
  const space = await createSyntheticCaptureSpace();
  spaces.push(space);
  return space;
}

async function loadFixture(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(FIXTURE, "utf8")) as Record<string, unknown>;
}

async function readyPreview(
  space: SyntheticCaptureSpace,
): Promise<{ preview: ReadyCapturePreview; mutations: CaptureMutationView[] }> {
  const tools = testPreviewTools(space);
  const preview = await previewStructuredCapture(
    await loadFixture(),
    tools,
  );
  if (preview.status !== "ready") {
    throw new Error(`expected ready preview, got blocked: ${JSON.stringify(preview.errors)}`);
  }
  return { preview, mutations: tools.plannedMutations };
}

/** Commit exactly the proposed mutations into the space, like host apply. */
async function applyMutations(
  space: SyntheticCaptureSpace,
  mutations: CaptureMutationView[],
): Promise<AppliedCapturePlan> {
  for (const mutation of mutations) {
    await writeRecord(space, mutation.after);
  }
  return { planHash: "", mutations };
}

/** In-memory materialize tools over the space's committed records. */
function materializeToolsFor(space: SyntheticCaptureSpace): MaterializeTools & {
  replaceCalls: Array<{ root: string; relativePath: string; content: string }>;
  config: EngramCoachRuntimeConfig;
} {
  const replaceCalls: Array<{ root: string; relativePath: string; content: string }> = [];
  const config: EngramCoachRuntimeConfig = {
    activeProfile: "test",
    coachingDocsDir: join(space.root, "coaching-docs"),
    prescriptionsDir: join(space.root, "prescriptions"),
    capture: { model: "synthetic/capture-model", timeoutSeconds: 60, maxCandidatesPerTurn: 3 },
  };
  return {
    replaceCalls,
    config,
    projectRoot: space.root,
    appliedAt: "2026-08-23T00:00:00Z",
    listRecords: async () => {
      const names = await readdir(space.recordsRoot);
      const records: KnowledgeRecord[] = [];
      for (const name of names.filter((entry) => entry.endsWith(".md"))) {
        const parsed = await parseKnowledgeRecordFrom(space.recordsRoot, name);
        if (parsed !== null) records.push(parsed);
      }
      return records;
    },
    replaceArtifact: async (
      request: { root: string; relativePath: string; content: string },
    ): Promise<ArtifactReplacementResult> => {
      replaceCalls.push(request);
      return { status: "replaced", path: request.relativePath };
    },
  };
}

async function parseKnowledgeRecordFrom(root: string, name: string): Promise<KnowledgeRecord | null> {
  const raw = await readFile(join(root, name), "utf8");
  const parsed = parseKnowledgeRecord(raw);
  return parsed.ok ? parsed.value : null;
}

describe("report claim capture behavior", () => {
  it("retains source_document and recordRole report-claim through validation", async () => {
    const space = await freshSpace();
    await writeRecord(space, makeActiveStateRecord());
    const { preview } = await readyPreview(space);
    expect(preview.changes).toHaveLength(1);

    // The retained aggregate candidate item keeps the provenance fields.
    const items = preview.candidate.details["items"];
    expect(Array.isArray(items)).toBe(true);
    if (!Array.isArray(items)) return;
    const item = items[0] as Record<string, unknown>;
    expect(item["role"]).toBe("report-claim");
    expect(item["sourceDocument"]).toBe(
      "2026/races/2026-08-22-example-gravel-event/RACE_REPORT.md",
    );
    expect(item["entityKey"]).toBe("prescription:arc-a:workout-7f8c");
  });

  it("creates an ACTIVE claim with supports:[current.id] when value equals current state", async () => {
    const space = await freshSpace();
    await writeRecord(space, makeActiveStateRecord());
    const { preview, mutations } = await readyPreview(space);

    const change = preview.changes[0];
    expect(change?.recordRole).toBe("report-claim");
    expect(change?.classification).toBe("support");
    expect(change?.retires).toEqual([]);
    expect(change?.creates).toHaveLength(1);

    // Apply exactly what the plan proposes; inspect the committed record.
    await applyMutations(space, mutations);
    const claimId = change?.creates[0];
    if (claimId === undefined) throw new Error("expected one created claim id");
    const raw = await readFile(join(space.recordsRoot, `${claimId}.md`), "utf8");
    const parsed = parseKnowledgeRecord(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const claim = parsed.value;
    expect(claim.status).toBe("active");
    expect(claim.details["recordRole"]).toBe("report-claim");
    expect(claim.relationships.supports).toEqual(["prescription-old"]);
    expect(claim.relationships.supersedes).toEqual([]);
    // The current state record is untouched — a claim never replaces it.
    const priorRaw = await readFile(join(space.recordsRoot, "prescription-old.md"), "utf8");
    expect(priorRaw).toContain('status: "active"');
  });

  it("materializes no canonical report document", async () => {
    const space = await freshSpace();
    await writeRecord(space, makeActiveStateRecord());
    const { preview, mutations } = await readyPreview(space);
    await applyMutations(space, mutations);

    const matTools = materializeToolsFor(space);
    const result = await materialize(
      { planHash: preview.planHash, mutations },
      matTools,
      { config: matTools.config },
    );

    const touchedPaths = [
      ...result.written.map((entry) => entry.path),
      ...result.unchanged.map((entry) => entry.path),
      ...result.stale.map((entry) => entry.path),
      ...matTools.replaceCalls.map((call) => call.relativePath),
    ];
    for (const pattern of CANONICAL_REPORT_PATHS) {
      expect(touchedPaths.some((path) => pattern.test(path))).toBe(false);
    }
    // And nothing was written to disk for them either.
    const writtenPaths = matTools.replaceCalls.map((call) => call.relativePath);
    expect(writtenPaths).not.toContain("RACE_REPORT.md");
    expect(writtenPaths).not.toContain("SUMMARY.md");
    expect(writtenPaths).not.toContain("SEASON_REVIEW.md");

    // Positive control: the non-canonical claim view IS regenerated — the
    // assertions above do not pass vacuously on an empty record set.
    expect(writtenPaths).toContain("reports/race-conclusion.md");
  });
});
