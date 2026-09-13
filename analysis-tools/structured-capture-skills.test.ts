/**
 * Skill-contract assertions for the structured capture cutover.
 *
 * These tests read the shipped `SKILL.md` files as text and pin the workflow
 * contract each one must document: typed preview/apply tools, exact plan-hash
 * approval, stale-apply recovery, and the absence of direct writes to what are
 * now generated compatibility views.
 *
 * Each cut-over skill owns one `describe` block below. Assertions are on
 * documented workflow, not prose style: a rewrite that keeps the contract
 * passes, and a rewrite that quietly restores a direct write fails.
 */

import { readFile } from "node:fs/promises";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { join } from "node:path";

const SKILLS_ROOT = join(import.meta.dirname, "..", "skills");

/** Read one skill's shipped instructions. */
export async function readSkill(name: string): Promise<string> {
  return readFile(join(SKILLS_ROOT, name, "SKILL.md"), "utf8");
}

/**
 * Direct-write patterns that must not survive the cutover in any skill whose
 * artifacts became generated compatibility views.
 */
export const FORBIDDEN_DIRECT_WRITE_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
  { label: "bare qmd update", pattern: /(^|[^\w-])qmd\s+update(?![\w-])/m },
  { label: "mkdir", pattern: /(^|[^\w-])mkdir(?![\w-])/m },
  { label: "touch", pattern: /(^|[^\w-])touch\s+\S/m },
];

describe("set-goal skill contract", () => {
  const SET_GOAL_FORBIDDEN_DIRECT_WRITE_PATTERNS: ReadonlyArray<{ label: string; pattern: RegExp }> = [
    ...FORBIDDEN_DIRECT_WRITE_PATTERNS,
    { label: "per-sub-block prescription YAML write instruction", pattern: /for each sub-block,\s*write[^]*?\.yaml/i },
    { label: "legacy per-sub-block prescription path template", pattern: /\{prescriptions_dir\}\/\{arc_name\}_\{sub_block_name\}\.yaml/ },
    { label: "consultations scaffold write", pattern: /scaffold consultations\.md|\{sub_block_name\}-consultations\.md/i },
    { label: "empty consultations scaffold body", pattern: /_\(empty — append entries/i },
  ];

  let skill: string;
  beforeAll(async () => {
    skill = await readSkill("set-goal");
  });

  it("keeps arc-overview and methodology documents canonical while conclusions become records", () => {
    // Canonical reports remain hand-written approved documents.
    expect(skill).toMatch(/arc-overview/i);
    expect(skill).toMatch(/methodology/i);
    expect(skill).toMatch(/canonical|approved document/i);
    // Structured conclusions are emitted explicitly as records, not only prose.
    expect(skill).toMatch(/report_claims|report claims|structured conclusion/i);
    expect(skill).toMatch(/arc-conclusion|methodology-conclusion/i);
  });

  it("requires a complete-graph change set with durable stable session ids", () => {
    // Durable session ids generated ONCE and reused across every state item
    // and narrative reference; date/week/title are mutable attributes.
    expect(skill).toMatch(/session_id/i);
    expect(skill).toMatch(/durable/i);
    expect(skill).toMatch(/once/i);
    expect(skill).toMatch(/reschedul/i);
    // Prescription identity binds BOTH the arc id and the session id.
    expect(skill).toMatch(/arc_id/i);
    // Full prescription values plus explicit arc and methodology report
    // claims for every session — no record internals chosen by the skill.
    expect(skill).toMatch(/change set|changeset|structured change/i);
    // The skill must explicitly disclaim ownership of record internals.
    expect(skill).toMatch(/never assigns record IDs|never choose[s]? record IDs|pack derives them at preview/i);
  });

  it("requires the preview/hash/apply approval flow", () => {
    expect(skill).toMatch(/engram_capture_preview/);
    expect(skill).toMatch(/engram_capture_apply/);
    expect(skill).toMatch(/plan hash/i);
    expect(skill).toMatch(/stale/i);
    // One approval binds documents, record mutations, and generated paths.
    expect(skill).toMatch(/materializ/i);
  });

  it("forbids direct writes to generated compatibility views", () => {
    for (const { label, pattern } of SET_GOAL_FORBIDDEN_DIRECT_WRITE_PATTERNS) {
      expect({ label, matched: pattern.test(skill) }).toEqual({ label, matched: false });
    }
  });
});

describe("consult skill contract", () => {
  let skill: string;
  beforeEach(async () => {
    skill = await readSkill("consult");
  });

  it("names both typed capture tools", () => {
    expect(skill).toContain("engram_capture_preview");
    expect(skill).toContain("engram_capture_apply");
  });

  it("names the StructuredChangeSet domain input", () => {
    expect(skill).toContain("StructuredChangeSet");
  });

  it("requires the exact plan hash in Phase 4 approval", () => {
    const phase4 = skill.slice(skill.indexOf("Phase 4"));
    expect(phase4).toContain("plan_hash");
  });

  it("handles a stale apply by returning to preview for fresh approval", () => {
    expect(skill).toMatch(/stale/i);
    expect(skill).toMatch(/stale[\s\S]{0,400}preview/is);
  });

  it("no longer instructs direct writes to generated compatibility views", () => {
    for (const { label, pattern } of FORBIDDEN_DIRECT_WRITE_PATTERNS) {
      expect({ [label]: pattern.test(skill) }).toEqual({ [label]: false });
    }
    expect(skill).not.toMatch(/append.{0,80}consultations\.md/is);
    expect(skill).not.toMatch(/apply approved changes to the relevant prescription YAML/i);
  });
});
describe("report skill contracts", () => {
  // Per-skill phase headings: block-review has a four-phase workflow
  // (Draft = Phase 3, Write = Phase 4); race-analysis and
  // season-retrospective have five phases (Draft = Phase 4, Write = Phase 5).
  const REPORT_SKILLS: ReadonlyArray<{
    name: string;
    conclusions: RegExp;
    draft: RegExp;
    write: RegExp;
  }> = [
    { name: "race-analysis", conclusions: /^Phase 3/, draft: /^Phase 4/, write: /^Phase 5/ },
    { name: "block-review", conclusions: /^Phase 3/, draft: /^Phase 3/, write: /^Phase 4/ },
    { name: "season-retrospective", conclusions: /^Phase 3/, draft: /^Phase 4/, write: /^Phase 5/ },
  ];

  function phaseSection(skill: string, text: string, phaseHeading: RegExp): string {
    const sections = text.split(/^### /m);
    const match = sections.find((section) => phaseHeading.test(section.split("\n")[0] ?? ""));
    if (match === undefined) throw new Error(`${skill}: missing phase matching ${phaseHeading}`);
    return match;
  }

  for (const { name: skill, conclusions, draft, write } of REPORT_SKILLS) {
    it(`${skill}: synthesis phase forms explicit atomic conclusions`, async () => {
      const text = await readSkill(skill);
      const section = phaseSection(skill, text, conclusions);
      expect(section).toMatch(/explicit/i);
      expect(section).toMatch(/report_claims|report claims|conclusion/i);
      // Each conclusion names its exact state key components, effective
      // time, source document path, statement, and structured value.
      expect(section).toMatch(/key_components|key components/i);
      expect(section).toMatch(/effective_at|effective time/i);
      expect(section).toMatch(/source_document|source document/i);
      expect(section).toMatch(/statement/i);
      expect(section).toMatch(/details|structured value/i);
    });

    it(`${skill}: draft phase previews records alongside the full report under ONE approval`, async () => {
      const text = await readSkill(skill);
      const draftPhase = phaseSection(skill, text, draft);
      expect(draftPhase).toMatch(/engram_capture_preview|previewStructuredCapture|capture preview/i);
      expect(draftPhase).toMatch(/full (draft )?report|RACE_REPORT\.md|SUMMARY\.md|SEASON_REVIEW\.md/i);
      expect(draftPhase).toMatch(/one approval|same approval|single approval/i);
    });

    it(`${skill}: write phase writes the canonical report FIRST, then applies the approved hash`, async () => {
      const text = await readSkill(skill);
      const writePhase = phaseSection(skill, text, write);
      const writeAt = writePhase.search(/RACE_REPORT\.md|SUMMARY\.md|SEASON_REVIEW\.md/);
      const applyAt = writePhase.search(/engram_capture_apply/);
      expect(writeAt).toBeGreaterThanOrEqual(0);
      expect(applyAt).toBeGreaterThan(writeAt);
      // A failed document write stops the workflow before any record apply.
      expect(writePhase).toMatch(/stop|abort|fail/i);
      expect(writePhase).toMatch(/plan hash|approved hash|exact.*hash/i);
      expect(writePhase).toMatch(/staleness|stale/i);
    });

    it(`${skill}: ambient extraction is never the report-conclusion path`, async () => {
      const text = await readSkill(skill);
      expect(text).not.toMatch(/\bambient\b/i);
    });

    it(`${skill}: lessons-rollup runs only after BOTH document and claims succeed`, async () => {
      const text = await readSkill(skill);
      const writePhase = phaseSection(skill, text, write);
      // Scoped to the write phase so frontmatter/prose mentions of
      // lessons-rollup elsewhere in the skill cannot skew the ordering.
      const rollupAt = writePhase.search(/lessons-rollup/);
      const applyAt = writePhase.search(/engram_capture_apply/);
      expect(applyAt).toBeGreaterThanOrEqual(0);
      expect(rollupAt).toBeGreaterThan(applyAt);
    });
  }
});

describe("adapt-plan skill contract", () => {
  const EXTRA_FORBIDDEN: ReadonlyArray<{ label: string; pattern: RegExp }> = [
    { label: "shell redirect write into a compatibility view", pattern: /(^|[^\w-])(cat|echo|printf)\b[^;\n]*>{1,2}\s*[^ \n;]*\.(md|yaml|yml)\b/m },
    { label: "tee into a file", pattern: /(^|[^\w-])tee\s+\S/m },
    { label: "writeFile call", pattern: /writeFile\s*\(/m },
  ];

  it("documents the typed preview/apply tools and the structured change set", async () => {
    const skill = await readSkill("adapt-plan");
    expect(skill).toContain("engram_capture_preview");
    expect(skill).toContain("engram_capture_apply");
    expect(skill).toContain("StructuredChangeSet");
  });

  it("binds Phase 4 approval to the exact plan hash", async () => {
    const skill = await readSkill("adapt-plan");
    expect(skill).toMatch(/plan_hash|plan hash/i);
    expect(skill).toMatch(/exact/i);
  });

  it("handles a stale apply by returning to preview for fresh approval", async () => {
    const skill = await readSkill("adapt-plan");
    expect(skill).toMatch(/stale/i);
    expect(skill).toMatch(/re-preview|fresh preview|return to (the )?preview|back to (the )?preview|return to phase 4[^.\n]*re-run .engram_capture_preview/i);
  });

  it("no longer instructs direct writes to generated compatibility views", async () => {
    const skill = await readSkill("adapt-plan");
    for (const { label, pattern } of [...FORBIDDEN_DIRECT_WRITE_PATTERNS, ...EXTRA_FORBIDDEN]) {
      expect(skill, `adapt-plan must not instruct: ${label}`).not.toMatch(pattern);
    }
  });
});

describe("monitoring skill contracts", () => {
  /**
   * Monitoring logs and doctor-prep summaries are generated compatibility
   * views after the Task 12 cutover. The legacy skill appended table rows at
   * a `TRACK:APPEND-HERE` anchor, wrote logs to disk mid-workflow, and ran a
   * bare `qmd update && qmd embed` — none of that may survive.
   */
  const MONITORING_FORBIDDEN: ReadonlyArray<{ label: string; pattern: RegExp }> = [
    { label: "append-anchor direct log edit", pattern: /TRACK:APPEND-HERE/ },
    { label: "in-skill disk write of the concern log", pattern: /write the log to disk/i },
    { label: "literal row insertion instruction", pattern: /insert the row\(s\) as Markdown table rows/i },
    { label: "bare qmd update", pattern: /(^|[^\w-])qmd\s+update(?![\w-])/m },
    { label: "mkdir", pattern: /(^|[^\w-])mkdir(?![\w-])/m },
    { label: "touch", pattern: /(^|[^\w-])touch\s+\S/m },
  ];

  /** Text between two headings. */
  function section(text: string, start: RegExp, end?: RegExp): string {
    const from = text.search(start);
    if (from < 0) throw new Error(`missing section matching ${String(start)}`);
    const rest = text.slice(from);
    const to = end === undefined ? rest.length : rest.slice(1).search(end);
    return to < 0 ? rest : rest.slice(0, to + 1);
  }

  it("monitoring-rollup: forbids direct monitoring-log append and doctor-prep overwrite", async () => {
    const skill = await readSkill("monitoring-rollup");
    for (const { label, pattern } of MONITORING_FORBIDDEN) {
      expect(skill, `monitoring-rollup must not instruct: ${label}`).not.toMatch(pattern);
    }
    expect(skill).toMatch(/generated compatibility view|GENERATED FROM ENGRAM ACTIVE RECORDS/i);
    expect(skill).toMatch(/never\s+edited?\s+.{0,40}directly/i);
  });
  it("monitoring-rollup: contribution mode RETURNS state_changes/events and never previews or applies", async () => {
    const skill = await readSkill("monitoring-rollup");
    const contribution = section(skill, /###? .*CONTRIBUTION MODE/i, /###? .*STANDALONE MODE/i);
    expect(contribution).toMatch(/state_changes/);
    expect(contribution).toMatch(/events/);
    expect(contribution).toMatch(/return/i);
    expect(contribution).toMatch(/entity_type[`"': ]*monitoring/i);
    expect(contribution).toMatch(/monitoring-event/);
    // Contribution mode never touches the capture tools or writes anything.
    expect(contribution).not.toMatch(/engram_capture_preview|engram_capture_apply/);
    expect(contribution).toMatch(/never (?:calls |runs )?(?:engram_capture_)?preview/i);
    expect(contribution).toMatch(/never\s+appl/i);
  });

  it("monitoring-rollup: standalone mode runs its own preview/approval/apply with an exact plan hash", async () => {
    const skill = await readSkill("monitoring-rollup");
    const standalone = section(skill, /###? .*STANDALONE MODE/i);
    expect(standalone).toMatch(/engram_capture_preview/);
    expect(standalone).toMatch(/engram_capture_apply/);
    expect(standalone).toMatch(/plan_hash/);
    expect(standalone).toMatch(/stale/i);
    // The due-signal identity contract: keyed current state PLUS an
    // append-only observation event with source and effective time.
    expect(skill).toContain("monitoring:<concern-id>:<signal>");
    expect(skill).toMatch(/append-only monitoring event/i);
    expect(skill).toMatch(/source/i);
    expect(skill).toMatch(/effective time|effective_at/i);
  });
  for (const [name, sourceTag] of [

    ["consult", "consult:"],
    ["adapt-plan", "adapt:"],
  ] as const) {
    it(`${name}: merges due monitoring contributions BEFORE the Phase 4 preview`, async () => {
      const skill = await readSkill(name);
      const phase3 = section(skill, /###\s*Phase 3/, /###\s*Phase 4/);
      expect(phase3).toMatch(/monitoring-rollup/i);
      expect(phase3).toMatch(/CONTRIBUTION MODE|contribution mode/i);
      expect(phase3).toMatch(/state_changes/);
      expect(phase3).toMatch(/events/);
      expect(phase3).toMatch(/merge|merged/i);
      // Empty result must stay empty in the SAME change set — no second preview.
      expect(phase3).toMatch(/no concern is active or due|empty arrays/i);
      // The single preview covers everything; approval names one plan hash.
      const phase4 = section(skill, /###\s*Phase 4/, /###\s*Phase 5/);
      expect(phase4).toMatch(/one preview|single preview|ONE preview|same change set|merged change set/i);
      expect(phase4).toMatch(/plan_hash/);
      // Post-approval auto-tail is gone: no invocation AFTER Phase 5 apply.
      const phase5 = section(skill, /###\s*Phase 5/);
      expect(phase5).not.toMatch(/monitoring-rollup/i);
      expect(skill).not.toContain(`--source=${sourceTag}`);
      expect(skill).not.toMatch(/Auto-tail monitoring-rollup/i);
    });
  }
});
