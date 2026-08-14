---
name: lactate-analyze
description: Query lactate analysis results for an athlete. Use this when you need LT1/LT2/FTP/FTHR values and their confidence intervals for training decisions. Also use when analyzing spot test results or comparing to historical tests.
---

# Lactate Analysis

## Overview

This skill provides access to the lactate analysis subsystem for querying threshold values, FTP/FTHR estimates, and spot test analysis. The Claw-Coach uses this during Orient phase to inform training decisions.

## Data Flow

```
Prescription YAML (spot test orders)
         │
         ▼
   Athlete performs test
         │
         ▼
   lactate import (CLI)
         │
         ▼
   Analysis Engine (multiple methods + CI)
         │
         ▼
   Results stored in JSON
         │
         ▼
   lactate query (CLI or API)
         │
         ▼
   Claw-Coach adapts training
```

## Usage

### Import Ramp Test Data

```bash
cd lactate
npm install
npm run build

# Import a ramp test from CSV
lactate import -f /path/to/test.csv -t ramp -d 2026-03-01 -s cycling

# CSV format:
# power,heartrate,lactate
# 150,120,1.2
# 175,135,1.5
# 200,150,2.1
# ...
```

### Query Latest Analysis

```bash
lactate query --latest
lactate query --latest --compare  # Compare to previous test
```

### Query via API (for Claw-Coach integration)

```typescript
import { createLactateAPI } from './lactate';

// Create API instance
const api = createLactateAPI('athlete-id', '/path/to/data/dir');

// Query latest analysis
const result = await api.query({ compareToPrevious: true });

console.log(result.currentAnalysis.lt2.power);       // e.g., 235
console.log(result.currentAnalysis.ftp.value);      // e.g., 248
console.log(result.currentAnalysis.lt2.ci80);       // e.g., [228, 242]
console.log(result.comparison?.interpretation);      // "LT2 improved by 10W"
```

## Spot Test Workflow

### 1. Coach Orders Spot Test (in Prescription YAML)

```yaml
sessions:
  - week: 3
    day: Thu
    session_name: W3_SweetSpot
    total_duration_min: 120
    intervals:
      - duration_min: 20
        power_low_pct: 88
        power_high_pct: 92
        count: 3
        recovery_min: 8
    spot_tests:
      - interval_ref: 2
        sample_times_min: [10, 20]
        reason: "Verify sweet spot intensity is below LT2"
```

### 2. Athlete Performs Test and Imports Results

```bash
# After the session, athlete imports spot readings
lactate import -f spot_readings.csv -t spot -r "W3_SweetSpot-interval2"

# CSV format:
# power,heartrate,lactate
# 220,155,1.8
# 225,160,2.1
```

### 3. Analyze Spot Test

```typescript
const spotAnalysis = await api.analyzeSpotTest(
  [
    { power: 220, heartrate: 155, lactate: 1.8 },
    { power: 225, heartrate: 160, lactate: 2.1 }
  ]
);

console.log(spotAnalysis.trend);        // 'improving', 'stable', 'declining'
console.log(spotAnalysis.comparisonToBaseline.delta);  // e.g., -0.5
```

## Output Format

### LactateAnalysis Response

```json
{
  "athleteId": "default",
  "testId": "abc-123",
  "testType": "ramp",
  "testDate": "2026-03-01",
  "sport": "cycling",
  "lt1": {
    "power": 185,
    "heartrate": 142,
    "lactate": 1.8,
    "ci80": [178, 192],
    "ci95": [170, 198],
    "method": "log-log",
    "methodType": "primary"
  },
  "lt2": {
    "power": 235,
    "heartrate": 165,
    "lactate": 4.2,
    "ci80": [228, 242],
    "ci95": [220, 250],
    "method": "dmax",
    "methodType": "primary"
  },
  "ftp": {
    "value": 248,
    "ci80": [240, 255],
    "ci95": [235, 262],
    "method": "lt2-derived"
  },
  "fthr": {
    "value": 168,
    "ci80": [162, 172],
    "method": "lt2-hr"
  },
  "testQuality": "good",
  "confidence": "high",
  "methodsUsed": ["dmax", "obla_4", "log-log"],
  "dataQualityNotes": []
}
```

## Analysis Methods

The analyzer runs multiple detection methods and provides confidence intervals:

| Method | Best For | Primary Target |
|--------|----------|----------------|
| Log-log | LT1 detection | LT1 |
| Dmax | Full curves | LT2 |
| Modified Dmax | Noisy data | LT2 |
| OBLA 4.0 | Fixed threshold | LT2 |
| OBLA 2.0 | Fixed threshold | LT1 |
| Baseline+ | Drift correction | LT1 |

**Confidence Intervals:**
- 80% CI: Likely range for training decisions
- 95% CI: Bounds for conservative planning
- Wider CI for marginal/poor data quality

## Integration Points

### During adapt-plan Orient Phase

1. Check if lactate data exists: `await api.query()`
2. If available, incorporate thresholds into signal synthesis:
   - Use LT1 power for upper Z2 boundary
   - Use LT2 power for threshold zone (Z4)
   - Use FTP for training zones
   - Reference confidence intervals for decision uncertainty
3. If spot tests available, analyze trend

### QMD Knowledge Integration

After significant analysis results (new baseline test), create a knowledge record:

```
{coaching_docs_dir}/lactate/YYYY-MM-DD-ramp-analysis.md
```

Include:
- LT1/LT2 power and HR with CIs
- FTP/FTHR values
- Comparison to previous test
- Methods used
- Data quality notes

---

## Error Handling

| Scenario | Response |
|----------|----------|
| No tests found | Return null, skip lactate analysis in orient |
| Only 1-2 points | Reduce confidence to medium/low, warn user |
| LT1 not detected | Use OBLA 2.0 as fallback |
| LT2 not detected | Use OBLA 4.0 as fallback |
| CI unavailable | Report point estimate only, note reduced confidence |
