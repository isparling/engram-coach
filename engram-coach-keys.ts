/**
 * engram-coach canonical entity key derivation.
 *
 * Identity is derived by the pack, never accepted from an LLM or skill. A
 * candidate may provide key components; this module validates and
 * canonicalizes them into one of the pack's exact key formats:
 *
 *   workout:<session-id>
 *   prescription:<arc-id>:<session-id>
 *   threshold:<sport>:lt1
 *   threshold:<sport>:lt2
 *   persona:<active-profile>
 *   monitoring:<concern-id>:<signal>
 *
 * Human components (sports, signals, profile names) are lower-case slug
 * normalized. Durable IDs (session_id, arc_id, concern_id) are validated for
 * safety and preserved verbatim — rescheduling or retitling never changes a
 * key. Dates, titles, week numbers, and workout bodies never participate in
 * identity: they live in `effective_at`, `statement`, and `details` and are
 * ignored here.
 *
 * When a unique key cannot be derived the result is `unbound`; unbound
 * candidates cannot supersede anything automatically and are surfaced as
 * explicit preview blocks.
 *
 * @module engram-coach-keys
 */

import type { JsonObject, JsonValue } from "@isparling/engram-harness/knowledge-types";
import type { StructuredStateChange } from "./engram-coach-capture-types.ts";

/** The state entity types that participate in keyed identity. */
export type KeyedEntityType = StructuredStateChange["entity_type"];

/**
 * Input to key derivation: any structured state capture, or the minimal
 * subset of one ({ entity_type, key_components }). Extra structured fields
 * (`effective_at`, `statement`, `details`) are accepted and deliberately
 * excluded from identity.
 */
export type CanonicalEntityKeyInput =
  & Pick<StructuredStateChange, "entity_type" | "key_components">
  & Partial<Omit<StructuredStateChange, "entity_type" | "key_components">>;

export type DerivedCanonicalEntityKey =
  | { kind: "bound"; key: string }
  | { kind: "unbound"; reason: string };

/**
 * Durable-ID grammar: nonempty, starts alphanumeric, then alphanumerics,
 * `.`, `_`, `-`, or `~`. Colons and whitespace are excluded because `:` is
 * the key separator and IDs must survive embedding in single-segment keys.
 */
const DURABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~-]*$/;

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads a string component from the key components object. */
function component(
  components: CanonicalEntityKeyInput["key_components"],
  name: string,
): string | null {
  const value = components[name];
  return typeof value === "string" ? value : null;
}

/**
 * Validates a durable identifier and returns it verbatim. Empty, missing,
 * or unsafe values yield null with a diagnostic naming the component.
 */
function durableId(components: JsonObject, name: string): string | null {
  const raw = component(components, name);
  if (raw === null || !DURABLE_ID_PATTERN.test(raw)) {
    return null;
  }
  return raw;
}

/**
 * Lower-case slug normalization for human-readable components: trim,
 * lowercase, collapse every run of characters outside [a-z0-9] into `-`,
 * and strip leading/trailing separators. Returns null when nothing usable
 * remains.
 */
function slug(raw: string): string | null {
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.length > 0 ? normalized : null;
}

function humanComponent(
  components: JsonObject,
  name: string,
): string | null {
  const raw = component(components, name);
  return raw === null ? null : slug(raw);
}

function unbound(reason: string): DerivedCanonicalEntityKey {
  return { kind: "unbound", reason };
}

function bound(key: string): DerivedCanonicalEntityKey {
  return { kind: "bound", key };
}

/**
 * Derives the canonical entity key for a structured state capture.
 *
 * Returns `{ kind: "bound", key }` with the exact format above, or
 * `{ kind: "unbound", reason }` when required components are missing or
 * invalid — including unknown state entity types, which have no defined
 * identity format.
 */
export function deriveCanonicalEntityKey(
  input: CanonicalEntityKeyInput,
): DerivedCanonicalEntityKey {
  const { entity_type } = input;
  const components: JsonObject = isRecord(input.key_components)
    ? input.key_components
    : {};

  switch (entity_type) {
    case "workout": {
      const sessionId = durableId(components, "session_id");
      return sessionId === null
        ? unbound("workout requires a valid session_id component")
        : bound(`workout:${sessionId}`);
    }

    case "prescription": {
      // Prescription keys require BOTH arc and session components; the
      // invoking skill already has arc context from the loaded prescription.
      const arcId = durableId(components, "arc_id");
      if (arcId === null) {
        return unbound("prescription requires a valid arc_id component");
      }
      const sessionId = durableId(components, "session_id");
      if (sessionId === null) {
        return unbound("prescription requires a valid session_id component");
      }
      return bound(`prescription:${arcId}:${sessionId}`);
    }

    case "threshold": {
      const sport = humanComponent(components, "sport");
      if (sport === null) {
        return unbound("threshold requires a valid sport component");
      }
      const level = component(components, "level");
      if (level === null || (level !== "lt1" && level !== "lt2" && level !== "LT1" && level !== "LT2")) {
        return unbound("threshold level must be lt1 or lt2");
      }
      return bound(`threshold:${sport}:${level.toLowerCase()}`);
    }

    case "persona": {
      const activeProfile = humanComponent(components, "active_profile");
      return activeProfile === null
        ? unbound("persona requires a valid active_profile component")
        : bound(`persona:${activeProfile}`);
    }

    case "monitoring": {
      const concernId = durableId(components, "concern_id");
      if (concernId === null) {
        return unbound("monitoring requires a valid concern_id component");
      }
      const signal = humanComponent(components, "signal");
      if (signal === null) {
        return unbound("monitoring requires a valid signal component");
      }
      return bound(`monitoring:${concernId}:${signal}`);
    }

    default: {
      // Exhaustiveness guard: a new state entity type without a key format
      // here fails derivation instead of inventing identity.
      const exhaustive: never = entity_type;
      void exhaustive;
      return unbound("unknown state entity type has no canonical key format");
    }
  }
}
