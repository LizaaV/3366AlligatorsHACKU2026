/**
 * Chat projects: folders that group a user's conversations, stored on the server.
 *
 *   GET    /api/projects              -> Project[]
 *   POST   /api/projects {name}       -> Project (201); 422 for a bad name or at 50 projects
 *   PATCH  /api/projects/{id} {name}  -> Project
 *   DELETE /api/projects/{id}         -> 204; the project's chats are kept and become unfiled
 *
 * Which project a chat is in is `ThreadSummary.project_id`, changed with `api.threads.setProject`.
 * Fixtures run only in fixture mode (see `fx`).
 */

import { request } from '../http';
import { usingFixtures } from '../config';
import * as fixtures from '../fixtures/projects';
import type { components } from '../schema';

type S = components['schemas'];

export interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

const toProject = (p: S['Project']): Project => ({
  id: p.id,
  name: p.name,
  createdAt: p.created_at ?? '',
  updatedAt: p.updated_at ?? '',
});

const enc = encodeURIComponent;
/** Spread into `request()` options only in fixture mode, so a live build never carries a stand-in. */
const fx = <T>(fn: () => T) => (usingFixtures() ? { fixture: fn } : {});

export const projectsApi = {
  /** GET /api/projects, oldest first. */
  list: (signal?: AbortSignal): Promise<Project[]> =>
    request<S['Project'][]>({ method: 'GET', path: '/projects', signal, ...fx(fixtures.projects) }).then((l) => l.map(toProject)),

  /** POST /api/projects */
  create: (name: string, signal?: AbortSignal): Promise<Project> =>
    request<S['Project']>({
      method: 'POST',
      path: '/projects',
      body: { name } satisfies S['ProjectCreate'],
      signal,
      ...fx(() => fixtures.createProject(name)),
    }).then(toProject),

  /** PATCH /api/projects/{id} */
  rename: (id: string, name: string, signal?: AbortSignal): Promise<Project> =>
    request<S['Project']>({
      method: 'PATCH',
      path: `/projects/${enc(id)}`,
      body: { name } satisfies S['ProjectUpdate'],
      signal,
      ...fx(() => fixtures.renameProject(id, name)),
    }).then(toProject),

  /** DELETE /api/projects/{id} — its chats are kept and become unfiled. */
  remove: (id: string, signal?: AbortSignal): Promise<void> =>
    request<void>({ method: 'DELETE', path: `/projects/${enc(id)}`, signal, ...fx(() => fixtures.deleteProject(id)) }),
};
