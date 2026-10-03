---
id: bare_sparse
type: setting
version: 1
status: draft
name: Bare or sparse vegetation
aliases: [desert, bare ground, bare soil, rock, sand, dunes, quarry, mine, badlands, scree, salt flat, 沙漠, 裸地, 石礦場, 礦場, 荒地, 沙地]
summary: Land with little or no plant cover, such as deserts, rock, sand, quarries and mines, where index values are low and noisy.
worldcover_classes: [60]
detect:
  land_cover_any: [60]
  min_fraction: 0.5
  note: "WorldCover 60 = exposed soil, sand or rock with vegetation never above 10% cover at any time of the year; waste dumps and extraction sites (quarries, mines) are mapped as 60 by definition. Construction sites may be 60 or 50 depending on the stage; greenhouses are 50. In Hong Kong, mainly quarries, reclamation fill, eroded hilltops and beaches, all small, so min_fraction may rarely be met."
normal:
  - {measure: greenness, typical_min: -0.05, typical_max: 0.2, seasonality: "Mostly flat. After rare rain in deserts a short green flush to 0.2-0.35 can appear for weeks and then fade; this is normal."}
  - {measure: moisture, typical_min: -0.4, typical_max: 0.05, seasonality: "Low; mirror image of bare (same bands, sign flipped). Jumps briefly after rain on bare soil."}
  - {measure: water, typical_min: -0.6, typical_max: 0.0, seasonality: "Below 0 for dry ground. Wet soil, dark rock and salt flats can approach 0; quarry pits and playas may hold ephemeral water after rain."}
  - {measure: bare, typical_min: -0.05, typical_max: 0.4, seasonality: "High (often 0.1-0.3) and fairly steady; very sensitive to soil type, mineral content and wetness, so absolute values differ a lot between sites."}
  - {measure: roughness, typical_min: -25, typical_max: -5, seasonality: "Smooth dry sand reads very dark (-20 dB or lower, as low as calm water) because the surface is smooth and dry sand lets the signal pass; rough rock, scree and quarry faces are bright and can exceed -5 dB on slopes facing the satellite. Rain-wetted soil raises it briefly by a few dB."}
  - {measure: slope_deg, typical_min: 0, typical_max: 30, seasonality: "Static, except active quarries and mines where faces are cut back."}
likely_events: [seasonal, new_bare_or_built, construction, landslide, vegetation_gain, water_gain, water_loss]
pitfalls:
  - "Indices are noisy here because the pixel is mostly soil or rock; small differences (greenness under ~0.05) are not meaningful."
  - "Bright bare soil and built-up surfaces look alike in the bare index; a rise in bare is not proof of new buildings."
  - "Dry sand can be as dark as calm water in radar; do not call water from roughness alone here, check the water index too."
  - "Active quarries and mines change continuously; one step change is expected operation, and wording must not imply illegality."
  - "Short green flushes after rare rain are normal in deserts and are not lasting vegetation gain."
  - "Dust, haze and very bright surfaces (salt flats, white sand) disturb optical indices; prefer several clear dates."
  - "Beaches and tidal flats change with the tide between images; a water rise or fall there is usually tide, not a lasting change. Compare dates at similar tide levels."
  - "Steep quarry faces and eroded slopes suffer radar layover and shadow; compare radar only within the same orbit direction."
sources:
  - {title: "ESA WorldCover 2021 v200 Product User Manual", url: "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/docs/WorldCover_PUM_V2.0.pdf"}
  - {title: "Huete 1988, A soil-adjusted vegetation index (SAVI) (Remote Sensing of Environment)", url: "https://doi.org/10.1016/0034-4257(88)90106-X"}
  - {title: "Zha, Gao and Ni 2003, Use of normalized difference built-up index in automatically mapping urban areas from TM imagery (International Journal of Remote Sensing)", url: "https://doi.org/10.1080/01431160304987"}
  - {title: "As-syakur et al. 2012, Enhanced Built-Up and Bareness Index (EBBI) for mapping built-up and bare land in an urban area (Remote Sensing)", url: "https://doi.org/10.3390/rs4102957"}
---

## What it is
Ground with almost no plant cover: deserts, sand, bare rock, scree, salt flats, quarries and mines, and freshly cleared or filled land. In Hong Kong this mostly means quarries, reclamation fill, eroded hilltops ("badlands") and beaches.

## What normal looks like
- **Greenness** sits near 0-0.2 and barely moves, apart from short flushes after rare rain.
- **Moisture** and **water** are low; they jump briefly when the ground is wet.
- **Bare** is high, but its absolute level depends strongly on soil and rock type.
- **Roughness** varies hugely with surface texture: smooth sand is very dark, rock faces are bright.
- Quarries and mines change all the time; steady small changes are part of normal operation.

## Pitfalls
- Values are noisy; ignore small differences.
- Bare soil and buildings look alike in the bare index; use radar and context before suggesting built change.
- Smooth sand can be as dark as water in radar; confirm water with the water index.
- Quarry activity is expected; use neutral wording and never imply wrongdoing.
- Brief green flushes after rain are seasonal, not lasting gain.
- On beaches and tidal flats, water changes are usually the tide.
