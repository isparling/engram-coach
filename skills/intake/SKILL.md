---
name: intake
description: One-time coaching setup. Discovers athlete goals, maps to a coaching persona (or creates one from an existing coach's philosophy), migrates historical adaptation records, and writes config.json. Run this before invoking any other skill for the first time, or when onboarding a new season or athlete.
---

# Coaching Intake

## Overview

Rigid five-phase intake workflow. Establishes everything claw-coach needs to start coaching: goals, persona, prescriptions, and coaching docs path. Phases execute in exact order.

**This skill is RIGID — phases execute in exact order. Do not skip, reorder, or combine phases.**

---

### Pre-Phase Setup _(no user input — run silently)_

Follow **`${CLAUDE_PLUGIN_ROOT}/shared/setup.md`** — the shared configuration
preamble (paths, config, profile, persona, athlete profile).

**Optional steps this skill declares:** SEASON

Do not proceed past a stop condition defined there.


### Phase 1 — Goals

Ask these three questions in a single message:

1. **What is your primary goal?**
   (e.g., race, target event, performance goal, health and fitness maintenance)
2. **What is the target date?**
   (e.g., "May 2, 2026" — or "no specific date / ongoing")
3. **What is your primary sport or modality?**
   (e.g., cycling, running, triathlon, swimming, multi-sport)

After the athlete answers, summarize what was heard in 2-3 sentences. Confirm before continuing.

> If the athlete asks to skip a question, accept a placeholder and continue — do not block on any single field.

---

### Phase 2 — Plan History

Ask: **"Have you been following a formal training plan or working with a coach?"**

---

#### Path A: Existing plan or coach

Ask two questions together:

1. **What is the plan or coach's name?**
   (e.g., "a volume-focused plan", "a sweet-spot base plan", "a polarized coach", "just following a generic program")
2. **Describe their philosophy in a sentence or two.**
   (e.g., "lots of volume, mostly easy Z1/Z2 riding", "hard threshold intervals with minimal easy work", "very conservative — always backed off when tired", "polarized: long easy plus hard VO2max efforts")

Based on the description, recommend one of the four built-in personas. Present all four so the athlete can compare:

```
conservative  — Health-first. HRV veto: if HRV drops, the day is easy regardless of other signals.
                Errs toward rest when signals conflict. Requires high freshness for hard sessions.

aggressive    — Load-maximizing. Tolerates deep fatigue. Weighted scoring — no HRV veto.
                Pushes hard sessions when there is any reasonable basis to train hard.

polarized     — 80/20 intensity split. Long easy sessions in Z1 plus hard VO2max efforts in Z4.
                Eliminates moderate-intensity (sweet spot / tempo) work.

volume        — High-volume aerobic accumulation. 14-day CTL trend window as a primary signal.
                Permissive fatigue tolerance within the full recovery and session-quality picture.
```

State the recommendation and explain why (one sentence connecting the athlete's description to the persona's philosophy).

Ask: **"Does this match the philosophy you've been training under? Or would you like to create a custom persona based on your coach's actual thresholds and approach?"**

- If the athlete accepts a built-in: note the chosen slug for Phase 4.
- If they want a custom persona: say "To create a custom persona, I'll need your coach's specific thresholds and logic. Open `PERSONA_SCHEMA.md` in the claw-coach repo for the required field list — we can fill it in together now, or you can do it separately and set `active_persona` to your new slug in `config.json`." Proceed with intake using a placeholder slug and note in the intake record that the custom persona is pending.

---

Ask: **"Do you have historical coaching records or adaptation notes from this training block?"**

(e.g., notes from the coach, adaptation records you've been keeping, a coaching journal)

- **If yes:** Ask for the directory path where these files live. Then run:
  ```
  cd {path}
  qmd update
  ```
  Note how many files were indexed. Say: "I've indexed {N} documents from {path}. These will be available as reasoning context in future skill invocations."
- **If no:** Say: "No problem — coaching history will be built from this session onward."

---

#### Path B: No formal plan

Ask four questions in a single message to identify the right persona:

1. **When your training signals conflict** (e.g., low HRV but you feel physically ready), do you prefer to back off and protect recovery, or trust how you feel and train hard?
2. **During build periods**, are you comfortable accumulating significant fatigue for weeks at a time, or do you prefer more frequent lighter recovery days?
3. **For hard sessions**, do you prefer polarized training (long easy plus hard VO2max intervals, nothing in between), or mixed-zone work (sweet spot, tempo, threshold)?
4. **Is your primary training concern** injury prevention and long-term health, or maximizing performance at a target event?

Based on answers, apply this mapping:
- Q1 "back off" + Q4 "health" → **conservative**
- Q1 "trust feeling" + Q2 "comfortable with fatigue" + Q4 "performance" → **aggressive**
- Q3 "polarized" → **polarized** (regardless of other answers)
- Q2 "comfortable with significant fatigue" + Q4 "performance" + Q1 "moderate" → **volume**

State the recommendation with a one-sentence explanation connecting the athlete's answers to the persona's philosophy. Ask for confirmation.

---

Ask: **"Do you have a prescription file (training plan YAML) already, or would you like help creating one?"**

- If existing prescription: go to Phase 3A
- If creating new: go to Phase 3B

---

### Phase 3A — Existing Prescription

Ask: **"What is the path to your prescriptions directory?"**
(The directory that contains your training plan YAML files — e.g., `~/code/training/prescriptions/`)

Check that the path exists and contains at least one `.yaml` or `.yml` file.

- If it exists and has YAML files: confirm the directory and list the file(s) found. Note the path for Phase 4.
- If it does not exist or has no YAML files: stop and output:
  > "No prescription files found at `{path}`. Prescription YAMLs define your session-by-session training plan and are required before `adapt-plan` can run. See `PRESCRIPTION_FORMAT.md` in this repo for the schema and an example. Create at least one file there and re-run intake."

---

### Phase 3B — New Prescription (guided creation)

Ask four questions together:

1. **What training block are you starting?**
   (base / build-1 / build-2 / race-specificity)
2. **How many weeks is this block?**
3. **How many training days per week do you plan?**
4. **Which days are key sessions** (high-intensity or long endurance), and which are easy/recovery?

Based on the answers, generate a skeleton YAML. Use this structure (adapt session count and names to match their answers):

```yaml
# {BlockType} — {N}-week block
# Generated by claw-coach intake. Fill in session_date values for each session
# and set power targets. See PRESCRIPTION_FORMAT.md for full field reference.

block_name: {block_slug}  # e.g., build_1, base, race_specificity

sessions:

  # Week 1
  - week: 1
    day: {KeyDay1}
    session_date: YYYY-MM-DD  # replace with actual date
    session_name: W1_KeySession
    total_duration_min: 90     # adjust to your target
    warmup_power_low_pct: 40
    warmup_power_high_pct: 65
    cooldown_power_low_pct: 35
    cooldown_power_high_pct: 45
    intervals:
      - duration_min: 10        # adjust interval length
        power_low_pct: 85       # adjust to block type
        power_high_pct: 92
        count: 3
        recovery_min: 5
        recovery_power_low_pct: 45
        recovery_power_high_pct: 55

  - week: 1
    day: {EasyDay1}
    session_date: YYYY-MM-DD
    session_name: W1_Endurance
    total_duration_min: 120
    effort_zone: Z1-Z2          # simple sessions use effort_zone instead of intervals

  # (repeat pattern for remaining weeks)
  # See PRESCRIPTION_FORMAT.md for all available fields
```

Ask: **"Where should I save this file?"** (e.g., `~/code/training/prescriptions/build_1.yaml`)

Write the skeleton YAML to the specified path. Note the prescriptions directory (parent folder) for Phase 4.

---

### Phase 4 — Configure

Assemble the `config.json` content using values collected during intake:

```json
{
  "_comment": "Generated by claw-coach intake. config.json is gitignored — machine-specific paths are never tracked.",
  "active_profile": "default",
  "profiles": {
    "default": {
      "active_persona": "{chosen-slug}",
      "coaching_docs_dir": "{coaching-docs-path}",
      "prescriptions_dir": "{prescriptions-path}",
      "season": "{season-label}"
    }
  }
}
```

For `season`: derive from the goal date (e.g., "May 2, 2026" → `"2026"`). If no date was given, ask: **"What season label should I use for coaching records?"** (e.g., `"2026"`, `"2026-spring"`)

For `coaching_docs_dir`: if not yet established (no Path A history migration and not previously configured), ask: **"Where should coaching records be written?"** (e.g., `~/code/training/docs/coaching`) Note: create the directory if it does not exist.

Show the assembled config.json content. Ask: **"Does this look correct? I'll write it to `{config_path}`."**

On confirmation:
- Write `{config_path}`
- If `coaching_docs_dir` does not exist on disk, create it: `mkdir -p {coaching_docs_dir}`

---

### Phase 5 — Intake Record

Write `{coaching_docs_dir}/{season}/intake.md`:

```markdown
---
date: {today ISO date}
type: intake
persona: {slug}
goal_event: {goal from Phase 1}
goal_date: {date from Phase 1}
sport: {modality from Phase 1}
prescription: {prescriptions_dir}
---

# Coaching Intake

## Goals

**Event:** {goal}
**Target date:** {date}
**Sport:** {modality}

## Coaching Persona

**Active persona:** {slug} — {one-sentence persona description}

**Selection rationale:** {why this persona was chosen — from Path A recommendation or Path B reasoning}

## Plan History

{If Path A: "Previously on: {plan/coach name}. {Philosophy description}. Mapped to {slug} because {reason}."}
{If Path A + history migration: "Historical coaching records indexed from {path} — {N} documents available via qmd query."}
{If Path B: "No prior formal plan. Persona selected based on intake questionnaire responses."}

## Prescription

**Prescriptions directory:** {path}
**Active block:** {block_name of first/only YAML found, or "pending — skeleton created at {path}"}

## Next Steps

1. Fill in `session_date` values in your prescription YAML if you used the skeleton generator
2. Run `qmd update` in the claw-coach repo after adding coaching docs
3. Invoke `adapt-plan` after completing a key session:
   `Read and follow ./skills/adapt-plan.md`
```

Run `qmd update` in the claw-coach repo to index the intake record.

Output the completion summary:

```
✓ Intake complete

Persona:         {slug}
Goal:            {goal event} — {date}
Prescription:    {prescriptions_dir}
Coaching docs:   {coaching_docs_dir}
Intake record:   {coaching_docs_dir}/{season}/intake.md

Next: Read and follow ./skills/adapt-plan.md after completing a key session.
```
