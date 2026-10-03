/** The skills library. */

import { ApiError, request } from '../http';
import * as fixtures from '../fixtures';
import type { SkillDto, SkillManifestDto } from '../types';
import type { components } from '../schema';
import { toSkill, type Skill } from '../../model';

type S = components['schemas'];

export interface SkillQuery {
  categoryKey?: string;
  tier?: 'free' | 'paid';
  q?: string;
}

export interface CreateSkillRequest {
  name: string;
  categoryKey: string;
  short: string;
  long?: string;
  tier: 'free' | 'paid';
  cost: string;
  visibility: 'private' | 'team' | 'public';
  /** Ordered module ids with their parameters — the skill manifest's `steps`. */
  steps: { module: string; params: Record<string, string | number | boolean | string[]> }[];
}

export interface TestSkillRequest {
  placeId: string;
  steps: { module: string; params: Record<string, string | number | boolean | string[]> }[];
}

export interface TestSkillResponse {
  ok: boolean;
  /** e.g. "7 of 12 scenes usable". */
  summary: string;
  issues: string[];
}

export const skillsApi = {
  /** GET /api/skills?category=&tier=&q= — built-ins first, then the caller's drafts. */
  list: (query: SkillQuery = {}, signal?: AbortSignal): Promise<Skill[]> =>
    request<SkillDto[]>({
      method: 'GET',
      path: '/skills',
      query: { category: query.categoryKey, tier: query.tier, q: query.q },
      signal,
      fixture: () => {
        const s = query.q?.trim().toLowerCase();
        return fixtures.skills().filter(
          (sk) =>
            (!query.categoryKey || sk.category_key === query.categoryKey) &&
            (!query.tier || sk.tier === query.tier) &&
            (!s || `${sk.name} ${sk.short} ${sk.publisher.name}`.toLowerCase().includes(s)),
        );
      },
    }).then((list) => list.map(toSkill)),

  /** GET /api/skills/{id} */
  get: (id: string, signal?: AbortSignal): Promise<Skill> =>
    request<SkillDto>({
      method: 'GET',
      path: `/skills/${encodeURIComponent(id)}`,
      signal,
      fixture: () => {
        const found = fixtures.skills().find((s) => s.id === id);
        if (!found) throw new ApiError(`No skill ${id}`, 'http', 404);
        return found;
      },
    }).then(toSkill),

  /**
   * GET /api/skills/{id}/manifest
   * The versioned JSON manifest a skill is stored as — publisher, pricing, inputs, ordered
   * steps with params, outputs, accuracy, `code_ref`. Shown as JSON, so it stays snake_case.
   */
  manifest: (id: string, signal?: AbortSignal): Promise<SkillManifestDto> =>
    request<SkillManifestDto>({
      method: 'GET',
      path: `/skills/${encodeURIComponent(id)}/manifest`,
      signal,
      fixture: () => {
        const m = fixtures.skillManifest(id);
        if (!m) throw new ApiError(`No manifest for ${id}`, 'http', 404);
        return m;
      },
    }),

  /** POST /api/skills — save a draft from the skill builder (fixture mode: rejects, not_available). */
  create: (body: CreateSkillRequest, signal?: AbortSignal): Promise<Skill> =>
    request<SkillDto>({
      method: 'POST',
      path: '/skills',
      body: {
        name: body.name,
        category_key: body.categoryKey,
        short: body.short,
        long: body.long ?? '',
        tier: body.tier,
        cost: body.cost,
        visibility: body.visibility,
        steps: body.steps,
      } satisfies S['CreateSkillRequest'],
      signal,
      fixture: () => {
        throw new ApiError('Saving skills needs the backend', 'not_available');
      },
    }).then(toSkill),

  /**
   * POST /api/skills/test — dry-runs a draft against one place. The backend validates the body
   * and then always answers 501 (not built), which surfaces as kind `not-implemented`.
   */
  test: (body: TestSkillRequest, signal?: AbortSignal): Promise<TestSkillResponse> =>
    request<TestSkillResponse>({
      method: 'POST',
      path: '/skills/test',
      body: { place_id: body.placeId, steps: body.steps } satisfies S['SkillTestRequest'],
      signal,
      fixture: () => {
        throw new ApiError('Skill test runs are not built yet', 'not_available');
      },
    }),
};
