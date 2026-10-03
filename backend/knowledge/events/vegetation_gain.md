---
id: vegetation_gain
type: event
version: 1
status: draft
name: Vegetation gain
aliases: [regrowth, greening, greener, more trees, more green, revegetation, regeneration, reforestation, afforestation, tree planting, recovery after fire, vegetation recovery, restoration, overgrown, 植樹, 植林, 綠化, 復綠, 植被恢復, 植被增加, 重新長出植物, 山火後復原, 長返草, 長返樹, 多咗樹, 變綠咗, 綠咗, 綠過平時, 比平時綠, 更綠]
category: forests
summary: Plants are covering ground that was bare, burned or thin before, and the green stays from one year to the next.
min_size_m: 40
timing: gradual
occurs_in: [tree_cover, shrubland, grassland, cropland, bare_sparse, steep_hillside, mangroves, herbaceous_wetland, built_up, fish_ponds]
triggered_by:
  - {event: burn, note: "Resprouting and seedlings green a burn scar within months to a few years."}
  - {event: landslide, note: "Scars and slope works revegetate naturally or by hydroseeding."}
  - {event: vegetation_loss, note: "Cleared or storm-damaged ground regrows if left alone."}
signs:
  - {measure: greenness, change: up, by_more_than: 0.15, timing: gradual, spatial: any, weight: 3, optional: false, note: "Main sign. Same months in different years. If the whole region rose too, rain_mm and the seasonal card decide whether it is a gain."}
  - {measure: moisture, change: up, by_more_than: 0.1, timing: gradual, spatial: any, weight: 2, optional: false, note: "Leaf water rises with canopy; also rises with wet soil after rain, so rain_mm matters."}
  - {measure: water, change: below, threshold: 0, weight: 1, optional: false, note: "End state is land: rules out algae or floating plants on open water. For mangroves or fish ponds, water falling from >0 to <0 with rising greenness is the gain; intertidal mangroves can fail at high tide, so low-tide scenes are preferred."}
  - {measure: bare, change: down, by_more_than: 0.1, timing: gradual, spatial: local, weight: 1, optional: true, note: "Mirror of moisture (same SWIR1/NIR bands, opposite sign); not separate evidence."}
  - {measure: roughness, change: up, by_more_than: 2, timing: gradual, spatial: local, weight: 1, optional: true, note: "Weak and direction-ambiguous in VV: woody regrowth can raise it, grass and crops often lower it. Same-orbit, dry-day pairs only; never on its own."}
  - {measure: burn, change: up, by_more_than: 0.1, timing: gradual, weight: 1, optional: true, note: "After a fire, NBR climbing back toward its pre-fire level marks recovery."}
looks_like:
  - {event: seasonal, tell_apart_by: "Seasonal green-up comes back every year and drops again; a gain stays higher than the same month of earlier years.", discriminating_measures: [greenness, moisture, rain_mm]}
  - {event: harvest, tell_apart_by: "Harvest shows greenness rising and then dropping sharply (bare rising) within one season on cropland; a gain stays at least 0.15 above the same month of the previous year in two consecutive years.", discriminating_measures: [greenness, bare, land_cover]}
cannot_tell:
  - "Whether the plants are native trees, a plantation, crops, or weeds and climbers such as Mikania; they can look equally green."
  - "Whether the forest has really recovered: greenness returns in one to three years while tree height, biomass and species take decades."
  - "Thickening or growth in height of a canopy that is already dense: greenness saturates near 0.85-0.9."
  - "Whether the growth was planted or natural, or who planted it."
  - "Single trees, narrow strips or patches smaller than about 40 m (moisture is measured at 20 m)."
  - "Gains during months with no cloud-free optical image; radar alone cannot confirm green cover."
  - "Small shifts across January 2022 if the Sentinel-2 processing offset is not harmonised; changes under ~0.05 near that date are noise."
confidence: {high_min_weight: 6, medium_min_weight: 5}
suggested_blocks: [then_now, timeline, timelapse, compare, highlight, hypotheses, stat, limits]
wording:
  use: ["greening consistent with regrowth", "more plant cover than the same season in earlier years", "early recovery of green cover"]
  avoid: ["fully recovered", "the forest is back", "reforested by", "illegal", "planted by"]
cases:
  - place: "Pedrógão Grande fire scar, Leiria, Portugal"
    lat: 39.9494
    lon: -8.2456
    location_precision: approximate
    date: 2018-07
    expected: detected
    source: "Instituto Politécnico de Lisboa - Reis (2019), Modelo preditivo de recuperação da vegetação afetada por incêndios florestais"
    url: https://repositorio.ipl.pt/entities/publication/2da9bd61-98d8-4477-a300-0d6c616fb4c5
    verified: true
    note: "Fire 17-24 June 2017 (about 45,000 ha, mostly eucalyptus and pine). Baseline = cloud-free scenes from 25 Jun-31 Jul 2017 only (post-fire); compare July 2018 and July 2019. Expect NDVI to rise from ~0.1-0.2 toward 0.4-0.6 as eucalyptus resprouts. The thesis tracks Sentinel-2 NDVI recovery here. Earth Search sentinel-2-l2a has post-fire baseline scenes on 29 Jul (12% cloud) and 8 Aug 2017 (0%) and clear July 2018 scenes (checked 3 Oct 2026)."
  - place: "Flinders Chase National Park, Kangaroo Island, South Australia"
    lat: -35.95
    lon: 136.72
    location_precision: approximate
    date: 2021-02
    expected: detected
    source: "South Australia Department for Environment and Water - Find out how South Australia's Flinders Chase National Park is recovering post-bushfire"
    url: https://www.environment.sa.gov.au/goodliving/posts/2020/04/flinders-chase-plants-regenerating
    verified: true
    note: "96% of the park burned in Dec 2019-Jan 2020 (SA DEW); sedges resprouted within three weeks, epicormic regrowth on trees. Baseline = Feb 2020 (fresh scar); compare Feb 2021 (same season). Never use a baseline before Dec 2019 (net loss). The local ring is also burned, so use an unburned ring outside the fire perimeter or NBR recovery. Flinders University (13 Jan 2021, Kangaroo Island in general, not Flinders Chase by name) reports regrowth after three months, more after nine, and almost none on the most intensely burned ground: expect patchy gain."
  - {place: "Gospers Mountain fire scar, Wollemi National Park, New South Wales, Australia", lat: -32.95, lon: 150.65, location_precision: "approximate", date: "2021-01", expected: "detected", source: "NSW Department of Planning and Environment (Oct 2023) - NSW Post-fire Biomass Recovery Monitoring by Remote Sensing: report for 3 years following 2019-20", url: "https://www.environment.nsw.gov.au/sites/default/files/post-fire-biomass-recovery-monitoring-remote-sensing-230309.pdf", verified: true, note: "Report (opened) finds large increases in vegetation cover across the 2019-20 NSW fire ground in years 1 and 2 (well-above-average La Nina rain), with little change in year 3. Gospers Mountain fire: lightning start 26 Oct 2019 in Wollemi NP, about 512,000 ha (search results, regional press). Baseline = late Jan 2020 fresh scar; compare Jan 2021 (Earth Search L2A clear on 24 Jan 2021). Never use a baseline before Oct 2019 (net loss). Point not checked against the fire perimeter."}
controls:
  - place: "Tai Po Kau Nature Reserve, Hong Kong"
    lat: 22.425
    lon: 114.181
    location_precision: approximate
    date: 2022-06
    expected: not_detected
    source: "AFCD - Tai Po Kau Nature Reserve (460 ha of mature forest, afforested since 1926, Special Area since 1977)"
    url: https://www.afcd.gov.hk/english/country/cou_vis/cou_vis_cou/cou_vis_tpk/cou_vis_cou_tpk.html
    verified: true
    note: "Closed mature canopy near greenness saturation; only seasonal wiggles expected for 2021-2023. Avoid windows starting just after Typhoon Mangkhut (Sep 2018). Easy control: does not test a seasonal flush."
  - place: "Upland grassland near Sunset Peak, Lantau Island, Hong Kong"
    lat: 22.257
    lon: 113.954
    location_precision: approximate
    date: 2023-08
    expected: not_detected
    source: "No source opened; chosen as seasonal grass hillside that greens and browns each year"
    url: https://www.afcd.gov.hk/english/country/cou_vis/cou_vis_cou/cou_vis_cou.html
    verified: false
    note: "Tests the main failure mode (seasonal or rain flush read as gain). Compare Aug 2023 with Aug 2022; expect <0.15 change. Hill fires are common on Lantau grassland: check FIRMS or AFCD fire records for 2021-2023 before use."
  - {place: "Dandenong Ranges National Park, Victoria, Australia", lat: -37.87, lon: 145.36, location_precision: "approximate", date: "2021-01", expected: "not_detected", source: "Mature wet eucalypt forest outside the 2019-20 fire grounds; already near full canopy", url: "https://www.parks.vic.gov.au/places-to-see/parks/dandenong-ranges-national-park", verified: false, note: "Not burned in 2019-20 (to be checked against the Victorian fire history map). Same-season Jan 2020 vs Jan 2021 should stay inside the normal band even though the 2020-21 La Nina was wet; a small rise is seasonal, not gain. URL not opened."}
sources:
  - {title: "NASA Earth Observatory - Measuring Vegetation (NDVI and EVI)", url: "https://science.nasa.gov/earth/earth-observatory/measuring-vegetation-ndvi-evi"}
  - {title: "USGS - Landsat Normalized Difference Vegetation Index", url: "https://www.usgs.gov/landsat-missions/landsat-normalized-difference-vegetation-index"}
  - {title: "Chu and Guo (2014), Remote sensing techniques in monitoring post-fire effects and patterns of forest recovery in boreal forest regions: a review, Remote Sensing 6(1):470", url: "https://doi.org/10.3390/rs6010470"}
  - {title: "ESA SentiWiki - Sentinel-2 mission", url: "https://sentiwiki.copernicus.eu/web/s2-mission"}
  - {title: "Flinders University - Bushfire recovery from the air (2021)", url: "https://news.flinders.edu.au/blog/2021/01/13/bushfire-recovery-from-the-air/"}
---

## What it is

Plants spreading over ground that was bare, burned, cleared or sparse: regrowth after a hill fire,
a landslide scar turning green, tree planting, abandoned fields or fish ponds becoming overgrown,
and restored mangroves or urban parks. It builds up over months to years.

## How it shows up from space

- **Greenness** rises clearly (more than about 0.15) compared with the same months of earlier
  years. Bare or burned ground (~0-0.2) moves toward sparse (0.2-0.4) and then dense (0.6-0.9).
- **Moisture** rises with it; **bare** falls as the mirror of moisture (same bands, not extra evidence).
- **Water** ends below 0, so this is land, not plants or algae on a pond. On mangroves or fish
  ponds, water falling from above 0 to below 0 while greenness rises is itself the gain.
- **Roughness** (radar) can hint at woody structure, but in VV it may rise or fall; it cannot
  confirm a gain under cloud.
- After a fire, **burn** (NBR) climbing back toward its pre-fire level is a good sign, when available.
- Grass and shrubs usually return first (months); resprouting eucalypts can green within weeks of
  rain; tree canopies on bare or planted ground can take several years to read as dense.

## How to tell it apart

- **Seasonal**: the same patch greens every wet season and browns again. Compare like with like
  (July vs July); only a level that stays above earlier years counts as a gain. If the whole region
  rose together and rain_mm was high, a seasonal or rain flush is more likely than a gain.
- **Harvest**: on cropland, greenness rises then drops sharply within one season. A gain stays at
  least 0.15 above the same month of the previous year in two consecutive years.
- Large real gains (a whole burned catchment) also cover the local ring; compare with an unburned
  ring further out instead.

## Limits

- Greenness cannot tell native forest from plantation, crops or weed and climber cover.
- Greenness saturates near 0.85-0.9, so "green again" does not mean the forest has recovered.
- Nothing about who planted it or why; use "consistent with regrowth".
- Features under about 40 m, cloudy wet-season gaps, and the Jan 2022 Sentinel-2 offset limit what can be said.

## Sources

- NASA Earth Observatory, Measuring Vegetation (NDVI and EVI).
- USGS, Landsat Normalized Difference Vegetation Index.
- Chu and Guo (2014), post-fire forest recovery review, Remote Sensing.
- ESA SentiWiki, Sentinel-2 mission.
- Cases: Reis (2019), IPL; SA Department for Environment and Water (2020); Flinders University (2021).
