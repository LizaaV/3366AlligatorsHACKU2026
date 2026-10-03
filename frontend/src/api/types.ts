/**
 * API contract types — the shapes the frontend expects from the backend.
 *
 * HAND-WRITTEN FOR NOW, and a *proposal*: the backend team is building the real endpoints,
 * and `docs/data/README.md` documents these shapes for them along with the preserved data.
 *
 * When `contracts/openapi.json` carries the real endpoints, replace this file with generated
 * types (`npx openapi-typescript ../contracts/openapi.json -o src/api/types.gen.ts`) and the
 * compiler will point at every place the real contract differs. Do not hand-edit
 * `contracts/openapi.json` — it is generated from the backend's Pydantic models.
 *
 * Naming convention: types here are wire shapes (DTOs). The view models the components
 * actually render live in `../model.ts`, with mappers between the two. That boundary is what
 * lets the backend return GeoJSON while the map keeps working in screen pixels.
 */

import type { Position } from '../lib/geo';
import type { components } from './schema';

/* ---------------- primitives ---------------- */

export type Tier = 'free' | 'paid';
export type ConfidenceLevel = 'High' | 'Medium' | 'Low';
/** Stable category identifier. Never an array index — see docs/data/README.md. */
export type CategoryKey = string;
/** ISO-8601 instant, e.g. `2026-09-28T18:04:00Z`. */
export type Iso = string;

export interface LatLon {
  lat: number;
  lon: number;
}

export interface GeoJsonPolygon {
  type: 'Polygon';
  /** Exterior ring first; each ring closed (first coordinate repeated last). WGS84, [lon, lat]. */
  coordinates: Position[][];
}

/* ---------------- catalog ---------------- */

export interface CategoryDto {
  key: CategoryKey;
  name: string;
  /** Material Symbols glyph name. */
  icon: string;
  uses: string;
  sats: string;
}

export interface SatelliteDto {
  id: string;
  name: string;
  res: string;
  revisit: string;
  tier: Tier;
  price?: string;
  kind: 'optical' | 'radar' | 'thermal' | 'atmos' | 'lights';
  note: string;
}

export interface SkillModuleDto {
  id: string;
  name: string;
  icon: string;
  desc: string;
  group: 'Input' | 'Data' | 'Analysis' | 'Output';
  params?: Record<string, string | number | boolean | string[]>;
}

export interface DeliveryChannelDto {
  id: ChannelId;
  name: string;
  icon: string;
  tier: Tier;
  note: string;
}

export type ChannelId = 'email' | 'whatsapp' | 'sms' | 'push' | 'slack';

export interface LanguageDto {
  code: string;
  name: string;
  english: string;
  region: string;
  /** Whether the *interface* is translated. Answer prose is expected in every language. */
  ui: boolean;
  rtl?: boolean;
}

export interface CatalogDto {
  categories: CategoryDto[];
  satellites: SatelliteDto[];
  modules: SkillModuleDto[];
  channels: DeliveryChannelDto[];
  languages: LanguageDto[];
}

/* ---------------- skills ---------------- */

export interface SkillDto {
  id: string;
  categoryKey: CategoryKey;
  name: string;
  /** Human-readable satellite list, e.g. `Sentinel-2 · Landsat 9 thermal`. */
  sat: string;
  cost: string;
  tier: Tier;
  short: string;
  long: string;
  publisher: { name: string; official: boolean; verified: boolean };
  /** Where to take the card's reference thumbnail from. Presentation hint; may be omitted. */
  reference?: LatLon;
  res: string;
  revisit: string;
  runs: number;
  rating: number;
  version: string;
  updatedAt: Iso;
  /** Ordered `SkillModuleDto.id` list. */
  steps: string[];
  accuracy: string;
  limits: string[];
}

/* ---------------- places ---------------- */

/**
 * `PlaceDto` and `CreatePlaceRequest` are no longer here: the contract owns both, and they are
 * re-exported from `endpoints/places.ts` where the snake_case→camelCase mapping lives.
 * What remains below is the add-place wizard's helpers, which the contract has no endpoint for.
 */

export type PlaceSource = 'drawn' | 'uploaded' | 'search' | 'coords' | 'whatsapp' | 'parcel' | 'pin';

export interface PlaceDto {
  id: string;
  name: string;
  categoryKey: CategoryKey;
  center: LatLon;
  geometry: GeoJsonPolygon;
  /**
   * AUTHORITATIVE area. The backend computes this (PostGIS) and it is the only value the UI
   * displays for a saved place — it appears in answers, watch thresholds and $/km² pricing,
   * so a second client-side calculation would make those disagree.
   */
  areaHa: number;
  /** Render the outline as a pivot circle rather than a polygon. */
  isCircle: boolean;
  /** Editorial zoom for "fly to this place". Omitted = frontend derives a fit. */
  defaultZoom?: number;
  project: string;
  tags: string[];
  source: PlaceSource;
  createdAt: Iso;
  details: { label: string; value: string }[];
}

export interface CreatePlaceRequest {
  name: string;
  categoryKey: CategoryKey;
  center: LatLon;
  geometry: GeoJsonPolygon;
  isCircle: boolean;
  project: string;
  tags: string[];
  source: PlaceSource;
  details?: { label: string; value: string }[];
}

export interface PlaceSearchResultDto {
  name: string;
  description: string;
  lat: number;
  lon: number;
  zoom: number;
}

export interface DetectBoundaryRequest extends LatLon {
  /** Rough hint at the expected size, so the detector knows what to look for. */
  expectedHa?: number;
}

export interface DetectBoundaryResponse {
  geometry: GeoJsonPolygon;
  areaHa: number;
  confidence: ConfidenceLevel;
}

export interface ParcelLookupRequest {
  /** Registry id from `parcelSystems`, e.g. `br`, `eu`, `in`. */
  system: string;
  parcelId: string;
}

export interface ParcelLookupResponse {
  geometry: GeoJsonPolygon;
  center: LatLon;
  areaHa: number;
  registryLabel: string;
  categoryKey?: CategoryKey;
}

export interface ParseBoundaryFileResponse {
  geometry: GeoJsonPolygon;
  center: LatLon;
  areaHa: number;
  /** Name derived from the file, offered as the default place name. */
  suggestedName: string;
  /** e.g. `Outline around 128 points` for a CSV of coordinates. */
  note: string;
}

/* ---------------- watches ---------------- */

export type WatchStatus = 'ok' | 'warn' | 'alert';
/** `once` triggers disable themselves after their first alert-level event. From the contract. */
export type WatchRecurrence = components['schemas']['CreateWatchRequest']['recurrence'];
export type WatchEventLevel = 'info' | 'warn' | 'alert';

export interface WatchSeriesDto {
  labels: string[];
  /**
   * KNOWN WART, inherited from the prototype: these are normalised 0..1 for chart drawing,
   * which loses the real measured values. Preferred shape is real values plus a unit, with the
   * chart normalising. Flagged in docs/data/README.md.
   */
  current: number[];
  bandLow: number[];
  bandHigh: number[];
  mean: number[];
}

export interface WatchEventDto {
  at: Iso;
  text: string;
  level: WatchEventLevel;
}

export interface WatchDto {
  id: string;
  name: string;
  categoryKey: CategoryKey;
  placeId: string | null;
  skillId: string;
  question: string;
  condition: string;
  metric: string;
  value: number;
  unit: string;
  /** 90% interval, [low, high]. Equal values mean an exact count. */
  ci: [number, number];
  confidence: ConfidenceLevel;
  baselineLabel: string;
  baseline: number;
  delta: string;
  status: WatchStatus;
  enabled: boolean;
  series: WatchSeriesDto;
  channels: ChannelId[];
  cadence: string;
  tier: Tier;
  lastRunAt: Iso | null;
  /** `null` = paused or not yet scheduled. */
  nextRunAt: Iso | null;
  satellites: string;
  thumbnail?: { zoom: number };
  ring: boolean;
  events: WatchEventDto[];
  recurrence: WatchRecurrence;
  /** The dashboard this trigger watches, if any. */
  dashboardId?: string | null;
}

export interface CreateWatchRequest {
  name: string;
  categoryKey: CategoryKey;
  placeId: string | null;
  skillId: string;
  question: string;
  condition: string;
  channels: ChannelId[];
  cadence: string;
  /** Defaults to `recurring` server-side. */
  recurrence?: WatchRecurrence;
  /** 404 if it is not the user's dashboard. */
  dashboardId?: string | null;
}

/** Scenes behind a watch's most recent run, plus the hash that makes it re-runnable. */
export interface WatchProofDto {
  scenes: ProofSceneDto[];
  hash: string;
}

export interface FeasibilityRequest {
  text: string;
  placeId?: string | null;
}

/** "Can satellites actually watch this?", asked before a watch is created. */
export interface FeasibilityDto {
  ok: boolean;
  /** Answerable, but only with a compromise (paid imagery, or lower confidence). */
  partial: boolean;
  title: string;
  skillId: string;
  categoryKey: CategoryKey;
  metric: string;
  condition: string;
  satellites: string;
  cadence: string;
  tier: Tier;
  cost: string;
  confidence: ConfidenceLevel;
  notes: string[];
  /** Offered when `ok` is false — something satellites *can* do instead. */
  alternative?: string;
}

/* ---------------- watch proof ---------------- */

/**
 * A satellite pass behind a *watch*'s result.
 *
 * The answer's own proof list now comes from the contract (`ProofScene`, which uses `id`,
 * `sat` and a 0..1 `cloud`). This stays for watches, whose endpoints are not in the contract
 * yet — `docs/API.md` §2 lists watches under "not built yet" (module A5).
 */
export interface ProofSceneDto {
  sceneId: string;
  date: string;
  satellite: string;
  cloudPct: number;
  used: boolean;
  /** Why it was rejected. Present when `used` is false. */
  why?: string;
}

/* ---------------- insights ("ask your watches") ---------------- */

export interface InsightRequest {
  question: string;
  /** `watches` asks across all of them; `watch` asks about one. */
  scope: 'watches' | 'watch';
  watchId?: string;
  lang: string;
}

export interface InsightDto {
  title: string;
  body: string;
  /** What the answer was derived from, shown as chips: "Compared the last 3 passes". */
  basis: string[];
}

/* ---------------- map layers ---------------- */

export interface MapLayerDto {
  id: string;
  name: string;
  source: string;
  color: string;
  /** Produced by the agent (as opposed to user-drawn), so it carries an "AI" badge. */
  isAgentMade: boolean;
}

