/**
 * Reference data: categories, satellites, skill modules, delivery channels, languages and map
 * layers — all from `GET /api/catalog` (`docs/API.md` §14).
 *
 * The agent's clarifying questions are not here: the agent decides what it needs to ask
 * mid-run and emits `clarification_needed` on the stream instead.
 *
 * All of it is backend-owned registry data. Colours are the exception: category colour comes
 * from `data/presentation.ts` via `toCategory()`, layer colour from `toMapLayer()`.
 */

import { request } from '../http';
import * as fixtures from '../fixtures';
import type { CatalogDto } from '../types';
import { CONTOUR_LAYER, toCategory, toMapLayer, type Catalog, type MapLayer } from '../../model';

const fetchCatalog = (signal?: AbortSignal) =>
  request<CatalogDto>({
    method: 'GET',
    path: '/catalog',
    signal,
    fixture: fixtures.catalog,
  });

const layersOf = (d: CatalogDto): MapLayer[] => [
  CONTOUR_LAYER,
  ...(d.map_layers ?? []).filter((l) => l.id !== CONTOUR_LAYER.id).map(toMapLayer),
];

export const catalogApi = {
  /** GET /api/catalog */
  get: (signal?: AbortSignal): Promise<Catalog> =>
    fetchCatalog(signal).then((d) => ({
      categories: d.categories.map(toCategory),
      satellites: d.satellites,
      modules: d.modules,
      channels: d.channels,
      languages: d.languages,
      mapLayers: layersOf(d),
    })),

  /**
   * The layer panel's list. There is no `/api/map-layers`: the list is `map_layers` inside
   * `GET /api/catalog`, so this reads the catalog. The user-drawn contour comes first.
   */
  mapLayers: (signal?: AbortSignal): Promise<MapLayer[]> => fetchCatalog(signal).then(layersOf),
};
