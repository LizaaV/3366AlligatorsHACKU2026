"""POST /api/places/detect-boundary and /api/places/parse-file. No network."""

import io
import json
import zipfile
from datetime import date

import numpy as np
import pytest
from fastapi.testclient import TestClient

import earth
from app.main import app
from app.schemas.areas import MAX_VERTICES
from app.services import boundary, place_files

client = TestClient(app)
LAT, LON = 22.4884, 114.0448


def _grid(lat=LAT, lon=LON, n=60, half_deg=0.0027) -> boundary.IndexGrid:
    """60x60 px (10 m) around the point: a green field in the middle-left, bare land around it,
    and a pond in the top-right corner."""
    ndvi = np.full((n, n), 0.1, dtype=np.float32)
    ndwi = np.full((n, n), -0.2, dtype=np.float32)
    ndvi[15:45, 10:40] = 0.75  # the field: 30 x 30 px = 9 ha
    ndwi[15:45, 10:40] = -0.55
    ndvi[0:8, 50:60] = -0.1  # a pond elsewhere
    ndwi[0:8, 50:60] = 0.6
    rng = np.random.default_rng(1)
    ndvi += rng.normal(0, 0.01, ndvi.shape).astype(np.float32)
    ndwi += rng.normal(0, 0.01, ndwi.shape).astype(np.float32)
    bounds = (lon - half_deg, lat - half_deg, lon + half_deg, lat + half_deg)
    return boundary.IndexGrid(ndvi, ndwi, bounds, date(2026, 9, 25), 0.02)


def _seed_in_field(g: boundary.IndexGrid) -> tuple[float, float]:
    w, s, e, n = g.bounds
    return n - (n - s) * 30 / 60, w + (e - w) * 25 / 60  # row 30, col 25 -> (lat, lon)


def test_region_grows_over_the_field_only(monkeypatch):
    g = _grid()
    lat, lon = _seed_in_field(g)
    monkeypatch.setattr(boundary, "read_indices", lambda la, lo: g)
    r = client.post("/api/places/detect-boundary", json={"lat": lat, "lon": lon})
    assert r.status_code == 200
    body = r.json()
    assert body["method"] == "sentinel2_segmentation"
    assert body["confidence"] in ("High", "Medium")
    assert body["geometry"]["type"] == "Polygon"
    # 30 x 30 px at ~10 m (a 600 m box over 60 px) is ~9 ha; the pond and bare land are excluded
    assert 7 < body["area_ha"] < 11


def test_seed_on_the_pond_traces_the_pond(monkeypatch):
    g = _grid()
    w, s, e, n = g.bounds
    lat, lon = n - (n - s) * 4 / 60, w + (e - w) * 55 / 60
    out = boundary.segment(g, lat, lon)
    assert out is not None
    assert 0.5 < out.area_ha < 1.5  # 8 x 10 px ~ 0.8 ha


def test_whole_box_one_value_falls_back(monkeypatch):
    flat = boundary.IndexGrid(
        np.full((60, 60), 0.5, np.float32),
        np.full((60, 60), -0.3, np.float32),
        (LON - 0.0027, LAT - 0.0027, LON + 0.0027, LAT + 0.0027),
    )
    monkeypatch.setattr(boundary, "read_indices", lambda la, lo: flat)
    body = client.post("/api/places/detect-boundary", json={"lat": LAT, "lon": LON}).json()
    assert body["method"] == "fallback_square"
    assert body["confidence"] == "Low"
    assert 0.9 < body["area_ha"] < 1.1


def test_single_pixel_region_falls_back(monkeypatch):
    ndvi = np.zeros((60, 60), np.float32)
    ndvi[::2, ::2] = 1.0  # checkerboard-ish: 4-connected regions are single pixels
    ndvi[1::2, 1::2] = 1.0
    g = boundary.IndexGrid(
        ndvi, np.zeros_like(ndvi), (LON - 0.0027, LAT - 0.0027, LON + 0.0027, LAT + 0.0027)
    )
    assert boundary.segment(g, LAT, LON) is None


@pytest.mark.parametrize("failure", ["none", "error", "nogrid"])
def test_imagery_problems_never_500(monkeypatch, failure):
    def read(lat, lon):
        if failure == "error":
            raise OSError("network down")
        return None

    monkeypatch.setattr(boundary, "read_indices", read)
    r = client.post("/api/places/detect-boundary", json={"lat": LAT, "lon": LON})
    assert r.status_code == 200
    assert r.json()["method"] == "fallback_square"


def test_validates_coordinates():
    assert client.post("/api/places/detect-boundary", json={"lat": 95, "lon": 0}).status_code == 422
    assert client.post("/api/places/detect-boundary", json={"lat": 1}).status_code == 422


def test_stub_path_is_deterministic(monkeypatch):
    monkeypatch.setenv("EARTH_IMPL", "stub")
    assert earth.settings.impl() == "stub"
    a = client.post("/api/places/detect-boundary", json={"lat": LAT, "lon": LON})
    b = client.post("/api/places/detect-boundary", json={"lat": LAT, "lon": LON})
    assert a.status_code == 200
    assert a.json() == b.json()
    assert a.json()["method"] in ("sentinel2_segmentation", "fallback_square")


# --- parse-file ---------------------------------------------------------------------------------

RING = [[114.09, 22.53], [114.0915, 22.53], [114.0915, 22.5315], [114.09, 22.5315], [114.09, 22.53]]


def _upload(name: str, data: bytes):
    return client.post("/api/places/parse-file", files={"file": (name, data)})


def test_geojson_feature_with_name():
    gj = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {"name": "East pond"},
                "geometry": {"type": "Polygon", "coordinates": [RING]},
            }
        ],
    }
    r = _upload("x.geojson", json.dumps(gj).encode())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["name"] == "East pond"
    assert body["geometry"]["type"] == "Polygon"
    assert 2 < body["area_ha"] < 3
    assert abs(body["center"]["lat"] - 22.53075) < 1e-3


def test_geojson_multipolygon_takes_largest():
    small = [
        [[114.0, 22.0], [114.0005, 22.0], [114.0005, 22.0005], [114.0, 22.0005], [114.0, 22.0]]
    ]
    gj = {"type": "MultiPolygon", "coordinates": [small, [RING]]}
    body = _upload("two.json", json.dumps(gj).encode()).json()
    assert body["center"]["lat"] > 22.5
    assert body["name"] == "Two"  # from the file name when the file has none


KML = """<?xml version="1.0"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Doc</name>
<Placemark><name>Plot 7</name><Polygon><outerBoundaryIs><LinearRing><coordinates>
114.09,22.53,0 114.0915,22.53,0 114.0915,22.5315,0 114.09,22.5315,0 114.09,22.53,0
</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>"""


def test_kml_and_kmz():
    r = _upload("plot.kml", KML.encode())
    assert r.status_code == 200, r.text
    assert r.json()["name"] == "Plot 7"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("doc.kml", KML)
    r = _upload("plot.kmz", buf.getvalue())
    assert r.status_code == 200 and r.json()["name"] == "Plot 7"


def test_kml_with_doctype_is_refused():
    evil = '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><kml><Placemark/></kml>'
    assert _upload("e.kml", evil.encode()).status_code == 422


def test_csv_points_in_order_and_hull():
    ordered = "lat,lon\n22.53,114.09\n22.53,114.0915\n22.5315,114.0915\n22.5315,114.09\n"
    r = _upload("pts.csv", ordered.encode())
    assert r.status_code == 200, r.text
    assert "4 points" in r.json()["note"]
    bowtie = "latitude;longitude\n22.53;114.09\n22.5315;114.0915\n22.53;114.0915\n22.5315;114.09\n"
    r = _upload("bow.csv", bowtie.encode())
    assert r.status_code == 200 and r.json()["geometry"]["type"] == "Polygon"


def test_csv_without_lat_lon_columns():
    r = _upload("bad.csv", b"a,b\n1,2\n3,4\n5,6\n")
    assert r.status_code == 422
    assert "lat" in r.json()["detail"]["hint"]


def test_shapefile_zip_is_415_with_hint():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("field.shp", b"x")
    r = _upload("field.zip", buf.getvalue())
    assert r.status_code == 415
    assert "GeoJSON" in r.json()["detail"]["hint"]


def test_unknown_type_and_empty_file():
    assert _upload("a.pdf", b"%PDF-1.4 binary").status_code == 415
    assert _upload("a.geojson", b"").status_code == 422
    assert _upload("a.geojson", b"not json").status_code == 422


def test_points_only_geojson_with_two_points_is_422():
    gj = {"type": "MultiPoint", "coordinates": [[114.0, 22.0], [114.1, 22.1]]}
    assert _upload("p.geojson", json.dumps(gj).encode()).status_code == 422


def test_too_big_and_too_many_vertices(monkeypatch):
    assert _upload("big.geojson", b" " * (place_files.MAX_BYTES + 1)).status_code == 413
    n = MAX_VERTICES + 5
    ring = [[114 + i * 1e-6, 22 + (i % 2) * 1e-6] for i in range(n)]
    ring.append(ring[0])
    gj = {"type": "Polygon", "coordinates": [ring]}
    r = _upload("dense.geojson", json.dumps(gj).encode())
    assert r.status_code == 413
    assert r.json()["detail"]["kind"] == "too_many_points"
