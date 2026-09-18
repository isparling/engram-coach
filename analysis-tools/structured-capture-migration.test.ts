/**
 * Migration contract tests: stable ID insertion, hash-bound application,
 * idempotent re-runs, and legacy import that never duplicates.
 *
 * @module analysis-tools/structured-capture-migration
 */

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { applyKnowledgeProposal, reconcileKnowledgeTransaction } from "../../engram/harness/src/knowledgeTransaction.ts";
import { makeAlwaysSucceedsSpawnFn } from "../../engram/harness/test/fakes.ts";
import { engramCoachPack } from "../engram-coach-pack.ts";
import {
  GENERATED_MARKDOWN_HEADER,
  GENERATED_PRESCRIPTION_HEADER,
  MigrationError,
  applyBaseline,
  migrationActiveRecords,
  migratedSessionId,
  planConsultationImport,
  planLegacyImport,
  planMarkdownLogBaseline,
  planPrescriptionBaseline,
  planPrescriptionImport,
  readConsultationSources,
  scanBaseline,
} from "../engram-coach-migration.ts";
import { computeDesiredViews } from "../engram-coach-materialization.ts";
import { previewStructuredCapture } from "../engram-coach-structured-capture.ts";
import {
  createSyntheticCaptureSpace,
  testPreviewTools,
} from "./structured-capture-test-support.ts";

import type { KnowledgeEnvelope, KnowledgeRecord } from "@isparling/engram-harness/knowledge-types";
import { readdir } from "node:fs/promises";
import { dirname } from "node:path";
import { parseKnowledgeRecord } from "../../engram/harness/src/knowledgeRecord.ts";
import type {
  ReadyCapturePreview,
  StructuredChangeSet,
} from "../engram-coach-capture-types.ts";
import type { EngramCoachRuntimeConfig } from "../engram-coach-config.ts";
import { materialize, type MaterializeTools } from "../engram-coach-materialization.ts";
import type { PreviewTools } from "../engram-coach-structured-capture.ts";
import type { SyntheticCaptureSpace } from "./structured-capture-test-support.ts";

const execFileAsync = promisify(execFile);
const sha256Hex = (text: string): string => createHash("sha256").update(text).digest("hex");

const FIXTURE_DIR = new URL("./fixtures/structured-capture/migration/", import.meta.url).pathname;
const PRESCRIPTION_BEFORE = await readFile(join(FIXTURE_DIR, "prescription-before.yaml"), "utf8");
const PRESCRIPTION_WITH_IDS = await readFile(join(FIXTURE_DIR, "prescription-with-ids.yaml"), "utf8");
const CONSULTATIONS_BEFORE = await readFile(join(FIXTURE_DIR, "consultations-before.md"), "utf8");

type MigrationSandbox = {
  root: string;
  prescriptionsDir: string;
  coachingDocsDir: string;
  prescriptionPath: string;
  consultationsPath: string | null;
  destroy(): Promise<void>;
};

async function createMigrationSandbox(options: { withConsultations?: boolean } = {}): Promise<MigrationSandbox> {
  const root = await mkdtemp(join(tmpdir(), "engram-coach-migration-"));
  const prescriptionsDir = join(root, "prescriptions");
  const coachingDocsDir = join(root, "docs");
  await mkdir(join(coachingDocsDir, "coaching"), { recursive: true });
  await mkdir(prescriptionsDir, { recursive: true });
  const prescriptionPath = join(prescriptionsDir, "base.yaml");
  const consultationsPath =
    options.withConsultations === false ? null : join(coachingDocsDir, "coaching", "consultations.md");
  await writeFile(prescriptionPath, PRESCRIPTION_BEFORE, "utf8");
  if (consultationsPath !== null) await writeFile(consultationsPath, CONSULTATIONS_BEFORE, "utf8");
  return {
    root,
    prescriptionsDir,
    coachingDocsDir,
    prescriptionPath,
    consultationsPath,
    destroy: () => rm(root, { recursive: true, force: true }),
  };
}

function sandboxRoots(sandbox: MigrationSandbox) {
  return { prescriptionsDir: sandbox.prescriptionsDir, coachingDocsDir: sandbox.coachingDocsDir };
}

describe("prescription baseline planning", () => {
  it("assigns deterministic session IDs, preserves existing IDs, adds the header exactly once, and matches the normalized fixture", () => {
    const plan = planPrescriptionBaseline("base.yaml", PRESCRIPTION_BEFORE);
    expect(plan.changed).toBe(true);
    expect(migratedSessionId("base.yaml", 0)).toBe("workout-4837f280b29eb03e");
    expect(migratedSessionId("base.yaml", 2)).toBe("workout-c25cb37dc7e7e8e2");
    // Existing IDs are preserved verbatim; derived ones inserted only where missing.
    expect(plan.afterText).toContain("session_id: workout-base-intervals");
    expect(plan.afterText).toBe(PRESCRIPTION_WITH_IDS);
    expect(plan.beforeHash).not.toBe(plan.afterHash);
  });

  it("is a no-op on already-normalized input", () => {
    const plan = planPrescriptionBaseline("base.yaml", PRESCRIPTION_WITH_IDS);
    expect(plan.changed).toBe(false);
    expect(plan.afterText).toBe(PRESCRIPTION_WITH_IDS);
    expect(plan.beforeHash).toBe(plan.afterHash);
  });

  it("fails hard on duplicate existing session IDs instead of renaming silently", () => {
    const duplicated = PRESCRIPTION_BEFORE.replace(
      "session_name: W2_Easy",
      "session_id: workout-base-intervals\n    session_name: W2_Easy",
    );
    expect(() => planPrescriptionBaseline("base.yaml", duplicated)).toThrow(MigrationError);
  });

  it("fails hard on a keyless session entry even when an explicit ID and a valid week anchor exist", () => {
    const malformed = [
      "block_name: Base",
      "sessions:",
      "  - session_id: workout-existing",
      "    :",
      "      note: broken",
      "    week: 1",
      "    session_date: 2026-07-08",
      "",
    ].join("\n");
    expect(() => planPrescriptionBaseline("base.yaml", malformed)).toThrow(
      /base\.yaml: session 0 has a malformed entry with no key/,
    );
  });

  it("leaves dates, content, and comments untouched apart from inserted IDs and the header", () => {
    const plan = planPrescriptionBaseline("base.yaml", PRESCRIPTION_BEFORE);
    const body = plan.afterText.replace(GENERATED_PRESCRIPTION_HEADER, "");
    // Every comment survives byte-for-byte.
    for (const comment of PRESCRIPTION_BEFORE.split("\n").filter((line) => line.trimStart().startsWith("#"))) {
      expect(body.split("\n")).toContain(comment);
    }
    // Dates and training content are unchanged.
    for (const field of ["session_date: 2026-07-08", "session_date: 2026-07-11", "session_date: 2026-07-15"]) {
      expect(body).toContain(field);
    }
    expect(body).toContain("recovery_power_high_pct: 55");
    // Derived IDs are inserted exactly once each, immediately before week.
    expect(body.match(/session_id: workout-4837f280b29eb03e/g)).toHaveLength(1);
    expect(body.match(/session_id: workout-c25cb37dc7e7e8e2/g)).toHaveLength(1);
    expect(body.indexOf("session_id: workout-4837f280b29eb03e")).toBeLessThan(body.indexOf("week: 1"));
  });
});

describe("markdown log baseline planning", () => {
  it("adds the warning header exactly once and preserves every other byte", () => {
    const plan = planMarkdownLogBaseline("coaching/consultations.md", CONSULTATIONS_BEFORE);
    expect(plan.changed).toBe(true);
    expect(plan.afterText.startsWith(GENERATED_MARKDOWN_HEADER)).toBe(true);
    expect(CONSULTATIONS_BEFORE.startsWith(GENERATED_MARKDOWN_HEADER)).toBe(false);

    const second = planMarkdownLogBaseline("coaching/consultations.md", plan.afterText);
    expect(second.changed).toBe(false);
    expect(second.afterText).toBe(plan.afterText);
    expect(second.afterText.split(GENERATED_MARKDOWN_HEADER).length - 1).toBe(1);
  });
});

describe("hash-bound baseline application", () => {
  it("applies only planned changes and is byte-identical on a second full pass", async () => {
    const sandbox = await createMigrationSandbox();
    try {
      const firstScan = await scanBaseline(sandboxRoots(sandbox));
      const outcome = await applyBaseline(firstScan, firstScan.afterHash);
      expect(outcome.written.map((entry) => entry.relativePath)).toEqual([
        "base.yaml",
        "coaching/consultations.md",
      ]);
      expect(await readFile(sandbox.prescriptionPath, "utf8")).toBe(PRESCRIPTION_WITH_IDS);

      // Second full pass: nothing left to change, aggregate hash stable.
      const secondScan = await scanBaseline(sandboxRoots(sandbox));
      expect(secondScan.afterHash).toBe(firstScan.afterHash);
      expect(secondScan.files.every((entry) => !entry.plan.changed)).toBe(true);
      const secondOutcome = await applyBaseline(secondScan, secondScan.afterHash);
      expect(secondOutcome.written).toEqual([]);
      expect(await readFile(sandbox.prescriptionPath, "utf8")).toBe(PRESCRIPTION_WITH_IDS);
    } finally {
      await sandbox.destroy();
    }
  });

  it("discovers every nested consultation log in deterministic relative-path order", async () => {
    const sandbox = await createMigrationSandbox({ withConsultations: false });
    try {
      const relativePaths = [
        "2026/transition/consultations.md",
        "2026/base/consultations.md",
        "2026/Zeta/consultations.md",
        "2026/alpha/consultations.md",
      ];
      for (const relativePath of relativePaths) {
        const absolutePath = join(sandbox.coachingDocsDir, relativePath);
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, CONSULTATIONS_BEFORE, "utf8");
      }

      const scan = await scanBaseline(sandboxRoots(sandbox));
      expect(
        scan.files
          .filter((entry) => entry.rootKind === "coaching-docs")
          .map((entry) => entry.plan.relativePath),
      ).toEqual([
        "2026/Zeta/consultations.md",
        "2026/alpha/consultations.md",
        "2026/base/consultations.md",
        "2026/transition/consultations.md",
      ]);
    } finally {
      await sandbox.destroy();
    }
  });

  it("propagates traversal errors instead of silently omitting a subtree", async () => {
    const sandbox = await createMigrationSandbox({ withConsultations: false });
    try {
      const notDirectory = join(sandbox.root, "not-a-directory");
      await writeFile(notDirectory, "content", "utf8");
      await expect(readConsultationSources(notDirectory)).rejects.toMatchObject({
        code: "ENOTDIR",
      });
    } finally {
      await sandbox.destroy();
    }
  });

  it("gives registry-declared monitoring artifacts precedence over filename discovery", async () => {
    const sandbox = await createMigrationSandbox({ withConsultations: false });
    try {
      const relativePath = "monitoring/consultations.md";
      const absolutePath = join(sandbox.coachingDocsDir, relativePath);
      const registryPath = join(sandbox.coachingDocsDir, "tracking", "concerns.yaml");
      await mkdir(dirname(absolutePath), { recursive: true });
      await mkdir(dirname(registryPath), { recursive: true });
      await writeFile(absolutePath, CONSULTATIONS_BEFORE, "utf8");
      await writeFile(
        registryPath,
        [
          "concerns:",
          "  - id: overlap",
          "    active: true",
          `    log: ${relativePath}`,
          "",
        ].join("\n"),
        "utf8",
      );

      const scan = await scanBaseline(sandboxRoots(sandbox));
      expect(
        scan.files.filter((entry) => entry.plan.relativePath === relativePath),
      ).toHaveLength(1);
    } finally {
      await sandbox.destroy();
    }
  });

  it("refuses to apply when the presented after-hash does not match the scan", async () => {
    const sandbox = await createMigrationSandbox();
    try {
      const scan = await scanBaseline(sandboxRoots(sandbox));
      await expect(applyBaseline(scan, "deadbeef")).rejects.toThrow(MigrationError);
    } finally {
      await sandbox.destroy();
    }
  });

  it("refuses to apply a plan whose afterText no longer matches its own afterHash", async () => {
    const sandbox = await createMigrationSandbox();
    try {
      const scan = await scanBaseline(sandboxRoots(sandbox));
      const forged = JSON.parse(JSON.stringify(scan)) as typeof scan;
      const target = forged.files.find((entry) => entry.rootKind === "prescriptions");
      if (target === undefined) throw new Error("no prescription entry in scan");
      target.plan.afterText = target.plan.afterText.replace("total_duration_min: 90", "total_duration_min: 999");
      // Hashes left untouched — the doctored text must be caught.
      await expect(applyBaseline(forged, forged.afterHash)).rejects.toThrow(/does not match its own afterHash/);
    } finally {
      await sandbox.destroy();
    }
  });


  it("invalidates --expect when the scan's roots were changed", async () => {
    const sandbox = await createMigrationSandbox();
    try {
      const scan = await scanBaseline(sandboxRoots(sandbox));
      const moved = { ...sandboxRoots(sandbox), coachingDocsDir: join(sandbox.root, "elsewhere") };
      // Applying a plan whose roots were rewritten to another location must
      // not pass silently: expect still matches the plan hash, but the
      // relocated root lacks the scanned files, so drift refusal fires.
      await expect(applyBaseline({ ...scan, roots: moved }, scan.afterHash)).rejects.toThrow(/refusing to apply/);
    } finally {
      await sandbox.destroy();
    }
  });

  it("refuses to apply when any source file drifted since the scan", async () => {
    const sandbox = await createMigrationSandbox();
    try {
      const scan = await scanBaseline(sandboxRoots(sandbox));
      await writeFile(sandbox.prescriptionPath, `${PRESCRIPTION_BEFORE}# edited after scan\n`, "utf8");
      await expect(applyBaseline(scan, scan.afterHash)).rejects.toThrow(
        /refusing to apply/,
      );
      // Refusal is total: no file was touched.
      if (sandbox.consultationsPath !== null) {
        expect(await readFile(sandbox.consultationsPath, "utf8")).toBe(CONSULTATIONS_BEFORE);
      }
    } finally {
      await sandbox.destroy();
    }
  });
});

describe("legacy import planning", () => {
  it("maps each session to one state change and consultation entries to append-only events, stably across reruns", () => {
    const changeSets = planLegacyImport({
      prescriptions: [{ relativePath: "base.yaml", text: PRESCRIPTION_BEFORE }],
      consultations: [{ relativePath: "coaching/consultations.md", text: CONSULTATIONS_BEFORE }],
    });
    // One change set per legacy FILE: identity embeds the normalized relative
    // path plus per-file entry index.
    expect(changeSets).toHaveLength(2);
    const [rxSet, consultSet] = changeSets;
    expect(rxSet?.state_changes).toHaveLength(3);
    expect(rxSet?.events).toEqual([]);
    expect(consultSet?.events).toHaveLength(2);
    expect(consultSet?.state_changes).toEqual([]);
    for (const set of changeSets) {
      expect(set.source.skill).toBe("intake");
      expect(set.report_claims).toEqual([]);
      expect(set.source.session_id).toMatch(/^migration-[0-9a-f]{16}$/);
    }
    expect(consultSet?.source.session_id).not.toBe(rxSet?.source.session_id);

    const [, consultEvents] = [rxSet, consultSet?.events];
    const [first, second] = consultEvents ?? [];
    expect(first?.effective_at).toBe("2026-07-21T09:00:00Z");
    expect(first?.details.legacyMarkdown).toContain("Fatigue flagged after race; scheduled down week.");
    expect(second?.effective_at).toBe("2026-08-02");

    const rerun = planLegacyImport({
      prescriptions: [{ relativePath: "base.yaml", text: PRESCRIPTION_BEFORE }],
      consultations: [{ relativePath: "coaching/consultations.md", text: CONSULTATIONS_BEFORE }],
    });
    expect(rerun).toHaveLength(2);
    expect(JSON.stringify(rerun)).toBe(JSON.stringify(changeSets));
  });

  it("imports a boundary-free legacy log as ONE verbatim event instead of inventing structure", () => {
    const events = planConsultationImport(
      "coaching/consultations.md",
      "Free-form notes from 2026-05-01 without headings at all.",
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.entity_type).toBe("consultation");
    expect(events[0]?.effective_at).toBe("2026-05-01");
    expect(events[0]?.details.legacyMarkdown).toBe(
      "Free-form notes from 2026-05-01 without headings at all.",
    );
  });
  it("does not import a generated header-only consultation log as an event", () => {
    expect(
      planConsultationImport("coaching/consultations.md", GENERATED_MARKDOWN_HEADER),
    ).toEqual([]);
  });
  it("omits an empty consultation source from the emitted change-set batch", () => {
    expect(
      planLegacyImport({
        consultations: [
          {
            relativePath: "coaching/consultations.md",
            text: GENERATED_MARKDOWN_HEADER,
          },
        ],
      }),
    ).toEqual([]);
  });
  it("converts a self-alias goal without overflowing, dropping the cycle", () => {
    const cyclic = [
      "block_name: Base",
      "sessions:",
      "  - session_date: 2026-07-08",
      "    week: 1",
      "    goal: &g",
      "      ref: *g",
      "",
    ].join("\n");
    const changes = planPrescriptionImport("base.yaml", cyclic);
    expect(changes).toHaveLength(1);
    // The alias resolves to the containing object; the cycle is cut and the
    // remaining JSON-safe shape is kept.
    expect(changes[0]?.details.goal).toEqual({});
  });
});

 
describe("import through approval and materialization", () => {
  it("commits imported prescription state as ACTIVE after an approved apply, and record identity is stable across import reruns", async () => {
    const space = await createSyntheticCaptureSpace();
    try {
      const tools = testPreviewTools(space);
      // Prescriptions-only corpus: consultation bodies carry multi-line
      // `legacyMarkdown` verbatim per the migration contract, which the
      // pack's blanket newline validation currently rejects (reported to the
      // orchestrator as a harness dependency, not weakened here).
      const [changeSet] = planLegacyImport({
        prescriptions: [{ relativePath: "base.yaml", text: PRESCRIPTION_BEFORE }],
      });

      const firstPreview = await previewStructuredCapture(changeSet, tools);
      if (firstPreview.status !== "ready") throw new Error(`first preview blocked: ${JSON.stringify(firstPreview.errors)}`);
      expect(tools.plannedMutations.filter((mutation) => mutation.action === "create").length).toBeGreaterThan(0);

      // Approved apply through the REAL host plumbing with the exact
      // previewed plan hash — nothing mocked.
      const candidate = tools.previews[0];
      if (candidate === undefined) throw new Error("preview produced no candidate envelope");
      const { submittedAt, ...rest } = candidate;
      const reconcile = await reconcileKnowledgeTransaction({
        binding: space.active,
        candidateInput: { ...rest, submitted_at: submittedAt },
        pack: engramCoachPack,
      });
      if (reconcile.status !== "proposal") throw new Error(`reconcile did not propose: ${reconcile.status}`);
      const applied = await applyKnowledgeProposal({
        binding: space.active,
        proposal: reconcile.proposal,
        decision: "approve",
        expectedPlanHash: firstPreview.planHash,
        pack: engramCoachPack,
        spawnFn: makeAlwaysSucceedsSpawnFn("Indexed: 5 new, 0 updated, 0 unchanged, 0 removed").spawnFn,
      });
      expect(applied.status).toBe("committed");

      // Committed explicit records are ACTIVE on disk.
      const committed = applied.mutations.map((mutation) => mutation.after);
      expect(committed.every((record) => record.status === "active")).toBe(true);
      expect(committed.filter((record) => (record.details as { recordRole?: string }).recordRole === "state")).toHaveLength(3);

      // Rerunning the import is duplicate-free by construction: identical
      // source bytes yield an identical change set, therefore identical
      // deterministic record IDs — never a second copy.
      const [rerun] = planLegacyImport({
        prescriptions: [{ relativePath: "base.yaml", text: PRESCRIPTION_BEFORE }],
      });
      expect(JSON.stringify(rerun)).toBe(JSON.stringify(changeSet));
      const rerunRecords = migrationActiveRecords(rerun);
      expect(rerunRecords.map((record) => record.id)).toEqual(committed.map((record) => record.id));
      expect(new Set(rerunRecords.map((record) => record.id)).size).toBe(rerunRecords.length);
    } finally {
      await space.destroy();
    }
  });

  it("regenerated prescription views match the migrated source file byte-for-byte, twice", async () => {
    const sandbox = await createMigrationSandbox({ withConsultations: false });
    try {
      const roots = sandboxRoots(sandbox);

      // Full migration pass: normalize bytes, then regenerate the view from
      // the active import records and overwrite the source with it.
      const runOnce = async (): Promise<string> => {
        const scan = await scanBaseline(roots);
        await applyBaseline(scan, scan.afterHash);
        const records = migrationActiveRecords(
          planLegacyImport({
            prescriptions: [{ relativePath: "base.yaml", text: await readFile(sandbox.prescriptionPath, "utf8") }],
          }),
        );
        const appliedAt = records
          .map((record) => record.submittedAt)
          .reduce((latest, at) => (at > latest ? at : latest));
        const { views } = computeDesiredViews(records, appliedAt, roots.coachingDocsDir, roots.prescriptionsDir);
        expect(views).toHaveLength(1);
        const view = views[0];
        if (view === undefined) throw new Error("no prescription view rendered");
        const sourcePath = join(roots.prescriptionsDir, view.relativePath.replace(/^prescriptions\//, ""));
        await writeFile(sourcePath, view.content, "utf8");
        return view.content;
      };

      const firstPass = await runOnce();
      expect(firstPass).toBe(await readFile(sandbox.prescriptionPath, "utf8"));

      // Idempotence: the entire pass runs a second time with ZERO byte drift.
      const secondPass = await runOnce();
      expect(secondPass).toBe(firstPass);
    } finally {
      await sandbox.destroy();
    }
  });
});

describe("migration CLI", () => {
  it("lists all four modes in its help output", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      ["node_modules/tsx/dist/cli.mjs", "migrate-structured-capture.ts", "--help"],
      { cwd: new URL(".", import.meta.url).pathname },
    );
    for (const mode of ["scan", "apply-baseline", "emit-change-set", "compare"]) {
      expect(stdout).toContain(mode);
    }
  });

  it("emits consultation events from nested consultation logs", async () => {
    const sandbox = await createMigrationSandbox({ withConsultations: false });
    const toolDir = new URL(".", import.meta.url).pathname;
    const configPath = join(sandbox.root, "config.json");
    const outputPath = join(sandbox.root, "change-sets.json");
    const consultationPath = join(
      sandbox.coachingDocsDir,
      "2026",
      "base",
      "consultations.md",
    );
    const config = {
      active_profile: "default",
      profiles: {
        default: {
          active_persona: "conservative",
          coaching_docs_dir: sandbox.coachingDocsDir,
          prescriptions_dir: sandbox.prescriptionsDir,
        },
      },
      capture: {
        model: "synthetic/capture-model",
        timeout_seconds: 60,
        max_candidates_per_turn: 3,
      },
    };

    try {
      await mkdir(dirname(consultationPath), { recursive: true });
      await writeFile(consultationPath, CONSULTATIONS_BEFORE, "utf8");
      await writeFile(configPath, JSON.stringify(config), "utf8");
      await execFileAsync(
        process.execPath,
        [
          "node_modules/tsx/dist/cli.mjs",
          "migrate-structured-capture.ts",
          "emit-change-set",
          "--config",
          configPath,
          "--output",
          outputPath,
        ],
        { cwd: toolDir },
      );

      const changeSets = JSON.parse(
        await readFile(outputPath, "utf8"),
      ) as StructuredChangeSet[];
      const consultation = changeSets.find((changeSet) =>
        changeSet.events.some((event) =>
          String(event.details.legacyMarkdown).includes(
            "Fatigue flagged after race; scheduled down week.",
          ),
        ),
      );
      expect(consultation).toBeDefined();
    } finally {
      await sandbox.destroy();
    }
  });

  it("never imports a registry-declared monitoring artifact as a consultation", async () => {
    const sandbox = await createMigrationSandbox({ withConsultations: false });
    const toolDir = new URL(".", import.meta.url).pathname;
    const configPath = join(sandbox.root, "config.json");
    const outputPath = join(sandbox.root, "overlap-change-sets.json");
    const relativePath = "monitoring/consultations.md";
    const declaredPath = join(sandbox.coachingDocsDir, relativePath);
    const registryPath = join(sandbox.coachingDocsDir, "tracking", "concerns.yaml");
    const config = {
      active_profile: "default",
      profiles: {
        default: {
          active_persona: "conservative",
          coaching_docs_dir: sandbox.coachingDocsDir,
          prescriptions_dir: sandbox.prescriptionsDir,
        },
      },
      capture: {
        model: "synthetic/capture-model",
        timeout_seconds: 60,
        max_candidates_per_turn: 3,
      },
    };

    try {
      await mkdir(dirname(declaredPath), { recursive: true });
      await mkdir(dirname(registryPath), { recursive: true });
      await writeFile(declaredPath, MONITORING_BEFORE, "utf8");
      await writeFile(
        registryPath,
        ["concerns:", "  - id: overlap", "    active: true", `    log: ${relativePath}`, ""].join("\n"),
        "utf8",
      );
      await writeFile(configPath, JSON.stringify(config), "utf8");
      await execFileAsync(
        process.execPath,
        [
          "node_modules/tsx/dist/cli.mjs",
          "migrate-structured-capture.ts",
          "emit-change-set",
          "--config",
          configPath,
          "--output",
          outputPath,
        ],
        { cwd: toolDir },
      );

      const changeSets = JSON.parse(await readFile(outputPath, "utf8")) as StructuredChangeSet[];
      const consultationEvents = changeSets.flatMap((changeSet) =>
        changeSet.events.filter((event) => event.entity_type === "consultation"),
      );
      expect(consultationEvents).toEqual([]);
    } finally {
      await sandbox.destroy();
    }
  });

  it("compare exits nonzero listing paths before regeneration and zero after it", async () => {
    const sandbox = await createMigrationSandbox({ withConsultations: false });
    const toolDir = new URL(".", import.meta.url).pathname;
    const configPath = join(sandbox.root, "config.json");
    const config = {
      active_profile: "default",
      profiles: {
        default: {
          active_persona: "conservative",
          coaching_docs_dir: sandbox.coachingDocsDir,
          prescriptions_dir: sandbox.prescriptionsDir,
        },
      },
      capture: { model: "synthetic/capture-model", timeout_seconds: 60, max_candidates_per_turn: 3 },
    };
    const run = (mode: string, ...extra: string[]): Promise<{ code: number; stdout: string }> => {
      const { promise: done, resolve: resolveRun } = Promise.withResolvers<{ code: number; stdout: string }>();
      execFileAsync(
        process.execPath,
        ["node_modules/tsx/dist/cli.mjs", "migrate-structured-capture.ts", mode, "--config", configPath, ...extra],
        { cwd: toolDir },
      ).then(
        ({ stdout }) => resolveRun({ code: 0, stdout }),
        (error: { code?: number; stdout?: string }) =>
          resolveRun({ code: error.code ?? 1, stdout: error.stdout ?? "" }),
      );
      return done;
    };
    try {
      await writeFile(configPath, JSON.stringify(config), "utf8");

      // Pre-regeneration: generated views differ from commented legacy bytes.
      const before = await run("compare", "--render-root", join(sandbox.root, "render-before"));
      expect(before.code).toBe(1);
      expect(before.stdout).toContain("DIFF");

      // Regenerate the view from the import records, then compare passes clean.
      const roots = sandboxRoots(sandbox);
      const records = migrationActiveRecords(
        planLegacyImport({
          prescriptions: [{ relativePath: "base.yaml", text: await readFile(sandbox.prescriptionPath, "utf8") }],
        }),
      );
      const appliedAt = records
        .map((record) => record.submittedAt)
        .reduce((latest, at) => (at > latest ? at : latest));
      const { views } = computeDesiredViews(records, appliedAt, roots.coachingDocsDir, roots.prescriptionsDir);
      for (const view of views) {
        await writeFile(view.absoluteTarget, view.content, "utf8");
      }
      const after = await run("compare", "--render-root", join(sandbox.root, "render-after"));
      expect(after.code).toBe(0);
      expect(after.stdout).toContain("match byte-for-byte");
    } finally {
      await sandbox.destroy();
    }
  });
});

// ---------------------------------------------------------------------------
// Task 12: monitoring migration — registry-driven concern log / doctor-prep
// ---------------------------------------------------------------------------

import { makeRecord } from "./materialization-test-support.ts";
import {
  migratedMonitoringSourceSessionId,
  planMonitoringImport,
  readConcernRegistry,
} from "../engram-coach-migration.ts";

const MONITORING_BEFORE = await readFile(join(FIXTURE_DIR, "monitoring-before.md"), "utf8");
const DOCTOR_PREP_BEFORE = await readFile(join(FIXTURE_DIR, "doctor-prep-before.md"), "utf8");
const CONCERNS_REGISTRY = await readFile(join(FIXTURE_DIR, "concerns.yaml"), "utf8");

describe("monitoring migration", () => {
  it("plans stable per-signal identities from concern ID, signal, relative path, and entry index", () => {
    const sets = planMonitoringImport({
      relativePath: "monitoring/sleep-quality.md",
      concernId: "sleep-quality",
      text: MONITORING_BEFORE,
    });
    // One change set per signal partition, signals in sorted order:
    // the unparseable flare body lands under the fallback signal.
    expect(sets.map((set) => set.source.session_id)).toEqual([
      migratedMonitoringSourceSessionId("monitoring/sleep-quality.md", "sleep-quality", "general"),
      migratedMonitoringSourceSessionId("monitoring/sleep-quality.md", "sleep-quality", "hrv"),
    ]);
    for (const sessionId of sets.map((set) => set.source.session_id)) {
      expect(sessionId).toMatch(/^migration-[0-9a-f]{16}$/);
    }

    const generalSet = sets[0];
    const hrvSet = sets[1];
    expect(generalSet?.state_changes).toEqual([]);
    expect(generalSet?.events).toHaveLength(1);
    const flare = generalSet?.events[0];
    expect(flare?.effective_at).toBe("2026-06-20");
    expect(flare?.statement).toBe("Observed sleep-quality general on 2026-06-20");
    expect(flare?.details["legacyMarkdown"]).toContain("No parseable columns in this entry.");

    expect(hrvSet?.events).toHaveLength(2);
    expect(hrvSet?.state_changes).toHaveLength(1);
    const state = hrvSet?.state_changes[0];
    expect(state?.key_components).toEqual({ concern_id: "sleep-quality", signal: "hrv" });
    expect(state?.effective_at).toBe("2026-07-16");
    expect(state?.statement).toBe("Current sleep-quality hrv status: normal");
    expect(state?.details).toEqual({
      concernId: "sleep-quality",
      signal: "hrv",
      status: "normal",
      note: "Back to baseline after the down week.",
    });

    // Entry indices are per-role within the (path × concern × signal)
    // partition, ordered chronologically.
    const records = migrationActiveRecords(sets);
    const flareRecord = records.find((record) => {
      const value = record.details["value"];
      return typeof value === "object" && value !== null && "legacyMarkdown" in value;
    });
    const stateRecord = records.find(
      (record) => record.details["entityKey"] === "monitoring:sleep-quality:hrv",
    );
    expect(flareRecord?.details["sourceId"]).toBe(
      `${migratedMonitoringSourceSessionId("monitoring/sleep-quality.md", "sleep-quality", "general")}:0:event:0`,
    );
    expect(stateRecord?.details["sourceId"]).toBe(
      `${migratedMonitoringSourceSessionId("monitoring/sleep-quality.md", "sleep-quality", "hrv")}:0:state:0`,
    );

    // Idempotent planning: identical bytes yield identical change sets.
    const rerun = planMonitoringImport({
      relativePath: "monitoring/sleep-quality.md",
      concernId: "sleep-quality",
      text: MONITORING_BEFORE,
    });
    expect(JSON.stringify(rerun)).toBe(JSON.stringify(sets));
  });

  it("reads the concerns.yaml registry and hash-binds monitoring artifacts into the baseline plan", async () => {
    const root = await mkdtemp(join(tmpdir(), "engram-coach-monitoring-migration-"));
    try {
      const coachingDocsDir = join(root, "docs");
      const prescriptionsDir = join(root, "prescriptions");
      await mkdir(join(coachingDocsDir, "tracking"), { recursive: true });
      await mkdir(join(coachingDocsDir, "monitoring"), { recursive: true });
      await mkdir(prescriptionsDir, { recursive: true });
      await writeFile(join(coachingDocsDir, "tracking", "concerns.yaml"), CONCERNS_REGISTRY, "utf8");
      await writeFile(join(coachingDocsDir, "monitoring", "sleep-quality.md"), MONITORING_BEFORE, "utf8");
      await writeFile(join(coachingDocsDir, "monitoring", "doctor-prep.md"), DOCTOR_PREP_BEFORE, "utf8");

      const declarations = await readConcernRegistry(coachingDocsDir);
      expect(declarations).toHaveLength(2);
      expect(declarations[0]).toMatchObject({
        concernId: "sleep-quality",
        active: true,
        logPath: "monitoring/sleep-quality.md",
        doctorPrepPath: "monitoring/doctor-prep.md",
      });
      expect(declarations[1]).toMatchObject({ concernId: "left-calf", active: false });

      const scan = await scanBaseline({ prescriptionsDir, coachingDocsDir });
      const monitoringPlans = scan.files.filter((file) => file.plan.relativePath.startsWith("monitoring/"));
      expect(monitoringPlans.map((file) => file.plan.relativePath)).toEqual([
        "monitoring/doctor-prep.md",
        "monitoring/sleep-quality.md",
      ]);
      for (const file of monitoringPlans) {
        expect(file.rootKind).toBe("coaching-docs");
        expect(file.plan.afterText.slice(GENERATED_MARKDOWN_HEADER.length)).toBe(file.plan.beforeText);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("regenerated monitoring views match the migrated sources byte-for-byte, twice", async () => {
    const root = await mkdtemp(join(tmpdir(), "engram-coach-monitoring-fixpoint-"));
    try {
      const coachingDocsDir = join(root, "docs");
      const prescriptionsDir = join(root, "prescriptions");
      await mkdir(join(coachingDocsDir, "tracking"), { recursive: true });
      await mkdir(join(coachingDocsDir, "monitoring"), { recursive: true });
      await mkdir(prescriptionsDir, { recursive: true });
      await writeFile(join(coachingDocsDir, "tracking", "concerns.yaml"), CONCERNS_REGISTRY, "utf8");
      await writeFile(join(coachingDocsDir, "monitoring", "sleep-quality.md"), MONITORING_BEFORE, "utf8");
      await writeFile(join(coachingDocsDir, "monitoring", "doctor-prep.md"), DOCTOR_PREP_BEFORE, "utf8");

      // Doctor-prep target paths come from declaration records that the
      // production capture path creates; one is seeded here so the dry-run
      // renders the summary view exactly like an approved apply would.
      const declarationRecord = makeRecord({
        role: "state",
        entityType: "monitoring-declaration",
        effectiveAt: "2026-08-01T00:00:00Z",
        sourceId: "s-doctor-prep-migration:0:explicit:0",
        artifactKind: "doctor-prep",
        relativePath: "monitoring/doctor-prep.md",
        value: {},
      });
      const APPLIED_AT = "2026-08-23T00:00:00Z";

      const runOnce = async (): Promise<Record<string, string>> => {
        const roots = { prescriptionsDir, coachingDocsDir };
        const scan = await scanBaseline(roots);
        await applyBaseline(scan, scan.afterHash);

        // Identity anchors to each concern's DECLARED legacy log path so
        // entries re-imported from generated shared views keep their IDs.
        const declarations = await readConcernRegistry(coachingDocsDir);
        const monitoringConcernLogPaths: Record<string, string> = {};
        for (const declaration of declarations) {
          monitoringConcernLogPaths[declaration.concernId] = declaration.logPath;
        }

        // Re-import the declared logs plus any generated shared view under
        // monitoring/ — Doctor-Prep summaries are derived output, never
        // imported.
        const monitoringDir = join(coachingDocsDir, "monitoring");
        const inputs = (await readdir(monitoringDir))
          .filter((name) => /\.md$/.test(name) && !/^doctor-prep/i.test(name))
          .sort()
          .map((name) => ({
            relativePath: `monitoring/${name}`,
            concernId: name.replace(/\.md$/, ""),
            text: "",
          }));
        for (const input of inputs) {
          input.text = await readFile(join(monitoringDir, input.relativePath.replace(/^monitoring\//, "")), "utf8");
        }
        const records = [
          ...migrationActiveRecords(planLegacyImport({ monitoring: inputs, monitoringConcernLogPaths })),
          declarationRecord,
        ];
        const { views } = computeDesiredViews(records, APPLIED_AT, coachingDocsDir, prescriptionsDir);
        expect(views.map((view) => view.relativePath)).toEqual([
          "monitoring/doctor-prep.md",
          "monitoring/events.md",
          "monitoring/sleep-quality.md",
        ]);
        const snapshot: Record<string, string> = {};
        for (const view of views) {
          await mkdir(dirname(view.absoluteTarget), { recursive: true });
          await writeFile(view.absoluteTarget, view.content, "utf8");
          snapshot[view.relativePath] = view.content;
        }
        return snapshot;
      };

      const firstPass = await runOnce();
      const logView = firstPass["monitoring/sleep-quality.md"];
      expect(logView?.startsWith(GENERATED_MARKDOWN_HEADER)).toBe(true);
      expect(logView).toContain("## sleep-quality / hrv");
      expect(logView).toContain("- 2026-07-16 state ");
      const eventsView = firstPass["monitoring/events.md"];
      expect(eventsView).toContain("## sleep-quality / general");
      expect(eventsView).toContain("No parseable columns in this entry.");
      expect(firstPass["monitoring/doctor-prep.md"]).toContain("Current state: normal — Back to baseline after the down week.");

      // Idempotence: the entire pass runs a second time with ZERO byte drift.
      const secondPass = await runOnce();
      expect(secondPass).toEqual(firstPass);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("legacy import end-to-end coverage", () => {
  // Multi-line legacy entry exercising everything the old newline_forbidden
  // blocker rejected: interior blank lines, indentation, and em-dashes.
  const MULTILINE_CONSULTATIONS = [
    "# Consultations",
    "",
    "## 2026-07-21T09:00:00Z — Structured intake note",
    "",
    "First paragraph of the note.",
    "",
    "  indented continuation with *emphasis*",
    "",
    "",
    "    deeper block kept as-is",
    "",
    "## 2026-08-02 — Follow-up",
    "",
    "Kept volume flat.",
    "",
  ].join("\n");

  function endToEndConfig(root: string): EngramCoachRuntimeConfig {
    return {
      activeProfile: "test",
      coachingDocsDir: join(root, "coaching-docs"),
      prescriptionsDir: join(root, "prescriptions"),
      capture: { model: "synthetic/capture-model", timeoutSeconds: 60, maxCandidatesPerTurn: 3 },
    };
  }

  async function activeRecords(space: SyntheticCaptureSpace): Promise<KnowledgeRecord[]> {
    const files = (await readdir(space.recordsRoot)).filter((name) => name.endsWith(".md"));
    return Promise.all(
      [...files].sort().map(async (name) => {
        const parsed = parseKnowledgeRecord(await readFile(join(space.recordsRoot, name), "utf8"));
        if (!parsed.ok) throw new Error(`record ${name} does not parse`);
        return parsed.value;
      }),
    );
  }

  /** Materialize tools that write REAL files under the space's temp root. */
  function diskMaterializeTools(space: SyntheticCaptureSpace, appliedAt: string): MaterializeTools {
    return {
      projectRoot: space.root,
      appliedAt,
      listRecords: () => activeRecords(space),
      replaceArtifact: async ({ root, relativePath, content }) => {
        const target = join(root, relativePath);
        const existing = await readFile(target, "utf8").catch(() => null);
        if (existing === content) return { status: "unchanged" as const, path: relativePath };
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, content, "utf8");
        return { status: "replaced" as const, path: relativePath };
      },
    };
  }

  function consultationChangeSet(
    text: string,
    relativePath = "coaching/consultations.md",
  ): StructuredChangeSet {
    const [changeSet] = planLegacyImport({
      prescriptions: [],
      consultations: [{ relativePath, text }],
    });
    if (changeSet === undefined) throw new Error("consultation import produced no change set");
    return changeSet;
  }

  /** Approve the exact previewed hash through the REAL guarded core. */
  async function approvedApply(
    space: SyntheticCaptureSpace,
    tools: PreviewTools & { previews: KnowledgeEnvelope[] },
    preview: ReadyCapturePreview,
  ) {
    const candidate = tools.previews[0];
    if (candidate === undefined) throw new Error("preview produced no candidate envelope");
    const { submittedAt, ...rest } = candidate;
    const reconcile = await reconcileKnowledgeTransaction({
      binding: space.active,
      candidateInput: { ...rest, submitted_at: submittedAt },
      pack: engramCoachPack,
    });
    if (reconcile.status !== "proposal") throw new Error(`reconcile did not propose: ${reconcile.status}`);
    return applyKnowledgeProposal({
      binding: space.active,
      proposal: reconcile.proposal,
      decision: "approve",
      expectedPlanHash: preview.planHash,
      pack: engramCoachPack,
      spawnFn: makeAlwaysSucceedsSpawnFn("Indexed: 5 new, 0 updated, 0 unchanged, 0 removed").spawnFn,
    });
  }

  async function runConsultationImport(
    space: SyntheticCaptureSpace,
    text: string,
    relativePath = "coaching/consultations.md",
  ): Promise<ReadyCapturePreview> {
    const tools = testPreviewTools(space);
    const preview = await previewStructuredCapture(
      consultationChangeSet(text, relativePath),
      tools,
    );
    if (preview.status !== "ready") throw new Error(`preview blocked: ${JSON.stringify(preview.errors)}`);
    const applied = await approvedApply(space, tools, preview);
    if (applied.status !== "committed") throw new Error(`apply did not commit: ${applied.status}`);
    const committed = applied.mutations.map((mutation) => mutation.after);
    const appliedAt = committed.map((record) => record.submittedAt).reduce((latest, at) => (at > latest ? at : latest));
    const materialization = await materialize(
      {
        planHash: preview.planHash,
        mutations: applied.mutations.map((mutation) => ({
          recordId: mutation.recordId,
          action: "create" as const,
          beforeHash: null,
          after: mutation.after,
        })),
      },
      diskMaterializeTools(space, appliedAt),
      { config: endToEndConfig(space.root) },
    );
    expect(materialization.stale).toEqual([]);
    expect(materialization.written.map((entry) => entry.path)).toContain(relativePath);
    return preview;
  }

  it("round-trips the real consultation fixture through preview, approved apply, and materialize back to the normalized baseline bytes", async () => {
    const space = await createSyntheticCaptureSpace();
    try {
      await runConsultationImport(space, CONSULTATIONS_BEFORE);

      // BYTE equality against the normalized baseline (warning header plus
      // the untouched fixture body) — this is the path that previously died
      // in preview on newline_forbidden.
      const config = endToEndConfig(space.root);
      const regenerated = await readFile(join(config.coachingDocsDir, "coaching", "consultations.md"), "utf8");
      expect(regenerated).toBe(planMarkdownLogBaseline("coaching/consultations.md", CONSULTATIONS_BEFORE).afterText);
    } finally {
      await space.destroy();
    }
  });

  it("materializes a nested consultation import back to its discovered path", async () => {
    const space = await createSyntheticCaptureSpace();
    const relativePath = "2026/base/consultations.md";
    try {
      await runConsultationImport(space, CONSULTATIONS_BEFORE, relativePath);
      const config = endToEndConfig(space.root);
      const regenerated = await readFile(
        join(config.coachingDocsDir, relativePath),
        "utf8",
      );
      expect(regenerated).toBe(
        planMarkdownLogBaseline(relativePath, CONSULTATIONS_BEFORE).afterText,
      );
    } finally {
      await space.destroy();
    }
  });

  it("blocks an event whose compatibility path escapes the artifact root", async () => {
    const space = await createSyntheticCaptureSpace();
    try {
      const changeSet = consultationChangeSet(CONSULTATIONS_BEFORE);
      const escaping = {
        ...changeSet,
        events: changeSet.events.map((event) => ({
          ...event,
          details: { ...event.details, compatibility_path: "../escape.md" },
        })),
      };
      const preview = await previewStructuredCapture(escaping, testPreviewTools(space));
      expect(preview.status).toBe("blocked");
      expect(JSON.stringify(preview)).toContain("compatibility_path");
    } finally {
      await space.destroy();
    }
  });

  it("preserves interior newlines, indentation, and blank lines through record serialization, reparse, and rendering", async () => {
    const space = await createSyntheticCaptureSpace();
    try {
      const planned = consultationChangeSet(MULTILINE_CONSULTATIONS);
      const first = planned.events[0];
      // The planner strips only the ONE structural blank line after the
      // heading; every interior byte is carried verbatim.
      expect(first?.details.legacyMarkdown).toBe(
        [
          "First paragraph of the note.",
          "",
          "  indented continuation with *emphasis*",
          "",
          "",
          "    deeper block kept as-is",
        ].join("\n"),
      );

      await runConsultationImport(space, MULTILINE_CONSULTATIONS);

      const config = endToEndConfig(space.root);
      const regenerated = await readFile(join(config.coachingDocsDir, "coaching", "consultations.md"), "utf8");
      // Byte equality proves the multi-line body survived record
      // serialization AND reparse — not a substring check.
      expect(regenerated).toBe(planMarkdownLogBaseline("coaching/consultations.md", MULTILINE_CONSULTATIONS).afterText);
      expect(regenerated).toContain(
        [
          "First paragraph of the note.",
          "",
          "  indented continuation with *emphasis*",
          "",
          "",
          "    deeper block kept as-is",
        ].join("\n"),
      );
    } finally {
      await space.destroy();
    }
  });

  it("classifies an identical consultation re-import as no-change instead of duplicating events or raising state_conflict", async () => {
    const space = await createSyntheticCaptureSpace();
    try {
      await runConsultationImport(space, CONSULTATIONS_BEFORE);
      const beforeIds = (await activeRecords(space)).map((record) => record.id).sort();
      expect(beforeIds).toHaveLength(2);

      // Re-import of the SAME legacy source through a fresh real preview.
      const replayTools = testPreviewTools(space);
      const replay = await previewStructuredCapture(consultationChangeSet(CONSULTATIONS_BEFORE), replayTools);
      if (replay.status !== "ready") throw new Error(`replay blocked: ${JSON.stringify(replay.errors)}`);
      // Every event reconciled to no-change: nothing left to create.
      expect(replay.changes).toEqual([]);

      // The observed classification at the host: applying the replayed plan
      // commits NOTHING and reports no_change.
      const secondApply = await approvedApply(space, replayTools, replay);
      if (secondApply.status !== "no_change") {
        throw new Error(`expected no_change, got ${secondApply.status}`);
      }
      expect(secondApply.mutations).toEqual([]);
      expect((await activeRecords(space)).map((record) => record.id).sort()).toEqual(beforeIds);
    } finally {
      await space.destroy();
    }
  });

  it("classifies an identical nested-prescription re-import as no-change on the second pass", async () => {
    const space = await createSyntheticCaptureSpace();
    try {
      const [changeSet] = planLegacyImport({
        prescriptions: [{ relativePath: "base.yaml", text: PRESCRIPTION_BEFORE }],
      });
      if (changeSet === undefined) throw new Error("prescription import produced no change set");
      const tools = testPreviewTools(space);
      const preview = await previewStructuredCapture(changeSet, tools);
      if (preview.status !== "ready") throw new Error(`first preview blocked: ${JSON.stringify(preview.errors)}`);
      const applied = await approvedApply(space, tools, preview);
      expect(applied.status).toBe("committed");

      // Session two carries nested warmup/cooldown/intervals objects; they
      // reached the committed state record intact.
      const intervalState = applied.mutations
        .map((mutation) => mutation.after)
        .find((record) => JSON.stringify(record.details["value"]).includes('"intervals"'));
      if (intervalState === undefined) throw new Error("no committed session with nested intervals");
      const rawValue = intervalState.details["value"];
      if (typeof rawValue !== "object" || rawValue === null || Array.isArray(rawValue)) {
        throw new Error("committed prescription value is not an object");
      }
      expect(rawValue.warmup).toBeDefined();
      expect(rawValue.cooldown).toBeDefined();
      expect(Array.isArray(rawValue.intervals)).toBe(true);

      const beforeIds = (await activeRecords(space)).map((record) => record.id).sort();
      expect(beforeIds).toHaveLength(3);

      // Second pass with recursive canonical comparison: nested objects
      // dedupe to no-change instead of raising state_conflict.
      const [rerun] = planLegacyImport({
        prescriptions: [{ relativePath: "base.yaml", text: PRESCRIPTION_BEFORE }],
      });
      if (rerun === undefined) throw new Error("re-import produced no change set");
      const replayTools = testPreviewTools(space);
      const replay = await previewStructuredCapture(rerun, replayTools);
      if (replay.status !== "ready") throw new Error(`replay blocked: ${JSON.stringify(replay.errors)}`);
      expect(replay.changes).toEqual([]);

      const secondApply = await approvedApply(space, replayTools, replay);
      if (secondApply.status !== "no_change") {
        throw new Error(`expected no_change, got ${secondApply.status}`);
      }
      expect(secondApply.mutations).toEqual([]);
      expect((await activeRecords(space)).map((record) => record.id).sort()).toEqual(beforeIds);
    } finally {
      await space.destroy();
    }
  });
});
