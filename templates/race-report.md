# {Event Name} — Race Report
**Date:** {YYYY-MM-DD}  **Persona:** {active_persona}  **Block context:** {ending block name}
**Result:** {finishing time / position / outcome — from athlete}
**Goal:** {original goal for the race — from intake or athlete}

## Race Context
{distance, elevation gain, weather, course type — from race-context tool. If weather is null, write "weather data not available for this activity".}

## Performance Summary
| Metric | Value | Notes |
|---|---|---|
| Duration | | |
| NP / Avg watts / VI | | |
| Avg HR / Max HR | | |
| Decoupling | | (or "not computed — duration <45min") |
| Fade (NP slope per hour) | | |

## Pacing & Fade by Segment
{Render fade.segments table — columns: label, NP, avg HR, EF, duration_sec.}
{Narrative: where the largest_drop occurred and what likely caused it. Reference the segment label, not "second half".}

## Time in Zone
{Render time_in_zone.zones table — columns: zone, pct, seconds.}
{Narrative: was distribution consistent with the race plan? Reference the prescription's target zones if available.}

## Lap-by-Lap
{If the activity has laps, render the full lap_trends.laps table — columns: n, sec, avg_w, np, avg_hr, max_hr, is_rest. Do NOT truncate.}
{Lap-trends summary: power_slope_w_per_lap, hr_drift_bpm_per_lap, fastest_lap, slowest_lap, first/middle/last third averages, regime_breaks.}
{If no laps in the activity, write "Continuous-effort event — no lap markers." and skip the section.}

## Comparison to Race-Specificity Sims
{If sim_compare.comparisons is non-empty, render table — columns: sim_date, np_delta_pct, hr_delta_bpm, decoupling_delta_pct, duration_delta_min.}
{Narrative: did sims predict the race? Where did execution diverge most?}
{If empty, write "No race-specificity sims found in preceding 6 weeks."}

## Surge Response
{Render hr_recovery.intervals if present: index, end_hr, drop_60s, drop_120s. Plus the trend.}
{Narrative: how surge recovery compared to past races / late-block sims.}

## Fueling & Hydration
{Athlete-provided timeline from Phase 3 question 1 — render as a list with approximate times and intake.}
{Correlation note: if specific fueling gaps align with fade segments or HR drift, call it out explicitly.}

## Race Intent vs Execution
{From Phase 3 question 2 — what was the plan, where it held, where it deviated, and why.}

## Athlete Perspective
{Narrative from Phase 3 questions 3-5 — where it got hard, surprises, off-record context. Written in athlete's voice.}

## Calibration Points for Future Blocks
{LLM-extracted bullets, 3-7 items max. Each is a durable, queryable lesson — e.g., "fueling protocol of 90g carb/hr validated up to 7h race duration". These are passed verbatim to lessons-rollup.}
