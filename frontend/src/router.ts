/**
 * Hash-based routing.
 *
 * Extracted from `state/store.tsx`, where routing and global state were tangled together in a
 * file COLLABORATION.md §5 lists as conflict-prone. Separating them means a routing change and
 * a state change no longer collide in the same diff.
 *
 * Deliberately hand-rolled: for four top-level pages with detail views this is ~40 lines against
 * a router dependency, and it already gives shareable URLs and a working back button. Revisit if
 * auth-gated routes appear or the screen count roughly doubles.
 */

import { useEffect, useState } from 'react';

export type Page = 'ask' | 'places' | 'triggers' | 'library';

export const PAGES: Page[] = ['ask', 'places', 'triggers', 'library'];

/** Old route names that still resolve, so links shared before a rename keep working. */
const ALIASES: Record<string, Page> = { watches: 'triggers' };

export interface Route {
  page: Page;
  /** Detail id, e.g. the watch or skill being viewed. */
  id?: string;
  query: Record<string, string>;
}

export const parseHash = (hash = window.location.hash): Route => {
  const h = hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const [name, id] = path.split('/');
  const page = ALIASES[name] ?? name;
  const query: Record<string, string> = {};
  new URLSearchParams(qs || '').forEach((v, k) => (query[k] = v));
  return {
    page: PAGES.includes(page as Page) ? (page as Page) : 'ask',
    id: id ? decodeURIComponent(id) : undefined,
    query,
  };
};

export const href = (page: Page, id?: string, query?: Record<string, string>) => {
  const qs = query ? new URLSearchParams(query).toString() : '';
  return `#/${page}${id ? '/' + encodeURIComponent(id) : ''}${qs ? '?' + qs : ''}`;
};

export const navigate = (page: Page, id?: string, query?: Record<string, string>) => {
  window.location.hash = href(page, id, query);
};

/** Replace the current URL without adding a history entry. */
export const replaceUrl = (page: Page, id?: string, query?: Record<string, string>) =>
  window.history.replaceState(null, '', href(page, id, query));

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash());
  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
