# Prescription Format

Prescription files are YAML files that define a training block session-by-session. The `adapt-plan` skill reads these files to discover what sessions were planned, compare them against execution data, and adapt upcoming sessions. The `intake` skill can generate a skeleton prescription interactively.

---

## File Naming and Location

- Store prescription files in the directory pointed to by `prescriptions_dir` in `config.json`
- One file per training block (e.g., `base.yaml`, `build_1.yaml`, `volume_build1.yaml`)
- The active block is detected automatically — see [Active Block Detection](#active-block-detection) below

---

## Top-Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `block_name` | string | yes | Identifies this block. Used to resolve a template file. Must be snake_case. |
| `goal` | object | no | Optional race or event goal for this block. See [Goal Object](#goal-object) below. |
| `sessions` | list | yes | Ordered list of all sessions in the block. |

### Block Name → Template Mapping

`adapt-plan` loads a block template from `templates/` using `block_name`. The mapping strips any leading prefix (e.g., athlete name, year) and normalizes to a hyphenated slug:

| `block_name` value | Resolved template |
|--------------------|-------------------|
| `base` | `templates/base.md` |
| `build_1` or `volume_build1` | `templates/build-1.md` |
| `build_2` | `templates/build-2.md` |
| `race_specificity` or `race_prep` | `templates/race-specificity.md` |

If no matching template is found, `adapt-plan` continues without it and annotates the Orient output.

### Goal Object

Optional. Documents the target event for this training block.

```yaml
goal:
  event: "Example Endurance Event"
  date: "2027-06-15"
  description: "Fictional endurance event used only to demonstrate this format."
```

| Field | Type | Description |
|-------|------|-------------|
| `event` | string | Event name |
| `date` | string | ISO date (YYYY-MM-DD) |
| `description` | string | Optional free-text notes about the event and performance target |

---

## Session Fields

Each item in the `sessions` list represents one training session.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `week` | integer | yes | Week number within this block (1-indexed) |
| `day` | string | yes | Day abbreviation: `Mon` `Tue` `Wed` `Thu` `Fri` `Sat` `Sun` |
| `session_date` | string | yes | ISO date (YYYY-MM-DD). Used for active block detection. |
| `session_name` | string | yes | Unique identifier for this session. Convention: `W{week}_{Type}` e.g., `W1_SubLT2` |
| `modality` | string | no | Overrides default sport. e.g., `treadmill_walk`, `run`, `swim`. Defaults to primary sport if absent. |
| `total_duration_min` | integer | yes | Total session duration in minutes, including warmup and cooldown. |
| `effort_zone` | string | no | For unstructured sessions (no intervals). e.g., `Z1-Z2`, `Z0-Z1`, `Z2`. |

### Warmup and Cooldown (structured sessions)

Optional for sessions that use `intervals`. Power targets as percentage of FTP.

| Field | Type | Description |
|-------|------|-------------|
| `warmup_power_low_pct` | integer | Lower bound of warmup power range (% FTP) |
| `warmup_power_high_pct` | integer | Upper bound of warmup power range (% FTP) |
| `cooldown_power_low_pct` | integer | Lower bound of cooldown power range (% FTP) |
| `cooldown_power_high_pct` | integer | Upper bound of cooldown power range (% FTP) |

---

## Interval Fields

When a session has structured work, use the `intervals` list. Each item in `intervals` is one interval block (a group of repeated efforts).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `duration_min` | number | yes | Duration of each interval effort in minutes |
| `power_low_pct` | integer | yes | Lower bound of target power (% FTP) |
| `power_high_pct` | integer | yes | Upper bound of target power (% FTP) |
| `count` | integer | yes | Number of repetitions |
| `recovery_min` | number | yes | Rest duration between reps (minutes) |
| `recovery_power_low_pct` | integer | no | Lower bound of recovery power (% FTP). Defaults to easy spin if absent. |
| `recovery_power_high_pct` | integer | no | Upper bound of recovery power (% FTP) |

Multiple interval blocks (e.g., over-unders with two distinct effort zones) use multiple items in the `intervals` list:

```yaml
intervals:
  - duration_min: 3
    power_low_pct: 88
    power_high_pct: 92
    count: 6               # alternating with the next block
    recovery_min: 0        # no rest — alternates directly into next block
  - duration_min: 3
    power_low_pct: 103
    power_high_pct: 107
    count: 6
    recovery_min: 8        # rest between full over-under sets
```

---

## Active Block Detection

`adapt-plan` automatically detects which prescription file is active:

1. List all `.yaml` and `.yml` files in `prescriptions_dir`
2. For each file, find the maximum `session_date` value across all sessions
3. Select the file whose maximum `session_date` is the most recent date on or before today
4. If multiple files have recent sessions, ask the athlete which block they are currently in

This means **session dates must be accurate** — they drive block selection. If you create a prescription in advance for a future block, leave `session_date` fields as placeholders (e.g., `YYYY-MM-DD`) until the block starts, otherwise it may be detected as active prematurely.

---

## Example: Minimal 2-Week Block

```yaml
# Synthetic example — 2-week build block, 3 sessions/week
# Key session: Sub-threshold intervals (Tue)
# Long endurance: Saturday
# Easy endurance: Wednesday

block_name: build_1

goal:
  event: "Example Endurance Event"
  date: "2027-06-15"

sessions:

  # ===== WEEK 1 =====

  - week: 1
    day: Tue
    session_date: 2026-03-10
    session_name: W1_Intervals
    total_duration_min: 120
    warmup_power_low_pct: 40
    warmup_power_high_pct: 65
    cooldown_power_low_pct: 35
    cooldown_power_high_pct: 45
    intervals:
      - duration_min: 10
        power_low_pct: 85
        power_high_pct: 92
        count: 3
        recovery_min: 5
        recovery_power_low_pct: 45
        recovery_power_high_pct: 55

  - week: 1
    day: Wed
    session_date: 2026-03-11
    session_name: W1_Easy
    total_duration_min: 90
    effort_zone: Z1-Z2

  - week: 1
    day: Sat
    session_date: 2026-03-14
    session_name: W1_LongRide
    total_duration_min: 240
    effort_zone: Z1-Z2

  # ===== WEEK 2 =====

  - week: 2
    day: Tue
    session_date: 2026-03-17
    session_name: W2_Intervals
    total_duration_min: 135
    warmup_power_low_pct: 40
    warmup_power_high_pct: 65
    cooldown_power_low_pct: 35
    cooldown_power_high_pct: 45
    intervals:
      - duration_min: 10
        power_low_pct: 85
        power_high_pct: 92
        count: 4
        recovery_min: 5
        recovery_power_low_pct: 45
        recovery_power_high_pct: 55

  - week: 2
    day: Wed
    session_date: 2026-03-18
    session_name: W2_Easy
    total_duration_min: 90
    effort_zone: Z1-Z2

  - week: 2
    day: Sat
    session_date: 2026-03-21
    session_name: W2_LongRide
    total_duration_min: 270
    effort_zone: Z1-Z2
```

---

## Tips

- **One file per block** — start a new file when you begin a new training block, don't append to an existing file. This keeps active block detection accurate.
- **All power targets are % FTP** — never use absolute watts. This makes prescriptions portable across athletes and FTP updates.
- **Use `effort_zone` for simple sessions** — Z1-Z2 endurance rides, recovery sessions, and walks don't need interval structure.
- **session_name must be unique within a file** — `adapt-plan` uses it to match a prescription session to its execution record.
- **Treadmill walks and non-bike sessions** — set `modality` (e.g., `treadmill_walk`) and use `effort_zone` instead of power percentages.
