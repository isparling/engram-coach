/**
 * claw-coach federated pack — a self-contained implementation of peigs'
 * pack interfaces. claw-coach owns its domain taxonomy, extraction
 * prompts, validation, and reconciliation logic. peigs never needs to
 * know this pack's name: it is injected at extension load time via
 * `options.pack`.
 *
 * The pack implements:
 *   - KnowledgeExtractor.extractCandidates — LLM-powered turn-end extraction
 *     with deterministic fallback when LLM helper is unavailable
 *   - KnowledgePack.validateEnvelope / reconcile — domain-aware validation
 *     and semantic reconciliation using the claw-coach coaching ontology
 *
 * See peigs `harness/omp-extension-SPEC.md` for the extension contract.
 * See `claw-coach-domain.ts` for the coaching ontology types and constants.
 */

import type {
  KnowledgePack,
  KnowledgeRecord,
} from "@isparling/peigs-harness/knowledge-types";
import { clawCoachExtractor } from "./claw-coach-extractor.ts";
import {
  validateEnvelope,
  reconcile,
  relatedQuery,
} from "./claw-coach-reconciliation.ts";

export const clawCoachPackId = "claw-coach";
export const clawCoachPackVersion = "0.1.0";

/** The claw-coach pack: KnowledgePack + KnowledgeExtractor facets. */
export const clawCoachPack: KnowledgePack & typeof clawCoachExtractor = {
  id: clawCoachPackId,
  version: clawCoachPackVersion,

  // KnowledgePack facets
  validateEnvelope,
  relatedQuery,
  reconcile,

  // KnowledgeExtractor facets
  extractCandidates: clawCoachExtractor.extractCandidates,
};

export type ClawCoachRecord = KnowledgeRecord;