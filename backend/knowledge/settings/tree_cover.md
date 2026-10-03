---
id: tree_cover
type: setting
version: 1
status: draft
name: Tree cover
aliases: [forest, woodland, woods, trees, jungle, rainforest, plantation, secondary forest, 森林, 樹林, 樹木, 林地, 風水林]
summary: Land dominated by trees (10% canopy cover or more), including plantations and freshwater swamp forest; in Hong Kong mostly evergreen secondary forest on hillsides and in valleys.
worldcover_classes: [10]
detect:
  land_cover_any: [10]
  min_fraction: 0.5
  note: "WorldCover 10 = trees with >= 10% cover, any understorey; includes plantations and freshwater-flooded forest, but mangroves are 95. Open woodland near the 10% limit can be mapped as shrubland (20) or grassland (30)."
normal:
  - {measure: greenness, typical_min: 0.55, typical_max: 0.9, seasonality: "Evergreen subtropical/tropical forest (Hong Kong) stays 0.7-0.85 all year with a small dip in the dry winter. Temperate deciduous forest falls to 0.3-0.5 in leaf-off winter and rises sharply at spring leaf-out; that winter value is below this range and is normal there."}
  - {measure: moisture, typical_min: 0.15, typical_max: 0.5, seasonality: "High under a closed canopy; dips in long dry seasons and drops before greenness in drought."}
  - {measure: water, typical_min: -0.8, typical_max: -0.45, seasonality: "Strongly negative under a canopy (NIR far above green). Stays negative even in swamp forest because the canopy hides the water."}
  - {measure: bare, typical_min: -0.5, typical_max: -0.15, seasonality: "Low under canopy; it is the mirror of moisture (same two bands), so it rises in dry spells and in leaf-off winter."}
  - {measure: roughness, typical_min: -11, typical_max: -5, seasonality: "Volume scattering keeps VV fairly steady, around -6 to -8 dB in dense forest and lower (-8 to -11 dB) in open woodland; rain during or just before acquisition can shift it by about 1 dB, and frozen or snow-loaded canopy in winter lowers it. Changes > 3 dB are unusual here."}
likely_events: [seasonal, vegetation_loss, vegetation_gain, burn, landslide, construction, new_bare_or_built]
pitfalls:
  - "Deciduous forests lose most greenness every autumn; compare with the same weeks of earlier years before calling a loss."
  - "Cloud and cloud shadow are frequent over hilly forest (Hong Kong spring and summer); a single low-greenness image is often a shadow or haze, not a clearing."
  - "Terrain shadow on steep slopes facing away from the sun (north-facing in the northern hemisphere) lowers greenness and raises noise in winter when the sun is low; check slope_deg."
  - "Radar has its own geometry problems on steep hillsides: slopes facing the satellite look bright (foreshortening, layover) and slopes facing away look dark (radar shadow), whatever the season. Compare only images from the same orbit direction and track."
  - "Snow on or under the canopy (temperate and boreal forest) lowers greenness and raises water; exclude snowy dates."
  - "Radar over forest saturates: it barely changes when a forest thins or regrows, and even a clear-cut may change VV by only 1-3 dB at first (felled logs and debris can keep it bright), so a stable roughness does not prove nothing happened."
  - "Clearings smaller than about 2-3 pixels (20-30 m) are below what 10 m data can confirm."
  - "Plantation felling and replanting is a normal forestry cycle; describe the change, do not imply it is illegal."
sources:
  - {title: "ESA WorldCover 2021 v200 Product User Manual", url: "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/docs/WorldCover_PUM_V2.0.pdf"}
  - {title: "USGS, NDVI, the Foundation for Remote Sensing Phenology", url: "https://www.usgs.gov/special-topics/remote-sensing-phenology/science/ndvi-foundation-remote-sensing-phenology"}
  - {title: "USGS, Normalized Difference Moisture Index", url: "https://www.usgs.gov/landsat-missions/normalized-difference-moisture-index"}
  - {title: "Arellano et al. 2019, Multi-temporal analysis of dense and sparse forests' radar backscatter using Sentinel-1A collection in Google Earth Engine (ISPRS Archives)", url: "https://isprs-archives.copernicus.org/articles/XLII-4-W19/23/2019/"}
  - {title: "Doblas et al. 2020, Assessment of Rainfall Influence on Sentinel-1 Time Series on Amazonian Tropical Forests Aiming Deforestation Detection Improvement (ISPRS Archives)", url: "https://isprs-archives.copernicus.org/articles/XLII-3-W12-2020/493/2020/"}
---

## What it is
Any area where trees cover at least a tenth of the ground, by the ESA WorldCover definition. It includes natural forest, secondary forest, plantations (oil palm, rubber, eucalyptus) and freshwater swamp forest; mangroves have their own setting. In Hong Kong this is mostly evergreen secondary forest that has regrown on hillsides since the 1950s, plus village fung shui woods.

## What normal looks like
- **Greenness** is high: 0.7-0.85 for evergreen forest all year. Deciduous forest drops to 0.3-0.5 in winter and recovers in spring; that is seasonal, not loss.
- **Moisture** is high and falls first when a drought starts.
- **Water** is strongly negative; **bare** is low and mirrors moisture.
- **Roughness** (radar) is steady around -6 to -8 dB and barely moves with season.
- Judge "normal" against the same months in earlier years, and against the forest ring around the outline.

## Pitfalls
- Leaf-off, snow, cloud, haze and terrain shadow all look like greenness loss on a single image.
- Radar saturates over dense canopy: it misses thinning and regrowth, and even fresh clearings may move VV by only 1-3 dB. On steep slopes radar layover and shadow depend on orbit, so compare like with like.
- Very small gaps (single trees, narrow paths) are below 10 m resolution.
- Felling in plantations is routine; use neutral "consistent with" wording.
