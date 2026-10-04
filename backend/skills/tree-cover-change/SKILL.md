---
id: tree-cover-change
version: 1
status: draft
name: Tree cover change
summary: Checks whether trees or other green cover have been lost since a date (default the same month of 2022), and maps where and how many hectares.
tests_events: [vegetation_loss]
considers: [seasonal, harvest, construction, new_bare_or_built]
params:
  area:
    type: area
    auto: true
    required: true
    max_km2: 25
    description: The outline of the woodland or green area (GeoJSON), set by the harness.
  name:
    type: string
    auto: true
    default: null
    description: Place name used in titles, set by the harness.
  before:
    type: date
    default: null
    description: Earlier date to compare; default the same day and month of 2022 as `after`.
  after:
    type: date
    default: null
    description: Later date to compare; default the latest clear scene.
  answers:
    type: object
    default: null
    description: The user's clarification answers; not used for scoring.
needs: [optical]
outputs: [then_now, highlight, stat, limits]
timeout_s: 120
---

## What it does

Compares the place on two dates (`before`, default the same month of 2022 so the season
matches, and `after`, default the latest clear image), with Sentinel-2:

- greenness (NDVI), moisture (NDMI) and bare ground (NDBI) inside the outline, and the
  hectares whose greenness changed by more than 0.15 (the changed patches);
- greenness in the ring around it, to tell a local clearing from a regional change;
- whether it was tree cover before (greenness about 0.5 or more) or sparser vegetation.

## When to use it

- "Has tree cover been lost here since 2022?", "Were trees cut down?", "Is this woodland
  smaller than before?", "啲樹係咪少咗?".

Not for crops (harvest repeats every year; use `greenness-check`), burns (use `run_code`
with the `burn` card) or clearings under about 50 m.

## Limits

Copied from the `vegetation_loss` card's `cannot_tell`:

- Who removed the vegetation, or whether it was permitted.
- Which cause it was (clearing, drought, pests, salt or disease); the data shows loss of green cover, not why.
- Selective logging or thinning under an intact canopy, and clearings smaller than about 50 m (0.25 ha).
- Whether dead trees are still standing or have been removed, when greenness alone is used.
- Clearing that has already re-greened with grass, crops or regrowth can look like little or no loss.
- Events before mid-2015 (Sentinel-2 start); Hong Kong-area surface reflectance coverage is thin before 2017.

This version does not use radar.

## Outputs

Blocks: then/now greenness maps (primary), the changed patches, the hectares with less green
cover. Too small or too cloudy: one `limits` block instead.

Findings: `verdict`, `tree_cover_before`, `changed_ha`, `lost_ha`, `greenness`, `moisture`,
`bare` (`before`, `after`, `delta`), `surroundings`, `patches`, and `observed`
(FINDINGS CONVENTION).

## Numbers to quote

Answer with the numbers: hectares with less green cover (`lost_ha`) and the % of the area
(`lost_pct_of_area`); greenness before and after with the actual image dates and their cloud %
(`dates_used`) and the change (`greenness.delta`, `greenness_change_pct`); moisture and bare
ground before and after; the surroundings' change; the number of patches and of clear passes
(`data`).
