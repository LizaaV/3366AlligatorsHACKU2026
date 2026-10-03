/**
 * View models — the shapes components render — and the mappers from API DTOs to them.
 *
 * This boundary is the point of the whole API layer. The backend speaks GeoJSON in WGS84 and
 * ISO-8601 timestamps; the map draws in reference-zoom pixels and the UI shows "Sep 28, 18:04".
 * Converting once, here, means:
 *
 *   - components never parse a date string or project a coordinate
 *   - the backend is free to use proper types without the UI caring
 *   - when the real contract differs from our proposal, only the mappers change
 *
 * Rules enforced here:
 *   - `areaHa` always comes from the API for a saved place. Never recomputed. The provisional
 *     client-side figure (`approxAreaHa`) is only for shapes with no server identity yet.
 *   - Categories carry their resolved style, so no component indexes into a category array.
 */

import type { Pt } from './lib/geo';
import { fitZoom, ringToPts } from './lib/geo';
import { categoryStyle } from './data/presentation';
import type {
  AnswerDto,
  CategoryDto,
  CategoryKey,
  ChannelId,
  ClarifyingQuestionDto,
  ConfidenceLevel,
  DeliveryChannelDto,
  FeasibilityDto,
  LanguageDto,
  MapLayerDto,
  PlaceDto,
  PlaceSource,
  SatelliteDto,
  SkillDto,
  SkillModuleDto,
  Tier,
  WatchDto,
  WatchStatus,
} from './api/types';

/* ---------------- categories ---------------- */

export interface Category {
  key: CategoryKey;
  name: string;
  icon: string;
  uses: string;
  sats: string;
  /** Merged from `data/presentation.ts`, not from the API. */
  color: string;
  fg: string;
}

export const toCategory = (d: CategoryDto): Category => ({ ...d, ...categoryStyle(d.key) });

/* ---------------- catalog ---------------- */

export type Satellite = SatelliteDto;
export type SkillModule = SkillModuleDto;
export type DeliveryChannel = DeliveryChannelDto;
export type Language = LanguageDto;
export type ClarifyingQuestion = ClarifyingQuestionDto;
export type { ChannelId } from './api/types';

export interface MapLayer {
  id: string;
  name: string;
  source: string;
  color: string;
  isAgentMade: boolean;
  /** Switched on in the layer panel. */
  on: boolean;
  /** The agent has produced this layer, so it can be toggled. */
  ready: boolean;
}

export const toMapLayer = (d: MapLayerDto): MapLayer => ({
  ...d,
  // The user-drawn contour is available immediately; agent layers appear once a run produces them.
  on: !d.isAgentMade,
  ready: !d.isAgentMade,
});

export interface Catalog {
  categories: Category[];
  satellites: Satellite[];
  modules: SkillModule[];
  channels: DeliveryChannel[];
  languages: Language[];
}

/** Look up a category by key, with a usable fallback if the backend sends an unknown one. */
export const categoryOf = (categories: Category[], key: CategoryKey): Category =>
  categories.find((c) => c.key === key) ?? {
    key,
    name: key,
    icon: 'category',
    uses: '',
    sats: '',
    ...categoryStyle(key),
  };

/* ---------------- skills ---------------- */

export interface Skill {
  id: string;
  categoryKey: CategoryKey;
  name: string;
  sat: string;
  cost: string;
  tier: Tier;
  short: string;
  long: string;
  publisherName: string;
  official: boolean;
  verified: boolean;
  /** Where the card's reference thumbnail is taken from. */
  reference: { lat: number; lon: number } | null;
  res: string;
  revisit: string;
  runs: number;
  rating: number;
  version: string;
  updatedAt: Date | null;
  steps: string[];
  accuracy: string;
  limits: string[];
}

export const toSkill = (d: SkillDto): Skill => ({
  id: d.id,
  categoryKey: d.categoryKey,
  name: d.name,
  sat: d.sat,
  cost: d.cost,
  tier: d.tier,
  short: d.short,
  long: d.long,
  publisherName: d.publisher.name,
  official: d.publisher.official,
  verified: d.publisher.verified,
  reference: d.reference ?? null,
  res: d.res,
  revisit: d.revisit,
  runs: d.runs,
  rating: d.rating,
  version: d.version,
  updatedAt: parseIso(d.updatedAt),
  steps: d.steps,
  accuracy: d.accuracy,
  limits: d.limits,
});

/* ---------------- places ---------------- */

export interface Place {
  id: string;
  name: string;
  categoryKey: CategoryKey;
  lat: number;
  lon: number;
  /** Zoom to use when flying here. From the API, or derived from the outline's extent. */
  zoom: number;
  /** Outline as reference-zoom pixel offsets from the centre — for drawing only. */
  pts: Pt[];
  circle: boolean;
  /** Authoritative, from the API. Never recomputed client-side for a saved place. */
  areaHa: number;
  project: string;
  tags: string[];
  source: PlaceSource;
  createdAt: Date | null;
  details: { label: string; value: string }[];
}

export const toPlace = (d: PlaceDto): Place => {
  const pts = ringToPts(d.geometry.coordinates[0] ?? [], d.center);
  return {
    id: d.id,
    name: d.name,
    categoryKey: d.categoryKey,
    lat: d.center.lat,
    lon: d.center.lon,
    zoom: d.defaultZoom ?? fitZoom(pts, 600),
    pts,
    circle: d.isCircle,
    areaHa: d.areaHa,
    project: d.project,
    tags: d.tags,
    source: d.source,
    createdAt: parseIso(d.createdAt),
    details: d.details,
  };
};

/* ---------------- watches ---------------- */

export interface WatchEvent {
  at: Date | null;
  text: string;
  level: 'info' | 'warn' | 'alert';
}

export interface Watch {
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
  ci: [number, number];
  confidence: ConfidenceLevel;
  baselineLabel: string;
  baseline: number;
  delta: string;
  status: WatchStatus;
  enabled: boolean;
  series: { labels: string[]; current: number[]; bandLow: number[]; bandHigh: number[]; mean: number[] };
  channels: ChannelId[];
  cadence: string;
  tier: Tier;
  lastRunAt: Date | null;
  /** `null` = paused or not yet scheduled. Sorting uses this, not a parsed display string. */
  nextRunAt: Date | null;
  satellites: string;
  thumbnailZoom: number;
  ring: boolean;
  events: WatchEvent[];
}

export const toWatch = (d: WatchDto): Watch => ({
  id: d.id,
  name: d.name,
  categoryKey: d.categoryKey,
  placeId: d.placeId,
  skillId: d.skillId,
  question: d.question,
  condition: d.condition,
  metric: d.metric,
  value: d.value,
  unit: d.unit,
  ci: d.ci,
  confidence: d.confidence,
  baselineLabel: d.baselineLabel,
  baseline: d.baseline,
  delta: d.delta,
  status: d.status,
  enabled: d.enabled,
  series: d.series,
  channels: d.channels,
  cadence: d.cadence,
  tier: d.tier,
  lastRunAt: parseIso(d.lastRunAt),
  nextRunAt: parseIso(d.nextRunAt),
  satellites: d.satellites,
  thumbnailZoom: d.thumbnail?.zoom ?? 14,
  ring: d.ring,
  events: d.events.map((e) => ({ at: parseIso(e.at), text: e.text, level: e.level })),
});

/* ---------------- answers ---------------- */

/**
 * Answers need no mapping: the card resolves its accent colour from `categoryKey` through
 * `categoryOf()`, so the wire shape is already the view shape.
 */
export type Answer = AnswerDto;

export type Feasibility = FeasibilityDto;

/* ---------------- helpers ---------------- */

export function parseIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
