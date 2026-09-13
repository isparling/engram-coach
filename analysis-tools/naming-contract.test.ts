/**
 * Documentation-contract test.
 *
 * Every public metadata and documentation surface must expose only Engram
 * Coach naming — no retired `claw-coach` branding, `CLAW_COACH_CONFIG`, or
 * `PEIGS_HARNESS`/`peigs` references — and must document the published
 * package, config env var, and OMP adapter names. The one permitted
 * historical reference is the literal manual migration command
 * (`mv .claw-coach .engram-coach`), which is stripped before the
 * retired-naming assertions.
 *
 * `docs/superpowers/` is intentionally excluded: those artifacts are never
 * committed and record historical terminology.
 */

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const PUBLIC_FILES = [
  "../README.md",
  "../SETUP.md",
  "../SKILL_PACK.md",
  "../shared/setup.md",
  "../.claude-plugin/plugin.json",
  "../.claude-plugin/marketplace.json",
  "../config.json.example",
  "../skills/intake/SKILL.md",
  "../skills/lactate-analyze/SKILL.md",
  "../skills/lessons-rollup/SKILL.md",
  "../skills/set-goal/SKILL.md",
  "../lactate/package.json",
  "../lactate/src/index.ts",
  "../engram-coach-pack.ts",
  "../engram-coach-domain.ts",
  "../engram-coach-reconciliation.ts",
  "../engram-coach-presentation.ts",
  "../engram-coach-capture-types.ts",
  "../engram-coach-config.ts",
  "../engram-coach-keys.ts",
  "../engram-coach-ambient-capture.ts",
  "../engram-coach-structured-capture.ts",
  "../engram-coach-materialization.ts",
  "../capture-handler.ts",
  "./package.json",
  "./package-lock.json",
];

async function readPublicFiles(): Promise<{ publicText: string; currentPublicText: string }> {
  const contents = await Promise.all(
    PUBLIC_FILES.map((path) => readFile(resolve(import.meta.dirname, path), "utf-8")),
  );
  const publicText = contents.join("\n");
  const currentPublicText = publicText.replaceAll("mv .claw-coach .engram-coach", "");
  return { publicText, currentPublicText };
}

describe("naming contract", () => {
  it("exposes only Engram Coach public naming across docs and metadata", async () => {
    const { publicText, currentPublicText } = await readPublicFiles();

    expect(currentPublicText).not.toMatch(/claw-coach/i);
    expect(currentPublicText).not.toMatch(/CLAW_COACH_CONFIG/);
    expect(currentPublicText).not.toMatch(/PEIGS_HARNESS/);
    expect(publicText).toContain("@isparling/engram-coach");
    expect(publicText).toContain("ENGRAM_COACH_CONFIG");
    expect(publicText).toContain("@isparling/engram-omp");
  });

  it("carries no residual Peigs architecture references in published sources or docs", async () => {
    const { currentPublicText } = await readPublicFiles();

    expect(currentPublicText).not.toMatch(/peigs/i);
  });

  it("documents the actual four-audience presentation contract, not an aspirational privacy policy", async () => {
    const { publicText } = await readPublicFiles();

    // The real contract: athlete, coach, and self-coach authorize identically;
    // only clinician narrows. No `visibility: private` field or configurable
    // `clinicalThemes` exist anywhere in the domain or presentation types.
    expect(publicText).toContain("self-coach");
    expect(publicText).not.toMatch(/visibility:\s*private/);
    expect(publicText).not.toMatch(/clinicalThemes/);
  });

  it("verifies plugin installation via direct SKILL.md discovery, not a nonexistent commands directory", async () => {
    const { publicText } = await readPublicFiles();

    expect(publicText).not.toMatch(/~\/\.claude\/commands\/engram-coach/);
    expect(publicText).toContain("/skills/*/SKILL.md");
  });

  it("documents registered-space onboarding and durable OMP session selection", async () => {
    const { publicText } = await readPublicFiles();

    expect(publicText).toContain("ENGRAM_BINDING_REGISTRY");
    expect(publicText).toContain("engram.space.json");
    expect(publicText).toContain("ENGRAM_SPACE_ID");
    expect(publicText).toMatch(/space[\s\S]{0,40}registered/);
  });
  it("documents the typed OMP capture tools and never the removed free-form capture tool", async () => {
    const { publicText } = await readPublicFiles();
    expect(publicText).toContain("engram_capture_preview({ change_set })");
    expect(publicText).toContain("engram_capture_apply({ plan_hash })");
    expect(publicText).toContain("engram_status");
  });

  it("ships a capture config example with the fixed shipped limits and an explicit model placeholder", async () => {
    const example = JSON.parse(
      await readFile(resolve(import.meta.dirname, "../config.json.example"), "utf-8"),
    ) as { capture?: { model?: unknown; timeout_seconds?: unknown; max_candidates_per_turn?: unknown } };
    expect(typeof example.capture?.model).toBe("string");
    expect((example.capture?.model as string).length).toBeGreaterThan(0);
    expect(example.capture?.timeout_seconds).toBe(60);
    expect(example.capture?.max_candidates_per_turn).toBe(3);
  });

  it("documents durable session-id identity and the exact canonical entity keys", async () => {
    const { publicText } = await readPublicFiles();
    expect(publicText).toContain("workout:<session-id>");
    expect(publicText).toContain("prescription:<arc-id>:<session-id>");
    expect(publicText).toContain("threshold:<sport>:lt1");
    expect(publicText).toContain("threshold:<sport>:lt2");
    expect(publicText).toContain("persona:<active-profile>");
    expect(publicText).toContain("monitoring:<concern-id>:<signal>");
    expect(publicText).toMatch(/durable `session_id`/);
  });

  it("documents record roles, generated views, and canonical approved reports", async () => {
    const { publicText } = await readPublicFiles();
    for (const role of ["`state`", "`event`", "report-claim"]) {
      expect(publicText).toContain(role);
    }
    expect(publicText).toContain("# GENERATED FROM ENGRAM ACTIVE RECORDS. DO NOT EDIT DIRECTLY.");
    expect(publicText).toContain("<!-- GENERATED FROM ENGRAM ACTIVE RECORDS. DO NOT EDIT DIRECTLY. -->");
    expect(publicText).toContain("never edited directly");
    expect(publicText).toContain("RACE_REPORT.md");
    expect(publicText).toContain("SEASON_REVIEW.md");
  });

  it("documents the dry-run migration command and its four modes in order", async () => {
    const { publicText } = await readPublicFiles();
    expect(publicText).toContain("migrate-structured-capture.ts");
    let cursor = -1;
    for (const mode of ["scan", "apply-baseline", "emit-change-set", "compare"]) {
      cursor = publicText.indexOf(mode, cursor + 1);
      expect(cursor, `migration mode "${mode}" missing or out of order`).toBeGreaterThanOrEqual(0);
    }
  });

  it("documents stale-plan re-preview, index-stale status, and committed-hash view retry", async () => {
    const { publicText } = await readPublicFiles();
    expect(publicText).toContain("index-stale");
    expect(publicText).toContain("same committed hash");
    expect(publicText).toMatch(/stale apply/i);
    expect(publicText).toMatch(/fresh preview/i);
  });

  it("directs a missing capture model at intake or setup instead of inheriting the session model", async () => {
    const { publicText } = await readPublicFiles();
    expect(publicText).toContain("ENGRAM_COACH_CAPTURE_MODEL");
    expect(publicText).toContain("Ambient capture model not configured");
    expect(publicText).toMatch(/never inherited from the interactive session/i);
  });

  it("claims no deterministic capture fallback anywhere on the public surface", async () => {
    const { currentPublicText } = await readPublicFiles();
    // A bare removed-tool name may never appear un-suffixed.
    expect(currentPublicText).not.toMatch(/engram_capture(?![a-zA-Z_])/);
    // Every mention of a deterministic fallback/extractor must be a negation
    // ("no ...", "never ...") — an affirmative claim anywhere means docs are
    // advertising behavior that was deliberately removed.
    for (const match of currentPublicText.matchAll(/[^.!?\n]*deterministic (?:fallback|extractor|extraction)[^.!?]*/gi)) {
      const sentence = match[0];
      expect(
        /\b(?:no|never|not|without)\b/i.test(sentence),
        `public surface affirms a deterministic fallback: "${sentence.trim()}"`,
      ).toBe(true);
    }
  });
});

