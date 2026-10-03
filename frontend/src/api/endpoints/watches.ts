/** Watches: standing questions the agent re-asks on each satellite pass. */

import { request } from '../http';
import * as fixtures from '../fixtures';
import type { CreateWatchRequest, FeasibilityRequest, FeasibilityWireDto, WatchPatch, WatchProofDto, WatchWireDto } from '../types';
import type { components } from '../schema';
import { toFeasibility, toWatch, type Feasibility, type Watch } from '../../model';

type S = components['schemas'];

/**
 * Wire bodies. The backend's request models forbid unknown fields (422), so these send exactly
 * what the contract lists and nothing the UI merely collected.
 */
const toCreateBody = (r: CreateWatchRequest): S['CreateWatchRequest'] => ({
  name: r.name,
  category_key: r.categoryKey,
  place_id: r.placeId,
  skill_id: r.skillId,
  question: r.question,
  condition: r.condition,
  channels: r.channels,
  cadence: r.cadence,
  recurrence: r.recurrence ?? 'recurring',
  dashboard_id: r.dashboardId ?? null,
});

/** Only the keys present are sent; `dashboard_id: null` is the one explicit null (unlinks). */
const toPatchBody = (p: WatchPatch): S['PatchWatchRequest'] => ({
  ...(p.enabled !== undefined && { enabled: p.enabled }),
  ...(p.name !== undefined && { name: p.name }),
  ...(p.condition !== undefined && { condition: p.condition }),
  ...(p.channels !== undefined && { channels: p.channels }),
  ...(p.cadence !== undefined && { cadence: p.cadence }),
  ...(p.recurrence !== undefined && { recurrence: p.recurrence }),
  ...(p.dashboardId !== undefined && { dashboard_id: p.dashboardId }),
});

export const watchesApi = {
  /** TODO(api): GET /api/watches */
  list: (signal?: AbortSignal): Promise<Watch[]> =>
    request<WatchWireDto[]>({ method: 'GET', path: '/watches', signal, fixture: fixtures.watches }).then((l) => l.map(toWatch)),

  /** TODO(api): POST /api/watches */
  create: (req: CreateWatchRequest, signal?: AbortSignal): Promise<Watch> => {
    const body = toCreateBody(req);
    return request<WatchWireDto>({
      method: 'POST',
      path: '/watches',
      body,
      signal,
      fixture: () => fixtures.createWatch(body),
    }).then(toWatch);
  },

  /** TODO(api): PATCH /api/watches/{id} — pause/resume, edit condition, change channels */
  update: (id: string, patch: WatchPatch, signal?: AbortSignal): Promise<Watch> => {
    const body = toPatchBody(patch);
    return request<WatchWireDto>({
      method: 'PATCH',
      path: `/watches/${encodeURIComponent(id)}`,
      body,
      signal,
      fixture: () => fixtures.updateWatch(id, body),
    }).then(toWatch);
  },

  /** TODO(api): DELETE /api/watches/{id} */
  remove: (id: string, signal?: AbortSignal): Promise<void> =>
    request<void>({
      method: 'DELETE',
      path: `/watches/${encodeURIComponent(id)}`,
      signal,
      fixture: () => fixtures.deleteWatch(id),
    }),

  /**
   * TODO(api): GET /api/watches/{id}/proof
   * The scenes behind the most recent run, including the ones that were rejected and why.
   */
  proof: (id: string, signal?: AbortSignal): Promise<WatchProofDto> =>
    request<WatchProofDto>({
      method: 'GET',
      path: `/watches/${encodeURIComponent(id)}/proof`,
      signal,
      fixture: () => fixtures.watchProof(id),
    }),

  /**
   * TODO(api): POST /api/watches/feasibility
   * "Can satellites actually watch this?", asked before a watch is created.
   *
   * This endpoint is expected to REFUSE some requests — counting cars, identifying people —
   * returning `ok: false` with an explanation and a legitimate alternative. That is a product
   * requirement, not a gap. See docs/data/watch-feasibility.example.json.
   */
  checkFeasibility: (req: FeasibilityRequest, signal?: AbortSignal): Promise<Feasibility> => {
    const body: S['FeasibilityRequest'] = { text: req.text, place_id: req.placeId ?? null };
    return request<FeasibilityWireDto>({
      method: 'POST',
      path: '/watches/feasibility',
      body,
      signal,
      fixture: () => fixtures.feasibility(body),
    }).then(toFeasibility);
  },
};
