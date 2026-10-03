---
id: water_gain
type: event
version: 1
status: draft
name: Flood or new open water
aliases: [flood, flooding, flooded, flash flood, inundation, inundated, floodwater, waterlogging, waterlogged, submerged, underwater, river overflow, overflow, new lake, new reservoir, 水浸, 水浸街, 浸咗, 水淹, 水災, 洪水, 山洪, 淹水, 氾濫, 水位上升, floods, flood water, 浸水]
category: water
summary: Land that is normally dry becomes covered by open water, usually suddenly after heavy rain or a river overflowing.
min_size_m: 50
timing: sudden
occurs_in: [cropland, grassland, built_up, bare_sparse, herbaceous_wetland, mangroves, open_water, fish_ponds]
triggered_by:
  - {measure: rain_mm, above: 100, window_days: 3, note: "Several days of very heavy rain upstream or on site; flash floods can follow less rain on steep, sealed catchments."}
signs:
  - {measure: roughness, change: down, by_more_than: 3, timing: sudden, spatial: any, shape: "patches that follow low ground, river banks and valley floors", weight: 1, optional: false, note: "Radar backscatter falls sharply compared with a pre-event image; radar sees through storm cloud. Compare only images from the same orbit direction (ascending vs ascending)."}
  - {measure: roughness, change: below, threshold: -16, timing: sudden, spatial: any, weight: 2, optional: false, note: "Calm open water sits around -18 to -25 dB in VV; land rarely falls below about -15 dB. Wind can lift water to about -14 dB, so missing this does not rule out water."}
  - {measure: water, change: up, by_more_than: 0.2, timing: sudden, spatial: any, weight: 1, optional: false, note: "Water index jumps where land is now under water; clearing or ploughing also raises it, so this alone is weak."}
  - {measure: water, change: above, threshold: 0.0, timing: sudden, spatial: any, weight: 2, optional: false, note: "Open water, even muddy floodwater, usually sits above 0; land, bare soil included, stays below 0. Must have been below 0 before. Cloud-free Sentinel-2 only."}
  - {measure: greenness, change: down, by_more_than: 0.2, timing: sudden, spatial: any, weight: 1, optional: false, note: "Fields and grass under muddy water lose their vegetation signal; recovers once the water drains unless crops died."}
  - {measure: rain_mm, change: above, threshold: 50, timing: sudden, spatial: regional, weight: 1, optional: false, note: "Highest daily rain sum on site or upstream in the 3 days before the first water image is above ~50 mm. River floods often follow rain far from the flooded fields, so low on-site rain does not rule out a flood."}
  - {measure: slope_deg, change: below, threshold: 5, spatial: local, weight: 1, optional: false, note: "Standing floodwater collects on flat, low ground; a water signal on steep slopes is more likely radar shadow."}
looks_like:
  - {event: seasonal, tell_apart_by: "Seasonal wetlands, paddies and monsoon lakes fill at the same time every year; compare against the same weeks in earlier years and check for a sudden jump right after a rain spike.", discriminating_measures: [water, roughness, rain_mm]}
  - {event: vegetation_loss, tell_apart_by: "Both lower greenness, and clearing can also lower radar a little, but only open water drops radar below about -16 dB and pushes the water index above 0; cleared land stays above those levels and its bare index rises.", discriminating_measures: [roughness, water, bare]}
cannot_tell:
  - "Water in streets between tall buildings or under tree canopy: radar double-bounce can make flooded towns look brighter, not darker, and optical images see only the roof tops."
  - "Flooded crops, marsh plants or shrubs can look brighter, not darker, in radar because of double bounce, so water under standing vegetation is often missed."
  - "Flash floods that drain within hours or a day or two are often missed because Sentinel-1 passes only about every 12 days and Sentinel-2 is blocked by storm cloud."
  - "Water depth, flow speed and damage to buildings or people cannot be measured from these images."
  - "Smooth dry surfaces (sand, fresh tarmac, wet snow, which absorbs radar) and radar shadow behind steep slopes can also look dark in radar, like water."
  - "Wind or heavy rain roughens the water surface and can hide it from radar."
  - "On coasts and in mangroves, tides cover and uncover land twice a day; one image cannot separate a flood from high tide."
  - "Cloud and terrain shadows can push the water index above 0 without any water."
  - "Images show that water is present, not why: a flood, a dam release, irrigation or a new pond can look the same."
confidence: {high_min_weight: 6, medium_min_weight: 4}
suggested_blocks: [then_now, highlight, timeline, stat, map_layer, hypotheses, limits]
wording:
  use: ["consistent with flooding", "new open water compared with <date>", "water visible on the <date> image"]
  avoid: ["the area is safe now", "no flooding", "confirmed flood", "people are trapped", "caused by", "emergency is over"]
cases:
  - {place: "Shikarpur district, Sindh, Pakistan (Copernicus EMS EMSR629)", lat: 27.955, lon: 68.638, location_precision: approximate, date: 2022-08-30, expected: detected, source: "Copernicus EMS - Information Bulletin 162: the Copernicus Emergency Management Service monitors the flooding event in Pakistan", url: "https://mapping.emergency.copernicus.eu/news/information-bulletin-162-the-copernicus-emergency-management-service-monitors-the-flooding-event-in-pakistan/", verified: true, note: "Bulletin confirms EMSR629 activation on 29 Aug 2022, delineation maps on 30 Aug and Shikarpur as a mapped area (158,720 ha flooded in total). Urban point (town centre), so radar may fail here; a miss is not a bug. Prefer flooded fields nearby from the EMSR629 map. Water stayed for weeks, so Sentinel-1 should catch it."}
  - {place: "L'Horta Sud fields near Catarroja, Valencia, Spain (DANA, Copernicus EMS EMSR773)", lat: 39.40, lon: -0.38, location_precision: approximate, date: 2024-10-29, expected: detected, source: "Copernicus EMS Rapid Mapping - EMSR773 Flood in Valencia Region, Spain", url: "https://mapping.emergency.copernicus.eu/activations/EMSR773", verified: true, note: "Activation dated 29 Oct 2024 (over 53,000 ha). Readable confirmation - EU Space, Copernicus Image of the day 'Floods in Horta Sud, Valencia, Spain' (https://eu-space.europa.eu/components/earth-observation-copernicus/image-of-day/floods-horta-sud-valencia-spain): Sentinel-2 image of 31 Oct 2024, over 4,100 ha flooded in Horta Sud. Point not checked against the delineation map. Keep it west of the Albufera rice paddies (seasonal winter flooding) and compare with the same weeks of 2023. Rain on the flooded fields was modest because the water came from upstream (Poyo ravine), so judge rain_mm over the catchment. Only Sentinel-1A was flying, so check the first post-event pass date; water receded within days."}
  - {place: "Fields between Lugo and Conselice, Ravenna, Emilia-Romagna, Italy (Copernicus EMS EMSR664)", lat: 44.45, lon: 11.88, location_precision: "approximate", date: "2023-05-17", expected: "detected", source: "Copernicus EMS - Information Bulletin 167: activities following the latest floods in Emilia-Romagna (5 Jun 2023)", url: "https://mapping.emergency.copernicus.eu/news/information-bulletin-167-the-copernicus-emergency-management-service-activities-following-the-latest-floods-in-emilia-romagna/", verified: true, note: "Bulletin (opened): EMSR664 activated 16 May 2023, eight areas of interest including Lugo (AoI02) and Faenza, about 21,780 ha flooded in total. Water stood for days to weeks around Conselice. Earth Search L2A has clear scenes on 23 May and 2 Jun 2023 but few in early May, so use Sentinel-1 for the flood peak. Point is approximate; check it against the EMSR664 Lugo delineation."}
controls:
  - {place: "Shikarpur district fields, Sindh, Pakistan (pre-monsoon)", lat: 27.955, lon: 68.638, location_precision: approximate, date: 2022-04-15, expected: not_detected, source: "Copernicus EMS - Information Bulletin 162 (flooding began with the late-August 2022 monsoon)", url: "https://mapping.emergency.copernicus.eu/news/information-bulletin-162-the-copernicus-emergency-management-service-monitors-the-flooding-event-in-pakistan/", verified: false, note: "Same place as the detected case, dry season, months before the flood. Tests seasonal false positives. Not checked pixel by pixel."}
  - {place: "L'Horta Sud fields near Catarroja, Valencia, Spain (before the DANA)", lat: 39.40, lon: -0.38, location_precision: approximate, date: 2024-09-15, expected: not_detected, source: "Copernicus EMS Rapid Mapping - EMSR773 (event started 29 Oct 2024)", url: "https://mapping.emergency.copernicus.eu/activations/EMSR773", verified: false, note: "Same fields six weeks before the storm. Avoid the Albufera lake and rice paddies, which hold water seasonally. Not checked pixel by pixel."}
  - {place: "Valencia city centre north of the Plan Sur diversion channel, Spain", lat: 39.4699, lon: -0.3763, location_precision: approximate, date: 2024-10-29, expected: not_detected, source: "City Institute - How a River Became Valencia's Green Shield", url: "https://city-institute.org/en/blog/valencia-turned-a-river-into-a-park-how-the-turia-gardens-protect-the-city-from-flooding", verified: true, note: "Same storm; the source says the Plan Sur diversion kept the historic centre dry. Urban point, so this tests known radar limits rather than a clean false-positive check."}
sources:
  - {title: "UN-SPIDER Recommended Practice: Flood mapping using Sentinel-1 and Sentinel-2 imagery", url: "https://un-spider.org/node/13488"}
  - {title: "UN-SPIDER/DLR/GloFAS/ZFL training workshop (Feb 2023) - Recommended Practice on flood mapping using Sentinel-1 SAR", url: "https://www.un-spider.org/sites/default/files/20230221_unspider_sar_floodmapping_gee.pdf"}
  - {title: "Twele et al. 2016, Sentinel-1-based flood mapping: a fully automated processing chain, Int. J. Remote Sensing", url: "https://doi.org/10.1080/01431161.2016.1192304"}
  - {title: "McFeeters 1996, The use of the Normalized Difference Water Index (NDWI) in the delineation of open water features, Int. J. Remote Sensing", url: "https://doi.org/10.1080/01431169608948714"}
  - {title: "Copernicus EMS Rapid Mapping - EMSR773 Valencia floods", url: "https://mapping.emergency.copernicus.eu/activations/EMSR773"}
---

## What it is
Water spreads over ground that is normally dry: river banks overflow, low fields fill after
extreme rain, or a breach lets water out. Most floods appear within hours to days and then
slowly drain over days to weeks. New permanent water (a new reservoir) looks the same at first
but stays.

## How it shows up from space
- **Radar (roughness)**: the strongest sign. Calm water acts like a mirror and sends the radar
  pulse away, so backscatter falls by several dB AND ends below about -16 dB (calm water is
  -18 to -25 dB). Radar works through storm cloud. Compare with a pre-event image from the
  same orbit direction.
- **Water index (water)**: crosses from below 0 to above 0; a rise that stays below 0 is more
  likely bare soil. Needs a cloud-free Sentinel-2 scene, rare during the storm itself.
- **Greenness**: fields under muddy water look bare; this alone is weak evidence.
- **Context**: heavy rain on site or upstream in the preceding days (rain_mm) and flat, low
  ground (slope_deg) make the flood reading more plausible. Big floods cover the surroundings
  too, so the outline need not stand out from its ring.

## How to tell it apart
- **Seasonal**: rice paddies, monsoon lakes and wetlands fill every year. Check the same weeks in
  previous years; a flood is a jump outside the usual range, right after a rain spike.
- **Vegetation loss**: also lowers greenness and can lower radar slightly, but cleared land does
  not fall below about -16 dB or push the water index above 0; it usually becomes more bare.
- A new pond or reservoir with sharp straight edges and water that stays for months is more
  likely man-made water than a flood.

## Limits
- Flooded streets in dense towns, water under forest canopy and flooded crops or marsh are
  often invisible or even look brighter in radar (double bounce).
- Short flash floods can drain before the next satellite pass (Sentinel-1 about every 12 days).
- Smooth dry surfaces, radar shadow on steep slopes, wind on the water, tides and cloud shadows
  can all confuse the reading.
- We cannot say how deep the water was, how fast it flowed, what damage it did, or what caused it.
- Satellite images are days old, so this is not a live warning. Seeing no water does not mean
  the area is safe.

## Sources
- UN-SPIDER Recommended Practice on flood mapping with Sentinel-1 and Sentinel-2.
- Twele et al. (2016), automated Sentinel-1 flood mapping.
- McFeeters (1996), NDWI for open water delineation.
- Copernicus EMS activations EMSR629 (Pakistan 2022) and EMSR773 (Valencia 2024).
