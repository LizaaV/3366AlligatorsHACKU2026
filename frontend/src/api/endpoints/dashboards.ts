/**
 * Dashboards: named boards of live blocks saved from runs.
 *
 * The routes are in the contract (`/api/dashboards`), so shapes come from `schema.d.ts`. They
 * are mapped to view models here, the same boundary `model.ts` draws for other resources.
 * Adding a block to a dashboard (POST .../blocks) is driven from an answer, not this page, so
 * it is deliberately not exposed here yet.
 *
 * Fixture-first: while `VITE_API_SOURCE=fixture` each call resolves from
 * `fixtures/dashboards.ts`. TODO(api): delete the `fx(...)` spreads below to go live; routes
 * and shapes already match the contract.
 */

import { request } from '../http';
import { usingFixtures } from '../config';
import * as fixtures from '../fixtures/dashboards';
import type { components } from '../schema';
import type { AnswerBlock } from '../../model';

type S = components['schemas'];

export interface DashboardSummary {
  id: string;
  name: string;
  createdAt: Date;
  blockCount: number;
}

export interface DashboardBlock {
  blockId: string;
  block: AnswerBlock;
  caption: string | null;
  refreshedAt: Date;
  /** The run this block was saved from. */
  source: { runId: string; runDate: string; blockTitle: string };
}

export interface Dashboard {
  id: string;
  name: string;
  createdAt: Date;
  blocks: DashboardBlock[];
}

const toSummary = (d: S['DashboardSummary']): DashboardSummary => ({
  id: d.id,
  name: d.name,
  createdAt: new Date(d.created_at),
  blockCount: d.block_count,
});

const toBlock = (b: S['DashboardBlockOut']): DashboardBlock => ({
  blockId: b.block_id,
  block: b.block as AnswerBlock,
  caption: b.caption ?? null,
  refreshedAt: new Date(b.refreshed_at),
  source: { runId: b.source.run_id, runDate: b.source.run_date, blockTitle: b.source.block_title },
});

const toDashboard = (d: S['DashboardOut']): Dashboard => ({
  id: d.id,
  name: d.name,
  createdAt: new Date(d.created_at),
  blocks: d.blocks.map(toBlock),
});

const enc = encodeURIComponent;
/** Spread into `request()` options only in fixture mode, so a live build never carries a stand-in. */
const fx = <T>(fn: () => T) => (usingFixtures() ? { fixture: fn } : {});

export const dashboardsApi = {
  /** GET /api/dashboards */
  list: (signal?: AbortSignal): Promise<DashboardSummary[]> =>
    request<S['DashboardSummary'][]>({ method: 'GET', path: '/dashboards', signal, ...fx(fixtures.dashboards) }).then((l) => l.map(toSummary)),

  /** GET /api/dashboards/{id} — the dashboard with its blocks. */
  get: (id: string, signal?: AbortSignal): Promise<Dashboard> =>
    request<S['DashboardOut']>({ method: 'GET', path: `/dashboards/${enc(id)}`, signal, ...fx(() => fixtures.dashboard(id)) }).then(toDashboard),

  /** POST /api/dashboards */
  create: (name: string, signal?: AbortSignal): Promise<Dashboard> =>
    request<S['DashboardOut']>({
      method: 'POST',
      path: '/dashboards',
      body: { name } satisfies S['DashboardCreate'],
      signal,
      ...fx(() => fixtures.createDashboard(name)),
    }).then(toDashboard),

  /** PATCH /api/dashboards/{id} — rename. */
  rename: (id: string, name: string, signal?: AbortSignal): Promise<Dashboard> =>
    request<S['DashboardOut']>({
      method: 'PATCH',
      path: `/dashboards/${enc(id)}`,
      body: { name } satisfies S['DashboardUpdate'],
      signal,
      ...fx(() => fixtures.renameDashboard(id, name)),
    }).then(toDashboard),

  /** DELETE /api/dashboards/{id} */
  remove: (id: string, signal?: AbortSignal): Promise<void> =>
    request<void>({ method: 'DELETE', path: `/dashboards/${enc(id)}`, signal, ...fx(() => fixtures.deleteDashboard(id)) }),

  /** Not its own contract route: blocks arrive with `GET /api/dashboards/{id}`. */
  blocks: (id: string, signal?: AbortSignal): Promise<DashboardBlock[]> => dashboardsApi.get(id, signal).then((d) => d.blocks),

  /**
   * POST /api/dashboards/{id}/blocks — save one block of a finished run (with its script, so it
   * can be refreshed later). 422 when the run has no script or the dashboard is full.
   */
  addBlock: (id: string, runId: string, blockId: string, signal?: AbortSignal): Promise<void> =>
    request<unknown>({
      method: 'POST',
      path: `/dashboards/${enc(id)}/blocks`,
      body: { run_id: runId, block_id: blockId } satisfies S['SaveBlockRequest'],
      signal,
      ...fx(() => undefined),
    }).then(() => undefined),

  /** DELETE /api/dashboards/{id}/blocks/{block_id} */
  removeBlock: (id: string, blockId: string, signal?: AbortSignal): Promise<void> =>
    request<void>({
      method: 'DELETE',
      path: `/dashboards/${enc(id)}/blocks/${enc(blockId)}`,
      signal,
      ...fx(() => fixtures.removeBlock(id, blockId)),
    }),

  /**
   * POST /api/dashboards/{id}/blocks/{block_id}/refresh — re-run the saved script.
   * Fails with 409 if already refreshing and 422 if the script no longer produces the block;
   * either way the old block is kept.
   */
  refreshBlock: (id: string, blockId: string, signal?: AbortSignal): Promise<DashboardBlock> =>
    request<S['DashboardBlockOut']>({
      method: 'POST',
      path: `/dashboards/${enc(id)}/blocks/${enc(blockId)}/refresh`,
      signal,
      ...fx(() => fixtures.refreshBlock(id, blockId)),
    }).then(toBlock),
};
