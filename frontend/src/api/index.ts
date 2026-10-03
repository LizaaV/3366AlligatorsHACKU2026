/**
 * The frontend's only door to the backend.
 *
 * Components and hooks import `api` from here and nothing else — never `./fixtures`, never
 * `fetch` directly. Each endpoint carries a `TODO(api)` comment naming the route it expects;
 * the shapes are documented for the backend team in `docs/data/README.md`.
 *
 * While `VITE_API_SOURCE=fixture` (the default), endpoints resolve from local stand-ins after
 * an artificial delay, so loading and error states are real today. Putting an endpoint live
 * means deleting its `fixture` property — no call site changes.
 */

import { areasApi } from './endpoints/areas';
import { knowledgeApi } from './endpoints/knowledge';
import { runsApi } from './endpoints/runs';
import { catalogApi } from './endpoints/catalog';
import { dashboardsApi } from './endpoints/dashboards';
import { sharesApi } from './endpoints/shares';
import { placesApi } from './endpoints/places';
import { skillsApi } from './endpoints/skills';
import { satellitesApi } from './endpoints/satellites';
import { watchesApi } from './endpoints/watches';
import { threadsApi } from './endpoints/threads';

export const api = {
  catalog: catalogApi,
  skills: skillsApi,
  places: placesApi,
  watches: watchesApi,
  dashboards: dashboardsApi,
  runs: runsApi,
  areas: areasApi,
  knowledge: knowledgeApi,
  shares: sharesApi,
  threads: threadsApi,
  satellites: satellitesApi,
};

export { ApiError, toApiError } from './http';
export { API_BASE, API_SOURCE, usingFixtures } from './config';
export type { RunRequest, ReplyRequest, RunRecord, BackendAnswer } from './endpoints/runs';
export type { AreaResolveRequest, AreaResolveResponse, Area, AreaMatch, PlaceContext } from './endpoints/areas';
export { DEFAULT_PIN_RADIUS_M } from './endpoints/areas';
export { isEvent } from './stream';
export type { StreamEvent, StreamEventName } from './stream';
export type { ShareCreated, ShareInfo } from './endpoints/shares';
export type { SkillQuery } from './endpoints/skills';
export type { Dashboard, DashboardBlock, DashboardSummary } from './endpoints/dashboards';
export type { ThreadSummary, ThreadDetail } from './endpoints/threads';
export type { SatelliteDto, SatellitePoint } from './endpoints/satellites';
