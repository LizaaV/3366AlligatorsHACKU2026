/**
 * Live views (`GET /api/views/passes`, `GET /api/views`): look at a spot before asking.
 *
 * One rendered PNG of a 2 km square around a point, in one band, from one recent clear
 * Sentinel-2 pass, pinned to WGS84 bounds. Rendered by our backend and cached there, so
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

export const viewsApi = {
  passes: (lat: number, lon: number, signal?: AbortSignal): Promise<ViewPass[]> =>
    request<ViewPass[]>({
      method: 'GET',
      path: '/views/passes',
      query: { lat: +lat.toFixed(5), lon: +lon.toFixed(5) },
      signal,
      ...(usingFixtures() ? { fixture: none } : {}),
    }),

  image: (lat: number, lon: number, band: ViewBand, scene?: string, signal?: AbortSignal): Promise<ViewImage> =>
    request<ViewImage>({
      method: 'GET',
      path: '/views',
      query: { lat: +lat.toFixed(5), lon: +lon.toFixed(5), band, ...(scene ? { scene } : {}) },
      signal,
      ...(usingFixtures() ? { fixture: none } : {}),
    }),
};
