---
id: mangroves
type: setting
version: 1
status: draft
name: Mangroves
aliases: [mangrove, mangrove forest, mangrove swamp, tidal forest, intertidal forest, 紅樹林, 紅樹, 米埔紅樹林]
summary: Salt-tolerant trees and shrubs in the intertidal zone of sheltered tropical and subtropical coasts; the tide moves water under the canopy, so readings depend on tide height at image time.
worldcover_classes: [95]
detect:
  land_cover_any: [95]
  min_fraction: 0.2
  note: "WorldCover 95, guided by Global Mangrove Watch. Stands are often narrow fringes along creeks and shores, so a low fraction of the area is normal. Hong Kong examples: Mai Po and Deep Bay, Tung Chung and Tai O (Lantau), Sai Kung inlets."
normal:
  - {measure: greenness, typical_min: 0.35, typical_max: 0.85, seasonality: "Evergreen; interior canopy 0.6-0.85 with little seasonal change. Edge pixels and low or sparse stands drop toward 0.3-0.5 at high tide because water under or over the canopy darkens NIR."}
  - {measure: moisture, typical_min: 0.1, typical_max: 0.5, seasonality: "High and fairly steady; higher when the floor is flooded."}
  - {measure: water, typical_min: -0.65, typical_max: -0.1, seasonality: "Negative under a closed canopy, but rises toward or above 0 on fringe pixels at high tide. A single high-tide image is not water gain."}
  - {measure: bare, typical_min: -0.5, typical_max: -0.1, seasonality: "Low; rises on fringes at low tide when mudflat is exposed."}
  - {measure: roughness, typical_min: -12, typical_max: -4, seasonality: "Usually similar to inland forest (about -9 to -6 dB). Flooding under sparse or short stands can add 1-3 dB through double bounce between water and trunks; this effect is strongest in HH and weaker in Sentinel-1 VV, so tide-driven changes of a few dB are possible on fringes. Calm open water nearby is far darker (-18 to -25 dB)."}
  - {measure: elevation_m, typical_min: -3, typical_max: 15, seasonality: "Static. Mangroves grow near mean sea level; the Copernicus DEM is a surface model, so values include part of the canopy height, and coastal pixels can read slightly below 0 from DEM noise and the geoid reference."}
likely_events: [seasonal, vegetation_loss, vegetation_gain, water_gain, new_bare_or_built, construction, pond_filling]
pitfalls:
  - "Tide height at image time changes greenness, water and radar on fringe pixels; compare images at similar tide or use many dates, and never call a single high-tide image a loss or a flood."
  - "Mudflat, open water and mangrove mix inside 10 m pixels along creeks; fringe pixels are unreliable for small changes."
  - "Mangroves expand slowly onto mudflats (vegetation_gain) and can die back after storms or cold spells; both are gradual and need several dates."
  - "Typhoon damage (defoliation) lowers greenness suddenly but often recovers within months."
  - "Conversion to ponds or reclamation is a sensitive topic; describe the change with 'consistent with' wording and never imply who did it."
  - "Cloud is frequent over tropical coasts; radar helps but is affected by the tide too."
  - "Sun glint on nearby water and wet mudflat brightens visible bands and can distort water and greenness on fringe pixels; drop glinted dates."
sources:
  - {title: "ESA WorldCover 2021 v200 Product User Manual", url: "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/docs/WorldCover_PUM_V2.0.pdf"}
  - {title: "Global Mangrove Watch", url: "https://www.globalmangrovewatch.org/"}
  - {title: "Jia et al. 2019, A New Vegetation Index to Detect Periodically Submerged Mangrove Forest Using Single-Tide Sentinel-2 Imagery (Remote Sensing 11(17), 2043)", url: "https://doi.org/10.3390/rs11172043"}
  - {title: "USGS, NDVI, the Foundation for Remote Sensing Phenology", url: "https://www.usgs.gov/special-topics/remote-sensing-phenology/science/ndvi-foundation-remote-sensing-phenology"}
---

## What it is
Forests and shrubs of salt-tolerant trees that grow between low and high tide on sheltered tropical and subtropical shores, estuaries and creeks. In Hong Kong the largest stand is at Mai Po and Deep Bay; smaller ones line Lantau (Tung Chung, Tai O) and Sai Kung inlets.

## What normal looks like
- **Greenness** is high and steady in the interior (0.6-0.85), lower on fringes, and lower at high tide.
- **Moisture** is high; **bare** is low except where mudflat shows at low tide.
- **Water** is negative under the canopy but can reach 0 on flooded fringes at high tide.
- **Roughness** (radar) is similar to inland forest; on flooded fringes double bounce between water and trunks can brighten it a little, so it changes with the tide.
- Normal must be judged at a similar tide and season, or over many dates.

## Pitfalls
- The tide is the biggest source of false change: flooded canopy edges look like water gain or vegetation loss.
- Narrow fringes mix with mudflat and water at 10 m; sun glint on nearby water can distort fringe pixels.
- Typhoons can strip leaves temporarily; wait for later images before calling loss.
- Use neutral wording for any change near ponds or reclamation.
