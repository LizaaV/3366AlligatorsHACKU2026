---
id: pond-filling-check
version: 1
status: draft
name: Pond filling check
summary: Checks whether fishponds or a wetland that held water have been filled in, and weighs normal drain-down, water loss, construction and new bare ground against it.
tests_events: [pond_filling]
considers: [seasonal, water_loss, construction, new_bare_or_built]
params:
  area:
    type: area
    auto: true
    required: true
    max_km2: 25
    description: The outline of the ponds (GeoJSON), set by the harness from the run.
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
    description: Years of monthly history to scan for the change date and the usual range.
  before:
    type: date
    default: null
    description: Earlier date to compare; default two years before `after`.
  after:
    type: date
    default: null
    description: Later date to compare; default the latest clear scene.
  answers:
    type: object
    default: null
    description: The user's clarification answers (e.g. use, watching_for); not used for scoring.
needs: [optical, land_cover]
outputs: [then_now, timeline, highlight, stat, hypotheses, scene_strip, limits]
timeout_s: 120
---

## What it does

Checks one group of fishponds or a wetland for signs that it was filled in. It reads, inside
the outline and in the ring around it (Sentinel-2, optical only):

- monthly water, bare-ground and greenness readings over `years`, with the usual range for
  each month, to find when the change started and whether it lasted;
- water, bare ground and moisture on two dates (`before`, `after`) and the hectares that
  changed;
- whether the change is local (inside the ponds only) or regional (the surroundings too).

Code then scores the `pond_filling` card and its look-alikes (`seasonal`, `water_loss`,
`construction`, `new_bare_or_built`) from the card signs and returns the ranked table.

## When to use it

- "Have these fishponds been filled in?", "Is this wetland being filled?", "填塘", "倒泥頭".
- A pond or wetland that held water now looks dry or bare and the user wants to know if it
  is fill or a normal drain-down.

Not for ponds narrower than about 50 m, for land that was never water (use `run_code` with
the `new_bare_or_built` card), or for floods (`water_gain`).

## Limits

Copied from the `pond_filling` card's `cannot_tell`:

- Who did the filling, why, and whether it was permitted cannot be known from satellite images.
- A pond drained and left empty for months looks like a filled pond in both optical and radar images; only persistence across many dates, including the wet season, separates them.
- The kind, thickness or depth of material cannot be measured at 10 m.
- Ponds narrower than about 50 m, filling along one bund, or partial filling of under about a quarter of the pond may be missed; edge pixels mix bund and water.
- Turbid, algal or plant-covered ponds can start with NDWI near or below 0, so the before image may not show clear open water.
- A pond abandoned and left to dry and overgrow can look like old fill after a few months.
- Conversion to farmland or reshaping into shrimp ponds changes the same measures without filling.
- In tidal areas (gei wai, mangrove edges, coast) the tide changes water and radar; compare images at similar tide.
- Wet-season cloud can hide optical images for weeks; wind on a pond can briefly brighten radar, so use several radar dates.

This version does not use radar (`roughness`), so radar signs count as not measured.

## Outputs

Blocks: then/now water maps (primary), the water timeline with the surroundings and the
change date, the changed patches, the changed hectares, the ranked hypotheses table and the
recent passes. Too small or too cloudy: one `limits` block instead.

Findings: `water`, `bare`, `moisture` (`before`, `after`, `delta`), `greenness` (`before`,
`after`), `changed_ha`, `change_date`, `change_dates`, `local_vs_regional`, `persistence`,
`verdicts`, `top_hypothesis`, `confidence`. The harness maps them to `findings["observed"]`
(FINDINGS CONVENTION) before scoring.
