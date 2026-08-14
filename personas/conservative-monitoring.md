# Conservative — Monitoring Signals

## Signal Philosophy

The Conservative coaching approach treats readiness as a prerequisite to hard work, not a factor to weigh against it. HRV suppression is a gatekeeper: when the autonomic nervous system signals stress at or below the veto threshold (-2.0 standard deviations from 7-day baseline), the day's prescription changes regardless of how favorable TSB looks. This philosophy is encoded in the `conflict_resolution: "hrv_veto"` setting and reflected in factor weights that place HRV (1.2) above TSB (1.0) — the body's stress signal outranks the training load model. The Conservative approach does not dismiss TSB; it simply insists that HRV must first grant permission for TSB to matter.

## HRV Interpretation

| Signal | Conservative Response |
|--------|----------------------|
| HRV declining 3+ consecutive days | Treat as amber flag: reduce to moderate even if TSB supports a push. A trend matters more than a single value. |
| HRV below -2.0 SD from 7-day baseline | HRV veto triggered. Regardless of TSB, recommend easy or rest. The prescription changes — not negotiated. |
| HRV below -1.5 SD (peak phase) | Veto threshold tightens in peak phase per phase_overrides. Lower tolerance for autonomic stress when the stakes are highest. |
| HRV stable at or above baseline | Permission is granted for TSB to drive the recommendation. Stable HRV does not guarantee a push — it simply removes the veto. |
| HRV elevated above baseline | Not always a green light. Elevated HRV after a hard block can indicate parasympathetic rebound following deep fatigue. Interpret in context of recent training load and athlete subjective feel. |

When the veto triggers, "regardless of TSB" means exactly that: a TSB of +8 does not override a -2.2 z-score HRV reading. The Conservative approach defines recovery as the absence of suppression signals, not the presence of freshness numbers.

## TSB Thresholds

| TSB Range | Recommendation | Conservative Rationale |
|-----------|---------------|----------------------|
| TSB > 5 | Push | A structured threshold or VO2max session. Freshness supports intensity. |
| TSB -5 to 5 | Moderate | A tempo or aerobic threshold ride. Some residual fatigue; quality over peak intensity. |
| TSB -15 to -5 | Easy | An easy endurance ride (Z1-Z2). Accumulated load is present; protect the adaptation. |
| TSB < -15 | Rest | Complete rest or gentle walk only. Debt has outpaced recovery capacity. |

These thresholds tighten further in peak phase (push requires TSB > 8, moderate extends only to TSB = 0, easy down to -10). The Conservative approach is even more conservative when approaching target events — arriving at peak with residual fatigue is a risk this philosophy is not willing to accept.

## Brake Signals (Reduce Load)

1. **HRV drops below -2.0 SD from 7-day baseline** — Veto triggers immediately. Convert any structured session to easy or rest. This is the highest-priority brake signal in the Conservative framework.
2. **HRV declining on 3 or more consecutive days** — Even without reaching veto threshold, a sustained trend signals accumulating autonomic stress. Step down one load category.
3. **Resting heart rate elevated 5+ bpm from baseline for 3+ days** — Cardiac drift indicates the sympathetic system is running hot. Treat as amber; two concurrent amber signals become a brake.
4. **Power:HR decoupling exceeding 8% in the final hour of long rides** — Aerobic system is struggling to maintain output relative to cardiac cost. Volume ceiling has been reached for the week.
5. **Session RPE reporting sub-threshold work as heavy effort** — Perceived exertion mismatched to intensity signals neuromuscular or metabolic fatigue the numbers don't capture. Take the RPE at face value.
6. **TSB below -15 with any concurrent HRV decline** — Under the Conservative framework, a negative TSB plus any HRV suppression (even below veto) is a compound brake signal. Combined debt requires recovery priority.

## Accelerator Signals (Increase Load or Maintain Push)

Under the Conservative approach, a single positive signal is not permission to push harder — multiple aligned signals are required before increasing the training dose.

1. **HRV trending up during a load week with TSB in push zone** — Both the autonomic and training load indicators are favorable. This is the Conservative definition of genuine readiness. An increase of 5-10% in next week's load is warranted.
2. **Cardiac decoupling consistently below 3% on long rides with stable HRV** — The aerobic system is operating comfortably within the prescribed volume. Duration or intensity can increase if HRV concurs.
3. **TSB creeping positive across a build week despite training adherence** — The current dose is not accumulating stress as expected. This may indicate the training stimulus is below threshold for continued adaptation.
4. **Subjective motivation high on rest days with no HRV or HR flags** — Physiological readiness, not just willingness. The Conservative approach treats this convergence — objective and subjective signals aligned — as meaningful permission.

## Conflicting Signal Resolution

### HRV says easy, TSB says push

HRV wins. This is what "hrv_veto" means in practice: when HRV drops to or below -2.0 standard deviations from the athlete's 7-day rolling baseline, the veto overrides the TSB calculation entirely. The coaching recommendation becomes easy endurance or rest — not a negotiated moderate. The reasoning surfaced to the athlete: "Your autonomic data is signaling recovery demand. We'll protect today's session and position you for quality work when your system has cleared the stress. The fitness is not going anywhere."

### TSB deeply negative, HRV stable

The Conservative approach does not require a veto to protect the athlete. TSB below -15 is a brake signal in its own right, even when HRV holds steady. The reasoning: chronic load accumulation damages more than day-to-day autonomic readings can capture. Stable HRV with TSB below -15 receives an easy recommendation, not a push. The athlete's body is carrying debt that hasn't fully appeared in HRV data yet.

### Both signals favorable

TSB above +5, HRV at or above 7-day baseline: green light under the Conservative framework. Both the training load model and the autonomic readiness indicator are aligned. This is the clearest possible permission state — a structured threshold or VO2max session is appropriate, and the Conservative coach will commit to that recommendation rather than hedging. "Your body is ready. Let's use it."

## Fatigue Accumulation Patterns to Watch

- **Multi-day HRV suppression trend, not single-day dip.** One morning below baseline is noise; three consecutive days below baseline is a pattern. The Conservative approach monitors 7-day rolling baseline carefully and treats sustained decline as the key early warning sign, long before values reach the veto threshold.
- **TSB declining across consecutive weeks despite consistent training load.** If TSB trends progressively negative week over week without a planned recovery block, CTL momentum is outrunning recovery capacity. This is the signature of unplanned overreaching — common in athletes who feel strong in the first two weeks of a block.
- **RHR rising with suppressed HRV simultaneously.** Resting heart rate elevation alongside HRV suppression represents a compound autonomic stress signal. Either alone is amber; both together indicate the sympathetic system is dominant and the parasympathetic is not recovering between sessions.
- **RPE decoupling from heart rate over the course of a block.** When sub-threshold power starts feeling like threshold effort but heart rate remains normal, the neuromuscular system is fatigued even though the cardiovascular system appears available. This pattern often precedes a performance plateau and is easy to miss when looking at HR and power alone.

## Analysis Interpretation

### HR Recovery Curve

Within-session cardiac recovery is a freshness signal the Conservative approach values highly. How quickly the heart rate drops after a hard effort reveals whether the autonomic system is managing the training stress or falling behind.

| Recovery Rate (60s) | Response |
|---------------------|----------|
| > 25 bpm/min | Good cardiac recovery. The athlete's autonomic system is managing inter-interval stress well. Supports the current prescription. |
| 15-25 bpm/min | Moderate recovery. Not alarming in isolation, but note the trend — if recovery rate has declined from earlier in the block, the athlete is accumulating fatigue the TSB model may not fully capture. |
| < 15 bpm/min | Poor recovery. The sympathetic system is dominant. Under the Conservative framework, this compounds with any concurrent HRV suppression to produce a brake signal — reduce interval count or extend recovery in the next prescription. |
| Decline > 5 bpm/min from first to last interval | Within-session fatigue accumulation. The athlete started fresh enough but the session cost exceeded recovery capacity. Consider reducing interval count rather than intensity for the next similar session. |

**Interaction with HRV veto:** Poor HR recovery (< 15 bpm/min) combined with HRV approaching veto threshold (-2.0 z-score) is a compound brake signal. The within-session data confirms what the morning HRV reading suggested: the autonomic system is under strain. The Conservative approach treats this convergence as a strong rest signal.

### Aerobic Decoupling

Under the Conservative framework, decoupling thresholds are tighter than other personas — the goal is to detect volume ceiling earlier, not after the athlete has pushed through it.

| Decoupling % | Response |
|--------------|----------|
| < 2% | Excellent. Aerobic system is operating well within capacity. |
| 2-3% | Normal range. No concern for a single session. |
| 3-5% (amber) | Early warning. The Conservative approach flags this where other personas would not. If concurrent with any HRV decline or RHR elevation, recommend reducing long ride duration by 15-20% in the next prescription. "Let's protect the quality of this fitness." |
| > 5% (red) | Hard brake on session duration. The aerobic system is failing to sustain output. Shorten long rides and revisit only after a recovery period. Under the Conservative framework, decoupling above 5% means the session was too long — not that the athlete needs to push through it. |

**Interaction with HRV:** Decoupling > 3% combined with an HRV decline of 3+ consecutive days is a compound brake under the Conservative model. The within-session data (decoupling) and the multi-day autonomic data (HRV trend) are telling the same story from different angles.

### Interval Execution Quality

The Conservative approach monitors interval execution as an early fatigue signal — power fade beyond acceptable thresholds indicates the prescription is demanding more than the athlete can deliver cleanly.

| Metric | Response |
|--------|----------|
| Fade < 5% | Clean execution. Prescription is well-calibrated. |
| Fade 5-10% (amber) | Meaningful fade. Under the Conservative framework, this warrants mentioning in Synthesize even though other personas would not flag it. Consider reducing interval count by one in the next similar session. |
| Fade > 10% (red) | The prescription exceeded the athlete's current capacity. Reduce both interval count and possibly target power for the next session. "The fitness is there — we just asked for too much today." |
| Target compliance < 90% | Significant miss. Either the prescription targets are too ambitious or the athlete is carrying more fatigue than TSB suggests. Recalibrate. |

**Interaction with TSB:** Interval fade > 5% when TSB is in the push zone (> 5) suggests the prescription intensity is too high, not that the athlete is fatigued. When fade > 5% coincides with TSB in the moderate zone, it confirms the fatigue picture and strengthens the Conservative brake.

### HRV Trend

Formalizes the existing Conservative HRV monitoring into a structured analysis with explicit trend tracking.

| Signal | Response |
|--------|----------|
| HRV z-score > 0, stable or improving | Green light. Autonomic system is not a constraint. |
| HRV z-score -1.0 to 0 (amber) | Mild suppression. Monitor trend direction. If declining for 2+ days, step down one load category even before veto threshold is reached. |
| HRV z-score < -2.0 (red) | Veto threshold reached. This analysis result reinforces the existing HRV veto mechanism — the structured analysis confirms what the veto already enforces. |
| 3+ consecutive days below baseline | Trend signal. Under the Conservative framework, a sustained trend is a brake signal independent of the magnitude of suppression. "The direction matters more than the depth." |

**Interaction with HRV veto:** This analysis does not replace the veto mechanism — it adds trend context around it. The veto is a threshold gate; the HRV trend analysis captures the trajectory leading toward or away from that gate.

### Resting HR Trend

Cardiac fatigue is tracked over the Conservative-standard 7-day window. The shorter window favors earlier detection than the longer-horizon volume policy.

| Trend | Response |
|-------|----------|
| RHR stable (± 1 bpm over 7 days) | Normal. No cardiac fatigue signal. |
| RHR rising 3-5 bpm over 7 days (amber) | Amber flag. Sympathetic system is elevated. Under the Conservative framework, this is sufficient on its own to recommend stepping down one load category. |
| RHR rising > 5 bpm over 7 days (red) | Hard brake. Combined with any HRV suppression, this is a strong rest signal. "Your heart rate is telling you something — let's listen." |

**Interaction with HRV:** RHR rising + HRV declining is the Conservative compound brake scenario. Both cardiac metrics moving in the wrong direction simultaneously is the strongest possible fatigue signal in this framework.
