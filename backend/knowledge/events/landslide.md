---
id: landslide
type: event
version: 1
status: draft
name: Landslide
aliases: [landslip, mudslide, mud slide, mudflow, debris flow, rockslide, rock fall, rockfall, slope failure, slope collapse, hillside collapse, landslip warning, 山泥傾瀉, 山泥傾瀉事故, 冧山泥, 冧泥, 塌山泥, 塌方, 山崩, 崩塌, 落石, 山體滑坡, 滑坡, 泥石流, 土石流, landslide, landslides, landslips, 山泥]
category: disasters
summary: Soil, rock and plants slid down a steep slope, usually during or just after very heavy rain, leaving a bare scar and a trail of debris.
min_size_m: 40
timing: sudden
occurs_in: [steep_hillside, tree_cover, shrubland, grassland, cropland, bare_sparse]
triggered_by:
  - {measure: rain_mm, above: 100, window_days: 7, note: "Most landslides in Hong Kong and monsoon Asia follow intense rain; the Hong Kong Observatory and CEDD's Geotechnical Engineering Office jointly issue the Landslip Warning when heavy rain makes many landslides likely."}
signs:
  - {measure: greenness, change: down, by_more_than: 0.15, timing: sudden, spatial: local, shape: "narrow strip or fan elongated straight downslope, scar at the top, debris tongue or channel below", weight: 3, optional: false, note: "Vegetation is stripped off between two clear images; an NDVI drop of 0.15 or more (Notti et al. 2023 used <= -0.15, tuned per site) is a common Sentinel-2 landslide cue."}
  - {measure: bare, change: up, by_more_than: 0.1, timing: sudden, spatial: local, weight: 2, optional: false, note: "Fresh soil and rock raise SWIR relative to NIR; wet debris can damp this for a few days after rain, and the band is 20 m so small scars are mixed pixels."}
  - {measure: slope_deg, change: above, threshold: 20, shape: "evaluate on the upslope end (head) of the changed strip, or the 90th-percentile slope of the outline, not the outline mean", weight: 1, optional: false, note: "Context only; never sufficient without a greenness, bare or radar change. Source areas are usually above 20-30 deg; the runout can be much flatter."}
  - {measure: rain_mm, change: above, threshold: 100, weight: 1, optional: false, note: "Sum of daily rain_mm over the 7 days before the first image showing the change. Context only and necessary, not decisive: in the Hong Kong wet season 100 mm/week is common and gridded rain underestimates local storms, so a scar after a dry spell argues against, but rain alone does not argue for."}
  - {measure: moisture, change: down, by_more_than: 0.1, timing: sudden, spatial: local, weight: 1, optional: false, note: "Canopy water is lost with the plants; wet fresh debris can keep NDMI high for a few days, so this is weak."}
  - {measure: roughness, change: outside_band, by_more_than: 3, timing: sudden, spatial: local, weight: 2, optional: true, note: "Sentinel-1 VV backscatter changes by more than 3 dB on the scar; the only view when monsoon cloud blocks Sentinel-2. Same orbit direction only; steep slopes cause layover and shadow, and the outline is rarely sharp."}
looks_like:
  - {event: seasonal, tell_apart_by: "A dry-season fade is gradual and affects the whole hillside; a landslide is a sudden, sharp-edged strip of bare ground on a steep slope right after heavy rain, while the ring around it stays green.", discriminating_measures: [greenness, bare, rain_mm]}
  - {event: vegetation_loss, tell_apart_by: "Clearing or dieback has straight or blocky edges and often sits on gentle or terraced ground; a landslide is a narrow strip or fan running straight downslope from a steep head, appearing right after heavy rain.", discriminating_measures: [greenness, slope_deg, rain_mm]}
  - {event: construction, tell_apart_by: "Works, including slope-upgrading works on steep cut slopes, make bare ground grow in steps across several images over weeks to months, whatever the rain; a landslide shows bare ground appearing all at once between two consecutive clear images straight after a heavy-rain spike, with no further growth afterwards.", discriminating_measures: [bare, greenness, rain_mm]}
  - {event: new_bare_or_built, tell_apart_by: "New bare or built ground is usually on gentle slopes with regular outlines and no rain trigger; a landslide scar is elongated downhill on steep ground and then slowly re-greens.", discriminating_measures: [slope_deg, rain_mm, greenness]}
cannot_tell: [
  "Slides narrower than about 30-40 m (most road-side cut-slope failures and many debris trails), or slides under an intact tree canopy.",
  "Debris trails narrower than about 20 m blend with the trees beside them, so a long thin runout may show only as its widest part.",
  "Slides on ground that is already bare rock or soil: greenness and bare barely change, and only radar or a before/after elevation model could show them.",
  "Radar cannot see slopes facing away from or steeply toward the satellite (shadow and layover), so under cloud some slopes have no usable signal at all; where it does see, it shows that something changed but rarely the exact outline.",
  "Slides triggered by an earthquake or with no heavy rain score low, because the rain sign is missing.",
  "The exact hour or day of failure when cloud covers the area for days after the storm; only the window between two clear images.",
  "Which part is the source scar and which is deposited debris, how deep or thick it is, whether the slope is still unstable, or whether people or buildings were hit.",
  "Whether a man-made slope or works contributed; the image shows only the scar, not the cause."
]
confidence: {high_min_weight: 8, medium_min_weight: 5}
suggested_blocks: [then_now, highlight, timeline, stat, hypotheses, limits, map_layer]
wording:
  use: ["consistent with a landslide", "a sudden strip of bare ground appeared on the hillside", "after heavy rain"]
  avoid: ["the slope was badly maintained", "someone caused the landslide", "illegal works caused", "the area is safe now", "a landslide definitely happened", "people were injured", "buildings were damaged"]
cases:
  - {place: "Natural hillside above Yiu Hing Road, Yiu Tung Estate, Shau Kei Wan, Hong Kong", lat: 22.2747, lon: 114.2240, location_precision: approximate, date: 2023-09-08, expected: detected, source: "CEDD GEO Report No. 377 - Detailed Study of the 8 September 2023 Landslides on the Natural Hillside above Yiu Hing Road, Yiu Tung Estate, Shau Kei Wan", url: "https://www.cedd.gov.hk/eng/publications/geo/geo-reports/geo_rpt377/index.html", verified: true, note: "About 4,000 m3 at 02:36 in the 7-8 Sep 2023 black rainstorm (3,900 m3 rockslide on a spur plus 100 m3 debris avalanche). Report has no coordinates: point is the OSM position of Yiu Hing House (22.2765, 114.2245) shifted ~120 m upslope onto the northeast-facing hillside; lower scar crown is ~100 m above the road. Use a ~150 m buffer. Dense shrub and mature trees on a 40-45 deg slope (GEO 377 sec. 2.1), so NDVI contrast should be strong, but the scar spans only a few Sentinel-2 pixels: expect medium confidence. Sentinel-1 likely degraded by layover; the first clear Sentinel-2 image may be days later."}
  - {place: "Mundakkai / Punchirimattam headscarp, Wayanad, Kerala, India", lat: 11.46544, lon: 76.13576, location_precision: exact, date: 2024-07-30, expected: detected, source: "AGU Eos, The Landslide Blog - The Wayanad landslides", url: "https://eos.org/thelandslideblog/wayanad-landslides", verified: true, note: "Headscarp coordinates from the blog; about 570 mm of rain in the two days before; main scarp about 86,000 m2 and debris flow about 8 km long (ISRO via The News Minute, https://www.thenewsminute.com/kerala/isro-releases-images-before-and-after-wayanad-landslides). The crown reactivated an older slide and a 2020 channelised flow track was already visible, so use an Apr-May 2024 baseline and expect the largest NDVI drop along the widened Iruvanji Puzha channel and the Mundakkai-Chooralmala runout rather than at the old crown. Monsoon cloud: use Sentinel-1 or the first clear Sentinel-2 image in Aug-Oct 2024."}
  - {place: "Mulitaka landslide, Yambali, Maip Mulitaka LLG, Enga Province, Papua New Guinea", lat: -5.3739, lon: 143.3886, location_precision: "approximate", date: "2024-05-24", expected: "detected", source: "Wikipedia - 2024 Enga landslide (citing IOM, UNDP and PNG government reports)", url: "https://en.wikipedia.org/wiki/2024_Enga_landslide", verified: true, note: "Page (opened) gives 24 May 2024 about 03:00 local, coordinates 5.37389 S 143.38861 E, debris about 600 m long and about 90,000 m2 from the limestone slopes of Mt Mungalo. Cause disputed (rain or mining), so do not state a trigger. Very cloudy highland: Earth Search L2A has only a few scenes under 30% cloud (23 Apr and 28 May 2024), so radar and a cloud-masked composite may be needed."}
controls:
  - {place: "Natural hillside above Yiu Hing Road, Yiu Tung Estate, Shau Kei Wan, Hong Kong (pre-event window)", lat: 22.2747, lon: 114.2240, location_precision: approximate, date: 2022-09, expected: not_detected, source: "CEDD GEO Report No. 377, sec. 3.2 Past Slope Instabilities (all ENTLI features in the study area under 22 m wide; no reported landslide incidents within the study area before Sept 2023)", url: "https://www.cedd.gov.hk/eng/publications/geo/geo-reports/geo_rpt377/index.html", verified: true, note: "Same slope one year before the event; 2022 was a quiet year in Hong Kong (76 landslide reports vs 601 in 2023, news.gov.hk 2024-05-27, https://www.news.gov.hk/eng/2024/05/20240527/20240527_150907_819.html). Tests that the agent does not invent a slide on a steep vegetated slope without a rain trigger."}
  - {place: "Mundakkai / Punchirimattam headscarp, Wayanad, Kerala, India (pre-monsoon 2023 window)", lat: 11.46544, lon: 76.13576, location_precision: exact, date: 2023-05, expected: not_detected, source: "AGU Eos, The Landslide Blog - The Wayanad landslides (pre-event imagery shows only an older 2020 channelised flow); ISRO pre-event Cartosat-3 image of 22 May 2023", url: "https://eos.org/thelandslideblog/wayanad-landslides", verified: false, note: "Compare Jan 2023 with May 2023 (dry season): no new scar expected. Sources show the site state before the 2024 event but do not explicitly confirm no change in this window. A partly re-vegetated 2020 flow track exists, so look for sudden change, not absolute bareness."}
  - {place: "Chembra Peak slopes, Meppadi, Wayanad, Kerala, India", lat: 11.53, lon: 76.08, location_precision: "approximate", date: "2024-07-30", expected: "not_detected", source: "Steep tea-estate and grassland slopes about 10 km west of Mundakkai, same extreme rain of 29-30 Jul 2024", url: "https://en.wikipedia.org/wiki/2024_Wayanad_landslides", verified: false, note: "URL describes the Mundakkai-Chooralmala disaster, not this hill; no major slide reported here, but small slips may exist. Compare May vs Sep-Oct 2024 for a fresh scar before use. Same rain and terrain makes it a strong test that rain alone does not mean a landslide."}
sources:
  - {title: "Notti et al. 2023, Semi-automatic mapping of shallow landslides using free Sentinel-2 images and Google Earth Engine, NHESS 23, 2625", url: "https://nhess.copernicus.org/articles/23/2625/2023/"}
  - {title: "Mondini et al. 2019, Sentinel-1 SAR Amplitude Imagery for Rapid Landslide Detection, Remote Sensing 11(7), 760", url: "https://www.mdpi.com/2072-4292/11/7/760"}
  - {title: "CEDD GEO Report No. 377 - 8 September 2023 Landslides above Yiu Hing Road, Shau Kei Wan", url: "https://www.cedd.gov.hk/eng/publications/geo/geo-reports/geo_rpt377/index.html"}
  - {title: "CEDD GEO Report No. 376 - 8 and 14 September 2023 Landslides at Shek O Road, Shek O", url: "https://cedd.gov.hk/eng/publications/geo/geo-reports/geo_rpt376/index.html"}
  - {title: "Hong Kong Slope Safety (CEDD) - Landslip Warning System", url: "https://hkss.cedd.gov.hk/hkss/en/protection-against-landslide-emergency/landslip-warning-system/index.html"}
  - {title: "Hong Kong Slope Safety (CEDD) - Past notable landslides", url: "https://hkss.cedd.gov.hk/hkss/en/facts-and-figures/past-notable-landslides/index.html"}
  - {title: "USGS Landslide Hazards Program", url: "https://www.usgs.gov/programs/landslide-hazards"}
---

## What it is

A mass of soil, rock and vegetation sliding or flowing down a slope. In Hong Kong
(山泥傾瀉, 冧山泥) most landslides happen in intense rain, when the Observatory and
CEDD's Geotechnical Engineering Office jointly issue the Landslip Warning. Big ones
become debris flows that run down stream channels.

## How it shows up from space

- **Greenness** drops suddenly (by 0.15 or more) in a narrow strip or fan that runs
  straight downhill; the hillside around it stays green.
- **Bare** rises in the same strip: fresh soil and rock at the scar, debris below
  (wet debris can damp this for a few days).
- **Moisture** drops with the lost canopy, but wet debris can mask this for a few days.
- **Context**: the head of the strip is steep (**slope_deg** above about 20) and
  **rain_mm** shows a spike (over about 100 mm in the week before). Context alone is
  never evidence of a slide.
- **Roughness** (radar, optional) can change by more than 3 dB; it is the only view
  when cloud hides the area after the storm.
- Recovery: grass re-greens the scar within one or two wet seasons; rock scars stay bare.

## How to tell it apart

- **seasonal**: gradual and hillside-wide, no strip, no rain trigger.
- **vegetation_loss**: blocky or straight edges, often gentle or terraced ground.
- **construction**: bare ground grows in steps over several images, whatever the rain;
  a slide appears all at once after a storm and then stops growing.
- **new_bare_or_built**: regular outline on gentle ground, no downslope tongue.

## Limits

- 10 m pixels miss slides narrower than about 30-40 m; Hong Kong's many small road-side
  cut-slope failures (for example the 650 m3 Shek O Road failure of 8 Sep 2023) are
  below this.
- Cloud after storms can delay the first clear Sentinel-2 image by days or weeks.
- Radar on steep slopes suffers layover and shadow; compare the same orbit only.
- Slides on already-bare ground or without a rain trigger score low.
- The images cannot show whether a slope is now safe, who is responsible, or whether
  works contributed.

## Sources

- Notti et al. 2023 (NHESS 23, 2625-2648): NDVI drop <= -0.15 plus a slope filter of 15-20 deg.
- Mondini et al. 2019 (Remote Sensing 11, 760): Sentinel-1 amplitude change for rapid landslide detection.
- CEDD GEO Reports 376 and 377 (Shek O Road and Yiu Hing Road, Sep 2023).
- AGU Eos Landslide Blog: Wayanad landslides, 30 Jul 2024.
- USGS Landslide Hazards Program; CEDD Hong Kong Slope Safety.
