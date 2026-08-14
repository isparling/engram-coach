# claw-coach

## What it does

claw-coach is a document-driven endurance-coaching plugin for Claude Code. It combines athlete-approved coaching records with Intervals.icu activity and wellness data to adapt training, review blocks and seasons, analyze races, and preserve durable lessons in Markdown.

The plugin provides coaching workflows and deterministic analysis tools. Athlete records, credentials, and local configuration remain outside this repository.

## Included skills

- `adapt-plan` — assess readiness after a key workout and adapt the next prescription.
- `block-review` — synthesize an end-of-block summary.
- `consult` — provide advice within an active plan.
- `intake` — configure a new athlete and coaching workspace.
- `lactate-analyze` — query lactate tests and threshold estimates.
- `lessons-rollup` — curate durable patterns from coaching records.
- `monitoring-rollup` — maintain longitudinal monitoring records.
- `race-analysis` — synthesize a completed race.
- `season-retrospective` — review a completed season.
- `set-goal` — establish a new goal arc and prescriptions.

## Coaching personas

Built-in personas are generic coaching policies, not named-coach reproductions:

- `conservative` — recovery-first with an HRV veto.
- `aggressive` — progressive overload with weighted readiness.
- `polarized` — high low-intensity volume plus high-intensity work.
- `volume` — long-horizon aerobic volume with a 14-day CTL trend.

You can define a custom policy with [`PERSONA_SCHEMA.md`](PERSONA_SCHEMA.md).

## Installation

Follow [`SETUP.md`](SETUP.md) to install the plugin, configure Intervals.icu access, and create a local coaching workspace.

## Configuration

Copy [`config.json.example`](config.json.example) to your local configuration path and replace every placeholder. Keep credentials and athlete records outside this repository. The example config defaults to the generic `conservative` persona.

## Privacy boundary

This repository ships no athlete records, medical information, real event data, personal narratives, credentials, or historical coaching artifacts. Examples and fixtures are synthetic. Do not commit local `config.json`, `.env`, generated data, or athlete-owned coaching documents.

## Development

Install tool dependencies and run the public test suite:

```bash
npm install --prefix tools
npm test --prefix tools
```

For the lactate package:

```bash
npm install --prefix lactate
npm run build --prefix lactate
```
