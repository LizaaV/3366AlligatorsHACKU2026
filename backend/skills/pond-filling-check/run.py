"""pond-filling-check: have these fish ponds been filled in? (HANDOFF B5, BUILD-PLAN S1)

Runs in the sandbox like any agent script: public `earth` calls only. The expectation table is
filled by code from the signs and thresholds on the pond_filling card and its look-alikes.
"""
# ruff: noqa: E501
# fmt: off

import datetime
import statistics

import earth

PAD = 0.05  # noise widening of the normal band (seasonal card)
ORDER = {"supported": 0, "unclear": 1, "contradicted": 2}
NO_RADAR = (0, "radar not used")


def _date(x):
    return datetime.date.fromisoformat(x) if isinstance(x, str) else x


def _years_ago(d, n):
    try:
        return d.replace(year=d.year - n)
    except ValueError:  # 29 Feb
        return d.replace(year=d.year - n, day=28)


def _area(params):
    a, name = params.get("area"), params.get("name")
    if a is None:
        a = earth.presets.HOO_HOK_WAI
    elif isinstance(a, dict) and "lat" in a and "lon" in a:
        a = earth.Area.from_point(a["lat"], a["lon"], a.get("radius_m", 400))
    elif isinstance(a, dict):
        a = earth.Area.from_geojson(a)
    return earth.Area(geojson=a.geojson, area_ha=a.area_ha, name=name or a.name)


def _near(s, d, n=3):
    pts = sorted(s.points, key=lambda p: abs((p.date - d).days))[:n]
    return statistics.mean(p.value for p in pts)


def _out(s, p):
    band = {b.month: b for b in s.band}.get(p.date.month)
    return band is not None and (p.value < band.lo - PAD or p.value > band.hi + PAD)


def _change(s):
    """First point that leaves the normal band and stays out (80% of the rest, next 3 out)."""
    flags = [_out(s, p) for p in s.points]
    for i, p in enumerate(s.points):
        rest = flags[i:]
        if len(rest) >= 2 and all(rest[:3]) and sum(rest) >= 0.8 * len(rest):
            return p
    return None


def _inside(s, n=3):
    return not any(_out(s, p) for p in s.points[-n:])


def _lvr(local, ring, before, after):
    ld = _near(local, after) - _near(local, before)
    rd = _near(ring, after) - _near(ring, before)
    if abs(ld) <= 0.1:
        label = "no notable change"
    elif abs(ld - rd) <= 0.1:
        label = "regional"
    else:
        label = "local"
    return {"local": round(ld, 3), "surroundings": round(rd, 3), "verdict": label}


def _prov(p):
    return {"provider": p.provider, "satellite": p.satellite, "scene": p.scene, "date": str(p.date), "method": p.method}


def _row(card, label, signs, need=None, cap=None):
    """signs: (measure, weight, state 1/0/-1, expected, observed). Score as B3.4; code decides."""
    top = sum(s[1] for s in signs)
    score = sum(s[1] if s[2] > 0 else (0.4 * s[1] if s[2] == 0 else -s[1]) for s in signs)
    need = 0.6 * top if need is None else need
    verdict = "supported" if score >= need else "unclear"
    if score < 0.25 * top:
        verdict = "contradicted"
    by_weight = sorted(signs, key=lambda s: -s[1])

    def pick(state):
        return [s[4] for s in by_weight if s[2] == state][:2]

    reason = "; ".join(pick(1) if verdict == "supported" else pick(-1))
    if verdict == "unclear":
        reason = "; ".join(pick(1)[:1] + pick(0)[:1] + pick(-1)[:1])
    if cap and verdict == "supported":
        verdict, reason = "unclear", cap
    exp, obs = {}, {}
    for s in signs:
        exp[s[0]] = exp[s[0]] + "; " + s[3] if s[0] in exp else s[3]
        obs[s[0]] = obs[s[0]] + "; " + s[4] if s[0] in obs else s[4]
    row = {"card_id": card, "label": label, "expected": exp, "observed": obs}
    row.update({"verdict": verdict, "reason": reason, "score": round(score / top, 2)})
    return row, score


def _then_now(area, s, before, after):
    best = max(p.clean_px for p in s.points)
    good = [p for p in s.points if p.clean_px >= 0.5 * best] or s.points
    out = []
    for d in (before, after):
        p = min(good, key=lambda q: abs((q.date - d).days))
        sc = earth.Scene(id=p.scene, date=p.date, satellite="Sentinel-2", provider="earth_search_s2", kind="optical", cloud_over_area=0.0, usable=True, resolution_m=10)
        out.append(earth.render(earth.index(earth.load(area, sc), "water")))
    return out


def _limits(exc, notes):
    acts = [{"label": "Draw a larger outline", "kind": "enlarge"}]
    if isinstance(exc, earth.NoClearScenes):
        acts = [{"label": "Check with radar", "kind": "radar"}, {"label": "Wait for a clearer pass", "kind": "wait"}]
    block = earth.show.limits(f"{exc.message} {exc.hint or ''}".strip(), actions=acts)
    return {"findings": {"limited": True, "reason": exc.kind}, "evidence": [], "blocks": [block], "notes": notes + [exc.message]}


def run(**params):
    notes, answers = [], params.get("answers") or {}
    area = _area(params)
    try:
        return _analyse(area, params, answers, notes)
    except (earth.NoClearScenes, earth.AreaTooSmall) as exc:
        return _limits(exc, notes)


def _hypotheses(m):
    """Expectation table (HANDOFF B3.3): card signs + look-alike tell_apart_by, filled by code."""
    w, b, mo, g0, g1 = m["w"], m["b"], m["mo"], m["g0"], m["g1"]
    drop = 1 if w.delta < -0.2 else (-1 if w.delta > -0.05 else 0)
    dry_now = 1 if mo.after.mean <= -0.05 else (-1 if mo.after.mean >= 0 else 0)
    pers = m["pers"]
    t_w = f"{w.before.mean:.2f} to {w.after.mean:.2f} ({w.delta:+.2f})"
    t_mo = f"moisture {mo.after.mean:.2f} after"
    t_b = f"{b.before.mean:.2f} to {b.after.mean:.2f} ({b.delta:+.2f})"
    t_g = f"{g0:.2f} to {g1:.2f}"
    t_p = m["t_pers"]
    pond = _row(
        "pond_filling",
        "Pond filled in",
        [
            ("water", 3, 1 if drop > 0 and w.after.mean < 0 else min(drop, 0), "down > 0.2, ends below 0", t_w),
            ("water, later", 3, pers, "below 0 in 3+ later scenes over 90+ days, incl. wet season", t_p),
            ("roughness", 2, NO_RADAR[0], "up > 6 dB", NO_RADAR[1]),
            ("moisture", 2, dry_now, "below -0.05 (dry fill)", t_mo),
            ("bare", 1, 1 if b.after.mean > 0 else (-1 if b.after.mean < -0.1 else 0), "above 0 after", f"bare {b.after.mean:.2f} after"),
            ("greenness", 1, 1 if g1 < 0.25 else -1, "below 0.25 after", f"greenness {g1:.2f} after"),
        ],
        need=8,  # card confidence: medium_min_weight 8 (high_min_weight 11)
    )
    ins = {k: _inside(m["loc"][k]) for k in ("greenness", "water", "bare")}
    t_in = {k: f"{k} inside" if v else f"{k} outside the band" for k, v in ins.items()}
    lv = m["lvr"]["water"]
    seasonal = _row(
        "seasonal",
        "Normal drain-down or harvest",
        [
            ("greenness", 3, 1 if ins["greenness"] else -1, "inside the normal band", t_in["greenness"]),
            ("water", 2, 1 if ins["water"] else -1, "inside the normal band", t_in["water"]),
            ("bare", 1, 1 if ins["bare"] else -1, "inside the normal band", t_in["bare"]),
            ("moisture", 2, 0, "inside the normal band", "no band for moisture"),
            ("surroundings", 2, 0 if drop == 0 else (1 if lv["verdict"] == "regional" else -1), "surroundings move too", f"{lv['verdict']} ({lv['surroundings']:+.2f} around)"),
        ],
    )
    water_loss = _row(
        "water_loss",
        "Pond drained or dried out, not filled",
        [
            ("water", 3, drop, "down > 0.2", t_w),
            ("roughness", 2, NO_RADAR[0], "up > 3 dB", NO_RADAR[1]),
            ("bare", 1, 1 if b.delta > 0.1 else 0, "up > 0.1", t_b),
            ("moisture", 3, -dry_now, "wet bed, near or above 0", t_mo),
            ("greenness", 2, 1 if g1 > 0.3 else (-1 if g1 < 0.25 else 0), "weeds colonise (> 0.3)", t_g),
            ("water, later", 3, -pers, "refills within weeks to months", t_p),
        ],
    )
    construction = _row(
        "construction",
        "Construction on the fill",
        [
            ("bare", 3, 1 if b.delta > 0.1 else (-1 if b.delta < 0.05 else 0), "up > 0.1", t_b),
            ("greenness", 2, 1 if g1 - g0 < -0.2 else -1, "down > 0.2", t_g),
            ("roughness", 3, NO_RADAR[0], "up > 3 dB (structures)", NO_RADAR[1]),
            ("water", 1, 1 if w.after.mean < 0.05 else -1, "below 0.05 after", f"water {w.after.mean:.2f} after"),
        ],
        cap="Looks like plain fill so far; radar or later change on the fill is needed to call it construction",
    )
    new_bare = _row(
        "new_bare_or_built",
        "New bare ground on what was land",
        [
            ("water", 3, -1 if w.before.mean > 0 else (1 if w.before.mean < -0.1 else 0), "was land before (NDWI below 0)", f"water {w.before.mean:.2f} before"),
            ("bare", 3, 1 if b.delta > 0.15 else -1, "up > 0.15", t_b),
        ],
    )
    pairs = [pond, seasonal, water_loss, construction, new_bare]
    rows = sorted((p[0] for p in pairs), key=lambda r: (ORDER[r["verdict"]], -r["score"]))
    return rows, pond[1]


def _analyse(area, params, answers, notes):
    years = params.get("years", 4)
    every = "month" if years * 12 <= 60 else "quarter"
    try:  # 1. what is there now
        ctx = earth.describe(area)
        wet = sum(v for k, v in ctx.land_cover.items() if "water" in k or "wetland" in k)
        if wet < 0.05:
            notes.append(f"Only {wet:.0%} reads as water or wetland now: the ponds may already be gone, which is itself evidence.")
        notes += list(ctx.warnings)
    except NotImplementedError:
        notes.append("Land cover was not available for this run.")
    recent = earth.scenes(area, last="60d")
    after = _date(params["after"]) if params.get("after") else recent.latest_clear().date
    before = _date(params["before"]) if params.get("before") else _years_ago(after, 2)

    ring = earth.surroundings(area)  # 2. local and regional series
    loc = {k: earth.series(area, k, years=years, every=every) for k in ("water", "bare", "greenness")}
    reg = {k: earth.series(ring, k, years=years, every=every) for k in ("water", "bare", "greenness")}
    cmp = {k: earth.compare(area, k, before, after) for k in ("water", "bare", "moisture")}  # 3.
    chg = {k: _change(loc[k]) for k in loc}  # 4. change date
    head = chg["water"] or chg["bare"] or chg["greenness"]
    lvr = {k: _lvr(loc[k], reg[k], before, after) for k in loc}
    w, b, mo = cmp["water"], cmp["bare"], cmp["moisture"]
    g0, g1 = _near(loc["greenness"], before), _near(loc["greenness"], after)
    later = [p for p in loc["water"].points if head and p.date >= head.date]
    dry = [p for p in later if p.value < 0]
    span = (dry[-1].date - dry[0].date).days if dry else 0
    persists = len(dry) >= 3 and span >= 90 and any(4 <= p.date.month <= 9 for p in dry)
    refilled = len(later) >= 2 and later[-1].value > 0
    t_pers = f"{len(dry)} of {len(later)} later scenes below 0 over {span} days"
    pers = 1 if persists else (-1 if refilled else 0)
    rows, pond_score = _hypotheses(
        {"w": w, "b": b, "mo": mo, "g0": g0, "g1": g1, "loc": loc, "lvr": lvr, "pers": pers if head else 0, "t_pers": t_pers}  # 5.
    )
    conf = "high" if pond_score >= 11 else ("medium" if pond_score >= 8 else "low")
    top = [r for r in rows if r["verdict"] == "supported"]
    if len(top) > 1 and top[0]["score"] - top[1]["score"] < 0.15:
        notes.append(f"Can't tell between {top[0]['label']} and {top[1]['label']}.")
    if w.before.mean <= 0:
        notes.append("The ponds read near or below 0 in the earlier image (algae or turbid water?), so the before state is weak evidence.")

    n_ha = w.changed_ha  # 6. blocks
    blocks, r1 = [], None
    try:
        r0, r1 = _then_now(area, loc["water"], before, after)
        cap = f"Water index {w.before.mean:.2f} in the earlier image, {w.after.mean:.2f} in the latest."
        blocks.append(earth.show.then_now(r0, r1, "The ponds, then and now", cap, area=area, primary=True))
    except earth.EarthError:
        notes.append("The then/now pictures could not be rendered.")
    marks = [(head.date, "change")] if head else []
    cap = f"Water index fell {abs(w.delta):.2f} inside the ponds; the surroundings moved {lvr['water']['surroundings']:+.2f}."
    blocks.append(earth.show.timeline(loc["water"], "Water inside the ponds", cap, compare=reg["water"], marks=marks, primary=not blocks))
    blocks.append(earth.show.highlight(w, "Where the water went", f"{n_ha:.1f} ha of the {area.area_ha:.1f} ha changed.", base=r1))
    blocks.append(earth.show.stat("Area changed", n_ha, "ha", caption=f"Bare ground changed on {b.changed_ha:.1f} ha.", provenance=[w.provenance]))
    blocks.append(earth.show.hypotheses(rows, caption="Ranked by what the satellite data supports."))
    blocks.append(earth.show.scene_strip(recent, "Recent passes"))

    ev = []
    for k, c in cmp.items():
        for s in (c.before, c.after):
            ev.append({"measure": k, "value": s.mean, "date": str(s.provenance.date), "scene": s.provenance.scene, "provenance": _prov(s.provenance)})
    for k, s in loc.items():
        p = s.points[-1]
        ev.append({"measure": k + " (series)", "value": p.value, "date": str(p.date), "scene": p.scene, "provenance": _prov(s.provenance)})
    notes += ["Optical only: radar was not used.", "Change dates come from monthly clear scenes, good to about a month.", "Satellite images cannot show who filled a pond, why, or whether it was allowed."]
    if area.area_ha < 1:
        notes.append("Under 1 ha: small changes are invisible at 10 m.")
    findings = {
        "area_ha": area.area_ha,
        "before": str(before),
        "after": str(after),
        "changed_ha": n_ha,
        "changed_ha_bare": b.changed_ha,
        "change_date": str(head.date) if head else None,
        "change_dates": {k: str(p.date) if p else None for k, p in chg.items()},
        "water": {"before": w.before.mean, "after": w.after.mean, "delta": w.delta},
        "bare": {"before": b.before.mean, "after": b.after.mean, "delta": b.delta},
        "moisture": {"before": mo.before.mean, "after": mo.after.mean, "delta": mo.delta},
        "greenness": {"before": round(g0, 3), "after": round(g1, 3)},
        "local_vs_regional": lvr,
        "persistence": {"dry_scenes": len(dry), "later_scenes": len(later), "days": span, "persists": persists},
        "verdicts": {r["card_id"]: r["verdict"] for r in rows},
        "top_hypothesis": rows[0]["card_id"],
        "confidence": conf,
        "answers": answers,
    }
    return {"findings": findings, "evidence": ev, "blocks": blocks, "notes": notes}
