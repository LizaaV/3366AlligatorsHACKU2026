---
id: open_water
type: setting
version: 1
status: draft
name: Open water
aliases: [open water, water body, lake, reservoir, river, sea, harbour, bay, estuary, 水體, 水塘, 水庫, 湖, 河, 河道, 海, 海港, 海灣]
summary: Lakes, reservoirs, rivers and sea that hold water for most of the year (WorldCover class 80).
worldcover_classes: [80]
detect:
  land_cover_any: [80]
  min_fraction: 0.5
  note: "WorldCover 80 = covered by water for more than 9 months a year (may be frozen for part of it); in practice sea and harbours are mapped as 80 too. Fish ponds and seasonally flooded land are also often mapped as 80, so check the fish_ponds and herbaceous_wetland cards too"
normal:
  - measure: water
    typical_min: 0.05
    typical_max: 0.6
    seasonality: "Stable all year for deep clear water; turbid, shallow or algae-rich water sits lower (about 0 to 0.2); edges of reservoirs and rivers move with dry and wet seasons"
  - measure: greenness
    typical_min: -0.6
    typical_max: 0.05
    seasonality: "Not a vegetation signal over water; rises toward or above 0 with algal blooms, floating plants or sun glint, which are not land change"
  - measure: roughness
    typical_min: -28
    typical_max: -12
    seasonality: "Calm sheltered water is very dark (about -28 to -18 dB); wind-roughened sea or lake can reach about -12 dB, overlapping land. Wind, waves and rain change it by several dB on any date, so single-date jumps over open water are weak evidence; ice cover also changes it"
  - measure: bare
    typical_min: -0.6
    typical_max: 0.1
    seasonality: "Noisy over water because NIR and SWIR are both near zero; do not use alone"
  - measure: elevation_m
    seasonality: "Fixed; sea and harbour near 0 m, inland lakes at any height (some below sea level). The Copernicus DEM flattens water surfaces, so it carries no relief signal here"
likely_events: [water_loss, water_gain, seasonal, pond_filling, construction, new_bare_or_built]
pitfalls:
  - "Greenness (NDVI) is meaningless over water: negative values are normal, and blooms of algae or floating weed push it above 0 without any land appearing."
  - "Sun glint makes water bright in visible and NIR bands, which can flip NDWI toward land for one date; check SWIR and the next clear image."
  - "Turbid or shallow water (estuaries, Deep Bay, silty rivers) gives weak or near-zero NDWI; use radar roughness and the shoreline shape rather than a fixed 0 cut-off."
  - "Wind roughens water and raises radar backscatter by several dB; compare several dates and the same orbit direction before calling water lost."
  - "Ships, piers, fish rafts and buoys are bright points on radar and small at 10 m; they are not reclamation."
  - "Tides move the shoreline across mudflats (Deep Bay flats are kilometres wide at low tide); compare images at similar tide heights before calling reclamation or water gain."
  - "Cloud shadow is dark in all bands and can look like water; thin cloud and haze lower contrast. Mask clouds and their shadows first."
  - "Lakes freeze in cold climates: ice and snow change both NDWI and radar for months each winter; compare the same season."
  - "Radar-dark is not proof of water: smooth tarmac, dry sand and wet mud are also dark; confirm with optical NDWI on a clear date."
  - "Mixed pixels at shorelines and narrow rivers (under about 30 m wide) blend land and water values."
sources:
  - {title: "ESA WorldCover 10 m 2021 v200 Product User Manual (class definitions)", url: "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/docs/WorldCover_PUM_V2.0.pdf"}
  - {title: "McFeeters 1996, The use of the Normalized Difference Water Index (NDWI) in the delineation of open water features, Int. J. Remote Sensing", url: "https://doi.org/10.1080/01431169608948714"}
  - {title: "Harmel et al. 2018, Sunglint correction of the Multi-Spectral Instrument (MSI)-SENTINEL-2 imagery over inland and sea waters from SWIR bands, Remote Sensing of Environment 204", url: "https://doi.org/10.1016/j.rse.2017.10.022"}
  - {title: "Hu 2009, A novel ocean color index to detect floating algae in the global oceans, Remote Sensing of Environment 113", url: "https://doi.org/10.1016/j.rse.2009.05.012"}
  - {title: "ESA SentiWiki - Sentinel-1 applications", url: "https://sentiwiki.copernicus.eu/web/s1-applications"}
---

## What it is

Places covered by water for most of the year: lakes, reservoirs, rivers, harbours and the
sea. ESA WorldCover maps these as class 80 (water for more than about 9 months a year).
In Hong Kong this includes the reservoirs, Victoria Harbour, Tolo Harbour and Deep Bay.

## What normal looks like

- **water (NDWI)** is above 0, usually 0.1 to 0.6. Silty or shallow water is lower.
- **greenness (NDVI)** is below 0. It is not a plant signal here.
- **roughness** (radar) is very dark, about -25 to -15 dB, but wind and waves raise it.
- Reservoir and river edges move with the dry and wet seasons; that is normal.

Real change looks like a shoreline that moves and stays moved (reclamation, a drained
reservoir), shown by water dropping below 0 and radar turning land-bright in the same outline
across several dates.

## Pitfalls

- Algae and floating weed raise greenness without any land appearing.
- Sun glint can make one date look like land. Check the next clear image.
- Turbid water gives weak NDWI; use radar and shape instead of a fixed cut-off.
- Wind brightens radar over water; one bright date is not land.
- Boats, piers and fish rafts are small bright points, not reclamation.
- Tides move coastlines; compare similar tide heights.
- Cloud shadow can look like water; frozen lakes change every winter.
