/**
 * Knowledge cards: the written rules behind an answer.
 *
 *   GET /api/knowledge/index          every card — 11 events and 13 settings
 *   GET /api/knowledge/cards/{id}     one card, with its full Markdown body
 *   GET /api/knowledge/find?q=...     which cards a sentence mentions
 *
 * These are what makes an answer auditable. `Answer.method.cards` names the cards a run used
 * and pins each to a version and a status, so "why should I believe this" has a document
 * behind it rather than a label. `docs/API.md` §2.
 *
 * **No fixture, deliberately.** The cards are real documents maintained in
 * `backend/knowledge/`, and inventing their text here would be inventing the very thing the
 * reader opened the card to check. So with `VITE_API_SOURCE=fixture` these report
 * `not-implemented` rather than a misleading "something went wrong on the server" — the UI
 * then says "This is not connected to the backend yet", which is the truth.
 *
 * These are `async` so that `notImplemented`'s synchronous throw becomes a rejected promise —
 * a sync throw escapes a caller that only attaches `.catch`.
 */

import { notImplemented, request } from '../http';
import { usingFixtures } from '../config';
import type { components } from '../schema';

type S = components['schemas'];

export type CardIndexEntry = S['CardIndexEntry'];
export type CardDetail = S['CardDetail'];

export const knowledgeApi = {
  /** GET /api/knowledge/index */
  index: async (signal?: AbortSignal): Promise<CardIndexEntry[]> =>
    usingFixtures()
      ? notImplemented('Knowledge cards')
      : request<CardIndexEntry[]>({ method: 'GET', path: '/knowledge/index', signal }),

  /** GET /api/knowledge/cards/{card_id} */
  card: async (id: string, signal?: AbortSignal): Promise<CardDetail> =>
    usingFixtures()
      ? notImplemented('Knowledge cards')
      : request<CardDetail>({ method: 'GET', path: `/knowledge/cards/${encodeURIComponent(id)}`, signal }),

  /** GET /api/knowledge/find?q= — which cards a sentence mentions. */
  find: async (q: string, signal?: AbortSignal): Promise<CardIndexEntry[]> =>
    usingFixtures()
      ? notImplemented('Knowledge cards')
      : request<CardIndexEntry[]>({ method: 'GET', path: '/knowledge/find', query: { q }, signal }),
};
