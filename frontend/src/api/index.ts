/**
 * The frontend's only door to the backend.
 *
 * Components and hooks import `api` from here and nothing else — never `./fixtures`, never
 * `fetch` directly. Each endpoint carries a `TODO(api)` comment naming the route it expects;
 * the shapes are documented for the backend team in `docs/data/README.md`.
 *
 * With `VITE_API_SOURCE=http` every call goes to the FastAPI backend and carries the browser's
 * `X-User-Id` (see `identity.ts`). With `fixture`, endpoints resolve from local stand-ins after
 * an artificial delay. Endpoints the backend does not have reject with kind `not_available`
 * in http mode without making a request.
 */

import { areasApi } from './endpoints/areas';
import { knowledgeApi } from './endpoints/knowledge';
import { runsApi } from './endpoints/runs';
import { catalogApi } from './endpoints/catalog';
import { exportsApi } from './endpoints/exports';
import { insightsApi } from './endpoints/insights';
import { placesApi } from './endpoints/places';
import { skillsApi } from './endpoints/skills';
import { watchesApi } from './endpoints/watches';
import { threadsApi } from './endpoints/threads';
import { sharesApi } from './endpoints/shares';
import { viewsApi } from './endpoints/views';
import { projectsApi } from './endpoints/projects';

export const api = {
  catalog: catalogApi,
  skills: skillsApi,
  places: placesApi,
  watches: watchesApi,
  runs: runsApi,
  areas: areasApi,
  knowledge: knowledgeApi,
  insights: insightsApi,
  exports: exportsApi,
  threads: threadsApi,
  shares: sharesApi,
  views: viewsApi,
  projects: projectsApi,
};

export { ApiError, toApiError } from './http';
export type { ApiErrorKind } from './http';
export { userId } from './identity';
export { streamErrorMessage } from './stream';
export { API_BASE, API_SOURCE, usingFixtures } from './config';
export type { RunRequest, ReplyRequest, RunRecord, BackendAnswer, ShareCreated, InsightSaved } from './endpoints/runs';
export type { ThreadSummary, ThreadDetail } from './endpoints/threads';
export type { SharedRun } from './endpoints/shares';
export type { ViewPass, ViewImage, ViewBand, ViewTarget, ViewPeriod } from './endpoints/views';
export type { WatchPatch } from './endpoints/watches';
export type { Project } from './endpoints/projects';
export type { AreaResolveRequest, AreaResolveResponse, Area, AreaMatch, PlaceContext } from './endpoints/areas';
export { DEFAULT_PIN_RADIUS_M } from './endpoints/areas';
export { isEvent } from './stream';
export type { StreamEvent, StreamEventName } from './stream';
export type { SkillQuery } from './endpoints/skills';
