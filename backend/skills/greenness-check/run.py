"""greenness-check: is this place as green as usual for the time of year? (BUILD-PLAN S1)

Runs in the sandbox like any agent script: public `earth` calls only. Reads the monthly
greenness series inside the outline and in the ring around it, checks the latest clear
reading against the usual range for its month, and pictures the same month a year earlier.
"""
# ruff: noqa: E501
# fmt: off

import earth

PAD = 0.05  # noise widening of the normal band (seasonal card)
KEYS = ("value", "before", "after", "delta", "inside_band", "local", "persistent", "sudden", "date")


def _obs(**v):
    return {k: v.get(k) for k in KEYS}


def _years_ago(d, n):
    try:
        return d.replace(year=d.year - n)
    except ValueError:  # 29 Feb
        return d.replace(year=d.year - n, day=28)


def _area(params):
    a, name = params.get("area"), params.get("name")
    if isinstance(a, dict) and "lat" in a and "lon" in a:
        a = earth.Area.from_point(a["lat"], a["lon"], a.get("radius_m", 400))
    elif isinstance(a, dict):
        a = earth.Area.from_geojson(a)
    return earth.Area(geojson=a.geojson, area_ha=a.area_ha, name=name or a.name)


def _prov(p):
    return {"provider": p.provider, "satellite": p.satellite, "scene": p.scene, "date": str(p.date), "method": p.method}


def _band(s, p):
    return {b.month: b for b in s.band}.get(p.date.month)


def _status(s, p):
    """(label, inside_band, normal mean) for one series point."""
    band = _band(s, p)
    if band is None:
        return "no usual range", None, None
    if p.value < band.lo - PAD:
        return "less green than usual", False, band.mean
    if p.value > band.hi + PAD:
        return "greener than usual", False, band.mean
    return "as green as usual", True, band.mean


def _picture(area, prov):
    sc = earth.Scene(id=prov.scene, date=prov.date, satellite=prov.satellite, provider=prov.provider, kind="optical", cloud_over_area=prov.cloud_over_area, usable=True, resolution_m=10)
    return earth.render(earth.index(earth.load(area, sc), "greenness"))


def _limits(exc, notes):
    acts = [{"label": "Draw a larger outline", "kind": "enlarge"}]
    if isinstance(exc, earth.NoClearScenes):
        acts = [{"label": "Wait for a clearer pass", "kind": "wait"}]
    block = earth.show.limits(f"{exc.message} {exc.hint or ''}".strip(), actions=acts)
    return {"findings": {"limited": True, "reason": exc.kind, "observed": {}}, "evidence": [], "blocks": [block], "notes": notes + [exc.message]}


def run(**params):
    notes, answers = [], params.get("answers") or {}
    area = _area(params)
    try:
        return _analyse(area, params, answers, notes)
    except (earth.NoClearScenes, earth.AreaTooSmall) as exc:
        return _limits(exc, notes)


def _analyse(area, params, answers, notes):
    years = params.get("years", 4)
    recent = earth.scenes(area, last="60d")
    latest = recent.latest_clear()
    ring = earth.surroundings(area)
    s = earth.series(area, "greenness", years=years, every="month")
    r = earth.series(ring, "greenness", years=years, every="month")
    if not s.points:
        raise earth.NoClearScenes("No clear greenness readings in this period.", "Try a longer period.")
    p = s.points[-1]
    label, inside, normal = _status(s, p)
    rp = min(r.points, key=lambda q: abs((q.date - p.date).days)) if r.points else None
    r_label, r_inside, r_normal = _status(r, rp) if rp else ("no reading", None, None)
    gap = round(p.value - normal, 3) if normal is not None else None
    r_gap = round(rp.value - r_normal, 3) if rp and r_normal is not None else None
    # local: unusual inside while the ring is usual; False when the ring is unusual too
    local = None if inside is None or inside or r_inside is None else r_inside
    if label == "no usual range":
        notes.append("No usual range for this month yet (too few clear earlier years): the reading is compared year on year only.")

    # Same month a year earlier, for the pictures and the year-on-year change.
    after = latest.date
    before = _years_ago(after, 1)
    cmp = earth.compare(area, "greenness", before, after)

    # A run of out-of-range months: when it started and whether it lasts.
    out = [q for q in s.points if _status(s, q)[1] is False]
    tail = []
    for q in reversed(s.points):
        if _status(s, q)[1] is False:
            tail.append(q)
        else:
            break
    tail.reverse()
    since = tail[0].date if tail else None
    persistent = (len(tail) >= 3 and (tail[-1].date - tail[0].date).days >= 90) if tail else None

    clear = recent.clear()
    cloud_pct = round(100 * latest.cloud_over_area, 1)
    gap_pct = round(100 * gap / normal, 1) if gap is not None and normal else None
    pct_area = round(100 * cmp.changed_ha / area.area_ha, 1) if area.area_ha else 0.0
    d0, d1 = cmp.before.provenance.date, cmp.after.provenance.date
    band = _band(s, p)
    lo, hi = (band.lo, band.hi) if band else (None, None)
    blocks = []
    try:
        r0, r1 = _picture(area, cmp.before.provenance), _picture(area, cmp.after.provenance)
        cap = f"Greenness (NDVI) {cmp.before.mean:.2f} on {d0}, {cmp.after.mean:.2f} on {d1} ({cmp.delta:+.2f}); {cmp.changed_ha:.1f} ha ({pct_area}% of {area.area_ha:.1f} ha) changed by more than 0.15."
        blocks.append(earth.show.then_now(r0, r1, "Green cover, a year ago and now", cap, area=area, primary=True))
    except earth.EarthError:
        notes.append("The then/now pictures could not be rendered.")
    marks = [(since, "change")] if since else []
    cap = f"{len(s.points)} monthly clear readings. Latest {p.value:.2f} on {p.date} ({label}"
    cap += f", usual {lo:.2f} to {hi:.2f})" if band else ")"
    cap += f"; the surroundings read {rp.value:.2f} ({r_label})." if rp else "."
    if since:
        cap += f" Outside the usual range since {since} ({len(tail)} months in a row)."
    blocks.append(earth.show.timeline(s, "Greenness inside the outline", cap, compare=r, marks=marks, primary=not blocks))
    if normal is not None:
        stat_cap = f"On {p.date}. Usual for this month {normal:.2f} (range {lo:.2f} to {hi:.2f}); now {gap:+.2f} ({gap_pct if gap_pct is not None else 0:+.0f}%) from usual. Image {cloud_pct}% cloud over the area."
    else:
        stat_cap = f"On {p.date}. No usual range for this month yet; a year earlier it was {cmp.before.mean:.2f}."
    blocks.append(earth.show.stat("Greenness now", round(p.value, 3), "NDVI", caption=stat_cap, lo=lo, hi=hi, provenance=[s.provenance]))
    blocks.append(earth.show.scene_strip(recent, "Recent passes", f"{len(clear)} of {len(recent.scenes)} passes in the last 60 days were clear enough to use."))

    ev = [
        {"measure": "greenness (series)", "value": p.value, "date": str(p.date), "scene": p.scene, "provenance": _prov(s.provenance)},
        {"measure": "greenness", "value": cmp.before.mean, "date": str(d0), "scene": cmp.before.provenance.scene, "provenance": _prov(cmp.before.provenance)},
        {"measure": "greenness", "value": cmp.after.mean, "date": str(d1), "scene": cmp.after.provenance.scene, "provenance": _prov(cmp.after.provenance)},
    ]
    notes += ["The usual range comes from the same calendar month in earlier years, widened a little for noise.", "Greenness shows living plant cover, not which plants or why it changed."]
    findings = {
        "area_ha": area.area_ha,
        "latest_date": str(p.date),
        "verdict": label,
        "greenness": {"value": round(p.value, 3), "unit": "NDVI", "date": str(p.date), "normal": normal, "gap": gap, "gap_pct": gap_pct, "lo": lo, "hi": hi},
        "surroundings": {"value": round(rp.value, 3) if rp else None, "normal": r_normal, "gap": r_gap, "verdict": r_label},
        "year_on_year": {"before": cmp.before.mean, "before_date": str(d0), "after": cmp.after.mean, "after_date": str(d1), "delta": cmp.delta, "changed_ha": cmp.changed_ha, "changed_pct_of_area": pct_area},
        "data": {"monthly_readings": len(s.points), "recent_passes": len(recent.scenes), "clear_passes": len(clear), "latest_cloud_pct": cloud_pct, "latest_scene": latest.id, "satellite": latest.satellite},
        "unusual_since": str(since) if since else None,
        "unusual_months": len(out),
        "observed": {
            "greenness": _obs(value=round(p.value, 3), before=cmp.before.mean, after=cmp.after.mean, delta=cmp.delta, inside_band=inside, local=local, persistent=persistent, date=str(since) if since else None),
        },
        "answers": answers,
    }
    return {"findings": findings, "evidence": ev, "blocks": blocks, "notes": notes}
