---
id: fish_ponds
type: setting
version: 1
status: draft
name: Fish ponds
aliases: [fish pond, fishpond, fish ponds, aquaculture pond, shrimp pond, gei wai, fish farm, pond, 魚塘, 魚塘區, 基圍, 塘, 養魚塘, 蝦塘]
summary: Grids of shallow, bunded aquaculture ponds, such as those around Deep Bay and Yuen Long, that are drained for harvest and refilled.
worldcover_classes: [80, 90]
detect:
  land_cover_any: [80, 90]
  min_fraction: 0.3
  note: "Not a WorldCover class: ponds are usually mapped as permanent water (80) or herbaceous wetland (90). Confirm by a grid of rectangular water bodies tens to hundreds of metres across, separated by thin bunds, at low elevation"
normal:
  - measure: water
    typical_min: -0.1
    typical_max: 0.5
    seasonality: "Positive when ponds are full; turbid or algae-rich ponds sit near 0 to 0.2. A pond drops below 0 for weeks while drained, then returns when refilled"
  - measure: greenness
    typical_min: -0.3
    typical_max: 0.25
    seasonality: "Not a plant signal while full; phytoplankton-rich ponds can be near or above 0. A drained bed may green slightly if weeds grow before refilling"
  - measure: roughness
    typical_min: -25
    typical_max: -15
    seasonality: "Full ponds are very dark; a drained bed may stay dark while its mud is wet and smooth, then brightens by a few dB as it dries and is ploughed; bunds between ponds read like land (about -12 to -5 dB)"
  - measure: bare
    typical_min: -0.5
    typical_max: 0.05
    seasonality: "Low while full; rises somewhat on a drained, sun-dried bed, but less than for fresh fill or rubble"
  - measure: elevation_m
    typical_min: 0
    typical_max: 50
    seasonality: "Fixed; Deep Bay ponds lie a few metres above sea level; inland pond districts elsewhere can sit tens of metres higher. Copernicus DEM is noisy at this scale"
likely_events: [pond_filling, water_loss, seasonal, water_gain, construction, new_bare_or_built, vegetation_gain]
pitfalls:
  - "Drain-down is normal: in Hong Kong ponds are drained for harvest mostly in the dry season (roughly November to March), often one at a time; ponds in the Deep Bay management scheme are drained at least a week a year, and ponds are dried and ploughed every two to three years. A drained pond is temporary, not filling."
  - "To tell drain-down from filling, check later images: a drained pond refills within weeks to months; a filled pond stays dry and its surface turns pale and rough (bare up, roughness up)."
  - "Wet smooth mud in a just-drained pond can stay radar-dark like water; use optical water (NDWI) on a clear date to see the drain-down."
  - "Abandoned ponds often grow over with reeds and grass (greenness up, water down); that is vegetation gain, not filling."
  - "Floating solar panels, covered ponds, aerators and fish cages change optical and radar signals without the pond being filled."
  - "Bunds between ponds are only a few metres wide, so 10 m pixels mix bund and water; measure pond centres, not edges."
  - "Ponds are often smaller than 50 m across; a single pond may be only a handful of pixels."
  - "WorldCover labels ponds as 80 or 90 and may miss small ones; use the rectangular grid pattern to recognise them."
  - "Algae blooms raise greenness and lower NDWI in a full pond without any drying."
  - "Never imply who drained or filled a pond, or that it was illegal; use 'consistent with'."
sources:
  - {title: "ESA WorldCover 10 m 2021 v200 Product User Manual (class definitions)", url: "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/docs/WorldCover_PUM_V2.0.pdf"}
  - {title: "Hong Kong Bird Watching Society - Fishpond operation procedures", url: "https://cms.hkbws.org.hk/cms/en/hkbws/work/habitat-management/fishpond/knowing-fishpond/learn-fishpond/operation-steps-en"}
  - {title: "Hong Kong Bird Watching Society - Deep Bay in a minute (fishpond management agreement, over 600 ha)", url: "https://cms.hkbws.org.hk/cms/en/hkbws/work/monitor/other-monitor/knowing-deep-bay-en"}
  - {title: "Drainage Services Department, Nam Sang Wai - Fishponds", url: "https://dsd.gov.hk/others/NSW/6_Fishponds_e.html"}
  - {title: "Ramsar Sites Information Service - Mai Po Marshes and Inner Deep Bay", url: "https://rsis.ramsar.org/ris/750"}
  - {title: "McFeeters 1996, The use of the Normalized Difference Water Index (NDWI) in the delineation of open water features, Int. J. Remote Sensing", url: "https://doi.org/10.1080/01431169608948714"}
---

## What it is

Shallow ponds dug for fish or shrimp farming, laid out as a grid of rectangles separated by
earth bunds. Around Deep Bay (Yuen Long, San Tin, Nam Sang Wai, Mai Po) they cover about a
thousand hectares (about 1,150 ha across Hong Kong in 2012, per DSD) and are an important feeding ground for waterbirds. WorldCover has no
fish pond class; it usually maps them as water (80) or wetland (90).

## What normal looks like

- **Full ponds**: water (NDWI) above 0, greenness below or near 0, radar very dark.
- **Bunds**: thin land lines between ponds, bright on radar.
- **Harvest drain-down** (mostly in the dry season, roughly November to March in Hong Kong):
  one pond at a time loses its water for days to weeks, shows wet mud, then refills. Ponds are also dried and
  ploughed every two to three years.

Real change looks like a pond that loses its water and never comes back: the surface turns
pale (bare up) and rough on radar, often with truck tracks, while neighbours stay full.

## Pitfalls

- Seasonal drain-down looks like water loss; always check whether the pond refills.
- Bunds and small ponds mix with water at 10 m.
- Algae blooms change greenness and NDWI without drying.
- Abandoned ponds grow over with reeds; that is not filling.
- Just-drained wet mud can stay radar-dark; check optical.
- Wording: describe what is seen, "consistent with" filling; never who or whether legal.
