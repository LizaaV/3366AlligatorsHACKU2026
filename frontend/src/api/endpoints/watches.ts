/** Watches: standing questions the agent re-asks on each satellite pass. */

import { request } from '../http';
import * as fixtures from '../fixtures';
import type { CreateWatchRequest, FeasibilityDto, FeasibilityRequest, WatchDto, WatchProofDto } from '../types';
import { toWatch, type Feasibility, type Watch } from '../../model';

export const watchesApi = {
  /** TODO(api): GET /api/watches */
  list: (signal?: AbortSignal): Promise<Watch[]> =>
    request<WatchDto[]>({ method: 'GET', path: '/watches', signal, fixture: fixtures.watches }).then((l) => l.map(toWatch)),

  /** TODO(api): POST /api/watches */
  create: (body: CreateWatchRequest, signal?: AbortSignal): Promise<Watch> =>
    request<WatchDto>({
      method: 'POST',
      path: '/watches',
      body,
      signal,
      fixture: () => fixtures.createWatch(body),
    }).then(toWatch),

  /** TODO(api): PATCH /api/watches/{id} — pause/resume, edit condition, change channels */
  update: (id: string, patch: Partial<Pick<WatchDto, 'enabled' | 'condition' | 'channels' | 'cadence' | 'name' | 'recurrence' | 'dashboardId'>>, signal?: AbortSignal): Promise<Watch> =>
    request<WatchDto>({
      method: 'PATCH',
      path: `/watches/${encodeURIComponent(id)}`,
      body: patch,
      signal,
      fixture: () => fixtures.updateWatch(id, patch),
    }).then(toWatch),

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
  checkFeasibility: (body: FeasibilityRequest, signal?: AbortSignal): Promise<Feasibility> =>
    request<FeasibilityDto>({
      method: 'POST',
      path: '/watches/feasibility',
      body,
      signal,
      fixture: () => fixtures.feasibility(body),
    }),
};
