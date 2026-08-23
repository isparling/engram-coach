# Structured Coaching Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make approved Engram records authoritative for mutable coaching state and chronological coaching events, with hash-bound explicit capture, LLM-only ambient candidates, deterministic compatibility views, and preserved canonical reports.

**Architecture:** Engram core continues to own guarded retrieval, mutation planning, stale-hash enforcement, atomic record commits, scoped qmd refresh, and filesystem confinement. The OMP adapter exposes those mechanics to the binding-selected pack through `engram_capture_preview` and `engram_capture_apply`; `engram-coach` owns typed change sets, canonical keys, reconciliation policy, ambient prompts, configuration, and materializers. Existing YAML and event Markdown remain generated compatibility views while approved narrative reports remain canonical documents.

**Tech Stack:** TypeScript 7, Node.js 26 test runner, Bun OMP extension tests/process spawning, Vitest 3, `yaml` 2.x, Markdown knowledge records, qmd, Oh My Pi.

**Spec:** `docs/superpowers/specs/2026-08-22-structured-coaching-capture-design.md`

## Global Constraints

- Work spans sibling repositories `engram-coach` and `../engram`; keep them adjacent so file-based package imports and integration tests resolve.
- Explicit skill records approved in Phase 4 become `status: "active"` only when the approved plan hash is applied.
- Ambient LLM records remain `status: "candidate"`; they never retire or supersede active records before review.
- `engram-coach` derives and validates every canonical entity key. Semantic search may provide coaching context but never selects identity or authorizes replacement.
- `details.recordRole` is exactly `state`, `event`, or `report-claim`.
- State replacement creates a new active record, retires the prior active record, and writes `new.relationships.supersedes = [old-id]`; events append without replacement.
- Workout identity uses durable `session_id`; `session_date`, title, week position, and workout contents are mutable attributes.
- Capture configuration lives in `.engram-coach/config.json`; `ENGRAM_COACH_CAPTURE_MODEL` overrides `capture.model`; absence of both is a configuration error.
- Ambient completion uses `timeout_seconds: 60` and `max_candidates_per_turn: 3` unless those exact positive values are overridden in config.
- Headless completion disables sessions, extensions, skills, and prompt templates. It receives the stop-hook abort signal and never inherits the current-session model implicitly.
- Ambient malformed JSON gets one repair attempt. Timeout, cancellation, model failure, or a second invalid response creates no draft and emits a visible warning. There is no deterministic fallback.
- Ordering is `preview records -> athlete approves hash -> apply records -> guarded qmd refresh -> regenerate compatibility views`.
- Record commit remains authoritative if qmd refresh or materialization fails. Materialization retry is idempotent and never reapplies committed record mutations.
- Generated YAML/log files carry a non-authoritative warning header and are never edited directly after their skill cutover.
- `RACE_REPORT.md`, block `SUMMARY.md`, `SEASON_REVIEW.md`, methodology documents, and arc-overview documents remain approved canonical documents.
- No task publishes packages or migrates production athlete data. Migration tests and the final smoke use synthetic fixtures or an explicitly disposable training space.
- No `as any`, implicit untyped JSON, or duplicate compatibility shim. Migrate every affected caller when an interface changes.

## File Structure

### `../engram`

- Modify `harness/src/knowledgeTypes.ts`: replace query-only pack reconciliation lookup with a search-or-exact related-record selector.
- Modify `harness/src/knowledgeRetrieval.ts`: enumerate and guard exact-selector records without qmd ranking.
- Modify `harness/src/knowledgeTransaction.ts`: use the pack selector while retaining authoritative input hashes and stale approval checks.
- Create `harness/src/captureTypes.ts`: public, host-neutral DTOs for preview/apply/list/complete/artifact mechanics.
- Create `harness/src/knowledgeListing.ts`: guarded active-space record enumeration for materializers.
- Create `harness/src/artifactReplacement.ts`: active-write-root-confined atomic artifact replacement.
- Modify `harness/src/cli.ts`: add machine-readable record-list and artifact-replace commands used by the OMP adapter.
- Modify `harness/package.json`: export and package `captureTypes.ts`.
- Modify `harness/omp/omp-extension.ts`: expose preview/apply/status tools, pending-plan state, child OMP completion, latest-user-turn construction, and materialization retry.
- Modify `harness/test/fictionalPack.ts`, `harness/test/packLoader.fixture.ts`, `harness/test/knowledgeTransaction.test.ts`, and `harness/omp/ompExtension.check.ts`: migrate contracts and pin host behavior.
- Create `harness/test/artifactReplacement.test.ts` and `harness/test/knowledgeListing.test.ts`: confinement and enumeration contracts.

### `engram-coach`

- Create `engram-coach-capture-types.ts`: structured change-set, preview, apply, ambient summary, and materialization result types.
- Create `engram-coach-config.ts`: config path resolution and capture configuration validation.
- Create `engram-coach-keys.ts`: canonical key derivation and unbound-key diagnostics.
- Create `engram-coach-structured-capture.ts`: explicit candidate construction, exact reconciliation, and preview projection.
- Create `engram-coach-ambient-capture.ts`: strict LLM extraction and one-shot repair.
- Rewrite `capture-handler.ts`: candidate-only ambient persistence and explicit/ambient duplicate suppression.
- Create `engram-coach-materialization.ts`: prescription, consultation, adaptation, and monitoring compatibility renderers.
- Create `engram-coach-migration.ts`: stable session-ID assignment and idempotent legacy import planning.
- Create `analysis-tools/migrate-structured-capture.ts`: dry-run migration CLI with hash-bound ID-file application.
- Create `analysis-tools/structured-capture-test-support.ts`: synthetic active-space and artifact helpers shared by scenario tests.
- Create focused `analysis-tools/structured-capture-*.test.ts` files and synthetic fixtures under `analysis-tools/fixtures/structured-capture/`.
- Modify `engram-coach-domain.ts`, `engram-coach-reconciliation.ts`, `engram-coach-pack.ts`, `engram-coach-presentation.ts`, `package.json`, and `package-lock.json` for the new capture surfaces and `yaml` runtime dependency.
- Delete `engram-coach-extractor.ts` after every import and package-file entry moves to `engram-coach-ambient-capture.ts`.
- Modify `config.json.example`, `PRESCRIPTION_FORMAT.md`, `README.md`, `SETUP.md`, `SKILL_PACK.md`, `shared/setup.md`, and `skills/intake/SKILL.md` for durable IDs and capture config.
- Modify `skills/consult/SKILL.md`, `skills/adapt-plan/SKILL.md`, and `skills/monitoring-rollup/SKILL.md` for preview/apply/materialized views.
- Modify `skills/race-analysis/SKILL.md`, `skills/block-review/SKILL.md`, `skills/season-retrospective/SKILL.md`, and `skills/set-goal/SKILL.md` for canonical reports plus explicit structured conclusions.

---

### Task 1: Add exact related-record selection to Engram transactions

**Files:**
- Modify: `../engram/harness/src/knowledgeTypes.ts:102-130`
- Modify: `../engram/harness/src/knowledgeRetrieval.ts:100-140,390-473`
- Modify: `../engram/harness/src/knowledgeTransaction.ts:454-528`
- Modify: `../engram/harness/test/fictionalPack.ts`
- Modify: `../engram/harness/test/packLoader.fixture.ts`
- Modify: `../engram/harness/test/knowledgeTransaction.test.ts`

**Interfaces:**
- Consumes: `KnowledgeEnvelope`, `KnowledgeRecord`, `RetrievalOutcome`, and existing guarded record-locator checks.
- Produces: `RelatedRecordSelection` and `KnowledgePack.selectRelatedRecords(envelope)`; exact mode enumerates the active records root and invokes a pack-owned predicate after containment and parsing guards.

- [ ] **Step 1: Write failing exact-selection transaction tests**

Add a test pack that selects only records whose pack-owned entity key exactly matches the candidate. Assert that no qmd process runs, a phrase-similar record is excluded, and a matching active record is included:

```ts
const exactKeyPack: KnowledgePack = {
  ...fictionalPack,
  selectRelatedRecords: (envelope) => {
    const entityKey = envelope.details.entityKey;
    return {
      mode: "exact",
      description: `details.entityKey=${String(entityKey)}`,
      matches: (record) => record.details.entityKey === entityKey,
    };
  },
  reconcile: ({ candidate, related }) => {
    assert.deepEqual(related.map((record) => record.id), ["orbit-claim"]);
    return fictionalPack.reconcile({ candidate, related });
  },
};
```

Add a second test that places a symlinked Markdown locator under `recordsRoot` and expects `retrieval_failed` with a containment error before the pack predicate can accept it.

- [ ] **Step 2: Run the focused transaction test and confirm failure**

Run:

```bash
cd ../engram/harness
node --test --experimental-strip-types --test-name-pattern="exact related-record|exact selector symlink" test/knowledgeTransaction.test.ts
```

Expected: FAIL because `KnowledgePack` has no `selectRelatedRecords` contract and transaction reconciliation still calls `relatedQuery`/qmd.

- [ ] **Step 3: Replace the query-only pack contract**

Add these types and migrate all in-repository packs and fixtures in the same step; remove `relatedQuery` rather than retaining an alias:

```ts
export type RelatedRecordSelection =
  | { mode: "search"; query: string }
  | {
      mode: "exact";
      description: string;
      matches: (record: KnowledgeRecord) => boolean;
    };

export type KnowledgePack = {
  id: string;
  version: string;
  validateEnvelope: (envelope: KnowledgeEnvelope) => KnowledgeResult<void>;
  selectRelatedRecords: (envelope: KnowledgeEnvelope) => RelatedRecordSelection;
  reconcile: (input: PackReconcileInput) => KnowledgeResult<PackReconciliation>;
};
```

Use `{ mode: "search", query: existingQuery }` for non-coaching fictional packs so their behavior remains unchanged.

- [ ] **Step 4: Implement guarded exact enumeration**

Export a transaction-internal enumerated retrieval path that reuses `enumerateCandidates`, `readLocatedRecord`, and the existing containment/parser checks, then filters parsed records with the pack predicate:

```ts
export async function retrieveExactRelatedRecords(
  binding: ActiveSpace,
  description: string,
  matches: (record: KnowledgeRecord) => boolean,
): Promise<RetrievalOutcome> {
  const enumerated = await enumerateCandidates(binding);
  if (enumerated.kind === "failure") {
    return { kind: "failure", errors: [enumerated.error], receipt: emptyReceipt(binding, description, "miss", "space") };
  }
  const guarded = await filterCandidates(binding, enumerated.candidates, undefined, false);
  if (guarded.kind === "failure") {
    return { kind: "failure", errors: [guarded.error], receipt: withheldReceipt(emptyReceipt(binding, description, "miss", "space"), guarded.withheldCount) };
  }
  const records = guarded.records.filter((item) => matches(item.record));
  const receipt = receiptForEnumeratedRecords(binding, description, records, guarded.withheldCount);
  return records.length === 0 ? { kind: "miss", receipt } : { kind: "hit", records, receipt };
}
```

Name `receiptForEnumeratedRecords` exactly and make it report `scope: "space"`, `relevanceThreshold: null`, deterministic locator order, and only matched record IDs.

- [ ] **Step 5: Route transaction preview through the selector**

In `reconcileKnowledgeTransaction`, validate the selected branch, call qmd only for `mode: "search"`, and call `retrieveExactRelatedRecords` for `mode: "exact"`. Preserve the existing authoritative re-read and `beforeHash` capture for every returned record; exact mode changes discovery, not stale-plan enforcement.

- [ ] **Step 6: Run focused and full Engram gates**

Run:

```bash
cd ../engram/harness
node --test --experimental-strip-types test/knowledgeTransaction.test.ts test/packLoader.test.ts test/packResolution.test.ts
npm run typecheck
```

Expected: all tests PASS; typecheck exits 0.

- [ ] **Step 7: Commit the exact-selection contract**

```bash
git -C ../engram add harness/src/knowledgeTypes.ts harness/src/knowledgeRetrieval.ts harness/src/knowledgeTransaction.ts harness/test/fictionalPack.ts harness/test/packLoader.fixture.ts harness/test/knowledgeTransaction.test.ts
git -C ../engram commit -m "feat(harness): add exact related record selection"
```

### Task 2: Add generic record-list and atomic artifact mechanics

**Files:**
- Create: `../engram/harness/src/captureTypes.ts`
- Create: `../engram/harness/src/knowledgeListing.ts`
- Create: `../engram/harness/src/artifactReplacement.ts`
- Create: `../engram/harness/test/knowledgeListing.test.ts`
- Create: `../engram/harness/test/artifactReplacement.test.ts`
- Modify: `../engram/harness/src/cli.ts`
- Modify: `../engram/harness/package.json`

**Interfaces:**
- Consumes: active-space binding resolution, `KnowledgeRecord`, guarded enumeration, `atomicWriteFile`, and active `writeRoots`.
- Produces: public capture DTOs plus CLI commands `engram knowledge list --pack <id> --status <status>` and `engram artifact replace --root <absolute-root> --relative <path> --input <file>`.

- [ ] **Step 1: Write failing guarded-list tests**

Create tests that seed active, candidate, and retired records from two pack IDs, call `listKnowledgeRecords`, and assert exact pack/status filtering with deterministic record-ID ordering. Add a symlinked record test that expects a guarded retrieval error rather than omission.

```ts
const result = await listKnowledgeRecords(active, {
  packId: "engram-coach",
  statuses: ["active"],
});
assert.equal(result.ok, true);
if (!result.ok) throw new Error("expected guarded record list");
assert.deepEqual(result.value.map((record) => record.id), ["active-a", "active-b"]);
```

- [ ] **Step 2: Write failing artifact confinement tests**

Cover all required boundaries: a normal replacement, byte-identical no-op, relative `..` escape, root outside active `writeRoots`, parent-directory symlink escape, target symlink, and a write failure that leaves the previous artifact bytes intact.

```ts
const replaced = await replaceArtifact(active, {
  root: artifactRoot,
  relativePath: "prescriptions/build.yaml",
  content: "generated\n",
});
assert.deepEqual(replaced, {
  ok: true,
  value: { status: "replaced", path: join(artifactRoot, "prescriptions", "build.yaml") },
});
```

- [ ] **Step 3: Run both new tests and confirm failure**

Run:

```bash
cd ../engram/harness
node --test --experimental-strip-types test/knowledgeListing.test.ts test/artifactReplacement.test.ts
```

Expected: FAIL because the modules do not exist.

- [ ] **Step 4: Define public host-capture DTOs**

Create `captureTypes.ts` with JSON-safe DTOs shared by the OMP adapter and external packs:

```ts
import type { JsonObject, KnowledgeError, KnowledgeRecord } from "./knowledgeTypes.ts";

export type CaptureMutationView = {
  recordId: string;
  action: "create" | "update";
  beforeHash: string | null;
  after: KnowledgeRecord;
};

export type HostCapturePreview =
  | { schemaVersion: 0; status: "ready"; planHash: string; mutations: CaptureMutationView[] }
  | { schemaVersion: 0; status: "blocked"; errors: KnowledgeError[] };

export type HostCaptureApply = {
  schemaVersion: 0;
  status: "committed" | "no-change" | "stale" | "failed";
  planHash: string;
  mutations: CaptureMutationView[];
  index: "fresh" | "stale" | "not-attempted";
  errors: string[];
};

export type ArtifactReplacementResult = {
  status: "replaced" | "unchanged";
  path: string;
};

export type CompletionRequest = {
  model: string;
  prompt: string;
  system: string;
  timeoutSeconds: number;
};

export type CaptureChangeSetInput = JsonObject;
```

Export `./capture-types` in `harness/package.json` and include the file in the package allowlist.

- [ ] **Step 5: Implement guarded listing**

Implement `listKnowledgeRecords(active, filter)` by using guarded space enumeration, then exact in-memory `pack.id` and status checks. Return `KnowledgeResult<KnowledgeRecord[]>`; never shell to qmd and never accept a caller-supplied filesystem root.

- [ ] **Step 6: Implement active-root-confined artifact replacement**

Canonicalize the requested root, require it to be inside an active `writeRoot` and `spaceRoot`, resolve every existing parent without following an escaping symlink, reject a symlink target, compare current bytes, and call `atomicWriteFile` only when bytes differ. The root is pack-selected configuration; the binding remains the final authorization boundary.

- [ ] **Step 7: Add machine-readable CLI commands**

Add:

```text
engram knowledge list --pack engram-coach --status active
engram artifact replace --root /absolute/authorized/root --relative path/file.md --input /private/temp/input
```

Both commands resolve the active space from the session-bound environment. Emit JSON only. `knowledge list` returns schema version 0, status `ok`, and an ordered `KnowledgeRecord[]`; artifact replace returns status `replaced` or `unchanged` plus the resolved path. Invalid or confined-path failures exit 1 and include structured errors.

- [ ] **Step 8: Run tests, CLI tests, and typecheck**

Run:

```bash
cd ../engram/harness
node --test --experimental-strip-types test/knowledgeListing.test.ts test/artifactReplacement.test.ts test/cli.test.ts
npm run typecheck
```

Expected: all tests PASS; typecheck exits 0.

- [ ] **Step 9: Commit the host mechanics**

```bash
git -C ../engram add harness/src/captureTypes.ts harness/src/knowledgeListing.ts harness/src/artifactReplacement.ts harness/src/cli.ts harness/package.json harness/test/knowledgeListing.test.ts harness/test/artifactReplacement.test.ts harness/test/cli.test.ts
git -C ../engram commit -m "feat(harness): add capture host mechanics"
```

### Task 3: Expose hash-bound structured capture through OMP

**Files:**
- Modify: `../engram/harness/omp/omp-extension.ts:55-106,295-603`
- Modify: `../engram/harness/omp/ompExtension.check.ts`
- Modify: `../engram/harness/test/packLoader.fixture.ts`
- Modify: `../engram/harness/omp/README.md`
- Modify: `../engram/harness/omp/SPEC.md`

**Interfaces:**
- Consumes: binding-selected module exports `previewStructuredCapture` and `materialize`, CLI reconcile/approve/list/artifact commands, and DTOs from `@isparling/engram-harness/capture-types`.
- Produces: OMP tools `engram_capture_preview({ change_set })`, `engram_capture_apply({ plan_hash })`, and extended `engram_status()`; removes the old free-form `engram_capture` tool.

- [ ] **Step 1: Extend the fixture pack and write failing OMP tool tests**

The fixture preview returns a candidate plus a public preview; the extension must retain the candidate privately and expose only the mutation summary:

```ts
export async function previewStructuredCapture(changeSet: JsonObject, tools: FixturePreviewTools) {
  const candidate = fixtureCandidate(changeSet);
  const host = await tools.previewCandidate(candidate);
  if (host.status === "blocked") return { schemaVersion: 0, status: "blocked" as const, errors: host.errors };
  return {
    schemaVersion: 0,
    status: "ready" as const,
    planHash: host.planHash,
    candidate,
    changes: host.mutations.map((mutation) => ({ recordId: mutation.recordId, action: mutation.action })),
    artifacts: ["prescriptions/build.yaml", "coaching/consultations.md"],
  };
}
```

Test preview output, candidate secrecy, apply with the same hash, stale apply after record mutation, retry-after-materializer-failure, and session switch clearing pending plans.

- [ ] **Step 2: Run the OMP check and confirm failure**

Run:

```bash
cd ../engram/harness
bun test ./omp/ompExtension.check.ts
```

Expected: FAIL because preview/apply tools and pack surfaces are absent.

- [ ] **Step 3: Resolve the complete capture module surface**

Replace the ambient-only `CaptureResolution` with a module resolution that validates pack identity once and independently records optional `captureFromTurn`, `previewStructuredCapture`, and `materialize` functions. A pack selected with `extract: true` is valid when it exports `captureFromTurn`; do not require its root pack object to implement `KnowledgeExtractor.extractCandidates`.

- [ ] **Step 4: Implement host preview mechanics**

`previewCandidate(candidate)` must write the candidate to a mode-0600 temporary file, invoke:

```text
engram knowledge reconcile --candidate <temp-file>
```

Map `proposal.plan_hash`, each planned mutation's `recordId`, `action`, `beforeHash`, and `after` into `HostCapturePreview`. Map every invalid/retrieval failure to `status: "blocked"`; remove the temporary directory in `finally`.

- [ ] **Step 5: Register `engram_capture_preview`**

Use this exact JSON schema:

```ts
{
  type: "object",
  properties: {
    change_set: { type: "object" },
  },
  required: ["change_set"],
  additionalProperties: false,
}
```

Call the binding-selected pack function, require the returned hash to match the host preview hash captured by `previewCandidate`, store `{ sessionId, candidate, preview, state: "previewed" }` in a `Map<string, PendingCapture>`, and return only `plan_hash`, `changes`, `artifacts`, and blocked errors.

- [ ] **Step 6: Implement materialization host mechanics**

`listRecords()` invokes `engram knowledge list --pack <binding-selected-pack> --status active` and validates every returned record before exposing it to the pack. `replaceArtifact(request)` writes content to a mode-0600 temporary file, invokes `engram artifact replace --root <configured-root> --relative <relative-path> --input <temp-file>`, maps the JSON response, and removes the temporary directory in `finally`. Pass `projectRoot` and one captured apply timestamp as context. The adapter never interprets record roles, entity keys, artifact kinds, or output shape.

- [ ] **Step 7: Register `engram_capture_apply`**

Use `{ plan_hash: string }` as the only input. Reject unknown/session-mismatched hashes without invoking the CLI. For a previewed entry, write its candidate to a protected temp file and invoke:

```text
engram knowledge approve --candidate <temp-file> --expect <plan-hash>
```

Map stale approval to `status: "stale"`, delete that pending preview, and require a fresh preview/approval. On commit or no-change, pass the applied mutation view to `materialize`. Return `plan_hash`, created/retired record IDs, sorted applied `entity_keys`, generated/unchanged/stale artifact paths, and index state so the ambient hook and athlete can verify the outcome. If materialization fails, retain the entry as `state: "records-committed"`; a second apply with the same hash reruns only `materialize` and never runs `knowledge approve` again.

- [ ] **Step 8: Extend `engram_status` and remove free-form capture**

Report `pack_id`, `pack_version`, `mode`, `pending_plan_hashes`, `index_state`, and `stale_artifacts`. Remove `engram_capture` registration, its free-form candidate construction, temporary-file code, tests, and docs. The two typed tools are the only explicit capture path.

- [ ] **Step 9: Run OMP tests and typecheck**

Run:

```bash
cd ../engram/harness
bun test ./omp/ompExtension.check.ts
npm run typecheck
```

Expected: all tests PASS; preview/apply stale-hash and materializer-retry assertions pass.

- [ ] **Step 10: Commit structured OMP capture**

```bash
git -C ../engram add harness/omp/omp-extension.ts harness/omp/ompExtension.check.ts harness/test/packLoader.fixture.ts harness/omp/README.md harness/omp/SPEC.md
git -C ../engram commit -m "feat(omp): add hash-bound capture tools"
```

### Task 4: Add isolated child-OMP completion and latest-user-turn capture

**Files:**
- Modify: `../engram/harness/omp/omp-extension.ts:397-510,609-703`
- Modify: `../engram/harness/omp/ompExtension.check.ts`
- Modify: `../engram/harness/test/packLoader.fixture.ts`

**Interfaces:**
- Consumes: pack-supplied `CompletionRequest`, `SessionStopEvent.signal`, OMP messages, ambient `CaptureSummary.warnings`, and the OMP project root.
- Produces: `tools.complete(request): Promise<string>` plus `tools.projectRoot`, and a `TurnContext` whose `narrative` contains only the latest user message while `toolCalls` retains subsequent explicit-capture calls/results.

- [ ] **Step 1: Write failing child-process argument tests**

Inject a spawn seam into the extension test fixture and assert this exact argument vector for model `synthetic/provider-model`:

```ts
[
  "omp",
  "--no-session",
  "--no-extensions",
  "--no-skills",
  "--no-prompt-templates",
  "--mode",
  "text",
  "--model",
  "synthetic/provider-model",
  "-p",
  "synthetic extraction prompt",
]
```

Assert the stop-hook abort signal reaches the process, a 60-second request gets a bounded timer, nonzero exit rejects with stderr, and the extension logs pack-returned warnings without attempting a fallback capture.

- [ ] **Step 2: Write failing latest-turn tests**

Provide two user turns plus assistant/tool messages. Assert the fixture receives only the second user text in `turn.narrative`, while a successful `engram_capture_apply` call and its result remain in `turn.toolCalls` for duplicate suppression.

- [ ] **Step 3: Run the OMP check and confirm failure**

Run:

```bash
cd ../engram/harness
bun test ./omp/ompExtension.check.ts
```

Expected: FAIL because `complete` is absent and `buildTurnContext` still concatenates the settled transcript.

- [ ] **Step 4: Implement bounded headless completion**

Add an injectable `spawnOmp` seam used only by tests. Production uses `Bun.spawn` with the exact isolation flags above, `stdout: "pipe"`, `stderr: "pipe"`, and an abort signal combined from the stop hook and `timeoutSeconds`. Return stdout only for exit 0. Throw typed errors whose messages distinguish `capture_cancelled`, `capture_timeout`, and `capture_model_failed`.

- [ ] **Step 5: Restrict the turn narrative without losing tool provenance**

Find the last user message, set `narrative` to only its extracted text, and inspect messages from that index onward for assistant tool calls and tool results. Set `turnIndex` to the stable index of that user message, not total message count, so repeat settlement produces the same ambient IDs.

- [ ] **Step 6: Log visible ambient warnings**

Extend `CaptureSummary` handling to log every warning returned by the pack. Cancellation should not create a draft; if the outer event is already aborted, stop without additional filesystem work.

- [ ] **Step 7: Run OMP tests and commit**

Run:

```bash
cd ../engram/harness
bun test ./omp/ompExtension.check.ts
npm run typecheck
```

Expected: all tests PASS.

```bash
git -C ../engram add harness/omp/omp-extension.ts harness/omp/ompExtension.check.ts harness/test/packLoader.fixture.ts
git -C ../engram commit -m "feat(omp): isolate ambient capture completion"
```

### Task 5: Define capture config, change sets, and canonical keys

**Files:**
- Create: `engram-coach-capture-types.ts`
- Create: `engram-coach-config.ts`
- Create: `engram-coach-keys.ts`
- Create: `analysis-tools/structured-capture-domain.test.ts`
- Modify: `engram-coach-domain.ts`
- Modify: `config.json.example`
- Modify: `package.json`

**Interfaces:**
- Consumes: `JsonObject`, `KnowledgeEnvelope`, `KnowledgeRecord`, host capture DTOs, process environment, active profile config, and the design's canonical key formats.
- Produces: `StructuredChangeSet`, `CapturePreview`, `CaptureSummary`, `MaterializationResult`, `loadEngramCoachConfig`, and `deriveCanonicalEntityKey`.

- [ ] **Step 1: Write failing config and key tests**

Cover config path precedence, model env override, missing-model error, positive timeout/candidate limits, stable workout identity after rescheduling, normalized threshold/persona/monitoring keys, required prescription arc/session components, and unbound-key results.

```ts
expect(deriveCanonicalEntityKey({
  entity_type: "workout",
  key_components: { session_id: "workout-7f8c" },
  effective_at: "2026-08-24",
  statement: "Rescheduled from Thursday to Saturday",
  details: { session_date: "2026-08-29", session_name: "W3_SubLT2" },
})).toEqual({
  kind: "bound",
  key: "workout:workout-7f8c",
});
```

- [ ] **Step 2: Run the domain test and confirm failure**

Run:

```bash
npm test --prefix analysis-tools -- structured-capture-domain.test.ts
```

Expected: FAIL because the capture modules do not exist.

- [ ] **Step 3: Define the typed domain input**

Use snake_case because the OMP tool receives JSON. Skills may provide domain values and artifact metadata but never IDs, lifecycle status, relationship arrays, or retirement targets:

```ts
export type RecordRole = "state" | "event" | "report-claim";

export type StructuredCaptureSource = {
  skill: EngramCoachSkill;
  session_id: string;
  turn_id: number;
};

export type StructuredStateChange = {
  entity_type: "workout" | "prescription" | "threshold" | "persona" | "monitoring";
  key_components: JsonObject;
  effective_at: string;
  statement: string;
  details: JsonObject;
};

export type StructuredEvent = {
  entity_type: "consultation" | "workout-adaptation" | "monitoring-event";
  effective_at: string;
  statement: string;
  action_targets: string[];
  details: JsonObject;
};

export type StructuredReportClaim = {
  entity_type: "race-conclusion" | "block-conclusion" | "season-conclusion" | "methodology-conclusion" | "arc-conclusion";
  key_components: JsonObject;
  effective_at: string;
  statement: string;
  source_document: string;
  details: JsonObject;
};

export type StructuredChangeSet = {
  schema_version: 0;
  source: StructuredCaptureSource;
  state_changes: StructuredStateChange[];
  events: StructuredEvent[];
  report_claims: StructuredReportClaim[];
};
```

Define JSON-safe unions for ready/blocked `CapturePreview`, ambient `CaptureSummary` with `warnings: string[]`, applied-plan input, and `MaterializationResult` with `written`, `unchanged`, and `stale` artifact arrays.

- [ ] **Step 4: Implement config resolution and validation**

Resolve config in existing order: `ENGRAM_COACH_CONFIG`, `<projectRoot>/.engram-coach/config.json`, then `~/.claude/engram-coach/config.json`. Parse the active profile and these capture fields:

```ts
export type CaptureConfig = {
  model: string;
  timeoutSeconds: number;
  maxCandidatesPerTurn: number;
};

export type EngramCoachRuntimeConfig = {
  activeProfile: string;
  coachingDocsDir: string;
  prescriptionsDir: string;
  capture: CaptureConfig;
};
```

Set `model` from `ENGRAM_COACH_CAPTURE_MODEL` when nonblank, otherwise `capture.model`; fail if neither exists. Default omitted timeout/max fields to 60/3, reject non-integers, nonpositive values, timeout above 60, or max above 3.

- [ ] **Step 5: Implement canonical key derivation**

Use exact lower-case slug normalization for human components and preserve validated durable IDs verbatim. Implement these keys:

```text
workout:<session-id>
prescription:<arc-id>:<session-id>
threshold:<sport>:lt1
threshold:<sport>:lt2
persona:<active-profile>
monitoring:<concern-id>:<signal>
```

Prescription keys require both `arc_id` and `session_id`; missing or invalid components return `unbound` and explicit preview blocks. The invoking skill already has arc context from the loaded prescription. Dates, titles, week numbers, and workout bodies never participate in identity.

- [ ] **Step 6: Add config example and package entries**

Add:

```json
"capture": {
  "model": "REPLACE_WITH_PROVIDER/MODEL",
  "timeout_seconds": 60,
  "max_candidates_per_turn": 3
}
```

Add new runtime files to `package.json.files`. Do not add `yaml` until the materialization task consumes it.

- [ ] **Step 7: Run domain tests and typecheck**

Run:

```bash
npm test --prefix analysis-tools -- structured-capture-domain.test.ts
npm run typecheck
```

Expected: all tests PASS; typecheck exits 0.

- [ ] **Step 8: Commit capture domain foundations**

```bash
git add engram-coach-capture-types.ts engram-coach-config.ts engram-coach-keys.ts engram-coach-domain.ts config.json.example package.json analysis-tools/structured-capture-domain.test.ts
git commit -m "feat: define structured coaching capture domain"
```

### Task 6: Implement explicit reconciliation and preview projection

**Files:**
- Create: `engram-coach-structured-capture.ts`
- Create: `analysis-tools/structured-capture-test-support.ts`
- Create: `analysis-tools/structured-capture-reconciliation.test.ts`
- Modify: `engram-coach-reconciliation.ts`
- Modify: `engram-coach-pack.ts`
- Modify: `engram-coach-presentation.ts`
- Modify: `analysis-tools/pack-domain.test.ts`

**Interfaces:**
- Consumes: `StructuredChangeSet`, canonical key derivation, exact `selectRelatedRecords`, and `tools.previewCandidate(KnowledgeEnvelope): Promise<HostCapturePreview>`.
- Produces: `previewStructuredCapture(changeSet, tools): Promise<CapturePreview>` and pack reconciliation that may create multiple active records and retire multiple prior state records in one core plan.

- [ ] **Step 1: Write the reconciliation matrix tests**

Create one focused test per design classification: new keyed state, equivalent no-change, newer supersede, compatible refine, same-effective-time conflict blocked, unbound state blocked, append-only event, report claim support, multiple-active ambiguity, and deterministic preview IDs/hash input.

```ts
expect(preview.changes).toEqual([
  {
    entityKey: "prescription:arc-a:workout-7f8c",
    recordRole: "state",
    classification: "supersede",
    creates: ["coach-explicit-a1"],
    retires: ["prescription-old"],
  },
  {
    entityKey: null,
    recordRole: "event",
    classification: "append",
    creates: ["coach-event-a1"],
    retires: [],
  },
]);
```

Use synthetic active records and a test `previewCandidate` that calls the real Engram `reconcileKnowledgeTransaction`; do not mock the plan hash.

- [ ] **Step 2: Run the reconciliation test and confirm failure**

Run:

```bash
npm test --prefix analysis-tools -- structured-capture-reconciliation.test.ts
```

Expected: FAIL because explicit candidate construction and reconciliation are absent.

- [ ] **Step 3: Construct deterministic aggregate candidates**

Validate the change set first. Derive each item source ID as `<session_id>:<turn_id>:<channel>:<zero-based-index>` and each record ID as `coach-` plus the first 24 hex characters of SHA-256 over canonical JSON containing source ID, role, canonical key, and statement. Build one aggregate candidate envelope whose `details.captureChannel` is `explicit` and whose normalized items include pack-derived keys and record IDs. Set aggregate `status: "candidate"` and `disposition: "new"`; return aggregate `PackReconciliation.disposition: "new"` while item records carry their own dispositions and relationships. Only the reconciler's planned item records become active.

- [ ] **Step 4: Implement exact selection for explicit candidates**

Replace `relatedQuery` with `selectRelatedRecords`. For `details.captureChannel === "explicit"`, return exact mode matching records from the same pack whose `details.entityKey` is in the aggregate candidate's bound key set. For legacy generic envelopes, return search mode using the existing coaching query builder until ambient review promotion uses structured records.

- [ ] **Step 5: Implement per-item reconciliation**

Store these pack-owned details on every created record:

```ts
{
  recordRole,
  entityType,
  entityKey,
  effectiveAt,
  sourceId,
  value,
  artifact,
  captureChannel: "explicit"
}
```

Rules:

1. Event: create active; never update another record.
2. No active exact key: create active state/report claim.
3. Canonical value equal: state emits no mutation; report claim creates active with `supports: [current.id]`.
4. Candidate value is a conflict-free strict superset: create active with `refines: [current.id]`, retire current, append retirement history.
5. Candidate effective time is later: create active with `supersedes: [current.id]`, retire current, append retirement history.
6. Same/earlier effective time with conflicting values: return a validation error and no proposal.
7. More than one active exact-key record: return `ambiguous_state` and no proposal.

A retired update preserves the prior sources, session, scope, relationships, and history, adding only the status transition and one history entry.

- [ ] **Step 6: Project the host plan into the Phase 4 preview**

Call `tools.previewCandidate(aggregateCandidate)`. Return blocked host errors verbatim. For a ready plan, group mutations by `details.sourceId`; derive creates/retires and classifications from planned record roles, statuses, and relationship edges. Include sorted compatibility artifact relative paths and retain the aggregate candidate only in the internal `candidate` field consumed by the extension.

- [ ] **Step 7: Export the new pack functions and eligibility policy**

Export `previewStructuredCapture` from `engram-coach-pack.ts`. Keep normal presentation restricted to active, temporally effective records; candidate and retired records remain ineligible. Remove tests that expect semantic similarity to choose state replacement.

- [ ] **Step 8: Run focused tests, the pack suite, and typecheck**

Run:

```bash
npm test --prefix analysis-tools -- structured-capture-reconciliation.test.ts pack-domain.test.ts engram-coach-presentation.test.ts
npm run typecheck
```

Expected: all tests PASS.

- [ ] **Step 9: Commit explicit capture policy**

```bash
git add engram-coach-structured-capture.ts engram-coach-reconciliation.ts engram-coach-pack.ts engram-coach-presentation.ts analysis-tools/structured-capture-test-support.ts analysis-tools/structured-capture-reconciliation.test.ts analysis-tools/pack-domain.test.ts
git commit -m "feat: preview authoritative coaching mutations"
```

### Task 7: Replace deterministic transcript capture with strict ambient LLM capture

**Files:**
- Create: `engram-coach-ambient-capture.ts`
- Modify: `capture-handler.ts`
- Modify: `engram-coach-pack.ts`
- Modify: `package.json`
- Modify: `analysis-tools/engram-coach-capture.test.ts`
- Modify: `analysis-tools/pack-domain.test.ts`
- Delete: `engram-coach-extractor.ts`

**Interfaces:**
- Consumes: latest-user `TurnContext`, `loadEngramCoachConfig`, `tools.complete(CompletionRequest)`, create-only `tools.writeFile`, `tools.refreshIndex`, and successful explicit-apply tool results.
- Produces: `captureFromTurn(turn, tools): Promise<CaptureSummary>` with atomic candidate statements, inference provenance, duplicate suppression, warnings, and no deterministic fallback.

- [ ] **Step 1: Replace fallback tests with LLM-contract tests**

Add tests for configured model selection, strict JSON success, maximum candidate count, malformed response followed by successful repair, malformed response twice, timeout, cancellation, model failure, unbound candidate creation, and explicit-key duplicate suppression. Every failure assertion must confirm zero writes and zero refreshes.

```ts
expect(completionRequests.map((request) => request.model)).toEqual([
  "synthetic/capture-model",
  "synthetic/capture-model",
]);
expect(result.created).toEqual([]);
expect(result.warnings).toEqual(["ambient capture returned invalid JSON after one repair attempt"]);
expect(refreshes).toEqual([]);
```

- [ ] **Step 2: Run ambient tests and confirm failure**

Run:

```bash
npm test --prefix analysis-tools -- engram-coach-capture.test.ts pack-domain.test.ts
```

Expected: FAIL because current extraction uses transcript narrative and deterministic keyword fallback.

- [ ] **Step 3: Implement strict ambient parsing and one repair**

The first prompt contains the domain schema, current active-profile ID, latest user text, and a strict JSON response schema. Parse JSON without accepting Markdown fences. Validate every enum and field; trim each statement to one line and 512 characters; cap the validated array at config `maxCandidatesPerTurn`. If the first response is invalid, send exactly one repair prompt containing the validation errors and original response. A second invalid response returns a warning and no candidates.

- [ ] **Step 4: Derive keys without authorizing replacement**

Run `deriveCanonicalEntityKey` on each ambient candidate's validated components. Store a bound key in `details.entityKey`; store `null` plus `details.bindingError` for unbound or invalid input. Every ambient envelope is `status: "candidate"`, `disposition: "new"`, and has empty relationship arrays. Sources include both `session:<id>/turn:<turnIndex>` and `llm-inference:<model>`.

- [ ] **Step 5: Suppress explicit duplicates from tool provenance**

Inspect successful `engram_capture_apply` results in `turn.toolCalls`. Collect their returned `entity_keys`; drop ambient candidates with a matching bound key. Do not suppress unrelated candidates from the same user turn.

- [ ] **Step 6: Persist create-only drafts and surface warnings**

Keep deterministic ambient IDs based on session ID, turn index, candidate index, and canonical candidate JSON. Validate/serialize each record, call records-root-confined `writeFile` with create-only semantics, and refresh once when at least one draft was created or already exists. Completion/config errors become warnings; they never throw through `session_stop` and never invoke deterministic extraction.

- [ ] **Step 7: Clean-cut the old extractor facet**

Delete `engram-coach-extractor.ts`; remove `KnowledgeExtractor` from `engramCoachPack`, imports, comments, package files, and tests. Export `captureFromTurn` as the binding-selected ambient surface. Retain generic Engram `KnowledgeExtractor` support for other packs; only `engram-coach` stops using it.

- [ ] **Step 8: Run capture tests and typecheck**

Run:

```bash
npm test --prefix analysis-tools -- engram-coach-capture.test.ts pack-domain.test.ts engram-coach-package.test.ts
npm run typecheck
```

Expected: all tests PASS and a repository search for `deterministic fallback` or `coachingRelevantEntityType` returns no source matches.

- [ ] **Step 9: Commit ambient capture**

```bash
git add capture-handler.ts engram-coach-ambient-capture.ts engram-coach-pack.ts package.json analysis-tools/engram-coach-capture.test.ts analysis-tools/pack-domain.test.ts
git rm engram-coach-extractor.ts
git commit -m "feat: synthesize ambient coaching candidates"
```

### Task 8: Materialize deterministic compatibility views

**Files:**
- Create: `engram-coach-materialization.ts`
- Create: `analysis-tools/structured-capture-materialization.test.ts`
- Create: `analysis-tools/fixtures/structured-capture/materialized/build.yaml`
- Create: `analysis-tools/fixtures/structured-capture/materialized/consultations.md`
- Create: `analysis-tools/fixtures/structured-capture/materialized/adaptation.md`
- Create: `analysis-tools/fixtures/structured-capture/materialized/monitoring.md`
- Create: `analysis-tools/fixtures/structured-capture/materialized/doctor-prep.md`
- Modify: `engram-coach-pack.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: applied mutation view, active `engram-coach` records from `tools.listRecords`, runtime config roots, and `tools.replaceArtifact`.
- Produces: `materialize(appliedPlan, tools): Promise<MaterializationResult>` with byte-stable prescription, consultation, adaptation, monitoring, and doctor-prep renderers.

- [ ] **Step 1: Install YAML and write failing golden tests**

Run:

```bash
npm install yaml@^2
```

Write golden tests that pass the same active records in forward and reverse order and require byte-identical output. Cover non-authoritative headers, session-ID preservation, chronological event order, inactive-record exclusion, path grouping, changed/unchanged reporting, materializer failure, and a successful retry producing the same bytes.

- [ ] **Step 2: Run the materialization test and confirm failure**

Run:

```bash
npm test --prefix analysis-tools -- structured-capture-materialization.test.ts
```

Expected: FAIL because `materialize` and renderers do not exist.

- [ ] **Step 3: Implement prescription rendering**

Filter active, temporally effective state/report-claim records with `details.artifact.kind === "prescription"`. Group by `details.artifact.relativePath`, validate a consistent `blockName` and goal, sort sessions by `order` then `sessionId`, and build fields in `PRESCRIPTION_FORMAT.md` order. Emit:

```yaml
# GENERATED FROM ENGRAM ACTIVE RECORDS. DO NOT EDIT DIRECTLY.
block_name: build_1
sessions:
  - session_id: workout-7f8c
    week: 3
    day: Thu
    session_date: 2026-08-27
    session_name: W3_SubLT2
```

Use `yaml.stringify(value, { lineWidth: 0 })`, LF newlines, and one final newline.

- [ ] **Step 4: Implement chronological Markdown renderers**

Use this exact first line for generated Markdown:

```markdown
<!-- GENERATED FROM ENGRAM ACTIVE RECORDS. DO NOT EDIT DIRECTLY. -->
```

Render consultation and adaptation events by `(effectiveAt, sourceId, record.id)`. Render monitoring logs by concern/signal and doctor-prep summaries from active monitoring state plus chronological events. Preserve imported `details.value.legacyMarkdown` verbatim after the warning header; new events render from typed fields.

- [ ] **Step 5: Implement idempotent materialization orchestration**

Load all active pack records once, compute the complete desired view set, sort artifact operations by absolute target, and call `replaceArtifact` for each. Do not read qmd. Return changed paths under `written`, byte-identical paths under `unchanged`, and per-path errors under `stale`. Do not throw after one artifact failure; attempt the remaining independent artifacts and report every stale view.

- [ ] **Step 6: Export materialization and run focused tests**

Run:

```bash
npm test --prefix analysis-tools -- structured-capture-materialization.test.ts engram-coach-package.test.ts
npm run typecheck
```

Expected: all tests PASS; both input orderings match the golden fixtures byte-for-byte.

- [ ] **Step 7: Commit materializers**

```bash
git add engram-coach-materialization.ts engram-coach-pack.ts package.json package-lock.json analysis-tools/structured-capture-materialization.test.ts analysis-tools/fixtures/structured-capture/materialized
git commit -m "feat: render coaching compatibility views"
```

### Task 9: Build idempotent prescription and consultation migration

**Files:**
- Create: `engram-coach-migration.ts`
- Create: `analysis-tools/migrate-structured-capture.ts`
- Create: `analysis-tools/structured-capture-migration.test.ts`
- Create: `analysis-tools/fixtures/structured-capture/migration/prescription-before.yaml`
- Create: `analysis-tools/fixtures/structured-capture/migration/prescription-with-ids.yaml`
- Create: `analysis-tools/fixtures/structured-capture/migration/consultations-before.md`
- Modify: `PRESCRIPTION_FORMAT.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: legacy prescription YAML/log bytes and a stable source path relative to configured artifact roots.
- Produces: hash-bound ID-file mutations, import `StructuredChangeSet`s, source IDs stable across reruns, and byte-comparison reports. It does not apply production record mutations during implementation.

- [ ] **Step 1: Write failing migration fixture tests**

Assert: missing session IDs are assigned deterministically; existing IDs are preserved; duplicate IDs fail; generated warning headers are added exactly once; a second pass changes no bytes; dates/content/comments remain unchanged except inserted IDs and headers; imported prescription state is active after approved apply; consultation entries append as events; rerunning import creates no duplicates; generated views match the normalized baseline fixtures byte-for-byte.

- [ ] **Step 2: Run the migration test and confirm failure**

Run:

```bash
npm test --prefix analysis-tools -- structured-capture-migration.test.ts
```

Expected: FAIL because migration functions are absent.

- [ ] **Step 3: Implement stable ID planning**

Use `yaml.parseDocument` so existing comments and scalar styles survive. For a missing session ID, derive:

```ts
function migratedSessionId(relativePath: string, index: number): string {
  const sourceId = `prescription:${relativePath}#sessions/${index}`;
  return `workout-${createHash("sha256").update(sourceId).digest("hex").slice(0, 16)}`;
}
```

Insert `session_id` before `week` and add the exact generated warning header to every compatibility file that lacks it. Return `{ beforeHash, afterHash, beforeText, afterText, changed }`; application must require the exact `afterHash` shown during preview and preserve every other byte.

- [ ] **Step 4: Implement legacy import planning**

Map every prescription session to one state change with full `details.value`, `arc_id`, stable `session_id`, artifact relative path, block metadata, and order. Map consultation history to append-only events; when the legacy file has no parseable entry boundaries, import it as one event with `details.value.legacyMarkdown` rather than inventing structure. Source IDs use normalized relative path plus YAML index or Markdown entry index.

- [ ] **Step 5: Implement the dry-run CLI**

Support these explicit modes:

```text
migrate-structured-capture scan --config <path>
migrate-structured-capture apply-baseline --plan <scan.json> --expect <after-hash>
migrate-structured-capture emit-change-set --config <path> --output <change-set.json>
migrate-structured-capture compare --config <path> --render-root <temporary-root>
```

`scan`, `emit-change-set`, and `compare` never mutate source files or records. `apply-baseline` changes only files named in the scan plan, adds only stable IDs/generated headers, and refuses any changed `beforeHash`. `compare` exits nonzero on any byte difference and prints exact relative paths.

- [ ] **Step 6: Document `session_id` as required**

Add `session_id` to `PRESCRIPTION_FORMAT.md`; state that rescheduling or renaming never changes it and all newly generated prescriptions must provide it.

- [ ] **Step 7: Run migration tests, CLI help, and typecheck**

Run:

```bash
npm test --prefix analysis-tools -- structured-capture-migration.test.ts
npm exec --prefix analysis-tools tsx migrate-structured-capture.ts -- --help
npm run typecheck
```

Expected: tests PASS; help lists the four modes; typecheck exits 0.

- [ ] **Step 8: Commit migration tooling**

```bash
git add engram-coach-migration.ts analysis-tools/migrate-structured-capture.ts analysis-tools/structured-capture-migration.test.ts analysis-tools/fixtures/structured-capture/migration PRESCRIPTION_FORMAT.md package.json
git commit -m "feat: plan idempotent coaching record migration"
```

### Task 10: Cut over `consult` to approved record mutation

**Files:**
- Modify: `skills/consult/SKILL.md:76-129`
- Create: `analysis-tools/structured-capture-consult.test.ts`
- Create: `analysis-tools/fixtures/structured-capture/scenarios/consult-change-set.json`
- Create: `analysis-tools/structured-capture-skills.test.ts`

**Interfaces:**
- Consumes: full active prescription session, Phase 3 reasoning, `engram_capture_preview`, `engram_capture_apply`, and materializers.
- Produces: one approved transaction containing prescription state plus a consultation event; no direct YAML/log/qmd writes.

- [ ] **Step 1: Write the complete consult scenario test**

Seed an active prescription record and source YAML. Preview a synthetic consult change set, apply its real plan hash, then assert: prior state retired; new prescription/event active; supersedes edge points new-to-old only; qmd refresh attempted once; YAML and consultation views regenerated; a same-turn ambient response with the applied entity key creates no duplicate candidate.

- [ ] **Step 2: Write failing skill-contract assertions**

Assert `consult/SKILL.md` names both typed tools and `StructuredChangeSet`, requires the exact plan hash in Phase 4, handles stale apply by returning to preview, and no longer instructs direct prescription edit, `touch`, `mkdir`, direct consultation append, or bare `qmd update`.

- [ ] **Step 3: Run both tests and confirm failure**

Run:

```bash
npm test --prefix analysis-tools -- structured-capture-consult.test.ts structured-capture-skills.test.ts
```

Expected: scenario support may pass below the skill boundary, but skill-contract assertions FAIL against the current direct-write workflow.

- [ ] **Step 4: Change Phase 3 to emit the full domain input**

Alongside visible reasoning, require a typed state change containing `arc_id`, durable `session_id`, effective date, concise statement, the complete updated prescription session value, artifact relative path, block metadata, and order. Add one consultation event containing the athlete question, subjective inputs, decision rationale, action target session IDs, and compatibility path.

- [ ] **Step 5: Bind Phase 4 approval to the mutation plan**

Call `engram_capture_preview` before presenting the proposal. Show the human coaching change, create/refine/supersede/retire records, generated artifact paths, and exact `plan_hash` together. Preview failure blocks Phase 4. Approval language must explicitly cover both the coaching action and record/artifact plan.

- [ ] **Step 6: Replace Phase 5 writes with apply**

Call `engram_capture_apply` with only the approved hash. On stale status, return to preview and obtain fresh athlete approval. On apply failure, stop Phase 5 without editing compatibility files. On committed records with stale index/view warnings, report authoritative record IDs and exact retry state. Remove direct filesystem and qmd update instructions.

- [ ] **Step 7: Run consult tests and commit**

Run:

```bash
npm test --prefix analysis-tools -- structured-capture-consult.test.ts structured-capture-skills.test.ts
```

Expected: all tests PASS.

```bash
git add skills/consult/SKILL.md analysis-tools/structured-capture-consult.test.ts analysis-tools/structured-capture-skills.test.ts analysis-tools/fixtures/structured-capture/scenarios/consult-change-set.json
git commit -m "feat(skill): capture approved consultations"
```

### Task 11: Cut over `adapt-plan` with the same guarantees

**Files:**
- Modify: `skills/adapt-plan/SKILL.md:148-222`
- Create: `analysis-tools/structured-capture-adapt-plan.test.ts`
- Create: `analysis-tools/fixtures/structured-capture/scenarios/adapt-plan-change-set.json`
- Modify: `analysis-tools/structured-capture-skills.test.ts`

**Interfaces:**
- Consumes: completed-workout evidence, full next-session state, stream-analysis facts, and typed OMP capture tools.
- Produces: an approved prescription state transition plus append-only workout-adaptation event, generated YAML/adaptation view, and no duplicate ambient candidate.

- [ ] **Step 1: Write the complete adapt-plan scenario test**

Seed a next-session prescription, preview/apply the fixture change set, and verify the same record/hash/qmd/materialization guarantees as consult. Also verify the generated adaptation Markdown contains prescription-vs-execution, subjective data, stream metrics/classifications, and signal interactions from the event value.

- [ ] **Step 2: Add failing adapt skill-contract assertions**

Require the preview/apply/hash/stale flow and forbid direct prescription edits, adaptation-file creation, directory creation, and bare qmd update.

- [ ] **Step 3: Run focused tests and confirm skill failure**

Run:

```bash
npm test --prefix analysis-tools -- structured-capture-adapt-plan.test.ts structured-capture-skills.test.ts
```

Expected: skill-contract assertions FAIL until the workflow is cut over.

- [ ] **Step 4: Emit structured state and event data in Phase 3**

The state value is the complete updated next-session prescription, not a prose patch. The event carries the completed workout, objective deltas, subjective inputs, approved rationale, stream-analysis results, signal interactions, source activity ID, and adaptation compatibility path.

- [ ] **Step 5: Use the shared Phase 4/5 approval protocol**

Apply the same preview presentation, exact-hash approval, stale re-preview, and failure semantics as consult. Remove direct writes and qmd invocation. Return applied record IDs and materialized paths in the Phase 5 response.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm test --prefix analysis-tools -- structured-capture-adapt-plan.test.ts structured-capture-skills.test.ts
```

Expected: all tests PASS.

```bash
git add skills/adapt-plan/SKILL.md analysis-tools/structured-capture-adapt-plan.test.ts analysis-tools/structured-capture-skills.test.ts analysis-tools/fixtures/structured-capture/scenarios/adapt-plan-change-set.json
git commit -m "feat(skill): capture approved plan adaptations"
```

### Task 12: Move monitoring logs and doctor-prep summaries behind capture

**Files:**
- Modify: `skills/monitoring-rollup/SKILL.md`
- Modify: `skills/consult/SKILL.md`
- Modify: `skills/adapt-plan/SKILL.md`
- Create: `analysis-tools/structured-capture-monitoring.test.ts`
- Create: `analysis-tools/fixtures/structured-capture/scenarios/monitoring-change-set.json`
- Modify: `analysis-tools/structured-capture-skills.test.ts`
- Modify: `engram-coach-migration.ts`
- Modify: `analysis-tools/structured-capture-migration.test.ts`
- Create: `analysis-tools/fixtures/structured-capture/migration/monitoring-before.md`
- Create: `analysis-tools/fixtures/structured-capture/migration/doctor-prep-before.md`

**Interfaces:**
- Consumes: active concern registry, due signals, structured capture contribution mode, and monitoring materializers.
- Produces: monitoring state/events previewed in the same athlete approval as their parent consult/adaptation, or in monitoring-rollup's own approval when run standalone.

- [ ] **Step 1: Write failing monitoring scenario tests**

Cover new signal state, newer supersession, append-only observation event, deterministic chronological log, deterministic doctor-prep summary, inactive concern no-op, same-hash materialization retry, idempotent import of legacy monitoring history, and byte-equivalent normalized monitoring views.

- [ ] **Step 2: Add failing skill-contract tests**

Forbid direct monitoring-log append and doctor-prep overwrite. Require `monitoring-rollup` capture-contribution mode to return `state_changes`/`events` without applying them, and require consult/adapt to merge due monitoring contributions before their Phase 4 preview.

- [ ] **Step 3: Run monitoring tests and confirm failure**

Run:

```bash
npm test --prefix analysis-tools -- structured-capture-monitoring.test.ts structured-capture-skills.test.ts
```

Expected: FAIL against direct monitoring writes and post-approval auto-tail behavior.

- [ ] **Step 4: Refactor monitoring-rollup modes**

In contribution mode, read the concern registry and return typed monitoring items only. In standalone mode, use its own Phase 3 preview, Phase 4 approval, and Phase 5 apply. A due event uses key `monitoring:<concern-id>:<signal>` for current state and a distinct append-only monitoring event with source/effective time.

- [ ] **Step 5: Plan legacy monitoring migration**

Extend `engram-coach-migration.ts` to read each declared concern's existing log and doctor-prep summary. Emit stable monitoring state/event source IDs from concern ID, signal, relative path, and entry index; preserve an unparseable legacy body in `details.value.legacyMarkdown`. Add the generated header through the same hash-bound baseline plan used for prescriptions/consultations, and require `compare` to prove byte-equivalent rendered monitoring views before cutover.

- [ ] **Step 6: Merge auto-tail data before parent preview**

Move consult/adapt monitoring auto-tail from after Phase 5 to Phase 3 contribution collection. Merge contributions into the parent's single change set; one plan hash and one approval cover prescription, coaching event, and due monitoring changes. If no concern is active/due, merge empty arrays without producing a second preview.

- [ ] **Step 7: Run tests and commit**

Run:

```bash
npm test --prefix analysis-tools -- structured-capture-monitoring.test.ts structured-capture-migration.test.ts structured-capture-consult.test.ts structured-capture-adapt-plan.test.ts structured-capture-skills.test.ts
```

Expected: all tests PASS.

```bash
git add skills/monitoring-rollup/SKILL.md skills/consult/SKILL.md skills/adapt-plan/SKILL.md engram-coach-migration.ts analysis-tools/structured-capture-monitoring.test.ts analysis-tools/structured-capture-migration.test.ts analysis-tools/structured-capture-skills.test.ts analysis-tools/fixtures/structured-capture/scenarios/monitoring-change-set.json analysis-tools/fixtures/structured-capture/migration/monitoring-before.md analysis-tools/fixtures/structured-capture/migration/doctor-prep-before.md
git commit -m "feat(skill): capture monitoring records before approval"
```

### Task 13: Preserve canonical reports while capturing approved conclusions

**Files:**
- Modify: `skills/race-analysis/SKILL.md`
- Modify: `skills/block-review/SKILL.md`
- Modify: `skills/season-retrospective/SKILL.md`
- Create: `analysis-tools/structured-capture-report-claims.test.ts`
- Create: `analysis-tools/fixtures/structured-capture/scenarios/report-claims-change-set.json`
- Modify: `analysis-tools/structured-capture-skills.test.ts`

**Interfaces:**
- Consumes: athlete-approved full report Markdown and explicit `report_claims`.
- Produces: unchanged canonical report documents plus active, sourced report-claim records that support/refine/supersede state without materializing the report itself.

- [ ] **Step 1: Write report-claim behavior tests**

Assert an approved report claim retains `source_document`, uses `recordRole: "report-claim"`, receives the correct relationship to exact-key state, and never causes `materialize` to write `RACE_REPORT.md`, `SUMMARY.md`, or `SEASON_REVIEW.md`.

- [ ] **Step 2: Add failing report skill-contract assertions**

Require each report skill to form explicit conclusions in Phase 3, preview those records alongside the full report in Phase 4, write the approved canonical report in Phase 5, then apply the approved hash. Ambient extraction must not be named as the report-conclusion path.

- [ ] **Step 3: Run report tests and confirm failure**

Run:

```bash
npm test --prefix analysis-tools -- structured-capture-report-claims.test.ts structured-capture-skills.test.ts
```

Expected: skill-contract assertions FAIL until explicit report capture is documented.

- [ ] **Step 4: Update report workflows**

For each report, distinguish narrative sections from atomic approved conclusions. Each conclusion names its exact state key components, effective time, source document relative path, statement, and structured value. Phase 4 shows the complete report and record preview under one approval. Phase 5 writes the report first; if that write fails, stop without applying records. After a successful document write, apply the exact approved hash and report any index/view staleness.

- [ ] **Step 5: Preserve existing auto-tail behavior after capture apply**

Run `lessons-rollup` only after the report document and report claims succeed. Its existing harness-backed claim gate remains separate; do not reconstruct the report from those claims.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm test --prefix analysis-tools -- structured-capture-report-claims.test.ts structured-capture-skills.test.ts
```

Expected: all tests PASS.

```bash
git add skills/race-analysis/SKILL.md skills/block-review/SKILL.md skills/season-retrospective/SKILL.md analysis-tools/structured-capture-report-claims.test.ts analysis-tools/structured-capture-skills.test.ts analysis-tools/fixtures/structured-capture/scenarios/report-claims-change-set.json
git commit -m "feat(skill): capture approved report conclusions"
```

### Task 14: Cut over `set-goal` after every dependent capture path

**Files:**
- Modify: `skills/set-goal/SKILL.md`
- Create: `analysis-tools/structured-capture-set-goal.test.ts`
- Create: `analysis-tools/fixtures/structured-capture/scenarios/set-goal-change-set.json`
- Modify: `analysis-tools/structured-capture-skills.test.ts`

**Interfaces:**
- Consumes: approved arc overview/methodology documents plus a complete graph of durable workout IDs and prescription state.
- Produces: canonical arc/methodology docs, active structured arc conclusions, generated prescription YAML/consultation views, and no direct compatibility writes.

- [ ] **Step 1: Write the complete set-goal graph test**

Use two sub-blocks and at least four sessions. Assert every session gets a distinct durable `session_id`, rescheduling leaves its key unchanged, all prescription keys include arc/session IDs, generated YAML includes the IDs, consultation views are created from records, and rerunning the same approved graph is idempotent.

- [ ] **Step 2: Add failing set-goal skill-contract assertions**

Require the canonical report/record split, complete graph change set, preview/hash/apply flow, and stable IDs. Forbid direct prescription YAML and consultations scaffold writes.

- [ ] **Step 3: Run set-goal tests and confirm failure**

Run:

```bash
npm test --prefix analysis-tools -- structured-capture-set-goal.test.ts structured-capture-skills.test.ts
```

Expected: skill-contract assertions FAIL against the current direct-write workflow.

- [ ] **Step 4: Build the graph during Phase 3**

Generate durable session IDs once and reuse them in every state item and narrative reference. Include full prescription values/artifact metadata for every session and explicit arc/methodology report claims. Do not assign record IDs, relationships, statuses, or retirement targets.

- [ ] **Step 5: Bind all outputs to one Phase 4 approval**

Preview the complete graph before presenting. Show canonical documents to write, record mutations, generated YAML/log paths, and plan hash. If any session key is unbound/ambiguous, correct the graph and preview again before asking for approval.

- [ ] **Step 6: Apply in Phase 5 without touching generated views**

Write approved arc overview and methodology documents, then apply the approved capture hash. Let materializers create prescriptions and consultations. Report exact record IDs and generated paths; stale hash returns to Phase 4.

- [ ] **Step 7: Run tests and commit**

Run:

```bash
npm test --prefix analysis-tools -- structured-capture-set-goal.test.ts structured-capture-skills.test.ts
```

Expected: all tests PASS.

```bash
git add skills/set-goal/SKILL.md analysis-tools/structured-capture-set-goal.test.ts analysis-tools/structured-capture-skills.test.ts analysis-tools/fixtures/structured-capture/scenarios/set-goal-change-set.json
git commit -m "feat(skill): capture complete training arcs"
```

### Task 15: Update setup contracts and verify the end-to-end cutover

**Files:**
- Modify: `README.md`
- Modify: `SETUP.md`
- Modify: `SKILL_PACK.md`
- Modify: `shared/setup.md`
- Modify: `skills/intake/SKILL.md`
- Modify: `analysis-tools/engram-coach-package.test.ts`
- Modify: `analysis-tools/naming-contract.test.ts`
- Modify: `../engram/harness/MUTATION_CHECK.md`
- Modify: `../engram/harness/mutations.ts`

**Interfaces:**
- Consumes: all prior tasks and a disposable training-space binding.
- Produces: install/config/migration/operator docs, mutation-check coverage for new safety seams, full automated evidence, and the required live consult smoke.

- [ ] **Step 1: Write failing package and documentation assertions**

Require the three pack module exports (`captureFromTurn`, `previewStructuredCapture`, `materialize`), capture config example, typed OMP tool names, generated-file warning, stable session IDs, migration command, and no public deterministic fallback/free-form capture documentation.

- [ ] **Step 2: Update intake and setup config flow**

Have intake collect an explicit `provider/model` capture model and write the `capture` block with timeout 60/max 3. Document `ENGRAM_COACH_CAPTURE_MODEL` as a model-only override. Preserve existing active-profile and directory resolution. Missing model must point to intake/setup rather than inherit the interactive model.

- [ ] **Step 3: Document authority, migration, and retry semantics**

Explain record roles, exact keys, generated compatibility views, canonical reports, dry-run migration sequence, stale-plan re-preview, index-stale status, stale-view retry by re-calling apply with the committed hash in the same session, and direct-edit prohibition for generated files.

- [ ] **Step 4: Add non-tautological mutation-check entries**

Add source mutations and expected failing test names for: exact-selector bypass to semantic qmd, stale structured apply gate disabled, records-root symlink escape, artifact-root symlink escape, ambient isolation flag removed, deterministic fallback reintroduced, and committed-plan materialization retry reapplying records. Update `MUTATION_CHECK.md` with the exact properties.

- [ ] **Step 5: Run all Engram automated gates**

Run:

```bash
cd ../engram/harness
npm test
npm run typecheck
npm run mutation-check
```

Expected: all Node and Bun tests PASS, typecheck exits 0, every registered mutation is killed.

- [ ] **Step 6: Run all Engram Coach automated gates**

Run:

```bash
npm test
npm run typecheck
npm run pack:local
```

Expected: all Vitest files PASS, typecheck exits 0, and the package manifest includes every new runtime file while excluding fixtures, local config, athlete data, and migration outputs.

- [ ] **Step 7: Prepare a disposable live-smoke space**

Create a synthetic training repository with `.engram-coach/config.json`, a binding-selected `engram-coach` pack, an `engram.space.json`, one imported active prescription, and a configured non-production capture model. Run migration `scan`, `apply-baseline`, `emit-change-set`, and `compare`; require byte-equivalent generated views before continuing.

- [ ] **Step 8: Run the required live OMP consult smoke**

From the disposable training repository, launch:

```bash
ENGRAM_BINDING_REGISTRY=/absolute/path/to/disposable-registry.json \
omp --extension /absolute/path/to/engram/harness/omp/omp-extension.ts
```

Run a real consult that changes the seeded session. Inspect Phase 4 and record the shown plan hash; explicitly approve. Then call `engram_status` and inspect the records/artifacts. Required observations:

1. durable space auto-selection resolves the synthetic space;
2. preview shows the old record retirement, new state/event IDs, artifact paths, and exact hash;
3. apply returns the same hash and committed IDs/relationships;
4. prior prescription state is retired and new state/event are active;
5. generated prescription and consultation views contain the warning header and approved values;
6. ambient stop capture creates no candidate for the explicitly applied entity key and may create only unrelated candidate knowledge.

Save no athlete data and remove the disposable space after recording command output.

- [ ] **Step 9: Commit Engram safety coverage**

```bash
git -C ../engram add harness/MUTATION_CHECK.md harness/mutations.ts
git -C ../engram commit -m "test(harness): pin structured capture safety"
```

- [ ] **Step 10: Commit Engram Coach docs and final contracts**

```bash
git add README.md SETUP.md SKILL_PACK.md shared/setup.md skills/intake/SKILL.md analysis-tools/engram-coach-package.test.ts analysis-tools/naming-contract.test.ts
git commit -m "docs: document structured coaching capture"
```

- [ ] **Step 11: Verify both repository histories are publish-ready without publishing**

Run:

```bash
git -C ../engram status --short
git status --short
```

Expected: both commands print nothing. Do not run a publish command and do not point migration tooling at production athlete paths.
