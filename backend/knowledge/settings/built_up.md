---
id: built_up
type: setting
version: 1
status: draft
name: Built-up area
aliases: [city, town, urban area, buildings, village, housing estate, industrial area, port, 市區, 城市, 建成區, 屋邨, 村屋, 工業區]
summary: Land covered by buildings, roads and other hard surfaces, where low greenness is normal and the look changes little through the year.
worldcover_classes: [50]
detect:
  land_cover_any: [50]
  min_fraction: 0.5
  note: "WorldCover 50 = buildings, roads, railways and other man-made structures; greenhouses are included. Urban green (parks, sports fields) is excluded and often mapped as tree cover (10) or grassland (30); waste dumps and extraction sites are mapped as bare (60), not 50."
normal:
  - {measure: greenness, typical_min: 0.0, typical_max: 0.3, seasonality: "Little seasonal change. Pixels with street trees or small parks reach 0.4-0.7 and follow the trees' cycle; rooftops and roads stay near 0-0.2."}
  - {measure: moisture, typical_min: -0.25, typical_max: 0.2, seasonality: "Low and fairly steady; mirror image of bare (same bands, sign flipped). Pixels mixed with trees reach 0.1-0.3; wet surfaces after heavy rain raise it briefly."}
  - {measure: water, typical_min: -0.5, typical_max: 0.1, seasonality: "Mostly -0.4 to 0. This index is known to give near-zero or slightly positive values over many built surfaces (dark roofs, asphalt, shadows, wet roads) without any open water, so a value just above 0 here is not water."}
  - {measure: bare, typical_min: -0.2, typical_max: 0.25, seasonality: "Around -0.1 to 0.2 and steady; varies a lot with roof material (metal, dark and some concrete roofs read lower than expected) and is often lower than nearby bare soil, so bare alone does not separate built from bare."}
  - {measure: roughness, typical_min: -12, typical_max: 5, seasonality: "High and stable year-round because walls and ground form corner reflectors (double bounce); very bright points above 0 dB are common in dense districts, low-rise villages sit near -12 to -6 dB. Wide roads, car parks, airport aprons and flat plazas are smooth and read dark (-15 dB or lower). Depends strongly on building orientation and orbit direction."}
  - {measure: slope_deg, typical_min: 0, typical_max: 15, seasonality: "Static. Hong Kong districts on hillsides are steeper."}
likely_events: [construction, new_bare_or_built, vegetation_loss, vegetation_gain, seasonal, water_gain]
pitfalls:
  - "Low greenness is normal here; never treat it as vegetation loss on its own."
  - "Tall buildings cast long shadows that change with sun angle through the year; shadows lower all reflectance and can mimic water or moisture changes."
  - "Small parks, street trees and green roofs are below or near the 10 m pixel size and mix with buildings; their seasonal cycle is real but small."
  - "Radar brightness depends on building orientation and look direction; only compare images from the same orbit direction."
  - "Tall buildings and steep hillsides in Hong Kong cause radar layover (roofs displaced toward the satellite) and radar shadow behind them; a bright or dark radar patch may be displaced from the building that causes it."
  - "Persistent cloud and haze limit clear Sentinel-2 views in the wet season; radar is the main through-cloud signal here."
  - "Change inside a city is usually rebuilding of an already built site; 'new built-up' claims need a before image that shows vegetation, water or bare ground."
  - "Wording must stay neutral: say a change is 'consistent with construction', never who did it or whether it was permitted."
sources:
  - {title: "ESA WorldCover 2021 v200 Product User Manual", url: "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/docs/WorldCover_PUM_V2.0.pdf"}
  - {title: "Zha, Gao and Ni 2003, Use of normalized difference built-up index in automatically mapping urban areas from TM imagery (International Journal of Remote Sensing)", url: "https://doi.org/10.1080/01431160304987"}
  - {title: "Copernicus SentiWiki, S1 Applications", url: "https://sentiwiki.copernicus.eu/web/s1-applications"}
  - {title: "USGS, Landsat Normalized Difference Vegetation Index", url: "https://www.usgs.gov/landsat-missions/landsat-normalized-difference-vegetation-index"}
---

## What it is
Towns, cities, villages, ports and industrial sites: land dominated by roofs, roads and paved surfaces. In Hong Kong this ranges from dense high-rise districts to village houses in the New Territories and container terminals.

## What normal looks like
- **Greenness** is low (0-0.3) and nearly flat through the year. Pixels with trees or parks are higher and follow a mild seasonal cycle.
- **Moisture** and **water** are low and steady; brief rises after heavy rain are normal.
- **Bare** is moderate to high and steady, but varies with roof material.
- **Roughness** (radar) is high and stable because buildings reflect strongly back to the satellite; it is the most reliable "built" signal and works through cloud.
- Real change is usually a single step (demolition, new building), not a seasonal swing.

## Pitfalls
- Do not read low greenness as damage; it is the baseline.
- Shadows from tall buildings change with the season and can mimic water or darkening.
- Small green spaces mix with buildings at 10 m.
- Compare radar images from the same orbit direction only; tall buildings and hillsides displace and shadow the radar signal.
- A water value slightly above 0 over roofs or roads is not open water.
- Most urban change is rebuilding on already built land.
- Use neutral wording ("consistent with construction"); never imply who or whether it was legal.
