---
id: shrubland
type: setting
version: 1
status: draft
name: Shrubland
aliases: [scrub, scrubland, bush, brush, heath, maquis, chaparral, shrubs, 灌木, 灌叢, 灌木林, 矮樹叢]
summary: Land dominated by natural woody shrubs under 5 m tall, with scattered trees under 10% cover; in Hong Kong typical of hill slopes recovering from past fires.
worldcover_classes: [20]
detect:
  land_cover_any: [20]
  min_fraction: 0.4
  note: "WorldCover 20 = natural shrubs >= 10% cover, < 5 m tall, trees < 10%. This is one of the least accurate WorldCover classes; it is often confused with tree cover (10) and grassland (30), so treat the label as a hint."
normal:
  - {measure: greenness, typical_min: 0.15, typical_max: 0.75, seasonality: "Humid evergreen scrub (Hong Kong hillsides) 0.5-0.75, lowest late in the dry winter. Dry Mediterranean or semi-arid shrubland 0.15-0.4, peaking after the rainy season; very open desert scrub can sit near 0.1-0.15 most of the year."}
  - {measure: moisture, typical_min: -0.15, typical_max: 0.35, seasonality: "Falls through the dry season and before greenness in drought; recovers within weeks of rain."}
  - {measure: water, typical_min: -0.7, typical_max: -0.3, seasonality: "Always negative (land); less negative where cover is sparse."}
  - {measure: bare, typical_min: -0.35, typical_max: 0.15, seasonality: "Mirror of moisture; higher where soil or rock shows between shrubs and in the dry season."}
  - {measure: roughness, typical_min: -14, typical_max: -7, seasonality: "Between forest and grassland; rises 1-2 dB when soil is wet after rain. Changes > 3 dB need a reason."}
likely_events: [seasonal, burn, vegetation_loss, vegetation_gain, landslide, new_bare_or_built, construction]
pitfalls:
  - "Hill fires are common in Hong Kong shrubland in the dry season (October-April, peaks around Ching Ming and Chung Yeung); a sudden local drop often fits burn, but needs the burn signs."
  - "Dry-season browning is normal and gradual; compare with the same months in earlier years."
  - "Mixed pixels: soil and rock between shrubs make values vary a lot from place to place, so compare with the surrounding ring rather than a fixed number."
  - "Regrowth after fire raises greenness for several years; that is vegetation_gain or recovery, not something new."
  - "WorldCover often mislabels shrubland as tree cover or grassland; the land_cover hint may be wrong."
  - "Hong Kong shrubland sits on steep slopes: cloud and cloud shadow are frequent from spring to summer, and radar layover and shadow make roughness unreliable on slopes facing toward or away from the satellite; use the same orbit direction and check slope_deg."
sources:
  - {title: "ESA WorldCover 2021 v200 Product User Manual", url: "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/docs/WorldCover_PUM_V2.0.pdf"}
  - {title: "Digital Earth Africa, ESA WorldCover specification (class accuracy notes)", url: "https://docs.digitalearthafrica.org/en/latest/data_specs/ESA_WorldCover_specs.html"}
  - {title: "USGS, NDVI, the Foundation for Remote Sensing Phenology", url: "https://www.usgs.gov/special-topics/remote-sensing-phenology/science/ndvi-foundation-remote-sensing-phenology"}
  - {title: "USGS, Normalized Difference Moisture Index", url: "https://www.usgs.gov/landsat-missions/normalized-difference-moisture-index"}
  - {title: "Arellano et al. 2019, Multi-temporal analysis of dense and sparse forests' radar backscatter using Sentinel-1A collection in Google Earth Engine (ISPRS Archives)", url: "https://isprs-archives.copernicus.org/articles/XLII-4-W19/23/2019/"}
---

## What it is
Land covered mainly by woody shrubs less than 5 m tall, with few trees (under 10% cover). Examples: Mediterranean maquis, heath, dry bush. In Hong Kong, shrubland covers many hill slopes in the country parks, often a stage of recovery between grassland and forest after past fires.

## What normal looks like
- **Greenness** is moderate: 0.5-0.75 for humid evergreen scrub, 0.2-0.4 for dry shrubland, with a seasonal low in the dry season.
- **Moisture** falls in the dry season and recovers after rain; **bare** mirrors it.
- **Water** is always negative.
- **Roughness** (radar) sits between forest and grassland and moves a little with soil wetness.
- Patchiness is normal: soil and rock between shrubs make neighbouring pixels differ.

## Pitfalls
- Dry-season browning is expected; a sudden local scar in the dry season may be a hill fire, which must be shown by burn signs.
- Values vary with how much soil shows; compare against the surrounding ring and earlier years.
- WorldCover's shrubland label is one of its least reliable classes.
- On steep slopes, cloud shadow and radar layover or shadow can fake a change.
