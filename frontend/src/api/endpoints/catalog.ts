/**
 * Reference data: categories, satellites, skill modules, delivery channels, languages and map
 * layers.
 *
 * The agent's clarifying questions used to live here too, behind a proposed
 * `GET /api/ask/clarifying-questions`. The contract has no such endpoint: the agent decides
 * what it needs to ask mid-run and emits `clarification_needed` on the stream instead.
 *
 * All of it is backend-owned registry data. Category *colour* is the one exception and is
 * merged in from `data/presentation.ts` by `toCategory()`.
 */

import { request } from '../http';
import { usingFixtures } from '../config';
import * as fixtures from '../fixtures';
import type { CatalogDto, MapLayerDto } from '../types';
import { toCategory, toMapLayer, type Catalog, type MapLayer } from '../../model';

/** One entry of `map_layers` in `GET /api/catalog`. */
interface CatalogLayerDto {
  id: string;
  name: string;
  source: string;
  is_agent_made: boolean;
}

/** Swatch colour per backend measure; presentation only, so it lives on this side. */
const LAYER_COLOR: Record<string, string> = {
  rgb: '#cfc7b0',
  greenness: '#2f9e44',
  moisture: '#14c6cb',
  water: '#1d78c1',
  bare: '#e8a33a',
  burn: '#d9381e',
  roughness: '#8a8f98',
  heat: '#f2994a',
};

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

  /**
   * Map layers. The backend folds them into `GET /api/catalog` as `map_layers` (ids are measure
   * names such as `greenness`, matching the `layer_id` on then/now blocks); the fixture keeps the
   * older `/map-layers` list.
   */
  mapLayers: (signal?: AbortSignal): Promise<MapLayer[]> =>
    usingFixtures()
      ? request<MapLayerDto[]>({
          method: 'GET',
          path: '/map-layers',
          signal,
          fixture: fixtures.mapLayers,
        }).then((ls) => ls.map(toMapLayer))
      : request<{ map_layers: CatalogLayerDto[] }>({ method: 'GET', path: '/catalog', signal }).then((d) =>
          (d.map_layers ?? []).map((l) =>
            toMapLayer({ id: l.id, name: l.name, source: l.source, color: LAYER_COLOR[l.id] ?? '#b2b6bd', isAgentMade: l.is_agent_made }),
          ),
        ),
};
