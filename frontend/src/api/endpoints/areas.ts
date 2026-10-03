/**
 * Areas: turn whatever the user gave us into an outline, and describe what is there.
 *
 *   POST /api/areas/resolve   pin · drawing · map link · coordinates · place name -> Area
 *   POST /api/areas/context   "what's at this place?" -> size, land cover, slope, passes
 *
 * See `docs/API.md` §7. `resolve` takes **exactly one** of `point`, `geojson`, `link` or
 * `query`, and reports in `source` how it read the input — a free-text `query` may come back
 * as `coordinates`, `preset` or `search`. A search also returns other candidates in `matches`,
 * which the UI offers as "Did you mean…".
 *
 * This supersedes the proposed `GET /api/places/search`: the contract's free-text branch is a
 * real geocoder (Nominatim via Meet's M9a provider), and it resolves far more than place names.
 *
 * Not in the contract, and so still stand-ins in `places.ts`: the boundary detector, file
 * parsing and the cadastre parcel lookup.
 */

import { request } from '../http';
import { usingFixtures } from '../config';
import * as fixtures from '../fixtures';
import type { components } from '../schema';

type S = components['schemas'];

export type AreaResolveRequest = S['AreaResolveRequest'];
export type AreaResolveResponse = S['AreaResolveResponse'];
export type Area = S['Area'];
export type AreaMatch = S['AreaMatch'];
export type PlaceContext = S['PlaceContext'];
export type AreaContextInput = Pick<AreaResolveRequest, 'point' | 'geojson'>;

/** Metres around a dropped pin when the caller has no outline — the contract requires a radius. */
export const DEFAULT_PIN_RADIUS_M = 350;

export const areasApi = {
  /** POST /api/areas/resolve */
  resolve: (body: AreaResolveRequest, signal?: AbortSignal): Promise<AreaResolveResponse> =>
    request<AreaResolveResponse>({
      method: 'POST',
      path: '/areas/resolve',
      body,
      signal,
      ...(usingFixtures() ? { fixture: () => fixtureResolve(body) } : {}),
    }),

  /** POST /api/areas/context */
  context: (body: AreaContextInput, signal?: AbortSignal): Promise<PlaceContext> =>
    request<PlaceContext>({
      method: 'POST',
      path: '/areas/context',
      body,
      signal,
      ...(usingFixtures() ? { fixture: () => fixtureContext(body) } : {}),
    }),

};

/* ------------------------------------------------------------------ fixtures */

const circle = (lat: number, lon: number, radiusM: number) => {
  // Rough equirectangular ring; good enough for a stand-in outline, and the server owns the
  // real geometry and area the moment it is reachable.
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  const ring = Array.from({ length: 33 }, (_, i) => {
    const a = (i / 32) * Math.PI * 2;
    return [lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)];
  });
  return { type: 'Polygon', coordinates: [ring] };
};

const haOfRadius = (radiusM: number) => (Math.PI * radiusM * radiusM) / 10_000;

function fixtureResolve(body: AreaResolveRequest): AreaResolveResponse {
  if (body.point) {
    const { lat, lon, radius_m } = body.point;
    return {
      area: { geojson: circle(lat, lon, radius_m), area_ha: haOfRadius(radius_m), name: null },
      source: 'point',
      matches: [],
    };
  }
  if (body.geojson) {
    // The server computes the real area; a stand-in cannot, so it reports 0 rather than a
    // number the UI might show as authoritative.
    return { area: { geojson: body.geojson, area_ha: 0, name: null }, source: 'geojson', matches: [] };
  }

  const q = (body.query ?? body.link ?? '').trim();
  const coords = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (coords) {
    const lat = Number(coords[1]);
    const lon = Number(coords[2]);
    return {
      area: {
        geojson: circle(lat, lon, DEFAULT_PIN_RADIUS_M),
        area_ha: haOfRadius(DEFAULT_PIN_RADIUS_M),
        name: null,
      },
      source: 'coordinates',
      matches: [],
    };
  }

  const hits = fixtures.placeSearch(q);
  const best = hits[0];
  if (!best) {
    return { area: { geojson: circle(0, 0, DEFAULT_PIN_RADIUS_M), area_ha: 0, name: null }, source: 'search', matches: [] };
  }
  return {
    area: {
      geojson: circle(best.lat, best.lon, DEFAULT_PIN_RADIUS_M),
      area_ha: haOfRadius(DEFAULT_PIN_RADIUS_M),
      name: best.name,
    },
    source: body.link ? 'link' : 'search',
    matches: hits.slice(1, 6).map((h) => ({ name: `${h.name}, ${h.description}`, lat: h.lat, lon: h.lon })),
  };
}

function fixtureContext(body: AreaContextInput): PlaceContext {
  const radius = body.point?.radius_m ?? DEFAULT_PIN_RADIUS_M;
  const areaHa = body.point ? haOfRadius(radius) : 0;
  return {
    name: null,
    country: null,
    area_ha: areaHa,
    pixels_10m: Math.round((areaHa * 10_000) / 100),
    land_cover: { cropland: 0.62, grassland: 0.21, tree_cover: 0.11, built_up: 0.06 },
    elevation_m: { min: 812, max: plausibleMaxElevation(areaHa) },
    slope_deg: { mean: 1.4, p90: 3.1 },
    rain_mm_30d: 38,
    recent_scenes: { optical: 12, clear: 9, radar: 6 },
    warnings: [],
  };
}

/** Keep the stand-in's elevation range plausible rather than constant across every area. */
const plausibleMaxElevation = (areaHa: number) =>
  812 + Math.round(Math.min(220, Math.sqrt(Math.max(1, areaHa)) * 9));
