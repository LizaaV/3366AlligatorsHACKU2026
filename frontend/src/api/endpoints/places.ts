/**
 * Places: the user's saved fields, plots, sites and water bodies.
 *
 * Free-text place lookup is NOT here: the contract puts it on `POST /api/areas/resolve`, which
 * reads names, coordinates and map links alike — see `endpoints/areas.ts`.
 *
 * Geometry crosses this boundary as GeoJSON in WGS84. `toPlace()` projects it into
 * reference-zoom pixels for drawing; `ptsToRing()` converts back when saving. Area is never
 * sent — the backend computes and returns it.
 */

import { notAvailable, request } from '../http';
import { usingFixtures } from '../config';
import * as fixtures from '../fixtures';
import type {
  DetectBoundaryResponse,
  ParcelLookupRequest,
  ParcelLookupResponse,
  ParseBoundaryFileResponse,
} from '../types';
import type { components } from '../schema';
import { toPlace, type Place } from '../../model';
import { approxAreaHa, ptsToRing } from '../../lib/geo';

type S = components['schemas'];

export type PlaceDto = S['PlaceDto'];
export type PlaceMemory = S['PlaceMemory'];
export type MemoryPatch = S['MemoryPatch'];

/**
 * What the add-place wizard produces, in the frontend's own vocabulary.
 *
 * The contract speaks snake_case (`category_key`, `is_circle`); mapping happens at this
 * boundary rather than in the wizard, so components never see wire names.
 */
export interface NewPlace {
  name: string;
  categoryKey: string;
  center: { lat: number; lon: number };
  geometry: { type: 'Polygon'; coordinates: number[][][] };
  isCircle: boolean;
  project: string;
  tags: string[];
  source: PlaceDto['source'];
  details?: { label: string; value: string }[];
}

/** Fields a saved place can be edited through — `PATCH /api/places/{id}`. */
export interface PlacePatch {
  name?: string;
  categoryKey?: string;
  project?: string;
  tags?: string[];
}

const toCreateBody = (p: NewPlace): S['CreatePlaceRequest'] => ({
  name: p.name,
  category_key: p.categoryKey,
  center: p.center,
  geometry: p.geometry,
  is_circle: p.isCircle,
  project: p.project,
  tags: p.tags,
  source: p.source,
  details: p.details ?? [],
});

export const placesApi = {
  /** GET /api/places */
  list: (signal?: AbortSignal): Promise<Place[]> =>
    request<PlaceDto[]>({
      method: 'GET',
      path: '/places',
      signal,
      ...(usingFixtures() ? { fixture: fixtures.places } : {}),
    }).then((l) => l.map(toPlace)),

  /** GET /api/places/{place_id} */
  get: (id: string, signal?: AbortSignal): Promise<Place> =>
    request<PlaceDto>({
      method: 'GET',
      path: `/places/${encodeURIComponent(id)}`,
      signal,
      ...(usingFixtures() ? { fixture: () => fixtures.place(id) } : {}),
    }).then(toPlace),

  /** POST /api/places — the response carries the server's authoritative `area_ha`. */
  create: (body: NewPlace, signal?: AbortSignal): Promise<Place> =>
    request<PlaceDto>({
      method: 'POST',
      path: '/places',
      body: toCreateBody(body),
      signal,
      ...(usingFixtures() ? { fixture: () => fixtures.createPlace(toCreateBody(body)) } : {}),
    }).then(toPlace),

  /** PATCH /api/places/{place_id} */
  update: (id: string, patch: PlacePatch, signal?: AbortSignal): Promise<Place> =>
    request<PlaceDto>({
      method: 'PATCH',
      path: `/places/${encodeURIComponent(id)}`,
      body: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.categoryKey !== undefined ? { category_key: patch.categoryKey } : {}),
        ...(patch.project !== undefined ? { project: patch.project } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      },
      signal,
      ...(usingFixtures() ? { fixture: () => fixtures.updatePlace(id, patch) } : {}),
    }).then(toPlace),

  /** DELETE /api/places/{place_id} */
  remove: (id: string, signal?: AbortSignal): Promise<void> =>
    request<void>({
      method: 'DELETE',
      path: `/places/${encodeURIComponent(id)}`,
      signal,
      ...(usingFixtures() ? { fixture: () => fixtures.deletePlace(id) } : {}),
    }),

  /**
   * GET /api/places/{place_id}/memory
   *
   * What the agent has learned about a place: a profile it prefills clarifications from, the
   * insights saved off runs, and dated notes. This is the source of the "From memory · 12 Sep"
   * badge on a clarification card.
   */
  memory: (id: string, signal?: AbortSignal): Promise<PlaceMemory> =>
    request<PlaceMemory>({
      method: 'GET',
      path: `/places/${encodeURIComponent(id)}/memory`,
      signal,
      ...(usingFixtures() ? { fixture: () => fixtures.placeMemory(id) } : {}),
    }),

  /** PATCH /api/places/{place_id}/memory — merge profile fields, or append a note. */
  patchMemory: (id: string, patch: MemoryPatch, signal?: AbortSignal): Promise<PlaceMemory> =>
    request<PlaceMemory>({
      method: 'PATCH',
      path: `/places/${encodeURIComponent(id)}/memory`,
      body: patch,
      signal,
      ...(usingFixtures() ? { fixture: () => fixtures.patchPlaceMemory(id, patch) } : {}),
    }),


  /**
   * Suggests a field outline around a coordinate — the "AI boundary detector" in the add-place
   * wizard. NOT on the backend: http mode rejects with `not_available` (no request); the
   * fixture generates a deterministic field-like shape from the coordinates.
   */
  detectBoundary: (lat: number, lon: number, signal?: AbortSignal): Promise<DetectBoundaryResponse> =>
    !usingFixtures() ? notAvailable('Boundary detection') : request<DetectBoundaryResponse>({
      method: 'POST',
      path: '/places/detect-boundary',
      body: { lat, lon },
      signal,
      fixture: () => {
        const pts = fixtures.detectBoundary(lat, lon);
        return {
          geometry: { type: 'Polygon' as const, coordinates: [ptsToRing(pts, { lat, lon })] },
          areaHa: approxAreaHa(pts, lat),
          confidence: 'Medium' as const,
        };
      },
    }),

  /**
   * Parses KML / GeoJSON / Shapefile / CSV-of-points into a single outline. NOT on the
   * backend: http mode rejects with `not_available` (no request); the fixture fakes an outline.
   */
  parseBoundaryFile: (file: File, signal?: AbortSignal): Promise<ParseBoundaryFileResponse> => {
    if (!usingFixtures()) return notAvailable('Boundary files');
    const form = new FormData();
    form.set('file', file);
    return request<ParseBoundaryFileResponse>({
      method: 'POST',
      path: '/places/parse-file',
      form,
      signal,
      fixture: () => {
        const center = { lat: 37.9937, lon: -100.9216 };
        const pts = fixtures.detectBoundary(center.lat, center.lon, 460, 330);
        const base = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Uploaded field';
        return {
          geometry: { type: 'Polygon' as const, coordinates: [ptsToRing(pts, center)] },
          center,
          areaHa: approxAreaHa(pts, center.lat),
          suggestedName: base.charAt(0).toUpperCase() + base.slice(1),
          note: /\.csv$/i.test(file.name) ? 'Outline around the uploaded points' : 'Outline from file',
        };
      },
    });
  },

  /**
   * Queries a cadastre/registry. NOT on the backend: http mode rejects with `not_available`
   * (no request); the fixture fakes a parcel.
   */
  lookupParcel: (body: ParcelLookupRequest, signal?: AbortSignal): Promise<ParcelLookupResponse> =>
    !usingFixtures() ? notAvailable('Parcel lookup') : request<ParcelLookupResponse>({
      method: 'POST',
      path: '/places/lookup-parcel',
      body,
      signal,
      fixture: () => {
        const sys = fixtures.PARCEL_SYSTEMS.find((p) => p.id === body.system) ?? fixtures.PARCEL_SYSTEMS[0];
        const center = { lat: sys.lat, lon: sys.lon };
        const pts = fixtures.detectBoundary(sys.lat, sys.lon, 380, 420);
        return {
          geometry: { type: 'Polygon' as const, coordinates: [ptsToRing(pts, center)] },
          center,
          areaHa: approxAreaHa(pts, sys.lat),
          registryLabel: `${sys.name.split(' · ')[1] ?? sys.name} ${body.parcelId.trim()}`,
          categoryKey: sys.categoryKey,
        };
      },
    }),

  /** Registry systems offered in the add-place wizard. TODO(api): fold into GET /api/catalog */
  parcelSystems: () => fixtures.PARCEL_SYSTEMS,

  /** Inbound WhatsApp location pins. TODO(api): GET /api/places/inbound-pins */
  inboundPins: () => fixtures.WHATSAPP_PINS,
  whatsappNumber: () => fixtures.WHATSAPP_NUMBER,
};
