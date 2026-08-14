---
name: race-analysis
description: Five-phase post-race synthesis. Computes stream-derived race metrics via stream-analyze and race-context CLI tools, gathers athlete narrative (fueling, intent vs execution, surprises), and writes RACE_REPORT.md. Auto-tails lessons-rollup. Requires Intervals.icu MCP and config.json.
---

# Race Analysis

## Overview

Rigid five-phase workflow for analyzing a single race and producing `RACE_REPORT.md`. Combines computed stream analyses (fade, time-in-zone, decoupling, surge response, lap trends, sim comparison) with athlete narrative on fueling, intent, and qualitative experience. All time-series compute happens in CLI tools — no raw streams enter LLM context.

**This skill is RIGID — phases execute in exact order. Do not skip, reorder, or combine phases.**

## Workflow

```dot
digraph race_analysis {
    "Pre-Phase: Setup" [shape=box];
    "P1: Orient" [shape=box];
    "P2: Compute" [shape=box];
    "P3: Gather" [shape=box];
    "P4: Draft" [shape=box];
    "Athlete approves?" [shape=diamond];
    "P5: Write" [shape=box];

    "Pre-Phase: Setup" -> "P1: Orient" -> "P2: Compute" -> "P3: Gather" -> "P4: Draft" -> "Athlete approves?";
    "Athlete approves?" -> "P5: Write" [label="yes"];
    "Athlete approves?" -> "P4: Draft" [label="revise"];
}
```

---

### Pre-Phase Setup _(no user input — run silently)_

Follow **`${CLAUDE_PLUGIN_ROOT}/shared/setup.md`** — the shared configuration
preamble (paths, config, profile, persona, athlete profile).

**Optional steps this skill declares:** SEASON, MCP

Do not proceed past a stop condition defined there.


### Phase 1 — Orient _(no user input)_

Resolve target activity, fetch metadata, identify comparison sims. No streams yet.

1. **Resolve target activity:**
   - If athlete provided an activity ID, use it.
   - Otherwise, call `get_recent_activities(limit=10)`. Filter to race-typed or athlete-flagged-as-race entries. If exactly one candidate, confirm with athlete:
     > "Analyzing {activity_name} ({date}, {distance}km, {duration}). Correct?"
   - If multiple candidates, list them and ask the athlete to pick.

2. Call `get_activity_details(activity_id)` to extract: name, type, start time, distance, duration, FTP at time of activity.

3. Call `get_calendar_events` over a 14-day window centered on the race date. Identify the prescription targeting this race (look for matching event name, date, or `is_race: true` flag in YAML frontmatter). If found, read the prescription file and note the target zones, planned duration, planned fueling.

4. **Identify comparison sims:** call `get_recent_activities(days_back=42, limit=50)`, filter to:
   - Saturday activities
   - Within the date range of the immediately-preceding Race Specificity block (resolve from prescriptions_dir naming)
   - Duration ≥ 60% of race duration
   Take the 3 most recent matching activities. For each, call `get_activity_details` to extract `np`, `avg_hr`, `decoupling_pct` (set to 0 if not present — sim_compare handles missing decoupling), `duration_sec`, `start_date`. Build the `ActivitySummaryForCompare` array.

5. **Decide segmentation strategy:** if `duration_sec > 6 * 3600` → hourly (omit `--fade-segments` to use default), else `--fade-segments=4`.

6. **Announce findings:**
   > "Race identified: {name}, {duration}, FTP {ftp}W.
   > Prescription: {found / not found}.
   > Comparison sims: {N} found ({list dates}).
   > Segmentation: {hourly / quartiles}."

---

### Phase 2 — Compute _(no user input — shells out)_

Run two CLIs and capture their JSON output. NO raw stream data enters LLM context — only the parsed summaries.

1. **Build sim-compare target file (if sims found):**

   Call `get_activity_streams(activity_id)` for the target activity to compute its NP and avg HR via the stream-analyze tool itself, OR fetch via `get_activity_details` if available. (Prefer details — avoids a stream fetch.)

   Write `/tmp/sim-target-{race_id}.json`:
   ```json
   { "activity_id": "{race_id}", "date": "{race_date}", "np": {...}, "avg_hr": {...}, "decoupling_pct": 0, "duration_sec": {...} }
   ```

   Write `/tmp/sim-sims-{race_id}.json` as the array built in Phase 1 step 4.

2. **Run stream-analyze:**

   ```bash
   cd ${CLAUDE_PLUGIN_ROOT}/tools && npx tsx stream-analyze.ts \
     --activity-id={race_id} \
     --analyses=fade,time_in_zone,np_distribution,decoupling,hr_recovery,interval_cv,sim_compare,lap_trends \
     --ftp-override={ftp} \
     {--fade-segments=4 if quartiles, else omit} \
     {--sim-compare-target=/tmp/sim-target-{race_id}.json --sim-compare-sims=/tmp/sim-sims-{race_id}.json if sims found, else omit}
   ```

3. **Run race-context:**

   ```bash
   cd ${CLAUDE_PLUGIN_ROOT}/tools && npx tsx race-context.ts --activity-id={race_id}
   ```

4. **Assemble bundle:** parse both JSON outputs. For any analysis present in `output.errors`, drop it from the bundle and note the error for the draft phase.

5. **Announce health check (one line):**
   > "Compute complete. {N of 8} analyses succeeded, race-context loaded ({weather present / weather absent})."

---

### Phase 3 — Gather _(one question at a time — wait for each answer before asking the next)_

1. **Fueling timeline:**
   > "Walk me through what you ate and drank during the race — roughly when, what, and how much. Anything you missed or struggled with?"

2. **Race intent vs execution:**
   > "What was your plan going in? Where did you stick to it, and where did you deviate — deliberately or otherwise?"

3. **Where it got hard:**
   > "When did the race start to feel hard? What did 'hard' mean — legs, breathing, motivation, fueling, something else?"

4. **Surprises:**
   > "What surprised you, positively or negatively?"

5. **Off-record context:**
   > "Anything else from race day or the days leading in that the data wouldn't capture? Sleep, illness, weather acclimation, equipment, pre-race stress."

---

### Phase 4 — Draft _(shown to athlete)_

Render the full `RACE_REPORT.md` using `templates/race-report.md` as the skeleton. Fill every section from the Phase 2 bundle and Phase 3 answers. Annotate any sections that were dropped due to errors (e.g., "Decoupling not computed — duration <45min").

Show the complete draft to the athlete. Iterate until explicitly approved.

---

### Phase 5 — Write _(with approval)_

1. Build the event slug: lowercase, hyphenated, from the activity name. Example: "Example Gravel Event" → `example-gravel-event`.

2. Create the directory:
   ```bash
   mkdir -p {coaching_docs_dir}/{season}/races/{YYYY-MM-DD}-{event-slug}/
   ```

3. Write the approved `RACE_REPORT.md` to that directory.

4. **Auto-tail lessons-rollup:** invoke the `lessons-rollup` skill with:
   - `--source=race:{event-slug}`
   - The bullets from the report's "Calibration Points for Future Blocks" section as the append list.

   If the rollup is purely additive, it auto-writes. Otherwise it shows the diff and gates on athlete approval.


5. **QMD index update:**
   ```bash
   qmd update && qmd embed
   ```

---

## Key Constraints

| Rule | Detail |
|------|--------|
| Rigid phases | Execute in order — no skipping, reordering, or combining |
| Approval gate | Nothing written until Phase 4 draft explicitly approved |
| One question at a time | Phase 3 never batches questions |
| No raw streams in context | All time-series math runs in stream-analyze; skill consumes condensed JSON |
| Partial-data tolerance | Missing analyses (e.g., decoupling on short events, sim_compare with no sims) annotate and skip rather than failing the report |
| Auto-tail rollup | Phase 5 invokes lessons-rollup; non-additive diffs gate on approval |
