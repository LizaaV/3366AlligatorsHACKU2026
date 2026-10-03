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

/** Wire shape (snake_case) from the contract; `toSkill()` in `model.ts` maps it to the view model. */
export type SkillDto = components['schemas']['SkillDto'];
export type SkillStepDto = components['schemas']['SkillStep'];

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
  /** `sentinel2_segmentation` when grown from imagery, `fallback_square` when there was none. */
  method: 'sentinel2_segmentation' | 'fallback_square';
  /** One plain sentence about how the outline was made. */
  note: string;
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

/*
 * Wire shapes (snake_case) straight from the contract. `toWatch()` / `toFeasibility()` in
 * `model.ts` and the request mappers in `endpoints/watches.ts` own every rename, so components
 * never see a wire name.
 */
export type WatchWireDto = components['schemas']['WatchDto'];
export type WatchSeriesDto = components['schemas']['WatchSeries'];
export type WatchEventDto = components['schemas']['WatchEvent'];
export type WatchProofDto = components['schemas']['WatchProofDto'];
/** One scene behind a run: `id`, `sat`, `cloud` (percent), `used`, `why`. */
export type ProofSceneDto = components['schemas']['ProofScene'];
export type FeasibilityWireDto = components['schemas']['FeasibilityDto'];

/** What the trigger builder collects, in the frontend's vocabulary. Only fields the backend accepts. */
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

/** Fields `PATCH /api/watches/{id}` accepts. `dashboardId: null` unlinks the dashboard. */
export interface WatchPatch {
  enabled?: boolean;
  name?: string;
  condition?: string;
  channels?: ChannelId[];
  cadence?: string;
  recurrence?: WatchRecurrence;
  dashboardId?: string | null;
}

export interface FeasibilityRequest {
  text: string;
  placeId?: string | null;
}

/**
 * @deprecated Compatibility alias for `state/store.tsx`, which still does
 * `Pick<WatchDto, 'enabled' | ... | 'dashboardId'>` with camelCase names. This is the view
 * model, not the wire type (that is `WatchWireDto`). Switch the store to `WatchPatch`, then
 * delete this.
 */
export type WatchDto = import('../model').Watch;

/* ---------------- map layers ---------------- */

export interface MapLayerDto {
  id: string;
  name: string;
  source: string;
  color: string;
  /** Produced by the agent (as opposed to user-drawn), so it carries an "AI" badge. */
  isAgentMade: boolean;
}

