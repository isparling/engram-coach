# Setup

Full prerequisite reference for NanoClaw Training Skill Pack. Follow these steps in order before invoking any skill.

---

## 1. Prerequisites Overview

Confirm each item before continuing. Steps 2-5 below cover each in detail.

- [ ] NanoClaw installed and running
- [ ] Intervals.icu account with API key
- [ ] Athlete ID from Intervals.icu
- [ ] QMD installed and initialized
- [ ] engram-coach installed as a Claude Code plugin (see Step 6)
- [ ] `.engram-coach/config.json` created in your athlete repo (see Step 5)

---

## 2. Intervals.icu Setup

Skills call Intervals.icu via MCP tools. You need two values from your Intervals.icu account.

**API Key**

1. Log into Intervals.icu
2. Go to **Settings → Developer Settings**
3. Copy your API Key

**Athlete ID**

1. Go to **Settings → Account**
2. Your Athlete ID appears in the URL as `i{ID}` (e.g., `i12345`)

**These values are used in two places.** The MCP server needs them as environment
variables (step 3) for the tools skills call during reasoning. The TypeScript
analysis tools read them from the `intervals_icu` block of your
`.engram-coach/config.json` (step 5) when invoked over the CLI. Set both.

---

## 3. Intervals.icu MCP Server Setup

The Intervals.icu MCP server exposes Intervals.icu API endpoints as MCP tools that skills call during execution. It must be configured in NanoClaw before skills can run.

**What it does**

Skills call MCP tools such as `get_wellness`, `get_athlete`, and `get_events` to retrieve training data. The MCP server handles authentication with Intervals.icu on each call.

**How to configure it in NanoClaw**

Refer to the [NanoClaw MCP configuration documentation](https://github.com/nanowell/nanoclaw) for the exact steps to add an MCP server. The general process:

1. Add a new MCP server entry pointing to the Intervals.icu MCP server image or binary
2. Set the required environment variables in the MCP server configuration:
   - `INTERVALS_API_KEY` — your API key from step 2
   - `INTERVALS_ATHLETE_ID` — your Athlete ID from step 2 (format: `i12345`)
3. Configure bind-mounts if the MCP server needs access to files in this repo

> **Note on bind-mount syntax:** Bind-mount configuration syntax can vary between NanoClaw versions. Verify the correct syntax against the current NanoClaw documentation before running — do not rely on examples from older tutorials.

**Verify**

After configuring the MCP server, check NanoClaw's tool discovery to confirm the Intervals.icu tools appear in the available tool list.

---

## 4. QMD Setup

QMD is a local knowledge management tool that skills use to retrieve coaching history and reference documents. This section walks through full setup — QMD is not assumed to be pre-installed.

**Install**

```
pip install qmd
```

Or consult the [QMD installation documentation](https://github.com/tobi/qmd) for alternative installation methods.

**Initialize a collection scoped to this repo**

```
cd ./engram-coach
qmd init
```

This creates a QMD collection in the current directory.

**Verify initialization**

```
qmd ls
```

Should show the engram-coach collection without error.

**Run first index**

```
qmd update
```

This indexes existing documents in `knowledge/`. If `knowledge/` is empty (Phase 10), the command completes without error — this is expected.

**Verify indexing**

```
qmd query "test"
```

Should return results (possibly empty) without error.

**Ongoing use**

When you add new coaching records to your `coaching_docs_dir`, run `qmd update` to make them retrievable by future skill invocations. Skills query QMD to load coaching history as reasoning context.

---

## 5. Athlete Configuration

engram-coach is installed as a Claude Code **plugin** (§6). The plugin ships the
engine — skills, personas, templates, tools. Your athlete-specific configuration
lives **outside** the plugin, in the repo where your coaching records live.

> **Why not inside the plugin?** Plugins install by cloning into
> `~/.claude/plugins/cache/…` at a git SHA, and that directory is replaced on
> every update. Anything you put there is lost. Config also holds an API key,
> which should never sit in the engine repo.

**Config resolution order.** Skills use the first of these that exists:

| Order | Path | Use |
|---|---|---|
| 1 | `$ENGRAM_COACH_CONFIG` | Explicit override |
| 2 | `./.engram-coach/config.json` | **Default** — project-level, in your athlete repo |
| 3 | `~/.claude/engram-coach/config.json` | User-level fallback |

**Create it** (from your athlete repo — the one holding `docs/coaching/`):

```bash
mkdir -p .engram-coach
cp "$(ls -d ~/.claude/plugins/cache/*/engram-coach/*/ | tail -1)config.json.example" .engram-coach/config.json
printf '\n# engram-coach machine-local config (holds Intervals.icu API key)\n.engram-coach/\n' >> .gitignore
```

**`.engram-coach/` MUST be gitignored** — it holds your Intervals.icu API key.
Verify with `git check-ignore -v .engram-coach/config.json` before committing anything.

Or skip all of the above and run `engram-coach:intake`, which writes the file for you.

**Migrating from an existing pre-rename local config directory?** Rename it in
place — the config contents and schema are unchanged, only the directory name moved:

```sh
mv .claw-coach .engram-coach
```

There is no runtime fallback to the old directory name or the old explicit
configuration-override environment variable — rename before invoking any skill.

**Edit the config**

Open `.engram-coach/config.json` and replace the placeholder values:

```json
{
  "active_profile": "default",
  "profiles": {
    "default": {
      "active_persona": "conservative",
      "coaching_docs_dir": "~/REPLACE_WITH_YOUR_COACHING_DOCS_PATH",
      "prescriptions_dir": "~/REPLACE_WITH_YOUR_PRESCRIPTIONS_PATH",
      "season": "REPLACE_WITH_SEASON_LABEL"
    }
  },
  "capture": {
    "model": "REPLACE_WITH_PROVIDER/MODEL",
    "timeout_seconds": 60,
    "max_candidates_per_turn": 3
  }
}
```

**Fields:**

| Field | Value |
|-------|-------|
| `active_profile` | Leave as `"default"` unless running multiple configurations |
| `active_persona` | One of: `conservative`, `aggressive`, `polarized`, `volume` |
| `coaching_docs_dir` | Absolute path (~ supported) to where coaching records will be written and read. Create the directory if needed: `mkdir -p ~/coaching` |
| `prescriptions_dir` | Absolute path to your workout prescriptions directory |
| `capture.model` | **Required.** Explicit `provider/model` string used for ambient conversation capture (e.g. `anthropic/claude-sonnet-4-5`). Never inherited from the interactive session model. |
| `capture.timeout_seconds` | Headless extraction deadline in seconds. Default and maximum: `60`. |
| `capture.max_candidates_per_turn` | Candidate records per settled turn. Default and maximum: `3`. |

**Capture model precedence:** a nonblank `ENGRAM_COACH_CAPTURE_MODEL`
environment variable overrides **only** `capture.model`; the timeout and
candidate limits always come from the `capture` block. If neither source is
set, ambient capture fails as a configuration error — run `intake` (Phase 3C)
or edit the config rather than leaving it unset. There is no implicit fallback
to any session or default model.

**Verify config**

Run this check from your athlete repo to confirm no placeholder paths remain and
a capture model is configured (a nonblank `ENGRAM_COACH_CAPTURE_MODEL` also
satisfies the model check):

```
python3 -c "import json,os; d=json.load(open('.engram-coach/config.json')); assert '~/REPLACE' not in str(d), 'Placeholder paths still present — edit .engram-coach/config.json'; assert str(d.get('capture',{}).get('model','')).strip() or os.environ.get('ENGRAM_COACH_CAPTURE_MODEL','').strip(), 'capture.model missing — run intake Phase 3C or see SETUP.md'; print('config OK')"
```

Should print `config OK`.

---

## 6. Install the Plugin

engram-coach is a Claude Code plugin. Skills are discovered from their own
frontmatter in `skills/*/SKILL.md` — there is no wrapper layer to maintain, and
new skills register themselves.

**Add the marketplace and install**

```
/plugin marketplace add isparling/engram-coach
/plugin install engram-coach@engram-coach
```

For local development against a working checkout, point the marketplace at the
directory instead:

```
/plugin marketplace add ~/code/engram-coach
```

**Install tool dependencies.** The TypeScript analysis tools (`stream-analyze`,
`hrv-trend`, `race-context`, `tsb-predict`) depend on npm packages that are not
committed. Whether you need this step depends on how you installed:

| Install source | `npm install` needed? |
|---|---|
| GitHub / remote marketplace | **Yes, after every install and update.** Only tracked files are cloned, so `analysis-tools/node_modules` is absent. |
| Local path marketplace | **Usually no.** A local install copies the working directory as-is, including `analysis-tools/node_modules`. Run it only if the directory is missing or the lockfile changed. |

```bash
cd "$(ls -d ~/.claude/plugins/cache/*/engram-coach/*/ | tail -1)analysis-tools" && npm install
```

Skills degrade gracefully if this is skipped — each affected analysis annotates
`[<analysis> unavailable — … Proceeding without.]` rather than failing — but you
lose decoupling, HR-recovery, interval-CV, and HRV-trend analysis until it runs.

> **Local installs copy everything, including gitignored files.** A local-path
> install is a directory copy, not a git clone, so anything sitting in the working
> tree — untracked scratch files, `node_modules`, and **gitignored secrets** —
> is copied into the plugin cache. Keep credentials out of this repo entirely;
> athlete config belongs in the athlete repo (§5), never here.
>
> **Local installs are also unversioned.** Remote installs record a
> `gitCommitSha` in `~/.claude/plugins/installed_plugins.json`, so the running
> version is identifiable. A local install records no equivalent — the cache is
> an unlabeled snapshot of your working tree at install time and drifts silently
> as you edit. Reinstall after changing a skill, and when behavior looks stale,
> diff the cache against your checkout:
>
> ```bash
> diff -rq "$(ls -d ~/.claude/plugins/cache/*/engram-coach/*/ | tail -1)skills" ./skills
> ```

**Verify**

Restart Claude Code. Type `/engram-coach` — all ten skills should appear:
`adapt-plan`, `block-review`, `consult`, `intake`, `lactate-analyze`,
`lessons-rollup`, `monitoring-rollup`, `race-analysis`,
`season-retrospective`, `set-goal`.

### Alternative: Direct OMP integration

Instead of (or in addition to) the Claude Code plugin, install `engram-coach`
and the Engram adapter directly through OMP:

```sh
omp install @isparling/engram-omp @isparling/engram-coach
```

The adapter brings its CLI runtime dependency, OMP installs the shared harness
peer, and the adapter extension is discovered from its package manifest. For
an explicit project-local npm installation instead, install the same two
packages with `npm install` and add
`./node_modules/@isparling/engram-omp/omp-extension.ts` to OMP's `extensions`
list.

The adapter does not read coaching plugin state and does not choose a pack:
the active binding's `installed_packs` declaration does that. A complete Engram
binding registry with the space already registered is an external
prerequisite; this package neither creates nor registers one. For each fresh
OMP session, the extension selects the space declared by the nearest
`engram.space.json`. Set `ENGRAM_SPACE_ID` only when that durable project
default needs an explicit runtime override.
The `installed_packs` declaration syntax itself (the fields below, and how a
binding declares a pack) is documented in the
[external pack interface](https://github.com/isparling/engram/blob/main/harness/docs/pack-interface.md).
This package documents only the pack declaration to add:

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

`version` here is the **pack identity** version exported by the package as
`engramCoachPackVersion`, not the npm release version of
`@isparling/engram-coach`. The two are deliberately independent: the core
matches pack identity by exact equality and refuses any mutation that would
change the pack provenance of an existing record, so the identity version
only ever changes together with a record migration. Keep `0.1.0` here even
when you install a newer npm release, and make your space manifest's
`required_packs` entry carry that same identity version.

**Set `ENGRAM_BINDING_REGISTRY`** to the absolute path of that binding
registry file before starting OMP. It is required, not optional: without it
the adapter logs a warning at session start and disables knowledge capture
entirely for the whole session.

```sh
export ENGRAM_BINDING_REGISTRY=<absolute-path-to-registry.json>
# Optional runtime override; omit to use the nearest engram.space.json.
export ENGRAM_SPACE_ID=<space-id>
```

**The space binding's `write_roots` must authorize both
`coaching_docs_dir` and `prescriptions_dir`**, not only the records
directory. Generated compatibility views are ordinary artifact writes, and
the core confines every artifact write to an active write root. If those two
directories are unauthorized, an approved capture still commits its records
and refreshes the index, but every view lands in the apply result's
`artifacts.stale` with `root_not_writable`, and the YAML and Markdown on disk
stay at their previous contents. Re-running `engram_capture_apply` with the
same committed hash after widening `write_roots` retries only materialization.

At each awaited OMP `session_stop`, the extension imports the binding-selected
pack and calls its optional `captureFromTurn` handler. `engram-coach` turns new
coaching observations into create-only `status: "candidate"` draft records and
refreshes the active space's scoped qmd index. Drafts remain excluded from
recall and all profile renders until explicitly reviewed and promoted to
`status: "active"`. Extraction is LLM-only through the configured capture
model — a failed or missing extraction emits a visible warning and creates no
draft.

During a turn, the agent can commit structured changes through two typed
tools: `engram_capture_preview({ change_set })` returns the exact mutation
plan bound to an immutable plan hash, and `engram_capture_apply({ plan_hash })`
commits that exact plan after the athlete approves the hash. `engram_status`
reports pending plan hashes and index freshness at any time. See §7 for the
authority model these tools enforce.

---

## 7. Knowledge Records, Generated Views, and Migration

### Authority model

Engram active records are the authoritative store for mutable coaching state
and chronological events. Every pack record declares a role in
`details.recordRole`, exactly one of:

- `state` — one current value for a canonical entity key; an approved change
  creates a new active record, retires the prior one, and links them via
  `relationships.supersedes`.
- `event` — append-only history (consultations, monitoring entries); never
  automatically replaced.
- `report-claim` — a structured conclusion extracted from an approved
  long-form report; it never replaces the report document.

Canonical entity keys are derived by the pack, never accepted from a model:

```text
workout:<session-id>
prescription:<arc-id>:<session-id>
threshold:<sport>:lt1
threshold:<sport>:lt2
persona:<active-profile>
monitoring:<concern-id>:<signal>
```

Workout identity is the durable `session_id`; `session_date`, titles, week
position, and workout contents are mutable attributes, not identity. Existing
prescriptions without stable IDs receive them during migration, and rescheduling
preserves the ID.

**Generated compatibility views** — the prescription YAML files,
`consultations.md`, monitoring logs, and doctor-prep summaries — are rendered
deterministically from committed records after every approved apply. Each
carries a byte-exact warning header (`# GENERATED FROM ENGRAM ACTIVE RECORDS.
DO NOT EDIT DIRECTLY.` in YAML; `<!-- GENERATED FROM ENGRAM ACTIVE RECORDS.
DO NOT EDIT DIRECTLY. -->` in Markdown) and is **never edited directly**:
direct edits are overwritten by the next materialization and break migration
comparisons. **Canonical approved documents** remain skill-authored long-form
files: `RACE_REPORT.md`, block `SUMMARY.md`, `SEASON_REVIEW.md`, methodology
documents, and arc-overview documents.

### Approval ordering and retry semantics

Skills that change records follow one ordering: preview records → athlete
approves the exact plan hash → apply → guarded qmd refresh → regenerate
compatibility views.

- A **stale apply** (the underlying records changed since preview) deletes the
  pending plan and requires a fresh preview plus fresh approval. The old hash
  can never be re-applied.
- An **`index-stale` status** means the qmd refresh failed or is outdated;
  the committed records remain authoritative either way, and only the index
  needs a later refresh.
- A **stale view** (materialization failed after commit) leaves the commit in
  place. Re-calling `engram_capture_apply` with the same committed hash in the
  same session reruns only view regeneration — never the record mutations.

### Dry-run migration sequence

Legacy workspaces migrate through four modes of
`analysis-tools/migrate-structured-capture.ts` (run from the installed plugin's
`analysis-tools/` directory). Everything is dry-run except `apply-baseline`,
which writes only planned stable-ID insertions and warning headers:

```sh
# 1. Plan stable session IDs + generated headers for every legacy
#    prescription and compatibility log. Prints plan JSON; mutates nothing.
npx tsx migrate-structured-capture.ts scan --config .engram-coach/config.json > scan.json

# 2. Apply ONLY the planned ID insertions and warning headers. Refuses when
#    the aggregate hash mismatches or any file drifted since the scan.
npx tsx migrate-structured-capture.ts apply-baseline --plan scan.json --expect <after-hash>

# 3. Plan the legacy import (prescription states + consultation events) into
#    a StructuredChangeSet for preview/approval. Mutates nothing.
npx tsx migrate-structured-capture.ts emit-change-set --config .engram-coach/config.json --output change-set.json

# 4. Render the record-derived views into a temporary root and byte-compare
#    them against the current source files. Exit 0 requires byte equality.
npx tsx migrate-structured-capture.ts compare --config .engram-coach/config.json --render-root /tmp/migration-render
```

Migration is idempotent: stable source IDs prevent duplicate imports, and the
cutover to record authority happens only once step 4 reports byte-equivalent
generated views.

---

## 8. Verification

Run these checks to confirm the complete setup is working before invoking a skill.

- [ ] **Skills discovered from the plugin cache**
  ```
  ls ~/.claude/plugins/cache/*/engram-coach/*/skills/*/SKILL.md
  ```
  Should list all ten `SKILL.md` files — exactly one for `adapt-plan`, `block-review`,
  `consult`, `intake`, `lactate-analyze`, `lessons-rollup`, `monitoring-rollup`,
  `race-analysis`, `season-retrospective`, and `set-goal`. Skills are discovered directly
  from each file's frontmatter (§6); there is no separate slash-command registration step
  to verify.

- [ ] **QMD collection present**
  ```
  qmd ls
  ```
  Should show the engram-coach collection.

- [ ] **Active persona readable**
  ```
  cat .engram-coach/config.json | python3 -c "import json,sys; d=json.load(sys.stdin); print('active_persona:', d['profiles']['default']['active_persona'])"
  ```
  Should print your active persona slug.

- [ ] **Persona file resolves**
  ```
  ls personas/$(python3 -c "import json; print(json.load(open('.engram-coach/config.json'))['profiles']['default']['active_persona'])").json
  ```
  Should print the persona filename without error (e.g., `personas/volume.json`).

- [ ] **Intervals.icu MCP tools appear in NanoClaw** — Check NanoClaw's tool discovery interface to confirm the Intervals.icu tools are listed.

- [ ] **coaching_docs_dir exists**
  ```
  ls $(python3 -c "import json,os; print(os.path.expanduser(json.load(open('.engram-coach/config.json'))['profiles']['default']['coaching_docs_dir']))")
  ```
  Should list directory contents without error. If the directory does not exist, create it:
  ```
  mkdir -p <your-coaching-docs-path>
  ```

All six checks passing means you are ready to invoke a skill.

---

## 9. Persistent Coaching Docs

Once you've run a few skills, your `coaching_docs_dir` will accumulate these documents:

| Document | Path | Maintained by | Purpose |
|---|---|---|---|
| `ATHLETE_PROFILE.md` | `{coaching_docs_dir}/ATHLETE_PROFILE.md` | `lessons-rollup` (curated) | Working summary of durable, athlete-specific patterns. Read by adapt-plan, consult, block-review, race-analysis, season-retrospective as reasoning context. |
| `lessons-log.md` | `{coaching_docs_dir}/lessons-log.md` | `lessons-rollup` (append-only) | Durable timestamped + source-tagged record of every calibration point captured. The skill never deletes from this file. |
| `SUMMARY.md` | `{coaching_docs_dir}/{season}/{block}/SUMMARY.md` | `block-review` | Per-block synthesis. Source for cross-block pattern detection. |
| `RACE_REPORT.md` | `{coaching_docs_dir}/{season}/races/{date-slug}/RACE_REPORT.md` | `race-analysis` | Per-race synthesis with computed metrics + athlete narrative. |
| `SEASON_REVIEW.md` | `{coaching_docs_dir}/{season}/SEASON_REVIEW.md` | `season-retrospective` | Season-level arc, persona-fit assessment, cross-block patterns. |

### Curation discipline

`ATHLETE_PROFILE.md` directly influences coaching reasoning. The `lessons-rollup` skill self-curates, but you should review the profile periodically — especially after a season-retrospective. To retire an entry that turned out wrong, edit `lessons-log.md` directly (add a note explaining the retirement) and run `lessons-rollup` standalone to re-curate the profile from the updated log.

---

## 10. Troubleshooting

**`/engram-coach:intake` not appearing in Claude Code autocomplete**
Confirm the skill files exist in the installed plugin cache:
```
ls ~/.claude/plugins/cache/*/engram-coach/*/skills/
```
If the skills are missing, re-run the install in Step 6 and restart Claude Code —
plugins are loaded at session start. Check `/plugin` to confirm engram-coach is
listed and enabled.

**"config.json not found"**
You have not created the athlete config. Either run `engram-coach:intake`, or from
your athlete repo:
```
mkdir -p .engram-coach
cp "$(ls -d ~/.claude/plugins/cache/*/engram-coach/*/ | tail -1)config.json.example" .engram-coach/config.json
```
Remember to gitignore `.engram-coach/` — it holds your API key.

**"persona file not found" / `ls: personas/undefined.json: No such file or directory`**
Your `active_persona` value in `.engram-coach/config.json` does not match any file in `personas/`. Valid slugs are: `conservative`, `aggressive`, `polarized`, `volume`. Check for typos.

**"coaching_docs_dir does not exist" or similar path error**
Create the directory:
```
mkdir -p <your-coaching-docs-path>
```
Then re-run the verification check.

**"Placeholder paths still present"**
Open `.engram-coach/config.json` and replace all `~/REPLACE_WITH_...` values with real paths.

**MCP tools not appearing in NanoClaw**
Verify the Intervals.icu MCP server is correctly configured in NanoClaw. Consult the NanoClaw documentation for MCP server setup and confirm the server is listed as active. Check that `INTERVALS_API_KEY` and `INTERVALS_ATHLETE_ID` are set correctly in the MCP server environment.

**"qmd: command not found"**
QMD is not installed. Run `pip install qmd` or consult the QMD installation docs.
