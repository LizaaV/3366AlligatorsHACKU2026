/**
 * Live views (`GET /api/views/passes`, `GET /api/views`): look at a spot before asking.
 *
 * One rendered PNG in one band from one recent clear Sentinel-2 pass, pinned to WGS84 bounds:
 * a saved place inside its own outline, or a 2 km square around a dropped pin. Rendered by our backend and cached there, so
 * nothing depends on a public tile server. Fixture mode has no views (404).
 */

import { ApiError, request } from '../http';
import { usingFixtures } from '../config';
import type { components } from '../schema';

type S = components['schemas'];
export type ViewPass = S['ViewPass'];
export type ViewImage = S['ViewImage'];
export type ViewBand = ViewImage['band'];

const none = (): never => {
  throw new ApiError('Live views need the real backend', 'http', 404);
};

/** A saved place (drawn inside its outline) or a dropped pin (a 2 km square around it). */
export type ViewTarget = { placeId: string } | { lat: number; lon: number };

const where = (t: ViewTarget) =>
  'placeId' in t ? { place_id: t.placeId } : { lat: +t.lat.toFixed(5), lon: +t.lon.toFixed(5) };

export const viewsApi = {
  passes: (target: ViewTarget, signal?: AbortSignal): Promise<ViewPass[]> =>
    request<ViewPass[]>({
      method: 'GET',
      path: '/views/passes',
      query: where(target),
      signal,
      ...(usingFixtures() ? { fixture: none } : {}),
    }),

  image: (target: ViewTarget, band: ViewBand, scene?: string, signal?: AbortSignal): Promise<ViewImage> =>
    request<ViewImage>({
      method: 'GET',
      path: '/views',
      query: { ...where(target), band, ...(scene ? { scene } : {}) },
      signal,
      ...(usingFixtures() ? { fixture: none } : {}),
    }),
};
