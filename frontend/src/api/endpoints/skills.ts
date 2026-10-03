/** The skills library. */

import { request } from '../http';
import * as fixtures from '../fixtures';
import type { SkillDto } from '../types';
import { toSkill, type Skill } from '../../model';

export interface SkillQuery {
  categoryKey?: string;
  tier?: 'free' | 'paid';
  q?: string;
}

export interface CreateSkillRequest {
  name: string;
  categoryKey: string;
  short: string;
  tier: 'free' | 'paid';
  cost: string;
  visibility: 'private' | 'team' | 'public';
  /** Ordered module ids with their parameters — the skill manifest's `steps`. */
  steps: { module: string; params: Record<string, string | number | boolean | string[]> }[];
}

export const skillsApi = {
  /**
   * TODO(api): GET /api/skills?category=&tier=&q=
   * Filtering is done client-side against the fixture for now; once the endpoint exists the
   * query goes to the server and the local filter below can go.
   */
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
            (!query.categoryKey || sk.categoryKey === query.categoryKey) &&
            (!query.tier || sk.tier === query.tier) &&
            (!s || `${sk.name} ${sk.short} ${sk.publisher.name}`.toLowerCase().includes(s)),
        );
      },
    }).then((list) => list.map(toSkill)),

  /** TODO(api): GET /api/skills/{id} */
  get: (id: string, signal?: AbortSignal): Promise<Skill> =>
    request<SkillDto>({
      method: 'GET',
      path: `/skills/${encodeURIComponent(id)}`,
      signal,
      fixture: () => {
        const found = fixtures.skills().find((s) => s.id === id);
        if (!found) throw new Error(`No skill ${id}`);
        return found;
      },
    }).then(toSkill),

  /**
   * TODO(api): GET /api/skills/{id}/manifest
   * The versioned JSON manifest a skill is stored as — publisher, pricing, inputs, ordered
   * steps with params, outputs, accuracy. Built by the backend from the stored record, not
   * reassembled in the UI (the prototype's `skillManifest()` did the latter).
   */
  manifest: (id: string, signal?: AbortSignal): Promise<unknown> =>
    request<unknown>({
      method: 'GET',
      path: `/skills/${encodeURIComponent(id)}/manifest`,
      signal,
      fixture: () => {
        const m = fixtures.skillManifest(id);
        if (!m) throw new Error(`No manifest for ${id}`);
        return m;
      },
    }),

  /**
   * TODO(api): POST /api/skills
   * Publishing a skill writes to the registry. No fixture: a locally invented skill that
   * vanishes on refresh would be more confusing than a clear "not connected yet", and the
   * builder surfaces the error.
   */
  create: (body: CreateSkillRequest, signal?: AbortSignal): Promise<Skill> =>
    request<SkillDto>({ method: 'POST', path: '/skills', body, signal }).then(toSkill),
};
