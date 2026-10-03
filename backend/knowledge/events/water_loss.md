---
id: water_loss
type: event
version: 1
status: draft
name: Water loss (shrinking lake, reservoir or wetland)
aliases: [shrinking lake, reservoir drop, low reservoir, reservoir level, water level drop, low water level, drying lake, lake drying up, dried up, drying, receding shoreline, exposed lake bed, wetland drying, 水位下降, 水塘水位下降, 水塘見底, 水塘乾咗, 乾塘, 乾涸, 湖泊萎縮, 濕地乾涸, 水位低, 水庫乾涸, drought, droughts, reservoir dropped, water level lower, lake shrunk, shrinking reservoir, 乾旱, 旱災, 制水, 水塘水位低]
category: water
summary: Open water that was there before is gone or smaller, leaving exposed shore or lake bed.
min_size_m: 30
timing: any
occurs_in: [open_water, herbaceous_wetland, fish_ponds, bare_sparse, snow_ice, moss_lichen]
signs:
  - measure: water
    change: down
    by_more_than: 0.2
    timing: any
    spatial: any
    shape: "a band along the old shoreline, or whole shallow arms, bays or ponds turning to land; over days (pond drained, draw-down) or months (drought)"
    weight: 3
    optional: false
    note: "the earlier image must show NDWI > 0 (or radar < -15 dB) at this pixel, otherwise it is not water loss; count only pixels that cross from > 0 before to < 0 after, since turbidity or algae can lower NDWI without any loss"
  - measure: roughness
    change: up
    by_more_than: 3
    timing: any
    spatial: any
    shape: "over days (pond drained, draw-down) or months (drought)"
    weight: 2
    optional: false
    note: "calm water is very dark on radar (~-18 to -25 dB); dry exposed bed reads like land (~-5 to -12 dB); same orbit direction only; compare means over several pixels (speckle), features of ~50 m or more; wet exposed mud may stay dark (~-15 to -20 dB) until it dries; use several dates to exclude windy scenes"
  - measure: bare
    change: up
    by_more_than: 0.1
    timing: gradual
    spatial: any
    shape: "pale ring or 'bathtub ring' of exposed sediment around the remaining water"
    weight: 1
    optional: false
    note: "exposed sand, rock or salt crust raises NDBI; 20 m band; freshly exposed wet mud may stay low until it dries; NDBI over water is unstable, so judge on the exposed ring after it dries"
  - measure: rain_mm
    change: below
    threshold: 50
    timing: gradual
    spatial: regional
    shape: "sum of daily rain over the 90 days before the after-image; where a same-window climatology from earlier years is available, use below that instead"
    weight: 1
    optional: false
    note: "dry spell before the after-image (under 50 mm in 90 days, or below the same months in earlier years); supports drought only; absence does not rule out water loss (draw-down, diversion, pond draining)"
  - measure: greenness
    change: above
    threshold: 0.3
    timing: gradual
    spatial: local
    weight: 1
    optional: true
    note: "weeks to months after exposure, plants may colonise the dry bed (NDVI > ~0.3 = real vegetation). Water to bare mud alone raises NDVI from below 0 to ~0.1, so a rise by itself is not evidence of plants. Salt or rock beds stay bare."
  - measure: heat
    change: up
    timing: gradual
    spatial: local
    weight: 1
    optional: true
    note: "planned measure; 100 m native thermal, only for large water bodies; exposed bed is warmer than water by day in the warm season"
looks_like:
  - event: seasonal
    tell_apart_by: "Compare with the same month in earlier years and at similar tide level; normal dry-season dips, routine fish-pond draining and low tide refill on schedule, while water loss stays below past years for the same season."
    discriminating_measures: [water, roughness, rain_mm]
  - event: pond_filling
    tell_apart_by: "A drained pond or lake bed returns to water (NDWI > 0, radar < ~-18 dB) after rain or restocking within weeks to months; filled ground keeps high NDBI and bright radar across the following wet season, and the bunds between ponds often disappear."
    discriminating_measures: [water, roughness, bare]
  - event: new_bare_or_built
    tell_apart_by: "New bare or built ground appears on what was land before; water loss starts from a pixel that was open water (positive NDWI, very low radar backscatter) in the earlier image."
    discriminating_measures: [water, roughness]
cannot_tell:
  - "Satellites see surface area, not depth or volume; a steep-sided reservoir can lose a lot of water with little visible shrinking."
  - "The cause (drought, heavy use, planned draw-down for dam works, diversion upstream) cannot be told from the images alone."
  - "Cloud can hide optical images for weeks in the wet season; radar helps, but wind-roughened water can look like land on radar."
  - "Features narrower than about 30 m (small streams, narrow channels) are not reliably seen; radar and NDBI confirmation need about 50 m or more."
  - "Coastal and intertidal areas change with the tide at the moment of each image; compare images taken at similar tide levels before calling water loss."
  - "Ice or snow on a lake hides the water and can look like land; check the season and temperature."
  - "Floating plants or algae covering the surface can make water look like land in optical images; radar stays dark if water is still underneath."
  - "Shadows from steep hills or tall buildings can look like water in one image; use radar or several dates."
  - "Water hidden under tree or mangrove canopy cannot be seen, so its loss cannot be measured."
confidence:
  high_min_weight: 6
  medium_min_weight: 4
suggested_blocks: [then_now, timeline, stat, highlight, hypotheses, limits, timelapse, compare]
wording:
  use: ["the water surface is smaller than", "less open water than the same month in earlier years", "exposed shoreline", "consistent with lower water levels", "consistent with drought (only when rain was also below normal)"]
  avoid: ["caused by", "illegal extraction", "drained by", "stolen", "over-pumped by", "is to blame", "the reservoir is empty", "% full", "lost X% of its water", "water shortage", "制水"]
cases:
  - place: "Lake Mead, Las Vegas Bay and Boulder Basin, Nevada, USA"
    lat: 36.12
    lon: -114.80
    location_precision: approximate
    date: 2022-05
    expected: detected
    source: "NASA Photojournal - Lake Mead-2022 (Landsat, 19 May 2000 vs 25 May 2022)"
    url: https://science.nasa.gov/photojournal/lake-mead-2022/
    verified: true
    note: "Reservoir fell to about 30% capacity, elevation ~1,049 ft vs 1,204 ft in 2000; record low reached July 2022. For Sentinel-2 testing use 2019-05 as baseline (~1,088 ft, 41% capacity per Colorado River Commission of Nevada Hydrology Report May 2019, citing USBR)"
  - place: "Theewaterskloof Dam, Western Cape, South Africa"
    lat: -34.05
    lon: 19.27
    location_precision: approximate
    date: 2018-01
    expected: detected
    source: "NASA Earth Observatory - Cape Town's Reservoirs Rebound"
    url: https://science.nasa.gov/earth/earth-observatory/cape-towns-reservoirs-rebound-92428
    verified: true
    note: "Down to about 13% capacity in January 2018 after three years of drought; refilled to ~40% by July 2018 (good recovery test). Earth Search sentinel-2-l2a has clear scenes here from Oct 2017 to Mar 2018 (checked 3 Oct 2026), but none before the drought began, so use the 2017-10 vs 2018-01 decline or the 2018-01 vs 2019-2020 refill"
  - place: "Lake Poopo, Oruro, Bolivia"
    lat: -18.80
    lon: -67.08
    location_precision: approximate
    date: 2016-01
    expected: detected
    source: "NASA Earth Observatory - Bolivia's Lake Poopo Disappears"
    url: https://science.nasa.gov/earth/earth-observatory/bolivias-lake-poopo-disappears-87363
    verified: true
    note: "Landsat-only case: Landsat 8 April 2013 vs January 2016; lake essentially dry by Dec 2015, before a usable Sentinel-2 baseline, so do not count it against earth v1. EXCLUDED from backtests and the hidden holdout: Earth Search sentinel-2-l2a returned no scenes here for Jun 2015-Mar 2016 (checked 3 Oct 2026), so it is not scored as a miss; the Sau reservoir case replaces it. Cause attribution (drought, diversion) comes from NASA, not from the imagery; the agent must still say 'consistent with'"
  - {place: "Sau reservoir (Pantano de Sau), Osona, Catalonia, Spain", lat: 41.97, lon: 2.39, location_precision: "approximate", date: "2024-03", expected: "detected", source: "NASA Earth Observatory - Sau Reservoir Dries Up (11 Mar 2024)", url: "https://science.nasa.gov/earth/earth-observatory/sau-reservoir-dries-up-152534", verified: true, note: "Article (opened): about 7% of capacity in Apr 2023 and about 1% in early Mar 2024, against a usual March level of about 65%; Landsat images of 3 Mar 2023 and 4 Mar 2024. Sentinel-2 case for earth v1: Earth Search L2A has clear scenes on 3 and 18 Dec 2023 and 11 Feb 2024; take the before-scene from a wetter spring (2021 or earlier). Point is the reservoir body near Sant Roma de Sau."}
controls:
  - place: "Lake Geneva (Leman), open water south of Lausanne, Switzerland"
    lat: 46.45
    lon: 6.63
    location_precision: approximate
    date: 2021-07
    expected: not_detected
    source: "Republique et canton de Geneve - La gestion des niveaux du lac (Seujet dam keeps the level between 372.15 and 372.30 m from June to December)"
    url: https://www.ge.ch/node/12472
    verified: true
    note: "Large deep regulated lake; summer level held within ~15 cm, so no shoreline retreat expected. Check the 2021-07 S2 scene is cloud-free before use"
  - place: "High Island Reservoir, Sai Kung, Hong Kong"
    lat: 22.375
    lon: 114.351
    location_precision: approximate
    date: 2022-06
    expected: not_detected
    source: "HK Government press release - LCQ22 reply on reservoirs, 28 Jun 2023 (High Island: 281 Mm3, 6.95 km2 surface)"
    url: https://www.info.gov.hk/gia/general/202306/28/P2023062800485.htm
    verified: false
    note: "Source confirms reservoir size, not the June 2022 level; wet-season month and the reservoir also stores Dongjiang water, so a large surface drop is unlikely. Check WSD storage figures before promoting"
  - place: "Mai Po gei wai and fish ponds, Deep Bay, Hong Kong"
    lat: 22.49
    lon: 114.04
    location_precision: approximate
    date: 2022-01
    expected: not_detected
    source: "WWF-Hong Kong - Gei wai (gei wai are drained in rotation through the winter for waterbirds)"
    url: https://wwfhk.awsassets.panda.org/downloads/gei_wai.pdf
    verified: false
    note: "Compare the same winter month in consecutive years (e.g. 2021-01 vs 2022-01) at similar tide level; tests rejection of routine seasonal pond draining and tides. Source describes the draining cycle, not a specific year"
sources:
  - title: "McFeeters 1996, The use of the Normalized Difference Water Index (NDWI) in the delineation of open water features (Int. J. Remote Sensing)"
    url: https://doi.org/10.1080/01431169608948714
  - title: "Pekel et al. 2016, High-resolution mapping of global surface water and its long-term changes (Nature)"
    url: https://www.nature.com/articles/nature20584
  - title: "Copernicus SentiWiki - Sentinel-1 Applications (flood monitoring: calm water gives low C-band backscatter)"
    url: https://sentiwiki.copernicus.eu/web/s1-applications
---

## What it is

A lake, reservoir, pond or wetland covers less area than before. The water has
withdrawn from the shore and left mud, sand, rock or salt crust behind. Common
reasons are drought, heavy use, planned draw-down, or water taken upstream, but
the images alone do not say which.

## How it shows up from space

- **Water index (NDWI) drops** from above 0 to below 0 along the old shoreline or
  across whole shallow bays. This is the main sign.
- **Radar gets brighter**: calm water is very dark (about -18 to -25 dB); dry
  lake bed looks like land (about -5 to -12 dB). Radar sees through cloud, so it
  confirms the change in the wet season. Compare only the same orbit direction.
- **Bare index (NDBI) rises** on the exposed ring ("bathtub ring").
- **Rain** was below normal for months in many drought cases (supporting, not
  required).
- Later, **plants may grow** on the dry bed (greenness above ~0.3), unless it is
  salty. Water turning to bare mud raises greenness a little by itself; that is
  not plant growth.

Drought shrinks water over months to years; a drained pond or reservoir
draw-down can take only days. Look at a timeline, not just two dates.

## How to tell it apart

- **Seasonal**: many reservoirs and wetlands shrink every dry season, fish ponds
  and gei wai are drained on a cycle, and tidal flats come and go with the tide.
  Compare with the same month in earlier years, at similar tide level.
- **Pond filling**: a drained pond refills after rain or restocking; filled
  ground stays bare and bright on radar through the next wet season, and the
  bunds between ponds often disappear.
- **New bare or built ground**: check the earlier image. If the pixel was not
  water then, it is not water loss.

## Limits

- Area is not volume. A steep reservoir can lose much water with little visible
  change.
- The cause cannot be seen. At most the change is "consistent with drought" when
  rain was also below normal for the season; draw-down for works, heavy use or
  upstream diversion look the same. No one can be blamed from these images.
- Tides, lake ice, floating plants or algae, and hill or building shadow can all
  mimic water loss; water under tree or mangrove canopy cannot be seen.
- Wind can roughen water and make radar look like land; one radar date is not
  enough.
- Narrow streams and channels under ~30 m wide are not reliable; radar and NDBI
  need ~50 m.

## Sources

- McFeeters (1996), NDWI for open water.
- Pekel et al. (2016), global surface water change, Nature.
- Copernicus SentiWiki, Sentinel-1 applications (water in SAR backscatter).
- NASA Earth Observatory and Photojournal case images (Lake Mead, Theewaterskloof, Lake Poopo).
