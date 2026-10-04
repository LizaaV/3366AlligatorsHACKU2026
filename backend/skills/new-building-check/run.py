"""new-building-check: has anything been built here since a date? (BUILD-PLAN S1)

Runs in the sandbox like any agent script: public `earth` calls only. Compares bare ground
(NDBI) and greenness before and after (default: the same month in 2022 vs the latest clear
image), inside the outline and in the ring, plus radar roughness when radar is available.
"""
# ruff: noqa: E501
# fmt: off

import datetime

import earth

KEYS = ("value", "before", "after", "delta", "inside_band", "local", "persistent", "sudden", "date")
BARE_UP = 0.1  # construction card: bare up by more than 0.1
RADAR_UP = 3.0  # construction card: roughness up by more than 3 dB


def _obs(**v):
    return {k: v.get(k) for k in KEYS}


def _date(x):
    return datetime.date.fromisoformat(x) if isinstance(x, str) else x


def _in_year(d, year):
    try:
        return d.replace(year=year)
    except ValueError:  # 29 Feb
        return d.replace(year=year, day=28)


def _area(params):
    a, name = params.get("area"), params.get("name")
    if isinstance(a, dict) and "lat" in a and "lon" in a:
        a = earth.Area.from_point(a["lat"], a["lon"], a.get("radius_m", 400))
    elif isinstance(a, dict):
        a = earth.Area.from_geojson(a)
    return earth.Area(geojson=a.geojson, area_ha=a.area_ha, name=name or a.name)


def _prov(p):
    return {"provider": p.provider, "satellite": p.satellite, "scene": p.scene, "date": str(p.date), "method": p.method}


def _picture(area, prov, measure):
    sc = earth.Scene(id=prov.scene, date=prov.date, satellite=prov.satellite, provider=prov.provider, kind="optical", cloud_over_area=prov.cloud_over_area, usable=True, resolution_m=10)
    return earth.render(earth.index(earth.load(area, sc), measure))


def _limits(exc, notes):
    acts = [{"label": "Draw a larger outline", "kind": "enlarge"}]
    if isinstance(exc, earth.NoClearScenes):
        acts = [{"label": "Check with radar", "kind": "radar"}, {"label": "Try other dates", "kind": "other"}]
    block = earth.show.limits(f"{exc.message} {exc.hint or ''}".strip(), actions=acts)
    return {"findings": {"limited": True, "reason": exc.kind, "observed": {}}, "evidence": [], "blocks": [block], "notes": notes + [exc.message]}


def run(**params):
    notes, answers = [], params.get("answers") or {}
    area = _area(params)
    try:
        return _analyse(area, params, answers, notes)
    except (earth.NoClearScenes, earth.AreaTooSmall) as exc:
        return _limits(exc, notes)


def _verdict(b, g, radar):
    up = b.delta > BARE_UP
    lost_green = g.delta < -0.2
    if radar is not None and radar.delta > RADAR_UP and up:
        return "new structures likely"
    if up and lost_green:
        return "new bare or built ground"
    if up or lost_green:
        return "some change, unclear"
    return "no clear change"


def _analyse(area, params, answers, notes):
    recent = earth.scenes(area, last="60d")
    after = _date(params["after"]) if params.get("after") else recent.latest_clear().date
    before = _date(params["before"]) if params.get("before") else _in_year(after, 2022)
    if before >= after:
        before = _in_year(after, after.year - 1)
        notes.append(f"The earlier date was not before the later one, so {before} was used.")
    ring = earth.surroundings(area)
    b = earth.compare(area, "bare", before, after)
    rb = earth.compare(ring, "bare", before, after)
    g = earth.compare(area, "greenness", before, after)
    radar = None
    try:
        radar = earth.compare(area, "roughness", before, after)
    except earth.EarthError as exc:
        notes.append(f"Radar was not used: {exc.message}")

    verdict = _verdict(b, g, radar)
    local = None
    if b.delta > BARE_UP / 2:
        local = abs(b.delta - rb.delta) > BARE_UP / 2
    built_ha = b.changed_ha if b.delta > 0 else 0.0
    d0, d1 = b.before.provenance.date, b.after.provenance.date
    c0, c1 = round(100 * b.before.provenance.cloud_over_area, 1), round(100 * b.after.provenance.cloud_over_area, 1)
    pct = round(100 * built_ha / area.area_ha, 1) if area.area_ha else 0.0
    rel = round(100 * b.delta / abs(b.before.mean), 1) if b.before.mean else None
    clear = recent.clear()

    blocks, r1 = [], None
    try:
        r0, r1 = _picture(area, b.before.provenance, "bare"), _picture(area, b.after.provenance, "bare")
        cap = f"Bare-ground index (NDBI) {b.before.mean:.2f} on {d0} ({c0}% cloud), {b.after.mean:.2f} on {d1} ({c1}% cloud): {b.delta:+.2f}."
        blocks.append(earth.show.then_now(r0, r1, "Bare and built ground, then and now", cap, area=area, primary=True))
    except earth.EarthError:
        notes.append("The then/now pictures could not be rendered.")
    cap = f"{b.changed_ha:.1f} ha of the {area.area_ha:.1f} ha ({round(100 * b.changed_ha / area.area_ha, 1)}%) changed by more than 0.10 in {len(b.patches)} patch(es); the surroundings moved {rb.delta:+.2f}."
    blocks.append(earth.show.highlight(b, "Where the ground changed", cap, base=r1, primary=not blocks))
    rcap = f" Radar roughness {radar.before.mean:.1f} to {radar.after.mean:.1f} dB ({radar.delta:+.1f} dB; structures add over 3 dB)." if radar is not None else " Radar not used."
    scap = f"{pct}% of the {area.area_ha:.1f} ha outline, {d0} to {d1}. Bare-ground index {b.before.mean:.2f} to {b.after.mean:.2f}, greenness {g.before.mean:.2f} to {g.after.mean:.2f}.{rcap}"
    blocks.append(earth.show.stat("New bare or built ground", built_ha, "ha", caption=scap, lo=0, hi=round(area.area_ha, 2), provenance=[b.provenance]))

    ev = []
    pairs = [("bare", b), ("greenness", g)] + ([("roughness", radar)] if radar is not None else [])
    for k, c in pairs:
        for s in (c.before, c.after):
            ev.append({"measure": k, "value": s.mean, "date": str(s.provenance.date), "scene": s.provenance.scene, "provenance": _prov(s.provenance)})
    notes += ["Bare ground and roofs look alike at 10-20 m: the data shows new bare or built surface, not what was built.", "Satellite images cannot show who built it, why, or whether it was allowed."]
    if area.area_ha < 1:
        notes.append("Under 1 ha: patches smaller than about 50 m are invisible at 20 m.")
    observed = {
        "bare": _obs(value=b.after.mean, before=b.before.mean, after=b.after.mean, delta=b.delta, local=local),
        "greenness": _obs(value=g.after.mean, before=g.before.mean, after=g.after.mean, delta=g.delta),
    }
    if radar is not None:
        observed["roughness"] = _obs(value=radar.after.mean, before=radar.before.mean, after=radar.after.mean, delta=radar.delta)
    findings = {
        "area_ha": area.area_ha,
        "before": str(before),
        "after": str(after),
        "verdict": verdict,
        "changed_ha": b.changed_ha,
        "built_ha": built_ha,
        "built_pct_of_area": pct,
        "bare_change_pct": rel,
        "dates_used": {"before": str(d0), "after": str(d1), "before_cloud_pct": c0, "after_cloud_pct": c1},
        "data": {"recent_passes": len(recent.scenes), "clear_passes": len(clear), "satellite": "Sentinel-2" + (" + Sentinel-1" if radar is not None else ""), "patches": len(b.patches)},
        "bare": {"before": b.before.mean, "after": b.after.mean, "delta": b.delta},
        "greenness": {"before": g.before.mean, "after": g.after.mean, "delta": g.delta},
        "roughness": {"before": radar.before.mean, "after": radar.after.mean, "delta": radar.delta} if radar is not None else None,
        "radar_used": radar is not None,
        "surroundings": {"bare_delta": rb.delta},
        "patches": [{"ha": p.ha, "centroid": list(p.centroid)} for p in b.patches[:5]],
        "observed": observed,
        "answers": answers,
    }
    return {"findings": findings, "evidence": ev, "blocks": blocks, "notes": notes}
