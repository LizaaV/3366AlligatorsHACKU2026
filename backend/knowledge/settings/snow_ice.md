---
id: snow_ice
type: setting
version: 1
status: draft
name: Snow and ice
aliases: [snow, ice, glacier, ice cap, snowfield, frozen lake, permafrost snow, 雪, 冰, 冰川, 積雪, 雪山]
summary: Land covered by snow or ice for most of the year, such as glaciers and high mountains, where snow confuses the water and bare indices.
worldcover_classes: [70]
detect:
  land_cover_any: [70]
  min_fraction: 0.5
  note: "WorldCover 70 = permanent snow and ice. Seasonal snow over other classes is not mapped as 70; the agent should also suspect snow when elevation_m is high or the latitude is high and the date is in that hemisphere's winter. Does not occur in Hong Kong."
normal:
  - {measure: greenness, typical_min: -0.2, typical_max: 0.1, seasonality: "Near or below 0 under snow. Exposed rock or tundra at the snow edge in summer reaches 0.1-0.3."}
  - {measure: moisture, typical_min: 0.0, typical_max: 0.9, seasonality: "High under clean snow (often 0.6-0.9) because snow is bright in near-infrared and absorbs strongly in short-wave infrared; dirty snow and debris-covered ice read lower. This does not mean wet vegetation."}
  - {measure: water, typical_min: -0.1, typical_max: 0.6, seasonality: "Fresh snow usually 0 to 0.2 and bare glacier ice higher (snow and ice are less reflective in near-infrared than in green), so both can cross the open-water threshold of 0. Meltwater ponds and slush in summer read clearly positive (often above 0.3)."}
  - {measure: bare, typical_min: -0.9, typical_max: 0.0, seasonality: "Mirror image of moisture (same bands, sign flipped): strongly negative under snow; rises sharply toward 0 or above when snow melts and rock or debris is exposed."}
  - {measure: roughness, typical_min: -25, typical_max: 0, seasonality: "Dry snow is mostly transparent to C-band radar, so the signal comes from the ground or ice beneath (often -15 to -8 dB); dry firn on glacier upper zones can be very bright (near 0 dB) from buried ice layers. Wet melting snow absorbs the signal and drops by 3 dB or more against a dry-snow reference, often to -20 dB or lower, similar to calm water. Strong seasonal swings at melt onset and freeze-up are normal."}
  - {measure: elevation_m, seasonality: "Static; snow line rises in summer and falls in winter."}
  - {measure: slope_deg, typical_min: 0, typical_max: 45, seasonality: "Static; steep slopes shed snow and cast long shadows."}
likely_events: [seasonal, water_loss]
pitfalls:
  - "Snow makes the water index positive and the bare index strongly negative; never call open water or 'less bare ground' from optical indices over snow."
  - "Snow and cloud are both bright; Sentinel-2 cloud masks often misflag one as the other."
  - "Snow coming and going is the strongest seasonal signal on Earth; compare with the same weeks in earlier years before suggesting any other change."
  - "Wet snow is as dark as calm water in radar; a radar drop at melt onset is not a flood."
  - "Low winter sun at high latitude causes long shadows and long periods with no usable optical data."
  - "Mountain glaciers sit on steep terrain where radar layover and shadow are severe; slopes facing the satellite are compressed and bright, slopes facing away may have no signal. Compare only the same orbit direction."
  - "Seasonal snow also covers forest, grassland, cropland and built-up settings in winter, where WorldCover is not 70; the same index traps apply there."
  - "Glacier retreat is a gradual multi-year change; one season of melt is not evidence of it."
sources:
  - {title: "ESA WorldCover 2021 v200 Product User Manual", url: "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/docs/WorldCover_PUM_V2.0.pdf"}
  - {title: "Sentinel Hub custom scripts, Normalised Difference Snow Index (NDSI)", url: "https://custom-scripts.sentinel-hub.com/sentinel-2/ndsi/"}
  - {title: "Gascoin et al. 2019, Theia Snow collection: high-resolution operational snow cover maps from Sentinel-2 and Landsat-8 data (Earth System Science Data)", url: "https://doi.org/10.5194/essd-11-493-2019"}
  - {title: "Nagler et al. 2016, Advancements for snowmelt monitoring by means of Sentinel-1 SAR (Remote Sensing)", url: "https://doi.org/10.3390/rs8040348"}
---

## What it is
Land under snow or ice for most or all of the year: glaciers, ice caps and high mountain snowfields. Seasonal snow also covers many other settings in winter, so the same pitfalls apply wherever snow may be present.

## What normal looks like
- **Greenness** is near or below 0 under snow.
- **Water** is often above 0 and **moisture** high, because snow is bright in visible light and dark in short-wave infrared, the same pattern as water.
- **Bare** is strongly negative under snow and jumps when the snow melts.
- **Roughness** (radar): dry snow is nearly invisible to radar; wet, melting snow is very dark, like calm water.
- The snow line moves up and down with the seasons; this is the dominant normal change.

## Pitfalls
- Snow fools the water and bare indices; do not report open water or bare-ground loss over snow.
- Snow and cloud are hard to tell apart in optical images.
- Always compare with the same season in earlier years.
- Melting snow darkens radar like water; it is not a flood.
- Polar and winter scenes may have long data gaps and shadows.
- Steep mountain terrain distorts radar (layover and shadow); use the same orbit direction only.
