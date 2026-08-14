/**
 * claw-coach OMP extension — the federated entry point.
 *
 * A wholly independent extension owner: imports the generic peigs
 * extension factory, injects the claw-coach pack, and lets peigs use the
 * pack's facets directly (no registry, no CLI resolution of claw-coach).
 *
 * Launch with:
 *   omp --extension ~/code/claw-coach/claw-coach-extension.ts
 *
 * On load the extension logs:
 *   [peigs] pack loaded: claw-coach@0.1.0 — facets: extractCandidates, validateEnvelope, reconcile
 * and registers the `peigs_status` tool, which reports mode: "direct".
 */

import peigsExtension, { type ExtensionAPI } from "@isparling/peigs-harness/types";
import { clawCoachPack } from "./claw-coach-pack.ts";
import type { PeigsPack } from "@isparling/peigs-harness/pack-types";

const pack: PeigsPack = clawCoachPack;

export default async function clawCoachExtension(api: ExtensionAPI): Promise<void> {
  return peigsExtension(api, { pack });
}
