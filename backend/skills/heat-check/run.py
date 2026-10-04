"""heat-check: is this area hotter than its surroundings? (BUILD-PLAN S1)

Runs in the sandbox like any agent script: public `earth` calls only. Reads Landsat surface
temperature (`heat`) monthly inside the outline and in the ring around it, and compares the
two over the most recent clear passes.
"""
# ruff: noqa: E501
# fmt: off

import statistics

import earth

KEYS = ("value", "before", "after", "delta", "inside_band", "local", "persistent", "sudden", "date")
HOTTER = 2.0  # °C: a gap the 100 m Landsat thermal band can resolve
SAME = 1.0  # °C


def _obs(**v):
    return {k: v.get(k) for k in KEYS}


def _area(params):
    a, name = params.get("area"), params.get("name")
    if isinstance(a, dict) and "lat" in a and "lon" in a:
        a = earth.Area.from_point(a["lat"], a["lon"], a.get("radius_m", 400))
    elif isinstance(a, dict):
        a = earth.Area.from_geojson(a)
    return earth.Area(geojson=a.geojson, area_ha=a.area_ha, name=name or a.name)


def _prov(p):
    return {"provider": p.provider, "satellite": p.satellite, "scene": p.scene, "date": str(p.date), "method": p.method}


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


def _key(p):
    return (p.date.year, p.date.month)


def _analyse(area, params, answers, notes):
    years = params.get("years", 2)
    passes = params.get("passes", 6)
    ring = earth.surroundings(area)
    s = earth.series(area, "heat", years=years, every="month")
    r = earth.series(ring, "heat", years=years, every="month")
    around = {_key(p): p for p in r.points}
    pairs = [(p, around[_key(p)]) for p in s.points if _key(p) in around]
    if not pairs:
        raise earth.NoClearScenes("No month had a clear Landsat pass over both the area and its surroundings.", "Try a longer period.")
    last = pairs[-passes:]
    gaps = [round(a.value - b.value, 2) for a, b in last]
    gap = round(statistics.mean(gaps), 2)
    warmer = sum(1 for d in gaps if d > SAME)
    if gap >= HOTTER and warmer >= 0.7 * len(gaps):
        verdict = "hotter than the surroundings"
    elif gap <= -HOTTER and sum(1 for d in gaps if d < -SAME) >= 0.7 * len(gaps):
        verdict = "cooler than the surroundings"
    elif abs(gap) < SAME:
        verdict = "about the same as the surroundings"
    else:
        verdict = "slightly different, not consistent"
    p, rp = last[-1]
    band = {b.month: b for b in s.band}.get(p.date.month)
    inside = None if band is None else band.lo <= p.value <= band.hi
    first = pairs[: len(last)]
    early_gap = round(statistics.mean(a.value - b.value for a, b in first), 2) if len(pairs) >= 2 * len(last) else None

    mean_in = round(statistics.mean(a.value for a, _ in last), 1)
    mean_out = round(statistics.mean(b.value for _, b in last), 1)
    blocks = []
    spread = f"{min(gaps):+.1f} to {max(gaps):+.1f} °C" if len(gaps) > 1 else f"{gaps[0]:+.1f} °C"
    cap = f"Inside minus around, average of {len(last)} clear Landsat passes from {last[0][0].date} to {p.date} (range {spread}); {warmer} of {len(last)} were more than {SAME:.0f} °C warmer inside. Inside averaged {mean_in:.1f} °C, around {mean_out:.1f} °C."
    blocks.append(earth.show.stat("Warmer than the surroundings", gap, "°C", caption=cap, lo=min(gaps), hi=max(gaps), provenance=[s.provenance], primary=True))
    tcap = f"{len(s.points)} monthly clear passes over {years} year(s). Latest pass {p.date}: {p.value:.1f} °C inside, {rp.value:.1f} °C around ({p.value - rp.value:+.1f} °C)."
    blocks.append(earth.show.timeline(s, "Surface temperature inside the outline", tcap, compare=r))

    ev = []
    for a, b in last:
        ev.append({"measure": "heat", "value": a.value, "date": str(a.date), "scene": a.scene, "provenance": _prov(s.provenance)})
        ev.append({"measure": "heat (surroundings)", "value": b.value, "date": str(b.date), "scene": b.scene, "provenance": _prov(r.provenance)})
    notes += [
        "Surface temperature from Landsat 8/9 (thermal band at 100 m, resampled to 30 m), at about 10:30 local time on clear days: it is the temperature of roofs, roads and ground, not of the air.",
        "Passes are ~8 days apart and clouds hide many, so this uses the clearest pass per month.",
    ]
    if area.area_ha < 10:
        notes.append("Under 10 ha: only a few 100 m thermal pixels fit inside, so edges mix with the surroundings.")
    findings = {
        "area_ha": area.area_ha,
        "verdict": verdict,
        "gap_c": gap,
        "gaps_c": gaps,
        "passes": len(last),
        "inside_mean_c": mean_in,
        "around_mean_c": mean_out,
        "dates_used": {"first": str(last[0][0].date), "last": str(p.date)},
        "data": {"monthly_passes_inside": len(s.points), "monthly_passes_around": len(r.points), "paired_months": len(pairs), "satellite": "Landsat 8/9"},
        "warmer_passes": warmer,
        "early_gap_c": early_gap,
        "latest": {"date": str(p.date), "inside_c": p.value, "around_c": rp.value},
        "heat": {"value": p.value, "around": rp.value, "gap": gap},
        "observed": {
            "heat": _obs(value=p.value, inside_band=inside),  # inside vs around is in gap_c, not a change over time
        },
        "answers": answers,
    }
    return {"findings": findings, "evidence": ev, "blocks": blocks, "notes": notes}
