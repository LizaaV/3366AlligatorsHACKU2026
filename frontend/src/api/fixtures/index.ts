/**
 * Stand-in server. TEMPORARY — see README.md in this folder.
 *
 * Everything here is deleted endpoint by endpoint as the backend lands. Nothing outside
 * `../endpoints/` may import from this file.
 */

import catalogJson from './catalog.json';
import skillsJson from './skills.json';
import skillManifestsJson from './skill-manifests.json';
import placesJson from './places.json';
import placeSearchJson from './place-search-results.json';
import watchesJson from './watches.json';
import feasibilityJson from './watch-feasibility.json';
import mapLayersJson from './map-layers.json';

import type {
  CatalogDto,
  MapLayerDto,
  PlaceSearchResultDto,
  ProofSceneDto,
  SkillDto,
  WatchProofDto,
  WatchWireDto,
} from '../types';
import { approxAreaHa, outerRing, ringToPts } from '../../lib/geo';
import { ApiError } from '../http';
import type { components } from '../schema';

type S = components['schemas'];
type PlaceDto = S['PlaceDto'];
type CreatePlaceRequest = S['CreatePlaceRequest'];
type PlaceMemory = S['PlaceMemory'];
type MemoryPatch = S['MemoryPatch'];
type FeasibilityDto = S['FeasibilityDto'];
type FeasibilityRequest = S['FeasibilityRequest'];
type CreateWatchRequest = S['CreateWatchRequest'];
type PatchWatchRequest = S['PatchWatchRequest'];

/* ---------------- reference data (read-only) ---------------- */

export const catalog = () => catalogJson as unknown as CatalogDto;
export const skills = () => skillsJson as unknown as SkillDto[];
export const skillManifest = (id: string) => (skillManifestsJson as unknown as Record<string, unknown>)[id];
export const mapLayers = () => mapLayersJson as unknown as MapLayerDto[];
export const placeSearch = (q: string) => {
  const s = q.trim().toLowerCase();
  const all = placeSearchJson as unknown as PlaceSearchResultDto[];
  return s ? all.filter((r) => `${r.name} ${r.description}`.toLowerCase().includes(s)) : all;
};

/* ---------------- mutable session state ---------------- */
// Writes live for the session only. A refresh resets them, which is the honest behaviour for a
// stand-in: real persistence comes with the real backend, not a localStorage patch here.

let placeState: PlaceDto[] = structuredClone(placesJson as unknown as PlaceDto[]);
let watchState: WatchWireDto[] = structuredClone(watchesJson as unknown as WatchWireDto[]);

const id = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;

export const places = () => placeState;

export const place = (placeId: string): PlaceDto => {
  const found = placeState.find((p) => p.id === placeId);
  if (!found) throw new ApiError(`No place ${placeId}`, 'http', 404);
  return found;
};

export const createPlace = (req: CreatePlaceRequest): PlaceDto => {
  const center = req.center ?? { lat: 0, lon: 0 };
  // Stands in for the backend computing area with PostGIS. The real value comes from the server.
  const pts = ringToPts(outerRing(req.geometry) ?? [], center);
  const now = new Date().toISOString();
  const created: PlaceDto = {
    id: id('p'),
    name: req.name,
    category_key: req.category_key ?? 'agriculture',
    center,
    geometry: (req.geometry ?? { type: 'Polygon', coordinates: [[]] }) as PlaceDto['geometry'],
    area_ha: approxAreaHa(pts, center.lat),
    is_circle: req.is_circle ?? false,
    project: req.project ?? '',
    tags: req.tags ?? [],
    source: (req.source ?? 'drawn') as PlaceDto['source'],
    created_at: now,
    updated_at: now,
    details: req.details ?? [],
  };
  placeState = [...placeState, created];
  return created;
};

export const updatePlace = (placeId: string, patch: { name?: string; categoryKey?: string; project?: string; tags?: string[] }): PlaceDto => {
  let updated: PlaceDto | undefined;
  placeState = placeState.map((p) =>
    p.id === placeId
      ? (updated = {
          ...p,
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.categoryKey !== undefined ? { category_key: patch.categoryKey } : {}),
          ...(patch.project !== undefined ? { project: patch.project } : {}),
          ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
          updated_at: new Date().toISOString(),
        })
      : p,
  );
  if (!updated) throw new ApiError(`No place ${placeId}`, 'http', 404);
  return updated;
};

export const deletePlace = (placeId: string) => {
  placeState = placeState.filter((p) => p.id !== placeId);
  // Mirrors the cascade a real backend would do: watches keep existing but lose their place.
  watchState = watchState.map((w) => (w.place_id === placeId ? { ...w, place_id: null } : w));
};

/* ---------------- place memory ---------------- */

/**
 * What the agent remembers about a place.
 *
 * The profile is what a clarification card prefills from — it is why a question can arrive
 * already answered with a "From memory · 12 Sep" badge.
 */
let memoryState: Record<string, PlaceMemory> = {
  np: {
    place_id: 'np',
    title: 'North Pivot',
    // Each entry records *when* it was learned, which is what the clarification card's
    // "From memory · 12 Sep" badge shows.
    profile: {
      use: { value: 'Maize', saved: '2026-09-12' },
      irrigation: { value: 'Center pivot, 7 spans', saved: '2026-09-12' },
      soil: { value: 'Silt loam (SSURGO)', saved: '2026-04-02' },
    },
    insights: [],
    notes: [{ date: '2026-09-12', text: 'Replanted the north third after the June hail.' }],
  },
};

const today = () => new Date().toISOString().slice(0, 10);

export const placeMemory = (placeId: string): PlaceMemory =>
  memoryState[placeId] ?? { place_id: placeId, title: '', profile: {}, insights: [], notes: [] };

export const patchPlaceMemory = (placeId: string, patch: MemoryPatch): PlaceMemory => {
  const cur = placeMemory(placeId);
  const next: PlaceMemory = {
    ...cur,
    // A patch sends bare values; memory stores each with the date it was learned, so the
    // "From memory" badge can say when.
    profile: {
      ...cur.profile,
      ...Object.fromEntries(Object.entries(patch.profile ?? {}).map(([k, v]) => [k, { value: v, saved: today() }])),
    },
    notes: patch.note ? [...(cur.notes ?? []), { date: today(), text: patch.note }] : cur.notes,
  };
  memoryState = { ...memoryState, [placeId]: next };
  return next;
};

export const watches = () => watchState;

export const createWatch = (req: CreateWatchRequest): WatchWireDto => {
  const template = (watchesJson as unknown as WatchWireDto[])[0];
  const now = new Date().toISOString();
  const watch: WatchWireDto = {
    ...template,
    id: id('w'),
    name: req.name,
    category_key: req.category_key,
    place_id: req.place_id ?? null,
    skill_id: req.skill_id,
    question: req.question,
    condition: req.condition,
    channels: req.channels ?? [],
    cadence: req.cadence,
    recurrence: req.recurrence ?? 'recurring',
    dashboard_id: req.dashboard_id ?? null,
    // Like the real backend: no measurement exists until a run has produced one.
    metric: '',
    value: null,
    unit: '',
    ci: null,
    baseline: null,
    baseline_label: '',
    delta: '',
    status: null,
    enabled: true,
    series: { unit: '', labels: [], current: [], band_low: [], band_high: [], mean: [] },
    last_run_at: null,
    next_run_at: null,
    events: [],
    created_at: now,
    updated_at: now,
  };
  watchState = [watch, ...watchState];
  return watch;
};

export const updateWatch = (watchId: string, patch: PatchWatchRequest): WatchWireDto => {
  let updated: WatchWireDto | undefined;
  const defined = Object.fromEntries(Object.entries(patch).filter(([k, v]) => v !== null || k === 'dashboard_id'));
  watchState = watchState.map((w) => (w.id === watchId ? (updated = { ...w, ...defined, updated_at: new Date().toISOString() }) : w));
  if (!updated) throw new Error(`No watch ${watchId}`);
  return updated;
};

export const deleteWatch = (watchId: string) => {
  watchState = watchState.filter((w) => w.id !== watchId);
};

/* ---------------- agent outputs ---------------- */

/**
 * The answer stand-in moved to `fixtures/run.ts`, in the contract's own shape.
 *
 * The regex router that used to pick between four exemplar answers is gone with it: the real
 * `POST /api/runs` decides what to answer, and a fixture that guessed differently would only
 * teach the UI habits the backend does not share.
 */

const feasibilityCases = feasibilityJson as unknown as { match: string; response: FeasibilityDto }[];

/**
 * The prototype decided feasibility with a regex router. Kept here verbatim as the stand-in;
 * the real version should be rules over area size and the sensor catalogue
 * (see docs/data/watch-feasibility.example.json).
 */
export const feasibility = (req: FeasibilityRequest): FeasibilityDto => {
  const low = req.text.toLowerCase();
  const byPattern: [RegExp, string][] = [
    [/car|people|person|license|face|count.*(cow|cattle)|individual/, 'count the cars in the parking lot'],
    [/fire|smoke|burn/, 'is there a fire near my farm'],
    [/flood/, 'will my land flood'],
    [/forest|clear|deforest|tree/, 'has forest been cleared on this plot'],
    [/algae|bloom|chlorophyll/, 'is there an algae bloom near the intake'],
    [/small|garden|plot|backyard|tiny/, 'check my small backyard plot'],
  ];
  for (const [re, key] of byPattern) {
    if (re.test(low)) {
      const hit = feasibilityCases.find((c) => c.match === key);
      if (hit) return hit.response;
    }
  }
  return feasibilityCases[feasibilityCases.length - 1].response;
};

/**
 * Stand-in for GET /watches/{id}/proof. Scene identifiers are synthesised from the watch's
 * satellite in the real archive's naming conventions — plausible, but not real scenes. This is
 * exactly the kind of fabrication that should not live in a component, which is why it is here.
 */
export const watchProof = (watchId: string): WatchProofDto => {
  const w = watchState.find((x) => x.id === watchId);
  const sat = (w?.satellites ?? 'Sentinel-2').split(' \u00b7 ')[0];
  const dates = ['Sep 28', 'Sep 23', 'Sep 18', 'Sep 13', 'Sep 8'];
  const MON: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
  const sceneId = (date: string, i: number) => {
    const [m, d] = date.split(' ');
    const md = MON[m] + d.padStart(2, '0');
    if (/landsat/i.test(sat)) return `LC09_L2SP_031034_2026${md}_02_T1`;
    if (/sentinel-1/i.test(sat)) return `S1${i % 2 ? 'A' : 'C'}_IW_GRDH_1SDV_2026${md}T092114_0${54210 + i}_06A2F1`;
    if (/sentinel-3/i.test(sat)) return `S3${i % 2 ? 'A' : 'B'}_OL_2_WFR____2026${md}T160512_0180_LN1_O_NT_003`;
    if (/viirs|firms/i.test(sat)) return `VNP14IMG.A2026${(240 + 28 - i * 5).toString().padStart(3, '0')}.0954.002`;
    if (/swot/i.test(sat)) return `SWOT_L2_HR_Raster_100m_2026${md}T0812_PIC0_01`;
    return `S2${i % 2 ? 'A' : 'B'}_MSIL2A_2026${md}T172909_N0511_R055_T14SKG`;
  };
  const optical = !/sentinel-1|viirs|firms|swot/i.test(sat);
  const scenes: ProofSceneDto[] = dates.map((date, i) => {
    const why = optical && i === 2 ? 'Skipped \u2014 64% cloud over the area' : optical && i === 3 ? 'Skipped \u2014 18 mm rain the day before' : undefined;
    return { id: sceneId(date, i), date, sat, cloud: why ? 64 : i * 2, used: !why, why };
  });
  let h = 2166136261;
  for (const c of `${watchId}:${sat}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const hex = (n: number) => n.toString(16).padStart(8, '0');
  return { scenes, hash: `sha256:${hex(h)}${hex(Math.imul(h, 2654435761) >>> 0)}\u2026${hex(h ^ 0x9e3779b9).slice(0, 6)}` };
};

/* ---------------- place-authoring helpers ---------------- */

/**
 * Stands in for the backend's boundary detector. Deterministic from the coordinates so the
 * same spot always yields the same outline, and shaped like a field rather than a blob.
 */
export const detectBoundary = (lat: number, lon: number, w = 400, h = 300) => {
  let seed = Math.abs(Math.round(lat * 1000 + lon * 7919)) % 233280 || 1;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const n = 11;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const k = 1 / Math.pow(Math.pow(Math.abs(c), 4) + Math.pow(Math.abs(s), 4), 0.25);
    const j = 0.9 + rnd() * 0.16;
    return [+(((s * k * w) / 2) * j).toFixed(1), +(((-c * k * h) / 2) * j).toFixed(1)] as [number, number];
  });
  return pts;
};
