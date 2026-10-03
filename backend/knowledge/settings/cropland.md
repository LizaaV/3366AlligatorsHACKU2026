---
id: cropland
type: setting
version: 1
status: draft
name: Cropland
aliases: [farmland, fields, agricultural land, crops, paddy, rice fields, orchard plots, vegetable farms, 農田, 田地, 耕地, 菜田, 稻田]
summary: Land planted with annual crops that are sown, grow, are harvested and often left bare, so its look changes strongly within one year.
worldcover_classes: [40]
detect:
  land_cover_any: [40]
  min_fraction: 0.5
  note: "WorldCover 40 = annual cropland. Perennial orchards and plantations are usually mapped as tree cover (10); fallow plots can fall into grassland (30). Hong Kong has few fields, mostly small plots in the northern New Territories that 10 m pixels mix with houses and ponds."
normal:
  - {measure: greenness, typical_min: 0.0, typical_max: 0.85, seasonality: "Bare or stubble fields 0.1-0.25 after harvest or ploughing; flooded paddies at transplanting near 0-0.2; peak growth 0.6-0.85. One cycle per crop: single-crop areas have one peak a year, double/triple-crop rice areas (South China, Mekong) two or three peaks."}
  - {measure: moisture, typical_min: -0.3, typical_max: 0.5, seasonality: "Follows the crop cycle and irrigation; drops in dry spells before greenness does. Bare dry soil -0.3 to 0; closed crop canopy 0.2-0.5. Over flooded paddies the value is erratic (water is dark in both bands), so do not read it as crop vigour."}
  - {measure: water, typical_min: -0.7, typical_max: 0.2, seasonality: "Usually below 0 (land). Paddies flooded at planting can briefly rise near or above 0 for a few weeks; this is normal, not a flood."}
  - {measure: bare, typical_min: -0.5, typical_max: 0.3, seasonality: "Uses the same two bands as moisture with the sign flipped, so it mirrors moisture exactly. Rises to about 0-0.3 after harvest and ploughing when dry soil is exposed; falls to -0.2 to -0.5 as the canopy closes."}
  - {measure: roughness, typical_min: -22, typical_max: -6, seasonality: "Mostly -15 to -7 dB, changing with crop height, ploughing and soil wetness (freshly ploughed or rain-wetted soil is brighter). Flooded paddies drop sharply to about -18 to -22 dB at planting, then recover as the crop grows. Swings of 3 dB or more within a season are normal here, so the generic 3 dB change rule is weak evidence on cropland."}
  - {measure: slope_deg, typical_min: 0, typical_max: 8, seasonality: "Static. Terraced hillside farming can be steeper."}
likely_events: [seasonal, harvest, vegetation_loss, vegetation_gain, water_gain, new_bare_or_built, construction, burn, landslide]
pitfalls:
  - "A sharp greenness drop over a whole field is usually harvest, not damage; compare with the same weeks in earlier years before suggesting anything else."
  - "Neighbouring fields are on different calendars, so a field that differs from its ring is not by itself unusual."
  - "Paddy flooding at planting looks like water gain; check timing against the local planting season and the rain record."
  - "Stubble burning after harvest is common in some regions; it is a burn only if the planned burn or fire measures support it."
  - "Small plots (under ~3 pixels across) mix with roads, hedges and houses at 10 m; avoid per-field claims on tiny farms."
  - "Cloud gaps in the monsoon season can hide the whole growth peak; say when the cycle is incomplete."
  - "Greenhouses, net shade houses and plastic mulch are common on Hong Kong farms; they read low greenness and high bare like built land, and WorldCover maps greenhouses as built-up (50), not cropland."
  - "Abandoned farmland is widespread in the New Territories; fields slowly going to grass or shrub show vegetation gain and the loss of the yearly cycle, not a sudden event."
sources:
  - {title: "ESA WorldCover 2021 v200 Product User Manual", url: "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/docs/WorldCover_PUM_V2.0.pdf"}
  - {title: "USGS, NDVI, the Foundation for Remote Sensing Phenology", url: "https://www.usgs.gov/special-topics/remote-sensing-phenology/science/ndvi-foundation-remote-sensing-phenology"}
  - {title: "Gao 1996, NDWI - A normalized difference water index for remote sensing of vegetation liquid water from space (Remote Sensing of Environment)", url: "https://doi.org/10.1016/S0034-4257(96)00067-3"}
  - {title: "Xiao et al. 2005, Mapping paddy rice agriculture in southern China using multi-temporal MODIS images (Remote Sensing of Environment)", url: "https://doi.org/10.1016/j.rse.2004.12.009"}
---

## What it is
Fields of annual crops: rice, vegetables, cereals and similar. The defining trait is a yearly (or faster) cycle of planting, growth, harvest and bare soil. In Hong Kong this is mainly small vegetable plots in the northern New Territories; in the wider region it includes large double-crop rice areas.

## What normal looks like
- **Greenness** swings from near bare (0.1-0.25) to dense (0.6-0.85) and back within months. A drop at harvest time is the expected shape.
- **Moisture** tracks the crop and irrigation, falling ahead of greenness in dry spells.
- **Water** stays negative, except for a few weeks when paddies are flooded for planting.
- **Bare** rises after harvest or ploughing and falls as the crop grows.
- **Roughness** (radar) moves several dB through the season with crop height and soil wetness, and drops strongly over flooded paddies.
- Always judge "normal" against the same weeks in previous years, not against the previous image.

## Pitfalls
- Harvest is the most common reason a field turns brown; call it seasonal or harvest before anything else, and only suggest vegetation_loss or new_bare_or_built if the field stays bare across the next growing season.
- Flooded paddies are not floods; check the calendar and rainfall. Radar also drops several dB over flooded paddies, which is normal.
- Adjacent fields can be weeks apart in their cycles.
- Small plots mix with other land at 10 m; keep claims at the level of the area, not the single plot.
- Monsoon clouds can hide the growth peak; say so when the timeline has gaps.
- Greenhouses and plastic covers look like built land in the indices; check before suggesting construction.
