/**
 * Stand-in chat projects, in the contract's own shape (`Project`). Used only while
 * `VITE_API_SOURCE=fixture`; against a live API none of this runs. Writes live for the session.
 */

import type { components } from '../schema';
import { ApiError } from '../http';

type Project = components['schemas']['Project'];

let seq = 0;
const store: Project[] = [];
/** thread id -> project id (fixture mode only). */
export const fixtureAssignments = new Map<string, string>();

export const projects = (): Project[] => store.map((p) => ({ ...p }));

export function createProject(name: string): Project {
  const now = new Date().toISOString();
  const p: Project = { id: `prj_fixture${++seq}`, name: name.trim(), created_at: now, updated_at: now };
  store.push(p);
  return { ...p };
}

export function renameProject(id: string, name: string): Project {
  const p = store.find((x) => x.id === id);
  if (!p) throw new ApiError('Project not found', 'http', 404);
  p.name = name.trim();
  p.updated_at = new Date().toISOString();
  return { ...p };
}

export function deleteProject(id: string): void {
  const i = store.findIndex((x) => x.id === id);
  if (i < 0) throw new ApiError('Project not found', 'http', 404);
  store.splice(i, 1);
  for (const [t, pid] of fixtureAssignments) if (pid === id) fixtureAssignments.delete(t);
}
