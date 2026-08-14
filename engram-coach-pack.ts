/**
 * engram-coach federated pack — a self-contained implementation of the
 * Engram core's external pack interfaces. engram-coach owns its domain
 * taxonomy, extraction prompts, validation, and reconciliation logic. The
 * Engram core never needs to know this pack's name at build time: the CLI
 * resolves it at runtime as an ordinary Node ESM module, imported from the
 * `from` specifier a space's binding declares for it in `installed_packs`.
 *
 * The pack implements:
 *   - KnowledgeExtractor.extractCandidates — LLM-powered turn-end extraction
 *     with deterministic fallback when LLM helper is unavailable
 *   - KnowledgePack.validateEnvelope / reconcile — domain-aware validation
 *     and semantic reconciliation using the engram-coach coaching ontology
 *   - PresentationPack — deterministic athlete-profile projection and
 *     audience authorization, defined in `engram-coach-presentation.ts`
 *
 * See `@isparling/engram-harness`'s `harness/docs/pack-interface.md` for the
 * external pack contract. See `engram-coach-domain.ts` for the coaching
 * ontology types and constants.
 */

import type {
  KnowledgePack,
  KnowledgeExtractor,
  KnowledgeRecord,
  PresentationPack,
} from "@isparling/engram-harness/knowledge-types";
import { engramCoachExtractor } from "./engram-coach-extractor.ts";
import { engramCoachPresentation } from "./engram-coach-presentation.ts";
import {
  validateEnvelope,
  reconcile,
  relatedQuery,
} from "./engram-coach-reconciliation.ts";

export const engramCoachPackId = "engram-coach";
export const engramCoachPackVersion = "0.1.0";

/** The engram-coach pack: KnowledgePack + KnowledgeExtractor + PresentationPack facets. */
export const engramCoachPack: KnowledgePack & KnowledgeExtractor & PresentationPack = {
  id: engramCoachPackId,
  version: engramCoachPackVersion,

  // KnowledgePack facets
  validateEnvelope,
  relatedQuery,
  reconcile,

  // KnowledgeExtractor facets
  extractCandidates: engramCoachExtractor.extractCandidates,

  // PresentationPack facets
  retrievalPolicy: engramCoachPresentation.retrievalPolicy,
  views: engramCoachPresentation.views,
  audiences: engramCoachPresentation.audiences,
  deliveries: engramCoachPresentation.deliveries,
};

export default engramCoachPack;

export type EngramCoachRecord = KnowledgeRecord;