---
id: steep_hillside
type: setting
version: 1
status: draft
name: Steep vegetated hillside
aliases: [steep hillside, steep slope, hillside, mountainside, hill slope, natural terrain, 山坡, 陡坡, 斜坡, 天然山坡, 山, 山邊]
summary: Vegetated slopes steeper than about 20 degrees, such as Hong Kong's country park hills, prone to landslides and hill fires.
worldcover_classes: [10, 20, 30]
detect:
  land_cover_any: [10, 20, 30]
  min_fraction: 0.5
  slope_deg_mean_gt: 20
  note: "Not a WorldCover class: tree, shrub or grass cover (10/20/30) plus a mean Copernicus DEM slope above about 20 degrees. The 30 m DEM smooths terrain, so true local slopes are often steeper than computed"
normal:
  - measure: slope_deg
    typical_min: 20
    typical_max: 50
    seasonality: "Fixed. Computed from the 30 m Copernicus DEM, which underestimates cliffs, gullies and narrow ridges"
  - measure: greenness
    typical_min: 0.35
    typical_max: 0.85
    seasonality: "Forest about 0.6 to 0.85 all year; grass and shrub hillsides about 0.35 to 0.65, browning in the dry season (in Hong Kong roughly October to March) and greening after spring rain"
  - measure: moisture
    typical_min: -0.1
    typical_max: 0.5
    seasonality: "Forest about 0.3 to 0.5; falls in the dry season, especially on grassy south-facing slopes; low values in winter raise hill-fire risk"
  - measure: bare
    typical_min: -0.5
    typical_max: 0.05
    seasonality: "Stays low under full cover (about -0.5 to -0.2 for forest); dry grass in winter edges toward 0; rock outcrops and old landslide scars are naturally higher"
  - measure: roughness
    typical_min: -15
    typical_max: -3
    seasonality: "Vegetated slopes about -12 to -6 dB on flat-equivalent terrain, but slopes facing the radar are several dB brighter (foreshortening, layover) and slopes facing away darker or in shadow; stable only within the same orbit direction"
  - measure: rain_mm
    seasonality: "Landslides cluster during and right after heavy rain, and their number rises steeply with 24-hour rainfall; in Hong Kong the rainy season is about April to October and the worst events follow rainstorms of well over 100 mm in a day. Hill fires peak in the dry season (AFCD fire season October to April)"
likely_events: [landslide, burn, vegetation_loss, vegetation_gain, seasonal, construction, new_bare_or_built]
pitfalls:
  - "Radar layover and shadow: slopes facing the satellite are squeezed and very bright, slopes facing away can be in shadow with no signal. Compare only the same orbit direction, and prefer optical signs on steep terrain."
  - "Terrain shadow in optical images (low winter sun, north-facing slopes) darkens pixels and can lower greenness without real change."
  - "Dry-season browning of grass and shrub slopes is normal; compare with the same months of earlier years."
  - "Many landslide scars are narrow (under 20 m) and long; small ones are below what 10 m pixels can show."
  - "Cloud often hides hills during and right after the storms that cause landslides; the first clear image may be weeks later."
  - "Old scars, rock outcrops and hiking-trail erosion already look bare and are not new events."
  - "In mountains outside Hong Kong, seasonal snow drops greenness and changes radar every winter; check whether snow is present before reading loss."
  - "Terraced or cut slopes beside roads and buildings are engineered, not natural terrain; new cuts there may be construction rather than a landslide."
  - "A slope average hides cliffs and gullies; the slope at the changed patch matters more than the area mean."
sources:
  - {title: "ESA WorldCover 10 m 2021 v200 Product User Manual (class definitions)", url: "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/docs/WorldCover_PUM_V2.0.pdf"}
  - {title: "CEDD Hong Kong - Landslip Prevention and Mitigation Programme (natural terrain landslides)", url: "https://www.cedd.gov.hk/eng/our-projects/landslip/lpmitp/index.html"}
  - {title: "Hong Kong Slope Safety (CEDD) - Past notable landslides", url: "https://hkss.cedd.gov.hk/hkss/en/facts-and-figures/past-notable-landslides/index.html"}
  - {title: "AFCD Hong Kong - Hill fire prevention", url: "https://www.afcd.gov.hk/english/country/cou_lea/hillfire.html"}
  - {title: "Google Earth Engine - Global Sentinel-1 incidence, layover and shadow masks (Earth Big Data V2019)", url: "https://developers.google.com/earth-engine/datasets/catalog/Earth_Big_Data_GLOBAL_SEASONAL_S1_V2019_INCIDENCE_LAYOVER_SHADOW"}
  - {title: "Notti et al. 2023, Semi-automatic mapping of shallow landslides using free Sentinel-2 images and Google Earth Engine, NHESS 23, 2625", url: "https://nhess.copernicus.org/articles/23/2625/2023/"}
---

## What it is

Hillsides covered by forest, shrub or grass with a slope steeper than about 20 degrees.
WorldCover has no class for this, so we detect it from land cover (10, 20 or 30) plus the
Copernicus DEM slope. In Hong Kong most country park hills fit, such as Tai Mo Shan, Lantau
Peak and the Sai Kung hills. These slopes see many small natural landslides in wet years,
mostly after heavy rain, and hill fires in the dry season (about October to April).

## What normal looks like

- **greenness** stays high on forest (0.6 to 0.85). Grass and shrub slopes are lower and
  brown in the dry season, then green up after spring rain.
- **moisture** dips in the dry season.
- **bare** stays low except on rock, trails and old scars.
- **roughness** is stable within one orbit direction, but brightness depends on which way
  the slope faces.

Real change looks like a sharp patch where greenness drops and bare rises: a long, narrow
strip running downhill after heavy rain (landslide), or a broad dark patch in the dry season
(burn).

## Pitfalls

- Radar layover and shadow on steep slopes; use the same orbit direction and prefer optical.
- Optical terrain shadow on north-facing slopes in winter.
- Dry-season browning is normal.
- Small or narrow scars fall below 10 m resolution.
- Cloud hides hills right after storms.
- Snow (outside Hong Kong) and the 30 m DEM's smoothed slopes can mislead.
