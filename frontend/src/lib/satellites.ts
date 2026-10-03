/**
 * The satellites the agent reads from, and where they are right now.
 *
 * Positions are propagated in the browser from public orbital elements (TLEs) with SGP4, so
 * each dot on the globe is where that spacecraft actually is, to within a few kilometres.
 * Elements come from CelesTrak (CORS-enabled, no key) and are cached for a few hours, as
 * CelesTrak asks; when it cannot be reached the snapshot bundled in `tle-snapshot.json` is used,
 * which stays accurate enough for a picture for several weeks.
 */

import { eciToGeodetic, gstime, propagate, twoline2satrec, type SatRec } from 'satellite.js';
import snapshot from './tle-snapshot.json';

export type SatFamily = 'optical' | 'radar' | 'thermal' | 'atmosphere';

export interface Satellite {
  norad: string;
  name: string;
  family: SatFamily;
}

/** Colours per family, matching the globe mock-up: blue optical, purple radar, orange thermal, cyan atmosphere/fire. */
export const FAMILY_COLOR: Record<SatFamily, number> = {
  optical: 0x5b8cff,
  radar: 0xa77bff,
  thermal: 0xffa53d,
  atmosphere: 0x3fe0d0,
};

/** Every mission the backend reads from (see backend/app — Sentinel-1/2/3/5P, Landsat, VIIRS, MODIS). */
export const SATELLITES: Satellite[] = [
  { norad: '40697', name: 'Sentinel-2A', family: 'optical' },
  { norad: '42063', name: 'Sentinel-2B', family: 'optical' },
  { norad: '60989', name: 'Sentinel-2C', family: 'optical' },
  { norad: '39634', name: 'Sentinel-1A', family: 'radar' },
  { norad: '62261', name: 'Sentinel-1C', family: 'radar' },
  { norad: '66315', name: 'Sentinel-1D', family: 'radar' },
  { norad: '39084', name: 'Landsat 8', family: 'thermal' },
  { norad: '49260', name: 'Landsat 9', family: 'thermal' },
  { norad: '41335', name: 'Sentinel-3A', family: 'atmosphere' },
  { norad: '43437', name: 'Sentinel-3B', family: 'atmosphere' },
  { norad: '42969', name: 'Sentinel-5P', family: 'atmosphere' },
  { norad: '37849', name: 'Suomi NPP', family: 'atmosphere' },
  { norad: '43013', name: 'NOAA-20', family: 'atmosphere' },
  { norad: '54234', name: 'NOAA-21', family: 'atmosphere' },
  { norad: '25994', name: 'Terra', family: 'atmosphere' },
  { norad: '27424', name: 'Aqua', family: 'atmosphere' },
];

type TleMap = Record<string, [string, string]>;

/** Three requests cover all sixteen: Sentinel-1C/1D are in neither group yet. */
const SOURCES = [
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=resource&FORMAT=TLE',
  'https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=TLE',
  'https://celestrak.org/NORAD/elements/gp.php?NAME=SENTINEL-1&FORMAT=TLE',
];
const CACHE_KEY = 'gt.tles';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const parseTle = (text: string, want: Set<string>): TleMap => {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd());
  const out: TleMap = {};
  for (let i = 0; i < lines.length - 1; i++) {
    const l1 = lines[i], l2 = lines[i + 1];
    if (!l1.startsWith('1 ') || !l2.startsWith('2 ')) continue;
    const norad = l1.slice(2, 7).trim();
    if (want.has(norad)) out[norad] = [l1, l2];
  }
  return out;
};

const readCache = (): TleMap | null => {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null') as { at: number; tles: TleMap } | null;
    return c && Date.now() - c.at < CACHE_TTL_MS ? c.tles : null;
  } catch {
    return null;
  }
};

const writeCache = (tles: TleMap) => {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), tles }));
  } catch {
    /* storage full or blocked: the next load just refetches */
  }
};

/** Fresh elements where we can get them, the bundled snapshot for anything we cannot. */
export async function loadTles(signal?: AbortSignal): Promise<TleMap> {
  // JSON imports widen tuples to string[]; every entry in the snapshot is a TLE line pair.
  const fallback = snapshot.tles as unknown as TleMap;
  const cached = readCache();
  if (cached) return { ...fallback, ...cached };
  const want = new Set(SATELLITES.map((s) => s.norad));
  const results = await Promise.allSettled(SOURCES.map((u) => fetch(u, { signal }).then((r) => (r.ok ? r.text() : Promise.reject(r.status)))));
  const fresh: TleMap = {};
  for (const r of results) if (r.status === 'fulfilled') Object.assign(fresh, parseTle(r.value, want));
  if (Object.keys(fresh).length) writeCache(fresh);
  return { ...fallback, ...fresh };
}

export interface SubPoint {
  lat: number;
  lon: number;
  altKm: number;
}

export const toSatrec = (tle: [string, string]): SatRec => twoline2satrec(tle[0], tle[1]);

/** Geodetic position at `date`, or null if SGP4 cannot propagate this element set (decayed, bad TLE). */
export function subPoint(satrec: SatRec, date: Date): SubPoint | null {
  const pv = propagate(satrec, date);
  if (!pv || typeof pv.position !== 'object') return null;
  const g = eciToGeodetic(pv.position, gstime(date));
  return { lat: (g.latitude * 180) / Math.PI, lon: (g.longitude * 180) / Math.PI, altKm: g.height };
}

/** Orbital period in minutes (`no` is mean motion in radians per minute). */
export const periodMin = (satrec: SatRec) => (2 * Math.PI) / satrec.no;
