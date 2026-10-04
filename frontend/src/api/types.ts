/**
 * API types the frontend uses at the network boundary.
 *
 * Wire shapes (`*Dto`) come from the generated contract (`./schema.d.ts`, regenerated with
 * `npm run gen:api` from `contracts/openapi.json`) and are snake_case, exactly as the backend
 * sends them. The mappers in `../model.ts` turn them into camelCase view models, so no
 * component sees a wire name.
 *
 * What is still hand-written here:
 *   - request shapes in the frontend's own vocabulary (camelCase), which the endpoint modules
 *     map to snake_case before sending
 *   - helpers for endpoints the backend does not have (detect-boundary, parcel lookup, file
 *     parsing, "ask your watches", export), which throw `not_available` in http mode
 */

import type { Position } from '../lib/geo';
import type { components } from './schema';

type S = components['schemas'];

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

export type CategoryDto = S['CategoryDto'];
export type SatelliteDto = S['SatelliteDto'];
export type SkillModuleDto = S['SkillModuleDto'];
export type DeliveryChannelDto = S['DeliveryChannelDto'];
export type ChannelId = DeliveryChannelDto['id'];
export type LanguageDto = S['LanguageDto'];
export type MapLayerDto = S['MapLayerDto'];
/** `GET /api/catalog`. The map layer list lives here too (`map_layers`). */
export type CatalogDto = S['CatalogDto'];

/* ---------------- skills ---------------- */

export type SkillDto = S['SkillDto'];
export type SkillManifestDto = S['SkillManifest'];

/* ---------------- places ---------------- */

/**
 * `PlaceDto` and `CreatePlaceRequest` are no longer here: the contract owns both, and they are
 * re-exported from `endpoints/places.ts` where the snake_case→camelCase mapping lives.
 * What remains below is the add-place wizard's helpers, which the contract has no endpoint for.
 */

export type PlaceSource = 'drawn' | 'uploaded' | 'search' | 'coords' | 'whatsapp' | 'parcel' | 'pin';

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
export type WatchEventLevel = 'info' | 'warn' | 'alert';

export type WatchDto = S['WatchDto'];
export type WatchSeriesDto = S['WatchSeries'];
export type WatchEventDto = S['WatchEvent'];

/** What the watch builder produces. Mapped to `CreateWatchRequest` (snake_case) on send. */
export interface CreateWatchRequest {
  name: string;
  categoryKey: CategoryKey;
  placeId: string | null;
  skillId: string;
  question: string;
  condition: string;
  channels: ChannelId[];
  cadence: string;
}

/** `GET /api/watches/{id}/proof`, as sent. */
export type WatchProofWireDto = S['WatchProofDto'];

/** Scenes behind a watch's most recent run, plus the hash that makes it re-runnable (view shape). */
export interface WatchProofDto {
  scenes: ProofSceneDto[];
  hash: string;
}

/** One satellite pass behind a watch's result, in view vocabulary. Mapped from `ProofScene`. */
export interface ProofSceneDto {
  sceneId: string;
  date: string;
  satellite: string;
  cloudPct: number;
  used: boolean;
  /** Why it was rejected. Present when `used` is false. */
  why?: string;
}

export interface FeasibilityRequest {
  text: string;
  placeId?: string | null;
}

/** `POST /api/watches/feasibility`, as sent (snake_case). The view model is `model.Feasibility`. */
export type FeasibilityDto = S['FeasibilityDto'];

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

/* ---------------- export ---------------- */

export interface ExportRequest {
  targetKind: 'answer' | 'watch' | 'place' | 'skill';
  targetId?: string;
  title: string;
  format: 'link' | 'pdf' | 'data';
  lang: string;
}

export interface ExportResponse {
  url: string;
  expiresAt: Iso | null;
}
