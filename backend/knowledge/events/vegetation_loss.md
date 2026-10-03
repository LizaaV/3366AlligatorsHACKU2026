---
id: vegetation_loss
type: event
version: 1
status: draft
name: Vegetation loss
aliases: [deforestation, forest loss, clearing, land clearing, vegetation cleared, site clearance, tree loss, trees cut down, trees removed, tree felling, tree cutting, logging, dieback, die-off, dead trees, mangrove dieback, vegetation removal, canopy loss, less green, 植被流失, 植被減少, 砍伐森林, 毀林, 伐林, 伐木, 砍樹, 斬樹, 樹木被砍, 樹林消失, 冇晒啲樹, 綠化地消失, 樹木枯死, 紅樹林枯死, drought stress, deforested, cleared, cut down, felled, 開山, 清除植被, 枯萎]
category: forests
summary: "Plants that were there before are now gone or dead: trees cleared, cut, or died back, leaving less green cover."
min_size_m: 50
timing: any
occurs_in: [tree_cover, shrubland, grassland, cropland, mangroves, herbaceous_wetland, steep_hillside, built_up]
signs:
  - {measure: greenness, change: down, by_more_than: 0.2, timing: any, spatial: any, shape: "patch or block with a clear edge against intact vegetation, or a broad band in regional dieback", weight: 3, optional: false, note: "Loss of green leaf cover is the core sign. Local clearings differ from the surroundings ring; regional dieback may not."}
  - {measure: moisture, change: down, by_more_than: 0.15, timing: any, spatial: any, weight: 2, optional: false, note: "Canopy water content drops (NIR/SWIR pair, independent of the red/NIR greenness pair); under dieback it falls before greenness."}
  - {measure: bare, change: above, threshold: 0.0, spatial: local, weight: 1, optional: false, note: "End-state check: surface now soil- or dead-wood-like (NDBI > 0). NDBI is the exact mirror of NDMI, so this is not independent of the moisture drop; it only confirms the after-state."}
  - {measure: roughness, change: outside_band, by_more_than: 3, spatial: local, weight: 2, optional: false, note: "Same-orbit VV averaged over the patch departs > 3 dB from its pre-event band; usually a drop after removal, but felled logs can raise VV for weeks. Often under 3 dB after clearing, so a miss is weak evidence against loss. The only sign available under persistent cloud; alone it stays below medium confidence."}
  - {measure: greenness, change: below, threshold: 0.5, timing: seasonal, spatial: any, weight: 2, optional: true, note: "At the next same-season scene (about a year later) the patch is still below 0.5 and below its pre-event same-season level. Not available for recent events; tropical clearings turned to pasture or crops can re-green and fail this."}
  - {measure: fire, change: below, threshold: 1, weight: 1, optional: true, note: "No VIIRS/MODIS active-fire detection within about 1 km of the patch during the window; small or cloud-hidden fires can be missed, so absence is weak evidence."}
looks_like:
  - {event: seasonal, tell_apart_by: "Compare with the same calendar month in the previous 1-3 years: seasonal browning matches that baseline, while loss sits more than about 0.2 greenness below it (and stays below at the next same-season scene).", discriminating_measures: [greenness, moisture]}
  - {event: harvest, tell_apart_by: "Harvest happens on cropland (WorldCover 40) and the same drop appears at the same time in previous years' timelines, followed by green-up within weeks to months; loss of trees or natural cover has no such yearly repeat.", discriminating_measures: [land_cover, greenness]}
  - {event: burn, tell_apart_by: "A burn shows a strong burn-index jump (dNBR above about 0.27-0.44) together with active-fire detections; clearing or dieback alone gives at most a modest dNBR (often 0.1-0.3, rarely above 0.44) and no fire detections.", discriminating_measures: [burn, fire, greenness]}
  - {event: landslide, tell_apart_by: "A landslide scar is long and narrow along the fall line, starts near a crest or break of slope on steep ground (slope above about 25-30 deg) and appears within days of heavy rain (e.g. > 100 mm in 3 days); clearing is usually blocky or follows boundaries or roads and is not tied to a rain event.", discriminating_measures: [slope_deg, rain_mm, greenness]}
  - {event: construction, tell_apart_by: "Construction shows VV rising by more than 3 dB over months as structures add double-bounce, and the surface stays non-green; plain loss shows no sustained radar rise and often regrows.", discriminating_measures: [roughness, greenness]}
  - {event: new_bare_or_built, tell_apart_by: "Vegetation loss needs a vegetated before-state (greenness above about 0.5 at the same season earlier); a site that was already sparse, or a bare patch growing with no prior canopy, fits new bare or built better.", discriminating_measures: [greenness, bare]}
  - {event: water_gain, tell_apart_by: "Open flooding turns the water index positive (NDWI > 0) and VV falls below about -18 dB; flooding under trees or mangroves instead raises VV by several dB while greenness stays fairly high. Cleared land keeps NDWI < 0 with no such radar change.", discriminating_measures: [water, roughness, greenness]}
cannot_tell:
  - "Who removed the vegetation, or whether it was permitted."
  - "Which cause it was (clearing, drought, pests, salt or disease); the data shows loss of green cover, not why."
  - "Selective logging or thinning under an intact canopy, and clearings smaller than about 50 m (0.25 ha)."
  - "Whether dead trees are still standing or have been removed, when greenness alone is used."
  - "Under persistent cloud only radar is available; radar alone cannot raise confidence above low and cannot outline the clearing precisely."
  - "Anything during long cloudy periods: if no clear optical scene exists, only the weaker radar sign is available, and the date of loss is uncertain."
  - "Partial canopy damage in very dense forest, because greenness saturates near 0.8-0.9."
  - "Clearing that has already re-greened with grass, crops or regrowth can look like little or no loss."
  - "Clearing that was then burned (slash-and-burn) versus a wildfire alone."
  - "Regional drought dieback versus an unusually severe dry season, until a same-season comparison a year later."
  - "Events before mid-2015 (Sentinel-2 start); Hong Kong-area surface reflectance coverage is thin before 2017."
confidence: {high_min_weight: 7, medium_min_weight: 5}
suggested_blocks: [then_now, timeline, highlight, hypotheses, stat, limits, map_layer]
wording:
  use: ["consistent with vegetation loss", "green cover appears lower than before", "the satellite shows less vegetation here"]
  avoid: ["illegal", "unauthorised", "unauthorized", "illegal logging", "illegal deforestation", "deliberately", "destroyed by", "someone cut down", "was caused by (a person, company or group)", "非法", "違法", "蓄意破壞", "有人斬樹"]
cases:
  - {place: "Mennonite colony Tierra Blanca 1, near Tierra Blanca, Sarayacu district, Loreto, Peru", lat: -6.55, lon: -75.23, location_precision: approximate, date: 2020-10, expected: detected, source: "MAAP #127 - Mennonite Colonies Continue Major Deforestation in Peruvian Amazon (26 Oct 2020); Mongabay Latam (18 Nov 2020) - Menonitas en Peru: fiscalia sorprende a grupo talando sin autorizacion y ordena paralizar deforestacion en Loreto", url: "https://www.maapprogram.org/?p=20868", verified: true, note: "MAAP #127 reports about 625 ha cleared at Tierra Blanca 1 between Jan and Oct 2020 (2,174 ha since 2016). Prosecutors inspected the site 19-23 Oct 2020 (https://es.mongabay.com/2020/11/menonitas-peru-deforestacion-loreto/). No source gives coordinates; the point is about 6 km west of Tierra Blanca town (-6.555, -75.177). Move it onto a block cleared in 2020 using Sentinel-2 or GFW/RADD imagery before world-test use. Use a Jan 2020 to Oct-Dec 2020 window; expect heavy cloud."}
  - {place: "Coast east of Limmen Bight River mouth, Gulf of Carpentaria, NT, Australia (mangrove dieback)", lat: -15.19, lon: 135.62, location_precision: approximate, date: 2016-01, expected: detected, source: "Duke et al. 2017, Marine and Freshwater Research 68(10):1816-1829, doi 10.1071/MF16322; Australian Geographic (14 Mar 2017) - Extreme weather likely behind worst recorded mangrove dieback in northern Australia", url: "https://researchonline.jcu.edu.au/48289/", verified: false, note: "More than 7,400 ha of mangrove died back along about 1,000 km of coast from the Roper River (NT) to Karumba (QLD), late 2015 to early 2016; worst catchments were the Robinson and McArthur rivers. Regional event, so local-only signs would miss it. The point is the river mouth; move it onto a dead mangrove fringe on imagery. Sentinel-2A launched June 2015, so before-scenes are sparse; Earth Search sentinel-2-l2a returned no scenes under 30% cloud here for Jul 2015-Dec 2016 (checked 3 Oct 2026), so earth v1 cannot compute it: excluded from backtests and the hidden holdout. The event itself is well documented; verified is false only because it is not usable."}
  - {place: "Nusantara capital core area (KIPP), Sepaku, Penajam Paser Utara, East Kalimantan, Indonesia", lat: -0.97, lon: 116.7, location_precision: "approximate", date: "2024-02", expected: "detected", source: "NASA Earth Observatory - Nusantara: A New Capital City in the Forest", url: "https://science.nasa.gov/earth/earth-observatory/nusantara-a-new-capital-city-in-the-forest-152471", verified: true, note: "Article (opened) compares Landsat images of 26 Apr 2022 and 19 Feb 2024: construction began Jul 2022 in forest and oil-palm plantation about 30 km inland, with soil exposed for a road network. Tropical and cloudy (good for the radar fallback, world test #1): Earth Search L2A has few scenes under 30% cloud (17 Jan 2022, 1 Jun 2022, 19-21 Feb 2024). Part of the before-state is plantation, so loss of greenness may be smaller than for natural forest. Point is approximate; move it onto a cleared block on imagery."}
controls:
  - {place: "Cordillera Azul National Park interior, Peru", lat: -7.5, lon: -76.0, location_precision: approximate, date: 2020-10, expected: not_detected, source: "CIMA - Cordillera Azul REDD+ Project", url: "https://www.cima.org.pe/en/cordillera-azul-national-park/cordillera-azul-redd-project", verified: false, note: "Protected, largely intact lower-montane forest about 130 km from the case; steeper and cloudier than the lowland case. Point not checked against imagery."}
  - {place: "Mai Po mangroves (established gei wai stands, inland of the mudflat fringe), Deep Bay, Hong Kong", lat: 22.49, lon: 114.03, location_precision: approximate, date: 2016-01, expected: not_detected, source: "WWF-Hong Kong - Mai Po Nature Reserve", url: "https://www.wwf.org.hk/en/wetlands/mai-po", verified: false, note: "Same ecosystem type and window as the Gulf of Carpentaria case, with no reported dieback. Keep the point inside long-established gei wai mangroves, not the seaward fringe, where mangrove seedlings are cleared from mudflat each summer for waterbirds. Compare scenes at a similar tide stage. Page blocks automated fetching and was not opened."}
  - {place: "Danum Valley Conservation Area, Sabah, Malaysia", lat: 4.96, lon: 117.8, location_precision: "approximate", date: "2024-02", expected: "not_detected", source: "Protected primary lowland dipterocarp forest in Borneo (Sabah Foundation)", url: "https://www.yayasansabah.org.my/en/conservation/danum-valley-conservation-area", verified: false, note: "Borneo rainforest with the same cloud problem as the Nusantara case, but protected and intact. Compare 2022 vs 2024 composites; expect no loss. URL not opened; check the point is inside the conservation area and away from the logging concessions around it."}
sources:
  - {title: "Hansen et al. 2013, High-Resolution Global Maps of 21st-Century Forest Cover Change (Science)", url: "https://www.science.org/doi/10.1126/science.1244693"}
  - {title: "USGS - Landsat Normalized Difference Moisture Index", url: "https://www.usgs.gov/landsat-missions/normalized-difference-moisture-index"}
  - {title: "USGS - Landsat Normalized Difference Vegetation Index", url: "https://www.usgs.gov/landsat-missions/landsat-normalized-difference-vegetation-index"}
  - {title: "Reiche et al. 2021, Forest disturbance alerts for the Congo Basin using Sentinel-1 (Environmental Research Letters)", url: "https://iopscience.iop.org/article/10.1088/1748-9326/abd0a8"}
  - {title: "Duke et al. 2017, Large-scale dieback of mangroves in Australia's Gulf of Carpentaria (Marine and Freshwater Research)", url: "https://researchonline.jcu.edu.au/48289/"}
---

## What it is
Vegetation that was present is now gone or dead. It can follow clearing or cutting, or dieback from drought, heat, pests or salt; the satellite shows the loss, not its reason. This is the general card for loss of green cover; burn, landslide, harvest and construction are more specific cases with their own signs.

## How it shows up from space
- Greenness (NDVI) drops by more than about 0.2. Dense forest at 0.7-0.9 often falls to 0.2-0.4 or lower. Clearings are local patches; dieback can be regional.
- Moisture (NDMI) drops too. Under drought dieback it falls first, before the canopy browns.
- Bare (NDBI) is the exact mirror of NDMI, so it adds no independent evidence; NDBI > 0 only confirms a soil- or dead-wood-like after-state.
- Radar (VV), same orbit direction only, sees through cloud. Changes under 3 dB are noise for small patches. VV usually drops after removal but can rise for weeks while felled logs lie on the ground.
- The key test is a same-season comparison with previous years: loss sits well below that baseline, and stays low a year later unless the land re-greens as pasture or crops.

## How to tell it apart
- **Seasonal**: matches the same month in previous years; loss sits about 0.2 below it.
- **Harvest**: cropland, same drop every year, green-up within weeks to months.
- **Burn**: strong burn index plus fire detections; clear-cuts alone give only modest dNBR.
- **Landslide**: narrow fall-line scar on slopes above about 25-30 deg, days after heavy rain.
- **Construction**: VV rises by more than 3 dB over months; surface stays non-green.
- **New bare or built**: no vegetated before-state.
- **Water gain**: open water gives NDWI > 0 and very dark radar; flooded forest gives brighter radar.

## Limits
- Says nothing about who did it, why, or whether it was allowed.
- Thinning or selective logging under a closed canopy, and clearings under about 50 m, are often invisible.
- Long cloudy seasons can leave only the weaker radar sign and hide the date of loss; radar alone keeps the answer at low confidence and cannot outline the clearing.
- Standing dead trees look like loss in greenness before any clearing happens.
- Greenness saturates in dense canopy, so partial damage can be missed.

## Sources
- Hansen et al. 2013, Science: global forest loss mapping from Landsat.
- USGS NDVI and NDMI guides: the indices and how they respond to vegetation and water stress.
- Reiche et al. 2021, ERL: Sentinel-1 radar forest disturbance alerts.
- Duke et al. 2017, MFR: the 2015-16 Gulf of Carpentaria mangrove dieback.
- MAAP #127 (Oct 2020) and Mongabay Latam (Nov 2020): clearing at the Tierra Blanca 1 colony, Loreto.
