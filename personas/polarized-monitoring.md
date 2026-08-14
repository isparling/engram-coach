# Polarized — Monitoring Signals

## Signal Philosophy

The Polarized coaching approach monitors readiness on two distinct axes: load-based readiness (the balance of fitness and fatigue captured by TSB and HRV) and session quality (whether intensity is distributed correctly across the physiological spectrum). Both matter, but they answer different questions. HRV at a weight of 0.8 and TSB at 1.0 operate through `conflict_resolution: "weighted_score"` — neither is a veto, and together they determine whether the body is ready to train. But even favorable readiness produces a poor training outcome if intensity distribution drifts into Zone 2-3 (the grey zone), because grey-zone work accumulates fatigue without delivering either the aerobic base stimulus of Zone 1 volume or the neuromuscular quality of Zone 4/VO2 efforts. The Polarized framework monitors for grey-zone accumulation as a training quality problem independent of readiness, not a subset of load management.

## HRV Interpretation

| Signal | Polarized Response |
|--------|-------------------|
| HRV declining 3+ consecutive days | Amber flag. Reduce intensity category even if TSB supports a push. Trend signal outweighs single-day TSB readings under weighted_score. |
| HRV below baseline (non-sustained) | Noted in reasoning. At weight 0.8, HRV adjusts the weighted score downward but does not independently flip a push to easy unless TSB is also in the negative range. |
| HRV suppressed with TSB in push zone | TSB at 1.0 weight vs HRV at 0.8 — a mild HRV dip typically does not flip the recommendation. The coaching note surfaces the dip and flags monitoring for the following days. |
| HRV stable at or above baseline | HRV is contributing positively to the weighted score. TSB is now the primary driver of the recommendation. |
| HRV elevated above baseline | Positive contribution to score. In the polarized framework, elevated HRV during easy weeks is expected — the Z1 volume base supports autonomic recovery better than moderate-intensity training. |

The absence of a veto is deliberate under the polarized model, but the consequence is different from the Aggressive persona: when HRV is suppressed under polarized, the recommendation may still be a session, but the session type shifts toward long Zone 1 endurance rather than Zone 4 work. The polarized `workout_type_map` reflects this — "moderate" is defined as "a long aerobic endurance ride (Z1-Z2)," not sweet-spot. The grey zone is not an option regardless of readiness state.

## TSB Thresholds

| TSB Range | Recommendation | Polarized Interpretation |
|-----------|---------------|--------------------------|
| TSB ≥ 0 | Push | Zone 4 or VO2max intervals specifically — not threshold, not sweet-spot. "Today calls for real high-end work, not moderate." |
| TSB -8 to 0 | Moderate | Long Zone 1 endurance ride. Under the polarized model, **"moderate" means high-volume easy, not medium intensity**. This is the critical edge case from the persona JSON. |
| TSB -18 to -8 | Easy | An easy Zone 1 endurance ride. Load is present; protect quality and avoid grey-zone drift. |
| TSB < -18 | Rest | Complete rest. No sweet-spot or threshold training today. |

**Important nuance:** In base phase, TSB thresholds shift more permissively (push at -2, moderate at -10, easy at -20), accepting slightly more fatigue during the volume-building phase. In peak phase, thresholds tighten sharply (push requires TSB ≥ 5), preserving neuromuscular quality for race-specific VO2 efforts. Under no phase does "moderate" mean sweet-spot or threshold work — the polarized model treats grey-zone sessions as a structural error in intensity distribution, not a reasonable compromise.

## Brake Signals (Reduce Load)

Ordered by severity. Under the polarized model, brake signals include both fatigue signals and intensity distribution signals — grey-zone drift is treated as a training quality problem, not a readiness problem.

1. **HRV suppressed + TSB deeply negative (both signals aligned)** — When the weighted score produces compound negative contribution from both primary factors, the recommended session becomes rest or easy Zone 1. Both axes are pointing the same direction; honor the signal.
2. **Chronic TSB below -18 for multiple consecutive days** — The easy threshold has been exceeded without recovery. Even under polarized intensity discipline, sustained deep fatigue requires load reduction to preserve the quality of future Zone 4 sessions.
3. **RPE elevated at Zone 2 pace or power** — Aerobic threshold displacement: the athlete is experiencing effort-mismatched output at intensities that should feel genuinely easy. This signals that the aerobic base itself is declining, not just temporary fatigue.
4. **Session drift into Zone 3 (grey zone)** — The polarized-specific brake. A session that was planned as Zone 1 but drifted into Zone 3 represents an intensity distribution failure. Grey-zone accumulation erodes both the aerobic base stimulus (by raising intensity above Z1 adaptation zone) and the quality of future high-intensity efforts (by accumulating fatigue without corresponding neuromuscular stimulus). The corrective action is pacing discipline in the next session, not rest — but the pattern is flagged as a brake on training quality, not merely on training load.

## Accelerator Signals (Increase Load or Maintain Push)

Under the polarized framework, "permission to push" means permission to execute Zone 4/VO2max intervals — not permission to add moderate-intensity volume. All accelerator signals below authorize high-intensity work specifically.

1. **TSB at or above 0 with HRV stable at baseline** — Both components of the weighted score are favorable. The green light under polarized is explicit: execute a VO2max or anaerobic interval session, not a threshold block. "Keep the intensity honest — today is a Zone 4 day."
2. **HRV trending upward during a load week with TSB in push range** — Both readiness indicators improving simultaneously. The polarized response is a high-quality interval session. Resist the temptation to substitute a longer moderate-intensity ride — the polarized model earns aerobic benefit from Zone 1 volume, not grey-zone padding.
3. **CTL building steadily with minimal grey-zone session accumulation** — Fitness trajectory is positive and intensity distribution is clean. The training stress is landing in the right zones. Continue the prescription without alteration.
4. **Zone 4 effort quality improving week-over-week (power or pace at given HR)** — VO2max work is producing the intended stimulus. The accelerator signal here is maintenance or modest increase in interval load, not a shift toward threshold work.

## Conflicting Signal Resolution

### HRV says easy, TSB says push

The weighted score determines the outcome. HRV at weight 0.8 vs TSB at weight 1.0 means a mild HRV dip — one morning slightly below baseline — likely does not flip a TSB-supported push recommendation. However, sustained HRV suppression across two or three days accumulates a meaningful negative contribution to the weighted score. If suppression is sustained, the score may shift the recommendation from push to moderate.

When it shifts to "moderate" under the polarized model, the recommendation is a long Zone 1 endurance ride — not sweet-spot, not tempo. This is the natural polarized compromise: the readiness signal says "don't push hard today" and the intensity framework says "we don't do grey zone." The Zone 1 ride is the only available middle ground in this model, and it is a deliberate structural choice rather than a fallback.

### Grey zone session despite favorable readiness

This is the polarized-specific conflict: the athlete's TSB is in push zone and HRV is stable, but the intended Zone 1 or Zone 2 session has drifted to Zone 3. The readiness indicators are not the problem — pacing discipline is. The polarized monitoring framework treats this as a session quality failure, not a load failure. The response is not rest; it is a recalibration of pacing in the next session. "You had the readiness for quality work today. The effort drifted into the grey zone — that's the one zone where intensity is high enough to accumulate fatigue but too low to produce the VO2 stimulus. Pull back to real Zone 1 tomorrow and be intentional about pacing."

### Both signals favorable

TSB at or above 0 and HRV stable at or above 7-day baseline: full green light under the polarized framework. The recommendation is a Zone 4/VO2max interval session — specifically not threshold or sweet-spot. The polarized model defines push as "real high-end work," and the coaching voice commits to that without hedging. "Both your load numbers and your autonomic data are clear. Today is a Zone 4 day. Keep it clean — hard efforts hard, everything else genuinely easy."

Green light for moderate (TSB -8 to 0 with stable HRV) means a long Zone 1 ride. High volume, genuinely low intensity. Not a tempo ride that "feels" like Zone 2. "The polarized model earns aerobic base from Zone 1 — stay in the zone and let the volume do the work."

## Fatigue Accumulation Patterns to Watch

- **Intensity distribution creep across a multi-week block.** The most polarized-specific pattern: individual sessions that should be Zone 1 accumulating subtle drift into Zone 3 over weeks. No single session is flagged as a problem, but cumulative grey-zone exposure produces fatigue that is physiologically misallocated — not building the aerobic base (too intense) and not producing VO2max stimulus (too easy). The monitoring signal is session-level time-in-zone data across the full block, not single-session averages.
- **HRV baseline drifting downward across a full training block.** When the 7-day rolling HRV baseline itself declines week over week — not single-day dips but the moving average — the autonomic system is not recovering between sessions. Under polarized, this often signals grey-zone contamination reducing recovery quality rather than raw training volume.
- **Zone 4/5 sessions producing diminishing RPE improvement week-over-week.** If high-intensity intervals are becoming progressively harder to execute at prescribed power (RPE creeping up at the same output), VO2max saturation is approaching. The stimulus is no longer producing adaptation at this dose. The signal indicates a need for either a recovery week or restructuring the interval type.
- **Aerobic decoupling — HR rising at the same Zone 1 power or pace across a block.** The definitive aerobic base quality signal. If Zone 1 rides show increasing HR at constant pace/power over a training block, aerobic fitness is not improving despite training volume. This pattern in a polarized model means the Zone 1 work is either not genuinely easy (grey-zone contamination) or intensity distribution has been inverted — too much moderate, too little true Zone 1.

## Analysis Interpretation

### Time in Zones

The enforcement mechanism for the polarized model. Every completed session is evaluated against the 80/20 intensity distribution. This is the highest-weight analysis (0.5) across all personas — zone compliance is the defining concern of the polarized framework.

| Pattern | Response |
|---------|----------|
| Z1 ≥ 75%, Z4+ present on hard days, Z2-3 < 5% | Model compliance. "Clean polarization — easy days easy, hard days hard." No corrective action needed. |
| Z1 ≥ 75% but Z2-3 is 5-15% | Grey zone drift. The session included moderate intensity that the polarized model explicitly eliminates. Identify where the drift occurred — warmup pacing, terrain-induced effort, or discipline breakdown. Prescribe structure to prevent it: "Set a hard HR cap for the easy portions. If your HR creeps above Z1, soft-pedal until it drops." |
| Z1 < 75% on an endurance day | Model violation. "This was supposed to be easy volume — it became a tempo ride." Strongest brake signal under the polarized approach. The session's training benefit is compromised because the stimulus landed in the wrong zone. |
| Z4+ absent on an intensity day | Missed stimulus. The hard day was not hard enough. Prescription needs sharper intensity targets, shorter intervals with higher power ceiling, or clearer effort cues. "The hard day needs to be genuinely hard — Zone 4 minimum." |
| Z2-3 > 15% across a week | Systemic grey zone contamination. Not a single-session issue but a structural pattern. The athlete's easy pace is not easy enough, or the terrain/conditions are forcing moderate effort. Requires a prescription-level fix, not just pacing reminders. |

**Interaction with existing signals:** Time-in-zones is a prerequisite for all other signal interpretation under the Polarized persona. If zone distribution is wrong, other metrics (decoupling, power trends) are interpreted in the context of "the training stimulus was wrong" rather than "the athlete is fatigued." A high RPE on a session that drifted to Zone 3 is not a fatigue signal — it is a pacing failure.

### Power Curve Trend

Validates that Zone 4/VO2max intervals are producing neuromuscular adaptation. Under the polarized model, power curve improvements at short durations (30s, 1min, 5min) confirm that the high-intensity work is landing as intended.

| Trend | Response |
|-------|----------|
| Improving ≥ 3% at VO2max durations (1-5 min) | Green light. The hard sessions are producing the intended stimulus. "Your high-end is responding to the work." |
| Maintaining (-2% to +3%) | Acceptable in base phase when intensity volume is deliberately low. In build/peak: flag for review — the Zone 4 dose may be insufficient or the athlete may need a stimulus variation (shorter intervals, higher power). |
| Declining ≥ 5% at VO2max durations | Amber-red. Under the polarized model, declining high-end power suggests either: (a) Zone 4 sessions are being contaminated by fatigue from grey-zone work, or (b) the intensity dose is not sufficient to maintain neuromuscular capacity. Check time-in-zones first — if grey zone is > 5%, the intensity distribution is the root cause. |

**Interaction with time-in-zones:** Declining power curves combined with grey-zone contamination > 5% is a clear diagnosis: the easy days are not easy enough, which means the hard days cannot be hard enough. Fix the zone distribution first; power curve trends will follow.

### HR Recovery Curve

Cardiac recovery quality after Zone 4/VO2max efforts. Under the polarized model, fast recovery between intervals enables the high-intensity quality that the model depends on.

| Recovery Rate (60s) | Response |
|---------------------|----------|
| > 25 bpm/min | Good recovery. The athlete is recovering between intervals, enabling high-quality Zone 4 work. The polarized model is functioning as intended. |
| 15-25 bpm/min | Moderate. If this is a decline from the athlete's recent baseline, it may indicate accumulated fatigue from grey-zone contamination — the easy days are not providing sufficient recovery for the hard days. |
| < 15 bpm/min | Poor recovery. Under the polarized framework, this suggests the 80/20 balance is off — either too much grey-zone work is eroding recovery, or the interval dose is too high. Check time-in-zones before adjusting interval prescription. |
| Decline > 5 bpm/min across intervals | Within-session fatigue. The interval count may be too high for the athlete's current capacity. Consider reducing interval count while maintaining or increasing interval intensity — preserve the quality of each effort. |

**Interaction with time-in-zones:** Poor HR recovery (< 15 bpm/min) with clean zone distribution (Z2-3 < 5%) indicates genuine fatigue from the high-intensity work itself — reduce interval volume. Poor HR recovery with dirty zone distribution (Z2-3 > 10%) indicates the easy days are eroding recovery capacity — fix the easy days first.
