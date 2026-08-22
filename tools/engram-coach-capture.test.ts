import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TurnContext } from "@isparling/engram-harness/knowledge-types";
import { afterEach, describe, expect, it } from "vitest";
import { parseKnowledgeRecord } from "../../engram/harness/src/knowledgeRecord.ts";
import * as packModule from "../engram-coach-pack.ts";
import { engramCoachPresentation } from "../engram-coach-presentation.ts";

type CaptureTools = {
  recordsRoot: string;
  spaceId: string;
  writeFile(path: string, content: string): Promise<void>;
  refreshIndex(): Promise<void>;
};

type CaptureResult = {
  created: string[];
  existing: string[];
  invalid: Array<{ id: string; errors: string[] }>;
};

type CaptureHandler = (turn: TurnContext, tools: CaptureTools) => Promise<CaptureResult>;

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function requireCaptureHandler(): CaptureHandler {
  const handler = Reflect.get(packModule, "captureFromTurn") as unknown;
  if (typeof handler !== "function") throw new Error("engram-coach pack does not export captureFromTurn");
  return handler as CaptureHandler;
}

async function captureFixture() {
  const root = await mkdtemp(join(tmpdir(), "engram-coach-capture-"));
  temporaryRoots.push(root);
  const refreshes: string[] = [];
  const turn: TurnContext = {
    session: { id: "omp-session", host: "omp" },
    timestamp: "2026-08-22T12:34:56Z",
    turnIndex: 3,
    narrative: "User: I think we should modify Thursday's workout prescription because power faded 12% on the last interval.\nAssistant: acknowledged.",
    toolCalls: [],
  };
  const tools: CaptureTools = {
    recordsRoot: root,
    spaceId: "training",
    writeFile: (path, content) => writeFile(path, content, { flag: "wx" }),
    refreshIndex: async () => {
      refreshes.push("refresh");
    },
  };
  return { root, refreshes, tools, turn };
}

describe("engram-coach pack capture handler", () => {
  it("exports captureFromTurn from the extraction pack module", () => {
    expect(Reflect.get(packModule, "captureFromTurn")).toBeTypeOf("function");
  });

  it("creates a parseable candidate draft and refreshes the index once", async () => {
    const fixture = await captureFixture();
    const result = await requireCaptureHandler()(fixture.turn, fixture.tools);

    expect(result.created).toHaveLength(1);
    expect(result.existing).toEqual([]);
    expect(result.invalid).toEqual([]);
    expect(fixture.refreshes).toEqual(["refresh"]);

    const draftPath = join(fixture.root, `${result.created[0]}.md`);
    const parsed = parseKnowledgeRecord(await readFile(draftPath, "utf8"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.status).toBe("candidate");
    expect(parsed.value.statement).not.toContain("\n");
    expect(parsed.value.scope.space).toBe("training");
    expect(parsed.value.pack).toEqual({ id: "engram-coach", version: "0.1.0" });
    expect(parsed.value.submittedAt).toBe("2026-08-22");
    expect(engramCoachPresentation.retrievalPolicy.isEligible(parsed.value)).toBe(false);
    expect(engramCoachPresentation.retrievalPolicy.isEligible({
      ...parsed.value,
      status: "active",
    })).toBe(true);
  });
  it("does not overwrite an existing draft and retries index refresh", async () => {
    const fixture = await captureFixture();
    const capture = requireCaptureHandler();
    const first = await capture(fixture.turn, fixture.tools);
    const draftPath = join(fixture.root, `${first.created[0]}.md`);
    const original = await readFile(draftPath, "utf8");

    const second = await capture(fixture.turn, fixture.tools);
    expect(second.created).toEqual([]);
    expect(second.existing).toEqual(first.created);
    expect(fixture.refreshes).toEqual(["refresh", "refresh"]);
    expect(await readFile(draftPath, "utf8")).toBe(original);
  });
});
