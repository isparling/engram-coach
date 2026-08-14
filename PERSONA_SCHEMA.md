# PERSONA_SCHEMA.md

## Purpose

This document is the canonical reference for the structure of persona JSON files in the `personas/` directory. A "full definition" means every field needed to completely reproduce a persona's reasoning — thresholds, weighting logic, coaching voice, edge case handling, and conflict resolution strategy — without consulting any other file. When adding a new persona, every required field must be present and carry a meaningful value; omitting or nullifying a required field will break skill execution.

---

## Required Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `name` | string | Full display name used in prose and logs | `"Conservative Coach"` |
| `slug` | string | Filename-safe identifier; must match the JSON filename (without `.json`) | `"conservative"` |
| `display_name` | string | Short label for UI display and inline references | `"Conservative"` |
| `description` | string | One-paragraph human-readable summary of the persona's philosophy | `"Prioritizes recovery and long-term load management..."` |
| `philosophy` | string | Detailed coaching philosophy (2-4 sentences) explaining signal weighting rationale | `"CTL trend is the primary signal..."` |
| `coaching_voice` | string | Tone, language style, and example phrases this persona uses when communicating | `"Direct and cautious. Phrases like 'Hold back today'..."` |
| `edge_cases` | array of strings | Specific situations where this persona overrides default reasoning | `["HRV drop > 2 SD → mandatory easy", "CTL > 90 → cap at moderate"]` |
| `tsb_thresholds` | object | TSB cutoffs for readiness classification; keys: `push`, `moderate`, `easy` (all integers, may be negative) | `{"push": 5, "moderate": -10, "easy": -20}` |
| `factor_weights` | object | Signal weights used in composite scoring; keys: `tsb`, `ctl_trend`, `hrv`, `threshold_currency` (all floats, should sum to 1.0) | `{"tsb": 0.45, "ctl_trend": 0.25, "hrv": 0.20, "threshold_currency": 0.10}` |
| `conflict_resolution` | string | Strategy when signals disagree; either `"hrv_veto"` or `"weighted_score"` | `"hrv_veto"` |
| `hrv_veto_threshold` | float or null | Z-score below which HRV forces an easy day regardless of other signals; `null` if `conflict_resolution` is `"weighted_score"` | `-1.5` |
| `workout_type_map` | object | Human-readable workout type labels for each readiness tier; keys: `push`, `moderate`, `easy`, `rest` (all strings) | `{"push": "Threshold or VO2max", "moderate": "Tempo or Z3", "easy": "Recovery Z1-Z2", "rest": "Full rest"}` |
| `threshold_currency_stale_days` | integer | Days since last threshold effort before the `threshold_currency` factor starts penalizing readiness | `21` |
| `ctl_trend_window_days` | integer | Rolling window (in days) used to calculate CTL trend direction | `7` |

---

## Optional Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `phase_overrides` | object | Per-training-phase overrides for `tsb_thresholds` and/or `hrv_veto_threshold`; keys are phase names (`"base"`, `"build"`, `"peak"`, `"recovery"`) | `{"peak": {"tsb_thresholds": {"push": 10, "moderate": -5, "easy": -15}}}` |
| `phase_factor_weights` | object | Per-training-phase overrides for `factor_weights`; keys are phase names (`"base"`, `"build"`, `"peak"`, `"recovery"`) | `{"base": {"tsb": 0.35, "ctl_trend": 0.35, "hrv": 0.20, "threshold_currency": 0.10}}` |
| `analyses` | object | Per-analysis configuration keyed by catalog analysis key (from `analyses/catalog.md`). Each value is an object with: `enabled` (bool, default true), `thresholds` (object, analysis-specific trigger points), `phases` (array of phase names or null for all phases), `weight` (float 0.0-1.0, reasoning priority during Synthesize). Additional analysis-specific keys are documented in the catalog entry. If omitted, the persona runs no stream-level analyses. | `{"aerobic_decoupling": {"enabled": true, "thresholds": {"amber": 5, "red": 8}, "phases": ["base", "build"], "weight": 0.3}}` |

---

## Annotated Example

The block below is annotated with `//` comments for explanation. Standard JSON does not support comments — strip them before saving a real persona file.

```jsonc
{
  // Full display name for prose and logging
  "name": "Conservative Coach",

  // Must match the filename: personas/conservative.json
  "slug": "conservative",

  // Short label for inline references
  "display_name": "Conservative",

  // One-paragraph summary of overall philosophy
  "description": "Prioritizes recovery and long-term load management. Errs toward easier days when signals conflict. Designed for athletes who respond poorly to accumulated fatigue.",

  // 2-4 sentences explaining signal weighting rationale
  "philosophy": "TSB and HRV are weighted heavily because short-term recovery state is the most reliable predictor of training quality. CTL trend provides context but does not override acute fatigue signals. Threshold currency matters but is never sufficient justification to push when the athlete is fatigued.",

  // Tone and language style when generating coaching text
  "coaching_voice": "Cautious and measured. Prefers phrases like 'Hold back today', 'Your body needs this'. Avoids language that glorifies suffering or pushing through fatigue.",

  // Specific override rules — each item is a plain-language rule
  "edge_cases": [
    "HRV drop > 2 SD below 30-day baseline → mandatory easy regardless of TSB",
    "TSB < -20 → rest day even if HRV is neutral",
    "CTL > 90 → cap recommendation at moderate regardless of TSB"
  ],

  // TSB cutoffs for readiness tiers (integers, may be negative)
  "tsb_thresholds": {
    "push": 5,
    "moderate": -10,
    "easy": -20
  },

  // Composite signal weights (floats, should sum to 1.0)
  "factor_weights": {
    "tsb": 0.45,
    "ctl_trend": 0.25,
    "hrv": 0.20,
    "threshold_currency": 0.10
  },

  // "hrv_veto" or "weighted_score"
  "conflict_resolution": "hrv_veto",

  // Z-score threshold for HRV veto; null if conflict_resolution is "weighted_score"
  "hrv_veto_threshold": -1.5,

  // Human-readable workout type labels for each readiness tier
  "workout_type_map": {
    "push": "Threshold or VO2max",
    "moderate": "Tempo or Zone 3",
    "easy": "Recovery Zone 1-2",
    "rest": "Full rest or active recovery only"
  },

  // Days before threshold_currency factor starts penalizing
  "threshold_currency_stale_days": 21,

  // Rolling window for CTL trend calculation
  "ctl_trend_window_days": 7,

  // Optional: stream analyses this persona runs during Orient phase
  // Keys are catalog analysis keys from analyses/catalog.md
  // Omit entirely if persona uses no stream analyses
  "analyses": {
    "aerobic_decoupling": {
      "enabled": true,
      "thresholds": { "amber": 3, "red": 5 },
      "phases": null,
      "weight": 0.3
    },
    "hrv_trend": {
      "enabled": true,
      "thresholds": { "window_days": 7 },
      "phases": null,
      "weight": 0.3
    }
  }
}
```

---

## Adding a New Persona

1. **Create the file** — Create `personas/<slug>.json` where `<slug>` is the filename-safe identifier. The file must contain all 14 required fields listed in the Required Fields table above.

2. **Validate against schema** — Manually check that every required field is present, correctly typed, and carries a meaningful (non-placeholder) value. For `conflict_resolution: "weighted_score"`, set `hrv_veto_threshold` to `null`. For `conflict_resolution: "hrv_veto"`, provide a float.

3. **Register the slug** — Add the new slug as a valid value for `active_persona` in `config.json.example` by updating the `_comment` field or adding a second profile entry. This makes the new persona discoverable to users reading the example config.
