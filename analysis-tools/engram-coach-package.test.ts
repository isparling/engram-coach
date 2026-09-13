/**
 * Packed-module integration test.
 *
 * Builds the real npm tarball for `@isparling/engram-coach`, installs it
 * into an isolated consumer directory alongside a `file:`-linked
 * `@isparling/engram-harness` (mirroring the direct-OMP-integration install
 * documented in `README.md` / `SETUP.md`), and resolves the installed pack
 * through Engram's real, unmodified `packLoader.ts` — the same
 * `resolveKnowledgePack` / `loadExtractionPack` functions the Engram CLI
 * (`cli.ts`) calls for every binding-declared pack. This is the only test in
 * the suite that exercises the published `files`/`exports` surface
 * end-to-end, instead of importing this repo's source files directly.
 *
 * Runtime note — Bun, not `node --experimental-strip-types`: the pack
 * loader dynamically `import()`s the binding's `from` module at runtime, and
 * a real npm install unavoidably places the coach package's `.ts` sources
 * under a `node_modules` directory. Node refuses to strip types for any
 * module path containing `node_modules`
 * (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`) — an unconditional design
 * restriction with no override flag, by design, to discourage publishing
 * TypeScript packages; verified against Node 22. Bun has no such
 * restriction and is the Engram CLI's own documented runtime (see
 * `engines.bun` in `../engram/harness/cli/package.json`), so the resolver
 * subprocess below runs under `bun --preserve-symlinks` in place of the
 * originally planned `node --experimental-strip-types`.
 * `--preserve-symlinks` keeps the binding's bare `@isparling/engram-coach`
 * specifier resolving inside the temporary install root instead of being
 * redirected — via the `file:` dependency's realpath — to the harness
 * devtree's own (uninstalled) `node_modules`.
 */

import { describe, it, expect } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url)); // analysis-tools/
const repoRoot = resolve(here, ".."); // engram-coach repo root
const harnessDir = resolve(repoRoot, "../engram/harness");

// `npm pack --json` and the resolver subprocess below are both producers we
// author and control, so each JSON boundary is asserted against a named
// type rather than re-verified with a generic runtime object guard.
type PackManifest = {
  filename: string;
  files: Array<{ path: string }>;
};

type ResolverResult = {
  packOk: boolean;
  packErrors: unknown;
  captureExports: string[];
  hasExtractCandidates: boolean;
  viewIds: string[];
  audienceIds: string[];
  deliveryIds: string[];
};

// Resolver subprocess: reads the temp binding, imports the real pack loader
// through the temp install's `file:`-linked harness copy, and resolves the
// binding-declared pack exactly as `cli.ts` does, then checks the three
// binding-selected capture functions the OMP adapter looks up by name.
// engram-coach is deliberately NOT a generic `KnowledgeExtractor`: ambient
// capture is LLM-only through `captureFromTurn`. The pack loader itself does
// the same dynamic import at runtime — both imports below are necessarily
// dynamic because the loaded specifier is only known once the binding file
// has been read, which is precisely the module-loading boundary this test
// exercises.
const RESOLVER_SCRIPT = `
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const bindingPath = join(process.cwd(), "binding.json");
const binding = JSON.parse(await readFile(bindingPath, "utf8"));
const packLoaderPath = join(
  process.cwd(),
  "node_modules",
  "@isparling",
  "engram-harness",
  "src",
  "packLoader.ts",
);
const { resolveKnowledgePack } = await import(pathToFileURL(packLoaderPath).href);

const packResult = await resolveKnowledgePack(binding.id, binding.version, binding.from, bindingPath);
// The binding "from" value is a bare package specifier, resolved from the
// temp install's node_modules exactly as the pack loader resolves it.
const packModule = await import(binding.from);

process.stdout.write(JSON.stringify({
  packOk: packResult.ok,
  packErrors: packResult.ok ? null : packResult.errors,
  captureExports: [
    "captureFromTurn",
    "previewStructuredCapture",
    "materialize",
  ].filter((name) => typeof packModule[name] === "function"),
  hasExtractCandidates: typeof packModule.engramCoachPack?.extractCandidates === "function",
  viewIds: packResult.ok ? packResult.value.views.map((view) => view.id) : [],
  audienceIds: packResult.ok ? packResult.value.audiences.map((audience) => audience.id) : [],
  deliveryIds: packResult.ok ? packResult.value.deliveries.map((delivery) => delivery.id) : [],
}));
`;

describe("packed module", () => {
  it("installs from a real npm tarball and resolves through Engram's real pack loader", async () => {
    // `packDir` is a dedicated destination for `npm pack`, created before
    // pack runs and owned by `finally` independently of whether the JSON
    // output that follows ever parses or validates — a `.tgz` written to
    // disk during a later failure is still removed because it can only ever
    // land inside this directory. `tempDir` (the separate consumer install)
    // is tracked the same way.
    let packDir: string | undefined;
    let tempDir: string | undefined;
    try {
      packDir = await mkdtemp(join(tmpdir(), "engram-coach-tarball-"));

      const { stdout: packStdout } = await execFileAsync(
        "npm",
        ["pack", "--json", "--pack-destination", packDir],
        { cwd: repoRoot },
      );
      const inventory: unknown = JSON.parse(packStdout);
      if (!Array.isArray(inventory) || inventory.length === 0) {
        throw new Error("npm pack --json produced no inventory");
      }
      const manifest = inventory[0] as PackManifest;
      if (typeof manifest.filename !== "string") {
        throw new Error('npm pack --json inventory entry is missing a string "filename"');
      }
      if (!Array.isArray(manifest.files)) {
        throw new Error('npm pack --json inventory entry is missing a "files" array');
      }
      const packedPaths = manifest.files.map((file) => file.path);
      expect(packedPaths).toEqual(
        expect.arrayContaining([
          "analysis-tools/hrv-trend.ts",
          "analysis-tools/migrate-structured-capture.ts",
          "analysis-tools/race-context.ts",
          "analysis-tools/stream-analyze.ts",
          "analysis-tools/tsb-predict.ts",
        ]),
      );
      expect(
        packedPaths.filter(
          (path) =>
            path.includes("/node_modules/") ||
            path.includes("/fixtures/") ||
            path.endsWith(".test.ts") ||
            /(?:^|\/)(?:scan|change-set|migration-output)\.json$/.test(path),
        ),
      ).toEqual([]);
      const tarballPath = resolve(packDir, manifest.filename);

      tempDir = await mkdtemp(join(tmpdir(), "engram-coach-pack-"));

      await writeFile(
        join(tempDir, "package.json"),
        JSON.stringify(
          {
            name: "engram-coach-package-test",
            private: true,
            dependencies: { "@isparling/engram-harness": `file:${harnessDir}` },
          },
          null,
          2,
        ),
      );
      await execFileAsync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], { cwd: tempDir });
      await execFileAsync(
        "npm",
        ["install", tarballPath, "--ignore-scripts", "--no-audit", "--no-fund", "--no-save"],
        { cwd: tempDir },
      );

      const bindingPath = join(tempDir, "binding.json");
      await writeFile(
        bindingPath,
        JSON.stringify(
          { id: "engram-coach", version: "0.1.0", from: "@isparling/engram-coach", extract: true },
          null,
          2,
        ),
      );
      await writeFile(join(tempDir, "resolve-pack.mjs"), RESOLVER_SCRIPT);

      const { stdout } = await execFileAsync("bun", ["--preserve-symlinks", "resolve-pack.mjs"], { cwd: tempDir });
      const result = JSON.parse(stdout) as ResolverResult;

      expect(result.packOk, JSON.stringify(result.packErrors)).toBe(true);
      // The three binding-selected capture functions the OMP adapter resolves
      // by name must survive packaging.
      expect(result.captureExports).toEqual([
        "captureFromTurn",
        "previewStructuredCapture",
        "materialize",
      ]);
      // Ambient capture is LLM-only: no deterministic extractor facet ships.
      expect(result.hasExtractCandidates).toBe(false);
      expect(result.viewIds).toContain("athlete-profile");
      expect(result.audienceIds).toContain("self-coach");
      expect(result.deliveryIds).toContain("profile-markdown");

      // The capture config example must survive packaging with the shipped
      // limits: intake writes this block verbatim, and ambient capture fails
      // as a configuration error without an explicit model.
      const packedExample = JSON.parse(
        await readFile(
          join(tempDir, "node_modules", "@isparling", "engram-coach", "config.json.example"),
          "utf8",
        ),
      ) as { capture?: { model?: unknown; timeout_seconds?: unknown; max_candidates_per_turn?: unknown } };
      expect(typeof packedExample.capture?.model).toBe("string");
      expect((packedExample.capture?.model as string).length).toBeGreaterThan(0);
      expect(packedExample.capture?.timeout_seconds).toBe(60);
      expect(packedExample.capture?.max_candidates_per_turn).toBe(3);
    } finally {
      if (tempDir !== undefined) await rm(tempDir, { recursive: true, force: true });
      if (packDir !== undefined) await rm(packDir, { recursive: true, force: true });
    }
  // Real `npm pack` plus a real consumer install runs ~4s alone and longer
  // under full-suite contention; the 5s default made this gate flaky.
  }, 120_000);
});
