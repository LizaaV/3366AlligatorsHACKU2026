"""Read one outline from an uploaded boundary file (`POST /api/places/parse-file`).

GeoJSON (.geojson/.json), KML (.kml, and .kmz = zipped KML), GPX (.gpx) and CSV of points
(.csv with lat/lon columns) are read with the standard library. Shapefiles (.zip / .shp) need a
reader that is not a dependency of this project, so they answer 415 with a hint.

Whatever the format, the file yields polygons and/or points. Polygons: the largest wins.
Points only: the polygon through them in file order when that is a valid simple ring, otherwise
their convex hull. The result is re-measured by `earth.Area`.
"""

from __future__ import annotations

import csv
import io
import json
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import PurePath
from xml.etree import ElementTree

from shapely.geometry import MultiPoint, Point, Polygon, shape

import earth
from app.schemas.areas import MAX_VERTICES
from app.schemas.places import LatLon, ParseFileResponse

MAX_BYTES = 5 * 1024 * 1024


class FileProblem(Exception):
    """A file we can't use. The route turns it into `{kind, message, hint}` with `status`."""

    def __init__(self, status: int, kind: str, message: str, hint: str) -> None:
        super().__init__(message)
        self.status, self.kind, self.message, self.hint = status, kind, message, hint

    def detail(self) -> dict:
        return {"kind": self.kind, "message": self.message, "hint": self.hint}


@dataclass
class Found:
    polygons: list[Polygon] = field(default_factory=list)
    points: list[tuple[float, float]] = field(default_factory=list)  # (lon, lat), in file order
    name: str | None = None
    vertices: int = 0


_SHAPEFILE_HINT = (
    "Shapefiles can't be read here. Export the layer as GeoJSON or KML "
    "(in QGIS: right-click the layer, Export, Save Features As) and upload that."
)


def _bad(message: str, hint: str, status: int = 422, kind: str = "unreadable_file") -> FileProblem:
    return FileProblem(status, kind, message, hint)


def _count(found: Found, n: int) -> None:
    found.vertices += n
    if found.vertices > MAX_VERTICES:
        raise _bad(
            f"Outline too detailed: more than {MAX_VERTICES} points.",
            "Simplify the outline (in QGIS: Vector > Geometry > Simplify) and upload again.",
            413,
            "too_many_points",
        )


# --- GeoJSON ------------------------------------------------------------------------------------


def _geojson_walk(obj: object, found: Found, inherited: str | None = None) -> None:
    if not isinstance(obj, dict):
        return
    kind = obj.get("type")
    props = obj.get("properties") if isinstance(obj.get("properties"), dict) else {}
    name = _prop_name(props) or inherited
    if kind == "FeatureCollection":
        for f in obj.get("features") or []:
            _geojson_walk(f, found, name)
    elif kind == "Feature":
        _geojson_walk(obj.get("geometry"), found, name)
    elif kind == "GeometryCollection":
        for g in obj.get("geometries") or []:
            _geojson_walk(g, found, name)
    elif kind in ("Polygon", "MultiPolygon", "Point", "MultiPoint"):
        try:
            geom = shape(obj)
        except Exception as exc:  # noqa: BLE001 - shapely raises many types
            raise _bad(f"Bad geometry in the file: {exc}", "Check the coordinates.") from exc
        if geom.is_empty:
            return
        polys = list(geom.geoms) if geom.geom_type == "MultiPolygon" else [geom]
        if geom.geom_type in ("Polygon", "MultiPolygon"):
            for p in polys:
                _count(found, sum(len(r.coords) for r in (p.exterior, *p.interiors)))
                found.polygons.append(p)
        else:
            pts = list(geom.geoms) if geom.geom_type == "MultiPoint" else [geom]
            _count(found, len(pts))
            found.points += [(p.x, p.y) for p in pts]
        found.name = found.name or name


def _prop_name(props: dict | None) -> str | None:
    for key in ("name", "Name", "NAME", "title", "label"):
        v = (props or {}).get(key)
        if isinstance(v, str) and v.strip():
            return v.strip()
    return None


def _parse_geojson(data: bytes) -> Found:
    try:
        obj = json.loads(data.decode("utf-8-sig"))
    except (UnicodeDecodeError, ValueError) as exc:
        raise _bad("That isn't valid GeoJSON.", "Upload a .geojson file in WGS84.") from exc
    found = Found()
    _geojson_walk(obj, found)
    if isinstance(obj, dict) and isinstance(obj.get("name"), str) and not found.name:
        found.name = obj["name"].strip() or None
    return found


# --- XML (KML / GPX) ----------------------------------------------------------------------------


def _xml_root(data: bytes) -> ElementTree.Element:
    head = data[:4096].lower()
    if b"<!doctype" in head or b"<!entity" in head:  # no DTDs: entity-expansion attacks
        raise _bad("This file contains a DTD, which isn't allowed.", "Re-export it as plain KML.")
    try:
        root = ElementTree.fromstring(data)
    except ElementTree.ParseError as exc:
        raise _bad("That isn't valid XML.", "Upload a KML, KMZ or GPX file.") from exc
    for el in root.iter():  # drop namespaces: {http://...}Placemark -> Placemark
        el.tag = el.tag.rsplit("}", 1)[-1]
    return root


def _coords(text: str | None, found: Found) -> list[tuple[float, float]]:
    """KML coordinates: whitespace-separated `lon,lat[,alt]` tuples."""
    out = []
    for tup in (text or "").split():
        parts = tup.split(",")
        try:
            out.append((float(parts[0]), float(parts[1])))
        except (ValueError, IndexError) as exc:
            raise _bad(f"Bad coordinate {tup!r}.", "KML coordinates are lon,lat[,alt].") from exc
    _count(found, len(out))
    return out


def _parse_kml(data: bytes) -> Found:
    root = _xml_root(data)
    found = Found()
    for pm in root.iter("Placemark"):
        name = (pm.findtext("name") or "").strip() or None
        for poly in pm.iter("Polygon"):
            outer = poly.find("outerBoundaryIs/LinearRing/coordinates")
            ring = _coords(outer.text if outer is not None else None, found)
            if len(ring) >= 3:
                holes = [
                    _coords(h.text, found)
                    for h in poly.findall("innerBoundaryIs/LinearRing/coordinates")
                ]
                found.polygons.append(Polygon(ring, [h for h in holes if len(h) >= 3]))
                found.name = found.name or name
        in_polygon = {id(r) for p in pm.iter("Polygon") for r in p.iter("LinearRing")}
        for tag in ("Point", "LineString", "LinearRing"):
            for el in pm.iter(tag):
                if id(el) in in_polygon:
                    continue
                found.points += _coords(el.findtext("coordinates"), found)
                found.name = found.name or name
    found.name = found.name or (root.findtext(".//Document/name") or "").strip() or None
    return found


def _parse_gpx(data: bytes) -> Found:
    root = _xml_root(data)
    found = Found()
    for tag in ("trkpt", "rtept", "wpt"):
        for pt in root.iter(tag):
            try:
                found.points.append((float(pt.attrib["lon"]), float(pt.attrib["lat"])))
            except (KeyError, ValueError) as exc:
                raise _bad("A GPX point has no valid lat/lon.", "Re-export the GPX file.") from exc
    _count(found, len(found.points))
    found.name = (
        root.findtext(".//trk/name") or root.findtext(".//metadata/name") or ""
    ).strip() or None
    return found


def _parse_kmz(data: bytes) -> Found:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            kmls = [i for i in z.infolist() if i.filename.lower().endswith(".kml")]
            if not kmls:
                raise _bad("No .kml file inside the KMZ.", "Re-export it from Google Earth.")
            if kmls[0].file_size > MAX_BYTES:
                raise _bad(
                    "The KML inside is too large.", "Upload a smaller file.", 413, "too_large"
                )
            return _parse_kml(z.read(kmls[0]))
    except zipfile.BadZipFile as exc:
        raise _bad("That isn't a valid KMZ.", "Upload a .kml or .kmz file.") from exc


# --- CSV ----------------------------------------------------------------------------------------

_LAT = {"lat", "latitude", "y", "lat_deg"}
_LON = {"lon", "lng", "long", "longitude", "x", "lon_deg"}


def _parse_csv(data: bytes) -> Found:
    try:
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise _bad("The CSV isn't UTF-8 text.", "Save it as CSV (UTF-8).") from exc
    sample = text[:4096]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
    except csv.Error:
        dialect = csv.excel
    rows = [r for r in csv.reader(io.StringIO(text), dialect) if any(c.strip() for c in r)]
    if not rows:
        raise _bad("The CSV is empty.", "Add a header row with lat and lon columns.")
    head = [c.strip().lower() for c in rows[0]]
    lat_i = next((i for i, c in enumerate(head) if c in _LAT), None)
    lon_i = next((i for i, c in enumerate(head) if c in _LON), None)
    if lat_i is None or lon_i is None:
        raise _bad(
            "Couldn't find lat and lon columns.",
            "Name the columns `lat` and `lon` (or latitude/longitude).",
        )
    found = Found()
    for n, row in enumerate(rows[1:], start=2):
        try:
            found.points.append(
                (float(row[lon_i].replace(",", ".")), float(row[lat_i].replace(",", ".")))
            )
        except (ValueError, IndexError) as exc:
            raise _bad(
                f"Row {n} has no valid lat/lon.", "Each row needs numeric lat and lon."
            ) from exc
    _count(found, len(found.points))
    return found


# --- dispatch -----------------------------------------------------------------------------------


def _sniff(data: bytes, ext: str) -> str:
    if ext in (".geojson", ".json"):
        return "geojson"
    if ext in (".kml", ".kmz", ".gpx", ".csv"):
        return ext[1:]
    if ext in (".zip", ".shp", ".shx", ".dbf"):
        return "shapefile"
    head = data.lstrip()[:200]
    if head.startswith((b"{", b"[")):
        return "geojson"
    if head.startswith(b"<"):
        return "gpx" if b"<gpx" in data[:2000].lower() else "kml"
    if data[:2] == b"PK":
        return "shapefile"
    raise _bad(
        "Unsupported file type.",
        "Upload GeoJSON, KML, KMZ, GPX or a CSV with lat and lon columns.",
        415,
        "unsupported_type",
    )


def _outline(found: Found) -> tuple[Polygon, str]:
    if found.polygons:
        n = len(found.polygons)
        poly = max(found.polygons, key=lambda p: p.area)
        return poly, "Outline from file" if n == 1 else f"Largest of {n} outlines in the file"
    pts = found.points
    if len(pts) < 3:
        raise _bad(
            "No outline found: need a polygon, or at least 3 points.",
            "Upload a file with a polygon, or points around the field.",
        )
    ordered = Polygon(pts)
    if ordered.is_valid and not ordered.is_empty and ordered.area > 0:
        return ordered, f"Outline through {len(pts)} points, in file order"
    hull = MultiPoint([Point(p) for p in pts]).convex_hull
    if hull.geom_type != "Polygon":
        raise _bad("The points are in a line.", "Add points that surround the field.")
    return hull, f"Outline around {len(pts)} points"


def parse_boundary_file(filename: str, data: bytes) -> ParseFileResponse:
    """Raises FileProblem (HTTP 413 / 415 / 422) for anything we can't turn into one outline."""
    if len(data) > MAX_BYTES:
        raise _bad(
            f"File is larger than {MAX_BYTES // (1024 * 1024)} MB.",
            "Simplify the outline or upload a smaller file.",
            413,
            "too_large",
        )
    if not data:
        raise _bad("The file is empty.", "Choose a boundary file.")
    ext = PurePath(filename or "").suffix.lower()
    fmt = _sniff(data, ext)
    if fmt == "shapefile":
        raise FileProblem(
            415, "unsupported_type", "Shapefiles are not supported yet.", _SHAPEFILE_HINT
        )
    found = {
        "geojson": _parse_geojson,
        "kml": _parse_kml,
        "kmz": _parse_kmz,
        "gpx": _parse_gpx,
        "csv": _parse_csv,
    }[fmt](data)
    poly, note = _outline(found)
    try:
        area = earth.Area.from_geojson(
            {"type": "Polygon", "coordinates": [[list(p) for p in poly.exterior.coords]]},
            name=found.name,
        )
    except earth.EarthError as exc:
        raise _bad(exc.message, exc.hint or "Check the outline.") from exc
    lat, lon = area.centroid()
    return ParseFileResponse(
        geometry=area.geojson,
        area_ha=round(area.area_ha, 2),
        name=found.name or _name_from_filename(filename),
        center=LatLon(lat=lat, lon=lon),
        note=note,
    )


def _name_from_filename(filename: str) -> str | None:
    stem = re.sub(r"[_\-\s]+", " ", PurePath(filename or "").stem).strip()
    return stem[:1].upper() + stem[1:] if stem else None
