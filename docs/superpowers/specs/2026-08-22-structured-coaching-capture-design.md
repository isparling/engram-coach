# Structured Coaching Capture Architecture

**Date:** 2026-08-22  
**Status:** Approved design  
**Repositories:** `engram-coach`, `../engram`

## Goal

Make Engram records the authoritative source for mutable coaching state and chronological coaching events while preserving long-form approved reports. Replace low-value deterministic transcript drafts with LLM-synthesized candidates, and replace direct Phase 5 state/log writes with previewed, athlete-approved, hash-bound record mutations plus deterministic compatibility views.

## Decisions

1. Use two capture channels:
   - explicit skill capture for facts already structured by the workflow;
   - ambient LLM capture for additional unstructured conversational knowledge.
2. Explicit skill records approved in Phase 4 become active when the approved mutation plan is applied.
3. Ambient LLM records remain candidates until reviewed.
4. The coaching pack derives exact entity keys. Semantic search discovers context but never decides identity or replacement.
5. Use an artifact-aware hybrid authority model:
   - current prescription state and consultation/monitoring events are authoritative records;
   - prescription YAML and event logs become generated compatibility views;
   - race, block, season, methodology, and arc narrative reports remain approved canonical documents while emitting structured conclusions as records.
6. Configure capture model durably in `.engram-coach/config.json`; `ENGRAM_COACH_CAPTURE_MODEL` overrides it.
7. Remove deterministic transcript extraction. LLM failure produces no draft and a visible warning.

## Current Problems

The existing deterministic extractor emits a truncated form of the settled conversation with coarse keyword classification. It loses the structured reasoning already available inside skills, cannot reliably identify the state being changed, and cannot safely supersede prior facts.

Current Phase 5 workflows write prescription YAML, consultation logs, monitoring logs, and review documents directly. This makes current files authoritative and leaves Engram to infer facts after the fact. It also has no hash-bound link between athlete approval and record mutation.

`engram_capture` currently validates a knowledge envelope but is not sufficient as the authoritative Phase 5 path: explicit skill output needs pack-owned key derivation, reconciliation preview, stale-plan protection, activation policy, and materialization.

## Authority and Record Roles

Each pack record declares a role in `details.recordRole`:

- `state`: one current value for a canonical entity key; newer approved records may supersede it;
- `event`: append-only history; never automatically replaced;
- `report-claim`: a structured conclusion extracted explicitly from an approved long-form report; may support, refine, or supersede state but does not replace the report document.

Only active, temporally effective records participate in normal recall and materialization. Retired records remain durable history with provenance and relationships intact.

## Canonical Entity Keys

Identity is derived by `engram-coach`, never accepted directly from the LLM or skill.

Representative keys:

```text
workout:<session-id>
prescription:<arc-id>:<session-id>
threshold:<sport>:lt1
threshold:<sport>:lt2
persona:<athlete-id>
monitoring:<concern-id>:<signal>
```

Workout and prescription sessions require durable IDs. Date, title, week position, and workout contents are mutable attributes and cannot be identity. Existing prescriptions without stable IDs receive IDs during migration; rescheduling preserves the ID.

A candidate may provide key components, but the pack validates and canonicalizes them. If a unique key cannot be derived, the record remains an unbound candidate and cannot supersede anything automatically.

## Reconciliation Rules

For an approved state candidate, the pack retrieves active records with the exact canonical key and overlapping temporal/context scope.

| Existing state | Candidate | Classification |
|---|---|---|
| None | Valid keyed state | `new` |
| Equivalent value | Same keyed state | `no-change` or `support` |
| Older current value | Newer approved value | `supersede` |
| Partial additional information | Compatible state | `refine` |
| Overlapping unresolved conflict | Ambiguous state | approval blocked pending correction |
| Event/report role | New event/report claim | append; no replacement |

A supersession plan:

1. writes the new active record;
2. marks the prior active record retired;
3. sets `new.relationships.supersedes = [old-id]`;
4. preserves sources and effective timestamps;
5. includes expected content hashes for every existing record it will mutate.

Application fails as stale if any expected record changed after preview.

## Explicit Skill Capture Channel

### Structured Change Set

A skill emits domain input, not record internals:

```json
{
  "schema_version": 0,
  "source": {
    "skill": "consult",
    "session_id": "<omp-session-id>",
    "turn_id": 0
  },
  "state_changes": [
    {
      "entity_type": "prescription",
      "key_components": { "session_id": "workout-7f8c" },
      "effective_at": "2026-08-24",
      "statement": "Thursday changes from 4x8 at 295 W to 3x8 at 285 W",
      "details": {}
    }
  ],
  "events": [
    {
      "entity_type": "consultation",
      "statement": "Prescription reduced after approved consultation because final-interval power faded 12%",
      "action_targets": ["workout-7f8c"]
    }
  ]
}
```

Skills cannot choose record IDs, statuses, relationships, or records to retire.

### Phase 3 and Phase 4

Phase 3 produces coaching reasoning and a typed `StructuredChangeSet` in parallel.

Before presenting Phase 4, the skill calls `engram_capture_preview`. The extension loads the binding-selected pack; the pack validates input, derives canonical keys, finds exact related records, and asks the guarded Engram transaction path for a mutation plan and hash.

Phase 4 presents together:

1. the human coaching proposal;
2. records to create, refine, supersede, or retire;
3. compatibility artifacts that will regenerate;
4. the exact plan hash.

Athlete approval therefore covers both coaching behavior and durable state mutation.

### Phase 5

After approval, Phase 5 calls `engram_capture_apply` with the expected plan hash. The core refuses stale or mismatched plans.

Successful apply:

1. commits active records and relationships;
2. retires superseded state;
3. refreshes the guarded scoped qmd index;
4. invokes pack materializers;
5. reports record IDs and regenerated artifacts.

Explicit records are active because the athlete approved their exact mutation preview.

## Ambient Conversation Capture

At awaited OMP `session_stop`, the extension passes only the latest user turn to the pack's `captureFromTurn` handler. If the turn already contains a successful explicit capture for an entity key, ambient extraction suppresses that duplicate.

The extension supplies a `complete()` mechanic backed by a child OMP process. The pack owns the prompt, JSON schema, validation, candidate count, and model choice.

Headless OMP runs with equivalent isolation to:

```text
omp --no-session --no-extensions --no-skills --no-prompt-templates \
  --mode text --model <capture-model> -p <extraction-prompt>
```

The process receives the stop-hook abort signal and a 60-second timeout. It cannot load Engram extensions, coaching skills, session history, or prompt templates, preventing recursive capture and workflow contamination.

The extractor requires strict JSON. It may make one repair attempt for malformed JSON. Timeout, cancellation, model failure, or a second invalid response emits a warning and creates no draft. There is no deterministic fallback.

Ambient candidates:

- use pack-derived canonical keys when unambiguous;
- remain `status: candidate`;
- never retire or supersede active records before review;
- retain session/turn and LLM-inference provenance;
- contain concise atomic statements rather than transcript excerpts.

## Capture Model Configuration

Add to `.engram-coach/config.json`:

```json
{
  "capture": {
    "model": "<provider/model>",
    "timeout_seconds": 60,
    "max_candidates_per_turn": 3
  }
}
```

Precedence:

```text
ENGRAM_COACH_CAPTURE_MODEL
→ capture.model
→ configuration error
```

No implicit OMP default or current-session model is used. This keeps extraction cost and quality stable when unrelated OMP settings change.

## Interfaces

### Pack module exports

```ts
captureFromTurn(turn, tools): Promise<CaptureSummary>
previewStructuredCapture(changeSet, tools): Promise<CapturePreview>
materialize(appliedPlan, tools): Promise<MaterializationResult>
```

### OMP tools

```text
engram_capture_preview
engram_capture_apply
engram_status
```

### Extension-provided mechanics

The extension supplies only host mechanics:

- guarded core preview/apply;
- exact related-record lookup;
- records-root-confined create-only writes;
- artifact-root-confined atomic replacement;
- guarded qmd refresh;
- headless OMP completion;
- cancellation and bounded timeout.

The extension owns no coaching ontology, key policy, supersession policy, prompt, or materialization shape.

## Artifact Materialization

### Generated compatibility views

- prescription YAML renders from active prescription/workout state;
- `consultations.md` renders consultation events chronologically;
- monitoring logs and doctor-prep summaries render from monitoring event/state records;
- athlete and coach profiles continue through the presentation pack.

Generated files include a non-authoritative header and are never edited directly. Existing skills and analysis tools may continue reading them during migration.

### Canonical narrative documents

The following remain approved long-form documents:

- `RACE_REPORT.md`;
- block `SUMMARY.md`;
- `SEASON_REVIEW.md`;
- methodology documents;
- arc overview documents.

Their explicitly approved structured conclusions enter Engram through the explicit capture channel. Ambient extraction is not responsible for reconstructing report conclusions.

## Failure Semantics

Ordering:

```text
preview records
→ athlete approves hash
→ apply records
→ guarded index refresh
→ regenerate compatibility views
```

- Preview failure blocks Phase 4 completion.
- Stale apply returns to preview and athlete approval.
- Apply failure blocks Phase 5; no compatibility view is written.
- Index refresh failure leaves committed records authoritative and reports the stale index for retry.
- Materialization failure does not roll back valid records; it reports a stale view and retries idempotently.
- Long-form report write failure blocks report-oriented skill completion.
- Ambient LLM failure never blocks the coaching response or explicit Phase 5 path.

## Migration

1. Add stable IDs to every existing prescription session while preserving current dates and content.
2. Import current prescription state as active keyed records.
3. Import consultation history as append-only events.
4. Generate and compare compatibility YAML/log views against current files.
5. Cut over `consult` and `adapt-plan` Phase 3–5 flows.
6. Migrate monitoring events/state and materializers.
7. Update block/race/season skills to retain reports and explicitly emit structured conclusions.
8. Migrate `set-goal` last because it creates the complete arc, methodology, and prescription graph.
9. Remove direct edits to generated compatibility views once all readers use records or generated outputs.

Migration is idempotent: stable source IDs prevent duplicate imports, and byte-equivalent generated views are required before authority cutover.

## Verification

Required automated contracts:

1. Stable key derivation and rescheduled workout identity.
2. State supersession versus append-only events.
3. Ambiguous keys cannot auto-supersede.
4. Mutation hashes reject stale apply.
5. Approved skill records activate; ambient records remain candidates.
6. Explicit/ambient duplicate suppression.
7. Headless OMP uses configured model and disables sessions/extensions/skills/templates.
8. Malformed JSON repair, timeout, cancellation, and no deterministic fallback.
9. Records-root and artifact-root symlink confinement.
10. Materializer output determinism and stale-view retry.
11. Existing prescription/consultation migration fixtures.
12. Complete `consult` scenario: approved change retires prior state, activates new state/event, refreshes qmd, regenerates YAML/log views, and produces no duplicate ambient candidate.
13. Complete `adapt-plan` scenario with the same approval and materialization guarantees.

Required live smoke:

1. Start a fresh OMP session in the training repo with durable space auto-selection.
2. Run a real `consult` interaction through approval.
3. Verify previewed and applied record IDs/relationships.
4. Verify prior prescription state is retired and new state is active.
5. Verify generated prescription and consultation views.
6. Verify ambient capture produces only non-duplicate candidate knowledge.

## Non-Goals

- Engram core does not define coaching entity keys or draft policy.
- The OMP extension does not interpret coaching content.
- Ambient extraction does not replace explicit skill output.
- Long-form reports are not reconstructed from atomic records.
- Semantic similarity never authorizes supersession.
- This design does not publish packages or migrate production data during implementation planning.
