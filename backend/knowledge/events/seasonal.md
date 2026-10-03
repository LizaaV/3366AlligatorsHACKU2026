---
id: seasonal
type: event
version: 1
status: draft
name: Normal seasonal change
aliases: [seasonal change, time of year, phenology, leaf fall, autumn leaves, autumn colours, spring green-up, winter dormancy, dry season, wet season, rainy season, monsoon, annual cycle, yearly cycle, normal change, is this normal, "季節性變化", "季節變化", "季節", "轉季", "落葉", "紅葉", "黃葉", "秋天", "乾季", "旱季", "雨季", "濕季", "正常變化", "正唔正常", than normal, than usual, usual for this time of year, anything changed, any change, 比平時, 同平時比, 平時, 正常嗎, 有冇變化, 有冇改變]
category: agriculture
summary: The place changed the way it does every year at this time, such as leaves dropping, grass browning in the dry season, or reservoirs rising in the rainy season.
min_size_m: 50
timing: seasonal
occurs_in: [any]
triggered_by:
  - {measure: rain_mm, above: 150, window_days: 30, note: "Counts toward seasonal only when this total is within the place's own same-month climatology (normal in Hong Kong's wet season); in dry climates it points to an event instead. Absence of this trigger is not evidence against seasonal (leaf-fall, snow and dry-season browning need no rain trigger)."}
signs:
  - {measure: greenness, change: inside_band, timing: seasonal, spatial: regional, weight: 3, optional: false, note: "Band = min..max of the same +-15-day window over >= 3 prior years, widened by 0.05 NDVI for noise; surroundings ring moved the same direction within 0.1. Counts only if greenness or water actually moved by more than noise between the two dates (|dNDVI| > 0.05 or |dNDWI| > 0.05); otherwise report no notable change, not seasonal."}
  - {measure: moisture, change: inside_band, timing: seasonal, spatial: regional, weight: 2, optional: false, note: "NDMI within the same-window multi-year band widened by 0.05; no sharp local drop."}
  - {measure: water, change: inside_band, timing: seasonal, spatial: regional, weight: 2, optional: false, note: "NDWI/water extent within the same-month band of >= 3 prior years widened by 0.05 (wet-season high, dry-season low)."}
  - {measure: roughness, change: inside_band, timing: seasonal, spatial: regional, weight: 1, optional: false, note: "Support only. VV within the same-window band over >= 3 years, same relative orbit, widened by 1.5 dB; wind roughens water and rain wets soil (both raise VV a few dB); > 3 dB outside the band is material."}
  - {measure: bare, change: inside_band, timing: seasonal, spatial: regional, weight: 1, optional: false, note: "Support only. NDBI within the usual dry-season or fallow band; no new bare or built patch."}
  - {measure: rain_mm, change: inside_band, timing: seasonal, spatial: any, weight: 1, optional: false, note: "30-day rainfall within the same-month climatology (Open-Meteo archive, >= 10 years)."}
  - {measure: heat, change: inside_band, timing: seasonal, spatial: regional, weight: 1, optional: true, note: "Surface temperature within the usual range for the month."}
looks_like:
  - {event: vegetation_loss, tell_apart_by: "Loss is local (the surroundings ring did not drop) and falls below the same-season band of past years by more than 0.1 NDVI; seasonal browning is regional and stays inside the band. Recovery next season confirms seasonal but cannot be checked for recent images.", discriminating_measures: [greenness, moisture]}
  - {event: vegetation_gain, tell_apart_by: "Lasting gain rises above the multi-year same-season band; seasonal green-up stays inside it.", discriminating_measures: [greenness]}
  - {event: water_gain, tell_apart_by: "New water lies outside the past same-month water extent or in places never wet before; seasonal high water stays inside the band.", discriminating_measures: [water, roughness]}
  - {event: water_loss, tell_apart_by: "Abnormal loss drops below the dry-season low of past years; a normal dry season stays inside that band.", discriminating_measures: [water, roughness, rain_mm]}
  - {event: new_bare_or_built, tell_apart_by: "NDBI rises above the past same-season band and only inside a sharp outline that differs from its surroundings; seasonal bare soil stays inside the band and is regional.", discriminating_measures: [bare, greenness]}
  - {event: burn, tell_apart_by: "A burn scar has a sharp local edge, a sudden moisture (NDMI) drop well below the same-season band and an NDBI rise from char and exposed soil; dry-season browning is gradual and regional. If available, dNBR > 0.1 or FIRMS detections confirm.", discriminating_measures: [greenness, moisture, bare, burn, fire]}
  - {event: landslide, tell_apart_by: "A landslide is a sudden local bare scar on a slope, often after heavy rain; seasonal change is gradual and spread across the hillside.", discriminating_measures: [bare, greenness, slope_deg]}
  - {event: pond_filling, tell_apart_by: "A filled pond loses water and NDBI rises above the band inside the pond outline; a seasonally drained pond stays bare-wet inside the usual band and refills in later images.", discriminating_measures: [water, bare]}
  - {event: construction, tell_apart_by: "VV rises > 3 dB in a sharp footprint (built double-bounce), with NDBI above the band; seasonal change is regional and inside the band.", discriminating_measures: [bare, roughness]}
  - {event: harvest, tell_apart_by: "Harvest is a sudden drop limited to field outlines on a crop calendar date, and NDBI jumps on bare stubble inside field outlines; general seasonal browning is gradual and not tied to field edges.", discriminating_measures: [greenness, bare, land_cover]}
cannot_tell:
  - "Needs several past years of the same season; with fewer than about three clean years the normal band is a guess."
  - "Cloud can hide the optical record for the whole wet season; radar then covers water but not greenness."
  - "A real event that happens to match the season (early leaf drop from drought, harvest on schedule) can hide inside the normal band."
  - "Slow multi-year trends (gradual degradation, a growing reservoir) can drift the band itself."
  - "Coastal and mudflat water depends on tide at image time; tidal differences are not seasonal and can push water outside the band."
  - "In evergreen subtropical places (e.g. Hong Kong) the yearly greenness swing is small (~0.05-0.1 NDVI), close to noise, so inside-band says little."
  - "Water under crops or trees (rice paddies, flooded forest) is missed by NDWI; radar brightens rather than darkens there."
  - "Steep slopes in low winter sun are partly shadowed, distorting optical indices."
  - "Multi-year bands need harmonized Sentinel-2 data (2022 processing-baseline offset) and the same Sentinel-1 relative orbit; Sentinel-1 was sparser 2022-2024."
  - "For the latest image, whether the change reverses next season cannot be checked yet."
confidence: {high_min_weight: 8, medium_min_weight: 5}
suggested_blocks: [timeline, compare, then_now, hypotheses, limits]
wording:
  use: ["consistent with normal seasonal change", "within the range seen in past years at this time", "the surrounding area changed the same way"]
  avoid: ["nothing happened", "definitely seasonal", "no change"]
cases:
  - {place: "Harvard Forest EMS tower, Massachusetts, USA (deciduous broadleaf forest)", lat: 42.5378, lon: -72.1715, location_precision: exact, date: "2023-10", expected: detected, source: "AmeriFlux, US-Ha1 Harvard Forest EMS Tower site info (deciduous broadleaf, annual leaf-on/leaf-off cycle)", url: "https://ameriflux.lbl.gov/sites/siteinfo/US-Ha1", verified: false, note: "Site phenology documented; specific month not separately confirmed. October is a representative autumn; compare to October of prior years."}
  - {place: "Tonle Sap seasonal floodplain, northeast of the lake, Cambodia", lat: 12.85, lon: 104.42, location_precision: approximate, date: "2023-10", expected: detected, source: "NASA Earth Observatory, Mekong Floods Fill Tonle Sap; FISHBIO, For Cambodia's crucial Tonle Sap lake, new normal is uncertainty (2024-03-14)", url: "https://science.nasa.gov/earth/earth-observatory/mekong-floods-fill-tonle-sap-1778", verified: true, note: "NASA page (imagery 2001-09-15): the lake roughly triples, from about 3,000 km2 in the dry season to about 10,000 km2, when Mekong floodwater reverses the Tonle Sap River (wet season Jun-Nov). FISHBIO reports 2022-2023 had a nearly normal expansion and the usual reversed flow. Point chosen on open floodplain off the permanent lake; check it is dry in March and wet in October. 2019-2021 were record-low pulses, so build the band from >= 3 years and expect radar for wet-season scenes."}
  - {place: "Okavango Delta seasonal swamp near its distal fringe, north of Maun, Botswana", lat: -19.85, lon: 23.3, location_precision: "approximate", date: "2018-05", expected: "detected", source: "NASA Earth Observatory - Fire Marches Across the Okavango Delta (30 May 2018)", url: "https://science.nasa.gov/earth/earth-observatory/fire-marches-across-the-okavango-delta-92206", verified: true, note: "Article (opened): the yearly flood pulse crosses about 20,000 km2 of wetland, with water filling the seasonal swamp fingers; images 28 Apr-23 May 2018 show it reaching the distal fringes. Rising water here is the yearly flood, so the answer should be seasonal, not water_gain, when previous years show the same rise. Earth Search L2A has clear scenes from Mar to Jul 2018. Point is approximate; put it on a seasonal-swamp finger, not the permanent swamp."}
controls:
  - {place: "Corrego do Feijao tailings dam, Brumadinho, Brazil", lat: -20.119, lon: -44.121, location_precision: approximate, date: "2019-01-25", expected: not_detected, source: "NASA, ASTER shows Brazilian city after dam disaster", url: "https://science.nasa.gov/photojournal/nasas-aster-shows-brazilian-city-after-dam-disaster", verified: true, note: "Inverted control: a non-seasonal event that must not be explained as seasonal. Sudden local mudflow over vegetation and town, far outside the seasonal band."}
  - {place: "Hills of northern Atsuma town, east of Abira, Hokkaido, Japan", lat: 42.75, lon: 141.98, location_precision: approximate, date: "2018-09-06", expected: not_detected, source: "NASA Earth Observatory, Landslides in Hokkaido", url: "https://science.nasa.gov/earth/earth-observatory/landslides-in-hokkaido-92832", verified: true, note: "Inverted control. M6.6 earthquake after heavy rain from Typhoon Jebi triggered hundreds of shallow landslides in saturated pumice soils in late summer, when the forest should be fully green; abrupt local bare scars."}
  - {place: "Shek O Road slope 11SE-D/F47, Shek O, Hong Kong Island", lat: 22.24, lon: 114.24, location_precision: approximate, date: "2023-09-08", expected: not_detected, source: "CEDD GEO Report No. 376, Detailed Study of the 8 and 14 September 2023 Landslides on Slope No. 11SE-D/F47 at Shek O Road", url: "https://cedd.gov.hk/eng/publications/geo/geo-reports/geo_rpt376/index.html", verified: true, note: "Inverted control in the wet season: ~650 m3 landslide during the record 7-8 Sep 2023 black rainstorm. Coordinates approximate (fix from the report's location plan); the scar is small, near the 10 m limit."}
sources:
  - {title: "USGS, Remote Sensing Phenology", url: "https://www.usgs.gov/special-topics/remote-sensing-phenology"}
  - {title: "NASA Earthdata, MODIS Land Cover Dynamics (MCD12Q2) v061", url: "https://www.earthdata.nasa.gov/data/catalog/lpcloud-mcd12q2-061"}
  - {title: "Google Earth Engine catalog, MODIS/061/MCD12Q2 Land Cover Dynamics", url: "https://developers.google.com/earth-engine/datasets/catalog/MODIS_061_MCD12Q2"}
  - {title: "Klosterman et al. 2014, Evaluating remote sensing of deciduous forest phenology at multiple spatial scales using PhenoCam imagery (Biogeosciences)", url: "https://bg.copernicus.org/articles/11/4305/2014/bg-11-4305-2014.html"}
  - {title: "NASA Earth Observatory, Mekong Floods Fill Tonle Sap", url: "https://science.nasa.gov/earth/earth-observatory/mekong-floods-fill-tonle-sap-1778"}
---

## What it is
Most places change on a yearly rhythm. Deciduous trees leaf out in spring and drop their leaves in autumn. Grass and crops brown in the dry season. Reservoirs and floodplains rise in the wet season and fall in the dry season. Snow comes and goes. This is the most common true answer to "what changed here?" and also the most common false alarm. It is **always a hypothesis**, never a verdict. It means "the change fits what this place does every year", not "nothing happened". If nothing moved by more than noise, the answer is "no notable change", not seasonal.

## How it shows up from space
- The value on the chosen date sits **inside the band** for the same season in earlier years (for example, this October against the last 3-5 Octobers, ±15 days, widened for noise). A difference from one earlier image is not enough.
- The change is **regional**: the surroundings ring moves the same way, by about the same amount, as the area of interest.
- The change is **gradual** across consecutive scenes. Where later images exist, it **reverses** the next season.
- Greenness (NDVI) and moisture (NDMI) follow a smooth curve. Water (NDWI) and radar roughness show wet-season highs and dry-season lows.
- Rainfall in the window matches the local climate, so the change has an ordinary driver.

## How to tell it apart
- Always compare like with like: the same month across several years, harmonized Sentinel-2 data, and the same Sentinel-1 relative orbit.
- A **sharp local edge** that differs from its surroundings points away from seasonal, toward harvest, burn, landslide, construction or vegetation loss. Examples are a field outline, a scar or a footprint.
- A value **outside** the multi-year same-season band points to a real event, such as an abnormal flood, an abnormal drought, new water or lasting loss.
- Use evidence you can measure now (band and edges) first. Reversal next season only confirms, and it cannot be checked for the newest image.
- Measures that cannot move in this setting do not count as evidence, for example water on dry forest or roughness in a city. The scorer should skip them.

## Limits
- Needs about three or more clean years of the same season. Tropical wet seasons can be cloud-covered for months, and radar then covers water but not greenness.
- In evergreen Hong Kong, the yearly NDVI swing is close to noise. Tides change coastal water extent.
- A real event that coincides with the season can look normal, for example drought-driven early leaf drop or an on-schedule harvest.
- Long trends shift the band itself. Flag them separately rather than calling them seasonal.

## Sources
- USGS Remote Sensing Phenology; NASA MODIS Land Cover Dynamics (MCD12Q2).
- Klosterman et al. 2014, Biogeosciences: PhenoCam and satellite phenology at Harvard Forest and other deciduous sites.
- NASA Earth Observatory: the Tonle Sap seasonal flood pulse.
