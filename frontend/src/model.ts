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
import { fitZoom, outerRing, ringToPts } from './lib/geo';
import { categoryStyle } from './data/presentation';
import type { BackendAnswer } from './api/endpoints/runs';
import type { Area as AreaDto, AreaResolveResponse as AreaResolveResponseDto } from './api/endpoints/areas';
import type { PlaceDto } from './api/endpoints/places';
import type {
  CategoryDto,
  CategoryKey,
  ChannelId,
  ConfidenceLevel,
  DeliveryChannelDto,
  FeasibilityDto,
  LanguageDto,
  MapLayerDto,
  PlaceSource,
  SatelliteDto,
  SkillDto,
  SkillModuleDto,
  Tier,
  WatchDto,
  WatchRecurrence,
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
  /** Last edit, from the contract. */
  updatedAt: Date | null;
  details: { label: string; value: string }[];
}

/**
 * Map the contract's `PlaceDto` onto the view model.
 *
 * Two things the contract does differently from the frontend's old proposal:
 *
 *   - it is snake_case (`area_ha`, `category_key`, `is_circle`), absorbed here so no component
 *     sees a wire name
 *   - it has **no `default_zoom`**. That was an editorial "fly to this place at z16" value; the
 *     zoom is now always derived by fitting the outline, which is what the fallback already did
 *     for places that omitted it. If an editorial zoom turns out to matter, it needs an `api`
 *     issue (§6) rather than a second client-side opinion.
 *
 * `geometry` arrives as an opaque object, so the ring is narrowed rather than indexed blindly.
 */
export const toPlace = (d: PlaceDto): Place => {
  const pts = ringToPts(outerRing(d.geometry) ?? [], d.center);
  return {
    id: d.id,
    name: d.name,
    categoryKey: d.category_key as CategoryKey,
    lat: d.center.lat,
    lon: d.center.lon,
    zoom: fitZoom(pts, 600),
    pts,
    circle: d.is_circle,
    // AUTHORITATIVE, from the server. Never recomputed for a saved place.
    areaHa: d.area_ha,
    project: d.project ?? '',
    tags: d.tags ?? [],
    source: d.source as PlaceSource,
    createdAt: parseIso(d.created_at),
    updatedAt: parseIso(d.updated_at),
    details: d.details ?? [],
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
  /** `once` triggers fire a single time, then stop. */
  recurrence: WatchRecurrence;
  /** TODO: drop the fallbacks once schema.d.ts carries these fields. */
  dashboardId: string | null;
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
  recurrence: d.recurrence ?? 'recurring',
  dashboardId: d.dashboardId ?? null,
});

/* ---------------- areas ---------------- */

/**
 * A candidate from `POST /api/areas/resolve`, flattened for the search lists.
 *
 * The contract answers with one resolved best `area` plus other `matches`, but the search UIs
 * want a single ranked list — so the two are flattened here. Only the best match carries an
 * outline; `AreaMatch` has just a name and a coordinate, so the rest get the default zoom.
 */
export interface AreaSearchHit {
  name: string;
  description: string;
  lat: number;
  lon: number;
  zoom: number;
  /** The resolved outline, when the server returned one for this candidate. */
  area: AreaDto | null;
}

const SOURCE_LABEL: Record<AreaResolveResponseDto['source'], string> = {
  point: 'Dropped pin',
  geojson: 'Drawn outline',
  coordinates: 'Coordinates',
  link: 'From a map link',
  search: 'Best match',
  preset: 'Example place',
};

/** Zoom for a candidate with no outline to fit. */
const MATCH_ZOOM = 14;

export function toSearchHits(res: AreaResolveResponseDto): AreaSearchHit[] {
  const ring = outerRing(res.area.geojson);
  const centre = ring && ring.length ? meanOf(ring) : null;

  const best: AreaSearchHit[] = centre
    ? [
        {
          name: res.area.name ?? 'Selected area',
          description: SOURCE_LABEL[res.source],
          lat: centre.lat,
          lon: centre.lon,
          // Reuse the same projection the rest of the app draws with, rather than a second
          // implementation of "how far out should the camera sit".
          zoom: ring ? fitZoom(ringToPts(ring, centre), 600) : MATCH_ZOOM,
          area: res.area,
        },
      ]
    : [];

  return [
    ...best,
    ...(res.matches ?? []).map((m) => ({
      name: m.name,
      description: 'Search result',
      lat: m.lat,
      lon: m.lon,
      zoom: MATCH_ZOOM,
      area: null,
    })),
  ];
}

const meanOf = (ring: [number, number][]) => {
  const sum = ring.reduce((a, [lon, lat]) => ({ lon: a.lon + lon, lat: a.lat + lat }), { lon: 0, lat: 0 });
  return { lon: sum.lon / ring.length, lat: sum.lat / ring.length };
};

/* ---------------- answers ---------------- */

/**
 * The answer, mapped from the contract's `Answer` (`contracts/openapi.json`).
 *
 * The wire shape is close to the view shape by design — `docs/API.md` §5 lists the intended
 * mapping — but not identical, so this is where the differences are absorbed:
 *
 *   - `l1`/`cause`/`l2`/`todo` become `findingLabel`/`finding`/`actionLabel`/`action`
 *   - `StatItem`'s terse `l`/`v` become `label`/`value`
 *   - `skill_id`/`suggested_skills` become `skillId`/`suggested`
 *   - the accent colour now arrives as `color`, so the card no longer resolves it from a
 *     category key (the backend has no notion of our category list)
 *
 * `finding` and `action` are nullable: a *measure-only* answer is one where no knowledge card
 * matched, so there is a measurement but no cause. The card shows "Cause unknown" rather than
 * inventing one.
 */
export interface AnswerStat {
  label: string;
  value: string;
  ci: string | null;
}

export type AnswerBlock = NonNullable<BackendAnswer['blocks']>[number];

export interface Answer {
  kind: 'place' | 'general';
  title: string;
  eyebrow: string;
  /** Accent colour, straight from the backend. */
  color: string | null;
  /** One-sentence answer, shown under the title. */
  sentence: string;
  findingLabel: string;
  /** `null` for a measure-only answer. */
  finding: string | null;
  actionLabel: string;
  action: string | null;
  stats: AnswerStat[];
  confidence: { level: ConfidenceLevel; pct: number; note: string };
  caveats: string[];
  route: NonNullable<BackendAnswer['route']>;
  proof: NonNullable<BackendAnswer['proof']>;
  /** The visuals, same objects that arrived as `block_ready` events. */
  blocks: AnswerBlock[];
  /** Up to three suggested next questions. */
  followups: string[];
  /** Knowledge cards and skill behind the answer, for the "Method" panel. */
  method: BackendAnswer['method'] | null;
  skillId: string | null;
  suggested: string[];
  /** No knowledge card matched: there is a measurement but no cause. */
  measureOnly: boolean;
  /** Served from stub/preset data — the UI shows a "demo data" tag. */
  preset: boolean;
  hash: string;
}

export const toAnswer = (d: BackendAnswer): Answer => ({
  kind: d.kind,
  title: d.title,
  eyebrow: d.eyebrow ?? '',
  color: d.color ?? null,
  sentence: d.sentence,
  findingLabel: d.l1,
  finding: d.cause ?? null,
  actionLabel: d.l2,
  action: d.todo ?? null,
  stats: (d.stats ?? []).map((s) => ({ label: s.l, value: s.v, ci: s.ci ?? null })),
  confidence: d.confidence,
  caveats: d.caveats ?? [],
  route: d.route ?? [],
  proof: d.proof ?? [],
  blocks: d.blocks ?? [],
  followups: d.followups ?? [],
  method: d.method ?? null,
  skillId: d.skill_id ?? null,
  suggested: d.suggested_skills ?? [],
  measureOnly: d.measure_only,
  preset: d.preset,
  hash: d.hash,
});

/**
 * Per-pass series for the map's date scrubber.
 *
 * The pre-contract proposal had the answer carry a `timeline` object directly. The contract
 * instead streams a `timeline` *block* whose points each name their scene, so this derives the
 * scrubber's three parallel arrays from the first such block.
 *
 * `clean_px` is the fraction of the area that was unobscured on that pass, so a pass is
 * treated as cloudy below half — that is the same judgement the old `cloudyIndices` encoded,
 * now taken from a real measurement rather than a fixture's say-so.
 */
export interface PassTimeline {
  dates: string[];
  cloudyIndices: number[];
  /** Per-pass 0..1, used to animate the overlays along the timeline. */
  intensity: number[];
  /**
   * Scene id per pass, parallel to `dates`.
   *
   * §6: "Each point carries its `scene`, so clicking a point can move the map's time cursor."
   * Keeping them here is what lets a timeline block address the cursor by scene rather than by
   * an index the block cannot know.
   */
  scenes: string[];
}

const CLEAN_ENOUGH = 0.5;

export function passTimelineFrom(blocks: AnswerBlock[]): PassTimeline | null {
  const block = blocks.find((b): b is Extract<AnswerBlock, { type: 'timeline' }> => b.type === 'timeline');
  if (!block || !block.data.length) return null;

  const values = block.data.map((p) => p.value);
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo;

  return {
    dates: block.data.map((p) => p.date),
    cloudyIndices: block.data.flatMap((p, i) => (p.clean_px < CLEAN_ENOUGH ? [i] : [])),
    // A flat series would divide by zero; show it as uniformly mid-intensity instead.
    intensity: block.data.map((p) => (span === 0 ? 0.5 : (p.value - lo) / span)),
    scenes: block.data.map((p) => p.scene),
  };
}

/**
 * Map layers an answer produced, so the layer panel can switch them on as the run completes.
 *
 * The pre-contract proposal had the answer carry `layerIds` directly. The contract instead
 * attaches a `layer_id` to each rendered `Image` inside a block, which is the better shape —
 * the id travels with the thing it draws — so this collects them.
 */
export function layerIdsFrom(blocks: AnswerBlock[]): string[] {
  const ids = new Set<string>();
  for (const b of blocks) {
    if (b.type === 'then_now') {
      ids.add(b.before.layer_id);
      ids.add(b.after.layer_id);
    }
  }
  return [...ids];
}

/** A step the backend actually ran, from `step_started` / `step_finished`. */
export interface RunStep {
  index: number;
  tool: string;
  title: string;
  desc: string;
  result: string | null;
  ms: number | null;
  error: string | null;
  /** False until the matching `step_finished` arrives. */
  done: boolean;
}

export type Feasibility = FeasibilityDto;

/* ---------------- helpers ---------------- */

export function parseIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
