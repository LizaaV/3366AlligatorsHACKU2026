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
import * as fixtures from '../fixtures';
import type {
  CreatePlaceRequest,
  DetectBoundaryResponse,
  ParcelLookupRequest,
  ParcelLookupResponse,
  ParseBoundaryFileResponse,
  PlaceDto,
} from '../types';
import { toPlace, type Place } from '../../model';
import { approxAreaHa, ptsToRing } from '../../lib/geo';

export const placesApi = {
  /** TODO(api): GET /api/places */
  list: (signal?: AbortSignal): Promise<Place[]> =>
    request<PlaceDto[]>({ method: 'GET', path: '/places', signal, fixture: fixtures.places }).then((l) => l.map(toPlace)),

  /** TODO(api): POST /api/places — returns the created place with the server's `areaHa` */
  create: (body: CreatePlaceRequest, signal?: AbortSignal): Promise<Place> =>
    request<PlaceDto>({
      method: 'POST',
      path: '/places',
      body,
      signal,
      fixture: () => fixtures.createPlace(body),
    }).then(toPlace),

  /** TODO(api): DELETE /api/places/{id} */
  remove: (id: string, signal?: AbortSignal): Promise<void> =>
    request<void>({
      method: 'DELETE',
      path: `/places/${encodeURIComponent(id)}`,
      signal,
      fixture: () => fixtures.deletePlace(id),
    }),


  /**
   * TODO(api): POST /api/places/detect-boundary
   * Suggests a field outline around a coordinate — the "AI boundary detector" in the add-place
   * wizard. The stand-in generates a deterministic field-like shape from the coordinates.
   */
  detectBoundary: (lat: number, lon: number, signal?: AbortSignal): Promise<DetectBoundaryResponse> =>
    request<DetectBoundaryResponse>({
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
   * TODO(api): POST /api/places/parse-file (multipart)
   * Parses KML / GeoJSON / Shapefile / CSV-of-points into a single outline.
   */
  parseBoundaryFile: (file: File, signal?: AbortSignal): Promise<ParseBoundaryFileResponse> => {
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

  /** TODO(api): POST /api/places/lookup-parcel — queries a cadastre/registry */
  lookupParcel: (body: ParcelLookupRequest, signal?: AbortSignal): Promise<ParcelLookupResponse> =>
    request<ParcelLookupResponse>({
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
