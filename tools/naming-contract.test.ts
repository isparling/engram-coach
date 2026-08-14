/**
 * Documentation-contract test.
 *
 * Every public metadata and documentation surface must expose only Engram
 * Coach naming — no retired `claw-coach` branding, `CLAW_COACH_CONFIG`, or
 * `PEIGS_HARNESS` references — and must document the published package,
 * config env var, and OMP adapter names. The one permitted historical
 * reference is the literal manual migration command
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
  "./package.json",
  "./package-lock.json",
];

describe("naming contract", () => {
  it("exposes only Engram Coach public naming across docs and metadata", async () => {
    const contents = await Promise.all(
      PUBLIC_FILES.map((path) => readFile(resolve(import.meta.dirname, path), "utf-8")),
    );
    const publicText = contents.join("\n");

    const currentPublicText = publicText.replaceAll("mv .claw-coach .engram-coach", "");

    expect(currentPublicText).not.toMatch(/claw-coach/i);
    expect(currentPublicText).not.toMatch(/CLAW_COACH_CONFIG/);
    expect(currentPublicText).not.toMatch(/PEIGS_HARNESS/);
    expect(publicText).toContain("@isparling/engram-coach");
    expect(publicText).toContain("ENGRAM_COACH_CONFIG");
    expect(publicText).toContain("@isparling/engram-omp");
  });
});
