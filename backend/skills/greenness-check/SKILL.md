---
id: greenness-check
version: 1
status: draft
name: Greenness check
summary: Checks whether a place is as green as usual for the time of year, against its own usual range for the month and against its surroundings.
tests_events: [vegetation_loss]
considers: [seasonal, harvest, vegetation_gain]
params:
  area:
    type: area
    auto: true
    required: true
    max_km2: 25
    description: The outline of the place (GeoJSON), set by the harness from the run.
  name:
    type: string
    auto: true
    default: null
    description: Place name used in titles, set by the harness.
  years:
    type: int
    default: 4
    min: 3
    max: 5
    description: Years of monthly history used for the usual range of each month.
  answers:
    type: object
    default: null
    description: The user's clarification answers (e.g. use); not used for scoring.
needs: [optical]
outputs: [then_now, timeline, stat, scene_strip, limits]
timeout_s: 120
---

## What it does

Reads greenness (NDVI, Sentinel-2) once a month over `years` inside the outline and in the
ring around it. It checks:

- the latest clear reading against the usual range for that calendar month (earlier years,
  widened by 0.05 for noise): as green as usual, less green, or greener;
- whether the surroundings are unusual too (a regional dry spell) or only the place (local);
- when the place left its usual range and whether it stayed out (3+ months over 90+ days);
- the same month a year earlier against now (then/now pictures and the year-on-year change).

## When to use it

- "Is this park / field / hillside as green as usual?", "Is it browner than normal?", "Has it
  greened up this year?", "今年夠唔夠綠?".
- A first look at any vegetated place before a more specific check (`tree-cover-change`).

Not for places with almost no plants (city blocks, water), or for a change since a specific
date (use `tree-cover-change`).

## Limits

From the `vegetation_loss` and `seasonal` cards:

- Which cause it was (clearing, drought, pests, salt or disease); the data shows loss of green cover, not why.
- Partial canopy damage in very dense forest, because greenness saturates near 0.8-0.9.
- Regional drought dieback versus an unusually severe dry season, until a same-season comparison a year later.
- The usual range needs clear scenes in the same month of earlier years; in cloudy months it can be missing, and then only the year-on-year change is reported.
- Events before mid-2015 (Sentinel-2 start); Hong Kong-area surface reflectance coverage is thin before 2017.

## Outputs

Blocks: then/now greenness maps (primary), the greenness timeline with the surroundings and
the date it left its usual range, the latest value against the usual range, recent passes.
Too small or too cloudy: one `limits` block instead.

Findings: `verdict`, `greenness` (`value`, `normal`, `gap`, `lo`, `hi`), `surroundings`,
`year_on_year`, `unusual_since`, and `observed.greenness` (FINDINGS CONVENTION).

## Numbers to quote

Answer with the numbers, not just the verdict: the latest greenness (NDVI) with its date, the
usual range for the month (`greenness.lo`–`greenness.hi`, mean `normal`) and the gap
(`gap`, `gap_pct`); the surroundings' value; the year-on-year change with both dates
(`year_on_year`) and the changed hectares and % of the area; how many monthly readings and
clear recent passes were used and the cloud % of the latest image (`data`).
