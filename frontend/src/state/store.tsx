/**
 * Global state: UI state the frontend owns, plus a thin cache of server data.
 *
 * Two halves, deliberately kept distinct:
 *
 *   - **UI state** — selected place, language, plan, connectors, open modal, toast. Frontend's
 *     own. This is what a context is good at.
 *   - **Server data** — catalog, skills, places, watches. Loaded through `api`, held here so
 *     the many components that need `places` do not each refetch it.
 *
 * The server-data half is a hand-rolled cache and is the first thing TanStack Query should
 * replace: it would bring request deduplication, background refetching, stale-while-revalidate
 * and invalidation-after-mutation, none of which this does. The shape here (`data`, `error`,
 * `isLoading`, `reload`) matches `useQuery`'s so that swap stays mechanical.
 *
 * Mutators call the API and then update local state from the *server's* response — never from
 * the optimistic local guess — so a saved place always shows the backend's `areaHa`.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, api, toApiError } from '../api';
import type { ChannelId, CreatePlaceRequest, CreateWatchRequest, WatchDto } from '../api/types';
import type { CreateSkillRequest } from '../api/endpoints/skills';
import {
  categoryOf,
  type Catalog,
  type Category,
  type DeliveryChannel,
  type MapLayer,
  type Place,
  type Skill,
  type SkillModule,
  type Watch,
} from '../model';
import { LANGS, translate } from '../data/i18n';
import { navigate, useRoute, type Page, type Route } from '../router';

/* ---------- modals ---------- */

export type ExportTarget = { kind: 'answer' | 'watch' | 'place' | 'skill'; title: string; subtitle?: string; id?: string };

export type Modal =
  | { kind: 'export'; target: ExportTarget }
  | { kind: 'expert'; context: string; placeId?: string | null }
  | { kind: 'connectors'; focus?: ChannelId }
  | { kind: 'app' }
  | { kind: 'addPlace' }
  | { kind: 'watchBuilder'; prefill?: string; placeId?: string | null; skillId?: string; fromAnswer?: boolean }
  | { kind: 'upgrade'; feature: string; price?: string }
  | { kind: 'lang' };

export interface Connectors {
  email: { connected: boolean; address: string };
  whatsapp: { connected: boolean; number: string };
  sms: { connected: boolean; number: string };
  push: { connected: boolean };
  slack: { connected: boolean };
}

export interface Toast {
  text: string;
  action?: string;
  fn?: () => void;
  icon?: string;
}

/** Load state per server-data collection, parallel to the data itself. */
export interface LoadState {
  catalog: boolean;
  skills: boolean;
  places: boolean;
  watches: boolean;
}

export interface LoadErrors {
  catalog?: ApiError;
  skills?: ApiError;
  places?: ApiError;
  watches?: ApiError;
}

interface Store {
  /* routing */
  route: Route;
  go: (page: Page, id?: string, query?: Record<string, string>) => void;

  /* server data — plain collections, with load state alongside in `loading` / `errors` */
  catalog: Catalog | null;
  categories: Category[];
  /** Resolve a category key to its name, icon and colour. */
  category: (key: string) => Category;
  skills: Skill[];
  places: Place[];
  watches: Watch[];
  mapLayers: MapLayer[];
  /** Shortcut for `catalog.modules` — the building blocks a skill is composed from. */
  modules: SkillModule[];
  /** Shortcut for `catalog.channels` — email / push / WhatsApp / SMS / Slack. */
  channels: DeliveryChannel[];
  loading: LoadState;
  errors: LoadErrors;
  reload: () => void;

  /* mutations */
  addPlace: (req: CreatePlaceRequest) => Promise<Place>;
  removePlace: (id: string) => Promise<void>;
  addSkill: (req: CreateSkillRequest) => Promise<Skill>;
  addWatch: (req: CreateWatchRequest) => Promise<Watch>;
  updateWatch: (id: string, patch: Partial<Pick<WatchDto, 'enabled' | 'condition' | 'channels' | 'cadence' | 'name'>>) => Promise<void>;
  removeWatch: (id: string) => Promise<void>;

  /* UI state */
  installed: string[];
  toggleInstall: (id: string) => void;
  askPlaceId: string | null;
  setAskPlace: (id: string | null) => void;
  plan: 'free' | 'pro';
  setPlan: (p: 'free' | 'pro') => void;
  lang: string;
  setLang: (c: string) => void;
  t: (key: string) => string;
  connectors: Connectors;
  setConnectors: (c: Connectors) => void;
  modal: Modal | null;
  open: (m: Modal) => void;
  close: () => void;
  toast: Toast | null;
  notify: (text: string, action?: string, fn?: () => void, icon?: string) => void;
  dismissToast: () => void;
}

const Ctx = createContext<Store | null>(null);

const EMPTY_CATALOG: Catalog = { categories: [], satellites: [], modules: [], channels: [], languages: [] };

export function StoreProvider({ children }: { children: ReactNode }) {
  const route = useRoute();

  /* ---------- server data ---------- */
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [skills, setSkills] = useState<Skill[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [watches, setWatches] = useState<Watch[]>([]);
  const [mapLayers, setMapLayers] = useState<MapLayer[]>([]);

  const [loading, setLoading] = useState<LoadState>({ catalog: true, skills: true, places: true, watches: true });
  const [errors, setErrors] = useState<LoadErrors>({});
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    let live = true;
    const done = (key: keyof LoadState) => () => live && setLoading((l) => ({ ...l, [key]: false }));
    const fail = (key: keyof LoadErrors) => (err: unknown) => {
      const e = toApiError(err);
      if (!live || e.kind === 'aborted') return;
      setErrors((x) => ({ ...x, [key]: e }));
    };

    setLoading({ catalog: true, skills: true, places: true, watches: true });
    setErrors({});

    api.catalog
      .get(ac.signal)
      .then((c) => live && setCatalog(c))
      .catch(fail('catalog'))
      .finally(done('catalog'));
    api.skills
      .list({}, ac.signal)
      .then((s) => live && setSkills(s))
      .catch(fail('skills'))
      .finally(done('skills'));
    api.places
      .list(ac.signal)
      .then((p) => live && setPlaces(p))
      .catch(fail('places'))
      .finally(done('places'));
    api.watches
      .list(ac.signal)
      .then((w) => live && setWatches(w))
      .catch(fail('watches'))
      .finally(done('watches'));

    // Small reference lists; a failure here degrades a panel, not the page.
    api.catalog
      .mapLayers(ac.signal)
      .then((l) => live && setMapLayers(l))
      .catch(() => undefined);

    return () => {
      live = false;
      ac.abort();
    };
  }, [nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  /* ---------- UI state ---------- */
  const [installed, setInstalled] = useState<string[]>([
    'dry-patch-finder',
    'weekly-crop-health',
    'reservoir-level-tracker',
    'deforestation-alerts',
    'active-fire-map',
    'algae-red-tide-alert',
  ]);
  const [askPlaceId, setAskPlaceId] = useState<string | null>(null);
  const [plan, setPlan] = useState<'free' | 'pro'>('free');
  const [lang, setLangState] = useState<string>(() => {
    try {
      return localStorage.getItem('gt.lang') || 'en';
    } catch {
      return 'en';
    }
  });
  const [connectors, setConnectors] = useState<Connectors>({
    email: { connected: true, address: 'you@farm.example' },
    whatsapp: { connected: false, number: '' },
    sms: { connected: false, number: '' },
    push: { connected: false },
    slack: { connected: false },
  });
  const [modal, setModal] = useState<Modal | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  /** Default the Ask page to the first place once places arrive, unless the URL named one. */
  const seededPlace = useRef(false);
  useEffect(() => {
    if (seededPlace.current || !places.length) return;
    seededPlace.current = true;
    if (route.query.place === undefined) setAskPlaceId(places[0].id);
  }, [places, route.query.place]);

  useEffect(() => {
    if (route.page === 'ask' && route.query.place !== undefined) {
      seededPlace.current = true;
      setAskPlaceId(route.query.place === 'none' ? null : route.query.place);
    }
  }, [route]);

  useEffect(() => {
    const l = LANGS.find((x) => x.code === lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = l?.rtl && l.ui ? 'rtl' : 'ltr';
    try {
      localStorage.setItem('gt.lang', lang);
    } catch {
      /* storage unavailable (private window, blocked site data) */
    }
  }, [lang]);

  const go = useCallback((page: Page, id?: string, query?: Record<string, string>) => navigate(page, id, query), []);

  const notify = useCallback((text: string, action?: string, fn?: () => void, icon?: string) => {
    window.clearTimeout(toastTimer.current);
    setToast({ text, action, fn, icon });
    toastTimer.current = window.setTimeout(() => setToast(null), 4200);
  }, []);

  /* ---------- mutations ---------- */

  /** Snapshot for optimistic rollback, read inside callbacks without re-creating them. */
  const watchesRef = useRef<Watch[]>([]);
  watchesRef.current = watches;

  const addPlace = useCallback(async (req: CreatePlaceRequest) => {
    const created = await api.places.create(req);
    setPlaces((all) => [...all, created]);
    return created;
  }, []);

  const removePlace = useCallback(async (id: string) => {
    await api.places.remove(id);
    setPlaces((all) => all.filter((p) => p.id !== id));
    // The backend cascades; mirror it locally so the UI does not show a dangling reference.
    setWatches((all) => all.map((w) => (w.placeId === id ? { ...w, placeId: null } : w)));
    setAskPlaceId((cur) => (cur === id ? null : cur));
  }, []);

  const addSkill = useCallback(async (req: CreateSkillRequest) => {
    const created = await api.skills.create(req);
    setSkills((all) => [created, ...all]);
    return created;
  }, []);

  const addWatch = useCallback(async (req: CreateWatchRequest) => {
    const created = await api.watches.create(req);
    setWatches((all) => [created, ...all]);
    return created;
  }, []);

  const updateWatch = useCallback<Store['updateWatch']>(async (id, patch) => {
    // Optimistic: the toggle should feel instant. Reverts if the request fails.
    const before = watchesRef.current;
    setWatches((all) => all.map((w) => (w.id === id ? { ...w, ...patch } : w)));
    try {
      const updated = await api.watches.update(id, patch);
      setWatches((all) => all.map((w) => (w.id === id ? updated : w)));
    } catch (err) {
      setWatches(before);
      throw toApiError(err);
    }
  }, []);

  const removeWatch = useCallback(async (id: string) => {
    await api.watches.remove(id);
    setWatches((all) => all.filter((w) => w.id !== id));
  }, []);

  const categories = catalog?.categories ?? EMPTY_CATALOG.categories;
  const category = useCallback((key: string) => categoryOf(categories, key), [categories]);

  const value = useMemo<Store>(
    () => ({
      route,
      go,

      catalog,
      categories,
      category,
      skills,
      places,
      watches,
      mapLayers,
      modules: catalog?.modules ?? [],
      channels: catalog?.channels ?? [],
      loading,
      errors,
      reload,

      addPlace,
      removePlace,
      addSkill,
      addWatch,
      updateWatch,
      removeWatch,

      installed,
      toggleInstall: (id) => setInstalled((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])),
      askPlaceId,
      setAskPlace: setAskPlaceId,
      plan,
      setPlan,
      lang,
      setLang: setLangState,
      t: (key) => translate(LANGS.find((x) => x.code === lang)?.ui ? lang : 'en', key),
      connectors,
      setConnectors,
      modal,
      open: setModal,
      close: () => setModal(null),
      toast,
      notify,
      dismissToast: () => setToast(null),
    }),
    [
      route,
      go,
      catalog,
      categories,
      category,
      skills,
      places,
      watches,
      mapLayers,
      loading,
      errors,
      reload,
      addPlace,
      removePlace,
      addSkill,
      addWatch,
      updateWatch,
      removeWatch,
      installed,
      askPlaceId,
      plan,
      lang,
      connectors,
      modal,
      toast,
      notify,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
};

/** Convenience: the place currently selected on the Ask page. */
export const useSelectedPlace = (): Place | null => {
  const { places, askPlaceId } = useStore();
  return places.find((p) => p.id === askPlaceId) ?? null;
};

export type { Page, Route } from '../router';
export { href } from '../router';
