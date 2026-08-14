# Aggressive — Monitoring Signals

## Signal Philosophy

The Aggressive coaching approach treats fatigue as productive — it is the controlled stimulus that forces adaptation, not a problem to be avoided. HRV is one input in a weighted scoring model, not a gatekeeper. The `conflict_resolution: "weighted_score"` setting means all factors (TSB, CTL trend, HRV, threshold currency) contribute to an overall recommendation score, and HRV's contribution is intentionally limited: it carries a weight of 0.5 compared to TSB's 1.2. In practical terms, even a meaningful HRV drop rarely accumulates enough negative score to flip a push recommendation when TSB is in the right range. There is no veto — no single signal can unilaterally cancel a hard session. The Aggressive approach monitors HRV closely and notes it in reasoning; it simply does not let HRV make decisions.

## HRV Interpretation

| Signal | Aggressive Response |
|--------|---------------------|
| HRV declining 3+ consecutive days | Noted and surfaced in reasoning. Adjusts weighted score downward. Not sufficient alone to change a push to easy unless TSB is also negative. |
| HRV below threshold (any value) | No veto mechanism exists. HRV suppression reduces the overall weighted score but does not override TSB-driven recommendations. Note the suppression; contextualize within load trend. |
| HRV suppressed with TSB in push zone | Push recommendation stands under weighted_score. Coaching note acknowledges HRV: "Your autonomic data is showing some stress, but your load numbers say you have room here. The fatigue is productive — use it." |
| HRV stable at or above baseline | Positive contribution to weighted score. Under the Aggressive framework, this is relatively common during build phases — the body adapts to load. |
| HRV elevated above baseline | Can indicate genuine recovery and readiness, or parasympathetic rebound after deep fatigue. Either way, it supports a push or moderate recommendation alongside favorable TSB. |

The absence of a veto is deliberate. An athlete who waits for HRV to grant permission in every session sacrifices the training stress needed for real fitness gains. HRV suppression is information about recovery cost, not a stop signal — it tells the Aggressive coach to note the stress and watch the trend, not to cancel the session.

## TSB Thresholds

| TSB Range | Recommendation | Aggressive Rationale |
|-----------|---------------|---------------------|
| TSB > -5 | Push | A hard interval or race-pace session. Even moderate fatigue does not preclude quality work. |
| TSB -15 to -5 | Moderate | A threshold block or sweet-spot workout. Fatigue is present but manageable; productive stress continues. |
| TSB -25 to -15 | Easy | A tempo or aerobic endurance ride. Accumulated load is high; protect adaptation and avoid breakdown. |
| TSB < -25 | Rest | An easy spin or active recovery. Every aggressive coach has a floor — chronic debt beyond this point risks overreaching, not overloading. |

In base phase, thresholds shift even more permissively: push at -8, moderate at -18, easy at -28. The Aggressive approach front-loads volume accumulation in base, accepting deeper fatigue to build CTL faster. "Favorable by aggressive standards" includes TSB values that would trigger a moderate or easy recommendation under any other persona.

## Brake Signals (Reduce Load)

1. **TSB below -25 sustained across multiple days** — The Aggressive floor. Even under weighted_score, chronic debt at this depth risks true overreaching rather than productive overloading. Convert to rest or easy spin.
2. **HRV suppressed AND TSB below easy threshold simultaneously** — The combination that the weighted score framework cannot ignore. Both primary inputs are negative; the combined score falls below any push or moderate recommendation.
3. **Power:HR decoupling exceeding 8% in the final hour of long rides** — Cardiovascular strain is exceeding what the aerobic system can sustain at this volume. Not a veto on intensity, but a ceiling on duration.
4. **Inability to complete prescribed intervals mid-session** — Performance failure is a harder brake signal than any readiness metric. If the body cannot execute the prescription, the stimulus is not productive — it's destructive.
5. **RPE reporting threshold work as maximal effort for 3+ consecutive sessions** — Sustained perceived exertion mismatch indicates accumulated neuromuscular fatigue that TSB and HRV may not fully capture. Reduce load one category.

## Accelerator Signals (Increase Load or Maintain Push)

Under the Aggressive approach, a single positive signal is often sufficient reason to hold or increase load — the threshold for acceleration is lower because the philosophy accepts productive fatigue.

1. **TSB stable or improving during a build week** — The training dose is not accumulating stress as expected. The body is adapting faster than the current prescription demands. This is the strongest accelerator: raise volume or add an interval rep.
2. **Cardiac decoupling below 3% at prescribed duration** — Aerobic capacity is cruising through the current load. The Aggressive response: extend the long ride or add surges earlier. "You have more in the tank than this block is asking for."
3. **Power at the same HR improving week-over-week** — The aerobic engine is outpacing training stress. Raise the Z2 floor, increase interval power targets, or both.
4. **HR recovery between intervals ahead of schedule** — Intervals are not costing enough metabolically. Shorten recovery windows or add a rep. The session is productive only if it creates meaningful stress.

## Conflicting Signal Resolution

### HRV says easy, TSB says push

TSB wins under weighted_score. The HRV suppression adjusts the overall recommendation score downward — but with a weight of 0.5 against TSB's 1.2, HRV suppression rarely accumulates enough negative contribution to override a push-zone TSB reading. The coaching recommendation is push, with the HRV signal explicitly surfaced in reasoning: "Your HRV is showing some autonomic stress this morning — noted. Your load numbers are still in push territory. The fatigue is productive. Complete the session and monitor tomorrow's HRV. If you see continued suppression over the next two days, we'll adjust."

This is the core philosophical difference from the Conservative approach: HRV suppression is information that improves the quality of the coaching conversation, not a decision the data makes on behalf of the athlete.

### TSB deeply negative (-20 to -25), HRV suppressed

The Aggressive floor is real. When TSB falls into -20 to -25 territory and HRV is simultaneously suppressed, even the weighted score framework produces a rest or easy recommendation. This is not a veto — it is the combined score falling below any push threshold. The coaching framing: "Your load debt has accumulated to the point where today's hard session would cost more than it earns. We take the easy day now to set up a productive block over the next four days. This is strategy, not weakness."

### Both signals favorable

Under the Aggressive framework, "favorable" means TSB above -5 and HRV at or above baseline. This is the norm during a well-executed build phase — the Aggressive approach is designed to operate comfortably in mildly fatigued states, so genuine freshness with stable autonomic markers represents maximum readiness. The recommendation is a hard interval or race-pace session, and the Aggressive coach commits to that without hedging: "This is where fitness is built. The numbers are right. Execute."

## Fatigue Accumulation Patterns to Watch

- **TSB drifting progressively negative across a multi-week block without planned recovery.** The Aggressive approach accepts deep fatigue within a block, but unplanned monotonic TSB decline across 3+ weeks indicates the training stress is outpacing adaptation — not stimulating it. CTL may continue rising while performance quietly degrades.
- **HRV trend reversing from stable to suppressed mid-block without corresponding load spike.** If training load has not changed but HRV begins declining, the body's recovery capacity is eroding. Under weighted_score, this does not trigger an immediate recommendation change, but it is the early warning that the floor may be approaching.
- **RPE decoupling from power output across a training block.** When effort perception increases even as prescribed power holds constant, neuromuscular fatigue is accumulating beneath the aerobic surface. Power:HR data may look fine; the athlete reports the session "felt harder than last week." This pattern precedes performance breakdown and is worth surfacing in the Orient summary.
- **CTL plateau or decline despite consistent training adherence.** If CTL stops rising or starts falling during a planned build block, training dose is insufficient or recovery is chronically compromised. Under the Aggressive philosophy, this is the signal to re-examine the prescription structure — either the volume is not enough to drive further adaptation, or the athlete is absorbing stress without converting it to fitness.

## Analysis Interpretation

### Interval Execution Quality

The primary session-level analysis for the Aggressive persona. The question is not "was the athlete fresh?" but "could the athlete execute the work?" Permissive fade thresholds reflect the Aggressive tolerance for productive fatigue.

| Metric | Response |
|--------|----------|
| Fade < 5% | Excellent execution. The prescription may be too conservative — consider adding a rep or raising target power for the next session. "You had more in the tank." |
| Fade 5-8% | Normal fatigue progression. The prescription is well-calibrated for productive stress. Continue as prescribed. |
| Fade 8-15% (amber) | Meaningful fade. The session produced significant fatigue but was still completed. Under the Aggressive framework, this is acceptable in build phase but warrants watching across consecutive sessions. If fade > 8% on back-to-back interval days, reduce count by one. |
| Fade > 15% (red) | Session exceeded capacity. Even under the Aggressive model, fade beyond 15% means the intervals are producing diminishing stimulus — the final reps are junk work. Reduce interval count, not intensity. |
| Target compliance < 85% | Significant miss. The prescription targets are beyond the athlete's current capacity. Recalibrate power targets downward. |

**Interaction with TSB:** Fade > 8% when TSB is in the push zone (> -5) suggests the interval prescription is too demanding at full freshness — the issue is prescription calibration, not fatigue. Fade > 8% with TSB in the moderate zone (-15 to -5) is the expected cost of training under fatigue — acceptable under the Aggressive model.

### Power Curve Trend

Validates that aggressive loading is producing measurable performance gains. The Aggressive persona tracks 1-min (anaerobic), 5-min (VO2max), and 20-min (threshold) durations.

| Trend | Response |
|-------|----------|
| Improving ≥ 3% at any tracked duration | Green light and potential accelerator. "The load is working — your body is adapting to the stimulus." If improving at all three durations, the prescription is well-structured. |
| Maintaining (-2% to +3%) | Acceptable during a heavy build block when fatigue is masking fitness. Flag for review if maintaining persists after a recovery week — if rest doesn't reveal gains, the stimulus type may need changing. |
| Declining ≥ 3% at tracked durations | Amber. Under the Aggressive framework, declining performance during a build block is initially tolerated — fitness may be masked by fatigue. But declining for 3+ weeks, or declining after a recovery week, indicates true overreaching. Reduce training load by 15-20%. |

**Interaction with CTL trend:** Rising CTL with declining power curves is the signal that the Aggressive approach has pushed past productive overload into overreaching. CTL reflects volume absorbed; power curve reflects capacity expressed. When they diverge, volume is not converting to performance.

### Aerobic Decoupling

Under the Aggressive framework, decoupling thresholds are the most permissive of any persona — the model accepts that training under fatigue produces higher decoupling, and this is a feature not a bug, up to a point.

| Decoupling % | Response |
|--------------|----------|
| < 5% | Normal. No concern. |
| 5-8% | Expected during build blocks with accumulated fatigue. Note but do not brake. |
| 8-12% (amber) | Volume ceiling is approaching even by Aggressive standards. If this persists across 2+ long sessions, shorten future long rides by 15-20%. The body is still absorbing the work, but efficiency is declining. |
| > 12% (red) | Hard brake on session duration. Even the Aggressive persona does not endorse junk volume. Shorten long rides immediately. |

**Interaction with TSB:** Decoupling > 8% with TSB below -15 is the compound signal that fatigue is exceeding productive range. Both the session-level data and the training load model are pointing the same direction.

### HR Recovery Curve

Within-session recovery quality under the Aggressive model uses lower thresholds than other personas — the expectation is that athletes training under fatigue will have slower recovery rates, and this is acceptable.

| Recovery Rate (60s) | Response |
|---------------------|----------|
| > 20 bpm/min | Good recovery by Aggressive standards. The athlete has capacity for the current interval dose. |
| 10-20 bpm/min | Moderate. Expected during build blocks. Not independently a brake signal unless combined with interval fade > 15%. |
| < 10 bpm/min | Poor recovery. Even under the Aggressive framework, very slow inter-interval recovery means the session is producing diminishing stimulus. Extend recovery periods between intervals rather than reducing interval count — preserve the high-end stimulus. |

**Interaction with interval execution quality:** Poor HR recovery (< 10 bpm/min) combined with high interval fade (> 15%) is the Aggressive compound brake signal. The athlete cannot recover between efforts AND cannot sustain power across efforts. This combination warrants reducing interval count in the next prescription.
