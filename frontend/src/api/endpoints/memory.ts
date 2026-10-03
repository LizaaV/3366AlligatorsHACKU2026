/**
 * Private memory the agent is given on a run.
 *
 *   GET/PATCH /api/me/memory            -> what you told it about yourself (units, crops you grow)
 *   POST      /api/runs/{id}/insight    -> save one answer to a place's memory
 *
 * Place memory itself lives in `places.ts` (`memory` / `patchMemory`). A PATCH merges profile
 * keys: a new value adds or overwrites, and a blank value makes the server forget that key.
 */

import { request } from '../http';
import { usingFixtures } from '../config';
import type { components } from '../schema';

type S = components['schemas'];

export type MeMemory = S['MeMemory'];
export type InsightCreate = S['InsightCreate'];
export type InsightSaved = S['InsightSaved'];

let fixtureMe: Record<string, string> = { units: 'metric', crops: 'Maize, soybean' };

/** Same rule as the server: a blank value forgets the key. */
const mergeProfile = (base: Record<string, string>, patch: Record<string, string>) =>
  Object.fromEntries(Object.entries({ ...base, ...patch }).filter(([, v]) => v.trim() !== ''));

export const memoryApi = {
  /** GET /api/me/memory */
  getMe: (signal?: AbortSignal): Promise<MeMemory> =>
    request<MeMemory>({
      method: 'GET',
      path: '/me/memory',
      signal,
      ...(usingFixtures() ? { fixture: () => ({ profile: fixtureMe }) } : {}),
    }),

  /** PATCH /api/me/memory — merges keys; a blank value forgets that key. */
  patchMe: (profile: Record<string, string>, signal?: AbortSignal): Promise<MeMemory> =>
    request<MeMemory>({
      method: 'PATCH',
      path: '/me/memory',
      body: { profile },
      signal,
      ...(usingFixtures() ? { fixture: () => ({ profile: (fixtureMe = mergeProfile(fixtureMe, profile)) }) } : {}),
    }),

  /** POST /api/runs/{run_id}/insight — 201; 400 if the place is not one of the run's places. */
  saveInsight: (runId: string, body: InsightCreate, signal?: AbortSignal): Promise<InsightSaved> =>
    request<InsightSaved>({
      method: 'POST',
      path: `/runs/${encodeURIComponent(runId)}/insight`,
      body,
      signal,
      ...(usingFixtures() ? { fixture: () => ({ run_id: runId, place_id: body.place_id, saved: true }) } : {}),
    }),
};
