---
id: heat-check
version: 1
status: draft
name: Heat check
summary: Checks whether the ground inside an area is hotter than its surroundings, from Landsat surface temperature over the recent clear passes.
tests_events: [construction]
considers: [new_bare_or_built, vegetation_loss]
params:
  area:
    type: area
    auto: true
    required: true
    max_km2: 25
    description: The outline of the area (GeoJSON), set by the harness.
  name:
    type: string
    auto: true
    default: null
    description: Place name used in titles, set by the harness.
  years:
    type: int
    default: 2
    min: 1
    max: 3
    description: Years of monthly Landsat passes to read.
  passes:
    type: int
    default: 6
    min: 3
    max: 12
    description: How many recent months with a clear pass over both the area and the ring to average.
  answers:
    type: object
    default: null
    description: The user's clarification answers; not used for scoring.
needs: [thermal]
outputs: [stat, timeline, limits]
timeout_s: 120
---

## What it does

Reads Landsat 8/9 surface temperature (`heat`, °C) once a month over `years`, inside the
outline and in the ring around it, pairs the months that have a clear pass over both, and
averages the difference over the last `passes` of them. Hotter means at least 2 °C warmer
on average and more than 1 °C warmer in at least 70% of the passes.

## When to use it

- "Is this area hotter than its surroundings?", "Is this estate an urban heat island?",
  "Did paving this site make it hotter?", "呢度係咪特別熱?".

Not for air temperature, single buildings, or areas under about 10 ha (the thermal band is
100 m).

## Limits

- Landsat measures the temperature of the surface (roofs, roads, ground, plants) at about 10:30 local time on clear days, not the air temperature people feel.
- The thermal band is 100 m (delivered on a 30 m grid): areas under about 10 ha mix with their surroundings.
- Passes are about 8 days apart and many are cloudy, so some months have no reading; cloud edges can leave cool pixels.
- From the `construction` card: paved and roofed surfaces are warmer by day than the vegetation or water they replaced; only useful for footprints larger than about 200 m.
- What makes a place hotter (materials, missing trees, machinery) cannot be told from the temperature alone.

## Outputs

Blocks: the average difference inside minus around (primary stat, with the range over the
passes), the monthly temperature timeline with the surroundings. Too small or too cloudy: one
`limits` block instead.

Findings: `verdict`, `gap_c`, `gaps_c`, `passes`, `warmer_passes`, `early_gap_c`, `latest`,
`heat`, and `observed.heat` (FINDINGS CONVENTION).

## Numbers to quote

Answer with the numbers: the average difference inside minus around in °C (`gap_c`) and its
range over the passes (`gaps_c`), how many passes were warmer (`warmer_passes` of `passes`),
the average temperatures inside and around (`inside_mean_c`, `around_mean_c`), the latest
pass with its date (`latest`), the date span (`dates_used`) and the number of monthly passes
read (`data`). Say it is surface temperature at about 10:30, not air temperature.
