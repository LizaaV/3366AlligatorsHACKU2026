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

import { askApi } from './endpoints/ask';
import { catalogApi } from './endpoints/catalog';
import { exportsApi } from './endpoints/exports';
import { insightsApi } from './endpoints/insights';
import { placesApi } from './endpoints/places';
import { skillsApi } from './endpoints/skills';
import { watchesApi } from './endpoints/watches';

export const api = {
  catalog: catalogApi,
  skills: skillsApi,
  places: placesApi,
  watches: watchesApi,
  ask: askApi,
  insights: insightsApi,
  exports: exportsApi,
};

export { ApiError, toApiError } from './http';
export { API_BASE, API_SOURCE, usingFixtures } from './config';
export type { AskResult } from './endpoints/ask';
export type { SkillQuery } from './endpoints/skills';
