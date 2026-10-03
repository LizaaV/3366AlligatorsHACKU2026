import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { PLACES, type Place } from '../data/places';
import { WATCHES, type Channel, type Watch } from '../data/watches';
import { SKILLS, type Skill } from '../data/catalog';
import { LANGS, translate } from '../data/i18n';

/* ---------- routing (hash based so every view has a shareable URL) ---------- */

export type Page = 'ask' | 'places' | 'watches' | 'library';
export interface Route { page: Page; id?: string; query: Record<string, string>; }

const parseHash = (): Route => {
  const h = window.location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const [page, id] = path.split('/');
  const query: Record<string, string> = {};
  new URLSearchParams(qs || '').forEach((v, k) => (query[k] = v));
  const p = (['ask', 'places', 'watches', 'library'] as Page[]).includes(page as Page) ? (page as Page) : 'ask';
  return { page: p, id: id ? decodeURIComponent(id) : undefined, query };
};

export const href = (page: Page, id?: string, query?: Record<string, string>) => {
  const qs = query ? new URLSearchParams(query).toString() : '';
  return `#/${page}${id ? '/' + encodeURIComponent(id) : ''}${qs ? '?' + qs : ''}`;
};

/* ---------- modals ---------- */

export type ExportTarget = { kind: 'answer' | 'watch' | 'place' | 'skill'; title: string; subtitle?: string };
export type Modal =
  | { kind: 'export'; target: ExportTarget }
  | { kind: 'expert'; context: string; placeId?: string | null }
  | { kind: 'connectors'; focus?: Channel }
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

export interface Toast { text: string; action?: string; fn?: () => void; icon?: string; }

interface Store {
  route: Route;
  go: (page: Page, id?: string, query?: Record<string, string>) => void;
  places: Place[];
  addPlace: (p: Place) => void;
  removePlace: (id: string) => void;
  watches: Watch[];
  addWatch: (w: Watch) => void;
  updateWatch: (id: string, patch: Partial<Watch>) => void;
  removeWatch: (id: string) => void;
  skills: Skill[];
  addSkill: (s: Skill) => void;
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

export function StoreProvider({ children }: { children: ReactNode }) {
  const [route, setRoute] = useState<Route>(parseHash);
  const [places, setPlaces] = useState<Place[]>(PLACES);
  const [watches, setWatches] = useState<Watch[]>(WATCHES);
  const [skills, setSkills] = useState<Skill[]>(SKILLS);
  const [installed, setInstalled] = useState<string[]>(['dry-patch-finder', 'weekly-crop-health', 'reservoir-level-tracker', 'deforestation-alerts', 'active-fire-map', 'algae-red-tide-alert']);
  const [askPlaceId, setAskPlaceId] = useState<string | null>('np');
  const [plan, setPlan] = useState<'free' | 'pro'>('free');
  const [lang, setLangState] = useState<string>(() => {
    try { return localStorage.getItem('gt.lang') || 'en'; } catch { return 'en'; }
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
  const tt = useRef<number>();

  useEffect(() => {
    const on = () => setRoute(parseHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  // A place in the URL (#/ask?place=np) selects it at the top of the chat.
  useEffect(() => {
    if (route.page === 'ask' && route.query.place !== undefined) {
      setAskPlaceId(route.query.place === 'none' ? null : route.query.place);
    }
  }, [route]);

  useEffect(() => {
    const l = LANGS.find((x) => x.code === lang);
    document.documentElement.lang = lang;
    document.documentElement.dir = l?.rtl && l.ui ? 'rtl' : 'ltr';
    try { localStorage.setItem('gt.lang', lang); } catch { /* storage unavailable */ }
  }, [lang]);

  const go = useCallback((page: Page, id?: string, query?: Record<string, string>) => {
    window.location.hash = href(page, id, query);
  }, []);

  const notify = useCallback((text: string, action?: string, fn?: () => void, icon?: string) => {
    window.clearTimeout(tt.current);
    setToast({ text, action, fn, icon });
    tt.current = window.setTimeout(() => setToast(null), 4200);
  }, []);

  const value = useMemo<Store>(() => {
    const uiLang = LANGS.find((x) => x.code === lang)?.ui ? lang : 'en';
    return {
      route, go,
      places,
      addPlace: (p) => setPlaces((s) => [...s, p]),
      removePlace: (id) => {
        setPlaces((s) => s.filter((p) => p.id !== id));
        setWatches((s) => s.map((w) => (w.placeId === id ? { ...w, placeId: null } : w)));
        setAskPlaceId((cur) => (cur === id ? null : cur));
      },
      watches,
      addWatch: (w) => setWatches((s) => [w, ...s]),
      updateWatch: (id, patch) => setWatches((s) => s.map((w) => (w.id === id ? { ...w, ...patch } : w))),
      removeWatch: (id) => setWatches((s) => s.filter((w) => w.id !== id)),
      skills,
      addSkill: (sk) => setSkills((s) => [sk, ...s]),
      installed,
      toggleInstall: (id) => setInstalled((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])),
      askPlaceId, setAskPlace: setAskPlaceId,
      plan, setPlan,
      lang, setLang: setLangState,
      t: (key) => translate(uiLang, key),
      connectors, setConnectors,
      modal, open: setModal, close: () => setModal(null),
      toast, notify, dismissToast: () => setToast(null),
    };
  }, [route, go, places, watches, skills, installed, askPlaceId, plan, lang, connectors, modal, toast, notify]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
};
