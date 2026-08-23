/**
 * engram-coach federated pack — a self-contained implementation of the
 * Engram core's external pack interfaces. engram-coach owns its domain
 * taxonomy, extraction prompts, validation, and reconciliation logic. The
 * Engram core never needs to know this pack's name at build time: the CLI
 * resolves it at runtime as an ordinary Node ESM module, imported from the
 * `from` specifier a space's binding declares for it in `installed_packs`.
 *
 * The pack implements:
 *   - KnowledgePack.validateEnvelope / selectRelatedRecords / reconcile —
 *     domain-aware validation, exact related-record selection, and
 *     reconciliation using the engram-coach coaching ontology
 *   - PresentationPack — deterministic athlete-profile projection and
 *     audience authorization, defined in `engram-coach-presentation.ts`
 *
 * It also exports the three binding-selected capture functions the OMP
 * adapter resolves by name: `captureFromTurn` (ambient, candidate-only),
 * `previewStructuredCapture` (explicit, hash-bound), and `materialize`
 * (deterministic compatibility views). Ambient capture is LLM-only; there is
 * no deterministic transcript extractor, so this pack deliberately does not
 * implement the generic `KnowledgeExtractor` facet.
 *
 * See `@isparling/engram-harness`'s `harness/docs/pack-interface.md` for the
 * external pack contract. See `engram-coach-domain.ts` for the coaching
 * ontology types and constants.
 */

import type {
  KnowledgePack,
  KnowledgeRecord,
  PresentationPack,
} from "@isparling/engram-harness/knowledge-types";
import { engramCoachPresentation } from "./engram-coach-presentation.ts";
import {
  validateEnvelope,
  reconcile,
  selectRelatedRecords,
} from "./engram-coach-reconciliation.ts";
export { captureFromTurn } from "./capture-handler.ts";
export { previewStructuredCapture } from "./engram-coach-structured-capture.ts";
export { materialize } from "./engram-coach-materialization.ts";

export const engramCoachPackId = "engram-coach";
export const engramCoachPackVersion = "0.1.0";

/** The engram-coach pack: KnowledgePack + PresentationPack facets. */
export const engramCoachPack: KnowledgePack & PresentationPack = {
  id: engramCoachPackId,
  version: engramCoachPackVersion,

  // KnowledgePack facets
  validateEnvelope,
  selectRelatedRecords,
  reconcile,


  // PresentationPack facets
  retrievalPolicy: engramCoachPresentation.retrievalPolicy,
  views: engramCoachPresentation.views,
  audiences: engramCoachPresentation.audiences,
  deliveries: engramCoachPresentation.deliveries,
};

export default engramCoachPack;

export type EngramCoachRecord = KnowledgeRecord;