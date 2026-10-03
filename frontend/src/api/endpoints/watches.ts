/**
 * Watches ("triggers" in the UI): standing questions about a place (`docs/API.md` §13).
 *
 * The wire is snake_case; requests are mapped here and responses by `toWatch()` /
 * `toFeasibility()` / `toWatchProof()` in `model.ts`. Nothing runs watches on a schedule yet,
 * so a real watch arrives with `measured: false` (see `toWatch`).
 */

import { request } from '../http';
import * as fixtures from '../fixtures';
import type {
  CreateWatchRequest,
  FeasibilityDto,
  FeasibilityRequest,
  WatchDto,
  WatchProofDto,
  WatchProofWireDto,
} from '../types';
import type { components } from '../schema';
import { toFeasibility, toWatch, toWatchProof, type Feasibility, type Watch } from '../../model';

type S = components['schemas'];

/** Fields a watch can be changed through — `PATCH /api/watches/{id}` (same names on the wire). */
export type WatchPatch = Partial<Pick<WatchDto, 'enabled' | 'condition' | 'channels' | 'cadence' | 'name'>>;

const toCreateBody = (b: CreateWatchRequest): S['CreateWatchRequest'] => ({
  name: b.name,
  question: b.question,
  category_key: b.categoryKey,
  place_id: b.placeId,
  skill_id: b.skillId,
  condition: b.condition,
  channels: b.channels,
  cadence: b.cadence,
});

export const watchesApi = {
  /** GET /api/watches */
  list: (signal?: AbortSignal): Promise<Watch[]> =>
    request<WatchDto[]>({ method: 'GET', path: '/watches', signal, fixture: fixtures.watches }).then((l) => l.map(toWatch)),

  /** POST /api/watches */
  create: (body: CreateWatchRequest, signal?: AbortSignal): Promise<Watch> =>
    request<WatchDto>({
      method: 'POST',
      path: '/watches',
      body: toCreateBody(body),
      signal,
      fixture: () => fixtures.createWatch(toCreateBody(body)),
    }).then(toWatch),

  /** PATCH /api/watches/{id} — pause/resume, rename, edit condition, change channels or cadence. */
  update: (id: string, patch: WatchPatch, signal?: AbortSignal): Promise<Watch> =>
    request<WatchDto>({
      method: 'PATCH',
      path: `/watches/${encodeURIComponent(id)}`,
      body: patch satisfies S['PatchWatchRequest'],
      signal,
      fixture: () => fixtures.updateWatch(id, patch),
    }).then(toWatch),

  /** DELETE /api/watches/{id} */
  remove: (id: string, signal?: AbortSignal): Promise<void> =>
    request<void>({
      method: 'DELETE',
      path: `/watches/${encodeURIComponent(id)}`,
      signal,
      fixture: () => fixtures.deleteWatch(id),
    }),

  /** GET /api/watches/{id}/proof — the scenes behind the latest check, and why any were skipped. */
  proof: (id: string, signal?: AbortSignal): Promise<WatchProofDto> =>
    request<WatchProofWireDto>({
      method: 'GET',
      path: `/watches/${encodeURIComponent(id)}/proof`,
      signal,
      fixture: () => fixtures.watchProof(id),
    }).then(toWatchProof),

  /**
   * POST /api/watches/feasibility — "Can satellites actually watch this?", before saving.
   * Expected to REFUSE some requests (counting cars, identifying people) with `ok: false`,
   * an explanation and a legitimate alternative. That is a product requirement, not a gap.
   */
  checkFeasibility: (body: FeasibilityRequest, signal?: AbortSignal): Promise<Feasibility> =>
    request<FeasibilityDto>({
      method: 'POST',
      path: '/watches/feasibility',
      body: { text: body.text, place_id: body.placeId ?? null } satisfies S['FeasibilityRequest'],
      signal,
      fixture: () => fixtures.feasibility(body),
    }).then(toFeasibility),
};
