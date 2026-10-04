---
id: new-building-check
version: 1
status: draft
name: New building check
summary: Checks whether anything has been built or cleared to bare ground since a date (default the same month of 2022), with radar roughness when available.
tests_events: [construction, new_bare_or_built]
considers: [vegetation_loss, seasonal]
params:
  area:
    type: area
    auto: true
    required: true
    max_km2: 25
    description: The outline of the site (GeoJSON), set by the harness.
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
needs: [optical, radar]
outputs: [then_now, highlight, stat, limits]
timeout_s: 120
---

## What it does

Compares the site on two dates (`before`, default the same month of 2022, and `after`,
default the latest clear image):

- bare ground (NDBI, Sentinel-2) inside the outline and in the ring around it, and the
  hectares that changed (the changed patches);
- greenness, to see whether vegetation was replaced;
- radar roughness (Sentinel-1 VV) when radar is available: new structures raise it by
  more than about 3 dB.

## When to use it

- "Has anything been built here since 2022?", "Is this a new construction site?", "Has this
  field been paved?", "呢度係咪起咗嘢?".

Not for ponds or wetlands being filled (use `pond-filling-check`) or for single houses under
about 50 m across.

## Limits

Copied from the `construction` card's `cannot_tell`:

- What is being built, who is building it, or whether it has permission; only the change in surface is visible.
- Interior works, renovation, or building on top of an already built site where the surface stays concrete.
- Structures or plots smaller than about 50 m across, such as single village houses, footpaths, huts or narrow road widening.
- Whether bare, hard ground is a building site or open storage, a container yard, a car park or a temporary works area; these look the same from space.
- Works hidden under tree canopy, or slopes covered by netting or hydroseeding.

## Outputs

Blocks: then/now bare-ground maps (primary), the changed patches, the hectares of new bare or
built ground. Too small or too cloudy: one `limits` block instead.

Findings: `verdict`, `changed_ha`, `built_ha`, `bare`, `greenness`, `roughness` (`before`,
`after`, `delta`; null without radar), `radar_used`, `surroundings`, `patches`, and
`observed` (FINDINGS CONVENTION).

## Numbers to quote

Answer with the numbers: hectares of new bare or built ground (`built_ha`) and the % of the
area (`built_pct_of_area`); the bare-ground index and greenness before and after with the
actual image dates and cloud % (`dates_used`); the radar roughness change in dB, or that radar
was not used; the surroundings' change; the number of patches and of clear passes (`data`).
