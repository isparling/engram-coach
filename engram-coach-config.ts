/**
 * engram-coach runtime configuration resolution and validation.
 *
 * This is the single canonical config resolver for engram-coach. It replaces
 * the prose resolution order documented in `shared/setup.md` and SETUP.md:
 *
 *   1. `ENGRAM_COACH_CONFIG` (explicit override, nonblank)
 *   2. `<projectRoot>/.engram-coach/config.json`
 *   3. `~/.claude/engram-coach/config.json`
 *
 * The first candidate that exists wins; a config that exists but is
 * malformed or invalid is a configuration error, never a silent fallback.
 * Parsed JSON is validated field by field into real types — no untyped JSON
 * escapes this module.
 *
 * Capture configuration: `model` comes from `ENGRAM_COACH_CAPTURE_MODEL`
 * when nonblank, otherwise `capture.model`; absence of both is an error.
 * Omitted timeout/candidate limits default to 60/3; explicit values must be
 * positive integers with `timeout_seconds <= 60` and
 * `max_candidates_per_turn <= 3`.
 *
 * @module engram-coach-config
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Runtime config types (camelCase — internal runtime surface)
// ---------------------------------------------------------------------------

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

/** Raised when no config resolves or a resolved config fails validation. */
export class EngramCoachConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngramCoachConfigError";
  }
}

export type LoadEngramCoachConfigOptions = {
  /** Environment variables; defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Absolute project working directory; defaults to `process.cwd()`. */
  projectRoot?: string;
  /** Absolute user home directory; defaults to `os.homedir()`. */
  homeDir?: string;
};

export const DEFAULT_CAPTURE_TIMEOUT_SECONDS = 60;
export const DEFAULT_CAPTURE_MAX_CANDIDATES_PER_TURN = 3;
const MAX_CAPTURE_TIMEOUT_SECONDS = 60;
const MAX_CAPTURE_CANDIDATES_PER_TURN = 3;

const MISSING_MODEL_MESSAGE =
  'capture model missing: set ENGRAM_COACH_CAPTURE_MODEL or add a nonblank "capture.model" to config.json';

// ---------------------------------------------------------------------------
// Field-level validation of parsed file JSON
// ---------------------------------------------------------------------------

/** Reads a required nonblank string field off a validated object. */
function requiredString(
  parent: { [key: string]: unknown },
  key: string,
  where: string,
): string {
  const value = parent[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new EngramCoachConfigError(`${where}: "${key}" must be a nonblank string`);
  }
  return value;
}

/**
 * Reads an optional positive-integer limit with a default ceiling: omitted
 * falls back to `fallback`; explicit values must be integers in (0, max].
 */
function optionalLimit(
  parent: { [key: string]: unknown },
  key: string,
  fallback: number,
  max: number,
  where: string,
): number {
  const value = parent[key];
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > max) {
    throw new EngramCoachConfigError(
      `${where}: "${key}" must be a positive integer <= ${max} (got ${JSON.stringify(value)})`,
    );
  }
  return value;
}

type RawCoachConfigFile = {
  active_profile: string;
  profiles: { [key: string]: unknown };
};

/**
 * Validates parsed file JSON into the raw shape needed to build the runtime
 * config. Throws {@link EngramCoachConfigError} on any structural problem.
 */
function parseConfigFile(parsed: unknown): RawCoachConfigFile {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new EngramCoachConfigError('config.json: top-level value must be an object');
  }
  const topLevel = parsed as { [key: string]: unknown };
  const profiles = topLevel.profiles;
  if (typeof profiles !== "object" || profiles === null || Array.isArray(profiles)) {
    throw new EngramCoachConfigError('config.json: "profiles" must be an object');
  }
  return {
    active_profile: requiredString(topLevel, "active_profile", "config.json"),
    profiles: profiles as { [key: string]: unknown },
  };
}

function profileEntry(
  profiles: { [key: string]: unknown },
  activeProfile: string,
): { coaching_docs_dir: string; prescriptions_dir: string } {
  const entry = profiles[activeProfile];
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
    throw new EngramCoachConfigError(
      `config.json: no profile named "${activeProfile}" under "profiles"`,
    );
  }
  const fields = entry as { [key: string]: unknown };
  const where = `profiles.${activeProfile}`;
  return {
    coaching_docs_dir: requiredString(fields, "coaching_docs_dir", where),
    prescriptions_dir: requiredString(fields, "prescriptions_dir", where),
  };
}

/**
 * Validates the capture block and environment override into the runtime
 * capture config. The env override wins when nonblank; absence of both
 * model sources is a configuration error.
 */
function parseCaptureConfig(capture: unknown, envModel: string | undefined): CaptureConfig {
  const trimmedEnvModel = envModel?.trim();
  if (trimmedEnvModel === undefined || trimmedEnvModel.length === 0) {
    if (
      typeof capture !== "object" ||
      capture === null ||
      Array.isArray(capture) ||
      typeof (capture as { [key: string]: unknown }).model !== "string" ||
      ((capture as { [key: string]: unknown }).model as string).trim().length === 0
    ) {
      throw new EngramCoachConfigError(MISSING_MODEL_MESSAGE);
    }
  }
  const model =
    trimmedEnvModel !== undefined && trimmedEnvModel.length > 0
      ? trimmedEnvModel
      : ((capture as { [key: string]: unknown }).model as string).trim();

  const limits: { [key: string]: unknown } =
    typeof capture === "object" && capture !== null && !Array.isArray(capture)
      ? (capture as { [key: string]: unknown })
      : {};

  return {
    model,
    timeoutSeconds: optionalLimit(
      limits,
      "timeout_seconds",
      DEFAULT_CAPTURE_TIMEOUT_SECONDS,
      MAX_CAPTURE_TIMEOUT_SECONDS,
      "capture",
    ),
    maxCandidatesPerTurn: optionalLimit(
      limits,
      "max_candidates_per_turn",
      DEFAULT_CAPTURE_MAX_CANDIDATES_PER_TURN,
      MAX_CAPTURE_CANDIDATES_PER_TURN,
      "capture",
    ),
  };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function resolveCandidatePaths(options: LoadEngramCoachConfigOptions): string[] {
  const candidates: string[] = [];
  const explicit = options.env?.ENGRAM_COACH_CONFIG;
  if (explicit !== undefined && explicit.trim().length > 0) {
    candidates.push(explicit);
  }
  candidates.push(join(options.projectRoot ?? process.cwd(), ".engram-coach", "config.json"));
  candidates.push(join(options.homeDir ?? homedir(), ".claude", "engram-coach", "config.json"));
  return candidates;
}

async function readFirstExisting(
  paths: string[],
): Promise<{ path: string; contents: string }> {
  for (const path of paths) {
    let contents: string;
    try {
      contents = await readFile(path, "utf8");
    } catch {
      continue;
    }
    return { path, contents };
  }
  throw new EngramCoachConfigError(
    "config not found; tried:\n" +
      paths.map((path) => `  - ${path}`).join("\n") +
      "\nRun the intake skill or copy config.json.example to .engram-coach/config.json",
  );
}

/**
 * Loads and validates the engram-coach runtime config using the standard
 * path precedence. Throws {@link EngramCoachConfigError} when no candidate
 * exists or the first existing candidate fails validation.
 */
export async function loadEngramCoachConfig(
  options: LoadEngramCoachConfigOptions = {},
): Promise<EngramCoachRuntimeConfig> {
  const found = await readFirstExisting(resolveCandidatePaths(options));

  let parsed: unknown;
  try {
    parsed = JSON.parse(found.contents);
  } catch (error) {
    throw new EngramCoachConfigError(
      `${found.path}: invalid JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const file = parseConfigFile(parsed);
  const profile = profileEntry(file.profiles, file.active_profile);
  const capture = parseCaptureConfig(
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as { [key: string]: unknown }).capture
      : undefined,
    options.env?.ENGRAM_COACH_CAPTURE_MODEL ?? process.env.ENGRAM_COACH_CAPTURE_MODEL,
  );

  return {
    activeProfile: file.active_profile,
    coachingDocsDir: profile.coaching_docs_dir,
    prescriptionsDir: profile.prescriptions_dir,
    capture,
  };
}
