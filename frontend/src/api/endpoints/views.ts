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
export type PrefetchResult = S['PrefetchResult'];
/** How far back passes go: the latest clear ones (`4m`), or one clear pass a month for up to 5 years. */
export type ViewPeriod = '4m' | '1y' | '2y' | '5y';

const none = (): never => {
  throw new ApiError('Live views need the real backend', 'http', 404);
};

/** A saved place (drawn inside its outline) or a dropped pin (a 2 km square around it). */
export type ViewTarget = { placeId: string } | { lat: number; lon: number };

const where = (t: ViewTarget) =>
  'placeId' in t ? { place_id: t.placeId } : { lat: +t.lat.toFixed(5), lon: +t.lon.toFixed(5) };

export const viewsApi = {
  passes: (target: ViewTarget, period: ViewPeriod = '4m', signal?: AbortSignal): Promise<ViewPass[]> =>
    request<ViewPass[]>({
      method: 'GET',
      path: '/views/passes',
      query: { ...where(target), period },
      signal,
      ...(usingFixtures() ? { fixture: none } : {}),
    }),

  image: (target: ViewTarget, band: ViewBand, scene?: string, period: ViewPeriod = '4m', signal?: AbortSignal): Promise<ViewImage> =>
    request<ViewImage>({
      method: 'GET',
      path: '/views',
      query: { ...where(target), band, period, ...(scene ? { scene } : {}) },
      signal,
      ...(usingFixtures() ? { fixture: none } : {}),
    }),

  /** POST /api/views/prefetch — warm the period in the background (all bands for 4m; the pass list and newest photos for longer). */
  prefetch: (target: ViewTarget, period: ViewPeriod = '4m', signal?: AbortSignal): Promise<PrefetchResult> =>
    request<PrefetchResult>({
      method: 'POST',
      path: '/views/prefetch',
      query: { ...where(target), period },
      signal,
      ...(usingFixtures() ? { fixture: none } : {}),
    }),
};
