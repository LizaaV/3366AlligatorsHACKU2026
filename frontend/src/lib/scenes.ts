/**
 * Live satellite views of any spot, straight from public services (no run, no AI, no cost):
 * the latest clear Sentinel-2 pass from Earth Search, drawn as map tiles by titiler.
 *
 * Bands are the same plain-language measures the agent uses (greenness, water, bare ground),
 * computed per pixel by titiler from the scene's bands. They are for looking around; the
 * numbers in an answer always come from the backend.
 */

const STAC = 'https://earth-search.aws.element84.com/v1';
const TITILER = 'https://titiler.xyz';

export interface Scene {
  id: string;
  date: string;
  cloud: number;
  satellite: string;
}

export type Band = 'photo' | 'greenness' | 'water' | 'bare';

export const BANDS: { id: Band; label: string; hint: string }[] = [
  { id: 'photo', label: 'Photo', hint: 'True colour, as the satellite saw it' },
  { id: 'greenness', label: 'Greenness', hint: 'Living plants: red is bare, green is lush (NDVI)' },
  { id: 'water', label: 'Water', hint: 'Open water and wet ground in blue (NDWI)' },
  { id: 'bare', label: 'Bare ground', hint: 'Bare soil and built surfaces in orange (NDBI)' },
];

/** titiler query for each band: assets become b1, b2 in the expression. */
const QUERY: Record<Band, string> = {
  photo: 'assets=visual',
  greenness: 'assets=nir&assets=red&expression=(b1-b2)/(b1%2Bb2)&rescale=-0.1,0.8&colormap_name=rdylgn',
  water: 'assets=green&assets=nir&expression=(b1-b2)/(b1%2Bb2)&rescale=-0.5,0.4&colormap_name=blues',
  bare: 'assets=swir16&assets=nir&expression=(b1-b2)/(b1%2Bb2)&rescale=-0.5,0.25&colormap_name=oranges',
};

/** A `{z}/{x}/{y}` tile URL template for one band of one scene. */
export const bandTiles = (sceneId: string, band: Band): string => {
  const item = encodeURIComponent(`${STAC}/collections/sentinel-2-l2a/items/${sceneId}`);
  return `${TITILER}/stac/tiles/WebMercatorQuad/{z}/{x}/{y}.png?url=${item}&${QUERY[band]}`;
};

const SAT: Record<string, string> = { S2A: 'Sentinel-2A', S2B: 'Sentinel-2B', S2C: 'Sentinel-2C' };

/**
 * The most recent Sentinel-2 passes over a point with little cloud, newest first.
 * Searches the last `days` days; returns [] when nothing usable (or the service is down).
 */
export async function recentScenes(lat: number, lon: number, signal?: AbortSignal, days = 120, maxCloud = 30): Promise<Scene[]> {
  const d = 0.004;
  const to = new Date();
  const from = new Date(to.getTime() - days * 864e5);
  const body = {
    collections: ['sentinel-2-l2a'],
    bbox: [lon - d, lat - d, lon + d, lat + d],
    datetime: `${from.toISOString().slice(0, 19)}Z/${to.toISOString().slice(0, 19)}Z`,
    limit: 12,
    query: { 'eo:cloud_cover': { lt: maxCloud } },
    sortby: [{ field: 'properties.datetime', direction: 'desc' }],
    fields: { include: ['id', 'properties.datetime', 'properties.eo:cloud_cover'], exclude: ['assets', 'links', 'geometry'] },
  };
  const timeout = AbortSignal.timeout?.(10_000);
  const res = await fetch(`${STAC}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal && timeout && 'any' in AbortSignal ? AbortSignal.any([signal, timeout]) : signal ?? timeout,
  });
  if (!res.ok) return [];
  const json = (await res.json()) as { features: { id: string; properties: { datetime: string; 'eo:cloud_cover': number } }[] };
  const seen = new Set<string>();
  const out: Scene[] = [];
  for (const f of json.features) {
    const date = f.properties.datetime.slice(0, 10);
    if (seen.has(date)) continue; // one tile per pass is enough
    seen.add(date);
    out.push({ id: f.id, date, cloud: Math.round(f.properties['eo:cloud_cover']), satellite: SAT[f.id.slice(0, 3)] ?? 'Sentinel-2' });
  }
  return out;
}
