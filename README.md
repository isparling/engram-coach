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

For direct OMP integration, install the published adapter and coach pack:

```sh
omp install @isparling/engram-omp @isparling/engram-coach
```

The adapter brings its CLI dependency, OMP installs the shared harness peer,
and the adapter extension is discovered from its package manifest.

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

That `version` is the pack identity exported as `engramCoachPackVersion`, not
the npm release version — they move independently, and the identity version
changes only alongside a record migration. See
[`SETUP.md`](SETUP.md#6-install-the-plugin) and
[`docs/architecture.md`](docs/architecture.md).

**Set `ENGRAM_BINDING_REGISTRY`** to the absolute path of that binding
registry file before starting OMP. It is required, not optional: without it
the adapter disables knowledge capture entirely for the whole session. See
[`SETUP.md`](SETUP.md#6-install-the-plugin) (Alternative: Direct OMP
integration) for the full walkthrough.

That binding's `write_roots` must also authorize your `coaching_docs_dir`
and `prescriptions_dir`. Generated views are ordinary artifact writes: if
those roots are unauthorized, captures still commit records but every
regenerated view is reported stale with `root_not_writable` instead of being
written.

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

## Structured coaching capture

Engram active records are the authoritative store for mutable coaching state
and chronological events. Every record declares a role in
`details.recordRole` — exactly one of `state` (one current value per canonical
key; approved changes supersede), `event` (append-only history), or
`report-claim` (a structured conclusion extracted from an approved report).
Canonical entity keys are pack-derived:

```text
workout:<session-id>
prescription:<arc-id>:<session-id>
threshold:<sport>:lt1
threshold:<sport>:lt2
persona:<active-profile>
monitoring:<concern-id>:<signal>
```

Workout identity is the durable `session_id`; dates, titles, week position,
and contents are mutable attributes, never identity.

During a turn, skills commit changes through two typed OMP tools:
`engram_capture_preview({ change_set })` builds the mutation plan bound to an
immutable plan hash, and `engram_capture_apply({ plan_hash })` commits exactly
the hash the athlete approved. After apply, the pack regenerates deterministic
compatibility views — prescription YAML, `consultations.md`, monitoring logs,
doctor-prep summaries — each carrying a byte-exact warning header
(`GENERATED FROM ENGRAM ACTIVE RECORDS. DO NOT EDIT DIRECTLY.`) and never
edited directly. Long-form reports (`RACE_REPORT.md`, block `SUMMARY.md`,
`SEASON_REVIEW.md`, methodology and arc-overview documents) remain canonical
approved documents that skills author themselves.

- A stale apply requires a fresh preview plus fresh approval; the old hash is
  never accepted.
- An `index-stale` status leaves committed records authoritative; only the qmd
  index needs a later refresh.
- A stale view after materialization failure is retried by re-calling
  `engram_capture_apply` with the same committed hash in the same session —
  this reruns only view regeneration, never record mutations.

Ambient conversation capture runs separately through the pack's
`captureFromTurn` handler using an explicit provider/model configured in
`.engram-coach/config.json` (`capture.model`, overridable **model-only** via
`ENGRAM_COACH_CAPTURE_MODEL`; absence of both is a configuration error).
Extraction is LLM-only: failure emits a visible warning and creates no draft.
Legacy workspaces migrate through the dry-run sequence documented in
[SETUP.md](SETUP.md#7-knowledge-records-generated-views-and-migration):
`scan` → `apply-baseline` → `emit-change-set` → `compare`.

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
