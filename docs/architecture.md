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

## Structured capture integration contract

These are the load-bearing seams between this pack and the Engram host
(`@isparling/engram-omp` + `@isparling/engram-cli`).

**Artifact pointers are pack-derived and root-relative-with-prefix.** A
prescription state record always carries `details.artifact.relativePath` of
`prescriptions/<arc-id>.yaml`; the skill does not choose it. Both
`computeDesiredViews` and `analysis-tools/migrate-structured-capture.ts`
resolve that pointer by *stripping* the leading `prescriptions/` segment and
rooting the remainder at `prescriptions_dir`. Appending the pointer to the
configured root instead produces `<prescriptions_dir>/prescriptions/...` and a
byte-comparison failure against the migrated baseline. Non-prescription kinds
root their pointer unchanged at `coaching_docs_dir`. `DesiredView.absoluteTarget`
is the single authoritative resolution: consumers use it rather than re-deriving
the mapping.

**Candidate scope comes from the host, not the pack.** The host passes the
active space id on the preview tools; the aggregate candidate's
`scope.space` is that value. A pack that substitutes its own id produces
envelopes the host rejects with `field_invalid` on `scope.space`.

**Generated views are ordinary artifact writes.** The space binding's
`write_roots` must authorize `coaching_docs_dir` and `prescriptions_dir`. If
they do not, an approved capture still commits records and refreshes the
index, while every view is reported in `artifacts.stale` with
`root_not_writable`. Re-applying the same committed hash retries only
materialization.

**Change-set field contract.** `source.turn_id` is a non-negative integer,
not a string. Every `events[]` item requires an `action_targets` array of
single-line strings (use `[]` when nothing is targeted); `state_changes[]`
items must not carry one — the pack derives `[]` for them.

**Dependency resolution.** A Bun-compiled OMP cannot resolve bare
dependencies from a pack module imported after extension startup, so
`engram-coach-materialization.ts` loads `yaml` through `createRequire`, then
falls back to an upward search anchored on the dependency's own
`package.json`.

**Pack identity version is not the npm version.** `engramCoachPackVersion`
is a provenance and compatibility identifier, and the core compares it by
exact equality in three places: space registration requires the manifest's
`required_packs` version to equal the binding's `installed_packs` version
(no semver ranges); a candidate envelope's `pack` must match an installed
pack and the loaded pack object; and every planned mutation must preserve the
pack provenance of the record it rewrites. Because a supersede retires the
prior record by re-emitting that record — carrying the `pack` stamp it was
written with — raising `engramCoachPackVersion` while records exist on disk
at the old value makes reconciliation refuse the supersede with
`provenance_mismatch`. Changing it is therefore a record migration, never a
release chore: publishing a new npm version of this package leaves the pack
identity version alone, and `installed_packs[].version` keeps naming the pack
identity rather than the npm release.

## Test commands

Run the tools suite with:

```bash
npm install --prefix analysis-tools
npm test --prefix analysis-tools
```

Build the lactate package with:

```bash
npm install --prefix lactate
npm run build --prefix lactate
```
