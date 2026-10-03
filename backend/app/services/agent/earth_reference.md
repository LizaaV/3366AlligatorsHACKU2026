# earth API reference for `run_code` scripts

Scripts run in a sandbox: a separate process with no network, no files, no keys and a time
limit. An AST scan rejects the script before it runs if it breaks a rule below.

## Sandbox rules

- Imports allowed: `earth` (with `earth.show` and `earth.presets`), `math`, `statistics`,
  `datetime`, `json`. Nothing else (no `os`, `sys`, `numpy`, `requests`, ...).
- Only the public names listed here. Not allowed: `open`, `eval`, `exec`, `compile`,
  `getattr`, `setattr`, `delattr`, `globals`, `locals`, `vars`, `type`, `object`, `super`,
  `input`, `help`, `exit`; `class` definitions; `global`/`nonlocal`; names starting with `__`;
  attributes starting with `_`; the attributes `.format`, `.format_map`, `.mro` (use f-strings).
- At most 300 lines. A top-level `def run(**params)` is required. `print` output is discarded.

## Script contract

```python
def run(**params):
    return {"findings": {...}, "evidence": [...], "blocks": [...], "notes": [...]}
```

- `params`: the JSON object from `params_json`, plus two keys the harness injects:
  `params["area"]` (GeoJSON geometry of the user's outline, or None when no place was given)
  and `params["name"]` (place name or None). Build the area with
  `earth.Area.from_geojson(params["area"], name=params.get("name"))`.
- `findings`: dict. Code scores ONLY `findings["observed"]` (convention below); other keys
  are free and come back to you.
- `evidence`: list of dicts `{measure, value, date, scene}` (optionally `provenance`).
- `blocks`: built with `earth.show.*`. At most ~6 per answer; `primary=True` on at most one.
- `notes`: list of short plain-language strings (limits, what was skipped and why).
- Values must be JSON-able (dates are fine; NaN/inf become null). Never return pixel data.

## Budgets (per script; errors, never silent truncation)

- 30 `earth` calls per script, then `BudgetExceeded`.
- `series`: at most 60 scenes (`years * 12 / months_per_step`), e.g. 5 years monthly.
- Area at most 2,500 ha (25 km²); at least ~25 pixels at 10 m (~0.25 ha), else `AreaTooSmall`.
- About 2.5 M pixels per read (larger areas are read at a coarser resolution automatically).
- Wall-clock timeout per script (60 s by default). The harness also caps scripts per run.

## Area

- `earth.Area.from_geojson(geojson, name=None) -> Area`: Polygon, MultiPolygon, Feature or
  FeatureCollection in lon/lat.
- `earth.Area.from_point(lat, lon, radius_m=400, name=None) -> Area`: a circle (radius ≤ 50 km).
- `Area` fields: `geojson`, `area_ha`, `name`. Methods: `centroid() -> (lat, lon)`,
  `bbox() -> (west, south, east, north)`, `pixels(resolution_m=10) -> int`.
- `earth.presets.HOO_HOK_WAI`: the demo preset (Hoo Hok Wai ponds, ~38 ha). Use it only when
  the question is about that place, never as a stand-in for another place.

## Functions (each call is logged and shown to the user as a step)

- `earth.fires(area, last="30d", radius_km=10) -> FireList{detections: [{date, lat, lon, frp, confidence, km_from_area}], total, inside, last, radius_km, provenance}`: NASA FIRMS active-fire detections near the area (375 m pixels, NOT a burned-area measure). Raises `EarthError` when the server has no FIRMS key: say fire detections were not available.

- `earth.describe(area) -> PlaceContext{name, country, area_ha, pixels_10m, land_cover,
  elevation_m, slope_deg, rain_mm_30d, recent_scenes, warnings}`. `land_cover`: class → share
  0–1 (e.g. `{"water": 0.34, "trees": 0.12}`); `elevation_m`: `{min, max}` or None;
  `slope_deg`: `{mean, p90}` or None; `rain_mm_30d`: weather model, not satellite;
  `recent_scenes`: `{optical, clear, radar}` counts. The first message already holds these
  facts for the user's place: do not call it again for the same area.
- `earth.scenes(area, last="60d", kind="optical", max_cloud=30) -> SceneList{scenes, kind,
  max_cloud}`; `scenes` newest first; `.clear() -> [Scene]` usable ones;
  `.latest_clear() -> Scene` (raises `NoClearScenes`). `last`: a number and d|w|m|y
  (`"60d"`, `"8w"`, `"6m"`, `"1y"`). `kind`: `"optical"` | `"radar"` | `"thermal"` (Landsat, for `heat`). `max_cloud`: percent.
- `Scene{id, date, satellite, provider, kind, cloud_over_area (0–1, over the area), usable,
  resolution_m}`.
- `earth.load(area, scene) -> LayerRef{id, scene, date, measure (None = raw bands),
  resolution_m, provenance}`.
- `earth.index(layer, measure) -> LayerRef` with `measure` set. `roughness` needs a radar
  scene, every other measure an optical one (`WrongSceneKind`).
- `earth.measure(layer) -> Stats{mean, median, p10, p90, clean_px, cloud, provenance}`.
- `earth.series(area, measure, years=5, every="month") -> Series{measure, points, band,
  provenance}`. `points`: `[{date, value, scene, clean_px}]` oldest first, the clearest scene
  per period (cloudy periods are skipped). `band`: `[{month (1–12), lo, hi, mean}]`, the usual
  range per calendar month from earlier years; it can be empty or miss months (then say
  "no usual range", never invent one). `every`: `"month"` | `"quarter"` | `"year"`.
- `earth.compare(area, measure, before, after) -> Comparison{measure, before: Stats,
  after: Stats, delta, changed_ha, patches, provenance}`. `delta = after.mean − before.mean`;
  `changed_ha`: hectares whose pixels changed by more than the threshold below; `patches`:
  `[{ha, centroid (lat, lon), geojson}]` largest first. `before`/`after`: `date` or
  `"YYYY-MM-DD"`, `before < after`, ideally more than 6 weeks apart; the clearest scene within
  ±20 days (then ±45) of each date is used.
- `earth.surroundings(area, ring_m=300) -> Area`: the ring around the outline. Run the same
  `compare`/`series` on it to tell a local change from a regional one.
- `earth.render(layer) -> RenderedLayer{layer_id, url, bounds, measure, scene, date}`: an
  index layer becomes a coloured map, a raw layer (from `load`) a true-colour photo. Only for
  blocks; you never see the image.
- `earth.weather(area, last="14d") -> RainSeries{days: [{date, mm}], total_mm, source, lat,
  lon}`: rain from a weather MODEL, not a satellite; say so when you use it.
- `earth.search_places(text, limit=5) -> [PlaceHit{name, display_name, lat, lon, bbox, kind,
  country, geojson}]`, best first; `hit.area(radius_m=400) -> Area`. `area()` returns the
  place's polygon only when it has one of a usable size (at least 0.25 ha and under 25 km²);
  otherwise (no polygon, e.g. a point or a road, or a large park or district) it returns a
  CIRCLE of `radius_m` around the point (about 50 ha at 400 m). Check `area.area_ha` against
  the place: when you measured a circle, never write as if it were the whole named place;
  say in a caveat that only a circle of that size around its centre was measured.
  `earth.reverse_place(lat, lon) -> PlaceHit | None`. Use only when no outline was given.
- `earth.validate_block(dict) -> Block`: checks a block dict.
- `Provenance{provider, satellite, scene, date, cloud_over_area, resolution_m, method}` is on
  every `Stats`, `LayerRef`, `Series` and `Comparison`.

To picture a compared date, rebuild its scene from the provenance:
`earth.Scene(id=p.scene, date=p.date, satellite=p.satellite, provider=p.provider,
kind="optical", cloud_over_area=p.cloud_over_area, usable=True, resolution_m=10)` with
`p = cmp.before.provenance`, then `earth.render(earth.index(earth.load(area, scene), m))`.

## Measures

| measure | plain meaning | index | sensor | res | change threshold |
| --- | --- | --- | --- | --- | --- |
| `greenness` | living plant cover | NDVI | Sentinel-2 | 10 m | 0.15 |
| `moisture` | water in plants and soil | NDMI | Sentinel-2 | 20 m | 0.10 |
| `water` | open water (above 0 = water) | NDWI | Sentinel-2 | 10 m | 0.15 |
| `bare` | bare soil or built surface | NDBI | Sentinel-2 | 20 m | 0.10 |
| `burn` | burn scar (falls after fire) | NBR | Sentinel-2 | 20 m | 0.15 |
| `roughness` | surface texture, sees through cloud (dB) | VV backscatter | Sentinel-1 | 10 m | 3 dB |
| `heat` | land surface temperature (°C) | Landsat ST_B10 | Landsat 8/9 | 100 m (30 m grid) | 3 °C |

- Index values run from −1 to 1; `roughness` is in dB (calm water about −18 to −25).
- Radar may be unavailable (`EarthError` "Radar scenes are not available yet"): carry on with
  optical measures and add a note that radar was not used.
- Context measures (not for `earth.index`): `slope_deg` (`describe().slope_deg.mean`),
  `elevation_m` (`describe().elevation_m`), `rain_mm` (`weather(area, last).total_mm`, or
  `describe().rain_mm_30d`), `land_cover` (`describe().land_cover`).
- `heat` needs a thermal scene: `earth.scenes(area, kind="thermal")` then `load` + `index(layer, "heat")`; `series`/`compare` with `"heat"` work directly. Landsat passes are ~8 days apart (fewer clear ones than Sentinel-2).
- `fire` is not an index: use `earth.fires(area, last, radius_km)` (detections, not a burned area). Knowledge cards still treat `heat` and `fire` signs as planned (optional).

## Blocks: `earth.show.*` (each returns a block; `id` is optional and auto-generated)

- `timeline(series, title, caption=None, compare=None, compare_label="Surroundings",
  marks=(), primary=False, id=None)`; `compare`: another `Series` (e.g. the surroundings);
  `marks`: `[(date, "change")]`.
- `then_now(before, after, title, caption=None, area=None, primary=False, id=None)`;
  `before`/`after`: `RenderedLayer`; pass `area` to draw the outline.
- `scene_strip(scenes, title="Every pass", caption=None, id=None)`; `scenes`: a `SceneList`.
- `highlight(comparison, title, caption=None, base=None, primary=False, id=None)`; `base`: a
  `RenderedLayer` to draw the changed patches on.
- `stat(label, value, unit, title=None, caption=None, lo=None, hi=None, provenance=(),
  primary=False, id=None)`; `provenance`: e.g. `[cmp.provenance]`.
- `limits(cant_tell, actions=(), contacts=(), rule_id=None, title="What I can't tell",
  id=None)`; `actions`: `[{"label": ..., "kind": "radar"|"wait"|"enlarge"|"expert"|"other"}]`.
- `hypotheses(rows, ...)`: the harness builds this table from your expectation table. Do not
  build it yourself.

Titles and captions are shown to the user: plain words, and only numbers the script computed.

## Errors

`earth` raises these with `.message`, `.hint` and `.kind`; catch them as
`except earth.NoClearScenes as exc:`.

| error | kind | when | what to do |
| --- | --- | --- | --- |
| `EarthError` | `earth_error` | bad measure, kind, `last`, `every` or dates; radar unavailable | fix the call as the hint says |
| `NoClearScenes` | `no_clear_scenes` | too cloudy over the area | `kind="radar"`, a longer `last`, other dates, or a `limits` block |
| `AreaTooSmall` | `area_too_small` | under ~25 pixels at 10 m | low confidence, or ask for a larger outline |
| `BudgetExceeded` | `budget_exceeded` | over 30 calls, 60 series scenes or 2,500 ha | use `series`/`compare` instead of many single reads |
| `InvalidArea` | `invalid_area` | bad outline or coordinates | GeoJSON is `[lon, lat]` |
| `WrongSceneKind` | `wrong_scene_kind` | `roughness` on optical or an index on radar | pick the right `kind` |

An uncaught error ends the script; the tool result gives `kind`, `message`, `hint` and the
traceback tail. Fix the cause and run again (a rerun counts as a run). When the data cannot
answer (clouds, tiny area), catch the error and return a `limits` block plus a note instead.

## FINDINGS CONVENTION (code scores only `findings["observed"]`)

```python
findings["observed"] = {
    measure: {
        "value": float | None,
        "before": float | None,
        "after": float | None,
        "delta": float | None,
        "inside_band": bool | None,
        "local": bool | None,
        "persistent": bool | None,
        "sudden": bool | None,
        "date": "YYYY-MM-DD" | None,
    },
}
```

- `measure`: a knowledge measure name: `greenness`, `moisture`, `water`, `bare`, `burn`,
  `roughness`, `heat`, `slope_deg`, `elevation_m`, `rain_mm`, `land_cover`, `fire` (count from `earth.fires`).
- `value`: the current (latest or `after`) reading; checked against "above"/"below" thresholds.
- `before`, `after`, `delta` (`after − before`): checked against "up"/"down" by more than X
  and "stable".
- `inside_band`: the latest reading sits inside the usual range for its month (`series.band`);
  None when there is no band.
- `local`: True when the outline changed but the surroundings did not move the same way;
  False when they moved alike (regional).
- `persistent`: True when the new state holds in at least 3 later clear scenes over 90+ days.
- `sudden`: True when the change happened between neighbouring clear scenes; False if gradual.
- `date`: when the change started (first reading that left the usual range and stayed out).
- Missing keys and None mean "not measured". Never guess a value; measure it or leave it out.

## Example 1: water then and now (then_now + timeline + stat)

```python
# example: water_then_now
import datetime

import earth


def outside(series, p):
    band = {b.month: b for b in series.band}.get(p.date.month)
    return None if band is None else not band.lo <= p.value <= band.hi


def picture(area, prov, measure):
    scene = earth.Scene(
        id=prov.scene,
        date=prov.date,
        satellite=prov.satellite,
        provider=prov.provider,
        kind="optical",
        cloud_over_area=prov.cloud_over_area,
        usable=True,
        resolution_m=10,
    )
    return earth.render(earth.index(earth.load(area, scene), measure))


def run(**params):
    area = earth.Area.from_geojson(params["area"], name=params.get("name"))
    try:
        after = earth.scenes(area, last="60d").latest_clear().date
    except earth.NoClearScenes as exc:
        acts = [{"label": "Check with radar", "kind": "radar"}]
        block = earth.show.limits(exc.message, actions=acts)
        return {
            "findings": {"observed": {}},
            "evidence": [],
            "blocks": [block],
            "notes": [exc.message],
        }
    before = after - datetime.timedelta(days=730)
    cmp = earth.compare(area, "water", before, after)
    ring = earth.compare(earth.surroundings(area), "water", before, after)
    s = earth.series(area, "water", years=4)

    flags = [outside(s, p) for p in s.points]
    i = next((k for k in range(len(flags) - 2) if all(f is True for f in flags[k : k + 3])), None)
    change = s.points[i] if i is not None else None
    later = s.points[i:] if i is not None else []
    persistent = None
    if later:
        span = (later[-1].date - later[0].date).days
        persistent = len(later) >= 3 and span >= 90 and sum(flags[i:]) >= 0.8 * len(later)
    sudden = None
    if i:
        sudden = abs(s.points[i].value - s.points[i - 1].value) >= 0.5 * abs(cmp.delta)
    local = None if abs(cmp.delta) < 0.1 else abs(cmp.delta - ring.delta) > 0.1

    observed = {
        "water": {
            "value": cmp.after.mean,
            "before": cmp.before.mean,
            "after": cmp.after.mean,
            "delta": cmp.delta,
            "inside_band": None if flags[-1] is None else not flags[-1],
            "local": local,
            "persistent": persistent,
            "sudden": sudden,
            "date": str(change.date) if change else None,
        }
    }
    b, a = cmp.before, cmp.after
    cap = f"Water index {b.mean:.2f} on {b.provenance.date}, {a.mean:.2f} on {a.provenance.date}."
    blocks = [
        earth.show.then_now(
            picture(area, b.provenance, "water"),
            picture(area, a.provenance, "water"),
            "Water, then and now",
            cap,
            area=area,
            primary=True,
        ),
        earth.show.timeline(
            s,
            "Water index inside the outline",
            "The shaded band is the usual range for each month.",
            marks=[(change.date, "change")] if change else [],
        ),
        earth.show.stat(
            "Area where water changed", cmp.changed_ha, "ha", provenance=[cmp.provenance]
        ),
    ]
    evidence = [
        {
            "measure": "water",
            "value": st.mean,
            "date": str(st.provenance.date),
            "scene": st.provenance.scene,
        }
        for st in (b, a)
    ]
    notes = [f"The surroundings moved {ring.delta:+.2f} over the same dates."]
    return {
        "findings": {"observed": observed, "changed_ha": cmp.changed_ha},
        "evidence": evidence,
        "blocks": blocks,
        "notes": notes,
    }
```

## Example 2: is the latest reading inside the usual range? (measure-only)

```python
# example: normal_range_check
import earth


def run(**params):
    area = earth.Area.from_geojson(params["area"], name=params.get("name"))
    measure = params.get("measure", "greenness")
    s = earth.series(area, measure, years=5)
    last = s.points[-1]
    band = {b.month: b for b in s.band}.get(last.date.month)
    inside = None if band is None else band.lo <= last.value <= band.hi
    notes = []
    if band is None:
        notes.append("No usual range for this month: too few clear scenes in earlier years.")
        cap = f"Latest reading {last.value:.2f} on {last.date}."
    else:
        word = "inside" if inside else "outside"
        cap = (
            f"Latest reading {last.value:.2f} on {last.date}, {word} the usual "
            f"{band.lo:.2f} to {band.hi:.2f}."
        )
    blocks = [
        earth.show.timeline(s, f"{measure.capitalize()} over 5 years", cap, primary=True),
        earth.show.stat(
            f"Latest {measure}",
            last.value,
            "index",
            lo=band.lo if band else None,
            hi=band.hi if band else None,
            provenance=[s.provenance],
        ),
    ]
    observed = {measure: {"value": last.value, "inside_band": inside}}
    evidence = [
        {"measure": measure, "value": last.value, "date": str(last.date), "scene": last.scene}
    ]
    return {
        "findings": {"observed": observed, "scenes": len(s.points)},
        "evidence": evidence,
        "blocks": blocks,
        "notes": notes,
    }
```
