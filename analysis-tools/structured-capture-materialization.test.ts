/**
 * Golden tests for deterministic compatibility-view materialization.
 *
 * Contract under test (`engram-coach-materialization.ts`):
 *   - `materialize(appliedPlan, tools)` regenerates every compatibility view
 *     from active records alone, byte-identically regardless of input record
 *     order, reporting written/unchanged/stale outcomes without throwing past
 *     a single artifact failure.
 *   - Every generated file starts with its exact non-authoritative warning
 *     header; imported legacy Markdown is preserved verbatim after it.
 *
 * Golden fixtures live in `fixtures/structured-capture/materialized/`; the
 * synthetic record corpus they render from lives in
 * `materialization-test-support.ts` (shared with the fixture generator).
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { KnowledgeRecord } from "@isparling/engram-harness/knowledge-types";
import type { AppliedCapturePlan, MaterializationResult } from "../engram-coach-capture-types.ts";
import { materialize } from "../engram-coach-materialization.ts";
import {
  APPLIED_AT,
  BUILD_GOAL,
  TEST_CONFIG,
  buildRecords,
  makeRecord,
} from "./materialization-test-support.ts";

type ReplaceRequest = { root: string; relativePath: string; content: string };

/** Fake host mechanics: an in-memory artifact store seeded like a real disk. */
class FakeTools {
  readonly calls: ReplaceRequest[] = [];
  readonly store = new Map<string, string>();
  failPaths = new Set<string>();
  records: KnowledgeRecord[] = [];
  readonly appliedAt = APPLIED_AT;

  constructor(
    readonly projectRoot: string,
    existing: Readonly<Record<string, string>> = {},
  ) {
    for (const [path, content] of Object.entries(existing)) this.store.set(path, content);
  }

  async listRecords(): Promise<KnowledgeRecord[]> {
    return [...this.records];
  }

  async replaceArtifact(request: ReplaceRequest) {
    this.calls.push(request);
    if (this.failPaths.has(request.relativePath)) {
      throw new Error(`simulated write failure for ${request.relativePath}`);
    }
    const key = `${request.root}/${request.relativePath}`;
    if (this.store.get(key) === request.content) {
      return { status: "unchanged" as const, path: request.relativePath };
    }
    this.store.set(key, request.content);
    return { status: "replaced" as const, path: request.relativePath };
  }

  contentsByRelativePath(): Map<string, string> {
    return new Map(this.calls.map((call) => [call.relativePath, call.content]));
  }
}

const FIXTURE_DIR = join(import.meta.dirname, "fixtures", "structured-capture", "materialized");

const GOLDEN_BY_RELATIVE_PATH: Record<string, string> = {
  "build.yaml": "blocks/build_1.yaml",
  "base.yaml": "blocks/base.yaml",
  "consultations.md": "consultations.md",
  "adaptation.md": "adaptation.md",
  "monitoring.md": "monitoring.md",
  "doctor-prep.md": "doctor-prep.md",
};

describe("materialize", () => {
  function toolsFor(records: KnowledgeRecord[], existing: Readonly<Record<string, string>> = {}) {
    const tools = new FakeTools("/proj", existing);
    tools.records = records;
    return tools;
  }

  async function readFixture(name: string): Promise<string> {
    return readFile(join(FIXTURE_DIR, name), "utf8");
  }

  const plan: AppliedCapturePlan = { planHash: "plan-hash-1", mutations: [] };
  const options = { config: TEST_CONFIG };

  it("renders byte-identical views regardless of record order", async () => {
    const forwardTools = toolsFor(buildRecords());
    const reverseTools = toolsFor([...buildRecords()].reverse());
    const forwardResult = await materialize(plan, forwardTools, options);
    const reverseResult = await materialize(plan, reverseTools, options);
    expect(forwardResult.stale).toEqual([]);
    expect(reverseResult.stale).toEqual([]);

    const forwardContents = forwardTools.contentsByRelativePath();
    expect(forwardContents).toEqual(reverseTools.contentsByRelativePath());
    expect(new Set(forwardContents.keys())).toEqual(new Set(Object.values(GOLDEN_BY_RELATIVE_PATH)));

    // Durable workout identity survives materialization; the retired prior
    // state for workout-7f8c never leaks into the view.
    const buildYaml = forwardContents.get("blocks/build_1.yaml");
    expect(buildYaml).toContain("session_id: workout-7f8c");
    expect(buildYaml).toContain("session_id: workout-a91d");
    expect(buildYaml).not.toContain("workout-7f8c-old");
    expect(buildYaml).not.toContain("W3_Old");

    // Golden byte comparison against the checked-in fixtures: any renderer
    // change that alters output fails here, for both input orderings.
    for (const [fixtureName, relativePath] of Object.entries(GOLDEN_BY_RELATIVE_PATH)) {
      const fixture = await readFixture(fixtureName);
      expect(forwardContents.get(relativePath)).toBe(fixture);
      expect(reverseTools.contentsByRelativePath().get(relativePath)).toBe(fixture);
    }
  });

  it("starts every generated file with its non-authoritative header and ends with one LF", async () => {
    const tools = toolsFor(buildRecords());
    await materialize(plan, tools, options);
    for (const call of tools.calls) {
      expect(call.content.endsWith("\n")).toBe(true);
      if (call.relativePath.endsWith(".yaml")) {
        expect(call.content.startsWith("# GENERATED FROM ENGRAM ACTIVE RECORDS. DO NOT EDIT DIRECTLY.\n")).toBe(true);
      } else {
        expect(call.content.startsWith("<!-- GENERATED FROM ENGRAM ACTIVE RECORDS. DO NOT EDIT DIRECTLY. -->\n")).toBe(true);
      }
    }
  });

  it("reports changed vs unchanged artifacts and is idempotent on retry", async () => {
    const first = toolsFor(buildRecords());
    const firstResult = await materialize(plan, first, options);
    expect(firstResult.stale).toEqual([]);
    expect(firstResult.unchanged).toEqual([]);
    expect(new Set(firstResult.written.map((w) => w.path))).toEqual(
      new Set(Object.values(GOLDEN_BY_RELATIVE_PATH)),
    );

    const store: Record<string, string> = {};
    for (const call of first.calls) store[`${call.root}/${call.relativePath}`] = call.content;
    const retry = toolsFor(buildRecords(), store);
    const retryResult = await materialize(plan, retry, options);
    expect(retryResult.written).toEqual([]);
    expect(retryResult.stale).toEqual([]);
    expect(new Set(retryResult.unchanged.map((u) => u.path))).toEqual(
      new Set(firstResult.written.map((w) => w.path)),
    );
    const firstByPath = first.contentsByRelativePath();
    for (const [relativePath, content] of retry.contentsByRelativePath()) {
      expect(content).toBe(firstByPath.get(relativePath));
    }
  });

  it("continues past one failing artifact and reports it as stale", async () => {
    const tools = toolsFor(buildRecords());
    tools.failPaths = new Set(["consultations.md"]);
    const result: MaterializationResult = await materialize(plan, tools, options);
    expect(result.written.map((w) => w.path).sort()).toEqual([
      "adaptation.md",
      "blocks/base.yaml",
      "blocks/build_1.yaml",
      "doctor-prep.md",
      "monitoring.md",
    ]);
    expect(result.stale).toEqual([
      { path: "consultations.md", reason: "simulated write failure for consultations.md" },
    ]);

    // Successful retry writes only the previously stale view, byte-identical
    // to a clean run, and reapplies nothing else.
    tools.failPaths = new Set();
    const retried = await materialize(plan, tools, options);
    expect(retried.stale).toEqual([]);
    expect(retried.written.map((w) => w.path)).toEqual(["consultations.md"]);
    expect(retried.unchanged.length).toBe(5);
    const cleanContents = toolsFor(buildRecords());
    await materialize(plan, cleanContents, options);
    const consultationsClean = cleanContents
      .contentsByRelativePath()
      .get("consultations.md");
    const consultationsRetried = tools.calls.findLast((c) => c.relativePath === "consultations.md");
    expect(consultationsRetried.content).toBe(consultationsClean);
  });

  it("reports inconsistent prescription metadata as stale instead of picking silently", async () => {
    const conflicting = buildRecords().map((record) =>
      record.details.sourceId === "s-set-goal:1:explicit:1"
        ? makeRecord({
            role: "state",
            entityType: "prescription",
            effectiveAt: "2026-08-18T00:00:00Z",
            sourceId: "s-conflict:1:explicit:0",
            artifactKind: "prescription",
            relativePath: "blocks/build_1.yaml",
            value: {
              blockName: "build_2",
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
          })
        : record,
    );
    const result = await materialize(plan, toolsFor(conflicting), options);
    expect(result.stale).toEqual([
      {
        path: "blocks/build_1.yaml",
        reason: "inconsistent blockName across active records for blocks/build_1.yaml",
      },
    ]);
  });

  it("preserves the durable session_id when a session is rescheduled", async () => {
    // Same canonical session identity, entirely different mutable attributes:
    // new week, day, date, and title. The generated YAML must still carry the
    // original session_id exactly once.
    const rescheduled = buildRecords().map((record) =>
      record.details.sourceId === "s-set-goal:1:explicit:0"
        ? makeRecord({
            role: "state",
            entityType: "prescription",
            effectiveAt: "2026-08-19T00:00:00Z",
            sourceId: "s-reschedule:1:explicit:0",
            artifactKind: "prescription",
            relativePath: "blocks/build_1.yaml",
            value: {
              blockName: "build_1",
              goal: BUILD_GOAL,
              order: 1,
              sessionId: "workout-7f8c",
              week: 4,
              day: "Fri",
              sessionDate: "2026-09-04",
              sessionName: "W4_SubLT2_Moved",
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
                },
              ],
            },
          })
        : record,
    );
    const tools = toolsFor(rescheduled);
    const result = await materialize(plan, tools, options);
    expect(result.stale).toEqual([]);
    const yaml = tools.contentsByRelativePath().get("blocks/build_1.yaml") ?? "";
    expect(yaml.split("\n").filter((line) => line.includes("session_id: workout-7f8c"))).toEqual([
      "  - session_id: workout-7f8c",
    ]);
    expect(yaml).toContain("week: 4");
    expect(yaml).toContain("day: Fri");
    expect(yaml).toContain("session_date: 2026-09-04");
    expect(yaml).toContain("session_name: W4_SubLT2_Moved");
    expect(yaml).not.toContain("W3_SubLT2");
    expect(yaml).not.toContain("2026-08-27");
  });

  it("orders chronological events by effectiveAt, then sourceId, then record id", async () => {
    const event = {
      role: "event",
      entityType: "consultation",
      artifactKind: "consultation",
      relativePath: "consultations.md",
    } as const;
    const latest = makeRecord({
      ...event,
      effectiveAt: "2026-08-05T10:00:00Z",
      sourceId: "s-bravo:1:explicit:0",
      value: { summary: "rendered last despite being inserted first" },
    });
    const earliest = makeRecord({
      ...event,
      effectiveAt: "2026-08-01T10:00:00Z",
      sourceId: "s-charlie:1:explicit:0",
      value: { summary: "rendered first despite being inserted second" },
    });
    // Same effectiveAt and sourceId as its sibling below; the record id is the
    // final tie-break, and this record's id is forced lexicographically larger.
    const tiedLargeId = {
      ...makeRecord({
        ...event,
        effectiveAt: "2026-08-03T10:00:00Z",
        sourceId: "s-alpha:1:explicit:0",
        value: { summary: "tied pair, larger record id" },
      }),
      id: "rec-zzz",
    };
    const tiedSmallId = makeRecord({
      ...event,
      effectiveAt: "2026-08-03T10:00:00Z",
      sourceId: "s-alpha:1:explicit:0",
      value: { summary: "tied pair, smaller record id" },
    });
    // Insertion order contradicts every level of the sort key.
    const tools = toolsFor([latest, earliest, tiedLargeId, tiedSmallId]);
    const result = await materialize(plan, tools, options);
    expect(result.stale).toEqual([]);
    const content = tools.contentsByRelativePath().get("consultations.md") ?? "";
    expect(content.split("\n").filter((line) => line.startsWith("## "))).toEqual([
      "## 2026-08-01T10:00:00Z — s-charlie:1:explicit:0",
      "## 2026-08-03T10:00:00Z — s-alpha:1:explicit:0",
      "## 2026-08-03T10:00:00Z — s-alpha:1:explicit:0",
      "## 2026-08-05T10:00:00Z — s-bravo:1:explicit:0",
    ]);
    expect(content.indexOf("rendered first despite being inserted second")).toBeLessThan(
      content.indexOf("tied pair, smaller record id"),
    );
    expect(content.indexOf("tied pair, smaller record id")).toBeLessThan(
      content.indexOf("tied pair, larger record id"),
    );
    expect(content.indexOf("tied pair, larger record id")).toBeLessThan(
      content.indexOf("rendered last despite being inserted first"),
    );
  });

  it("excludes candidate, retired, and not-yet-effective records from every view", async () => {
    const poisoned = [
      ...buildRecords(),
      makeRecord({
        role: "state",
        entityType: "prescription",
        effectiveAt: "2026-08-18T00:00:00Z",
        sourceId: "s-candidate-state:1:explicit:0",
        status: "candidate",
        artifactKind: "prescription",
        relativePath: "blocks/build_1.yaml",
        value: {
          blockName: "build_1",
          goal: BUILD_GOAL,
          order: 7,
          sessionId: "workout-candidate-marker",
          week: 5,
          day: "Mon",
          sessionDate: "2026-09-07",
          sessionName: "W5_Candidate",
        },
      }),
      makeRecord({
        role: "event",
        entityType: "consultation",
        effectiveAt: "2026-08-18T09:00:00Z",
        sourceId: "s-candidate-event:1:explicit:0",
        status: "candidate",
        artifactKind: "consultation",
        relativePath: "consultations.md",
        value: { summary: "CANDIDATE-CONSULTATION-MARKER" },
      }),
      makeRecord({
        role: "event",
        entityType: "monitoring-capture",
        effectiveAt: "2026-08-17T08:00:00Z",
        sourceId: "s-retired-monitor:1:explicit:0",
        status: "retired",
        artifactKind: "monitoring",
        relativePath: "monitoring.md",
        value: {
          concernId: "retired-concern-marker",
          signal: "soreness",
          status: "watch",
          note: "RETIRED-MONITORING-MARKER",
        },
      }),
      makeRecord({
        role: "event",
        entityType: "workout-adaptation",
        effectiveAt: "2026-09-20T08:00:00Z",
        sourceId: "s-future-adapt:1:explicit:0",
        artifactKind: "adaptation",
        relativePath: "adaptation.md",
        value: { title: "FUTURE-ADAPTATION-MARKER", summary: "not yet effective" },
      }),
    ];
    const tools = toolsFor(poisoned);
    const result = await materialize(plan, tools, options);
    expect(result.stale).toEqual([]);
    expect(tools.contentsByRelativePath().size).toBeGreaterThan(0);
    for (const content of tools.contentsByRelativePath().values()) {
      expect(content).not.toContain("workout-candidate-marker");
      expect(content).not.toContain("CANDIDATE-CONSULTATION-MARKER");
      expect(content).not.toContain("retired-concern-marker");
      expect(content).not.toContain("RETIRED-MONITORING-MARKER");
      expect(content).not.toContain("FUTURE-ADAPTATION-MARKER");
    }
  });

  it("groups records by artifact relativePath: separate paths split, shared paths merge", async () => {
    const session = (order: number, sessionId: string, sessionName: string) =>
      makeRecord({
        role: "state",
        entityType: "prescription",
        effectiveAt: "2026-08-18T00:00:00Z",
        sourceId: `s-merge:${order}:explicit:0`,
        artifactKind: "prescription",
        relativePath: "blocks/merge.yaml",
        value: {
          blockName: "merge_block",
          order,
          sessionId,
          week: 1,
          day: "Tue",
          sessionDate: "2026-08-25",
          sessionName,
          totalDurationMin: 90,
        },
      });
    const consultation = (relativePath: string, sourceId: string, summary: string) =>
      makeRecord({
        role: "event",
        entityType: "consultation",
        effectiveAt: "2026-08-02T09:00:00Z",
        sourceId,
        artifactKind: "consultation",
        relativePath,
        value: { summary },
      });
    // Insertion deliberately interleaves groups and reverses session order.
    const tools = toolsFor([
      session(2, "workout-merge-b", "W1_MergeB"),
      consultation("consultations-a.md", "s-split-a:1:explicit:0", "Alpha path event"),
      session(1, "workout-merge-a", "W1_MergeA"),
      consultation("consultations-b.md", "s-split-b:1:explicit:0", "Beta path event"),
    ]);
    const result = await materialize(plan, tools, options);
    expect(result.stale).toEqual([]);
    expect(new Set(result.written.map((written) => written.path))).toEqual(
      new Set(["blocks/merge.yaml", "consultations-a.md", "consultations-b.md"]),
    );
    const contents = tools.contentsByRelativePath();
    const merged = contents.get("blocks/merge.yaml") ?? "";
    // Records sharing one relativePath render into a single artifact, sessions
    // sorted by `order` regardless of record insertion order.
    expect(merged.split("\n").filter((line) => line.includes("session_id:"))).toEqual([
      "  - session_id: workout-merge-a",
      "  - session_id: workout-merge-b",
    ]);
    // Different relativePaths produce independent artifacts holding only their
    // own records.
    expect(contents.get("consultations-a.md") ?? "").toContain("Alpha path event");
    expect(contents.get("consultations-a.md") ?? "").not.toContain("Beta path event");
    expect(contents.get("consultations-b.md") ?? "").toContain("Beta path event");
    expect(contents.get("consultations-b.md") ?? "").not.toContain("Alpha path event");
  });

  it("preserves imported legacyMarkdown verbatim immediately after the warning header", async () => {
    const legacy = [
      "### Imported heading",
      "",
      "Body line one.",
      "Line two with *emphasis* and an em—dash.",
      "  - preserved indentation",
    ].join("\n");
    const tools = toolsFor([
      makeRecord({
        role: "event",
        entityType: "consultation",
        effectiveAt: "2026-08-01T09:00:00Z",
        sourceId: "s-legacy:1:explicit:0",
        artifactKind: "consultation",
        relativePath: "consultations.md",
        value: { legacyMarkdown: legacy },
      }),
    ]);
    const result = await materialize(plan, tools, options);
    expect(result.stale).toEqual([]);
    expect(tools.contentsByRelativePath().get("consultations.md")).toBe(
      "<!-- GENERATED FROM ENGRAM ACTIVE RECORDS. DO NOT EDIT DIRECTLY. -->\n" +
        "# Consultations\n\n" +
        "## 2026-08-01T09:00:00Z — s-legacy:1:explicit:0\n\n" +
        legacy +
        "\n",
    );
  });

  it("keeps the production two-argument materialize signature", () => {
    // The extension calls `materialize(appliedPlan, tools)` with exactly two
    // arguments. `Function.length` stops at the first parameter with a
    // default, so the test-only injected-config `options` must stay optional:
    // making it required would raise this to 3 and fail here.
    expect(materialize.length).toBe(2);
  });
});
