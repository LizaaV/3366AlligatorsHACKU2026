"""`earth.show.*`: build output blocks (HANDOFF B9) from `earth` results.

earth.show.timeline(series, title="Greenness inside the ponds", compare=ring_series)
earth.show.then_now(earth.render(before), earth.render(after), title="March vs September")
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import date

from earth.blocks import (
    HighlightBlock,
    HypothesesBlock,
    HypothesisRow,
    Image,
    LimitAction,
    LimitsBlock,
    SceneStripBlock,
    StatBlock,
    StripScene,
    ThenNowBlock,
    TimelineBand,
    TimelineBlock,
    TimelineMark,
    TimelinePoint,
    TimelineSeries,
)
from earth.types import Area, Comparison, Provenance, RenderedLayer, SceneList, Series


def _id(given: str | None) -> str:
    return given or f"b_{uuid.uuid4().hex[:6]}"


def _image(r: RenderedLayer) -> Image:
    return Image(
        layer_id=r.layer_id,
        url=r.url,
        bounds=r.bounds,
        date=r.date,
        scene=r.scene,
        label=f"{r.date.day} {r.date:%b %Y}",
    )


def _points(s: Series) -> list[TimelinePoint]:
    return [
        TimelinePoint(date=p.date, value=p.value, scene=p.scene, clean_px=p.clean_px)
        for p in s.points
    ]


def timeline(
    series: Series,
    title: str,
    caption: str | None = None,
    compare: Series | None = None,
    compare_label: str = "Surroundings",
    marks: Iterable[tuple[date, str]] = (),
    primary: bool = False,
    id: str | None = None,
) -> TimelineBlock:
    return TimelineBlock(
        id=_id(id),
        primary=primary,
        title=title,
        caption=caption,
        measure=series.measure,
        unit="dB" if series.measure == "roughness" else None,
        data=_points(series),
        band=[TimelineBand(month=b.month, lo=b.lo, hi=b.hi) for b in series.band],
        marks=[TimelineMark(date=d, label=label) for d, label in marks],
        compare=[TimelineSeries(label=compare_label, data=_points(compare))] if compare else [],
        links={"time": "cursor"},
        provenance=[series.provenance] + ([compare.provenance] if compare else []),
    )


def then_now(
    before: RenderedLayer,
    after: RenderedLayer,
    title: str,
    caption: str | None = None,
    area: Area | None = None,
    primary: bool = False,
    id: str | None = None,
) -> ThenNowBlock:
    return ThenNowBlock(
        id=_id(id),
        primary=primary,
        title=title,
        caption=caption,
        measure=after.measure,
        before=_image(before),
        after=_image(after),
        outline=area.geojson if area else None,
        links={"time": "follow"},
    )


def scene_strip(
    scenes: SceneList,
    title: str = "Every pass",
    caption: str | None = None,
    id: str | None = None,
) -> SceneStripBlock:
    strip = [
        StripScene(
            scene=s.id,
            date=s.date,
            satellite=s.satellite,
            cloud=s.cloud_over_area,
            used=s.usable,
            why=None if s.usable else f"Cloudy over the area ({s.cloud_over_area:.0%})",
        )
        for s in sorted(scenes.scenes, key=lambda s: s.date)
    ]
    return SceneStripBlock(
        id=_id(id), title=title, caption=caption, scenes=strip, links={"time": "cursor"}
    )


def highlight(
    comparison: Comparison,
    title: str,
    caption: str | None = None,
    base: RenderedLayer | None = None,
    primary: bool = False,
    id: str | None = None,
) -> HighlightBlock:
    return HighlightBlock(
        id=_id(id),
        primary=primary,
        title=title,
        caption=caption,
        measure=comparison.measure,
        patches=comparison.patches,
        total_ha=comparison.changed_ha,
        base=_image(base) if base else None,
        links={"selection": "set"},
        provenance=[comparison.before.provenance, comparison.after.provenance],
    )


def stat(
    label: str,
    value: float,
    unit: str,
    title: str | None = None,
    caption: str | None = None,
    lo: float | None = None,
    hi: float | None = None,
    provenance: Iterable[Provenance] = (),
    primary: bool = False,
    id: str | None = None,
) -> StatBlock:
    return StatBlock(
        id=_id(id),
        primary=primary,
        title=title or label,
        caption=caption,
        label=label,
        value=value,
        unit=unit,
        lo=lo,
        hi=hi,
        provenance=list(provenance),
    )


def hypotheses(
    rows: Iterable[HypothesisRow | dict],
    title: str = "What else could it be",
    caption: str | None = None,
    post_hoc: bool = False,
    id: str | None = None,
) -> HypothesesBlock:
    return HypothesesBlock(
        id=_id(id),
        title=title,
        caption=caption,
        rows=[r if isinstance(r, HypothesisRow) else HypothesisRow(**r) for r in rows],
        post_hoc=post_hoc,
    )


def limits(
    cant_tell: str,
    actions: Iterable[LimitAction | dict] = (),
    contacts: Iterable[str] = (),
    rule_id: str | None = None,
    title: str = "What I can't tell",
    id: str | None = None,
) -> LimitsBlock:
    return LimitsBlock(
        id=_id(id),
        title=title,
        cant_tell=cant_tell,
        actions=[a if isinstance(a, LimitAction) else LimitAction(**a) for a in actions],
        contacts=list(contacts),
        rule_id=rule_id,
    )
