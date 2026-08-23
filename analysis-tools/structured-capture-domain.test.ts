/**
 * Focused behavioral tests for the structured-capture domain foundations:
 * config resolution/validation (engram-coach-config.ts), canonical entity
 * key derivation (engram-coach-keys.ts), and the typed capture input surface
 * (engram-coach-capture-types.ts).
 *
 * Config tests exercise real files under temporary directories; environment,
 * project root, and home directory are injected per call so tests never
 * mutate process state.
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { deriveCanonicalEntityKey } from "../engram-coach-keys.ts";
import {
  loadEngramCoachConfig,
  EngramCoachConfigError,
} from "../engram-coach-config.ts";
import type { EngramCoachRuntimeConfig } from "../engram-coach-config.ts";
import { makeEmptyChangeSet, SCHEMA_VERSION } from "../engram-coach-capture-types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

function writeConfig(dir: string, config: unknown): string {
  mkdirSync(join(dir, ".engram-coach"), { recursive: true });
  const path = join(dir, ".engram-coach", "config.json");
  writeFileSync(path, JSON.stringify(config));
  return path;
}

type CaptureFields = Record<string, unknown>;

function baseConfig(capture: CaptureFields | null): Record<string, unknown> {
  const config: Record<string, unknown> = {
    active_profile: "default",
    profiles: {
      default: {
        active_persona: "conservative",
        coaching_docs_dir: "/tmp/coaching-docs",
        prescriptions_dir: "/tmp/prescriptions",
      },
    },
  };
  if (capture !== null) {
    config.capture = capture;
  }
  return config;
}

type LoadOverrides = {
  env?: Record<string, string | undefined>;
  projectRoot?: string;
  homeDir?: string;
};

async function load(overrides: LoadOverrides = {}): Promise<EngramCoachRuntimeConfig> {
  return loadEngramCoachConfig({
    env: overrides.env ?? {},
    projectRoot: overrides.projectRoot ?? "/nonexistent-project",
    homeDir: overrides.homeDir ?? "/nonexistent-home",
  });
}

async function expectConfigError(promise: Promise<EngramCoachRuntimeConfig>): Promise<void> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(EngramCoachConfigError);
}

// ---------------------------------------------------------------------------
// Config path precedence
// ---------------------------------------------------------------------------

describe("loadEngramCoachConfig path precedence", () => {
  it("prefers ENGRAM_COACH_CONFIG over the project and user paths", async () => {
    const explicitDir = makeTempDir("ec-explicit");
    const projectDir = makeTempDir("ec-project");
    const homeDir = makeTempDir("ec-home");
    writeConfig(projectDir, baseConfig({ model: "project/model" }));
    mkdirSync(join(homeDir, ".claude", "engram-coach"), { recursive: true });
    writeFileSync(
      join(homeDir, ".claude", "engram-coach", "config.json"),
      JSON.stringify(baseConfig({ model: "user/model" })),
    );
    const explicitPath = writeConfig(explicitDir, baseConfig({ model: "explicit/model" }));

    const config = await load({
      env: { ENGRAM_COACH_CONFIG: explicitPath },
      projectRoot: projectDir,
      homeDir,
    });
    expect(config.capture.model).toBe("explicit/model");
  });

  it("falls back to <projectRoot>/.engram-coach/config.json when no env override is set", async () => {
    const projectDir = makeTempDir("ec-project");
    const homeDir = makeTempDir("ec-home");
    const projectPath = writeConfig(projectDir, baseConfig({ model: "project/model" }));
    mkdirSync(join(homeDir, ".claude", "engram-coach"), { recursive: true });
    writeFileSync(
      join(homeDir, ".claude", "engram-coach", "config.json"),
      JSON.stringify(baseConfig({ model: "user/model" })),
    );

    const config = await load({ projectRoot: projectDir, homeDir });
    expect(config.capture.model).toBe("project/model");
    expect(projectPath).toContain(".engram-coach");
  });

  it("falls back to ~/.claude/engram-coach/config.json last", async () => {
    const homeDir = makeTempDir("ec-home");
    mkdirSync(join(homeDir, ".claude", "engram-coach"), { recursive: true });
    writeFileSync(
      join(homeDir, ".claude", "engram-coach", "config.json"),
      JSON.stringify(baseConfig({ model: "user/model" })),
    );

    const config = await load({ homeDir });
    expect(config.capture.model).toBe("user/model");
  });

  it("throws a configuration error listing every tried path when no config exists", async () => {
    const homeDir = makeTempDir("ec-empty-home");
    let message = "";
    try {
      await load({ homeDir });
    } catch (error) {
      expect(error).toBeInstanceOf(EngramCoachConfigError);
      message = error instanceof Error ? error.message : "";
    }
    expect(message).toContain(".engram-coach/config.json");
    expect(message).toContain(".claude/engram-coach/config.json");
  });

  it("resolves the active profile into flattened runtime paths", async () => {
    const dir = makeTempDir("ec-profiles");
    const path = join(dir, "config.json");
    writeFileSync(
      path,
      JSON.stringify({
        active_profile: "maria",
        profiles: {
          maria: {
            active_persona: "polarized",
            coaching_docs_dir: "/tmp/maria/docs",
            prescriptions_dir: "/tmp/maria/rx",
          },
        },
        capture: { model: "m/model" },
      }),
    );

    const config = await load({
      env: { ENGRAM_COACH_CONFIG: path },
    });
    expect(config.activeProfile).toBe("maria");
    expect(config.coachingDocsDir).toBe("/tmp/maria/docs");
    expect(config.prescriptionsDir).toBe("/tmp/maria/rx");
  });
});

// ---------------------------------------------------------------------------
// Capture model resolution
// ---------------------------------------------------------------------------

describe("loadEngramCoachConfig capture model", () => {
  it("uses capture.model when the override env var is unset", async () => {
    const dir = makeTempDir("ec-model-base");
    const path = writeConfig(dir, baseConfig({ model: "provider/base-model" }));

    const config = await load({ env: { ENGRAM_COACH_CONFIG: path } });
    expect(config.capture.model).toBe("provider/base-model");
  });

  it("overrides capture.model with a nonblank ENGRAM_COACH_CAPTURE_MODEL", async () => {
    const dir = makeTempDir("ec-model-env");
    const path = writeConfig(dir, baseConfig({ model: "provider/base-model" }));

    const config = await load({
      env: {
        ENGRAM_COACH_CONFIG: path,
        ENGRAM_COACH_CAPTURE_MODEL: "  provider/override-model  ",
      },
    });
    expect(config.capture.model).toBe("provider/override-model");
  });

  it("ignores a blank ENGRAM_COACH_CAPTURE_MODEL and uses capture.model", async () => {
    const dir = makeTempDir("ec-model-blank");
    const path = writeConfig(dir, baseConfig({ model: "provider/base-model" }));

    const config = await load({
      env: { ENGRAM_COACH_CONFIG: path, ENGRAM_COACH_CAPTURE_MODEL: "   " },
    });
    expect(config.capture.model).toBe("provider/base-model");
  });

  it("fails when neither ENGRAM_COACH_CAPTURE_MODEL nor capture.model exists", async () => {
    const dir = makeTempDir("ec-model-missing");
    const path = writeConfig(dir, baseConfig({}));

    await expectConfigError(load({ env: { ENGRAM_COACH_CONFIG: path } }));
    await expectConfigError(
      load({ env: { ENGRAM_COACH_CONFIG: path, ENGRAM_COACH_CAPTURE_MODEL: "" } }),
    );
  });

  it("fails when the capture block itself is absent", async () => {
    const dir = makeTempDir("ec-no-capture");
    const path = writeConfig(dir, baseConfig(null));

    await expectConfigError(load({ env: { ENGRAM_COACH_CONFIG: path } }));
  });
});

// ---------------------------------------------------------------------------
// Capture limit validation
// ---------------------------------------------------------------------------

describe("loadEngramCoachConfig capture limits", () => {
  it.each([
    [{ model: "m" }, 60, 3],
    [{ model: "m", timeout_seconds: 30 }, 30, 3],
    [{ model: "m", max_candidates_per_turn: 1 }, 60, 1],
    [{ model: "m", timeout_seconds: 60, max_candidates_per_turn: 3 }, 60, 3],
  ] as Array<[CaptureFields, number, number]>)(
    "accepts %j and defaults or keeps positive limits",
    async (capture, expectedTimeout, expectedMax) => {
      const dir = makeTempDir("ec-limits-ok");
      const path = writeConfig(dir, baseConfig(capture));
      const config = await load({ env: { ENGRAM_COACH_CONFIG: path } });
      expect(config.capture.timeoutSeconds).toBe(expectedTimeout);
      expect(config.capture.maxCandidatesPerTurn).toBe(expectedMax);
    },
  );

  it.each([
    { model: "m", timeout_seconds: 0 },
    { model: "m", timeout_seconds: -5 },
    { model: "m", timeout_seconds: 61 },
    { model: "m", timeout_seconds: 30.5 },
    { model: "m", max_candidates_per_turn: 0 },
    { model: "m", max_candidates_per_turn: -1 },
    { model: "m", max_candidates_per_turn: 4 },
    { model: "m", max_candidates_per_turn: 2.5 },
    { model: "m", timeout_seconds: "60" },
    { model: "m", max_candidates_per_turn: null },
  ] as CaptureFields[])("rejects %j", async (capture) => {
    const dir = makeTempDir("ec-limits-bad");
    const path = writeConfig(dir, baseConfig(capture));
    await expectConfigError(load({ env: { ENGRAM_COACH_CONFIG: path } }));
  });
});

// ---------------------------------------------------------------------------
// Malformed configuration
// ---------------------------------------------------------------------------

describe("loadEngramCoachConfig malformed input", () => {
  it.each([
    "not json at all {{{",
    JSON.stringify({ capture: { model: "m" } }),
    JSON.stringify({
      active_profile: "default",
      profiles: {},
      capture: { model: "m" },
    }),
    JSON.stringify({
      active_profile: "default",
      profiles: { default: { coaching_docs_dir: "/d" } },
      capture: { model: "m" },
    }),
    JSON.stringify({
      active_profile: "",
      profiles: {},
      capture: { model: "m" },
    }),
  ])("rejects %s", async (raw) => {
    const dir = makeTempDir("ec-malformed");
    mkdirSync(join(dir, ".engram-coach"), { recursive: true });
    const path = join(dir, ".engram-coach", "config.json");
    writeFileSync(path, raw);
    await expectConfigError(load({ env: { ENGRAM_COACH_CONFIG: path } }));
  });
});

// ---------------------------------------------------------------------------
// Canonical entity keys — stable identity
// ---------------------------------------------------------------------------

describe("deriveCanonicalEntityKey", () => {
  it("binds a rescheduled workout to its durable session_id, ignoring mutable attributes", () => {
    expect(deriveCanonicalEntityKey({
      entity_type: "workout",
      key_components: { session_id: "workout-7f8c" },
      effective_at: "2026-08-24",
      statement: "Rescheduled from Thursday to Saturday",
      details: { session_date: "2026-08-29", session_name: "W3_SubLT2" },
    })).toEqual({
      kind: "bound",
      key: "workout:workout-7f8c",
    });
  });

  it("produces the identical workout key before and after rescheduling", () => {
    const before = deriveCanonicalEntityKey({
      entity_type: "workout",
      key_components: { session_id: "workout-7f8c" },
      effective_at: "2026-08-24",
      statement: "Original Thursday session",
      details: { session_date: "2026-08-27", session_name: "W3_SubLT2", week_number: 3 },
    });
    const after = deriveCanonicalEntityKey({
      entity_type: "workout",
      key_components: { session_id: "workout-7f8c" },
      effective_at: "2026-08-24",
      statement: "Rescheduled from Thursday to Saturday",
      details: { session_date: "2026-08-29", session_name: "W3_SubLT2 renamed", week_number: 3 },
    });
    expect(after).toEqual(before);
  });

  it("derives prescription keys requiring both arc_id and session_id", () => {
    expect(deriveCanonicalEntityKey({
      entity_type: "prescription",
      key_components: { arc_id: "arc-2026-build", session_id: "workout-7f8c" },
    })).toEqual({ kind: "bound", key: "prescription:arc-2026-build:workout-7f8c" });

    for (const components of [
      { session_id: "workout-7f8c" },
      { arc_id: "arc-2026-build" },
      {},
    ]) {
      const result = deriveCanonicalEntityKey({
        entity_type: "prescription",
        key_components: components,
      });
      expect(result.kind).toBe("unbound");
    }
  });

  it("normalizes threshold sports to slugs while pinning lt1/lt2 levels", () => {
    expect(deriveCanonicalEntityKey({
      entity_type: "threshold",
      key_components: { sport: "Road Cycling", level: "lt1" },
    })).toEqual({ kind: "bound", key: "threshold:road-cycling:lt1" });

    expect(deriveCanonicalEntityKey({
      entity_type: "threshold",
      key_components: { sport: "Run", level: "LT2" },
    })).toEqual({ kind: "bound", key: "threshold:run:lt2" });

    expect(deriveCanonicalEntityKey({
      entity_type: "threshold",
      key_components: { sport: "Run", level: "ftp" },
    }).kind).toBe("unbound");
  });

  it("normalizes the persona key from the active profile", () => {
    expect(deriveCanonicalEntityKey({
      entity_type: "persona",
      key_components: { active_profile: "Conservative Base" },
    })).toEqual({ kind: "bound", key: "persona:conservative-base" });
  });

  it("normalizes monitoring signals around a verbatim durable concern id", () => {
    expect(deriveCanonicalEntityKey({
      entity_type: "monitoring",
      key_components: { concern_id: "concern-fatigue-01", signal: "Morning HRV" },
    })).toEqual({ kind: "bound", key: "monitoring:concern-fatigue-01:morning-hrv" });
  });
});

// ---------------------------------------------------------------------------
// Canonical entity keys — unbound diagnostics
// ---------------------------------------------------------------------------

describe("deriveCanonicalEntityKey unbound results", () => {
  it.each([
    [{ entity_type: "workout", key_components: {} }, "session_id"],
    [{ entity_type: "workout", key_components: { session_id: "" } }, "session_id"],
    [{ entity_type: "workout", key_components: { session_id: "bad id!" } }, "session_id"],
    [{ entity_type: "prescription", key_components: { arc_id: "", session_id: "w-1" } }, "arc_id"],
    [{ entity_type: "prescription", key_components: { arc_id: "a b", session_id: "w-1" } }, "arc_id"],
    [{ entity_type: "monitoring", key_components: { concern_id: "c-1" } }, "signal"],
    [{ entity_type: "persona", key_components: {} }, "active_profile"],
    [{ entity_type: "threshold", key_components: { level: "lt1" } }, "sport"],
  ] as Array<[{ entity_type: string; key_components: Record<string, unknown> }, string]>)(
    "reports %j as unbound mentioning %s",
    (input, expectedFragment) => {
      const result = deriveCanonicalEntityKey({
        entity_type: input.entity_type as "workout",
        key_components: input.key_components,
      });
      expect(result.kind).toBe("unbound");
      if (result.kind === "unbound") {
        expect(result.reason).toContain(expectedFragment);
      }
    },
  );

  it("rejects unknown entity types as unbound", () => {
    const result = deriveCanonicalEntityKey({
      entity_type: "consultation" as "workout",
      key_components: {},
    });
    expect(result.kind).toBe("unbound");
  });
});

// ---------------------------------------------------------------------------
// Typed domain input surface
// ---------------------------------------------------------------------------

describe("structured capture change-set input", () => {
  it("builds an empty change set at schema version 0", () => {
    expect(SCHEMA_VERSION).toBe(0);
    const changeSet = makeEmptyChangeSet({
      skill: "consult",
      session_id: "session-123",
      turn_id: 4,
    });
    expect(changeSet.schema_version).toBe(0);
    expect(changeSet.state_changes).toEqual([]);
    expect(changeSet.events).toEqual([]);
    expect(changeSet.report_claims).toEqual([]);
    expect(changeSet.source).toEqual({
      skill: "consult",
      session_id: "session-123",
      turn_id: 4,
    });
  });
});
