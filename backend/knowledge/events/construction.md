---
id: construction
type: event
version: 1
status: draft
name: Construction works
aliases: [construction, construction site, building works, building site, being built, under construction, building under construction, site formation, site works, road works, roadworks, new road, new building, new estate, housing development, development works, reclamation works, earthworks, 地盤, 工地, 建築地盤, 工程, 建築工程, 興建, 興建中, 起樓, 起緊樓, 起緊嘢, 新樓盤, 大興土木, 地盤平整, 道路工程, 修路, 整路, 掘路, 填海工程, built, new houses, new housing, new airport, new runway, 起屋, 建屋, 新路]
category: urban
summary: A site is being built on - cleared and levelled first, then filled with roads, slabs and buildings over weeks to years.
min_size_m: 50
timing: gradual
occurs_in: [tree_cover, shrubland, grassland, cropland, built_up, bare_sparse, open_water, herbaceous_wetland, mangroves, steep_hillside, fish_ponds]
triggered_by:
  - {event: new_bare_or_built, note: "Site formation (clearing, levelling, filling) usually comes first; construction is the later stage where structures appear on the cleared platform."}
  - {event: vegetation_loss, note: "Clearing of vegetation often precedes works on green sites."}
signs:
  - {measure: bare, change: up, by_more_than: 0.1, timing: any, spatial: local, shape: "straight edges, right angles and blocky lots; often touching an existing road or coastline", weight: 3, optional: false, note: "Clearing or fill raises SWIR relative to NIR, so NDBI jumps (often suddenly, between two scenes) and stays elevated relative to the surrounding ring. It may dip again once roofs and asphalt cover the soil, so judge the plateau, not a continuing rise. NDBI alone does not separate soil from buildings."}
  - {measure: greenness, change: down, by_more_than: 0.2, timing: any, spatial: local, shape: "stays below about 0.2 in every clear scene for at least one growing season after the drop (no regrowth)", weight: 2, optional: false, note: "Vegetated site drops to bare or built (NDVI about 0 to 0.2) while the surrounding ring keeps its normal greenness; no regrowth separates works from harvest and seasonal browning. Does not apply to reclamation or rebuilding on an already built site, where NDVI is already low."}
  - {measure: roughness, change: up, by_more_than: 3, timing: gradual, spatial: local, weight: 3, optional: false, note: "Measured against the cleared or filled platform stage (the lowest post-clearing level), not against the original vegetation or water. Use the footprint mean of a median of 3 or more scenes from the same orbit direction and relative orbit. New walls and frames give double-bounce returns; radar sees through cloud. A rise from water to fill alone is NOT this sign. The >3 dB threshold is a project heuristic, and radar alone misses many new buildings, so it supports rather than drives the call."}
  - {measure: water, change: below, threshold: 0.05, spatial: local, weight: 1, optional: false, note: "The finished site is land. On reclamation NDWI flips from clearly positive (sea) to near or below 0. Built surfaces and shadows can sit near 0 on NDWI, so confirm 'land' with radar roughness rather than NDWI alone."}
  - {measure: slope_deg, change: below, threshold: 15, weight: 1, optional: false, note: "Pre-works DEM slope; most construction footprints sit on gentle ground. Hillside site formation (cut platforms) exists, so failing this sign does not rule construction out."}
  - {measure: heat, change: up, timing: gradual, spatial: local, weight: 1, optional: true, note: "Paved and roofed surfaces are warmer by day than the vegetation or water they replaced. Landsat thermal is 100 m native; only useful for footprints larger than about 200 m."}
looks_like:
  - {event: seasonal, tell_apart_by: "Seasonal change affects the whole landscape and reverses within the year; construction is a sharp local footprint whose bare and radar signal persists across seasons.", discriminating_measures: [bare, roughness, greenness]}
  - {event: new_bare_or_built, tell_apart_by: "New bare ground is the generic case; call it construction only when a radar rise of more than 3 dB above the bare-platform level appears, sustained over several scenes, together with a regular built layout near roads.", discriminating_measures: [roughness, bare]}
  - {event: vegetation_loss, tell_apart_by: "Vegetation loss stops at cleared ground or regrows; construction goes on to a level bare platform and then a radar rise above it as structures appear.", discriminating_measures: [bare, roughness, greenness]}
  - {event: landslide, tell_apart_by: "A landslide appears between two consecutive scenes (sudden), often within days of heavy rain, as a narrow lobate scar elongated downslope. Construction grows over several scenes with straight edges and right angles, and later shows a radar rise above the bare stage.", discriminating_measures: [slope_deg, rain_mm, bare, roughness]}
  - {event: pond_filling, tell_apart_by: "Pond filling turns water into a flat fill platform (a large VV jump from water to land, then a plateau). Construction shows a SECOND radar rise of more than 3 dB above that plateau, together with a regular built layout.", discriminating_measures: [water, roughness, bare]}
cannot_tell: [
  "What is being built, who is building it, or whether it has permission; only the change in surface is visible.",
  "Interior works, renovation, or building on top of an already built site where the surface stays concrete.",
  "Structures or plots smaller than about 50 m across, such as single village houses, footpaths, huts or narrow road widening.",
  "The exact start date when cloud hides the site for weeks; radar helps but shows only coarse texture, not building shape.",
  "Whether bare, hard ground is a building site or open storage, a container yard, a car park or a temporary works area; these look the same from space.",
  "Works hidden under tree canopy, or slopes covered by netting or hydroseeding.",
  "Long cloudy spells (e.g. monsoon summers) can leave months with no optical scene, so greenness, bare and water may rest on only a few dates."
]
confidence: {high_min_weight: 8, medium_min_weight: 5}
suggested_blocks: [then_now, timelapse, timeline, highlight, stat, hypotheses, limits, compare]
wording:
  use: ["consistent with construction works", "the surface changed from vegetation (or water) to bare ground and then built surfaces", "a new built-up footprint appears"]
  avoid: ["illegal", "unlawful", "illegal construction", "unauthorised structure", "unauthorised building works", "UBW", "breach", "violation", "encroachment", "the owner built", "developer", "caused by", "僭建", "違建", "違例建築", "非法", "違法"]
cases:
  - {place: "Kai Tak Sports Park, Kowloon, Hong Kong", lat: 22.3225, lon: 114.1965, location_precision: approximate, date: 2019-02, expected: detected, source: "HKSAR Government press release - LCQ4: Kai Tak Sports Park (20 Mar 2024)", url: "https://www.info.gov.hk/gia/general/202403/20/P2024032000292p.htm", verified: true, note: "Government states construction commenced Feb 2019 on about 28 ha, major facilities done end 2024; park opened in 2025. The pre-works site was already cleared, sparse ex-airport land, so greenness and bare change little: expect detection mainly from the roughness rise above the bare-platform baseline as the stadium rises (2020-2023). Point is the stadium, approximate."}
  - {place: "Kwu Tung North / Fanling North New Development Area first-stage site formation, North District, Hong Kong", lat: 22.505, lon: 114.105, location_precision: approximate, date: 2019-09, expected: detected, source: "CEDD - Advance Site Formation and Engineering Infrastructure Works at Kwu Tung North and Fanling North NDA", url: "https://www.cedd.gov.hk/eng/our-projects/major-projects/index-id-36.html", verified: true, note: "CEDD confirms works commenced Sep 2019 with site formation of about 70 ha across KTN and FLN, contracts running to 2025-2026. Former farmland, villages and brownfield, so this tests the green-to-bare-to-built path. Coordinate is an estimate for Kwu Tung North; check the footprint against imagery before use."}
  - {place: "Hong Kong International Airport third runway reclamation, Chek Lap Kok", lat: 22.335, lon: 113.915, location_precision: approximate, date: 2016-08-01, expected: detected, source: "Airport Authority Hong Kong - Construction of Three-runway System Kicks Off at HKIA", url: "https://threerunwaysystem.hongkongairport.com/en/information-centre/press-release/01082016/", verified: true, note: "Works began Aug 2016, about 650 ha reclaimed north of the airport island; runway paving done Sep 2021, new runway in use from Jul 2022, whole 3RS completed 2024. AA page blocks fetchers (403), so facts were confirmed via Airport Technology and search results. Early works were mostly under water; Earth Search sentinel-2-l2a has no scenes here in 2016 (first clear ones 25 Jan 2017, checked 3 Oct 2026), so the before-scene is Jan 2017 (sand fill only partly above water then) and the after-scene 2019 or later; the change is smaller than the full reclamation. Greenness down does not apply here."}
controls:
  - {place: "Victoria Park, Causeway Bay, Hong Kong", lat: 22.282, lon: 114.188, location_precision: approximate, date: 2019-02, expected: not_detected, source: "Long-established public park in the same city and window as Kai Tak, with no large building works known", url: "https://www.lcsd.gov.hk/en/parks/vp/index.html", verified: false, note: "Window 2019-02 to 2024-12, same as Kai Tak. Assumed unchanged; minor facility works would be below resolution. Verify with imagery before use."}
  - {place: "Open sea south-west of Lung Kwu Chau, Sha Chau and Lung Kwu Chau Marine Park, Hong Kong", lat: 22.365, lon: 113.86, location_precision: approximate, date: 2016-08, expected: not_detected, source: "AFCD - Sha Chau and Lung Kwu Chau Marine Park (designated 1996, about 1,200 ha of open water, outside the 3RS reclamation footprint)", url: "https://www.afcd.gov.hk/english/country/cou_vis/cou_vis_mar/cou_vis_mar_des/cou_vis_mar_des_sha.html", verified: false, note: "Marine park water, so no reclamation is expected. About 2 km from the island; check in imagery that the analysis box stays clear of islands and the 3RS edge; ships may cause short radar spikes."}
  - {place: "Kowloon Park, Tsim Sha Tsui, Hong Kong", lat: 22.3, lon: 114.17, location_precision: "approximate", date: "2019-02", expected: "not_detected", source: "Long-established urban park (opened 1970), same city and window as the Kai Tak case", url: "https://www.lcsd.gov.hk/en/parks/kp/index.html", verified: false, note: "Mixed trees, lawns and pools in a dense built setting; tests that seasonal change and shadows in a city park are not called construction. URL not opened; check that no major works took place in 2019-2022 before use."}
sources:
  - {title: "Zha, Gao and Ni (2003) - Use of normalized difference built-up index in automatically mapping urban areas from TM imagery, Int. J. Remote Sensing", url: "https://doi.org/10.1080/01431160304987"}
  - {title: "Xu (2006) - Modification of normalised difference water index (MNDWI), Int. J. Remote Sensing", url: "https://doi.org/10.1080/01431160600589179"}
  - {title: "EU Space Programme / FPCUP - Automatically Find New Buildings: A Pilot Project Using Sentinel-1", url: "https://eu-space.europa.eu/components/earth-observation-copernicus/fpcup/automatically-find-new-buildings-pilot-project-using-sentinel-1"}
  - {title: "ESA SentiWiki - Sentinel-1 applications", url: "https://sentiwiki.copernicus.eu/web/s1-applications"}
  - {title: "ESA Sentinel-2 mission overview (resolution, revisit)", url: "https://sentiwiki.copernicus.eu/web/s2-mission"}
  - {title: "HKSAR Government - LCQ4: Kai Tak Sports Park", url: "https://www.info.gov.hk/gia/general/202403/20/P2024032000292p.htm"}
  - {title: "CEDD - Kwu Tung North and Fanling North NDA site formation", url: "https://www.cedd.gov.hk/eng/our-projects/major-projects/index-id-36.html"}
  - {title: "Airport Authority Hong Kong - Three-runway System press release (1 Aug 2016)", url: "https://threerunwaysystem.hongkongairport.com/en/information-centre/press-release/01082016/"}
  - {title: "Airport Technology - Hong Kong International Airport (HKIA) Expansion (3RS)", url: "https://www.airport-technology.com/projects/hong-kong-international-airport-hkia-expansion/"}
---

## What it is

Building, road or site works (地盤). A site is usually cleared and levelled
first (site formation), sometimes by filling ponds or reclaiming sea, and then
roads, slabs, frames and buildings rise on it. The whole process takes weeks
for a road widening and months to years for a large project.

## How it shows up from space

- **Bare** jumps inside a sharp, straight-edged footprint and stays above the
  surroundings; it may dip a little once roofs and asphalt cover the soil.
- **Greenness** drops by more than 0.2 to about 0-0.2 on green sites and does
  not come back next season, while the ring around the site stays normal.
- **Roughness** (Sentinel-1 radar) rises by more than 3 dB above the cleared or
  filled platform as walls and frames appear (double-bounce returns). The jump
  from water to fill does not count. Radar sees through cloud, which matters in
  rainy or monsoon seasons.
- **Water** ends near or below 0; on reclamation it flips from sea to land.
- Usually gentle ground (**slope_deg** low on the pre-works DEM), regular lots,
  and contact with an existing road or shoreline.
- A timelapse shows stages: clearing, flat bare platform, then built texture.

## How to tell it apart

- **new_bare_or_built**: same start; construction needs a radar rise above the
  bare platform and a regular layout. Flat bare ground alone fits the generic card.
- **vegetation_loss**: stops at cleared land or regrows.
- **pond_filling**: water to a flat fill plateau with no second radar rise.
- **landslide**: sudden between two scenes, often after heavy rain, a narrow
  lobate scar downslope.
- **seasonal**: whole landscape, reverses within the year.

## Limits

- Cannot say what is built, by whom, or whether it is permitted; only the
  change in surface is visible.
- Rebuilding on an already built site often shows little change.
- Open storage, container yards, car parks and temporary works areas look the
  same as a building site; works under canopy or netting are hidden.
- Features below ~50 m are missed; radar texture is coarse, speckled and
  sensitive to orbit direction and building orientation.
- Long cloudy spells can leave few optical scenes.

## Sources

- Zha et al. (2003), NDBI; Xu (2006), MNDWI.
- EU Space / FPCUP pilot: finding new buildings with Sentinel-1; ESA SentiWiki
  Sentinel-1 applications; ESA Sentinel-2 mission overview.
- HKSAR Government LCQ4 (Kai Tak Sports Park); CEDD (Kwu Tung North / Fanling
  North); Airport Authority and Airport Technology (3RS).
