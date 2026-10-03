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

import { request } from '../http';
import { usingFixtures } from '../config';
import * as fixtures from '../fixtures';
import type { DetectBoundaryResponse, ParseBoundaryFileResponse } from '../types';
import type { components } from '../schema';
import { toPlace, type Place } from '../../model';
import { approxAreaHa, ptsToRing } from '../../lib/geo';

type S = components['schemas'];

export type PlaceDto = S['PlaceDto'];
export type PlaceMemory = S['PlaceMemory'];
export type MemoryPatch = S['MemoryPatch'];
type DetectBoundaryDto = S['DetectBoundaryResponse'];
type ParseFileDto = S['ParseFileResponse'];

/** satellite reads on a cold cache take ~35 s; the server answers a fallback after 60 s */
const DETECT_TIMEOUT_MS = 75_000;

const fromDetectDto = (d: DetectBoundaryDto): DetectBoundaryResponse => ({
  geometry: d.geometry as unknown as DetectBoundaryResponse['geometry'],
  areaHa: d.area_ha,
  confidence: d.confidence,
  method: d.method,
  note: d.note ?? '',
});

const fromParseDto = (d: ParseFileDto, fileName: string): ParseBoundaryFileResponse => ({
  geometry: d.geometry as unknown as ParseBoundaryFileResponse['geometry'],
  center: d.center,
  areaHa: d.area_ha,
  suggestedName: d.name || fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Uploaded field',
  note: d.note ?? 'Outline from file',
});

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
   * POST /api/places/detect-boundary
   * Suggests the outline of the field / pond / plot around a coordinate (the "Use AI boundary"
   * option). Grown from the latest clear Sentinel-2 scene; `method: 'fallback_square'` with
   * `confidence: 'Low'` is a ~1 ha square when there is no usable imagery.
   */
  detectBoundary: (lat: number, lon: number, signal?: AbortSignal): Promise<DetectBoundaryResponse> =>
    request<DetectBoundaryDto>({
      method: 'POST',
      path: '/places/detect-boundary',
      body: { lat, lon },
      signal,
      timeoutMs: DETECT_TIMEOUT_MS,
      ...(usingFixtures()
        ? {
            fixture: (): DetectBoundaryDto => {
              const pts = fixtures.detectBoundary(lat, lon);
              return {
                geometry: { type: 'Polygon', coordinates: [ptsToRing(pts, { lat, lon })] },
                area_ha: approxAreaHa(pts, lat),
                confidence: 'Medium',
                method: 'sentinel2_segmentation',
                note: 'Sample outline (fixture data).',
              };
            },
          }
        : {}),
    }).then(fromDetectDto),

  /**
   * POST /api/places/parse-file (multipart, field `file`, max 5 MB)
   * One outline from GeoJSON, KML/KMZ, GPX or a CSV of lat/lon points. Shapefiles answer 415
   * with a hint to export GeoJSON or KML instead.
   */
  parseBoundaryFile: (file: File, signal?: AbortSignal): Promise<ParseBoundaryFileResponse> => {
    const form = new FormData();
    form.set('file', file);
    return request<ParseFileDto>({
      method: 'POST',
      path: '/places/parse-file',
      form,
      signal,
      ...(usingFixtures()
        ? {
            fixture: (): ParseFileDto => {
              const center = { lat: 37.9937, lon: -100.9216 };
              const pts = fixtures.detectBoundary(center.lat, center.lon, 460, 330);
              return {
                geometry: { type: 'Polygon', coordinates: [ptsToRing(pts, center)] },
                center,
                area_ha: approxAreaHa(pts, center.lat),
                name: null,
                note: /\.csv$/i.test(file.name) ? 'Outline around the uploaded points' : 'Outline from file',
              };
            },
          }
        : {}),
    }).then((d) => fromParseDto(d, file.name));
  },
};
