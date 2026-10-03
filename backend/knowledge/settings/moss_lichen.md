---
id: moss_lichen
type: setting
version: 1
status: draft
name: Moss and lichen
aliases: [tundra, lichen tundra, moss tundra, arctic tundra, alpine tundra, lichen heath, bog moss, 苔原, 凍原, 苔蘚, 地衣]
summary: Land covered mainly by mosses and lichens, typically arctic or alpine tundra, snow-covered most of the year with a short summer growing window.
worldcover_classes: [100]
detect:
  land_cover_any: [100]
  min_fraction: 0.3
  note: "WorldCover 100 = land covered with lichens and/or mosses. A low-accuracy class, often confused with grassland (30) and bare/sparse vegetation (60). Not present in Hong Kong."
normal:
  - {measure: greenness, typical_min: 0.1, typical_max: 0.6, seasonality: "Under snow (often 8-10 months) values near 0 or below. Peak in July-August: lichen-dominated tundra about 0.1-0.35, moss and shrub-moss tundra 0.4-0.6. Lichens have low NDVI, especially when dry."}
  - {measure: moisture, typical_min: -0.2, typical_max: 0.3, seasonality: "Rises in the melt season on wet moss; dry lichen reads low. Snow has very low SWIR reflectance, so snowy pixels read strongly positive (often > 0.5): exclude them, they are not wet vegetation."}
  - {measure: water, typical_min: -0.5, typical_max: -0.1, seasonality: "Negative in summer, but many small ponds and melt pools mix into pixels; snow and ice push it up outside summer."}
  - {measure: bare, typical_min: -0.3, typical_max: 0.2, seasonality: "Mirror of moisture; higher where rock and gravel show between patches."}
  - {measure: roughness, typical_min: -18, typical_max: -9, seasonality: "Low, smooth surface. Frozen ground lowers VV, and wet (melting) snow lowers it by 3 dB or more, so seasonal swings above 3 dB are normal; compare only within the same season."}
likely_events: [seasonal, water_loss]
pitfalls:
  - "Only the short snow-free summer (roughly mid-June to mid-September depending on latitude and altitude, peak July-August) gives usable optical data; compare summer with summer of earlier years."
  - "Sun is low and clouds are frequent at high latitude; few clear images may exist per year, and long shadows on mountain slopes lower greenness. Radar layover and shadow affect steep alpine slopes."
  - "Long-term greening of tundra (shrub expansion) is a known regional trend; a slow greenness rise is not by itself an event."
  - "Thawing permafrost makes ponds appear, drain or slump (thaw slumps); these are real but slow, and hard to tell from seasonal melt water on one date."
  - "Tundra fires leave dark scars that can persist for years; burn needs the burn signs."
  - "WorldCover moss and lichen is one of its least accurate classes."
sources:
  - {title: "ESA WorldCover 2021 v200 Product User Manual", url: "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/docs/WorldCover_PUM_V2.0.pdf"}
  - {title: "Digital Earth Africa, ESA WorldCover specification (class accuracy notes)", url: "https://docs.digitalearthafrica.org/en/latest/data_specs/ESA_WorldCover_specs.html"}
  - {title: "NOAA Arctic Report Card 2022, Tundra Greenness", url: "https://arctic.noaa.gov/report-card/report-card-2022/tundra-greenness/"}
  - {title: "USGS, NDVI, the Foundation for Remote Sensing Phenology", url: "https://www.usgs.gov/special-topics/remote-sensing-phenology/science/ndvi-foundation-remote-sensing-phenology"}
---

## What it is
Ground covered mainly by mosses and lichens, with few vascular plants: arctic tundra, high alpine slopes and some bogs. It is snow-covered for most of the year and grows only in a short summer. There is none in Hong Kong.

## What normal looks like
- **Greenness** is low to moderate and only meaningful in summer: about 0.1-0.35 for lichen tundra and 0.4-0.6 for moss and shrub tundra, peaking in July-August.
- **Moisture** and **bare** depend on how wet the moss is and how much rock shows; snow makes moisture read falsely high.
- **Water** is negative in summer but small ponds and melt pools are common.
- **Roughness** (radar) is low and shifts with freeze, thaw and snow.
- Compare only like seasons: summer with summer of earlier years.

## Pitfalls
- Snow, low sun and cloud leave few clean images; say when data is thin.
- Slow greening is a known climate trend, not a sudden event.
- Melt water, thaw ponds and slumps change slowly and are easily confused on one date.
- The WorldCover label for this class is often wrong.
