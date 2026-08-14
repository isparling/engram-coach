# engram-coach Skill Pack

## Overview

engram-coach is a document-driven endurance-coaching plugin. Skills use athlete-approved local records, Intervals.icu data, and explicit coaching policies to reason about training decisions. The repository ships the engine; athlete records and credentials remain in a separate local workspace.

## Package contents

- `skills/` — Claude Code skill instructions.
- `personas/` — generic coaching-policy definitions.
- `templates/` — Markdown templates for planning and review artifacts.
- `analyses/` — stream-analysis catalog and data requirements.
- `tools/` — deterministic TypeScript analysis utilities.
- `shared/` — common setup and retrieval instructions.

## Personas

| Persona | Slug | Policy |
|---|---|---|
| Conservative | `conservative` | Recovery-first; an adverse HRV signal vetoes hard training. |
| Aggressive | `aggressive` | Progressive overload with weighted readiness. |
| Polarized | `polarized` | High low-intensity volume with clearly separated high-intensity work. |
| Volume | `volume` | Long-horizon aerobic volume with a 14-day CTL trend. |

Built-in policies are generic. Create a custom policy with [`PERSONA_SCHEMA.md`](PERSONA_SCHEMA.md) when an athlete needs different thresholds or decision logic.

## Setup

1. Install this repository as a Claude Code plugin using your marketplace or local plugin source.
2. Configure an Intervals.icu MCP server.
3. Create a local `.engram-coach/config.json` from [`config.json.example`](config.json.example) in the athlete workspace.
4. Keep `.engram-coach/` gitignored: it contains credentials and local paths.
5. Run `/engram-coach:intake` to establish goals, policies, and coaching-record locations.

See [`SETUP.md`](SETUP.md) for the detailed configuration contract.

## Skills

| Skill | Invocation | Purpose |
|---|---|---|
| intake | `/engram-coach:intake` | Set up a new athlete workspace and coaching policy. |
| set-goal | `/engram-coach:set-goal` | Create a goal arc, methodology documents, and prescriptions. |
| adapt-plan | `/engram-coach:adapt-plan` | Assess readiness after a key workout and adapt the next session. |
| lactate-analyze | `/engram-coach:lactate-analyze` | Query lactate tests and threshold estimates. |
| consult | `/engram-coach:consult` | Provide evidence-based advice within an active plan. |
| block-review | `/engram-coach:block-review` | Produce an end-of-block summary. |
| race-analysis | `/engram-coach:race-analysis` | Produce a post-race report from activity data and narrative. |
| season-retrospective | `/engram-coach:season-retrospective` | Synthesize cross-block and race patterns. |
| lessons-rollup | `/engram-coach:lessons-rollup` | Curate durable athlete lessons from coaching records. |
| monitoring-rollup | `/engram-coach:monitoring-rollup` | Maintain declared longitudinal monitoring records. |

## Data boundary

Do not commit athlete records, local configuration, tokens, generated data, or private narratives. Public examples in this repository are fictional and synthetic.
