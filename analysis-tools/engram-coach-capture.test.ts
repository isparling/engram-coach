/**
 * Ambient capture contract: LLM-only extraction, one repair attempt, and
 * candidate-only persistence.
 *
 * There is no deterministic fallback. Every failure path asserted here must
 * produce zero writes and zero index refreshes — a broken extraction model
 * degrades to a warning, never to a keyword-derived transcript excerpt.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TurnContext, TurnToolCall } from "@isparling/engram-harness/knowledge-types";
import type { CompletionRequest } from "@isparling/engram-harness/capture-types";
import { afterEach, describe, expect, it } from "vitest";
import { parseKnowledgeRecord } from "../../engram/harness/src/knowledgeRecord.ts";
import * as packModule from "../engram-coach-pack.ts";
import { engramCoachPresentation } from "../engram-coach-presentation.ts";

type CaptureTools = {
  recordsRoot: string;
  spaceId: string;
  projectRoot: string;
  writeFile(path: string, content: string): Promise<void>;
  refreshIndex(): Promise<void>;
  complete(request: CompletionRequest): Promise<string>;
};

type CaptureResult = {
  created: string[];
  existing: string[];
  invalid: Array<{ id: string; errors: string[] }>;
  warnings: string[];
};

type CaptureHandler = (turn: TurnContext, tools: CaptureTools) => Promise<CaptureResult>;

const CAPTURE_MODEL = "synthetic/capture-model";
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function requireCaptureHandler(): CaptureHandler {
  const handler = Reflect.get(packModule, "captureFromTurn") as unknown;
  if (typeof handler !== "function") throw new Error("engram-coach pack does not export captureFromTurn");
  return handler as CaptureHandler;
}

function validResponse(statement = "Thursday's prescription drops to 3x8 at 285 W after a 12% final-interval fade."): string {
  return JSON.stringify({
    candidates: [
      {
        kind: "decision",
        statement,
        entity_type: "workout-adaptation",
        keyed_entity_type: "workout",
        key_components: { session_id: "workout-7f8c" },
        effective_at: "2026-08-20",
        subjects: [],
        topics: [],
      },
    ],
  });
}

type FixtureOptions = {
  responses?: string[];
  failWith?: Error;
  failOnCall?: number;
  toolCalls?: TurnToolCall[];
  maxCandidatesPerTurn?: number;
  captureModel?: string | null;
};

/**
 * Build a synthetic project root carrying a real `.engram-coach/config.json`,
 * so config resolution runs for real rather than being stubbed.
 */
async function captureFixture(options: FixtureOptions = {}) {
  const root = await mkdtemp(join(tmpdir(), "engram-coach-capture-"));
  temporaryRoots.push(root);
  const recordsRoot = join(root, "records");
  const projectRoot = join(root, "project");
  await mkdir(recordsRoot, { recursive: true });
  await mkdir(join(projectRoot, ".engram-coach"), { recursive: true });

  const captureBlock = options.captureModel === null
    ? {}
    : {
        capture: {
          model: options.captureModel ?? CAPTURE_MODEL,
          timeout_seconds: 60,
          max_candidates_per_turn: options.maxCandidatesPerTurn ?? 3,
        },
      };
  await writeFile(
    join(projectRoot, ".engram-coach", "config.json"),
    JSON.stringify({
      active_profile: "endurance",
      profiles: {
        endurance: { coaching_docs_dir: "coaching", prescriptions_dir: "prescriptions" },
      },
      ...captureBlock,
    }),
    "utf8",
  );

  const refreshes: string[] = [];
  const completionRequests: CompletionRequest[] = [];
  const responses = [...(options.responses ?? [validResponse()])];

  const turn: TurnContext = {
    session: { id: "omp-session", host: "omp" },
    timestamp: "2026-08-22T12:34:56Z",
    turnIndex: 3,
    narrative: "Thursday's intervals faded 12% on the last rep; I want the prescription eased.",
    toolCalls: options.toolCalls ?? [],
  };

  const tools: CaptureTools = {
    recordsRoot,
    spaceId: "training",
    projectRoot,
    writeFile: (path, content) => writeFile(path, content, { flag: "wx" }),
    refreshIndex: async () => {
      refreshes.push("refresh");
    },
    complete: async (request) => {
      completionRequests.push(request);
      if (options.failWith !== undefined && completionRequests.length >= (options.failOnCall ?? 1)) {
        throw options.failWith;
      }
      const next = responses.shift();
      if (next === undefined) throw new Error("fixture ran out of scripted completions");
      return next;
    },
  };

  return { root, recordsRoot, projectRoot, refreshes, completionRequests, tools, turn };
}

describe("engram-coach pack capture handler", () => {
  it("exports captureFromTurn from the extraction pack module", () => {
    expect(Reflect.get(packModule, "captureFromTurn")).toBeTypeOf("function");
  });

  it("no longer exposes a deterministic extractor facet", () => {
    expect(Reflect.get(packModule, "engramCoachExtractor")).toBeUndefined();
    const pack = Reflect.get(packModule, "engramCoachPack") as Record<string, unknown>;
    expect(pack.extractCandidates).toBeUndefined();
  });

  it("uses the configured capture model and writes a parseable candidate draft", async () => {
    const fixture = await captureFixture();
    const result = await requireCaptureHandler()(fixture.turn, fixture.tools);

    expect(fixture.completionRequests.map((request) => request.model)).toEqual([CAPTURE_MODEL]);
    expect(fixture.completionRequests[0]?.timeoutSeconds).toBe(60);
    expect(result.created).toHaveLength(1);
    expect(result.invalid).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(fixture.refreshes).toEqual(["refresh"]);

    const draftPath = join(fixture.recordsRoot, `${result.created[0]}.md`);
    const parsed = parseKnowledgeRecord(await readFile(draftPath, "utf8"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.status).toBe("candidate");
    expect(parsed.value.disposition).toBe("new");
    expect(parsed.value.relationships).toEqual({
      supports: [],
      contradicts: [],
      refines: [],
      supersedes: [],
    });
    expect(parsed.value.statement).not.toContain("\n");
    expect(parsed.value.details.entityKey).toBe("workout:workout-7f8c");
    expect(parsed.value.sources.map((source) => source.ref)).toEqual([
      "session:omp-session/turn:3",
      `llm-inference:${CAPTURE_MODEL}`,
    ]);
    // A candidate never participates in normal recall; the same record does
    // once it is reviewed and activated.
    expect(engramCoachPresentation.retrievalPolicy.isEligible(parsed.value)).toBe(false);
    expect(engramCoachPresentation.retrievalPolicy.isEligible({
      ...parsed.value,
      status: "active",
    })).toBe(true);
  });

  it("caps the candidate count at the configured maximum", async () => {
    const many = JSON.stringify({
      candidates: [1, 2, 3, 4, 5].map((n) => ({
        kind: "claim",
        statement: `Ambient observation number ${n}.`,
        entity_type: "session-execution",
        keyed_entity_type: null,
        key_components: {},
        effective_at: null,
        subjects: [],
        topics: [],
      })),
    });
    const fixture = await captureFixture({ responses: [many], maxCandidatesPerTurn: 2 });
    const result = await requireCaptureHandler()(fixture.turn, fixture.tools);

    expect(result.created).toHaveLength(2);
    expect(result.warnings).toEqual([]);
  });

  it("repairs one malformed response and then succeeds", async () => {
    const fixture = await captureFixture({
      responses: ["```json\n{\"candidates\":[]}\n```", validResponse()],
    });
    const result = await requireCaptureHandler()(fixture.turn, fixture.tools);

    expect(fixture.completionRequests.map((request) => request.model)).toEqual([
      CAPTURE_MODEL,
      CAPTURE_MODEL,
    ]);
    // The repair prompt must carry the concrete validation error back.
    expect(fixture.completionRequests[1]?.prompt).toContain("Markdown fence");
    expect(result.created).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it("gives up after a second malformed response with no writes and no refresh", async () => {
    const fixture = await captureFixture({
      responses: ["not json at all", "{\"candidates\": \"still wrong\"}"],
    });
    const result = await requireCaptureHandler()(fixture.turn, fixture.tools);

    expect(fixture.completionRequests.map((request) => request.model)).toEqual([
      CAPTURE_MODEL,
      CAPTURE_MODEL,
    ]);
    expect(result.created).toEqual([]);
    expect(result.warnings).toEqual(["ambient capture returned invalid JSON after one repair attempt"]);
    expect(fixture.refreshes).toEqual([]);
  });

  it("reports a timeout as a warning with no writes and no refresh", async () => {
    const fixture = await captureFixture({
      failWith: new Error("capture_timeout: headless completion did not finish"),
    });
    const result = await requireCaptureHandler()(fixture.turn, fixture.tools);

    expect(result.created).toEqual([]);
    expect(result.warnings).toEqual(["ambient capture timed out before completion"]);
    expect(fixture.refreshes).toEqual([]);
  });

  it("reports a cancellation as a warning with no writes and no refresh", async () => {
    const fixture = await captureFixture({
      failWith: new Error("capture_cancelled: headless completion did not finish"),
    });
    const result = await requireCaptureHandler()(fixture.turn, fixture.tools);

    expect(result.created).toEqual([]);
    expect(result.warnings).toEqual(["ambient capture was cancelled before completion"]);
    expect(fixture.refreshes).toEqual([]);
  });

  it("reports a model failure as a warning with no writes and no refresh", async () => {
    const fixture = await captureFixture({
      failWith: new Error("capture_model_failed: headless completion exited 3"),
    });
    const result = await requireCaptureHandler()(fixture.turn, fixture.tools);

    expect(result.created).toEqual([]);
    expect(result.warnings).toEqual(["ambient capture model call failed"]);
    expect(fixture.refreshes).toEqual([]);
  });

  it("treats a missing capture model as a configuration warning, not a fallback", async () => {
    const fixture = await captureFixture({ captureModel: null });
    const result = await requireCaptureHandler()(fixture.turn, fixture.tools);

    expect(fixture.completionRequests).toEqual([]);
    expect(result.created).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("ambient capture is not configured");
    expect(fixture.refreshes).toEqual([]);
  });

  it("records a binding error instead of a key when components are unusable", async () => {
    const unbound = JSON.stringify({
      candidates: [
        {
          kind: "claim",
          statement: "Some session felt harder than prescribed.",
          entity_type: "session-execution",
          keyed_entity_type: "prescription",
          key_components: { session_id: "workout-7f8c" },
          effective_at: null,
          subjects: [],
          topics: [],
        },
      ],
    });
    const fixture = await captureFixture({ responses: [unbound] });
    const result = await requireCaptureHandler()(fixture.turn, fixture.tools);

    expect(result.created).toHaveLength(1);
    const parsed = parseKnowledgeRecord(
      await readFile(join(fixture.recordsRoot, `${result.created[0]}.md`), "utf8"),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // A prescription key needs both arc_id and session_id: unbound, and so it
    // can never supersede anything automatically.
    expect(parsed.value.details.entityKey).toBeNull();
    expect(parsed.value.details.bindingError).toBeTypeOf("string");
    expect(parsed.value.status).toBe("candidate");
  });

  it("suppresses an ambient candidate whose key the explicit channel just applied", async () => {
    const fixture = await captureFixture({
      toolCalls: [
        {
          tool: "engram_capture_apply",
          input: { plan_hash: "hash-abc" },
          result: JSON.stringify({ status: "committed", entity_keys: ["workout:workout-7f8c"] }),
        },
      ],
    });
    const result = await requireCaptureHandler()(fixture.turn, fixture.tools);

    expect(result.created).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(fixture.refreshes).toEqual([]);
  });

  it("keeps unrelated candidates from a turn that also applied an explicit capture", async () => {
    const mixed = JSON.stringify({
      candidates: [
        {
          kind: "decision",
          statement: "Thursday's prescription drops to 3x8 at 285 W.",
          entity_type: "workout-adaptation",
          keyed_entity_type: "workout",
          key_components: { session_id: "workout-7f8c" },
          effective_at: "2026-08-20",
          subjects: [],
          topics: [],
        },
        {
          kind: "evidence",
          statement: "Sleep has been under six hours for four consecutive nights.",
          entity_type: "session-execution",
          keyed_entity_type: null,
          key_components: {},
          effective_at: null,
          subjects: [],
          topics: [],
        },
      ],
    });
    const fixture = await captureFixture({
      responses: [mixed],
      toolCalls: [
        {
          tool: "engram_capture_apply",
          input: { plan_hash: "hash-abc" },
          result: JSON.stringify({ status: "committed", entity_keys: ["workout:workout-7f8c"] }),
        },
      ],
    });
    const result = await requireCaptureHandler()(fixture.turn, fixture.tools);

    expect(result.created).toHaveLength(1);
    const parsed = parseKnowledgeRecord(
      await readFile(join(fixture.recordsRoot, `${result.created[0]}.md`), "utf8"),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.statement).toContain("Sleep has been under six hours");
  });

  it("does not overwrite an existing draft and refreshes again on the repeat settle", async () => {
    const fixture = await captureFixture({ responses: [validResponse(), validResponse()] });
    const capture = requireCaptureHandler();
    const first = await capture(fixture.turn, fixture.tools);
    const draftPath = join(fixture.recordsRoot, `${first.created[0]}.md`);
    const original = await readFile(draftPath, "utf8");

    const second = await capture(fixture.turn, fixture.tools);
    // Deterministic IDs make the repeat settle a no-op rather than a duplicate.
    expect(second.created).toEqual([]);
    expect(second.existing).toEqual(first.created);
    expect(fixture.refreshes).toEqual(["refresh", "refresh"]);
    expect(await readFile(draftPath, "utf8")).toBe(original);
  });
});
