---
id: new_bare_or_built
type: event
version: 1
status: draft
name: New bare ground or built surface
aliases: [land clearing, site formation, earthworks, land development, new development, quarry, paving, reclamation, bare soil, cleared land, brownfield, open storage, paved over, concreted over, bulldozed, 平整土地, 地盤平整, 開發, 填海, 清地, 爛地, 石礦場, 棕地, 露天貯物, 鏟平, 推平, 石屎地, 泥頭, reclaimed, cleared, land reclamation, 新填海, 清咗]
category: urban
summary: An area that used to be vegetated or water is now bare soil, rock, sand fill or a hard built surface, and the specific cause cannot be pinned down further.
min_size_m: 50
timing: any
occurs_in: [tree_cover, shrubland, grassland, cropland, built_up, bare_sparse, open_water, herbaceous_wetland, mangroves, steep_hillside, fish_ponds]
triggered_by: []
signs:
  - measure: bare
    change: up
    by_more_than: 0.15
    timing: any
    spatial: local
    shape: "sharp, straight-edged or blocky outline"
    weight: 3
    optional: false
    note: "Soil, fill, rock and concrete reflect more SWIR than NIR; vegetation to bare is typically +0.2 to +0.4 NDBI. 20 m band. Unreliable when the before-state is water; rely on the water and roughness signs there."
  - measure: bare
    change: stable
    timing: any
    spatial: local
    shape: "stays raised across >= 2 later clear scenes, ideally the same season a year on"
    weight: 2
    optional: false
    note: Persistence of the NDBI rise separates new bare ground from seasonal drying and harvest. Only counts after a rise was seen.
  - measure: greenness
    change: down
    by_more_than: 0.25
    timing: any
    spatial: local
    weight: 2
    optional: true
    note: Applies when the patch was vegetated before.
  - measure: water
    change: down
    by_more_than: 0.3
    timing: any
    spatial: local
    weight: 2
    optional: true
    note: Applies when the patch was water before (reclamation, pond fill); NDWI goes from above 0 to below 0.
  - measure: greenness
    change: below
    threshold: 0.2
    spatial: local
    weight: 1
    optional: false
    note: End state is bare or built (NDVI about 0 to 0.2). A state check only, so low weight.
  - measure: water
    change: below
    threshold: 0
    spatial: local
    weight: 1
    optional: false
    note: "Patch reads as dry land (NDWI < 0). Weak on dark roofs, asphalt and wet fresh fill, which can sit near 0 (Xu 2006); never use alone."
  - measure: roughness
    change: outside_band
    by_more_than: 3
    spatial: local
    weight: 1
    optional: true
    note: "Absolute change in patch-mean VV (same orbit direction, >= ~25 pixels) of more than 3 dB, either direction: up ~8 to 15 dB where water becomes land (about -20 to about -8 dB), up where structures appear, often down where forest is graded to smooth soil. Single pixels are within speckle. Sees through cloud."
  - measure: slope_deg
    change: below
    threshold: 15
    weight: 1
    optional: true
    note: Planned works and reclamation are usually on gentle ground; a scar on a steep slope points towards landslide instead.
looks_like:
  - event: seasonal
    tell_apart_by: Seasonal browning or dry-season bare fields re-green the next wet season; new bare or built ground keeps raised NDBI in the same season a year later. If less than a year of data exists after the change, compare against the same season in earlier years and say the seasonal explanation is not yet ruled out.
    discriminating_measures: [greenness, bare, rain_mm]
  - event: construction
    tell_apart_by: "Construction adds vertical structures: Sentinel-1 VV rises by more than ~5 dB within the site over several acquisitions (double bounce), while NDBI stays high and NDVI near 0. Flat bare fill or cleared soil shows no such sustained radar rise, so keep the generic new_bare_or_built."
    discriminating_measures: [roughness, bare, greenness]
  - event: landslide
    tell_apart_by: A landslide is a sudden scar, elongated downslope, on ground steeper than ~25-30 degrees, usually within days of heavy rain (rain_mm above ~100 mm in 1-3 days). General works are blocky, on gentle ground (under 15 degrees), and expand across several scenes.
    discriminating_measures: [slope_deg, rain_mm, greenness]
  - event: pond_filling
    tell_apart_by: Pond filling is the specific case where the patch was open water inside a pond grid before turning bare; check the water measure before the change and the fish_ponds setting.
    discriminating_measures: [water, roughness, bare]
  - event: vegetation_loss
    tell_apart_by: Vegetation loss can leave grass, scrub or regrowth behind (NDVI drops but stays above about 0.2); new bare or built ground drops to near-zero NDVI with an NDBI rise of more than 0.15.
    discriminating_measures: [greenness, bare]
  - event: water_loss
    tell_apart_by: Exposed wet mud keeps NDWI near 0 and high NDMI, and NDBI stays low because water absorbs SWIR; the water often returns after rain. New fill or hard surface dries out, NDBI rises by more than 0.15 and stays up regardless of rain.
    discriminating_measures: [water, moisture, bare, rain_mm]
  - event: harvest
    tell_apart_by: Harvest happens on cropland, follows the crop calendar and the field re-greens within weeks to months; new bare or built ground does not re-green.
    discriminating_measures: [greenness, bare, land_cover]
cannot_tell:
  - Who did the work, why, or whether it was permitted; the satellite only sees surface change.
  - What will be built, or whether the surface is soil, fill, gravel, concrete or a roof, at 10-20 m.
  - Patches smaller than about 50 m across (NDBI and moisture use 20 m pixels; edges are mixed), or changes hidden by long cloudy spells, common in Hong Kong from May to September.
  - A fresh burn scar or ploughed field can look similar for a few weeks (burns also raise NDBI); wait for a later scene or check fire detections before calling it persistent.
  - Clearing under remaining tree canopy, or thinning, is not visible.
  - Radar is unreliable on steep slopes (layover/shadow) and needs a patch of at least ~5x5 pixels to beat speckle.
  - Temporary stockpiles, open storage or site hoarding cannot be told from permanent change.
  - Formed sites that are hydroseeded or left idle can re-green within months and look like recovery, even though the land was permanently altered.
confidence:
  high_min_weight: 10
  medium_min_weight: 7
suggested_blocks: [then_now, timeline, highlight, hypotheses, stat, limits, compare]
wording:
  use: ["consistent with new bare ground or a built surface", "the surface changed from vegetation/water to bare or built", "satellite images show", "consistent with land works or other surface change; cause not identified", "與新的裸地或建成地面相符"]
  avoid: ["illegal", "unauthorised", "unpermitted", "unlawful", "dumping", "fly-tipping", "encroachment", "brownfield abuse", "destroyed by", "the developer", "the government cleared", "land grab", "naming any person or company", "非法", "違法", "違例", "傾倒", "霸地", "破壞"]
cases:
  - place: Tung Chung East reclamation, Lantau, Hong Kong
    lat: 22.301
    lon: 113.960
    location_precision: approximate
    date: 2017-12-29
    expected: detected
    source: CEDD - Tung Chung New Town Extension - Reclamation and Advance Works (Contract NL/2017/03)
    url: https://www.cedd.gov.hk/eng/our-projects/major-projects/index-id-84.html
    verified: true
    note: "About 130 ha reclaimed at Tung Chung East by a non-dredged method; works commenced 29 Dec 2017 (CEDD); launch ceremony 5 Feb 2018 (info.gov.hk P2018020500719); completion 2023. Compare late 2017 vs 2021 scenes; water turns to fill, so the water and roughness signs carry it. Point moved onto the reclaimed platform (reverse geocode only, not checked in imagery). Earth Search sentinel-2-l2a has clear scenes here through 2017, including 21 and 31 Dec 2017 (checked 3 Oct 2026), so the before-scene is available."
  - place: San Tin Technopole Phase 1 Stage 1, Northern Metropolis, Hong Kong
    lat: 22.497
    lon: 114.072
    location_precision: approximate
    date: 2024-12-31
    expected: detected
    source: CEDD - San Tin Technopole Phase 1 Stage 1 Works, Site Formation and Engineering Infrastructure
    url: https://cedd.gov.hk/eng/our-projects/major-projects/index-id-178.html
    verified: true
    note: "Site clearance and formation of about 158 ha; contracts ND/2024/09 (~2 years) and ND/2024/10 (~3 years) commenced 31 Dec 2024, ND/2025/01 from 9 Mar 2026 (CEDD). Parts may not be cleared yet; compare Dec 2024 vs mid-2026 scenes. Coordinate not checked against works boundary (may sit on San Tin village); place it using the LegCo plan https://legco.gov.hk/yr2024/english/panels/dev/papers/dev20241022cb1-1346-4-e.pdf before testing. Former fish-pond patches may better match pond_filling."
  - {place: "Hung Shui Kiu / Ha Tsuen New Development Area first-phase works, Yuen Long, Hong Kong", lat: 22.425, lon: 113.995, location_precision: "approximate", date: "2020-07", expected: "detected", source: "CEDD - Hung Shui Kiu/Ha Tsuen New Development Area, First Phase Development", url: "https://cedd.gov.hk/eng/our-projects/major-projects/index-id-91.html", verified: true, note: "CEDD (via search) says site formation and engineering works commenced progressively from July 2020 (Advance Works Phase 1 done Nov 2020, Phase 2 Aug 2020-2024, then Stage 1). Much of the area was already open storage and brownfield, so expect bare to rise only where vegetated plots or ponds were cleared. Compare 2020 vs 2023 scenes (many clear Earth Search scenes). Point is the NDA centre; place it on a cleared plot using the CEDD layout plan."}
controls:
  - place: Tai Lam Country Park woodland, New Territories, Hong Kong
    lat: 22.400
    lon: 114.050
    location_precision: approximate
    date: 2024-12
    expected: not_detected
    source: AFCD - Tai Lam Country Park (designated 1979, 5,412 ha)
    url: https://www.afcd.gov.hk/english/country/cou_vis/cou_vis_cou/cou_vis_cou_tl/cou_vis_cou_tl.html
    verified: false
    note: "Protected status confirmed by AFCD (via reviewer). Point moved north-east, away from the Tai Lam Chung reservoir shore and the forest track, but not checked in imagery. Tai Lam is among the parks with the most hill fires; a quick search found no Tai Lam fire for Dec 2024 - 2026 but this is not conclusive. Tests seasonal browning."
  - place: Mai Po Nature Reserve gei wai and fish ponds, Hong Kong
    lat: 22.49
    lon: 114.04
    location_precision: approximate
    date: 2024-12
    expected: not_detected
    source: AFCD - Mai Po Inner Deep Bay Ramsar Site
    url: https://www.afcd.gov.hk/english/conservation/con_wet/con_wet_look_des/con_wet_look_des.html
    verified: false
    note: "AFCD confirms a 1,540 ha Ramsar Site (1995) with gei wais and fishponds. Same setting and window as San Tin; tests pond drawdown versus real fill. Point not checked in imagery."
  - place: Kwai Tsing Container Terminals, Hong Kong
    lat: 22.338
    lon: 114.120
    location_precision: approximate
    date: 2024-12
    expected: not_detected
    source: Hong Kong Maritime and Port Development Board - Port of Hong Kong
    url: https://www.hkmpdb.gov.hk/en/port.html
    verified: false
    note: "Long-established paved terminal (about 279 ha, per Marine Department figures found by search; page not opened). Already bare/built before the window; must not trigger without an NDBI rise."
sources:
  - title: "Zha, Gao and Ni (2003) Use of normalized difference built-up index in automatically mapping urban areas from TM imagery, International Journal of Remote Sensing 24(3): 583-594"
    url: https://doi.org/10.1080/01431160304987
  - title: "Xu (2006) Modification of normalised difference water index (NDWI) to enhance open water features in remotely sensed imagery, IJRS 27(14): 3025-3033"
    url: https://doi.org/10.1080/01431160600589179
  - title: USGS - Landsat Normalized Difference Vegetation Index
    url: https://www.usgs.gov/landsat-missions/landsat-normalized-difference-vegetation-index
  - title: ESA SentiWiki - Sentinel-2 mission
    url: https://sentiwiki.copernicus.eu/web/s2-mission
  - title: ESA SentiWiki - Sentinel-1 mission
    url: https://sentiwiki.copernicus.eu/web/s1-mission
---

## What it is
A patch of land that was vegetated (forest, scrub, grass, crops, mangrove) or water (sea, pond, wetland) has become bare soil, rock, sand fill or a hard built surface. Typical causes are site formation, reclamation, quarrying, clearing to soil, open storage and paving. This is the generic parent card: use it when the change is clear but the specific cause (construction, landslide, pond filling) cannot be told apart.

## How it shows up from space
- **bare (NDBI) rises** by more than about 0.15 inside a sharp outline, and **stays raised** across later scenes and the same season a year on.
- **greenness (NDVI) drops** by more than 0.25 if the patch was vegetated, or **water (NDWI) drops** from above 0 to below 0 if it was water; either way NDVI ends near 0-0.2.
- **roughness (Sentinel-1)** patch-mean changes by more than 3 dB: up when water becomes land or structures appear, often down when forest becomes smooth soil. Useful when Sentinel-2 is cloudy.
- A patch that was already bare or built and did not change must not score: state-only signs stay below medium.
- Usually on gentle slopes; shapes are blocky, straight-edged and grow over months.

## How to tell it apart
- **Seasonal / harvest:** these re-green; new bare ground does not. Compare the same season a year apart, or earlier years if the change is recent.
- **Vegetation loss:** NDVI falls but stays above about 0.2 (grass, scrub, regrowth) and NDBI barely rises.
- **Landslide:** sudden, downslope scar on ground steeper than ~25-30 degrees, within days of heavy rain.
- **Pond filling:** was open water in a pond grid just before; prefer that card when the before-water is clear.
- **Construction:** prefer that card when radar VV rises by more than ~5 dB over several scenes (structures).
- **Water loss:** wet mud keeps NDWI near 0, high NDMI and low NDBI, and often refills after rain.

## Limits
- Cannot say who did the work, why, or whether it was permitted. Use "consistent with" wording only.
- Cannot tell soil from concrete or a roof reliably at 10-20 m, nor what will be built, nor temporary stockpiles from permanent change.
- Patches below about 50 m across are unreliable (NDBI is 20 m); long cloudy spells (May-September in Hong Kong) delay detection.
- Clearing under remaining canopy is invisible; radar fails on steep slopes (layover/shadow).
- A fresh burn scar or ploughed field can look similar for a few weeks; wait for a later scene. Hydroseeded sites can re-green.

## Sources
- Zha et al. 2003, NDBI (doi:10.1080/01431160304987); Xu 2006, NDWI on built surfaces (doi:10.1080/01431160600589179).
- USGS, Landsat NDVI.
- ESA SentiWiki, Sentinel-2 and Sentinel-1 mission pages.
- Cases: CEDD Tung Chung New Town Extension reclamation project page (works from 29 Dec 2017); CEDD San Tin Technopole Phase 1 Stage 1 project page.
