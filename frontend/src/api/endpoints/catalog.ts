/**
 * Reference data: categories, satellites, skill modules, delivery channels, languages, map
 * layers and the agent's clarifying questions.
 *
 * All of it is backend-owned registry data. Category *colour* is the one exception and is
 * merged in from `data/presentation.ts` by `toCategory()`.
 */

import { request } from '../http';
import * as fixtures from '../fixtures';
import type { CatalogDto, ClarifyingQuestionDto, MapLayerDto } from '../types';
import { toCategory, toMapLayer, type Catalog, type ClarifyingQuestion, type MapLayer } from '../../model';

export const catalogApi = {
  /** TODO(api): GET /api/catalog — see docs/data/README.md */
  get: (signal?: AbortSignal): Promise<Catalog> =>
    request<CatalogDto>({
      method: 'GET',
      path: '/catalog',
      signal,
      fixture: fixtures.catalog,
    }).then((d) => ({
      categories: d.categories.map(toCategory),
      satellites: d.satellites,
      modules: d.modules,
      channels: d.channels,
      languages: d.languages,
    })),

  /** TODO(api): GET /api/map-layers — could also be folded into /catalog */
  mapLayers: (signal?: AbortSignal): Promise<MapLayer[]> =>
    request<MapLayerDto[]>({
      method: 'GET',
      path: '/map-layers',
      signal,
      fixture: fixtures.mapLayers,
    }).then((ls) => ls.map(toMapLayer)),

  /** TODO(api): GET /api/ask/clarifying-questions */
  clarifyingQuestions: (signal?: AbortSignal): Promise<ClarifyingQuestion[]> =>
    request<ClarifyingQuestionDto[]>({
      method: 'GET',
      path: '/ask/clarifying-questions',
      signal,
      fixture: fixtures.clarifyingQuestions,
    }),
};
