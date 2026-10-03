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
  /**
   * GET /api/catalog, once: the reference data and the map layers come from the same response
   * (in fixture mode the layers still come from the older `/map-layers` list).
   */
  load: async (signal?: AbortSignal): Promise<{ catalog: Catalog; mapLayers: MapLayer[] }> => {
    const d = await request<CatalogDto & { map_layers?: CatalogLayerDto[] }>({
      method: 'GET',
      path: '/catalog',
      signal,
      ...(usingFixtures() && { fixture: fixtures.catalog }),
    });
    const catalog: Catalog = {
      categories: d.categories.map(toCategory),
      satellites: d.satellites,
      modules: d.modules,
      channels: d.channels,
      languages: d.languages,
    };
    const mapLayers = usingFixtures()
      ? (await request<MapLayerDto[]>({ method: 'GET', path: '/map-layers', signal, fixture: fixtures.mapLayers })).map(toMapLayer)
      : (d.map_layers ?? []).map((l) =>
          toMapLayer({ id: l.id, name: l.name, source: l.source, color: LAYER_COLOR[l.id] ?? '#b2b6bd', isAgentMade: l.is_agent_made }),
        );
    return { catalog, mapLayers };
  },
};
