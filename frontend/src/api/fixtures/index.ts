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
import askAnswersJson from './ask-answers.json';
import feasibilityJson from './watch-feasibility.json';
import mapLayersJson from './map-layers.json';
import clarifyingJson from './clarifying-questions.json';
import timelineJson from './timeline.json';

import type {
  AnswerDto,
  AskRequest,
  CatalogDto,
  ClarifyingQuestionDto,
  CreatePlaceRequest,
  CreateWatchRequest,
  FeasibilityDto,
  FeasibilityRequest,
  MapLayerDto,
  PlaceDto,
  PlaceSearchResultDto,
  SkillDto,
  WatchDto,
} from '../types';
import { approxAreaHa, ringToPts } from '../../lib/geo';

/* ---------------- reference data (read-only) ---------------- */

export const catalog = () => catalogJson as unknown as CatalogDto;
export const skills = () => skillsJson as unknown as SkillDto[];
export const skillManifest = (id: string) => (skillManifestsJson as unknown as Record<string, unknown>)[id];
export const mapLayers = () => mapLayersJson as unknown as MapLayerDto[];
export const clarifyingQuestions = () => clarifyingJson as unknown as ClarifyingQuestionDto[];
export const placeSearch = (q: string) => {
  const s = q.trim().toLowerCase();
  const all = placeSearchJson as unknown as PlaceSearchResultDto[];
  return s ? all.filter((r) => `${r.name} ${r.description}`.toLowerCase().includes(s)) : all;
};

/* ---------------- mutable session state ---------------- */
// Writes live for the session only. A refresh resets them, which is the honest behaviour for a
// stand-in: real persistence comes with the real backend, not a localStorage patch here.

let placeState: PlaceDto[] = structuredClone(placesJson as unknown as PlaceDto[]);
let watchState: WatchDto[] = structuredClone(watchesJson as unknown as WatchDto[]);

const id = (prefix: string) => `${prefix}${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;

export const places = () => placeState;

export const createPlace = (req: CreatePlaceRequest): PlaceDto => {
  // Stands in for the backend computing area with PostGIS. The real value comes from the server.
  const pts = ringToPts(req.geometry.coordinates[0] ?? [], req.center);
  const place: PlaceDto = {
    ...req,
    id: id('p'),
    areaHa: approxAreaHa(pts, req.center.lat),
    createdAt: new Date().toISOString(),
    details: req.details ?? [],
  };
  placeState = [...placeState, place];
  return place;
};

export const deletePlace = (placeId: string) => {
  placeState = placeState.filter((p) => p.id !== placeId);
  // Mirrors the cascade a real backend would do: watches keep existing but lose their place.
  watchState = watchState.map((w) => (w.placeId === placeId ? { ...w, placeId: null } : w));
};

export const watches = () => watchState;

export const createWatch = (req: CreateWatchRequest): WatchDto => {
  const template = (watchesJson as unknown as WatchDto[])[0];
  const watch: WatchDto = {
    ...template,
    id: id('w'),
    name: req.name,
    categoryKey: req.categoryKey,
    placeId: req.placeId,
    skillId: req.skillId,
    question: req.question,
    condition: req.condition,
    channels: req.channels,
    cadence: req.cadence,
    metric: 'First result',
    value: 0,
    unit: '',
    ci: [0, 0],
    baseline: 0,
    delta: 'Waiting for the first pass',
    confidence: 'Medium',
    status: 'ok',
    enabled: true,
    series: { ...template.series, current: [...template.series.mean] },
    lastRunAt: null,
    nextRunAt: null,
    events: [],
  };
  watchState = [watch, ...watchState];
  return watch;
};

export const updateWatch = (watchId: string, patch: Partial<WatchDto>): WatchDto => {
  let updated: WatchDto | undefined;
  watchState = watchState.map((w) => (w.id === watchId ? (updated = { ...w, ...patch }) : w));
  if (!updated) throw new Error(`No watch ${watchId}`);
  return updated;
};

export const deleteWatch = (watchId: string) => {
  watchState = watchState.filter((w) => w.id !== watchId);
};

/* ---------------- agent outputs ---------------- */

const answers = askAnswersJson as unknown as Record<string, AnswerDto>;

/**
 * Picks which exemplar answer to return. This selection is fixture logic standing in for the
 * backend's real routing — it is why it lives here and not in a component.
 */
export const ask = (req: AskRequest): AnswerDto => {
  const q = req.question.toLowerCase();
  if (!req.placeId) {
    return /flood|rain|water|storm/.test(q) ? answers.generalFlood : answers.generalOptical;
  }
  if (req.skillId === 'dry-patch-finder' || /dry|water stress|irrigat|drought/.test(q)) {
    return answers.placeDryPatch;
  }
  return answers.placeSkillRun;
};

export const timeline = () => timelineJson as { dates: string[]; cloudyIndices: number[]; intensity: number[] };

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

export const PARCEL_SYSTEMS = [
  { id: 'br', name: 'Brazil · CAR', placeholder: 'RO-1100205-8F3A…', tier: 'free' as const, lat: -10.082, lon: -62.914, categoryKey: 'forests' },
  { id: 'eu', name: 'EU · INSPIRE cadastral parcel', placeholder: 'NL.IMKAD.KadastraalPerceel.…', tier: 'free' as const, lat: 51.982, lon: 4.418, categoryKey: 'agriculture' },
  { id: 'in', name: 'India · Survey number', placeholder: 'Anand / 214/2', tier: 'free' as const, lat: 22.552, lon: 72.968, categoryKey: 'agriculture' },
  { id: 'us', name: 'United States · APN (county)', placeholder: '055-123-04-0-00-00-001', tier: 'paid' as const, lat: 37.951, lon: -100.884, categoryKey: 'agriculture' },
  { id: 'ke', name: 'Kenya · LR number', placeholder: 'Nakuru/Block 4/112', tier: 'paid' as const, lat: -0.312, lon: 36.081, categoryKey: 'agriculture' },
];

export const WHATSAPP_PINS = [
  { id: 'wa1', from: 'You', when: '2 min ago', note: 'Lower shamba, near the borehole', lat: -0.3021, lon: 36.0712 },
  { id: 'wa2', from: 'Field team · Juma', when: 'Yesterday, 16:40', note: 'Maize block east of road', lat: 37.9903, lon: -100.9061 },
];

export const WHATSAPP_NUMBER = '+1 (555) 014-7788';
