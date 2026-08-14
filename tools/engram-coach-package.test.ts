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
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url)); // tools/
const repoRoot = resolve(here, ".."); // engram-coach repo root
const harnessDir = resolve(repoRoot, "../engram/harness");

// `npm pack --json` and the resolver subprocess below are both producers we
// author and control, so each JSON boundary is asserted against a named
// type rather than re-verified with a generic runtime object guard.
type PackManifest = { filename: string };

type ResolverResult = {
  packOk: boolean;
  packErrors: unknown;
  extractorOk: boolean;
  extractorErrors: unknown;
  viewIds: string[];
  audienceIds: string[];
  deliveryIds: string[];
};

// Resolver subprocess: reads the temp binding, imports the real pack loader
// through the temp install's `file:`-linked harness copy, and resolves the
// binding-declared pack and extractor exactly as `cli.ts` does. The pack
// loader itself does the same at runtime — both imports below are
// necessarily dynamic because the loaded specifier is only known once the
// binding file has been read, which is precisely the module-loading
// boundary this test exercises.
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
const { resolveKnowledgePack, loadExtractionPack } = await import(pathToFileURL(packLoaderPath).href);

const [packResult, extractorResult] = await Promise.all([
  resolveKnowledgePack(binding.id, binding.version, binding.from, bindingPath),
  loadExtractionPack(binding.id, binding.version, binding.from, bindingPath),
]);

process.stdout.write(JSON.stringify({
  packOk: packResult.ok,
  packErrors: packResult.ok ? null : packResult.errors,
  extractorOk: extractorResult.ok,
  extractorErrors: extractorResult.ok ? null : extractorResult.errors,
  viewIds: packResult.ok ? packResult.value.views.map((view) => view.id) : [],
  audienceIds: packResult.ok ? packResult.value.audiences.map((audience) => audience.id) : [],
  deliveryIds: packResult.ok ? packResult.value.deliveries.map((delivery) => delivery.id) : [],
}));
`;

describe("packed module", () => {
  it("installs from a real npm tarball and resolves through Engram's real pack loader", async () => {
    const { stdout: packStdout } = await execFileAsync("npm", ["pack", "--json"], { cwd: repoRoot });
    const inventory: unknown = JSON.parse(packStdout);
    if (!Array.isArray(inventory) || inventory.length === 0) {
      throw new Error("npm pack --json produced no inventory");
    }
    const manifest = inventory[0] as PackManifest;
    if (typeof manifest.filename !== "string") {
      throw new Error('npm pack --json inventory entry is missing a string "filename"');
    }
    const tarballPath = resolve(repoRoot, manifest.filename);

    let tempDir: string | undefined;
    try {
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
      expect(result.extractorOk, JSON.stringify(result.extractorErrors)).toBe(true);
      expect(result.viewIds).toContain("athlete-profile");
      expect(result.audienceIds).toContain("self-coach");
      expect(result.deliveryIds).toContain("profile-markdown");
    } finally {
      if (tempDir !== undefined) await rm(tempDir, { recursive: true, force: true });
      await rm(tarballPath, { force: true });
    }
  });
});
