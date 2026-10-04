"""tree-cover-change: has tree cover been lost since a date? (BUILD-PLAN S1)

Runs in the sandbox like any agent script: public `earth` calls only. Compares greenness,
moisture and bare ground before and after (default: the same month in 2022 vs the latest
clear image), inside the outline and in the ring around it, and maps the changed patches.
"""
# ruff: noqa: E501
# fmt: off

import datetime

import earth

KEYS = ("value", "before", "after", "delta", "inside_band", "local", "persistent", "sudden", "date")
LOSS = -0.2  # vegetation_loss card: greenness down by more than 0.2
TREES = 0.5  # vegetation_loss card: a vegetated before-state reads above about 0.5


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


def _verdict(g, vegetated, trees):
    if not vegetated:
        return "no tree cover before"
    if g.delta <= LOSS:
        return "tree cover lost" if trees else "green cover lost"
    if g.delta <= LOSS / 2:
        return "some loss"
    if g.delta >= -LOSS:
        return "greener than before"
    return "no clear loss"


def _analyse(area, params, answers, notes):
    recent = earth.scenes(area, last="60d")
    after = _date(params["after"]) if params.get("after") else recent.latest_clear().date
    before = _date(params["before"]) if params.get("before") else _in_year(after, 2022)
    if before >= after:
        before = _in_year(after, after.year - 1)
        notes.append(f"The earlier date was not before the later one, so {before} was used.")
    ring = earth.surroundings(area)
    g = earth.compare(area, "greenness", before, after)
    rg = earth.compare(ring, "greenness", before, after)
    mo = earth.compare(area, "moisture", before, after)
    b = earth.compare(area, "bare", before, after)

    vegetated = g.before.mean >= 0.3
    trees = g.before.mean >= TREES
    verdict = _verdict(g, vegetated, trees)
    if vegetated and not trees:
        notes.append(f"Greenness {g.before.mean:.2f} before is below the ~0.5 of closed tree cover: this was mixed or sparse vegetation, not dense forest.")
    local = None
    if g.delta <= LOSS / 2:
        local = abs(g.delta - rg.delta) > 0.1
    lost_ha = g.changed_ha if g.delta < 0 else 0.0
    d0, d1 = g.before.provenance.date, g.after.provenance.date
    c0, c1 = round(100 * g.before.provenance.cloud_over_area, 1), round(100 * g.after.provenance.cloud_over_area, 1)
    pct = round(100 * lost_ha / area.area_ha, 1) if area.area_ha else 0.0
    rel = round(100 * g.delta / abs(g.before.mean), 1) if g.before.mean else None
    clear = recent.clear()

    blocks, r1 = [], None
    try:
        r0, r1 = _picture(area, g.before.provenance, "greenness"), _picture(area, g.after.provenance, "greenness")
        cap = f"Greenness (NDVI) {g.before.mean:.2f} on {d0} ({c0}% cloud), {g.after.mean:.2f} on {d1} ({c1}% cloud): {g.delta:+.2f}" + (f" ({rel:+.0f}%)." if rel is not None else ".")
        blocks.append(earth.show.then_now(r0, r1, "Green cover, then and now", cap, area=area, primary=True))
    except earth.EarthError:
        notes.append("The then/now pictures could not be rendered.")
    cap = f"{g.changed_ha:.1f} ha of the {area.area_ha:.1f} ha ({round(100 * g.changed_ha / area.area_ha, 1)}%) changed greenness by more than 0.15 in {len(g.patches)} patch(es); the surroundings moved {rg.delta:+.2f}."
    blocks.append(earth.show.highlight(g, "Where green cover changed", cap, base=r1, primary=not blocks))
    scap = f"{pct}% of the {area.area_ha:.1f} ha outline, {d0} to {d1}. Greenness {g.before.mean:.2f} to {g.after.mean:.2f}, moisture {mo.before.mean:.2f} to {mo.after.mean:.2f}, bare ground {b.before.mean:.2f} to {b.after.mean:.2f}."
    blocks.append(earth.show.stat("Area with less green cover", lost_ha, "ha", caption=scap, lo=0, hi=round(area.area_ha, 2), provenance=[g.provenance]))

    ev = []
    for k, c in (("greenness", g), ("moisture", mo), ("bare", b)):
        for s in (c.before, c.after):
            ev.append({"measure": k, "value": s.mean, "date": str(s.provenance.date), "scene": s.provenance.scene, "provenance": _prov(s.provenance)})
    notes += ["Optical only (Sentinel-2): radar was not used.", "The before date is matched to the same month to avoid seasonal differences; cloud can move it by a few weeks.", "Satellite images cannot show who removed vegetation, why, or whether it was allowed."]
    if area.area_ha < 1:
        notes.append("Under 1 ha: clearings smaller than about 50 m are invisible at 10 m.")
    findings = {
        "area_ha": area.area_ha,
        "before": str(before),
        "after": str(after),
        "verdict": verdict,
        "tree_cover_before": trees,
        "changed_ha": g.changed_ha,
        "lost_ha": lost_ha,
        "lost_pct_of_area": pct,
        "greenness_change_pct": rel,
        "dates_used": {"before": str(d0), "after": str(d1), "before_cloud_pct": c0, "after_cloud_pct": c1},
        "data": {"recent_passes": len(recent.scenes), "clear_passes": len(clear), "satellite": "Sentinel-2", "patches": len(g.patches)},
        "greenness": {"before": g.before.mean, "after": g.after.mean, "delta": g.delta},
        "moisture": {"before": mo.before.mean, "after": mo.after.mean, "delta": mo.delta},
        "bare": {"before": b.before.mean, "after": b.after.mean, "delta": b.delta},
        "surroundings": {"greenness_delta": rg.delta},
        "patches": [{"ha": p.ha, "centroid": list(p.centroid)} for p in g.patches[:5]],
        "observed": {
            "greenness": _obs(value=g.after.mean, before=g.before.mean, after=g.after.mean, delta=g.delta, local=local),
            "moisture": _obs(value=mo.after.mean, before=mo.before.mean, after=mo.after.mean, delta=mo.delta),
            "bare": _obs(value=b.after.mean, before=b.before.mean, after=b.after.mean, delta=b.delta),
        },
        "answers": answers,
    }
    return {"findings": findings, "evidence": ev, "blocks": blocks, "notes": notes}
