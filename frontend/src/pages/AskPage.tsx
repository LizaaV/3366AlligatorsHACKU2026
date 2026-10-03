import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
// three.js is ~600 kB and only the landing globe needs it, so it is split out of the main
// bundle and loaded when the globe first renders.
const Globe = lazy(() => import('../components/Globe').then((m) => ({ default: m.Globe })));
import { MapView } from '../components/MapView';
import { Btn, CatPill, IconBtn, Ms, hideBroken } from '../components/ui';
import { ErrorState } from '../components/async';
import { api, toApiError } from '../api';
import { useResource } from '../hooks/useResource';
import type { MapImage, MapLayer, Place } from '../model';
import { mapImagesFrom, toSearchHits } from '../model';
import { sourceLabel } from '../data/presentation';
import { DEFAULT_CENTER, DEFAULT_ZOOM, circleRing, distanceM, parseLocation, thumb } from '../lib/geo';
import { useAskRun, type AskTurn } from '../ask/useAskRun';
import { AnswerCard } from './AnswerCard';
import { stagesFrom } from '../ask/stages';
import { landCoverLine, suggestionsFor } from '../ask/suggest';
import { AnswerBlocks } from '../components/blocks';
import { Splash } from '../components/Splash';
import { BANDS, type Band } from '../lib/scenes';
import type { PlaceContext, ViewImage, ViewPass, ViewTarget } from '../api';

/** An icon for what a search hit is. */
const kindIcon = (kind: string | null) =>
  !kind ? 'location_on'
  : /park|garden|forest|wood|nature/.test(kind) ? 'park'
  : /water|lake|river|reservoir|pond|bay|sea/.test(kind) ? 'water'
  : /city|town|village|administrative|suburb|quarter|county|state|region/.test(kind) ? 'location_city'
  : /farm|field|meadow/.test(kind) ? 'agriculture'
  : 'location_on';

/** What a drawn outline is, and the catalog category it is filed under. */
// "Not sure" adds no tag, so suggestions come from the land cover measured there.
const DRAFT_KINDS = { 'Not sure': 'society', Field: 'agriculture', Pond: 'water', Plot: 'agriculture', 'Building site': 'urban', Forest: 'forests' } as const;
type DraftKind = keyof typeof DRAFT_KINDS;

/** Radius of the circle a question about a dropped pin covers. */
const SPOT_RADIUS_M = 350;

function useViewport() {
  const [v, setV] = useState({ W: window.innerWidth, H: window.innerHeight });
  useEffect(() => {
    const on = () => setV({ W: window.innerWidth, H: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return v;
}

export function AskPage({ active }: { active: boolean }) {
  const store = useStore();
  const { places, skills, askPlaceId, setAskPlace, route, go, open, notify, t, lang, watches, addPlace, mapLayers: catalogLayers, splash, setSplash } = store;
  const { W, H: winH } = useViewport();
  const mobile = W <= 760;
  // The opening screen takes the whole window: no nav bar, no tab bar.
  const navH = splash ? 0 : W <= 760 ? 52 : 56;
  const H = winH - navH - (mobile && !splash ? 64 : 0);
  const compact = W < 1280;
  const chatW = mobile ? W - 32 : compact ? 360 : 420;

  const place = places.find((p) => p.id === askPlaceId) || null;

  const [mode, setMode] = useState<'globe' | 'map'>('globe');
  const [center, setCenter] = useState({ lat: place?.lat ?? DEFAULT_CENTER.lat, lon: place?.lon ?? DEFAULT_CENTER.lon });
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [layers, setLayers] = useState<MapLayer[]>([]);
  const [q, setQ] = useState('');
  const [pop, setPop] = useState<string | null>(null);
  const [searchQ, setSearchQ] = useState('');
  const [drawing, setDrawing] = useState(false);
  // Corners of an outline being drawn, on the live map (pan and zoom keep working).
  const [draft, setDraft] = useState<{ lat: number; lon: number }[]>([]);
  const [draftName, setDraftName] = useState('');
  const [draftKind, setDraftKind] = useState<DraftKind>('Not sure');
  // Drawing a circle instead: click the centre, move to size it, click again to fix it (or
  // pick or type a radius).
  const [drawShape, setDrawShape] = useState<'polygon' | 'circle'>('polygon');
  const [circ, setCirc] = useState<{ center: { lat: number; lon: number } | null; radiusM: number; sizing: boolean }>({ center: null, radiusM: 250, sizing: false });
  // Set just before selecting a place made on the map: keep the current view, don't fly into it.
  const skipFly = useRef(false);
  const [pass, setPass] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [cat, setCat] = useState(0);
  const [placeOpen, setPlaceOpen] = useState(!mobile);
  const thread = useRef<HTMLDivElement>(null);

  /* ---------------- a picked spot: look around before asking ---------------- */

  // A pin dropped from the globe or the map. Questions about it send the circle as `area`,
  // so nothing has to be saved first.
  const [spot, setSpot] = useState<{ lat: number; lon: number } | null>(null);
  const [spotInfo, setSpotInfo] = useState<PlaceContext | null>(null);
  const [band, setBand] = useState<Band | 'map'>('map');
  const [scenes, setScenes] = useState<ViewPass[]>([]);
  const [sceneIdx, setSceneIdx] = useState(0);
  const [scenesLoading, setScenesLoading] = useState(false);
  const [viewNote, setViewNote] = useState<string | null>(null);
  const [view, setView] = useState<ViewImage | null>(null);
  const [viewLoading, setViewLoading] = useState(false);

  /** Look at a spot: drop the pin, fly the map there and start showing the latest photo. */
  const lookAt = useCallback(
    (lat: number, lon: number, z = 15) => {
      setSplash(false);
      setAskPlace(null);
      setSpot({ lat, lon });
      setMode('map');
      setCenter({ lat, lon });
      setZoom(z);
      setBand('photo');
    },
    [setAskPlace, setSplash],
  );

  // What is there, from the backend: land cover, size, recent clear passes. For a saved place
  // it is measured inside its own outline; for a pin, inside the circle a question would cover.
  // It drives the place card and which questions are suggested.
  useEffect(() => {
    setSpotInfo(null);
    const input = place
      ? { geojson: place.geometry }
      : spot
        ? { point: { lat: spot.lat, lon: spot.lon, radius_m: SPOT_RADIUS_M } }
        : null;
    if (!input) return;
    const ac = new AbortController();
    api.areas
      .context(input, ac.signal)
      .then((c) => !ac.signal.aborted && setSpotInfo(c))
      .catch(() => undefined);
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place?.id, place?.geometry, spot]);

  // Recent clear Sentinel-2 passes over whatever is in focus (the pin, or the selected place).
  // A selected place replaces any pin.
  useEffect(() => {
    if (askPlaceId) setSpot(null);
  }, [askPlaceId]);
  // What live views show: a saved place's own outline, or the square around a pin.
  const focusKey = place ? `p:${place.id}` : spot ? `s:${spot.lat},${spot.lon}` : null;
  const focusTarget: ViewTarget | null = place ? { placeId: place.id } : spot ? { lat: spot.lat, lon: spot.lon } : null;
  useEffect(() => {
    setScenes([]);
    setSceneIdx(0);
    setViewNote(null);
    if (!focusTarget || mode !== 'map') return;
    const ac = new AbortController();
    setScenesLoading(true);
    api.views
      .passes(focusTarget, ac.signal)
      .then((sc) => !ac.signal.aborted && setScenes(sc))
      .catch((e) => !ac.signal.aborted && setViewNote(toApiError(e).detail ?? 'Live views are not available here.'))
      .finally(() => !ac.signal.aborted && setScenesLoading(false));
    return () => ac.abort();
    // focusKey stands for focusTarget (a new object each render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey, mode]);
  const scene = scenes[sceneIdx] ?? null;

  // One rendered image in the chosen band and pass: inside a place's outline, or a 2 km square
  // around a pin. Rendered and cached by the backend, then laid on the map by its bounds.
  useEffect(() => {
    setView(null);
    if (!scene || band === 'map' || !focusTarget) return;
    const ac = new AbortController();
    setViewLoading(true);
    api.views
      .image(focusTarget, band, scene.scene, ac.signal)
      .then((v) => !ac.signal.aborted && setView(v))
      .catch((e) => !ac.signal.aborted && setViewNote(toApiError(e).detail ?? 'Could not render this view.'))
      .finally(() => !ac.signal.aborted && setViewLoading(false));
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene, band, focusKey]);
  const viewOverlay: MapImage | null =
    view && band !== 'map' ? { layerId: band, url: view.url, bounds: view.bounds, date: view.date, label: band, when: 'after' } : null;

  // Layer definitions come from the catalog endpoint; keep the local on/ready flags.
  useEffect(() => {
    setLayers((cur) => (cur.length ? cur : catalogLayers));
  }, [catalogLayers]);

  const cx = mobile ? W / 2 : (W + chatW + 20) / 2;
  const cy = H / 2;

  const flyTo = useCallback((p: Place) => {
    setMode('map');
    setCenter({ lat: p.lat, lon: p.lon });
    setZoom(p.zoom);
  }, []);

  // Selecting a place (from Places page, selector or URL) shows it on the map; "no place" returns
  // to the globe. Landing has no place selected, so a plain visit stays on the globe hero.
  const lastPlace = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    // A place named by the URL may arrive before the places list: wait until it resolves.
    if (askPlaceId && !place) return;
    if (lastPlace.current === askPlaceId) return;
    const first = lastPlace.current === undefined;
    lastPlace.current = askPlaceId;
    if (skipFly.current) {
      // A place just drawn on the map: the map is already showing it.
      skipFly.current = false;
      return;
    }
    if (place) flyTo(place);
    else if (!first) setMode('globe');
  }, [askPlaceId, place, flyTo]);


  /* ---------------- agent run ---------------- */

  // The conversation and the stream live in the hook. This page only reacts to the coarse
  // `stage` to drive the map, and reads the blocks the run produced.
  const run = useAskRun({ lang, selectedPlaceId: askPlaceId });
  const { turns, last, stage, submit: ask } = run;

  // A run's images belong to the place (or pin) that run was about. The overlay remembers its
  // turn and is only drawn while that place or pin is the one selected, so switching place never
  // leaves another place's picture on the map (and switching back shows it again).
  const aboutFocus = useCallback(
    (t: AskTurn) =>
      t.placeId
        ? t.placeId === askPlaceId
        : !askPlaceId && !!spot && !!t.area &&
          Math.abs(t.area.point.lat - spot.lat) < 1e-5 && Math.abs(t.area.point.lon - spot.lon) < 1e-5,
    [askPlaceId, spot],
  );
  const [overlaySel, setOverlaySel] = useState<{ turnId: string; key: string } | null>(null);
  const [overlayWhen, setOverlayWhen] = useState<'before' | 'after'>('after');
  const selTurn = overlaySel ? turns.find((t) => t.id === overlaySel.turnId) : undefined;
  const shownTurn = selTurn && aboutFocus(selTurn) ? selTurn : undefined;
  // The layers panel lists what the latest answer about the current place or pin rendered.
  const panelTurn = shownTurn ?? (last && aboutFocus(last) ? last : undefined);
  const images = useMemo(() => (panelTurn ? mapImagesFrom(panelTurn.blocks) : {}), [panelTurn]);
  const overlayId = shownTurn && overlaySel ? overlaySel.key : null;

  /** Show one of a turn's layers; first bring its place or pin back into focus if needed. */
  const showTurnLayer = (t: AskTurn, key: string) => {
    if (!aboutFocus(t)) {
      if (t.placeId) setAskPlace(t.placeId);
      else if (t.area) {
        setAskPlace(null);
        setSpot({ lat: t.area.point.lat, lon: t.area.point.lon });
        setCenter({ lat: t.area.point.lat, lon: t.area.point.lon });
      }
    }
    setOverlaySel({ turnId: t.id, key });
    setOverlayWhen('after');
    setMode('map');
  };


  /**
   * Map choreography, keyed on a coarse stage rather than a step index — runs vary in how
   * many steps they take, so an index would mean nothing across two runs.
   */
  useEffect(() => {
    if (stage === 'idle') return;
    if (stage === 'starting') {
      setOverlaySel(null);
      return;
    }
    if (stage === 'locating') {
      const p = places.find((x) => x.id === last?.placeId);
      if (p) flyTo(p);
      return;
    }
    if (stage === 'routing') {
      const skill = last?.skillId ? skills.find((x) => x.id === last.skillId) : undefined;
      setPass(skill?.sat.split(' \u00b7 ')[0] ?? 'Sentinel-2');
      return;
    }
    if (stage === 'analysing') {
      setPass(null);
      return;
    }
    if (stage === 'done') {
      setPass(null);
      const first = last ? Object.keys(mapImagesFrom(last.blocks))[0] : undefined;
      setOverlaySel(last && first ? { turnId: last.id, key: first } : null);
      setOverlayWhen('after');
      return;
    }
    if (stage === 'error') setPass(null);
    // `last` is intentionally not a dependency: the stage transition is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  // Keep the newest turn in view as the conversation grows.
  useEffect(() => {
    const el = thread.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [turns.length, last?.steps.length, last?.blocks.length, last?.phase]);

  /** The `area` for a question about the pin, when no saved place is selected. */
  const spotOptions = () =>
    spot && !place ? { area: { point: { lat: spot.lat, lon: spot.lon, radius_m: SPOT_RADIUS_M }, name: spotInfo?.name ?? null } } : {};

  /** Keep the pin as a saved place (a circle), so it can have triggers and history. */
  const saveSpot = async () => {
    if (!spot) return;
    const name = spotInfo?.name ?? `Spot ${places.length + 1}`;
    try {
      const created = await addPlace({
        name,
        categoryKey: 'agriculture',
        center: spot,
        geometry: { type: 'Polygon', coordinates: [circleRing(spot, SPOT_RADIUS_M)] },
        isCircle: true,
        project: 'My places',
        tags: [],
        source: 'pin',
        details: [{ label: 'Added via', value: 'Picked on the map' }],
      });
      setSpot(null);
      skipFly.current = true;
      setAskPlace(created.id);
      notify(`${created.name} saved · ${created.areaHa} ha`, undefined, undefined, 'check_circle');
    } catch {
      notify('Could not save the place', undefined, undefined, 'error');
    }
  };

  const submit = () => {
    const text = q.trim();
    if (!text) return;
    setQ('');
    setPop(null);
    setSheet(false);
    setPlaceOpen(false);
    ask(text, spotOptions());
  };

  const runSkill = useCallback(
    (skillId: string, placeId?: string | null) => {
      const skill = skills.find((x) => x.id === skillId);
      if (!skill) return;
      const pid = placeId !== undefined ? placeId : askPlaceId;
      if (!pid) {
        setSheet(false);
        setPop('contours');
        notify('Pick a place to run this skill on', undefined, undefined, 'pentagon');
        return;
      }
      const p = places.find((x) => x.id === pid);
      setQ('');
      setPop(null);
      setSheet(false);
      setPlaceOpen(false);
      ask(`Run \u201c${skill.name}\u201d on ${p?.name ?? 'this place'}`, { skillId, placeId: pid });
    },
    [ask, askPlaceId, notify, places, skills],
  );

  // Deep link from the library: #/ask?place=np&skill=pond-filling-check runs it on that place.
  const deepLinked = useRef(false);
  useEffect(() => {
    const sk = route.query.skill;
    if (route.page !== 'ask' || !sk || deepLinked.current || !skills.length) return;
    const pid = route.query.place && route.query.place !== 'none' ? route.query.place : askPlaceId;
    if (!places.some((x) => x.id === pid)) return;
    deepLinked.current = true;
    setAskPlace(pid ?? null);
    runSkill(sk, pid);
    window.history.replaceState(null, '', `#/ask?place=${pid ?? 'none'}`);
  }, [route, skills, places, askPlaceId, runSkill, setAskPlace]);

  /* ---------------- map tools ---------------- */



  /** Start drawing on the map as it is; only fly there if we are still on the globe. */
  const startDraw = (shape: 'polygon' | 'circle' = 'polygon') => {
    setPop(null);
    setDraft([]);
    setDraftName('');
    setDraftKind('Not sure');
    setDrawShape(shape);
    setCirc({ center: null, radiusM: 250, sizing: false });
    setDrawing(true);
    if (mode !== 'map') {
      const c = spot ?? (place ? { lat: place.lat, lon: place.lon } : center);
      setMode('map');
      setCenter(c);
      setZoom(16);
    }
  };

  const cancelDraw = () => {
    setDrawing(false);
    setDraft([]);
    setCirc({ center: null, radiusM: 250, sizing: false });
  };

  /** A click on the map while drawing: a corner, or the circle's centre / size. */
  const drawTap = (lat: number, lon: number) => {
    if (drawShape === 'polygon') return setDraft((d) => [...d, { lat, lon }]);
    setCirc((c) =>
      !c.center || !c.sizing
        ? { center: { lat, lon }, radiusM: c.center ? c.radiusM : 250, sizing: !c.center } // first click: centre, then size by moving
        : { ...c, sizing: false }, // second click: fix the size
    );
  };

  /** Largest circle a place can be (the 25 km² limit), and the smallest worth measuring. */
  const MAX_RADIUS_M = 2800, MIN_RADIUS_M = 30;
  const setRadius = (m: number) =>
    setCirc((c) => ({ ...c, sizing: false, radiusM: Math.round(Math.max(MIN_RADIUS_M, Math.min(MAX_RADIUS_M, m))) }));

  const saveCircle = async () => {
    if (!circ.center) return notify('Click the map to set the centre', undefined, undefined, 'info');
    try {
      const created = await addPlace({
        name: draftName.trim() || `${draftKind === 'Not sure' ? 'Place' : draftKind} ${places.length + 1}`,
        categoryKey: DRAFT_KINDS[draftKind],
        center: circ.center,
        geometry: { type: 'Polygon', coordinates: [circleRing(circ.center, circ.radiusM)] },
        isCircle: true,
        project: 'My places',
        tags: draftKind === 'Not sure' ? [] : [draftKind.toLowerCase()],
        source: 'pin',
        details: [{ label: 'Added via', value: `Circle of ${circ.radiusM} m on the map` }],
      });
      cancelDraw();
      setSpot(null);
      skipFly.current = true;
      setAskPlace(created.id);
      notify(`${created.name} saved · ${created.areaHa} ha`, undefined, undefined, 'check_circle');
    } catch (e) {
      notify(toApiError(e).detail ?? 'Could not save the circle', undefined, undefined, 'error');
    }
  };

  /** Save the drawn outline as a place. The area shown comes back from the server. */
  const saveDraft = async () => {
    if (draft.length < 3) return notify('Add at least 3 corners', undefined, undefined, 'info');
    const ring = [...draft, draft[0]].map((p) => [+p.lon.toFixed(7), +p.lat.toFixed(7)]);
    const c = { lat: draft.reduce((a, p) => a + p.lat, 0) / draft.length, lon: draft.reduce((a, p) => a + p.lon, 0) / draft.length };
    try {
      const created = await addPlace({
        name: draftName.trim() || `${draftKind === 'Not sure' ? 'Place' : draftKind} ${places.length + 1}`,
        categoryKey: DRAFT_KINDS[draftKind],
        center: c,
        geometry: { type: 'Polygon', coordinates: [ring] },
        isCircle: false,
        project: 'My places',
        tags: draftKind === 'Not sure' ? [] : [draftKind.toLowerCase()],
        source: 'drawn',
        details: [{ label: 'Added via', value: 'Drawn on the map' }],
      });
      setDrawing(false);
      setDraft([]);
      setSpot(null);
      skipFly.current = true;
      setAskPlace(created.id);
      notify(`${created.name} saved · ${created.areaHa} ha`, undefined, undefined, 'check_circle');
    } catch (e) {
      notify(toApiError(e).detail ?? 'Could not save the outline', undefined, undefined, 'error');
    }
  };


  const toolClick = (k: string) => {
    if (['draw', 'contours'].includes(k)) return setPop((p) => (p === k ? null : k));
  };

  /* ---------------- derived ---------------- */

  const overlayPair = overlayId ? images[overlayId] : undefined;
  const overlay = overlayPair ? overlayPair[overlayWhen] : null;
  const overlayName = overlayId ? layers.find((l) => l.id === overlayId)?.name ?? overlayId : '';
  const isMap = mode === 'map';
  const showHero = !splash && !isMap && !turns.length && !sheet && H >= 560 && !mobile;
  const spotName = spotInfo?.name ?? 'Dropped pin';
  const placeWatches = place ? watches.filter((w) => w.placeId === place.id) : [];

  // Questions the backend can actually answer today. The pond check is the one real skill;
  // the others are free-form questions the agent handles from the knowledge cards.
  const hasPondSkill = skills.some((x) => x.id === 'pond-filling-check');
  // Questions that fit what is actually there (park, ponds, fields, city…), not a fixed list.
  const fitted = place || spot
    ? suggestionsFor({ name: place?.name, categoryKey: place?.categoryKey, tags: place?.tags, landCover: spotInfo?.land_cover ?? null })
    : null;
  const suggestions = fitted
    ? fitted.map((sg) => ({
        icon: sg.icon,
        text: sg.text,
        go: () => (sg.skillId && hasPondSkill && place ? runSkill(sg.skillId) : ask(sg.text, spotOptions())),
      }))
    : [
        { icon: 'eco', text: 'What does the greenness index measure?', go: () => ask('What does the greenness index (NDVI) measure?') },
        { icon: 'satellite_alt', text: 'Which free satellites can see through clouds?', go: () => ask('Which free satellites can see through clouds?') },
        { icon: 'public', text: 'Tap the globe to look at any place', go: () => notify('Tap anywhere on the globe to fly there', undefined, undefined, 'public') },
      ];

  const sq = searchQ.trim().toLowerCase();
  // Wait for a pause in typing before asking the geocoder (it allows about one request a
  // second, and half-typed words only return noise like "Par" for "Paris").
  const [dq, setDq] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setDq(sq), 350);
    return () => window.clearTimeout(t);
  }, [sq]);

  // Geocoder results come from the API; the user's own places are matched locally since they
  // are already loaded. Too-short queries are not sent (the backend rejects them with a 422).
  const geo = useResource(
    useCallback(
      (signal: AbortSignal) => (dq.length >= 2 && !parseLocation(dq) ? api.areas.resolve({ query: dq }, signal).then(toSearchHits) : Promise.resolve([])),
      [dq],
    ),
    [dq],
  );
  const searching = sq.length >= 2 && !parseLocation(sq) && (sq !== dq || geo.isFetching);

  // A pasted map link or "lat, lon" goes straight to that spot.
  const pasted = parseLocation(searchQ);
  type SearchRow = { key: string; n: string; d: string; icon: string; go: () => void };
  const searchSections = useMemo(() => {
    const mine: SearchRow[] = places
      .filter((p) => !sq || `${p.name} ${p.project}`.toLowerCase().includes(sq))
      .slice(0, sq ? 3 : 5)
      .map((p) => ({
        key: `place:${p.id}`,
        n: p.name,
        d: `${p.areaHa} ha${p.project ? ` · ${p.project}` : ''}`,
        icon: p.circle ? 'radio_button_unchecked' : 'pentagon',
        go: () => { setAskPlace(p.id); flyTo(p); setPop(null); setSearchQ(''); },
      }));
    const found: SearchRow[] = (sq === dq ? geo.data ?? [] : []).slice(0, 6).map((r, i) => ({
      key: `geo:${i}:${r.lat.toFixed(3)},${r.lon.toFixed(3)}`,
      n: r.name,
      d: r.description,
      icon: kindIcon(r.kind),
      go: () => {
        lookAt(r.lat, r.lon, r.zoom);
        setPop(null);
        setSearchQ('');
      },
    }));
    const link: SearchRow[] = pasted
      ? [{ key: 'pasted', n: 'Location from your link', d: 'Drop a pin there', icon: 'my_location', go: () => { lookAt(pasted.lat, pasted.lon); setPop(null); setSearchQ(''); } }]
      : [];
    return [
      { title: 'From your link', rows: link },
      { title: 'My places', rows: mine },
      { title: 'Places', rows: found },
    ].filter((sec) => sec.rows.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [places, sq, dq, geo.data, setAskPlace, flyTo, lookAt, pasted?.lat, pasted?.lon]);
  const firstResult = searchSections[0]?.rows[0];

  const tools: { k: string; icon?: string; title?: string; caret?: boolean }[] = [
    { k: 'draw', icon: 'polyline', title: 'Draw an outline', caret: true },
    { k: 'contours', icon: 'pentagon', title: 'My places', caret: true },
  ];

  return (
    <div style={{ position: 'fixed', top: navH, left: 0, right: 0, bottom: mobile ? 64 : 0, overflow: 'hidden', background: '#000', visibility: active ? 'visible' : 'hidden' }} aria-hidden={!active}>
      <Suspense fallback={null}>
        <Globe
          visible={active && !isMap}
          offsetRight={!mobile && !splash}
          // On the opening screen a tap only starts the app; picking places comes after.
          pickable={!splash}
          onPick={(lat, lon) => lookAt(lat, lon)}
          onOutside={() => splash && setSplash(false)}
        />
      </Suspense>
      {isMap && (
        <MapView
          W={W} H={H} cx={cx} cy={cy} center={center} zoom={zoom} place={place} contour overlay={overlay ?? viewOverlay} pass={pass}
          pin={
            drawing && drawShape === 'circle'
              ? circ.center ? { ...circ.center, radiusM: circ.radiusM } : null
              : spot && !place && !drawing ? { ...spot, radiusM: SPOT_RADIUS_M } : null
          }
          draft={drawing && drawShape === 'polygon' ? draft : null}
          onHover={
            drawing && drawShape === 'circle' && circ.sizing && circ.center
              ? (lat, lon) => setCirc((c) => (c.center && c.sizing ? { ...c, radiusM: Math.round(Math.max(MIN_RADIUS_M, Math.min(MAX_RADIUS_M, distanceM(c.center, { lat, lon })))) } : c))
              : undefined
          }
          onCenter={setCenter}
          onZoom={setZoom}
          onTap={(lat, lon) => {
            if (drawing) return drawTap(lat, lon);
            setAskPlace(null);
            setSpot({ lat, lon });
          }}
        />
      )}

      {splash && <Splash onContinue={() => setSplash(false)} />}
      {!splash && (<>

      {/* LIVE SATELLITE VIEW: band chips and recent passes for the pin or place in focus */}
      {isMap && !overlay && !drawing && (spot || place) && (
        <div className="panel col fade-up" style={{ position: 'absolute', left: mobile ? 16 : chatW + 40, right: mobile ? 16 : 20, margin: '0 auto', width: 'max-content', maxWidth: mobile ? 'calc(100% - 32px)' : `calc(100% - ${chatW + 60}px)`, top: mobile ? 64 : 90, gap: 8, padding: 8, zIndex: 14 }}>
          <div className="row wrap" style={{ gap: 6 }}>
            <button className={`chip ${band === 'map' ? 'on' : ''}`} style={{ padding: '4px 10px' }} onClick={() => setBand('map')} title="Cloud-free basemap (2020)">Map</button>
            {BANDS.map((b) => (
              <button key={b.id} className={`chip ${band === b.id ? 'on' : ''}`} style={{ padding: '4px 10px', opacity: scene ? 1 : 0.45 }} disabled={!scene} onClick={() => setBand(b.id)} title={b.hint} aria-pressed={band === b.id}>
                {b.label}
              </button>
            ))}
          </div>
          <div className="row" style={{ gap: 6, overflowX: 'auto' }}>
            {scenesLoading && <span className="tiny muted">Finding recent clear passes…</span>}
            {!scenesLoading && !scenes.length && <span className="tiny muted">{viewNote ?? 'No clear Sentinel-2 pass in the last 4 months here.'}</span>}
            {scenes.slice(0, 6).map((sc, i) => (
              <button key={sc.scene} onClick={() => { setSceneIdx(i); if (band === 'map') setBand('photo'); }} className="tiny" title={`${sc.satellite} · ${sc.cloud}% cloud in the tile`} style={{ flex: 'none', padding: '3px 8px', borderRadius: 9999, border: `1px solid ${i === sceneIdx && band !== 'map' ? '#fff' : 'var(--hair)'}`, background: 'transparent', color: i === sceneIdx && band !== 'map' ? '#fff' : 'var(--muted)' }}>
                {new Date(String(sc.date) + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })}
              </button>
            ))}
          </div>
          {scene && band !== 'map' && (
            <span className="tiny muted">
              {viewLoading ? `Rendering ${BANDS.find((b) => b.id === band)?.label.toLowerCase()}…` : `${scene.satellite} · ${scene.date} · ${scene.cloud}% cloud · ${BANDS.find((b) => b.id === band)?.hint}`}
            </span>
          )}
        </div>
      )}

      {/* REAL LAYER: which rendered image is on the map, and before/after */}
      {isMap && overlayPair && (
        <div className="panel row fade-up" style={{ position: 'absolute', left: mobile ? 16 : chatW + 40, right: mobile ? 16 : 20, margin: '0 auto', width: 'max-content', maxWidth: 'calc(100% - 32px)', top: mobile ? 64 : 90, gap: 10, padding: '6px 6px 6px 14px', zIndex: 14 }}>
          <span className="eyebrow muted" title="Images the agent measured for this answer">Answer</span>
          {Object.keys(images).length > 1 && shownTurn ? (
            Object.keys(images).map((k) => (
              <button key={k} className={`chip ${overlayId === k ? 'on' : ''}`} style={{ padding: '4px 10px' }} onClick={() => showTurnLayer(shownTurn, k)} aria-pressed={overlayId === k}>
                <span className="sq" style={{ width: 8, height: 8, marginRight: 6, background: layers.find((l) => l.id === k)?.color ?? '#fff' }} />
                {layers.find((l) => l.id === k)?.name.split(' · ')[0] ?? k}
              </button>
            ))
          ) : (
            <>
              <span className="sq" style={{ width: 10, height: 10, background: layers.find((l) => l.id === overlayId)?.color ?? '#fff' }} />
              <span style={{ font: '600 13px/1.38 var(--font)' }}>{overlayName}</span>
            </>
          )}
          <span className="tiny muted">{overlay?.date}</span>
          {(['before', 'after'] as const).map((w) => (
            <button key={w} className={`chip ${overlayWhen === w ? 'on' : ''}`} style={{ padding: '4px 10px' }} onClick={() => setOverlayWhen(w)} aria-pressed={overlayWhen === w}>
              {w === 'before' ? 'Before' : 'After'}
            </button>
          ))}
          <IconBtn icon="close" className="sm" onClick={() => setOverlaySel(null)} aria-label="Hide layer" />
        </div>
      )}

      {/* DRAWING: corners are added by clicking the live map; drag and scroll still move it */}
      {drawing && isMap && (
        <div className="panel col fade-up" style={{ position: 'absolute', left: mobile ? 16 : chatW + 40, right: mobile ? 16 : 20, margin: '0 auto', width: 'max-content', maxWidth: 'calc(100% - 32px)', top: mobile ? 64 : 90, gap: 10, padding: 12, zIndex: 24 }}>
          <div className="row" style={{ gap: 8 }}>
            <Ms n={drawShape === 'circle' ? 'radio_button_unchecked' : 'polyline'} size={18} />
            <span style={{ font: '600 14px/1.4 var(--font)' }}>{drawShape === 'circle' ? 'Draw a circle' : 'Draw an outline'}</span>
            <span className="tiny muted">
              {drawShape === 'polygon'
                ? 'Click the map to add corners · drag to move · scroll to zoom'
                : !circ.center
                  ? 'Click the centre of the circle'
                  : circ.sizing
                    ? 'Move to size it, click to fix it'
                    : 'Click elsewhere to move it, or set the size below'}
            </span>
          </div>
          {drawShape === 'circle' && (
            <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
              <span className="tiny muted">Radius</span>
              {[100, 250, 500, 1000].map((m) => (
                <button key={m} className={`chip ${circ.radiusM === m ? 'on' : ''}`} style={{ padding: '4px 10px' }} onClick={() => setRadius(m)}>
                  {m < 1000 ? `${m} m` : `${m / 1000} km`}
                </button>
              ))}
              <input
                className="input"
                type="number"
                min={MIN_RADIUS_M}
                max={MAX_RADIUS_M}
                step={10}
                value={circ.radiusM}
                onChange={(e) => setRadius(+e.target.value || MIN_RADIUS_M)}
                aria-label="Radius in metres"
                style={{ width: 84, height: 30 }}
              />
              <span className="tiny muted">m · {(Math.PI * circ.radiusM * circ.radiusM / 10_000).toFixed(1)} ha</span>
            </div>
          )}
          <div className="row wrap" style={{ gap: 8 }}>
            <input className="input" value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder={`${draftKind === 'Not sure' ? 'Place' : draftKind} ${places.length + 1}`} aria-label="Name" style={{ width: 180, height: 32 }} />
            {(Object.keys(DRAFT_KINDS) as DraftKind[]).map((k) => (
              <button key={k} className={`chip ${draftKind === k ? 'on' : ''}`} style={{ padding: '4px 10px' }} onClick={() => setDraftKind(k)} aria-pressed={draftKind === k}>{k}</button>
            ))}
          </div>
          {drawShape === 'polygon' ? (
            <div className="row" style={{ gap: 8 }}>
              <span className="tiny muted grow">{draft.length} corner{draft.length === 1 ? '' : 's'}{draft.length < 3 ? ` · ${3 - draft.length} more to save` : ''}</span>
              <Btn size="sm" onClick={() => setDraft((d) => d.slice(0, -1))} disabled={!draft.length}>Undo</Btn>
              <Btn size="sm" onClick={cancelDraw}>Cancel</Btn>
              <Btn size="sm" variant="primary" onClick={saveDraft} disabled={draft.length < 3}>Save</Btn>
            </div>
          ) : (
            <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <Btn size="sm" onClick={cancelDraw}>Cancel</Btn>
              <Btn size="sm" variant="primary" onClick={saveCircle} disabled={!circ.center}>Save</Btn>
            </div>
          )}
        </div>
      )}

      {/* HERO — after the opening screen, just the one instruction that matters */}
      {showHero && (
        <div style={{ position: 'absolute', left: 48, bottom: 40, maxWidth: 560, pointerEvents: 'none', animation: 'fadeUp .6s ease both' }}>
          <div className="h3" style={{ letterSpacing: -0.5 }}>Tap the globe to look at any place.</div>
          <div className="body-sm muted" style={{ marginTop: 8 }}>Or search a town, paste a map link, or pick one of your places. Then try its bands and ask what changed.</div>
          <div className="row wrap" style={{ marginTop: 16, gap: 8 }}>
            <span className="pill" style={{ background: 'var(--s1)' }}><Ms n="satellite_alt" size={14} />Sentinel-1/2 · Landsat</span>
            <span className="pill" style={{ background: 'var(--s1)' }}><span className="dot" style={{ background: 'var(--green)' }} />Free, open data</span>
          </div>
        </div>
      )}

      {/* LEFT COLUMN: chat on top, place detail at the bottom */}
      <div style={{ position: 'absolute', left: mobile ? 16 : 20, top: mobile ? 12 : 20, bottom: mobile ? 12 : 24, width: chatW, display: 'flex', flexDirection: 'column', gap: 12, zIndex: 20, pointerEvents: 'none' }}>
        <div className="panel" style={{ flex: '0 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'visible', pointerEvents: 'auto' }}>
          <div className="row" style={{ gap: 12, padding: '8px 8px 8px 14px', flex: 'none' }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid #fff', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} /></div>
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder={place ? `Ask about ${place.name}…` : spot ? `Ask about ${spotName}…` : t('chat.placeholder')} aria-label="Ask a question" style={{ flex: 1, minWidth: 0, height: 36, background: 'transparent', border: 0, outline: 0, color: '#fff', font: '500 15px/1.5 var(--font)' }} />
            <button onClick={submit} title="Send" aria-label="Send" style={{ width: 36, height: 36, flex: 'none', borderRadius: 8, background: '#fff', color: '#000', border: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ms n="arrow_upward" size={20} /></button>
          </div>
          {!turns.length && (
            <div style={{ borderTop: '1px solid var(--hair-soft)', padding: '12px 14px 14px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="eyebrow" style={{ marginBottom: 4 }}>{t('chat.try')}</div>
              {suggestions.map((sg) => (
                <button key={sg.text} onClick={sg.go} className="menu-item" style={{ color: 'var(--muted)' }}>
                  <Ms n={sg.icon} size={18} />{sg.text}
                </button>
              ))}
            </div>
          )}
          {!!turns.length && (
            <div ref={thread} style={{ borderTop: '1px solid var(--hair-soft)', padding: 16, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18, minHeight: 0 }}>
              {turns.map((turn) => (
                <TurnView key={turn.id} turn={turn} isLast={turn === last} places={places}
                  onToggle={() => run.toggleOpen(turn.id)}
                  onPick={(k, o) => run.setAnswerValue(turn.id, k, o)}
                  onRemember={(r) => run.setRemember(turn.id, r)}
                  onContinue={run.continueAfterClarify}
                  onRetry={run.retry}
                  onRunSkill={(id) => runSkill(id)}
                  onAskFollowup={(q) => ask(q)}
                  onShowOnMap={(key) => showTurnLayer(turn, key)}
                />
              ))}
              {last?.phase === 'done' && (
                <button className="btn btn-text btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => { run.reset(); setOverlaySel(null); }}>
                  <Ms n="add_comment" />New chat
                </button>
              )}
            </div>
          )}
        </div>

        {/* PICKED SPOT — what's under the pin, before asking */}
        {spot && !place && isMap && !drawing && (
          <div className="panel fade-up col" style={{ flex: 'none', pointerEvents: 'auto', padding: 14, gap: 10 }}>
            <div className="row" style={{ gap: 10 }}>
              <Ms n="location_on" size={20} />
              <div className="col grow" style={{ minWidth: 0 }}>
                <span className="ink" style={{ font: '600 15px/1.35 var(--font)' }}>{spotName}{spotInfo?.country ? <span className="tiny"> · {spotInfo.country}</span> : null}</span>
                <span className="tiny">Circle of {SPOT_RADIUS_M} m{spotInfo ? ` · ${spotInfo.area_ha.toFixed(1)} ha` : ''}</span>
              </div>
              <IconBtn icon="close" className="sm" onClick={() => setSpot(null)} aria-label="Remove pin" />
            </div>
            {spotInfo ? (
              <>
                {landCoverLine(spotInfo.land_cover, 4) && <div className="caption">{landCoverLine(spotInfo.land_cover, 4)}</div>}
                <div className="tiny muted">
                  {spotInfo.recent_scenes.clear} clear looks in 60 days · {spotInfo.recent_scenes.radar} radar passes
                  {spotInfo.elevation_m ? ` · ${Math.round(spotInfo.elevation_m.min)}–${Math.round(spotInfo.elevation_m.max)} m high` : ''}
                </div>
                {spotInfo.warnings.map((w) => <div key={w} className="tiny" style={{ color: 'var(--yellow)' }}>{w}</div>)}
              </>
            ) : (
              <div className="tiny muted">Reading what is here…</div>
            )}
            <div className="row wrap" style={{ gap: 6 }}>
              <Btn size="sm" variant="primary" icon="bookmark_add" onClick={saveSpot}>Save this circle</Btn>
              <Btn size="sm" icon="polyline" onClick={() => startDraw('polygon')}>Draw an outline</Btn>
            </div>
            <div className="tiny muted">Drag to look around · scroll to zoom · click to move the pin</div>
          </div>
        )}

        {/* PLACE DETAIL — pinned at the bottom of the ask page */}
        {place && isMap && !drawing && (
          <div className="panel fade-up" style={{ flex: 'none', pointerEvents: 'auto', overflow: 'hidden', position: 'relative' }}>
            <button onClick={() => setPlaceOpen((o) => !o)} className="row" style={{ width: '100%', gap: 12, padding: 10, background: 'transparent', border: 0, textAlign: 'left' }} aria-expanded={placeOpen}>
              <div style={{ width: 44, height: 44, borderRadius: 8, flex: 'none', background: `#000 url(${thumb(place.lat, place.lon, Math.min(place.zoom, 16))}) center/cover`, border: '1px solid var(--hair-soft)' }} />
              <div className="col grow">
                <span className="ink" style={{ font: '600 15px/1.35 var(--font)' }}>{place.name}</span>
                <span className="tiny">{place.project} · {place.areaHa} ha</span>
                {landCoverLine(spotInfo?.land_cover) && <span className="tiny muted">{landCoverLine(spotInfo?.land_cover)}</span>}
              </div>
              <Ms n={placeOpen ? 'expand_more' : 'expand_less'} size={20} className="muted" />
            </button>
            <IconBtn icon="close" className="sm" style={{ position: 'absolute', top: 8, right: 40 }} onClick={() => setAskPlace(null)} aria-label="Stop asking about this place" title="General question instead" />
            {placeOpen && (
              <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="stats" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  {place.details.slice(0, 4).map((d) => (
                    <div key={d.label}><div className="l">{d.label}</div><div className="v" style={{ fontSize: 14 }}>{d.value}</div></div>
                  ))}
                </div>
                <div className="col" style={{ gap: 6 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="eyebrow">Triggers here · {placeWatches.length}</span>
                    <button className="btn btn-text btn-sm" onClick={() => open({ kind: 'watchBuilder', placeId: place.id })}><Ms n="add" />Add trigger</button>
                  </div>
                  {placeWatches.slice(0, 3).map((w) => (
                    <button key={w.id} onClick={() => go('triggers', w.id)} className="row" style={{ gap: 8, padding: '6px 8px', borderRadius: 8, background: 'var(--s2)', border: 0, textAlign: 'left' }}>
                      <span className="dot" style={{ background: w.status === 'ok' ? 'var(--green)' : w.status === 'warn' ? 'var(--yellow)' : 'var(--red)' }} />
                      <span className="grow" style={{ font: '500 13px/1.38 var(--font)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span>
                      <span className="tiny ink">{w.value}{w.unit ? ' ' + w.unit : ''}</span>
                    </button>
                  ))}
                  {!placeWatches.length && <span className="caption">No triggers on this place yet.</span>}
                </div>
                <div className="row wrap" style={{ gap: 6 }}>
                  {place.tags.map((tg) => <span key={tg} className="tag">{tg}</span>)}
                  <span className="tag"><Ms n="draw" />{sourceLabel(place.source)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* TOOLBAR (Google Earth style) */}
      {!mobile && (
        <div className="panel row" style={{ position: 'absolute', left: chatW + 36, top: 20, height: 54, gap: 2, padding: '6px 8px', zIndex: 22 }}>
          <div style={{ position: 'relative' }}>
            <div className="row" style={{ gap: 8, width: compact ? 150 : 250, height: 40, padding: '0 12px', borderRadius: 8, background: '#000', border: '1px solid var(--hair-soft)' }}>
              <Ms n="search" size={20} className="muted" />
              <input value={searchQ} onChange={(e) => { setSearchQ(e.target.value); setPop('search'); }} onFocus={() => setPop('search')} onKeyDown={(e) => e.key === 'Enter' && firstResult?.go()} placeholder="Search a place" title="Search a town or place, or paste a Google Maps link" aria-label="Search a place" style={{ flex: 1, minWidth: 0, background: 'transparent', border: 0, outline: 0, color: '#fff', font: '500 14px/1.5 var(--font)' }} />
            </div>
            {pop === 'search' && (
              <div className="menu" style={{ left: -8, top: 52, width: 340, maxHeight: 440, overflowY: 'auto' }}>
                {searchSections.map((sec) => (
                  <div key={sec.title}>
                    <div className="menu-label eyebrow">{sec.title}</div>
                    {sec.rows.map((r) => (
                      <button key={r.key} className="menu-item" onClick={r.go} style={{ alignItems: 'flex-start' }}>
                        <Ms n={r.icon} style={{ marginTop: 2 }} />
                        <span className="col" style={{ minWidth: 0 }}>
                          <span style={{ font: '600 14px/1.4 var(--font)' }}>{r.n}</span>
                          {r.d && <span className="tiny" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.d}</span>}
                        </span>
                      </button>
                    ))}
                  </div>
                ))}
                {searching && <div className="caption muted row" style={{ padding: '8px 12px', gap: 8 }}><span className="spinner" />Searching…</div>}
                {!searching && sq.length >= 2 && !searchSections.length && (
                  <div className="caption" style={{ padding: 12 }}>Nothing found for "{searchQ.trim()}". Try a nearby town, or paste a Google Maps link.</div>
                )}
                {!sq && !searchSections.length && <div className="caption muted" style={{ padding: 12 }}>Type a town, a park, a lake… or paste a map link.</div>}
              </div>
            )}
          </div>
          {tools.map((tl, i) =>
            tl.k === '|' ? <div key={i} style={{ width: 1, height: 26, background: 'var(--hair)', margin: '0 6px' }} /> : (
              <div key={tl.k} style={{ position: 'relative' }}>
                <button onClick={() => toolClick(tl.k)} title={tl.title} aria-label={tl.title} style={{ height: 40, minWidth: 40, padding: `0 ${tl.caret ? 4 : 0}px`, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: 0, background: pop === tl.k || (tl.k === 'draw' && drawing) ? 'var(--s3)' : 'transparent' }}>
                  <Ms n={tl.icon!} size={22} />
                  {tl.caret && <Ms n="arrow_drop_down" size={18} className="muted" />}
                </button>
                {pop === 'draw' && tl.k === 'draw' && (
                  <div className="menu" style={{ left: -40, top: 52, width: 290 }}>
                    <div className="menu-label eyebrow">Add line or shape</div>
                    <button className="menu-item on" onClick={() => startDraw('polygon')}><Ms n="polyline" />Draw an outline<span className="tiny" style={{ marginLeft: 'auto' }}>field, pond, plot…</span></button>
                    <button className="menu-item" onClick={() => startDraw('circle')}><Ms n="radio_button_unchecked" />Draw a circle<span className="tiny" style={{ marginLeft: 'auto' }}>centre + size</span></button>
                    <button className="menu-item" onClick={() => { setPop(null); open({ kind: 'addPlace' }); }}><Ms n="upload_file" /><span className="col">Upload outline<span className="tiny">KML, GeoJSON or Shapefile</span></span></button>
                  </div>
                )}
                {pop === 'contours' && tl.k === 'contours' && (
                  <div className="menu" style={{ left: -40, top: 52, width: 280 }}>
                    <div className="menu-label eyebrow">My places</div>
                    {places.map((c) => (
                      <button key={c.id} className={`menu-item ${c.id === askPlaceId ? 'on' : ''}`} onClick={() => { setAskPlace(c.id); flyTo(c); setPop(null); }}>
                        <Ms n={c.circle ? 'radio_button_unchecked' : 'pentagon'} />
                        <span className="col grow"><span style={{ font: '600 14px/1.4 var(--font)' }}>{c.name}</span><span className="tiny">{c.areaHa} ha</span></span>
                        {c.id === askPlaceId && <Ms n="check" size={18} />}
                      </button>
                    ))}
                    <div className="divider" style={{ margin: '6px 4px' }} />
                    <button className="menu-item" style={{ color: 'var(--muted)' }} onClick={() => { setPop(null); open({ kind: 'addPlace' }); }}><Ms n="add" />Add a new place</button>
                  </div>
                )}
              </div>
            ),
          )}
        </div>
      )}

      {/* LAYERS PANEL */}
      {/* DOCK */}
      <div className="panel row" style={{ position: 'absolute', left: mobile ? 'auto' : chatW + 40, right: mobile ? 16 : 20, margin: mobile ? 0 : '0 auto', width: 'max-content', bottom: mobile ? 'auto' : 24, top: mobile ? 12 : 'auto', gap: 6, padding: 6, zIndex: 16, display: mobile && (turns.length > 0 || pop) ? 'none' : 'flex' }}>
        <Btn variant="primary" icon="auto_stories" onClick={() => { setSheet(true); setPop(null); }}>{mobile ? '' : 'Skills'}</Btn>
        {!mobile && (
          <Btn icon="notifications_active" onClick={() => go('triggers')}>
            {t('nav.triggers')}<span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9999, background: '#fff', color: '#000', font: '600 11px/18px var(--font)', textAlign: 'center' }}>{watches.filter((w) => w.enabled).length}</span>
          </Btn>
        )}
        {isMap && !mobile && <IconBtn icon="public" title="Back to globe" aria-label="Back to globe" onClick={() => { setMode('globe'); cancelDraw(); setSpot(null); }} />}
      </div>

      {/* ZOOM */}
      {isMap && !mobile && (
        <div className="col" style={{ position: 'absolute', right: 20, bottom: 24, gap: 6, zIndex: 5 }}>
          <IconBtn icon="add" className="boxed" title="Zoom in" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(18, z + 1))} />
          <IconBtn icon="remove" className="boxed" title="Zoom out" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(3, z - 1))} />
        </div>
      )}

      {/* SKILLS SHEET — quick pick, full library lives on the Library page */}
      {sheet && (
        <SkillSheet cat={cat} setCat={setCat} place={place} onClose={() => setSheet(false)}
          onRun={(id) => runSkill(id)}
          onOpen={(id) => go('library', id)} />
      )}
      </>)}
    </div>
  );
}

/* ---------------- one Q&A turn ---------------- */

function TurnView({
  turn,
  isLast,
  places,
  onToggle,
  onPick,
  onRemember,
  onContinue,
  onRetry,
  onRunSkill,
  onAskFollowup,
  onShowOnMap,
}: {
  turn: AskTurn;
  isLast: boolean;
  places: Place[];
  onToggle: () => void;
  onPick: (key: string, option: string) => void;
  onRemember: (remember: boolean) => void;
  onContinue: () => void;
  onRetry: () => void;
  onRunSkill: (id: string) => void;
  onAskFollowup: (q: string) => void;
  /** Put a block's before/after layer on the map. */
  onShowOnMap: (layerKey: string) => void;
}) {
  const place = places.find((x) => x.id === turn.placeId);
  const steps = turn.steps;
  const running = turn.phase === 'running';
  // A few plain stages instead of every tool call; the raw list is under "Technical details".
  const stages = stagesFrom(steps, running);
  const now = [...stages].reverse().find((st) => !st.done);
  const [raw, setRaw] = useState(false);

  const label =
    turn.phase === 'clarify'
      ? 'Waiting for your answers'
      : turn.phase === 'error'
        ? 'Could not complete this'
        : running
          ? `${now?.label ?? 'Getting started'}…`
          : `Answered in ${Math.max(1, Math.round((turn.durationMs ?? 0) / 1000))} s`;

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="col" style={{ alignSelf: 'flex-end', alignItems: 'flex-end', maxWidth: '85%', gap: 4 }}>
        <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--s2)', font: '500 14px/1.5 var(--font)' }}>{turn.text}</div>
        <span className="tiny">{place ? <>about <span className="muted">{place.name}</span></> : 'general question'}</span>
      </div>

      <div className="col">
        <button
          onClick={onToggle}
          className="row"
          style={{ gap: 8, padding: '4px 0', background: 'transparent', border: 0, color: 'var(--muted)', textAlign: 'left', font: '500 13px/1.38 var(--font)' }}
          aria-expanded={turn.open}
        >
          {turn.phase === 'running' ? (
            <>
              <span className="spinner" />
              <span className="shimmer-text" style={{ fontSize: 13 }}>{label}</span>
            </>
          ) : (
            <>
              <Ms
                n={turn.phase === 'done' ? 'check_circle' : turn.phase === 'error' ? 'error_outline' : 'help'}
                size={16}
              />
              <span>{label}</span>
            </>
          )}
          <Ms n={turn.open ? 'expand_less' : 'expand_more'} size={18} style={{ marginLeft: 'auto' }} />
        </button>

        {turn.open && (
          <div className="col" style={{ marginTop: 10 }}>
            {stages.map((st) => {
              const active = running && !st.done;
              return (
                <div key={st.key} className="row" style={{ gap: 10, alignItems: 'flex-start', padding: '4px 0', animation: 'fadeUp .3s ease both' }}>
                  <div style={{ width: 18, flex: 'none', display: 'flex', justifyContent: 'center', paddingTop: 1 }}>
                    {active ? <span className="spinner" /> : <Ms n={st.error ? 'error_outline' : st.icon} size={17} className="muted" />}
                  </div>
                  <div className="col grow" style={{ minWidth: 0 }}>
                    <span className={active ? 'shimmer-text' : undefined} style={{ font: '500 13px/1.45 var(--font)', color: active ? undefined : 'var(--ink, #fff)' }}>{st.label}</span>
                    {st.detail && <span className="tiny muted">{st.detail}</span>}
                  </div>
                </div>
              );
            })}
            {!!steps.length && (
              <button className="btn btn-text btn-sm" style={{ alignSelf: 'flex-start', marginTop: 4, padding: '2px 0', color: 'var(--subtle)' }} onClick={() => setRaw((r) => !r)} aria-expanded={raw}>
                <Ms n={raw ? 'expand_less' : 'code'} size={16} />Technical details · {steps.length} steps
              </button>
            )}
            {raw && (
              <div className="col" style={{ gap: 2, marginTop: 4, padding: 10, borderRadius: 8, background: 'var(--s1)', border: '1px solid var(--hair-soft)', maxHeight: 220, overflowY: 'auto' }}>
                {steps.map((st) => (
                  <div key={st.index} className="tiny" style={{ display: 'grid', gridTemplateColumns: '96px 1fr', gap: 8 }}>
                    <code style={{ color: 'var(--muted)' }}>{st.tool}</code>
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={st.result ?? st.error ?? st.title}>{st.error ?? st.result ?? (st.done ? st.title : `${st.title}…`)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* The agent asks for details itself now, rather than the frontend guessing which
                questions to ask. Answers are prefilled from the place's memory where it has any. */}
            {turn.clarification && isLast && (
              <div className="col" style={{ marginTop: 4, padding: 14, borderRadius: 12, background: 'var(--s2)', border: '1px solid var(--hair)', gap: 12 }}>
                <div className="caption">A few details make the answer much better.</div>
                {turn.clarification.questions.map((g) => (
                  <div key={g.key} className="col" style={{ gap: 6 }}>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ font: '600 13px/1.38 var(--font)' }}>{g.label}</span>
                      {g.source?.from === 'memory' && (
                        <span className="tiny" style={{ padding: '1px 6px', borderRadius: 4, background: 'var(--s3)' }}>
                          From memory{g.source.saved ? ` · ${g.source.saved}` : ''}
                        </span>
                      )}
                    </div>
                    <div className="row wrap" style={{ gap: 6 }}>
                      {(g.options ?? []).map((o) => (
                        <button
                          key={o}
                          className={`chip ${turn.answers[g.key] === o ? 'on' : ''}`}
                          style={{ padding: '4px 10px' }}
                          onClick={() => onPick(g.key, o)}
                        >
                          {o}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <label className="row tiny" style={{ gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={turn.remember} onChange={(e) => onRemember(e.target.checked)} />
                  Remember these answers for this place
                </label>
                <Btn variant="primary" style={{ alignSelf: 'flex-start' }} onClick={onContinue}>Continue</Btn>
              </div>
            )}
          </div>
        )}
      </div>

      {/* A refusal or a narrowed scope is the agent's decision, so it is shown as such. */}
      {turn.guard && (
        <div className="col" style={{ padding: 12, borderRadius: 10, background: 'var(--s2)', border: '1px solid var(--hair)', gap: 4 }}>
          <div className="row" style={{ gap: 6 }}>
            <Ms n="shield" size={16} className="muted" />
            <span style={{ font: '600 13px/1.38 var(--font)' }}>
              {turn.guard.scope === 'not_allowed' ? 'This is something the agent will not do' : `Scope: ${turn.guard.scope.replace(/_/g, ' ')}`}
            </span>
          </div>
          {turn.guard.reason && <div className="caption">{turn.guard.reason}</div>}
        </div>
      )}

      {/* A *recoverable* stream error is a notice: the run carries on after it. A fatal one is
          followed by done{status: "failed"}, and its message becomes the error card's — showing
          the server's own explanation instead of a generic "something went wrong". */}
      {turn.streamError?.recoverable && turn.phase !== 'error' && (
        <div className="caption" style={{ padding: 10, borderRadius: 8, background: 'var(--s2)', border: '1px solid var(--hair-soft)' }}>
          {turn.streamError.message}
        </div>
      )}

      {/* Rendered from the turn, not the answer, so each block appears the moment its
          `block_ready` event arrives rather than all at once when the run finishes. The answer
          carries the same objects, so a reloaded run shows exactly the same visuals. */}
      <AnswerBlocks blocks={turn.blocks} onShowOnMap={onShowOnMap} />

      {turn.phase === 'error' && (
        <ErrorState
          error={turn.error}
          message={turn.streamError?.message}
          onRetry={isLast ? onRetry : undefined}
          title="The agent could not answer"
        />
      )}

      {turn.answer && turn.phase !== 'running' && (
        <AnswerCard
          answer={turn.answer}
          question={turn.text}
          placeId={turn.placeId}
          runId={turn.runId}
          onRunSkill={onRunSkill}
          onAskFollowup={isLast ? onAskFollowup : undefined}
        />
      )}
    </div>
  );
}

/* ---------------- skills quick sheet (hotbar from the prototype) ---------------- */

function SkillSheet({ cat, setCat, place, onClose, onRun, onOpen }: { cat: number; setCat: (n: number) => void; place: Place | null; onClose: () => void; onRun: (id: string) => void; onOpen: (id: string) => void }) {
  const { categories, skills, category } = useStore();
  const count = Math.max(1, categories.length);
  const lw = useRef(0);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (/INPUT|TEXTAREA/.test((e.target as HTMLElement).tagName)) return;
      if (e.key === 'Escape') onClose();
      if (/^[1-9]$/.test(e.key) && +e.key - 1 < count) setCat(+e.key - 1);
      if (e.key === 'ArrowRight') setCat((cat + 1) % count);
      if (e.key === 'ArrowLeft') setCat((cat + count - 1) % count);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [cat, setCat, onClose, count]);
  const c = categories[cat];
  const cards = skills.filter((s) => s.categoryKey === c?.key);
  return (
    <>
      <div onClick={onClose} style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 30, animation: 'fadeIn .25s ease both' }} />
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 'min(640px, 78%)', background: '#000', borderTop: '1px solid var(--hair)', borderRadius: '24px 24px 0 0', zIndex: 31, display: 'flex', flexDirection: 'column', animation: 'rise .38s cubic-bezier(.2,.8,.2,1) both' }}>
        <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 10 }}><div style={{ width: 40, height: 4, borderRadius: 4, background: 'var(--hair)' }} /></div>
        <div className="row" style={{ alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, padding: '16px clamp(16px,4vw,48px) 0' }}>
          <div>
            <div className="eyebrow">Skills · {place ? `run on ${place.name}` : 'pick a place to run'}</div>
            <div className="h3" style={{ marginTop: 8, fontSize: 32, letterSpacing: -0.8 }}>Pick a block to start</div>
          </div>
          <div className="row" style={{ gap: 12 }}>
            <span className="caption hide-mobile">Keys 1–9 or scroll to switch</span>
            <Btn size="sm" icon="open_in_new" onClick={() => onOpen('')} className="hide-mobile">Full library</Btn>
            <IconBtn icon="close" onClick={onClose} style={{ background: 'var(--s2)' }} aria-label="Close" />
          </div>
        </div>
        <div style={{ padding: '24px clamp(16px,4vw,48px) 0' }}>
          <div onWheel={(e) => { const now = Date.now(); if (now - lw.current < 120) return; lw.current = now; setCat((cat + ((e.deltaY || e.deltaX) > 0 ? 1 : count - 1)) % count); }} className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap', rowGap: 16, gap: 0 }}>
            <div className="row" style={{ alignItems: 'flex-end', gap: 0, overflowX: 'auto', maxWidth: '100%', paddingBottom: 2 }}>
              {categories.map((k, i) => {
                const sel = i === cat;
                const size = sel ? 84 : 76;
                return (
                  <button key={k.key} onClick={() => setCat(i)} title={k.name} aria-pressed={sel} style={{ position: 'relative', width: size, height: size, marginLeft: -2, flex: 'none', border: `${sel ? 3 : 2}px solid ${sel ? '#fff' : 'var(--hair)'}`, background: sel ? 'var(--s2)' : 'var(--s1)', color: sel ? k.color : 'var(--muted)', zIndex: sel ? 2 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 4, transition: 'all .15s ease', padding: 0 }}>
                    <span style={{ position: 'absolute', left: 6, top: 4, font: '600 11px/1 var(--font)', color: 'var(--subtle)' }}>{i + 1}</span>
                    <Ms n={k.icon} size={30} />
                    <span style={{ position: 'absolute', left: 6, right: 6, bottom: 6, height: 3, borderRadius: 2, background: sel ? k.color : 'transparent' }} />
                  </button>
                );
              })}
            </div>
            {c && (
              <div className="col" style={{ marginLeft: 24, gap: 4, minWidth: 260, flex: 1, paddingBottom: 4 }}>
                <div className="row"><span className="sq" style={{ width: 10, height: 10, background: c.color }} /><span className="subhead">{c.name}</span></div>
                <div className="body-sm">{c.uses}</div>
                <div className="caption">Main free satellites: {c.sats}</div>
              </div>
            )}
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 20, overflowX: 'auto', scrollSnapType: 'x mandatory', padding: '24px clamp(16px,4vw,48px) 32px' }}>
          {cards.map((s) => (
            <div key={s.id} className="card" style={{ flex: 'none', width: 300, display: 'flex', flexDirection: 'column', overflow: 'hidden', scrollSnapAlign: 'start', animation: 'fadeUp .3s ease both' }}>
              <button onClick={() => onOpen(s.id)} style={{ position: 'relative', height: 130, width: '100%', background: '#000', border: 0, padding: 0 }} aria-label={`Open ${s.name}`}>
                <img onError={hideBroken} src={thumb(s.reference?.lat ?? 0, s.reference?.lon ?? 0, 13)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                <span className="eyebrow" style={{ position: 'absolute', left: 10, top: 10, padding: '3px 8px', borderRadius: 4, background: '#000', fontSize: 11, color: 'var(--muted)' }}>Reference</span>
                <span className="pill" style={{ position: 'absolute', right: 10, top: 10 }}>{s.official ? <><Ms n="verified" size={14} style={{ color: 'var(--blue)' }} />Official</> : 'Community'}</span>
              </button>
              <div className="col" style={{ padding: 16, gap: 8, flex: 1 }}>
                <div className="row wrap" style={{ gap: 6 }}><CatPill category={category(s.categoryKey)} /></div>
                <div style={{ font: '600 18px/1.25 var(--font)', letterSpacing: -0.3 }}>{s.name}</div>
                <div className="row caption muted" style={{ gap: 6 }}><Ms n="satellite_alt" size={16} />{s.sat}</div>
                <div className="body-sm">{s.short}</div>
                <div className="row" style={{ marginTop: 'auto', paddingTop: 8, justifyContent: 'space-between' }}>
                  <span className="tiny">by {s.publisherName}</span>
                  <Btn size="sm" variant="primary" icon="play_arrow" onClick={() => onRun(s.id)}>Run</Btn>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
