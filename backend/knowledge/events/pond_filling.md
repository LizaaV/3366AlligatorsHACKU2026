---
id: pond_filling
type: event
version: 1
status: draft
name: Pond or wetland filling
aliases: [pond filling, fishpond filling, filled-in fishpond, wetland filling, wetland reclamation, pond reclamation, filled pond, reclaimed pond, fill dumping, earth dumping, dumping, pond turned into land, 填塘, 填魚塘, 填平魚塘, 魚塘填土, 魚塘被填, 填濕地, 濕地被填, 填土, 倒泥頭, 泥頭, 傾倒泥頭, 傾倒廢料, filled in, fishponds filled, fish pond filled, 填咗魚塘, 魚塘填咗]
category: water
summary: A fishpond or wetland that held water is now covered with earth, rubble or hardcore and stays dry.
min_size_m: 50
timing: sudden
occurs_in: [fish_ponds, herbaceous_wetland, open_water, mangroves]
signs:
  - measure: water
    change: down
    by_more_than: 0.2
    timing: any
    spatial: local
    shape: "follows the pond's own outline (often rectangular bunds) while neighbouring ponds keep their water; may shrink from one bund inward over several images"
    weight: 3
    optional: false
    note: "NDWI drops by more than 0.2 and ends below 0 inside the pond outline; algal or turbid ponds may start near 0, so check radar was dark (< -16 dB) before"
  - measure: water
    change: below
    threshold: 0
    timing: any
    spatial: local
    shape: "stays below 0 inside the pond outline in at least 3 later clear images spanning >= 90 days, including at least one wet-season (Apr-Sep) image"
    weight: 3
    optional: false
    note: "persistence: drain-down for harvest, cleaning or winter birds usually refills within weeks to ~3 months; fill does not. Strongest when a later image after heavy rain still shows no water"
  - measure: roughness
    change: up
    by_more_than: 6
    timing: any
    spatial: local
    weight: 2
    optional: false
    note: "calm water ~-18 to -25 dB becomes land-like ~-5 to -12 dB; use the median of >= 3 same-orbit scenes before and after to beat speckle and wind; shows water is gone, NOT whether the pond was drained or filled"
  - measure: moisture
    change: below
    threshold: -0.05
    timing: any
    spatial: local
    weight: 2
    optional: false
    note: "dry fill or hardcore reads NDMI below ~-0.05; a freshly drained bed is wet mud (NDMI ~0 to 0.2); 20 m band, so the pond needs ~3 SWIR pixels across; a bed sun-dried for weeks can also fall below this, so it supports but does not prove fill"
  - measure: bare
    change: above
    threshold: 0
    timing: any
    spatial: local
    shape: "flat pale patch, sometimes with tracks or heaps of material"
    weight: 1
    optional: false
    note: "post-change NDBI above ~0 on soil, rubble or hardcore; use the post value, not the delta, because NDBI over water is noisy; a sun-dried bed can also exceed 0; 20 m band"
  - measure: greenness
    change: below
    threshold: 0.25
    timing: any
    spatial: local
    weight: 1
    optional: false
    note: "fill is near-bare (NDVI ~0.05-0.2) in the first weeks to months; open water is below 0, so NDVI rises slightly rather than staying stable; weeds may green idle fill after 2-4 wet-season months"
looks_like:
  - event: seasonal
    tell_apart_by: "Fishponds are drained for harvest or for winter waterbirds (Nov-Mar) and refill within weeks to a few months; a drained bed is wet mud that greens or refills, while fill stays dry and without water in later images, including after the first heavy wet-season rain. Radar only keeps the timeline going under cloud; it cannot tell mud from fill."
    discriminating_measures: [water, moisture, greenness]
  - event: water_loss
    tell_apart_by: "Water loss leaves a wet or vegetating bed (moisture stays near or above 0, greenness rises as reeds or grass colonise) and can refill; filling leaves dry, bright, sparsely vegetated ground (moisture below ~-0.05, bare above 0) that stays without water across later images."
    discriminating_measures: [moisture, greenness, bare, water]
  - event: construction
    tell_apart_by: "Filling is often the first step of construction; call it construction only when later images show further change on the fill, such as very bright radar points or lines (VV above about -5 dB from buildings or steel), regular paved pads, or bare rising further, rather than a uniform flat fill."
    discriminating_measures: [roughness, bare, greenness]
  - event: new_bare_or_built
    tell_apart_by: "New bare or built ground on what was already land is not pond filling; pond filling must start from a pixel that was open water (NDWI above 0 or very dark radar) before."
    discriminating_measures: [water, roughness]
cannot_tell:
  - "Who did the filling, why, and whether it was permitted cannot be known from satellite images."
  - "A pond drained and left empty for months looks like a filled pond in both optical and radar images; only persistence across many dates, including the wet season, separates them."
  - "The kind, thickness or depth of material cannot be measured at 10 m."
  - "Ponds narrower than about 50 m, filling along one bund, or partial filling of under about a quarter of the pond may be missed; edge pixels mix bund and water."
  - "Turbid, algal or plant-covered ponds can start with NDWI near or below 0, so the before image may not show clear open water."
  - "A pond abandoned and left to dry and overgrow can look like old fill after a few months."
  - "Conversion to farmland or reshaping into shrimp ponds changes the same measures without filling."
  - "In tidal areas (gei wai, mangrove edges, coast) the tide changes water and radar; compare images at similar tide."
  - "Wet-season cloud can hide optical images for weeks; wind on a pond can briefly brighten radar, so use several radar dates."
confidence:
  high_min_weight: 11
  medium_min_weight: 8
suggested_blocks: [then_now, timeline, scene_strip, highlight, hypotheses, stat, limits, compare]
wording:
  use: ["consistent with filling", "the pond no longer shows open water", "the change has persisted since", "bright, dry ground where the pond was", "material appears to have been placed in the pond"]
  avoid: ["illegal", "illegally filled", "suspected illegal", "違法", "dumped", "dumped by", "dumping", "fly-tipping", "landfilled by", "construction waste", "vandalised", "destroyed", "destroyed by", "destruction", "the owner", "the developer", "unauthorised", "caused by", "violation"]
cases:
  - place: "Hoo Hok Wai (蠔殼圍) eastern fishponds near Liu Pok, North District, Hong Kong"
    lat: 22.518
    lon: 114.103
    location_precision: approximate
    date: 2021-09
    expected: detected
    source: "HK01 - 北部都會區｜蠔殼圍魚塘疑遭填土、抽乾塘水 (4 Dec 2021); context: The Standard 18 Jan 2024, Conservancy Association and Greenpeace study (36.9 ha changed at Hoo Hok Wai, Jul 2021 - Dec 2023)"
    url: https://www.hk01.com/社會新聞/707281/北部都會區-蠔殼圍魚塘疑遭填土-抽乾塘水-部份屬原居民村代表
    verified: true
    note: "HK01 (opened) reports at least 3 ponds on the east side near Liu Pok: one fully drained, one split into three with fill, one area with bunds raised ~2 m with fill. Compare 2021-03 against 2022-03. Mixed drain and fill, so 'filling or drain-down' is an acceptable answer for some ponds; pick a pond the report shows as filled. Coordinates estimated from the village name; check on imagery."
  - place: "Fishpond beside Tun Yu Road (惇裕路), San Tin, Yuen Long, Hong Kong"
    lat: 22.500
    lon: 114.064
    location_precision: approximate
    date: 2023-05
    expected: detected
    source: "The Standard - 80 hectares of wetlands destroyed after North Metro plan bared: green groups (19 Jan 2024); Greenpeace HK press release 19 Jan 2024"
    url: https://www.thestandard.com.hk/news/article/59681/80-hectares-of-wetlands-destroyed-after-North-Metro-plan-bared-green-groups
    verified: true
    note: "Place and month confirmed in the article: from May 2023 the pond bund was widened and surfaced and material placed around the pond. Mostly bund and edge change, so this is a stretch case, not a must-detect case; compare 2023-04 against 2024-01 and move to new_bare_or_built if the pond interior keeps water. Coordinates NOT confirmed: locate the road on GeoInfo Map or OSM first."
  - {place: "San Tin Technopole fishponds (Sam Po Shue side), San Tin, Yuen Long, Hong Kong", lat: 22.505, lon: 114.07, location_precision: "approximate", date: "2025-12", expected: "detected", source: "SCMP (Jan 2024) - Hong Kong scales back proposed wetland park to about two-thirds of its original size to make way for technology zone", url: "https://scmp.com/news/hong-kong/society/article/3250616/hong-kong-scales-back-proposed-wetland-park-about-two-thirds-its-original-size-make-way-technology", verified: false, note: "Search results state that about 90 ha of fishponds are to be filled for the San Tin Technopole; CEDD says Phase 1 Stage 1 site formation began 31 Dec 2024 (https://cedd.gov.hk/eng/our-projects/major-projects/index-id-178.html). No source found that dates the filling of a particular pond, and the SCMP page was not opened (paywall), so verified is false. Before use, pick ponds inside the works boundary that held water in late 2024 and are dry fill by 2026 on imagery. Same programme as the new_bare_or_built San Tin case; keep both in the same backtest split."}
controls:
  - place: "Mai Po gei wai and fishponds, Deep Bay, Hong Kong"
    lat: 22.488
    lon: 114.037
    location_precision: approximate
    date: 2024-01
    expected: not_detected
    source: "Ng, Yu, Dingle, Lee 2025 - poster abstract, Waterbird Society and PSG joint meeting (Lingnan University scholars page): winter drain-down of Deep Bay fishponds"
    url: https://scholars.ln.edu.hk/en/publications/exploring-the-interactions-between-waterbird-and-aquatic-macroinv/
    verified: false
    note: "Hard control: ponds are drained in rotation in winter for waterbirds and refill later, so water drops but nothing is filled. The poster abstract confirms the practice; exact ponds and month not checked. Choose gei wai or ponds inside the WWF-managed reserve and a Nov-Feb window; expect water down, then refilled by spring."
  - place: "Hong Kong Wetland Park reserve ponds, Tin Shui Wai, Hong Kong"
    lat: 22.467
    lon: 114.007
    location_precision: approximate
    date: 2022-06
    expected: not_detected
    source: "Hong Kong Wetland Park (AFCD) - About us: ~60 ha wetland reserve of constructed and re-created habitats"
    url: https://www.wetlandpark.gov.hk/en/aboutus
    verified: false
    note: "Government-managed reserve, so filling is very unlikely; pick open-water ponds inside the existing reserve, not the visitor centre and not the proposed expansion area (surveyed for damage in the 2021-2023 study). Not checked against site records for this month."
  - {place: "Tai Sang Wai fishponds, Yuen Long, Hong Kong", lat: 22.47, lon: 114.04, location_precision: "approximate", date: "2024-06", expected: "not_detected", source: "Active fishponds in the Deep Bay wetland buffer, popular for photography; no filling found in news", url: "https://www.hkbws.org.hk/cms/en/hkbws/work/habitat-management/fishpond/knowing-fishpond/learn-fishpond/value-function-en", verified: false, note: "URL is HKBWS background on fishpond value, not proof that these ponds were unchanged. Ponds are drained and re-filled in rotation, so this control checks that drain-down is not called filling. Check 2023-06 vs 2024-06 scenes before use."}
sources:
  - title: "McFeeters 1996, The use of the Normalized Difference Water Index (NDWI) in the delineation of open water features (Int. J. Remote Sensing)"
    url: https://doi.org/10.1080/01431169608948714
  - title: "Gao 1996, NDWI - a normalized difference water index for remote sensing of vegetation liquid water from space (Remote Sensing of Environment)"
    url: https://doi.org/10.1016/S0034-4257(96)00067-3
  - title: "Zha, Gao, Ni 2003, Use of normalized difference built-up index in automatically mapping urban areas from TM imagery (Int. J. Remote Sensing)"
    url: https://doi.org/10.1080/01431160304987
  - title: "ESA Sentinel-1 applications (calm water appears dark in SAR backscatter)"
    url: https://sentiwiki.copernicus.eu/web/s1-applications
---

## What it is

A fishpond or wetland that held water is now covered with soil, rubble or
hardcore, and the water does not come back. In Hong Kong, green groups have
reported pond and wetland loss in the Deep Bay and Northern Metropolis
fishpond area (The Standard, Jan 2024). Filling can be a step before
building, storage or farming change. Images alone never say who did it or
whether it was allowed.

## How it shows up from space

- **Water index (NDWI) drops** by more than 0.2 and ends below 0 inside the
  pond outline, while neighbouring ponds keep their water (local change).
- **It persists**: at least 3 later clear images over 90+ days, including the
  wet season, still show no water. This is what separates fill from drain-down.
- **Moisture (NDMI) is low**: dry fill reads below about -0.05; a freshly
  drained bed is wet mud near 0 to 0.2.
- **Radar gets much brighter** (calm water ~-18 to -25 dB, land ~-5 to -12 dB).
  Use the median of several same-orbit scenes. Radar shows water is gone, not
  whether the pond was drained or filled.
- **Bare (NDBI) above 0 and greenness low** (NDVI under ~0.25) on fresh fill.

Change can be sudden (days) or progressive over weeks to months as fill
advances from a bund; track the water-covered fraction of the pond over time.

## How to tell it apart

- **Seasonal drain-down**: ponds are drained for harvest or winter birds, then
  refilled. A drained bed is wet mud, greens quickly and refills. Do not say
  "filling" without the persistence check.
- **Water loss**: the bed stays wet or grows reeds and can refill.
- **Construction**: only when later images show buildings, paved pads or
  very bright radar points on the fill.
- **New bare or built ground**: if the area was not water before, it is not
  pond filling.

## Limits

- Say "consistent with filling". Never say who did it or that it was illegal.
- A pond drained and left empty for months looks like fill in optical and
  radar images; only persistence through the wet season separates them.
- Material type, thickness and depth cannot be measured.
- Ponds narrower than about 50 m, filling along one bund, or partial filling
  of under about a quarter of the pond may be missed.
- Algal or turbid ponds may not start with clear water; tide affects gei wai.
- Wet-season cloud can hide optical images for weeks; wind on a pond can
  briefly brighten radar, so use several radar dates.

## Sources

- McFeeters (1996), NDWI for open water.
- Gao (1996), NDWI (NIR-SWIR) for moisture.
- Zha et al. (2003), NDBI for bare and built land.
- ESA Sentinel-1 guidance on water in SAR backscatter.
- Case evidence: HK01 (Dec 2021), The Standard (Jan 2024).
