# Analysis Catalog

Reference for all available stream analyses. Personas select from this catalog by key. The adapt-plan skill uses MCP tool mappings and data requirements from this file to execute analyses during Orient phase.

---

## How to Read This Catalog

Each analysis defines:

| Field | Purpose |
|-------|---------|
| **Key** | Stable identifier used in persona `analyses` config |
| **Description** | What the analysis measures and why a coach would use it |
| **MCP Tools** | Which Intervals.icu MCP tool calls are required |
| **Required Data** | Stream types, minimum session duration, sport applicability |
| **Output** | What the analysis produces (metric type, unit) |
| **Typical Thresholds** | Default threshold ranges — personas override these |

---

## `aerobic_decoupling`

**Description:** Compares efficiency factor (power:HR or pace:HR ratio) in the first half of a steady-state effort versus the second half. A positive decoupling percentage means HR is drifting upward relative to output — the aerobic system is struggling to sustain the effort. Measured over the main body of the session (excluding warmup/cooldown).

**Data Source:**
- `stream-analyze` CLI tool (`--analyses decoupling`) — retrieves watts and heartrate streams via Intervals.icu REST API, computes decoupling in-process, returns compact JSON. Raw streams never enter LLM context.

**Required Data:**
- Power and heartrate streams available on the activity
- Session duration > 45 minutes (shorter sessions produce unreliable decoupling)
- Steady-state or sub-threshold effort (interval sessions are not candidates)

**Output:**
- Decoupling % (float): `((EF_first_half - EF_second_half) / EF_first_half) * 100`
- Positive = HR drifting up relative to output (worse)
- Negative = HR stable or improving (better)

**Typical Thresholds:**
- < 3%: normal, aerobic system sustaining
- 3-5%: mild drift, watch trend across sessions
- 5-8%: meaningful drift, volume ceiling approaching
- \> 8%: significant aerobic strain, session duration exceeding capacity

**Sport Applicability:** Cycling (power:HR), running (pace:HR), any sport with continuous output + HR

---

## `hr_recovery_curve`

**Description:** Measures how quickly heart rate drops after the end of hard efforts within a session. Calculated as bpm drop in the first 60 seconds and 120 seconds after each identifiable interval ends. Faster recovery indicates better cardiac fitness and freshness; declining recovery rate across intervals within a session indicates within-session fatigue accumulation.

**Data Source:**
- `stream-analyze` CLI tool (`--analyses hr_recovery`) — retrieves heartrate stream and interval boundaries via Intervals.icu REST API, computes recovery drops in-process, returns compact JSON.

**Required Data:**
- Heartrate stream
- Identifiable intervals (structured workout, not steady-state)
- At least 2 intervals to compare early vs late recovery

**Output:**
- HR recovery rate per interval: bpm drop in first 60s, bpm drop in first 120s
- Recovery trend: comparison of first interval recovery vs last interval recovery

**Typical Thresholds:**
- 60s recovery > 25 bpm: good cardiac fitness
- 60s recovery 15-25 bpm: moderate
- 60s recovery < 15 bpm: poor recovery, fatigue present
- Decline of > 5 bpm/min from first to last interval: within-session fatigue accumulation

**Sport Applicability:** Any sport with discrete high-intensity efforts and recovery periods

---

## `power_curve_trend`

**Description:** Compares the athlete's recent best power (or pace) at key durations against their 28-day and 90-day historical bests. Reveals whether peak capacity is improving, maintaining, or declining at specific physiological durations — sprint (5s), anaerobic (1min), VO2max (5min), threshold (20min), endurance (60min).

**MCP Tools:**
- `get_athlete_power_curves` — retrieve power curves for specified date ranges

**Required Data:**
- Power data across multiple activities in the comparison windows
- At least 3-4 activities per window for reliable curves

**Output:**
- % change at each configured duration vs 28-day and 90-day bests
- Positive = improving, negative = declining

**Typical Thresholds:**
- \> +3%: improving
- -2% to +3%: maintaining
- < -3%: declining

**Configurable Parameters:**
- `durations`: array of seconds (e.g., `[5, 60, 300, 1200, 3600]`)
- Personas select which durations matter for their coaching model

**Sport Applicability:** Cycling (power), running (pace curves if available)

---

## `hr_at_power_trend`

**Description:** Tracks heart rate at a reference steady-state power output across sessions over a configurable time window. Declining HR at the same power indicates improving aerobic efficiency — the core validation metric for volume-based training. Rising HR at the same power indicates aerobic efficiency is declining despite training.

**MCP Tools:**
- `get_athlete_power_hr_curve` — retrieve power vs HR relationship over date range
- Fallback: `get_activity_streams` across recent activities at similar intensity

**Required Data:**
- Power + HR data from multiple sessions at similar sub-threshold intensity
- At least 3-4 comparable sessions within the reference window

**Output:**
- HR at reference power: current vs window average
- Trend direction: improving (HR down), stable, worsening (HR up)
- Magnitude: bpm change over the window

**Typical Thresholds:**
- HR declining ≥ 2 bpm: improving efficiency
- HR stable (± 1 bpm): neutral
- HR rising ≥ 2 bpm: declining efficiency

**Configurable Parameters:**
- `reference_window_days`: lookback window (default 28)

**Sport Applicability:** Cycling (power:HR), running with power meter

---

## `interval_execution_quality`

**Description:** Assesses how well the athlete executed prescribed intervals. Measures power fade across repeated efforts, compliance with target power ranges, and variability within intervals. Fade across intervals indicates accumulating fatigue; poor target compliance indicates prescription misalignment or pacing issues.

**Data Source:**
- Fade and target compliance: `get_activity_intervals` MCP tool (compact structured endpoint, no raw streams needed)
- Power CV per interval: `stream-analyze` CLI tool (`--analyses interval_cv`) — retrieves power stream via Intervals.icu REST API, computes CV in-process

**Required Data:**
- Structured workout with identifiable intervals
- Power stream (or pace for running)
- Prescription targets (from the active prescription YAML)

**Output:**
- Fade %: power difference between first and last interval (negative = fade)
- Target compliance %: how closely average interval power matched prescription
- Power CV per interval: variability index (lower = smoother execution)

**Typical Thresholds:**
- Fade < 3%: excellent execution
- Fade 3-8%: normal fatigue progression
- Fade 8-15%: significant fatigue, prescription may be too aggressive
- Fade > 15%: session exceeded capacity
- Target compliance > 95%: excellent
- Target compliance 85-95%: acceptable
- Target compliance < 85%: significant miss

**Sport Applicability:** Any sport with structured interval prescriptions

---

## `time_in_zones`

**Description:** Distribution of time spent across heart rate and/or power training zones for a completed activity. Primary use is validating intensity distribution — especially critical for the polarized training model where grey-zone (Zone 2-3) accumulation is a training quality failure.

**MCP Tools:**
- `get_activity_time_at_hr` — retrieve HR zone distribution
- Activity power data for power zone distribution

**Required Data:**
- HR stream and/or power stream
- Zone boundaries configured in Intervals.icu athlete settings

**Output:**
- % time per zone (Z1 through Z5+)
- Grey-zone percentage (Z2+Z3 combined)
- Distribution shape classification (polarized, pyramidal, threshold-heavy)

**Typical Thresholds:**
- Polarized target: Z1 ≥ 75%, Z4+ present, Z2-3 < 5%
- Grey-zone warning: Z2-3 > 10% on an intended easy or hard day
- Zone compliance: intended zone matches actual primary zone

**Sport Applicability:** All endurance sports with HR and/or power

---

## `resting_hr_trend`

**Description:** Multi-day resting heart rate trend from wellness data. A rising RHR baseline across days indicates cardiac fatigue accumulation — the sympathetic nervous system is running at elevated baseline. More reliable over multi-day windows than single morning readings.

**MCP Tools:**
- `get_wellness` — retrieve wellness entries for a date range

**Required Data:**
- Wellness data with resting HR entries across the configured window
- At least 5 data points within the window for reliable trend

**Output:**
- RHR trend direction: rising, stable, declining
- Magnitude: bpm change over the window
- Consecutive days above personal baseline

**Typical Thresholds:**
- Rising 3+ bpm over window: amber, cardiac fatigue accumulating
- Rising 5+ bpm over window: red, sustained sympathetic elevation
- Stable (± 1 bpm): normal
- Declining: recovery progressing

**Configurable Parameters:**
- `window_days`: lookback window (7 or 14 days)

**Sport Applicability:** All — sport-independent wellness metric

---

## `hrv_trend`

**Description:** Multi-week HRV trend analysis with personal baseline computation. Pulls 60+ days of wellness history and classifies today's reading against a dual-window rolling baseline (14-day short, 60-day long) using z-score position, percentile rank, linear regression slope, and historical-analog lookup (prior readings at or near today's level and how quickly they rebounded). Designed to replace absolute-value thresholds with athlete-calibrated readiness signals.

**Data Source:**
- `hrv-trend` CLI tool (`npx tsx tools/hrv-trend.ts --config ...`) — fetches wellness history via Intervals.icu REST API, computes all statistics in-process, returns compact JSON. No raw wellness data enters LLM context.

**Required Data:**
- Wellness data with `hrv_rmssd` (or `hrv_sdnn`) entries
- Minimum 14 days for short baseline; 60 days for full classification (fewer returns `insufficient_data`)

**Output:**
- `current`: today's HRV reading
- `baselines`: `{short_mean, short_sd, long_mean, long_sd}` — dual-window rolling statistics
- `position`: `{z_short, z_long, percentile_long}` — statistical position of today's reading
- `trend`: `{slope_per_day, direction, consecutive_days_below_long_mean}` — 7-day regression slope and direction
- `analogs`: `{matches, match_count, median_rebound_days, any_sustained_suppression}` — prior readings at or near today's level and their rebound patterns
- `classification`: `{label, reasoning}` — one of `green | green-watch | amber | amber-red | red | insufficient_data`

**Classification Bands (default thresholds):**

| Label | z_long condition |
|-------|-----------------|
| `green` | ≥ -0.5 |
| `green-watch` | -1.0 to -0.5 |
| `amber` | -1.5 to -1.0 (no severe trend/suppression) |
| `amber-red` | -1.5 to -1.0 (consec≥3 AND sustained) or -2.0 to -1.5 (no sustained) |
| `red` | -2.0 to -1.5 (consec≥3 OR sustained) or < -2.0 (hard floor) |
| `insufficient_data` | fewer than long_window_days of history |

**Configurable Parameters (persona JSON `analyses.hrv_trend`):**
- `metric`: `hrv_rmssd` (default) or `hrv_sdnn`
- `short_window_days`: short baseline window (default 14)
- `long_window_days`: long baseline and analog search window (default 60)
- `trend_window_days`: regression window (default 7)
- `analog_tolerance`: HRV units for analog matching (default 2)
- `analog_dedup_days`: cluster window for deduplication (default 3)
- `thresholds`: persona-specific z-score band edges `{green, green_watch, amber, red}`

**Sport Applicability:** All — sport-independent wellness metric
