/**
 * engram-coach federated pack — a self-contained implementation of peigs'
 * pack interfaces. engram-coach owns its domain taxonomy, extraction
 * prompts, validation, and reconciliation logic. peigs never needs to
 * know this pack's name: it is injected at extension load time via
 * `options.pack`.
 *
 * The pack implements:
 *   - KnowledgeExtractor.extractCandidates — LLM-powered turn-end extraction
 *     with deterministic fallback when LLM helper is unavailable
 *   - KnowledgePack.validateEnvelope / reconcile — domain-aware validation
 *     and semantic reconciliation using the engram-coach coaching ontology
 *
 * See peigs `harness/omp-extension-SPEC.md` for the extension contract.
 * See `engram-coach-domain.ts` for the coaching ontology types and constants.
 */

import type {
  KnowledgePack,
  KnowledgeExtractor,
  KnowledgeRecord,
} from "@isparling/engram-harness/knowledge-types";
import { engramCoachExtractor } from "./engram-coach-extractor.ts";
import {
  validateEnvelope,
  reconcile,
  relatedQuery,
} from "./engram-coach-reconciliation.ts";

export const engramCoachPackId = "engram-coach";
export const engramCoachPackVersion = "0.1.0";

/** The engram-coach pack: KnowledgePack + KnowledgeExtractor facets. */
export const engramCoachPack: KnowledgePack & KnowledgeExtractor = {
  id: engramCoachPackId,
  version: engramCoachPackVersion,

  // KnowledgePack facets
  validateEnvelope,
  relatedQuery,
  reconcile,

  // KnowledgeExtractor facets
  extractCandidates: engramCoachExtractor.extractCandidates,
};

export default engramCoachPack;

export type EngramCoachRecord = KnowledgeRecord;