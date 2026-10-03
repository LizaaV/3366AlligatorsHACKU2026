/**
 * Screen math: Web Mercator projection, tile addressing and SVG path helpers.
 *
 * This is rendering code and it stays in the frontend permanently — it is how tiles and
 * overlays get positioned in pixels. It is *not* backend work, and nothing here should ever
 * become a network call (a round-trip per pan frame would be absurd).
 *
 * The one exception is `areaHa`. Area is a **number of record**: it appears in answers, in
 * watch thresholds, in $/km² pricing and in feasibility gates. The backend owns the
 * authoritative value and returns it as `areaHa` on each place. The copy here exists only to
 * give live feedback while the user is still dragging an outline that has no server-side
 * identity yet — and the UI labels that number approximate. Never use it to overwrite a
 * saved place's area.
 */

export type Pt = [number, number];
/** GeoJSON order is [longitude, latitude]. */
export type Position = [number, number];

/** EOX Sentinel-2 cloudless basemap. Override with VITE_TILE_URL_TEMPLATE if the provider changes. */
const TILE_TEMPLATE =
  import.meta.env.VITE_TILE_URL_TEMPLATE ??
  'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg';

export const TILE = (z: number, x: number, y: number) =>
  TILE_TEMPLATE.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));

/** Reference zoom that pixel offsets in `Pt[]` are expressed at. */
export const REF_ZOOM = 16;

/** Web Mercator: lat/lon -> fractional tile coordinates at zoom `z`. */
export const txy = (lat: number, lon: number, z: number) => {
  const n = Math.pow(2, z);
  const r = (lat * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * n, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n };
};

/** Inverse of `txy`: move a lat/lon by an offset given in reference-zoom pixels. */
export const shift = (lat: number, lon: number, dx: number, dy: number) => {
  const n = Math.pow(2, REF_ZOOM);
  const t = txy(lat, lon, REF_ZOOM);
  const x = t.x + dx / 256;
  const y = t.y + dy / 256;
  return {
    lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI,
    lon: (x / n) * 360 - 180,
  };
};

export const thumb = (lat: number, lon: number, z: number) => {
  const t = txy(lat, lon, z);
  return TILE(z, Math.floor(t.x), Math.floor(t.y));
};

export const quad = (lat: number, lon: number, z: number) => {
  const t = txy(lat, lon, z);
  const x = Math.round(t.x);
  const y = Math.round(t.y);
  return [TILE(z, x - 1, y - 1), TILE(z, x, y - 1), TILE(z, x - 1, y), TILE(z, x, y)];
};

/* ---------- shape authoring (drawing helpers) ---------- */

export const circlePts = (r: number, n: number): Pt[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [+(Math.sin(a) * r).toFixed(1), +(-Math.cos(a) * r).toFixed(1)];
  });

export const rectPts = (w: number, h: number): Pt[] => [
  [-w / 2, -h / 2],
  [w / 2, -h / 2],
  [w / 2, h / 2],
  [-w / 2, h / 2],
];

/* ---------- geometry <-> contract conversion ---------- */

/** Metres per pixel at the reference zoom, corrected for latitude. */
export const mpp = (lat: number) => (156543.03 * Math.cos((lat * Math.PI) / 180)) / 65536;

/**
 * Reference-zoom pixel offsets -> a closed GeoJSON polygon ring in WGS84.
 * Used when sending a drawn or edited outline to the API.
 */
export const ptsToRing = (pts: Pt[], center: { lat: number; lon: number }): Position[] => {
  const ring = pts.map((p) => {
    const c = shift(center.lat, center.lon, p[0], p[1]);
    return [+c.lon.toFixed(7), +c.lat.toFixed(7)] as Position;
  });
  if (ring.length) ring.push([...ring[0]] as Position); // GeoJSON rings must close
  return ring;
};

/**
 * A GeoJSON polygon ring -> reference-zoom pixel offsets from `center`, for drawing.
 * The closing coordinate is dropped: the renderer treats the list as implicitly closed.
 */
export const ringToPts = (ring: Position[], center: { lat: number; lon: number }): Pt[] => {
  const c = txy(center.lat, center.lon, REF_ZOOM);
  const open =
    ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
      ? ring.slice(0, -1)
      : ring;
  return open.map(([lon, lat]) => {
    const t = txy(lat, lon, REF_ZOOM);
    return [+((t.x - c.x) * 256).toFixed(1), +((t.y - c.y) * 256).toFixed(1)] as Pt;
  });
};

/* ---------- measurement (provisional only — see file header) ---------- */

/**
 * Approximate polygon area in hectares, from reference-zoom pixel offsets.
 *
 * PROVISIONAL. Only for live feedback on a shape the user is still editing. Once a place is
 * saved, display `place.areaHa` from the API instead.
 */
export const approxAreaHa = (pts: Pt[], lat: number) => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return +(((Math.abs(a) / 2) * Math.pow(mpp(lat), 2)) / 10000).toFixed(1);
};

/** Longest side of a shape's bounding box, in reference-zoom pixels. */
export const extentOf = (pts: Pt[]) => {
  if (!pts.length) return 1;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1);
};

/** Zoom at which a shape fills roughly `box` pixels. */
export const fitZoom = (pts: Pt[], box: number) =>
  Math.max(3, Math.min(18, Math.floor(REF_ZOOM + Math.log2(box / extentOf(pts)))));

/* ---------- formatting / SVG ---------- */

export const fmtC = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`;

/** Normalised 0..1 series -> SVG polyline points. */
export const pts2 = (arr: number[], w = 300, h = 100, pad = 90) =>
  arr.map((v, i) => `${((i / (arr.length - 1)) * w).toFixed(1)},${(h - v * pad).toFixed(1)}`).join(' ');

/** Where the map opens before a place is selected: a neutral world view, not a real site. */
export const DEFAULT_CENTER = { lat: 20, lon: 10 };
export const DEFAULT_ZOOM = 16;

/**
 * The outer ring of a GeoJSON Polygon, MultiPolygon, Feature or FeatureCollection.
 *
 * The contract passes geometry as a bare `{[key: string]: unknown}`, so every caller that wants
 * coordinates has to narrow it. Doing that once here keeps the narrowing in one place — it was
 * briefly duplicated between the area mapper and the highlight overlay.
 *
 * Returns `[lon, lat]` pairs, GeoJSON's own axis order.
 */
export function outerRing(geojson: unknown): [number, number][] | null {
  const g = geojson as { type?: string; coordinates?: unknown; geometry?: unknown; features?: unknown[] };
  if (!g || typeof g !== 'object') return null;
  if (g.type === 'Feature') return outerRing(g.geometry);
  if (g.type === 'FeatureCollection') return outerRing((g.features ?? [])[0]);
  if (g.type === 'Polygon') return (g.coordinates as [number, number][][])?.[0] ?? null;
  if (g.type === 'MultiPolygon') return (g.coordinates as [number, number][][][])?.[0]?.[0] ?? null;
  return null;
}
