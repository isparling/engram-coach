---
name: monitoring-rollup
description: Capture due monitoring-concern observations as typed Engram records and let the apply pipeline regenerate each concern's monitoring log and Doctor-Prep Summary. Runs in CONTRIBUTION mode (returns state_changes/events to a parent skill's single change set) or STANDALONE mode (its own preview → approval → apply). Requires config.json and a tracking/concerns.yaml registry.
---

# Monitoring Rollup

## Overview

Rigid phased workflow for longitudinal tracking of declared **monitoring
concerns** — chronic symptoms/issues tracked over time so an eventual
clinician visit is well-armed with data. Observations are captured as
structured Engram records; each concern's monitoring log and its curated
Doctor-Prep Summary are **generated compatibility views** that the apply
pipeline renders deterministically from those records.

**Generic:** all athlete-specific declarations live in
`{coaching_docs_dir}/tracking/concerns.yaml`. Each entry declares at minimum:
`id`, `active`, `cadence_days`, the concern's `log` view path, `fields`
(the controlled columns for entries), optional `record_negatives`, and
optional `escalation_triggers`. This skill contains no concern-specific
knowledge.

**This skill is RIGID — phases execute in exact order. Do not skip, reorder,
or combine phases.**

Monitoring logs and Doctor-Prep Summaries carry the byte-exact warning header
(`GENERATED FROM ENGRAM ACTIVE RECORDS. DO NOT EDIT DIRECTLY.`) and are never
edited directly by this skill or any other. The ONLY durable mutation path is
an approved capture plan applied through the tools.

## Invocation Modes

Pick exactly one:

1. **CONTRIBUTION MODE** — invoked by a parent skill (`consult`,
   `adapt-plan`) during that parent's Phase 3. Read the registry, gather due
   concerns, and **return typed monitoring items only**. Never previews,
   never applies, never writes.
2. **STANDALONE MODE** — manual invocation (athlete asks to "log monitoring"
   or run a roll-up). Iterate all active concerns regardless of staleness and
   run the full preview → approval → apply protocol itself.
3. **RE-CURATE** — athlete asks to re-curate after reviewing data. Read-only
   on records: no capture, no new items. Regeneration happens through
   materialization only (see Re-curate below).

---

### Pre-Phase Setup _(no user input — run silently)_

Follow **`${CLAUDE_PLUGIN_ROOT}/shared/setup.md`** — the shared configuration
preamble (paths, config, profile, persona, athlete profile).

**Optional steps this skill declares:** MONITORING

Do not proceed past a stop condition defined there.

### Phase 1 — Detect _(all modes except RE-CURATE)_

For each ACTIVE concern in the registry, find the most recent observation
date among its records (or its generated log view) and compute
`days_since = today − last_date`.

Mark a concern **due** when EITHER `days_since ≥ cadence_days`, OR the skill
is in STANDALONE mode.

Announce one line per concern:
`{name}: last logged {date} ({N}d ago) — {DUE | current}`.

If no concern is active or due, CONTRIBUTION MODE returns empty arrays to the
caller (see below); STANDALONE MODE exits cleanly as a no-op.

### Phase 2 — Gather _(skipped in RE-CURATE; one question at a time)_

For each **due** concern (STANDALONE: all active), ask `concern.prompt`.
Capture structured values for `concern.fields`, using the log view's legend
as the soft vocabulary.

Branches:
- **Nothing to report** and `record_negatives: true` → record a negative
  observation: date = today, status/note = "checked — asymptomatic".
- **Notable flare** → capture the full row; fold extra detail into the note.

**Ask one question at a time. Wait for each answer before asking the next.**

---

### Contribution Mode

Used by `consult` and `adapt-plan` inside their Phase 3. After Phase 2
gathering, convert every captured observation into typed items and **return
them to the caller** — nothing else. This mode never previews, never
applies, and never writes any file. Return two arrays:

1. **Current state — one per due concern/signal pair** (`state_changes`):
   - `entity_type`: `"monitoring"`
   - `key_components`: `{ "concern_id": "<registry id>", "signal": "<field>" }`
     — the pack derives the canonical key `monitoring:<concern-id>:<signal>`
   - `effective_at`: the observation date
   - `statement`: concise current-status sentence
   - `details`: `{ concernId, signal, status, note }`

2. **Observation history — one per captured observation** (`events`):
   - `entity_type`: `"monitoring-event"`
   - `effective_at`: the observation's effective time
   - `statement`: what was observed
   - `action_targets`: `[]`
   - `details`: `{ concernId, signal, status?, note?, source, observedAt }`
     where `source` is the caller tag (e.g. `consult:2026-06-17`,
     `adapt:build-1-w3-thu`) and `observedAt` the effective time

These are **append-only monitoring events**: they never replace or supersede
anything. Only the keyed state item participates in supersession.

The parent merges both arrays into ITS OWN `StructuredChangeSet` BEFORE its
Phase 4 preview, so ONE plan hash and ONE approval cover the prescription
change, the coaching event, and all due monitoring changes together. If no
concern is active or due, return EMPTY arrays — the parent merges them and
continues with a single preview; no second preview is ever produced.

---

### Standalone Mode

#### Phase 3 — Preview

Assemble the gathered items into one `StructuredChangeSet` using exactly the
shapes documented under Contribution Mode (same `entity_type`, key
components, statement, and details contracts). Then call
`engram_capture_preview` with it.

If the preview returns blocked, STOP: Phase 4 cannot proceed until the input
is corrected and a preview succeeds.

#### Phase 4 — Approval _(requires explicit approval)_

Present TOGETHER, in one message:

1. What was captured — per concern: the observation(s) and the resulting
   current status.
2. The record plan from the preview: which monitoring states will be created
   or superseded, which events will append.
3. The generated compatibility view paths that will regenerate (the concern
   logs and the Doctor-Prep Summary).
4. The exact `plan_hash` from the preview result.

Ask for approval. Approval must explicitly cover BOTH the recorded
observations AND the record/artifact plan identified by that exact
`plan_hash`.

Wait for explicit approval, rejection, or modification. On modification,
rebuild the change set, re-run `engram_capture_preview`, and present the new
hash.

#### Phase 5 — Apply _(with approved hash)_

Call `engram_capture_apply` with ONLY the exact approved `plan_hash`. Never
edit any file directly — the apply pipeline commits the records, refreshes
the guarded index, and regenerates every monitoring log view and the
Doctor-Prep Summary.

Outcome handling:

- **stale**: the records changed since preview. Return to Phase 3:
  re-run `engram_capture_preview`, present the fresh plan and new
  `plan_hash`, and obtain fresh approval before applying again.
- **apply failure**: stop. No view is written and none may be edited by
  hand; diagnose and retry through the tools.
- **committed with stale views**: the records ARE authoritative. Re-calling
  `engram_capture_apply` with the SAME committed `plan_hash` in the same
  session reruns ONLY materialization — it never re-approves or re-applies
  record mutations.
- **committed clean**: report the applied record IDs and regenerated paths.

#### Escalation scan _(both contribution and standalone, after capture)_

Evaluate each declared trigger in `escalation_triggers` generically against
the concern's recent observations: trend triggers flag when a numeric field
moves adversely across recent points (fewer than three parseable points → no
flag, never a false alarm); boolean/observed triggers flag when any recent
observation reports the condition. Surface any MET trigger prominently:
`⚠ {concern}: {trigger} — consider clinical evaluation.` The scan informs
the announcement only; the Doctor-Prep Summary itself is rendered
deterministically from the committed records.

### RE-CURATE

Read-only on records. There is nothing to hand-edit: views regenerate from
records on every apply. If views are stale (e.g. a prior apply reported
stale artifacts), re-run `engram_capture_apply` with that session's last
committed `plan_hash` — materialization retries idempotently. Never rewrite
a log or summary by hand.

---

## Key Constraints

| Rule | Detail |
|------|--------|
| Generic skill | No concern-specific knowledge here; everything is driven by `concerns.yaml` |
| No-op safety | Absent/empty registry or nothing due → clean no-op; never blocks a calling skill |
| Contribution mode returns, never writes | Typed `state_changes`/`events` go back to the caller; no preview, no apply, no file writes |
| One approval | Parent-skill contributions merge into the parent's SINGLE change set — one preview, one `plan_hash` |
| Keyed state + append-only events | Due signals use `monitoring:<concern-id>:<signal>` for current state plus distinct append-only monitoring events carrying source and effective time |
| Generated views | Monitoring logs and Doctor-Prep Summaries are regenerated compatibility views; never edited directly |
| Record negatives | When `record_negatives: true`, "checked — asymptomatic" observations are logged (clinically meaningful) |
| One question at a time | Phase 2 never batches questions |
| Stale apply | Always returns to preview for a fresh hash and fresh approval |
