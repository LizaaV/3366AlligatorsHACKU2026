/**
 * Stand-in dashboards, in the contract's own shapes (`DashboardSummary` / `DashboardOut`).
 *
 * TEMPORARY, like the rest of this folder: used only while `VITE_API_SOURCE=fixture`. The
 * backend routes already exist in `contracts/openapi.json`, so against a live API none of this
 * runs. Blocks are borrowed from the captured stub run so every renderer sees real shapes.
 *
 * Writes live for the session only; a refresh resets them.
 */

import type { components } from '../schema';
import { ApiError } from '../http';
import { FIXTURE_RUN_ANSWER } from './run';

type S = components['schemas'];
type Out = S['DashboardOut'];
type BlockOut = S['DashboardBlockOut'];

const answerBlocks = FIXTURE_RUN_ANSWER.blocks ?? [];
const pick = (type: string) => {
  const b = answerBlocks.find((x) => x.type === type);
  if (!b) throw new Error(`fixture run has no ${type} block`);
  return b;
};

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

const saved = (dashId: string, type: string, blockId: string, caption: string | null, age: number): BlockOut => {
  const block = pick(type);
  return {
    block_id: `${dashId}-${blockId}`,
    block,
    source: {
      run_id: 'run_fixture000001',
      run_date: daysAgo(age).slice(0, 10),
      params: {},
      block_id: block.id,
      block_type: block.type,
      block_title: block.title,
      title_index: 0,
    },
    refreshed_at: daysAgo(age),
    caption,
  };
};

let state: Out[] = [
  {
    id: 'db-np',
    user_id: 'demo',
    name: 'North Pivot overview',
    created_at: daysAgo(21),
    blocks: [
      saved('db-np', 'stat', 'stat', 'Headline number for the week', 2),
      saved('db-np', 'then_now', 'tn', null, 2),
      saved('db-np', 'timeline', 'tl', 'Pass-by-pass history', 5),
    ],
  },
  {
    id: 'db-lake',
    user_id: 'demo',
    name: 'Lake health',
    created_at: daysAgo(9),
    blocks: [saved('db-lake', 'highlight', 'hl', null, 1), saved('db-lake', 'limits', 'lim', null, 1)],
  },
  { id: 'db-empty', user_id: 'demo', name: 'Coastal erosion (empty)', created_at: daysAgo(1), blocks: [] },
];

const find = (id: string): Out => {
  const d = state.find((x) => x.id === id);
  if (!d) throw new ApiError(`No dashboard ${id}`, 'http', 404);
  return d;
};

export const dashboards = (): S['DashboardSummary'][] =>
  state.map((d) => ({ id: d.id, name: d.name, created_at: d.created_at, block_count: d.blocks.length }));

export const dashboard = (id: string): Out => find(id);

export const createDashboard = (name: string): Out => {
  const d: Out = { id: `db-${Date.now().toString(36)}`, user_id: 'demo', name, created_at: new Date().toISOString(), blocks: [] };
  state = [d, ...state];
  return d;
};

export const deleteDashboard = (id: string): void => {
  find(id);
  state = state.filter((d) => d.id !== id);
};

export const removeBlock = (id: string, blockId: string): void => {
  const d = find(id);
  state = state.map((x) => (x.id === id ? { ...d, blocks: d.blocks.filter((b) => b.block_id !== blockId) } : x));
};

export const refreshBlock = (id: string, blockId: string): BlockOut => {
  const d = find(id);
  const cur = d.blocks.find((b) => b.block_id === blockId);
  if (!cur) throw new ApiError(`No block ${blockId}`, 'http', 404);
  const next: BlockOut = { ...cur, refreshed_at: new Date().toISOString() };
  state = state.map((x) => (x.id === id ? { ...d, blocks: d.blocks.map((b) => (b.block_id === blockId ? next : b)) } : x));
  return next;
};
