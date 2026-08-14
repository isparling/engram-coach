# Architecture

## Runtime boundaries

The Claude Code plugin supplies skill instructions, generic personas, templates, shared setup guidance, and TypeScript analysis tools. An athlete’s configuration and coaching records live outside the plugin directory. Skills read local configuration only at runtime and write records only to the configured coaching workspace.

The extension pack classifies coaching-relevant conversation turns into structured knowledge candidates. It does not persist athlete data in this repository.

## Domain ontology

The extension pack uses 14 entity types:

`workout-adaptation`, `consultation`, `block-review`, `race-report`, `season-review`, `arc-plan`, `lactate-test`, `monitoring-capture`, `intake-record`, `prescription`, `persona-fit`, `calibration-point`, `methodology`, and `session-execution`.

It uses 10 decision kinds:

`workout-adaptation`, `consultation-advice`, `block-restructure`, `arc-planning`, `persona-change`, `recovery-intervention`, `threshold-update`, `monitoring-capture`, `profile-claim`, and `setup-decision`.

The ten skill identifiers are `adapt-plan`, `consult`, `block-review`, `race-analysis`, `season-retrospective`, `lessons-rollup`, `monitoring-rollup`, `lactate-analyze`, `intake`, and `set-goal`.

## Personas

The valid built-in persona slugs are `conservative`, `aggressive`, `polarized`, and `volume`. Persona JSON defines explicit thresholds, signal weighting, conflict resolution, workout labels, phase overrides, and optional analysis configuration. See [`../PERSONA_SCHEMA.md`](../PERSONA_SCHEMA.md).

## Skill artifacts

Skills generate Markdown records in the configured coaching workspace, including prescriptions, block summaries, race reports, season reviews, lessons logs, athlete profiles, and optional monitoring summaries. The file formats are documented in [`../PRESCRIPTION_FORMAT.md`](../PRESCRIPTION_FORMAT.md) and the skill instructions themselves.

## Local data boundary

`config.json`, `.env`, generated data, and athlete-specific coaching directories are local-only. `.gitignore` excludes these runtime artifacts. Public examples use placeholders and synthetic values only.

## Test commands

Run the tools suite with:

```bash
npm install --prefix tools
npm test --prefix tools
```

Build the lactate package with:

```bash
npm install --prefix lactate
npm run build --prefix lactate
```
