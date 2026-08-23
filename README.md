# engram-coach

## What it does

engram-coach is a document-driven endurance-coaching plugin for Claude Code. It combines athlete-approved coaching records with Intervals.icu activity and wellness data to adapt training, review blocks and seasons, analyze races, and preserve durable lessons in Markdown.

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

For direct OMP integration, install the published Engram packages and bind the OMP extension:

```sh
npm install @isparling/engram-coach @isparling/engram-harness @isparling/engram-cli @isparling/engram-omp
```

```yaml
extensions:
  - ./node_modules/@isparling/engram-omp/omp-extension.ts
```

This does not include core Engram onboarding. The OMP extension resolves
`engram-coach` through an **existing Engram binding registry** whose `training`
space is already registered. The extension selects that space for each new OMP
session from the nearest `engram.space.json`; `ENGRAM_SPACE_ID` overrides the
manifest when needed. This package neither creates nor registers spaces. Set
one up through your own Engram deployment, then add the pack declaration:

```json
{
  "installed_packs": [
    {
      "id": "engram-coach",
      "version": "0.1.0",
      "from": "@isparling/engram-coach",
      "extract": true
    }
  ]
}
```

**Set `ENGRAM_BINDING_REGISTRY`** to the absolute path of that binding
registry file before starting OMP. It is required, not optional: without it
the adapter disables knowledge capture entirely for the whole session. See
[`SETUP.md`](SETUP.md#6-install-the-plugin) (Alternative: Direct OMP
integration) for the full walkthrough.

### Verifying the direct OMP integration

Bind the pack, start an OMP session, and complete one full agent turn — the
adapter resolves the session's active space and pack inside its awaited
`session_stop` final-settle hook, not at session start. After that turn
settles, call the `engram_status` tool. It reports the binding-selected pack
identity and CLI mode:

```json
{ "mode": "cli", "pack_id": "engram-coach", "pack_version": "0.1.0" }
```

`mode` is always `"cli"` because the CLI remains the space-resolution and
fallback control plane; the adapter never injects knowledge directly into
model context. `pack_id: null` before the first turn has settled is expected,
not a binding failure. If it remains `null` afterwards, recheck
`ENGRAM_BINDING_REGISTRY`, the session's active-space selection, and the
`installed_packs` declaration above.

For settled turns containing coaching knowledge, this pack's exported
`captureFromTurn` handler creates a parseable `status: "candidate"` draft in
the active space's records root and refreshes that space's scoped qmd index.
Create-only writes make repeated settlement idempotent. Candidate drafts are
excluded from recall and profile presentation until explicitly promoted to
`status: "active"`.

## Configuration

Copy [`config.json.example`](config.json.example) to your local configuration path and replace every placeholder. Keep credentials and athlete records outside this repository. The example config defaults to the generic `conservative` persona.

## Privacy boundary

This repository ships no athlete records, medical information, real event data, personal narratives, credentials, or historical coaching artifacts. Examples and fixtures are synthetic. Do not commit local `config.json`, `.env`, generated data, or athlete-owned coaching documents.

## Development

Install tool dependencies and run the public test suite:

```bash
npm install --prefix analysis-tools
npm test --prefix analysis-tools
```

For the lactate package:

```bash
npm install --prefix lactate
npm run build --prefix lactate
```
