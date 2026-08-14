/**
 * claw-coach domain model — coaching ontology types and constants.
 *
 * Captures the LLM-driven semantics of claw-coach's 10 skills as a
 * structured type system. Used by the pack's extractor, validator, and
 * reconciler to produce coaching-aware knowledge candidates instead of
 * generic keyword-match blobs.
 *
 * This file has no peigs harness imports — it is a pure domain vocabulary
 * that the pack module imports and the extension does not need to see.
 *
 * @module claw-coach-domain
 */

// ---------------------------------------------------------------------------
// Entity types — what kind of coaching artifact or concept this is about.
// Every extraction candidate carries one entity type in details.entityType.
// ---------------------------------------------------------------------------

export const CLAW_COACH_ENTITY_TYPES = [
  "workout-adaptation",    // adapt-plan: per-session adjustment
  "consultation",          // consult: mid-arc advice seeking
  "block-review",          // block-review: end-of-block SUMMARY.md
  "race-report",           // race-analysis: post-race RACE_REPORT.md
  "season-review",         // season-retrospective: SEASON_REVIEW.md
  "arc-plan",              // set-goal: new training arc definition
  "lactate-test",          // lactate-analyze: LT1/LT2/FTP/FTHR test
  "monitoring-capture",    // monitoring-rollup: longitudinal concern row
  "intake-record",         // intake: one-time coaching setup
  "prescription",          // prescription YAML file
  "persona-fit",           // persona selection or change
  "calibration-point",     // lessons-rollup: durable athlete-specific pattern
  "methodology",           // set-goal: per-sub-block methodology doc
  "session-execution",     // raw session data (prescription vs actual)
] as const;

export type ClawCoachEntityType = (typeof CLAW_COACH_ENTITY_TYPES)[number];

// ---------------------------------------------------------------------------
// Decision kinds — the type of coaching judgment being rendered.
// ---------------------------------------------------------------------------

export const CLAW_COACH_DECISION_KINDS = [
  "workout-adaptation",    // adjusting a specific session's prescription
  "consultation-advice",   // mid-arc advisory response
  "block-restructure",     // changing a block's structure mid-cycle
  "arc-planning",          // establishing or revising a goal arc
  "persona-change",        // switching coaching philosophy
  "recovery-intervention", // pulling back based on signal picture
  "threshold-update",      // updating FTP/FTHR from lactate data
  "monitoring-capture",    // recording a monitoring concern row
  "profile-claim",         // promoting a calibration point to profile
  "setup-decision",        // intake/configuration decisions
] as const;

export type ClawCoachDecisionKind = (typeof CLAW_COACH_DECISION_KINDS)[number];

// ---------------------------------------------------------------------------
// Training signals — physiological metrics the skills track and reason about.
// ---------------------------------------------------------------------------

export const CLAW_COACH_TRAINING_SIGNALS = [
  "ctl",              // chronic training load
  "atl",              // acute training load
  "tsb",              // training stress balance
  "hrv",              // heart rate variability (rMSSD)
  "rhr",              // resting heart rate
  "decoupling",       // aerobic decoupling (pace/power drift)
  "time-in-zones",    // intensity distribution
  "interval-execution", // interval fade, compliance, CV
  "power-curve",      // best efforts at standard durations
  "strength-ratio",   // neuromuscular fatigue indicator
  "lactate-threshold", // LT1, LT2, OBLA values
  "rpe",              // rate of perceived exertion
  "nutrition",        // fueling / hydration
  "sleep",            // sleep quality and duration
  "stress",           // external life stress
  "illness",          // sickness / immune status
  "injury",           // physical injury / discomfort
] as const;

export type ClawCoachTrainingSignal = (typeof CLAW_COACH_TRAINING_SIGNALS)[number];

// ---------------------------------------------------------------------------
// Training phases — position within a training cycle.
// ---------------------------------------------------------------------------

export const CLAW_COACH_TRAINING_PHASES = [
  "base",
  "build-1",
  "build-2",
  "race-specificity",
  "peak",
  "recovery",
  "transition",
  "unknown",
] as const;

export type ClawCoachTrainingPhase = (typeof CLAW_COACH_TRAINING_PHASES)[number];

// ---------------------------------------------------------------------------
// Personas — coaching philosophies.
// ---------------------------------------------------------------------------

export const CLAW_COACH_PERSONAS = [
  "conservative",
  "aggressive",
  "polarized",
  "volume",
] as const;

export type ClawCoachPersona = (typeof CLAW_COACH_PERSONAS)[number];

// ---------------------------------------------------------------------------
// Skills — the 10 claw-coach skills that generate knowledge.
// ---------------------------------------------------------------------------

export const CLAW_COACH_SKILLS = [
  "adapt-plan",
  "consult",
  "block-review",
  "race-analysis",
  "season-retrospective",
  "lessons-rollup",
  "monitoring-rollup",
  "lactate-analyze",
  "intake",
  "set-goal",
] as const;

export type ClawCoachSkill = (typeof CLAW_COACH_SKILLS)[number];

// ---------------------------------------------------------------------------
// Entity-type to skill mapping — which skill produces which entity types.
// ---------------------------------------------------------------------------

export const ENTITY_TYPE_TO_SKILL: Record<ClawCoachEntityType, ClawCoachSkill> = {
  "workout-adaptation": "adapt-plan",
  consultation: "consult",
  "block-review": "block-review",
  "race-report": "race-analysis",
  "season-review": "season-retrospective",
  "arc-plan": "set-goal",
  "lactate-test": "lactate-analyze",
  "monitoring-capture": "monitoring-rollup",
  "intake-record": "intake",
  prescription: "set-goal",
  "persona-fit": "intake",
  "calibration-point": "lessons-rollup",
  methodology: "set-goal",
  "session-execution": "adapt-plan",
};

// ---------------------------------------------------------------------------
// ClawCoachDetails — the structured `details` payload carried in every
// claw-coach extraction candidate.
// ---------------------------------------------------------------------------

export type ClawCoachDetails = {
  /** Which claw-coach skill produced this candidate. */
  skill?: ClawCoachSkill;

  /** What kind of coaching entity. */
  entityType: ClawCoachEntityType;

  /** The specific coaching decision being made. */
  decisionKind: ClawCoachDecisionKind;

  /** Physiological signals mentioned or involved. */
  trainingSignals?: ClawCoachTrainingSignal[];

  /** Training phase context, if identifiable. */
  trainingPhase?: ClawCoachTrainingPhase;

  /** Active persona at the time of extraction. */
  persona?: ClawCoachPersona;

  /**
   * Structured delta — what changed vs. what was planned.
   * Each skill records a different shape.
   */
  delta?: Record<string, unknown>;

  /** Turn index within the session for provenance. */
  turnIndex: number;

  /** Confidence: "high" when LLM was used, "low" for deterministic fallback. */
  extractionConfidence: "high" | "low";
};

// ---------------------------------------------------------------------------
// Coaching topic hints — expanded set for deterministic fallback extraction.
// ---------------------------------------------------------------------------

export const COACHING_TOPIC_HINTS = [
  // Core training metrics
  "workout", "training", "session", "interval", "recovery",
  "hrv", "ctl", "atl", "tsb", "ft", "ftp", "fthr",
  "vo2", "vo2max", "lactate", "lt1", "lt2", "obla",
  "zone", "z1", "z2", "z3", "z4", "z5",
  "rpe", "tss", "np", "if", "power", "watt",
  "heart rate", "hr", "rhr", "resting hr",

  // Health signals
  "illness", "sick", "injury", "pain", "discomfort",
  "sleep", "nutrition", "fuel", "hydrat", "stress",
  "covid", "cold", "fever", "allergy",

  // Coaching domain
  "block", "phase", "season", "arc", "goal",
  "target event", "race", "a-race", "b-race",
  "prescription", "adapt", "modify", "change",
  "consult", "advice", "concern",
  "decoupling", "fade", "drift", "strength",
  "calibration", "pattern", "lesson",
  "monitoring", "concern", "tracking",
  "persona", "conservative", "aggressive", "polarized", "volume",
  "intake", "setup", "configure",
] as const;

// ---------------------------------------------------------------------------
// Skill-to-topic mapping — which skill a mention of a topic likely refers to.
// ---------------------------------------------------------------------------

export const SKILL_TOPIC_MAP: Record<ClawCoachSkill, string[]> = {
  "adapt-plan": ["adapt", "workout", "session", "prescription", "modify", "delta", "next workout"],
  consult: ["consult", "advice", "concern", "question", "sick", "illness", "life stress"],
  "block-review": ["block summary", "summary", "block end", "week progression"],
  "race-analysis": ["race", "race report", "event", "target event"],
  "season-retrospective": ["season", "retrospective", "end of season", "year review"],
  "lessons-rollup": ["calibration", "pattern", "lesson", "profile", "rollup"],
  "monitoring-rollup": ["monitoring", "concern", "tracking", "symptom"],
  "lactate-analyze": ["lactate", "lt1", "lt2", "ftp", "threshold", "fthr"],
  intake: ["intake", "setup", "configure", "onboard", "persona"],
  "set-goal": ["goal", "arc", "target", "block plan", "methodology"],
};