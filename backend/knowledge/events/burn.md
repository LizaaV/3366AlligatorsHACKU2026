---
id: burn
type: event
version: 1
status: draft
name: Fire / burn scar
aliases: [wildfire, wild fire, hill fire, hillfire, bushfire, forest fire, grass fire, brush fire, burn scar, burnt area, burned area, burnt hillside, fire damage, scorched, 山火, 火燒山, 燒山, 野火, 林火, 草火, 森林火災, 森林火灾, 火災, 燒焦, fire, fires, wildfires, burnt, 火燭, 燒咗]
category: disasters
summary: Vegetation was burned by fire, leaving a dark, bare, dry scar where plants were before.
min_size_m: 50
timing: sudden
occurs_in: [tree_cover, shrubland, grassland, cropland, herbaceous_wetland, steep_hillside]
signs:
  - {measure: greenness, change: down, by_more_than: 0.15, timing: sudden, spatial: local, shape: "irregular patch with ragged edges, often running up slopes and across field or path boundaries", weight: 3, optional: false, note: "Leaves consumed or scorched within one revisit; forest burns often drop 0.3-0.5, cured winter grass about 0.15-0.25."}
  - {measure: moisture, change: down, by_more_than: 0.15, timing: sudden, spatial: local, weight: 2, optional: false, note: "NIR collapses as leaf structure is lost while SWIR1 holds or rises, so NDMI drops with greenness. Also drops for clearing, so not burn-specific."}
  - {measure: bare, change: up, by_more_than: 0.15, timing: sudden, spatial: local, weight: 1, optional: false, note: "Roughly the mirror of moisture (NDBI is about -NDMI with the same bands); a consistency check only, not independent evidence."}
  - {measure: water, change: below, threshold: 0, spatial: local, weight: 1, optional: false, note: "Rule-out only: NDWI may rise toward 0 on fresh char as NIR collapses but stays negative, so the dark scar is not water or flooding; not evidence of fire by itself."}
  - {measure: rain_mm, change: below, threshold: 30, timing: any, shape: "sum of daily rain over the 30 days before the after-image", weight: 1, optional: false, note: "Dry spells fit fire weather but do not show a fire; heavy rain points more to landslide or flooding."}
  - {measure: burn, change: down, by_more_than: 0.1, timing: sudden, spatial: local, weight: 3, optional: true, note: "NBR drop (dNBR) > 0.1 low, > 0.27 moderate (USGS moderate-low 0.27-0.44 and moderate-high 0.44-0.66), > 0.66 high severity; the most specific burn sign."}
  - {measure: fire, change: above, threshold: 0, weight: 3, optional: true, note: "FIRMS VIIRS/MODIS detections within about 1 km of the patch between the before and after images. Small fires are often missed, so no detection is not evidence against a burn."}
  - {measure: heat, change: up, by_more_than: 2, timing: sudden, spatial: local, weight: 1, optional: true, note: "Daytime surface temperature on blackened ground is several degC above the surrounding vegetation. Landsat thermal is about 100 m native, so only usable for scars of several hundred metres."}
looks_like:
  - {event: seasonal, tell_apart_by: "A seasonal fade is gradual and affects the whole landscape the same way; a burn is a sudden drop inside one irregular patch while the surrounding ring stays green.", discriminating_measures: [greenness, moisture, burn]}
  - {event: vegetation_loss, tell_apart_by: "Clearing usually leaves straight, geometric edges and bright exposed soil, with no fire detections and dNBR under about 0.1-0.27. A burn has ragged edges that cross paths and boundaries and, when available, dNBR above 0.27 or FIRMS detections in the window. With v1 measures alone the two often cannot be separated.", discriminating_measures: [burn, fire]}
  - {event: harvest, tell_apart_by: "Harvest is confined to flat cropland (WorldCover 40) in field-shaped blocks, and bare soil or stubble regreens on the next crop cycle. A burn reaches shrub, grass or tree cover and hillsides and crosses field boundaries. Fire detections inside cropland fit both stubble burning and a wildfire, so report it as consistent with either.", discriminating_measures: [land_cover, slope_deg, burn, greenness]}
cannot_tell: [
  "Who or what started the fire, or whether it was deliberate or a permitted controlled burn.",
  "Fires smaller than about 50 m across, or ground fires under an intact tree canopy.",
  "Grass and shrub fires whose scar regreened before the next clear image; an old fire may no longer be visible.",
  "Without NBR or FIRMS data, whether the patch burned or was cleared; both look like a sudden greenness and moisture drop.",
  "The exact day of the fire when cloud or smoke hides the area; missing FIRMS detections do not mean there was no fire.",
  "Damage to buildings, people or animals; only the vegetation change is visible."
]
confidence: {high_min_weight: 10, medium_min_weight: 6}
suggested_blocks: [then_now, highlight, timeline, stat, hypotheses, limits, map_layer]
wording:
  use: ["consistent with a burn scar", "vegetation appears to have burned", "a sudden loss of greenness in an irregular patch"]
  avoid: ["arson", "arsonist", "someone set the fire", "deliberately set", "illegal burning", "caused by", "started by", "縱火", "有人放火"]
cases:
  - {place: "Evros / Alexandroupolis and Dadia forest, Greece", lat: 41.10, lon: 26.05, location_precision: approximate, date: "2023-08", expected: detected, source: "Copernicus / EU Space Programme - Greece's biggest fire crisis continues", url: "https://eu-space.europa.eu/components/earth-observation-copernicus/image-of-day/greeces-biggest-fire-crisis-continues", verified: true, note: "Copernicus EMS EMSR686; fire from 19 Aug 2023. EU Space image of the day (29 Aug 2023) gives about 80,873 ha burned by 28 Aug (interim figure). Point is approximate inside the Dadia/Lefkimi forest; check against the EMSR686 delineation before use."}
  - {place: "Kai Kung Leng, Pat Heung, Yuen Long, Hong Kong", lat: 22.468, lon: 114.085, location_precision: approximate, date: "2025-01-11", expected: detected, source: "The Standard - Hill fire in Yuen Long burns for over 17 hours", url: "https://www.thestandard.com.hk/news/article/224829/Hill-fire-in-Yuen-Long-burns-for-over-17-hours", verified: true, note: "Fire from 11 Jan 17:30 to 12 Jan 2025 (largely out 14:08 on 12 Jan per China Daily HK https://chinadailyhk.com/article/602215), fire lines over 500 m during an ultra-dry winter; compare Dec 2024 vs late Jan 2025. Burned area not reported; scar may be patchy grass/shrub; coordinates are the ridge, not the exact scar."}
  - {place: "Palisades Fire, Santa Monica Mountains above Pacific Palisades and Topanga, Los Angeles, USA", lat: 34.07, lon: -118.58, location_precision: "approximate", date: "2025-01-07", expected: "detected", source: "CAL FIRE - Palisades Fire incident updates", url: "https://www.fire.ca.gov/incidents/2025/1/7/palisades-fire", verified: true, note: "CAL FIRE incident updates (opened via search) give the start on 7 Jan 2025 south-east of Palisades Drive, 1,262 acres by the end of that day, and evacuation orders into Topanga. Final size about 23,000 acres (check the incident page). Point is chaparral inside the perimeter, not checked against the CAL FIRE polygon. Earth Search L2A has clear scenes on 18 Dec 2024 and in Feb 2025. Mixed wildland and burned homes, so pick a chaparral slope away from the town."}
controls:
  - {place: "Tai Lam Country Park (plantation woodland), Hong Kong", lat: 22.40, lon: 114.03, location_precision: approximate, date: "2025-01", expected: not_detected, source: "Same ultra-dry winter as the Kai Kung Leng fire; mostly tree plantation; no hill fire found in news reports for Jan 2025", url: "https://www.afcd.gov.hk/english/country/cou_lea/hillfire.html", verified: false, note: "The URL is general AFCD hill-fire guidance and does not show this area had no fire; Tai Lam often has dry-season hill fires. Before use, check FIRMS for Dec 2024-Feb 2025 within 3 km and that Dec 2024 vs Feb 2025 greenness is stable."}
  - {place: "Rhodope forest near Stavroupoli, Xanthi, Greece", lat: 41.20, lon: 24.70, location_precision: approximate, date: "2023-08", expected: not_detected, source: "Similar Rhodope pine/oak forest about 120 km west of the Evros fire, outside the EMSR686 burnt area (assumed)", url: "https://eu-space.europa.eu/components/earth-observation-copernicus/image-of-day/burnt-area-wildfires-east-macedonia-and-thrace-region-greece", verified: false, note: "The URL shows where the Evros burn was, not that this forest was unburned; several fires burned in northern Greece in Aug 2023. Before use, check FIRMS for 15 Aug-15 Sep 2023 within 5 km and that Jul vs Sep 2023 greenness is stable."}
  - {place: "Point Mugu State Park, western Santa Monica Mountains, California, USA", lat: 34.08, lon: -118.98, location_precision: "approximate", date: "2025-01", expected: "not_detected", source: "Same chaparral, same Santa Ana wind event, about 40 km west of the Palisades Fire perimeter", url: "https://www.fire.ca.gov/incidents/2025/1/7/palisades-fire", verified: false, note: "URL describes the nearby Palisades Fire, not this park. Check FIRMS for 1 Dec 2024-15 Feb 2025 within 5 km and that Dec 2024 vs Feb 2025 greenness is stable before use; the Dec 2024 Franklin Fire burned near Malibu, further east."}
sources:
  - {title: "UN-SPIDER Recommended Practice - Burn Severity Mapping (Sentinel-2, NBR/dNBR)", url: "https://www.un-spider.org/advisory-support/recommended-practices/recommended-practice-burn-severity/In-Detail"}
  - {title: "UN-SPIDER Recommended Practice - Normalized Burn Ratio (NBR) and USGS dNBR severity table", url: "https://www.un-spider.org/advisory-support/recommended-practices/recommended-practice-burn-severity/in-detail/normalized-burn-ratio"}
  - {title: "NASA FIRMS - Fire Information for Resource Management System", url: "https://firms.modaps.eosdis.nasa.gov/"}
  - {title: "Copernicus EMS Rapid Mapping EMSR686 - Wildfire in Evros, Greece", url: "https://mapping.emergency.copernicus.eu/activations/EMSR686/"}
  - {title: "EU Space - Burnt area of the wildfires in East Macedonia and Thrace (EMSR686, 27 Aug 2023)", url: "https://eu-space.europa.eu/components/earth-observation-copernicus/image-of-day/burnt-area-wildfires-east-macedonia-and-thrace-region-greece"}
  - {title: "AFCD Hong Kong - Hill fire prevention", url: "https://www.afcd.gov.hk/english/country/cou_lea/hillfire.html"}
---

## What it is

A fire that burned living vegetation: forest, shrubs, grass or crops. It leaves a
scar of ash, char and bare soil. In Hong Kong, hill fires (山火) are most common
in the dry season, from autumn to spring.

## How it shows up from space

- **Greenness** drops suddenly inside one irregular patch, between two clear
  images a few days apart (forest often 0.3-0.5, cured winter grass 0.15-0.25).
  The ring around it stays green.
- **Moisture** drops at the same time, mainly because near-infrared reflectance
  collapses when leaves burn; SWIR2 rises on ash and soil, which is why NBR
  (planned burn measure) is more specific than NDMI.
- **Bare** rises, but it mirrors moisture and is only a consistency check.
  **Water** stays below 0, so the dark scar is not flooding.
- Fire weather: little **rain_mm** (under 30 mm summed over the 30 days before).
- When available: **burn** (NBR) falls (dNBR > 0.1 low, > 0.27 moderate
  [USGS moderate-low 0.27-0.44, moderate-high 0.44-0.66], > 0.66 high severity),
  **fire** (FIRMS) shows hotspots within about 1 km in the window, and **heat**
  is higher on large blackened scars.
- Shape: ragged, wind- and slope-driven edges that cross paths, fences and field lines.
- Recovery: grass greens up within weeks to months; forest takes years.
- High confidence needs burn or fire data; v1 measures alone reach medium at most.

## How to tell it apart

- **seasonal**: a gradual, landscape-wide fade, no sharp local patch.
- **vegetation_loss** (clearing): straight edges, bright soil, no FIRMS detections,
  small dNBR. Without burn/fire data the two often cannot be separated.
- **harvest**: flat cropland only, field-shaped blocks, regreens next crop cycle;
  stubble burning can be both, so say "consistent with" either.

## Limits

- Sentinel-2 cannot see through smoke or cloud; the scar may only appear weeks later,
  and grass scars can regreen before then.
- Fires under about 50 m, or ground fires under tree canopy, may be missed.
- FIRMS (375 m-1 km pixels, a few passes a day) often misses small, short hill fires.
- Radar (roughness) sees through cloud but does not give a reliable burn signal;
  VV change after fire is small and goes either way, so do not use it to confirm a burn.
- The images cannot show who or what started a fire, or whether it was permitted.

## Sources

- UN-SPIDER Recommended Practice: Burn Severity and NBR (Sentinel-2, dNBR, USGS classes).
- NASA FIRMS active-fire data.
- Copernicus EMS EMSR686 and EU Space images of the day (Evros, Aug 2023).
- AFCD Hong Kong hill fire information; The Standard and China Daily HK (Kai Kung Leng, Jan 2025).
