---
id: harvest
type: event
version: 1
status: draft
name: Harvest / mowing
aliases: [harvest, harvesting, harvested field, crop harvest, crop cutting, field cut, stubble, mowing, mown, grass cutting, hay cutting, cutting, reaping, combine harvest, 收割, 收成, 收禾, 割禾, 割草, 剪草, 農作物收割, 禾田收割]
category: agriculture
summary: A crop or grass was cut and removed from a whole field at the usual time of year, leaving stubble or bare soil that later regrows or is replanted.
min_size_m: 50
timing: seasonal
occurs_in: [cropland, grassland]
triggered_by:
  - {event: seasonal, note: "Harvest follows crop maturity, so it comes at the end of the local growing season (e.g. Sep-Nov for US maize, April for Punjab wheat)."}
signs:
  - {measure: greenness, change: down, by_more_than: 0.15, timing: sudden, spatial: any, shape: "whole field steps down between two clear images, inside straight field edges", weight: 3, optional: false, note: "Step between consecutive clear images. Green cuts (hay, vegetables, early rice) drop 0.3-0.6; grain crops that dried first are already near 0.3-0.45 and drop only 0.1-0.25 at cutting. The earlier slow decline is senescence (seasonal), not harvest."}
  - {measure: bare, change: up, by_more_than: 0.05, timing: sudden, spatial: any, weight: 2, optional: false, note: "Exposed soil and stubble raise SWIR relative to NIR; 20 m band, so use field interiors."}
  - {measure: moisture, change: down, by_more_than: 0.05, timing: sudden, spatial: any, weight: 1, optional: false, note: "Large drop (>0.15) only for green cuts; a crop that dried first is already near 0, so the drop is small. 20 m band."}
  - {measure: land_cover, change: inside_band, weight: 1, optional: false, note: "Class is 40 (cropland) or 30 (grassland); a setting prior read once from the area, not a change over time, never enough alone. WorldCover 2021 snapshot; Hong Kong farmland is often mapped as 30, 20 or 50."}
  - {measure: slope_deg, change: below, threshold: 10, weight: 1, optional: false, note: "Prior only. Machine-harvested fields are mostly flat; a sudden loss on a steep slope points to landslide or clearing instead."}
  - {measure: greenness, change: up, timing: gradual, spatial: any, weight: 1, optional: false, note: "Regrowth, a cover crop or the next crop greens the same field: 2-4 weeks for mown grass, up to 6-7 months after an autumn grain harvest with a fallow winter. Unscorable if the harvest is recent; then leave vegetation_loss and new_bare_or_built open."}
  - {measure: roughness, change: outside_band, by_more_than: 2, timing: sudden, spatial: any, weight: 1, optional: false, note: "by_more_than is the absolute VV change in dB, same orbit direction only. Removing the crop shifts VV by ~1-3 dB in either direction; discard if rain_mm > ~10 mm in the 3 days before either image, since wet soil alone moves VV by several dB. Mainly useful to date the cut under cloud."}
  - {measure: fire, change: below, threshold: 1, weight: 1, optional: true, note: "No FIRMS detections in the field during the 10 days after the greenness step; detections mean residue burning, which should be reported as burn as well."}
looks_like:
  - {event: seasonal, tell_apart_by: "Senescence lowers greenness slowly over weeks with little bare change; harvest is a step between two consecutive clear images (<= ~10 days apart) with bare rising, bounded by straight field edges. In a monoculture belt many fields can step within the same weeks, so use the step size and field edges, not differences between neighbours.", discriminating_measures: [greenness, bare]}
  - {event: vegetation_loss, tell_apart_by: "Harvest happens on WorldCover cropland or grassland, and the field's greenness curve repeats the same calendar pattern as in earlier years (same drop date +/- ~3 weeks, same green-up timing). Loss of tree or shrub cover, or a field that misses its usual green-up date next year, points to vegetation loss.", discriminating_measures: [greenness, land_cover]}
  - {event: vegetation_gain, tell_apart_by: "Regrowth after harvest returns to the same seasonal level as earlier years; lasting greenness above the usual peak is a real gain.", discriminating_measures: [greenness]}
  - {event: burn, tell_apart_by: "Stubble burning stays inside field edges just like harvest, so shape does not separate them. Use a dNBR rise > 0.1 (burn measure) or FIRMS detections (fire measure). Without these, a burned field is darker overall and greenness falls further toward ~0.1 or below, but this is not reliable, so report 'harvest, possibly followed by residue burning' with lowered confidence.", discriminating_measures: [burn, fire, greenness]}
  - {event: new_bare_or_built, tell_apart_by: "A harvested field returns to its usual green peak at the usual time next year and roughness stays in its normal band. New bare or built ground misses that peak, and roughness often rises persistently by > 3 dB once structures appear.", discriminating_measures: [greenness, roughness, land_cover]}
cannot_tell: [
  "Which crop was grown or how much was harvested; only the loss of green canopy is seen.",
  "The exact harvest day when clouds hide the field for weeks (radar can help but is noisy).",
  "Crop failure or drought that was harvested early versus a normal harvest, without field reports.",
  "Small plots under about 50 m across, such as most Hong Kong vegetable plots, or mixed plots inside one pixel.",
  "Whether the residue was burned after harvest, when the burn and fire measures are unavailable.",
  "Ploughing or tilling of a field that had already dried or was stubble looks like harvest (greenness slightly down, bare up).",
  "Grazing versus mowing of grassland; both remove green biomass.",
  "If the last clear image before and the first after are more than ~3 weeks apart, the drying-out and the harvest step blur together and the cut date cannot be fixed.",
  "Right after cutting, whether the field will regrow (harvest) or stay bare (clearing), until later images exist.",
  "Who farmed or harvested the field."
]
confidence: {high_min_weight: 8, medium_min_weight: 6}
suggested_blocks: [then_now, timeline, scene_strip, highlight, hypotheses, limits, compare]
cases:
  - {place: "Farmland north of Nevada, Story County, central Iowa, USA", lat: 42.10, lon: -93.45, location_precision: approximate, date: 2024-10, expected: detected, source: "Iowa Department of Agriculture and Land Stewardship / USDA NASS - Iowa Crop Progress and Condition Report, 28 Oct 2024", url: "https://iowaagriculture.gov/news/crop-progress-report-Oct-28-2024", verified: true, note: "Report confirms Iowa corn for grain 84% harvested and soybeans 96% by 27 Oct 2024; 22% corn harvested by 6 Oct (https://iowaagriculture.gov/news/crop-progress-report-Oct-7-2024). Point is generic row-crop land, not a named field; compare mid-Sep vs early Nov 2024 field by field."}
  - {place: "Wheat fields near Khanna and Samrala, Ludhiana district, Punjab, India", lat: 30.75, lon: 76.15, location_precision: approximate, date: 2024-04, expected: detected, source: "The Tribune (India) - Wheat arrival in Ludhiana mandis gathers momentum", url: "https://tribuneindia.com/news/wheat-arrival-in-ludhiana-mandis-gathers-momentum-609990", verified: true, note: "Article (11-12 Apr 2024) reports first arrivals at Khanna mandi on 9 Apr and farmers near Samrala expecting to harvest around 18-20 Apr 2024. Compare late March vs mid May 2024; some fields may show residue burning afterwards."}
  - {place: "Winter wheat fields near Conway Springs, Sumner County, Kansas, USA", lat: 37.39, lon: -97.64, location_precision: "approximate", date: "2024-06", expected: "detected", source: "Kansas Wheat - Day 1, Kansas Wheat Harvest Report 2024", url: "https://kswheat.com/day-1-kansas-wheat-harvest-report-2024", verified: true, note: "Report (opened) says growers along the Kansas-Oklahoma border (Barber, Harper, Sumner, Cowley) started cutting in earnest on 3 Jun 2024, Sumner County combines running since 5 Jun, and a Conway Springs elevator reporting. Compare mid-May 2024 (clear scenes on 8, 11 and 18 May in Earth Search L2A) with early July 2024. Point is the town area; move it onto a wheat field on imagery (some fields here are corn or soybeans and will not drop)."}
controls:
  - {place: "Same Story County farmland, Iowa, corn/soybean fields at peak canopy", lat: 42.10, lon: -93.45, location_precision: approximate, date: 2024-07, expected: not_detected, source: "Iowa Department of Agriculture and Land Stewardship - Iowa Crop Progress and Condition Report, 29 Jul 2024", url: "https://iowaagriculture.gov/news/crop-progress-report-July-29-2024", verified: true, note: "Corn 85% silking and 77% good-excellent, so corn and soybean canopies are at their peak. Oat harvest (67%) and hay cutting were under way statewide, so small oat or hay fields may correctly show harvest. Choose a maize or soybean field (check the USDA Cropland Data Layer) and judge the control on those only."}
  - {place: "Same wheat fields near Khanna/Samrala, Ludhiana district, Punjab, India, before harvest", lat: 30.75, lon: 76.15, location_precision: approximate, date: 2024-02, expected: not_detected, source: "The Tribune (India) - Sow wheat by Nov 15 to prevent grain shrivelling: PAU to farmers (6 Nov 2022)", url: "https://www.tribuneindia.com/news/punjab/sow-wheat-by-nov-15-to-prevent-grain-shrivelling-pau-to-farmers-448039", verified: true, note: "PAU says the first fortnight of November is the best sowing time and grain filling runs through Feb-March; the 2024 harvest began around 9-20 Apr (see case). In February the canopy is green, so no harvest should be flagged. The source gives the general crop calendar, not field-level 2024 data."}
  - {place: "Same wheat fields near Conway Springs, Sumner County, Kansas, before harvest", lat: 37.39, lon: -97.64, location_precision: "approximate", date: "2024-04", expected: "not_detected", source: "Kansas Wheat - Day 1, Kansas Wheat Harvest Report 2024 (harvest began about 3 Jun 2024)", url: "https://kswheat.com/day-1-kansas-wheat-harvest-report-2024", verified: true, note: "Compare early April with mid-May 2024: winter wheat is heading and still green, so no harvest step should be found. Verified means the source dates the harvest start, which places this window before it."}
sources:
  - {title: "Planet / Sentinel Hub Area Monitoring - Greening and harvest marker (sudden NDVI drop, then bare soil)", url: "https://docs.planet.com/data/area-monitoring/markers/greening-harvest-marker/"}
  - {title: "Veloso et al. 2017, Remote Sensing of Environment 199 - Understanding the temporal behavior of crops using Sentinel-1 and Sentinel-2-like data for agricultural applications (NDVI and backscatter crop trajectories)", url: "https://doi.org/10.1016/j.rse.2017.07.015"}
  - {title: "Gao, Anderson & Hively 2020 (USGS) - Detecting cover crop end-of-season using VENuS and Sentinel-2 satellite imagery (sudden field-scale NDVI drop)", url: "https://pubs.usgs.gov/publication/70216696"}
  - {title: "Tamm et al. 2016, Remote Sensing 8(10):802 - Relating Sentinel-1 interferometric coherence to mowing events on grasslands (coherence, not backscatter; radar can date mowing under cloud)", url: "https://doi.org/10.3390/rs8100802"}
  - {title: "USDA NASS - Crop Progress reports (state harvest calendars)", url: "https://www.nass.usda.gov/Publications/National_Crop_Progress/"}
---

## What it is

A crop (grain, rice, vegetables) or grass (hay, large mown fields) is cut and
taken off the field. It is a normal farm step that repeats each season. In South
China rice is cut (割禾) in summer and late autumn; Hong Kong has only a few small
paddies and vegetable plots, mostly too small to see at 10 m, so larger fields in
Guangdong are a better example. In Punjab wheat is harvested in April; in the US
Corn Belt maize and soy come off in Sep-Nov.

## How it shows up from space

- **Greenness** steps down between two consecutive clear images over the whole
  field, inside straight field edges (0.3-0.6 for green cuts such as hay or
  vegetables; only 0.1-0.25 for grain crops that dried before cutting).
- **Bare** rises and **moisture** drops as stubble and soil replace the canopy;
  both changes are small when the crop had already dried.
- In monoculture belts many fields are cut within the same 1-3 weeks, so a field
  may not stand out from its neighbours; rely on the step and the field edges.
- The date fits the local crop calendar.
- Later **greenness** rises again in the same field: 2-4 weeks for mown grass,
  up to 6-7 months after an autumn harvest with a fallow winter.
- **Roughness** (radar) shifts by ~1-3 dB when the crop is removed and helps date
  the cut under cloud, but its direction is unreliable and rain can mimic it.
- **land_cover** and **slope_deg** are priors: they make harvest plausible but
  can never confirm one on their own.

## How to tell it apart

- **seasonal**: slow senescence with little bare change; harvest is a step.
- **vegetation_loss**: trees or shrubs, or a field that misses its usual
  green-up date next year.
- **vegetation_gain**: regrowth only back to the usual level is not a gain.
- **burn**: stubble burning also stays inside field edges; needs dNBR or FIRMS.
  Without them say "harvest, possibly followed by residue burning".
- **new_bare_or_built**: misses next year's usual green peak; roughness up.

## Limits

- Crop type, yield, and who harvested cannot be seen.
- Cloud during harvest season can hide the exact date for weeks.
- Plots below about 50 m across (common in Hong Kong) mix with edges and paths.
- Ploughing, grazing and early harvest after drought look like a normal harvest.

## Sources

- Planet / Sentinel Hub Area Monitoring greening-harvest marker.
- Veloso et al. 2017 (Sentinel-1 and Sentinel-2-like crop trajectories).
- Gao, Anderson & Hively 2020 (USGS), cover crop end-of-season with Sentinel-2.
- Tamm et al. 2016 (Sentinel-1 coherence and mowing).
- Iowa crop progress (Jul, Oct 2024); The Tribune on Punjab wheat (2022, 2024).
