---
id: grassland
type: setting
version: 1
status: draft
name: Grassland
aliases: [grass, meadow, prairie, steppe, savanna, savannah, pasture, rangeland, hillside grass, 草地, 草原, 草坡, 牧場]
summary: Land dominated by natural grasses and other herbaceous plants, with trees and shrubs under 10% cover; greenness follows rain and season closely.
worldcover_classes: [30]
detect:
  land_cover_any: [30]
  min_fraction: 0.4
  note: "WorldCover 30 = natural herbaceous cover >= 10%, woody plants < 10%; includes pastures, savannas and uncultivated cropland. Hong Kong examples are upland grass on ridges (e.g. Tai Mo Shan, Sunset Peak), often kept open by repeated hill fires."
normal:
  - {measure: greenness, typical_min: 0.15, typical_max: 0.8, seasonality: "Strongest seasonal swing of the natural classes: 0.15-0.35 when dry or dormant, 0.5-0.8 at the wet-season or summer peak. In Hong Kong upland grass browns in the dry winter and greens from about April-May."}
  - {measure: moisture, typical_min: -0.3, typical_max: 0.3, seasonality: "Tracks rain closely and falls before greenness in dry spells; dry, cured grass reads near or below 0."}
  - {measure: water, typical_min: -0.7, typical_max: -0.2, seasonality: "Negative (land); rises toward 0 when grass is dry and sparse, and above 0 only where grassland floods or is under snow."}
  - {measure: bare, typical_min: -0.3, typical_max: 0.3, seasonality: "Mirror of moisture; rises in the dry season when grass cures and soil shows."}
  - {measure: roughness, typical_min: -17, typical_max: -9, seasonality: "Lower than forest; changes with soil wetness and grass height. Rain or a wet soil can raise VV by 2-3 dB within days, so changes near 3 dB are common."}
  - {measure: rain_mm, seasonality: "Greenness usually lags rain by 2-6 weeks; compare the season's rain with earlier years before calling a drought or a loss."}
likely_events: [seasonal, burn, vegetation_gain, vegetation_loss, harvest, new_bare_or_built, construction, water_gain, landslide]
pitfalls:
  - "Most large greenness drops in grassland are seasonal drying; check the same months in earlier years and the rain record first."
  - "Grass fires are frequent but recover within one growing season, so a scar can vanish between images; say when the gap between images is long."
  - "Mowing, grazing and hay cutting lower greenness sharply on pastures; that is harvest-like management, not damage."
  - "Radar over grass is sensitive to soil moisture, so a roughness jump after rain is not a change of land."
  - "Grassland, shrubland and uncultivated cropland are often confused in WorldCover."
  - "In temperate and high steppe, snow cover drops greenness to about 0 and raises water above 0; exclude snowy dates rather than reading them as loss or flooding."
  - "Dry, cured grass and bare soil look alike in greenness; a low value in the dry season is not bare ground unless bare rises well above the surrounding ring and earlier years."
sources:
  - {title: "ESA WorldCover 2021 v200 Product User Manual", url: "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/docs/WorldCover_PUM_V2.0.pdf"}
  - {title: "USGS, NDVI, the Foundation for Remote Sensing Phenology", url: "https://www.usgs.gov/special-topics/remote-sensing-phenology/science/ndvi-foundation-remote-sensing-phenology"}
  - {title: "USGS, Normalized Difference Moisture Index", url: "https://www.usgs.gov/landsat-missions/normalized-difference-moisture-index"}
  - {title: "Arellano et al. 2019, Multi-temporal analysis of dense and sparse forests' radar backscatter using Sentinel-1A collection in Google Earth Engine (ISPRS Archives)", url: "https://isprs-archives.copernicus.org/articles/XLII-4-W19/23/2019/"}
---

## What it is
Open land where grasses and other non-woody plants dominate and trees and shrubs cover less than a tenth of the ground: prairies, steppes, savannas, pastures and upland grass. In Hong Kong it is mostly hilltop and ridge grassland, kept open by thin soils and repeated hill fires.

## What normal looks like
- **Greenness** swings widely: 0.15-0.35 when dry or dormant, 0.5-0.8 at the green peak. The timing follows rain or temperature.
- **Moisture** follows rain and drops before greenness; **bare** mirrors it and rises when grass cures.
- **Water** stays negative unless the grassland floods.
- **Roughness** (radar) is low and moves with soil wetness, so changes of 2-3 dB after rain are normal.
- A season is only "unusual" when compared with the same weeks of earlier years and with the rain record.

## Pitfalls
- Seasonal drying explains most browning; check rain and earlier years first.
- Fire scars, mowing and grazing all lower greenness quickly and can recover within months.
- Radar responds to wet soil as much as to vegetation.
- Snow in temperate grassland looks like loss or flooding; skip snowy dates.
- WorldCover often mixes grassland with shrubland and fallow cropland.
