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

/* ---------------- ask ---------------- */

export type RouteStatus = 'chosen' | 'support' | 'skipped' | 'fallback';

export interface RouteOptionDto {
  satellite: string;
  status: RouteStatus;
  why: string;
}

export interface ProofSceneDto {
  sceneId: string;
  date: string;
  satellite: string;
  cloudPct: number;
  used: boolean;
  /** Why it was rejected. Present when `used` is false. */
  why?: string;
}

export interface AnswerStatDto {
  label: string;
  value: string;
  /** Confidence range for this number, e.g. `90% range 3.9–5.3`. */
  ci?: string;
}

export interface AnswerTimelineDto {
  dates: string[];
  cloudyIndices: number[];
  /** Per-pass 0..1 intensity, used to animate the overlays along the timeline. */
  intensity: number[];
}

export interface AnswerDto {
  kind: 'place' | 'general';
  categoryKey: CategoryKey;
  eyebrow: string;
  title: string;
  stats: AnswerStatDto[];
  confidence: { level: ConfidenceLevel; pct: number; note: string };
  findingLabel: string;
  finding: string;
  actionLabel: string;
  action: string;
  /** What could be wrong, in plain language. Never empty for a measured answer. */
  caveats: string[];
  /** Every source considered, including the rejected ones and why. */
  route: RouteOptionDto[];
  proof: ProofSceneDto[];
  hash: string;
  skillId: string;
  /** For general answers: skills that could answer this properly. */
  suggestedSkillIds?: string[];
  /** `MapLayerDto.id`s this answer produced, switched on as the run completes. */
  layerIds?: string[];
  timeline?: AnswerTimelineDto;
}

export interface AskRequest {
  question: string;
  placeId?: string | null;
  skillId?: string;
  /** Answers to the clarifying questions, keyed by `ClarifyingQuestionDto.key`. */
  context?: Record<string, string>;
  /** BCP-47-ish code from the catalog. Answer prose comes back in this language. */
  lang: string;
}

export interface AskResponse {
  runId: string;
  answer: AnswerDto;
}

/* ---------------- map layers / clarifying questions ---------------- */

export interface MapLayerDto {
  id: string;
  name: string;
  source: string;
  color: string;
  /** Produced by the agent (as opposed to user-drawn), so it carries an "AI" badge. */
  isAgentMade: boolean;
}

export interface ClarifyingQuestionDto {
  key: string;
  label: string;
  options: string[];
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
