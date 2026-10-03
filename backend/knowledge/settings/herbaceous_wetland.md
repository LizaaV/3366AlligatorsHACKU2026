---
id: herbaceous_wetland
type: setting
version: 1
status: draft
name: Herbaceous wetland
aliases: [wetland, marsh, swamp, reed bed, reedbed, floodplain, mudflat edge, bog, 濕地, 沼澤, 草澤, 蘆葦, 蘆葦床, 泥灘]
summary: Grassy or reedy land that is permanently or regularly flooded, so water and greenness swing with the seasons (WorldCover class 90).
worldcover_classes: [90]
detect:
  land_cover_any: [90]
  min_fraction: 0.3
  note: "WorldCover 90 = herbaceous vegetation (cover 10% or more) permanently or regularly flooded; excludes bare sediment (60), swamp forest (10) and mangroves (95). Fish ponds are often mapped as 90 too"
normal:
  - measure: greenness
    typical_min: 0.15
    typical_max: 0.75
    seasonality: "Highest in the growing or wet season; drops when the marsh is flooded (water dilutes the signal) or when reeds brown in winter"
  - measure: water
    typical_min: -0.6
    typical_max: 0.3
    seasonality: "Swings with flooding: positive when standing water shows between plants, negative in dry months; tidal sites change within a day"
  - measure: moisture
    typical_min: -0.1
    typical_max: 0.5
    seasonality: "Stays high while plants and soil are wet; falls in dry season or drought, often before greenness falls"
  - measure: roughness
    typical_min: -22
    typical_max: -4
    seasonality: "Open flood water is dark (about -20 dB); flooded reeds and sedges can be bright (about -8 to -4 dB in VV) through double bounce between stems and water; dry marsh reads like grassland (about -12 to -8 dB)"
  - measure: rain_mm
    seasonality: "Flood extent follows rain and river levels with a lag of days to weeks; in Hong Kong the rainy season is roughly April to October, wettest May to September"
likely_events: [seasonal, water_gain, water_loss, vegetation_loss, vegetation_gain, pond_filling, burn, new_bare_or_built, construction]
pitfalls:
  - "Seasonal flooding moves water and greenness a lot every year; always compare with the same season of earlier years before calling a change."
  - "Tidal wetlands can look flooded or dry depending on the hour of the image; check the tide before reading water change."
  - "Flooded reeds can make radar brighter, not darker, so a rise in roughness does not always mean water was lost."
  - "Winter browning of reeds lowers greenness without any loss of wetland."
  - "WorldCover confuses herbaceous wetland with grassland, cropland, fish ponds and mangroves; check the actual place."
  - "The wet season, when flooding peaks, is also the cloudiest; optical gaps of weeks are common, so lean on radar for flood timing."
  - "In cold climates marshes freeze and are snow-covered in winter, which changes every measure; compare the same season."
  - "Reed and grass fires do happen in wetlands; a sudden dark patch may be a burn that regrows within months."
sources:
  - {title: "ESA WorldCover 10 m 2021 v200 Product User Manual (class definitions)", url: "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/docs/WorldCover_PUM_V2.0.pdf"}
  - {title: "UN-SPIDER Recommended Practice: Flood mapping using Sentinel-1 and Sentinel-2 imagery", url: "https://un-spider.org/es/node/13488"}
  - {title: "USGS - Landsat Normalized Difference Moisture Index", url: "https://www.usgs.gov/landsat-missions/normalized-difference-moisture-index"}
  - {title: "Ramsar Sites Information Service - Mai Po Marshes and Inner Deep Bay", url: "https://rsis.ramsar.org/ris/750"}
  - {title: "McFeeters 1996, The use of the Normalized Difference Water Index (NDWI) in the delineation of open water features, Int. J. Remote Sensing", url: "https://doi.org/10.1080/01431169608948714"}
---

## What it is

Low land covered by grasses, reeds or sedges that is flooded all the time or regularly,
by fresh, brackish or salt water. WorldCover maps it as class 90. In Hong Kong the
best-known example is the reed beds and marshes of Mai Po and Inner Deep Bay.

## What normal looks like

- **Water and greenness move against each other.** When the marsh floods, water (NDWI) rises
  toward or above 0 and greenness drops; when it dries, the reverse.
- **greenness** is usually 0.15 to 0.75, highest in the growing season.
- **moisture** stays fairly high while the ground is wet.
- **roughness** depends on what floods: open water is dark, flooded reeds can be bright.
- These swings repeat each year with the rain, river level or tide.

Real change looks like a patch that stops following the seasonal rhythm: for example, it
stays dry and bare when the rest of the marsh floods (filling, building), or stays flooded
all year.

## Pitfalls

- Seasonal flooding is the main look-alike; compare the same months across years.
- Tide height changes the picture within hours.
- Flooded reeds can raise radar brightness.
- Winter browning is not loss.
- WorldCover mixes this class with grassland, fish ponds and mangroves.
- Cloud is worst in the flood season; use radar for timing.
