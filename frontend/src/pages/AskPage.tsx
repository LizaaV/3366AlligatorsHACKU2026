import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
// three.js is ~600 kB and only the landing globe needs it, so it is split out of the main
// bundle and loaded when the globe first renders.
const Globe = lazy(() => import('../components/Globe').then((m) => ({ default: m.Globe })));
import { MapView, type MapLayers } from '../components/MapView';
import { Btn, CatPill, Check, IconBtn, Ms, Tier, hideBroken } from '../components/ui';
import { ErrorState } from '../components/async';
import { api } from '../api';
import { useResource } from '../hooks/useResource';
import type { MapLayer, Place } from '../model';
import { layerIdsFrom, passTimelineFrom, toSearchHits } from '../model';
import { sourceLabel } from '../data/presentation';
import { DEFAULT_CENTER, DEFAULT_ZOOM, circlePts, fmtC, ptsToRing, thumb, type Pt } from '../lib/geo';
import { LANGS } from '../data/i18n';
import { useAskRun, type AskTurn } from '../ask/useAskRun';
import { AnswerCard } from './AnswerCard';
import { AnswerBlocks } from '../components/blocks';

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
  const { places, skills, askPlaceId, setAskPlace, route, go, open, notify, t, lang, watches, addPlace, category, mapLayers: catalogLayers } = store;
  const { W, H: winH } = useViewport();
  const navH = W <= 760 ? 52 : 56;
  const mobile = W <= 760;
  const H = winH - navH - (mobile ? 64 : 0);
  const compact = W < 1280;
  const chatW = mobile ? W - 32 : compact ? 360 : 420;

  const place = places.find((p) => p.id === askPlaceId) || null;

  const [mode, setMode] = useState<'globe' | 'map'>('globe');
  const [center, setCenter] = useState({ lat: place?.lat ?? DEFAULT_CENTER.lat, lon: place?.lon ?? DEFAULT_CENTER.lon });
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [layers, setLayers] = useState<MapLayer[]>([]);
  const [dateIdx, setDateIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [q, setQ] = useState('');
  const [pop, setPop] = useState<string | null>(null);
  const [panel, setPanel] = useState<'layers' | null>(null);
  const [searchQ, setSearchQ] = useState('');
  const [coord, setCoord] = useState({ lat: String(DEFAULT_CENTER.lat), lon: String(DEFAULT_CENTER.lon) });
  const [drawing, setDrawing] = useState(false);
  const [drawPts, setDrawPts] = useState<Pt[]>([]);
  const [pass, setPass] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [cat, setCat] = useState(0);
  const [placeOpen, setPlaceOpen] = useState(!mobile);
  const playT = useRef<number | undefined>(undefined);
  const thread = useRef<HTMLDivElement>(null);

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

  // Selecting a place (from Places page, selector or URL) shows it on the map; "no place" returns to the globe.
  const lastPlace = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (lastPlace.current === askPlaceId) return;
    const first = lastPlace.current === undefined;
    lastPlace.current = askPlaceId;
    if (first && !route.query.place) return; // landing stays on the globe
    if (place) flyTo(place);
    else setMode('globe');
  }, [askPlaceId, place, flyTo, route.query.place]);

  useEffect(() => () => window.clearInterval(playT.current), []);

  /* ---------------- agent run ---------------- */

  // The conversation and the stream live in the hook. This page only reacts to the coarse
  // `stage` to drive the map, and reads the blocks the run produced.
  const run = useAskRun({ lang, selectedPlaceId: askPlaceId });
  const { turns, last, stage, submit: ask } = run;
  // The contract streams a `timeline` block rather than a `timeline` field on the answer.
  const timeline = useMemo(() => (last ? passTimelineFrom(last.blocks) : null), [last]);

  const setLayersOn = useCallback(
    (ids: string[]) => setLayers((ls) => ls.map((l) => (ids.includes(l.id) ? { ...l, ready: true, on: true } : l))),
    [],
  );

  /**
   * Clicking a point on a timeline block moves the map's pass cursor to that scene.
   *
   * This is the `{"time": "cursor"}` link from §6: the block addresses the cursor by scene id,
   * which is the only identifier both sides share — an index would mean nothing to the block.
   */
  const pickScene = useCallback(
    (scene: string) => {
      const i = timeline?.scenes.indexOf(scene) ?? -1;
      if (i >= 0) setDateIdx(i);
    },
    [timeline],
  );

  /**
   * Map choreography, keyed on a coarse stage rather than a step index — runs vary in how
   * many steps they take, so an index would mean nothing across two runs.
   */
  useEffect(() => {
    if (stage === 'idle') return;
    if (stage === 'starting') {
      setLayers((ls) => ls.map((l) => (l.isAgentMade ? { ...l, ready: false, on: false } : l)));
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
      setLayersOn(['ndvi']);
      return;
    }
    if (stage === 'done') {
      setPass(null);
      const ids = last ? layerIdsFrom(last.blocks) : [];
      if (ids.length) setLayersOn(ids);
      setDateIdx(Math.max(0, (timeline?.dates.length ?? 1) - 1));
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
  }, [turns, last?.steps.length]);

  const submit = () => {
    const text = q.trim();
    if (!text) return;
    setQ('');
    setPop(null);
    setSheet(false);
    setPlaceOpen(false);
    ask(text);
  };

  const runSkill = useCallback(
    (skillId: string, placeId?: string | null) => {
      const skill = skills.find((x) => x.id === skillId);
      if (!skill) return;
      const pid = placeId !== undefined ? placeId : askPlaceId;
      if (!pid) {
        setSheet(false);
        setPop('place');
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

  // Deep link from the library: #/ask?place=np&skill=weekly-crop-health runs it on that place.
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

  const togglePlay = () => {
    const lastIdx = (timeline?.dates.length ?? 1) - 1;
    if (playing) { window.clearInterval(playT.current); setPlaying(false); return; }
    setPlaying(true);
    setDateIdx((d) => (d >= lastIdx ? 0 : d));
    playT.current = window.setInterval(() => {
      setDateIdx((d) => {
        if (d >= lastIdx) { window.clearInterval(playT.current); setPlaying(false); return d; }
        return d + 1;
      });
    }, 850);
  };

  /** Save a drawn or generated outline. Geometry goes up as GeoJSON; area comes back from the server. */
  const savePlace = async (name: string, pts: Pt[], isCircle: boolean, source: 'drawn' | 'pin') => {
    try {
      const created = await addPlace({
        name,
        categoryKey: 'agriculture',
        center,
        geometry: { type: 'Polygon', coordinates: [ptsToRing(pts, center)] },
        isCircle,
        project: 'My Farm',
        tags: [],
        source,
        details: [{ label: 'Added via', value: sourceLabel(source) }],
      });
      setAskPlace(created.id);
      // The area shown is the server's, not the provisional figure used while drawing.
      notify(`${created.name} saved \u00b7 ${created.areaHa} ha`, 'Rename', () => go('places'), 'check_circle');
      return created;
    } catch {
      notify('Could not save the place', undefined, undefined, 'error');
      return null;
    }
  };

  const finishDraw = async () => {
    if (drawPts.length < 3) return notify('Add at least 3 points', undefined, undefined, 'info');
    const sc = Math.pow(2, zoom - 16);
    const pts = drawPts.map((p) => [+((p[0] - cx) / sc).toFixed(1), +((p[1] - navH - cy) / sc).toFixed(1)] as Pt);
    setDrawing(false);
    setDrawPts([]);
    await savePlace(`Field ${places.length + 1}`, pts, false, 'drawn');
  };

  const addCircle = async () => {
    setPop(null);
    await savePlace(`Circle ${places.length + 1}`, circlePts(150, 48), true, 'pin');
  };

  const toolClick = (k: string) => {
    if (['draw', 'contours', 'coords', 'ref'].includes(k)) return setPop((p) => (p === k ? null : k));
    if (k === 'layers') { setPop(null); return setPanel((p) => (p === 'layers' ? null : 'layers')); }
    if (k === 'undo') return drawing && drawPts.length ? setDrawPts((d) => d.slice(0, -1)) : notify('Nothing to undo', undefined, undefined, 'info');
    if (k === 'redo') return notify('Nothing to redo', undefined, undefined, 'info');
    if (k === 'pin') { setPop(null); return notify('Placemark added at map centre', 'Save as place', () => open({ kind: 'addPlace' }), 'location_on'); }
    if (k === 'measure') { setPop(null); return notify(place ? `${place.name} is ${Math.round(Math.sqrt((place.areaHa * 10000) / Math.PI) * 2)} m across` : 'Pick a place to measure', undefined, undefined, 'straighten'); }
  };

  /* ---------------- derived ---------------- */

  const on = (id: string) => { const l = layers.find((x) => x.id === id); return !!(l && l.on && l.ready); };
  const mapLayers: MapLayers = { contour: on('contour'), ndmi: on('ndmi'), ndvi: on('ndvi'), lst: on('lst'), dry: on('dry'), clouds: on('clouds') };
  const isMap = mode === 'map';
  const showHero = !isMap && !turns.length && !sheet && H >= 640 && !mobile;
  const cloudy = timeline?.cloudyIndices.includes(dateIdx) ?? false;
  const placeWatches = place ? watches.filter((w) => w.placeId === place.id) : [];
  const L = LANGS.find((l) => l.code === lang)!;

  const suggestions = place
    ? [
        { icon: 'water_drop', text: 'Where are the dry patches in my field?', go: () => ask('Where are the dry patches in my field?') },
        { icon: 'eco', text: `How healthy is ${place.name} this week?`, go: () => runSkill('weekly-crop-health') },
        { icon: 'local_fire_department', text: 'Any fires within 10 km of this place?', go: () => runSkill('active-fire-map') },
      ]
    : [
        { icon: 'satellite_alt', text: 'Which free satellite is best for crop health?', go: () => ask('Which free satellite is best for crop health?') },
        { icon: 'flood', text: 'How can I map a flood through clouds?', go: () => ask('How can I map a flood through clouds?') },
        { icon: 'pentagon', text: 'Pick one of my places to ask about it', go: () => setPop('place') },
      ];

  const sq = searchQ.trim().toLowerCase();

  // Geocoder results come from the API; the user's own places are matched locally since they
  // are already loaded.
  const geo = useResource(
    useCallback((signal) => api.areas.resolve({ query: sq }, signal).then(toSearchHits), [sq]),
    [sq],
  );

  const searchResults = useMemo(
    () => [
      ...places
        .filter((p) => !sq || `${p.name} ${p.project}`.toLowerCase().includes(sq))
        .map((p) => ({
          key: `place:${p.id}`,
          n: p.name,
          d: `My place \u00b7 ${p.project}`,
          icon: 'pentagon',
          go: () => { setAskPlace(p.id); flyTo(p); setPop(null); setSearchQ(''); },
        })),
      ...(geo.data ?? []).map((r) => ({
        key: `geo:${r.name}`,
        n: r.name,
        d: r.description,
        icon: 'location_on',
        go: () => {
          setMode('map');
          setCenter({ lat: r.lat, lon: r.lon });
          setZoom(r.zoom);
          setPop(null);
          setSearchQ('');
          notify(`${r.name} \u2014 not saved yet`, 'Save as place', () => open({ kind: 'addPlace' }), 'location_on');
        },
      })),
    ],
    [places, sq, geo.data, setAskPlace, flyTo, notify, open],
  );

  const tools = [
    ...(compact ? [] : [{ k: 'undo', icon: 'undo', title: 'Undo' }, { k: 'redo', icon: 'redo', title: 'Redo' }, { k: '|' }]),
    { k: 'coords', icon: 'my_location', title: 'Search by coordinates' },
    { k: 'pin', icon: 'location_on', title: 'Add placemark' },
    { k: 'draw', icon: 'polyline', title: 'Draw a contour', caret: true },
    { k: 'contours', icon: 'pentagon', title: 'My places', caret: true },
    { k: '|' },
    { k: 'measure', icon: 'straighten', title: 'Measure distance' },
    { k: 'ref', icon: 'image', title: 'Reference image' },
    { k: 'layers', icon: 'layers', title: 'Layers' },
  ];

  return (
    <div style={{ position: 'fixed', top: navH, left: 0, right: 0, bottom: mobile ? 64 : 0, overflow: 'hidden', background: '#000', visibility: active ? 'visible' : 'hidden' }} aria-hidden={!active}>
      <Suspense fallback={null}>
        <Globe visible={active && !isMap} offsetRight={!mobile} />
      </Suspense>
      {isMap && <MapView W={W} H={H} cx={cx} cy={cy} center={center} zoom={zoom} place={place} layers={mapLayers} dateIdx={dateIdx} pass={pass} timeline={timeline} />}

      {/* DRAW CAPTURE */}
      {drawing && (
        <>
          <div onClick={(e) => setDrawPts((d) => [...d, [e.clientX, e.clientY]])} style={{ position: 'fixed', inset: 0, top: navH, cursor: 'crosshair', zIndex: 8 }}>
            <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, top: -navH, height: `calc(100% + ${navH}px)` }}>
              <polygon points={drawPts.map((p) => p.join(',')).join(' ')} style={{ fill: 'rgba(255,255,255,.1)', stroke: '#fff', strokeWidth: 2, strokeDasharray: '6 4' }} />
            </svg>
            {drawPts.map((d, i) => (
              <div key={i} style={{ position: 'fixed', left: d[0], top: d[1], width: 10, height: 10, margin: '-7px 0 0 -7px', borderRadius: '50%', background: '#000', border: '2px solid #fff' }} />
            ))}
          </div>
          <div className="panel row" style={{ position: 'absolute', left: 0, right: 0, margin: '0 auto', width: 'max-content', maxWidth: 'calc(100% - 32px)', flexWrap: 'wrap', top: 88, zIndex: 9, gap: 12, padding: '8px 8px 8px 16px' }}>
            <span className="body-sm">Click on the map to add points · <span className="ink">{drawPts.length} points</span></span>
            <Btn size="sm" onClick={() => setDrawPts((d) => d.slice(0, -1))}>Undo point</Btn>
            <Btn size="sm" onClick={() => { setDrawing(false); setDrawPts([]); }}>Cancel</Btn>
            <Btn size="sm" variant="primary" onClick={finishDraw}>Save place</Btn>
          </div>
        </>
      )}

      {/* HERO */}
      {showHero && (
        <div style={{ position: 'absolute', left: 48, bottom: 128, maxWidth: 560, pointerEvents: 'none', animation: 'fadeUp .6s ease both' }}>
          <div className="eyebrow muted" style={{ marginBottom: 16 }}>{t('hero.eyebrow')}</div>
          <div className="display">{t('hero.title')}</div>
          <div className="body-lg" style={{ marginTop: 16, maxWidth: 480 }}>{t('hero.sub')}</div>
          <div className="row wrap" style={{ marginTop: 20, gap: 8, pointerEvents: 'auto' }}>
            <span className="pill" style={{ background: 'var(--s1)' }}><Ms n="translate" size={14} />{LANGS.length} languages</span>
            <button className="pill" style={{ background: 'var(--s1)', border: 0 }} onClick={() => open({ kind: 'connectors', focus: 'whatsapp' })}><Ms n="chat" size={14} />Ask on WhatsApp</button>
            <button className="pill" style={{ background: 'var(--s1)', border: 0 }} onClick={() => open({ kind: 'app' })}><Ms n="smartphone" size={14} />iOS & Android</button>
            <span className="pill" style={{ background: 'var(--s1)' }}><span className="dot" style={{ background: 'var(--green)' }} />Free satellites first</span>
          </div>
        </div>
      )}

      {/* LEFT COLUMN: chat on top, place detail at the bottom */}
      <div style={{ position: 'absolute', left: mobile ? 16 : 20, top: mobile ? 12 : 20, bottom: mobile ? 12 : 24, width: chatW, display: 'flex', flexDirection: 'column', gap: 12, zIndex: 20, pointerEvents: 'none' }}>
        <div className="panel" style={{ flex: '0 1 auto', minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'visible', pointerEvents: 'auto' }}>
          {/* place selector — selected place sits at the top of the chat */}
          <div className="row" style={{ padding: '8px 8px 0 14px', gap: 8, position: 'relative' }}>
            <span className="eyebrow">{t('chat.place')}</span>
            <button onClick={() => setPop((p) => (p === 'place' ? null : 'place'))} className="row" style={{ gap: 6, padding: '4px 8px 4px 10px', borderRadius: 9999, background: place ? 'var(--s2)' : 'transparent', border: `1px ${place ? 'solid' : 'dashed'} var(--hair)`, font: '600 13px/1.38 var(--font)', minWidth: 0, maxWidth: '100%' }} aria-haspopup="menu" aria-expanded={pop === 'place'}>
              {place ? <span className="dot" style={{ background: category(place.categoryKey).color }} /> : <Ms n="public" size={14} className="muted" />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{place ? place.name : t('chat.noPlace')}</span>
              {place && <span className="tiny">{place.areaHa} ha</span>}
              <Ms n="arrow_drop_down" size={18} className="muted" />
            </button>
            <button className="pill" onClick={() => open({ kind: 'lang' })} title="Answer language" style={{ marginLeft: 'auto', border: 0, background: 'transparent' }}>
              <Ms n="translate" size={14} />{L.code.toUpperCase()}
            </button>
            {pop === 'place' && (
              <div className="menu" role="menu" style={{ left: 8, top: 40, width: Math.min(320, chatW - 16) }}>
                <div className="menu-label eyebrow">Ask about</div>
                <button className={`menu-item ${!place ? 'on' : ''}`} onClick={() => { setAskPlace(null); setPop(null); }}>
                  <Ms n="public" /><span className="col grow"><span>No place</span><span className="tiny">General question — not tied to a place</span></span>
                  {!place && <Ms n="check" size={18} />}
                </button>
                <div className="divider" style={{ margin: '6px 4px' }} />
                {places.map((p) => (
                  <button key={p.id} className={`menu-item ${p.id === askPlaceId ? 'on' : ''}`} onClick={() => { setAskPlace(p.id); setPop(null); }}>
                    <span className="dot" style={{ background: category(p.categoryKey).color, width: 8, height: 8 }} />
                    <span className="col grow"><span>{p.name}</span><span className="tiny">{p.project} · {p.areaHa} ha</span></span>
                    {p.id === askPlaceId && <Ms n="check" size={18} />}
                  </button>
                ))}
                <div className="divider" style={{ margin: '6px 4px' }} />
                <button className="menu-item" onClick={() => { setPop(null); open({ kind: 'addPlace' }); }}><Ms n="add_location_alt" />{t('cta.addPlace')}<Tier tier="free" /></button>
              </div>
            )}
          </div>
          <div className="row" style={{ gap: 12, padding: '8px 8px 8px 14px', flex: 'none' }}>
            <div style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid #fff', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><div style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff' }} /></div>
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} placeholder={place ? `Ask about ${place.name}…` : t('chat.placeholder')} aria-label="Ask a question" style={{ flex: 1, minWidth: 0, height: 36, background: 'transparent', border: 0, outline: 0, color: '#fff', font: '500 15px/1.5 var(--font)' }} />
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
                  onPickScene={pickScene}
                />
              ))}
              {last?.phase === 'done' && (
                <button className="btn btn-text btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => { run.reset(); setLayers(catalogLayers); }}>
                  <Ms n="add_comment" />New chat
                </button>
              )}
            </div>
          )}
        </div>

        {/* PLACE DETAIL — pinned at the bottom of the ask page */}
        {place && isMap && !drawing && (
          <div className="panel fade-up" style={{ flex: 'none', pointerEvents: 'auto', overflow: 'hidden' }}>
            <button onClick={() => setPlaceOpen((o) => !o)} className="row" style={{ width: '100%', gap: 12, padding: 10, background: 'transparent', border: 0, textAlign: 'left' }} aria-expanded={placeOpen}>
              <div style={{ width: 44, height: 44, borderRadius: 8, flex: 'none', background: `#000 url(${thumb(place.lat, place.lon, Math.min(place.zoom, 16))}) center/cover`, border: '1px solid var(--hair-soft)' }} />
              <div className="col grow">
                <span className="ink" style={{ font: '600 15px/1.35 var(--font)' }}>{place.name}</span>
                <span className="tiny">{place.project} · {place.areaHa} ha · {fmtC(place.lat, place.lon)}</span>
              </div>
              <Ms n={placeOpen ? 'expand_more' : 'expand_less'} size={20} className="muted" />
            </button>
            {placeOpen && (
              <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="stats" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  {place.details.slice(0, 4).map((d) => (
                    <div key={d.label}><div className="l">{d.label}</div><div className="v" style={{ fontSize: 14 }}>{d.value}</div></div>
                  ))}
                </div>
                <div className="col" style={{ gap: 6 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="eyebrow">Watches here · {placeWatches.length}</span>
                    <button className="btn btn-text btn-sm" onClick={() => open({ kind: 'watchBuilder', placeId: place.id })}><Ms n="add" />Add watch<Tier tier="free" /></button>
                  </div>
                  {placeWatches.slice(0, 3).map((w) => (
                    <button key={w.id} onClick={() => go('triggers', w.id)} className="row" style={{ gap: 8, padding: '6px 8px', borderRadius: 8, background: 'var(--s2)', border: 0, textAlign: 'left' }}>
                      <span className="dot" style={{ background: w.status === 'ok' ? 'var(--green)' : w.status === 'warn' ? 'var(--yellow)' : 'var(--red)' }} />
                      <span className="grow" style={{ font: '500 13px/1.38 var(--font)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span>
                      <span className="tiny ink">{w.value}{w.unit ? ' ' + w.unit : ''}</span>
                    </button>
                  ))}
                  {!placeWatches.length && <span className="caption">Nothing is being watched here yet.</span>}
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
              <input value={searchQ} onChange={(e) => { setSearchQ(e.target.value); setPop('search'); }} onFocus={() => setPop('search')} onKeyDown={(e) => e.key === 'Enter' && searchResults[0]?.go()} placeholder="Search a place or field" aria-label="Search a place" style={{ flex: 1, minWidth: 0, background: 'transparent', border: 0, outline: 0, color: '#fff', font: '500 14px/1.5 var(--font)' }} />
            </div>
            {pop === 'search' && (
              <div className="menu" style={{ left: -8, top: 52, width: 320, maxHeight: 420, overflowY: 'auto' }}>
                <div className="menu-label eyebrow">Places</div>
                {searchResults.map((r) => (
                  <button key={r.key} className="menu-item" onClick={r.go}>
                    <Ms n={r.icon} />
                    <span className="col"><span style={{ font: '600 14px/1.4 var(--font)' }}>{r.n}</span><span className="tiny">{r.d}</span></span>
                  </button>
                ))}
                {!searchResults.length && <div className="caption" style={{ padding: 10 }}>No matches. Try coordinates instead.</div>}
              </div>
            )}
          </div>
          {tools.map((tl, i) =>
            tl.k === '|' ? <div key={i} style={{ width: 1, height: 26, background: 'var(--hair)', margin: '0 6px' }} /> : (
              <div key={tl.k} style={{ position: 'relative' }}>
                <button onClick={() => toolClick(tl.k)} title={tl.title} aria-label={tl.title} style={{ height: 40, minWidth: 40, padding: `0 ${tl.caret ? 4 : 0}px`, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, border: 0, background: pop === tl.k || (tl.k === 'layers' && panel === 'layers') || (tl.k === 'draw' && drawing) ? 'var(--s3)' : 'transparent' }}>
                  <Ms n={tl.icon!} size={22} />
                  {tl.caret && <Ms n="arrow_drop_down" size={18} className="muted" />}
                </button>
                {pop === 'draw' && tl.k === 'draw' && (
                  <div className="menu" style={{ left: -40, top: 52, width: 290 }}>
                    <div className="menu-label eyebrow">Add line or shape</div>
                    <button className="menu-item on" onClick={() => { const c = place; setPop(null); setDrawing(true); setDrawPts([]); setMode('map'); if (c) { setCenter({ lat: c.lat, lon: c.lon }); setZoom(16); } }}><Ms n="polyline" />Path or polygon</button>
                    <button className="menu-item" onClick={addCircle}><Ms n="radio_button_unchecked" />Circle<span style={{ marginLeft: 'auto', padding: '2px 8px', borderRadius: 9999, background: '#fff', color: '#000', font: '600 12px/1.38 var(--font)' }}>New</span></button>
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
                {pop === 'coords' && tl.k === 'coords' && (
                  <div className="menu col" style={{ left: -40, top: 52, width: 280, padding: 16, gap: 10 }}>
                    <div className="eyebrow">Go to coordinates</div>
                    <label className="field">Latitude<input className="input" value={coord.lat} onChange={(e) => setCoord({ ...coord, lat: e.target.value })} /></label>
                    <label className="field">Longitude<input className="input" value={coord.lon} onChange={(e) => setCoord({ ...coord, lon: e.target.value })} /></label>
                    <Btn variant="primary" onClick={() => { const la = parseFloat(coord.lat), lo = parseFloat(coord.lon); if (isNaN(la) || isNaN(lo) || Math.abs(la) > 85 || Math.abs(lo) > 180) return notify('Enter a valid latitude and longitude', undefined, undefined, 'error'); setMode('map'); setCenter({ lat: la, lon: lo }); setZoom(15); setPop(null); }}>Fly there</Btn>
                  </div>
                )}
                {pop === 'ref' && tl.k === 'ref' && (
                  <div className="menu col" style={{ right: -60, top: 52, width: 300, padding: 12, gap: 10 }}>
                    <div className="row" style={{ justifyContent: 'space-between' }}><span className="eyebrow">Reference image</span><span className="tiny muted">Basemap · 2020 · 10 m</span></div>
                    <img onError={hideBroken} src={thumb(center.lat, center.lon, Math.min(17, zoom))} alt="" style={{ width: '100%', aspectRatio: '1', borderRadius: 8, display: 'block', background: '#000', objectFit: 'cover' }} />
                    <div className="caption muted">{place?.name ?? 'Map centre'} · {fmtC(center.lat, center.lon)}</div>
                  </div>
                )}
              </div>
            ),
          )}
        </div>
      )}

      {/* LAYERS PANEL */}
      {panel === 'layers' && (
        <div className="panel fade-up" style={{ position: 'absolute', right: mobile ? 16 : 20, left: mobile ? 16 : 'auto', top: mobile ? 12 : 90, width: mobile ? 'auto' : 340, maxHeight: 'calc(100% - 200px)', overflowY: 'auto', zIndex: 25 }}>
          <div className="row" style={{ alignItems: 'flex-start', justifyContent: 'space-between', padding: '20px 20px 12px' }}>
            <div><div className="eyebrow">Layers</div><div className="subhead" style={{ marginTop: 6 }}>{place?.name ?? 'No place selected'}</div></div>
            <IconBtn icon="close" className="sm" onClick={() => setPanel(null)} aria-label="Close layers" />
          </div>
          {!layers.some((l) => l.isAgentMade && l.ready) && <div className="sunk body-sm" style={{ margin: '0 20px 12px', padding: 12, fontSize: 13 }}>Layers made by the agent appear here after you ask a question about this place.</div>}
          <div className="col" style={{ padding: '0 8px 12px' }}>
            {layers.map((l) => (
              <button key={l.id} className="menu-item" style={{ opacity: l.ready ? 1 : 0.4, gap: 12 }} onClick={() => (l.ready ? setLayers((ls) => ls.map((x) => (x.id === l.id ? { ...x, on: !x.on } : x))) : notify('Ask the agent about this place to generate this layer', undefined, undefined, 'info'))}>
                <Check on={l.on && l.ready} />
                <span className="sq" style={{ width: 10, height: 10, background: l.color }} />
                <span className="col grow"><span style={{ font: '600 14px/1.4 var(--font)' }}>{l.name}</span><span className="tiny">{l.source}</span></span>
                {l.isAgentMade && <span className="badge-ai">AI</span>}
              </button>
            ))}
          </div>
          <div className="caption" style={{ borderTop: '1px solid var(--hair-soft)', padding: '14px 20px 18px' }}>Use the timeline at the bottom to step through each satellite pass.</div>
        </div>
      )}

      {/* TIMELINE */}
      {isMap && place && timeline && timeline.dates.length > 0 && !sheet && !mobile && (
        <div className="panel fade-up row" style={{ position: 'absolute', left: chatW + 40, right: 20, margin: '0 auto', bottom: 92, width: 600, maxWidth: `calc(100% - ${chatW + 120}px)`, padding: '12px 16px', gap: 14, zIndex: 15 }}>
          <button onClick={togglePlay} title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause' : 'Play'} style={{ width: 38, height: 38, flex: 'none', borderRadius: 8, background: '#fff', color: '#000', border: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ms n={playing ? 'pause' : 'play_arrow'} size={22} /></button>
          <div className="col grow" style={{ gap: 4 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ font: '600 14px/1.4 var(--font)' }}>{timeline.dates[dateIdx]}</span>
              <span className="tiny">{cloudy ? `Pass ${dateIdx + 1} of ${timeline.dates.length} · cloudy, skipped` : `Pass ${dateIdx + 1} of ${timeline.dates.length}`}</span>
            </div>
            <input type="range" min={0} max={Math.max(0, timeline.dates.length - 1)} step={1} value={dateIdx} onChange={(e) => setDateIdx(+e.target.value)} aria-label="Satellite pass date" style={{ width: '100%', margin: '2px 0' }} />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              {timeline.dates.map((d, i) => (
                <button key={d} onClick={() => setDateIdx(i)} style={{ background: 'transparent', border: 0, padding: 0, font: '500 11px/1.38 var(--font)', color: i === dateIdx ? '#fff' : 'var(--subtle)', display: 'flex', alignItems: 'center', gap: 2 }}>
                  {d}{timeline.cloudyIndices.includes(i) && <Ms n="cloud" size={12} />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* DOCK */}
      <div className="panel row" style={{ position: 'absolute', left: mobile ? 'auto' : chatW + 40, right: mobile ? 16 : 20, margin: mobile ? 0 : '0 auto', width: 'max-content', bottom: mobile ? 'auto' : 24, top: mobile ? 12 : 'auto', gap: 6, padding: 6, zIndex: 16, display: mobile && (turns.length > 0 || pop) ? 'none' : 'flex' }}>
        <Btn variant="primary" icon="auto_stories" onClick={() => { setSheet(true); setPop(null); setPanel(null); }}>{mobile ? '' : 'Skills'}</Btn>
        <Btn icon="layers" onClick={() => { setPop(null); setPanel((p) => (p === 'layers' ? null : 'layers')); }} style={{ background: panel === 'layers' ? 'var(--s3)' : undefined }}>{mobile ? '' : 'Layers'}</Btn>
        {!mobile && (
          <Btn icon="visibility" onClick={() => go('triggers')}>
            Watches<span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9999, background: '#fff', color: '#000', font: '600 11px/18px var(--font)', textAlign: 'center' }}>{watches.filter((w) => w.enabled).length}</span>
          </Btn>
        )}
        {isMap && !mobile && <IconBtn icon="public" title="Back to globe" aria-label="Back to globe" onClick={() => { setMode('globe'); setPlaying(false); setDrawing(false); }} />}
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
  onPickScene,
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
  /** Move the map's pass cursor to the scene a timeline point names. */
  onPickScene: (scene: string) => void;
}) {
  const place = places.find((x) => x.id === turn.placeId);
  const steps = turn.steps;
  // The step the server is on: the first one that has started but not finished.
  const current = steps.find((s) => !s.done) ?? steps[steps.length - 1];

  const label =
    turn.phase === 'clarify'
      ? 'Waiting for your answers'
      : turn.phase === 'error'
        ? 'Could not complete this'
        : turn.phase === 'running'
          ? `${current?.tool ?? 'Working'}…`
          : `Analyzed in ${steps.length} steps · ${((turn.durationMs ?? 0) / 1000).toFixed(1)}s`;

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
            {steps.map((st) => {
              const active = turn.phase === 'running' && !st.done;
              return (
                <div key={st.index} className="row" style={{ gap: 10, alignItems: 'stretch', animation: 'fadeUp .35s ease both' }}>
                  <div className="col" style={{ alignItems: 'center', width: 18, flex: 'none' }}>
                    {active && <span className="spinner" style={{ marginTop: 4 }} />}
                    {st.done && (
                      <Ms
                        n={st.error ? 'error_outline' : 'check_circle'}
                        size={18}
                        className="muted"
                        style={{ marginTop: 2, color: st.error ? 'var(--amber, currentColor)' : undefined }}
                      />
                    )}
                    <div style={{ flex: 1, width: 1, background: 'var(--hair)', margin: '4px 0', minHeight: 10 }} />
                  </div>
                  <div className="grow" style={{ paddingBottom: 12 }}>
                    {active ? (
                      <div className="shimmer-text" style={{ font: '600 14px/1.5 var(--font)' }}>{st.tool}</div>
                    ) : (
                      <div style={{ font: '600 14px/1.5 var(--font)' }}>{st.tool}</div>
                    )}
                    <div className="caption" style={{ marginTop: 2 }}>
                      <span className="muted">{st.title}:</span> {st.desc}
                    </div>
                    {st.done && st.result && <div className="tag" style={{ marginTop: 6 }}>{st.result}</div>}
                    {st.error && <div className="caption" style={{ marginTop: 6, color: 'var(--subtle)' }}>{st.error}</div>}
                  </div>
                </div>
              );
            })}

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
                <Btn variant="primary" style={{ alignSelf: 'flex-start' }} onClick={onContinue} tier="free">Continue</Btn>
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
      <AnswerBlocks blocks={turn.blocks} onPickScene={onPickScene} />

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
                <div className="row wrap" style={{ gap: 6 }}><CatPill category={category(s.categoryKey)} /><span className="pill">{s.cost}</span></div>
                <div style={{ font: '600 18px/1.25 var(--font)', letterSpacing: -0.3 }}>{s.name}</div>
                <div className="row caption muted" style={{ gap: 6 }}><Ms n="satellite_alt" size={16} />{s.sat}</div>
                <div className="body-sm">{s.short}</div>
                <div className="row" style={{ marginTop: 'auto', paddingTop: 8, justifyContent: 'space-between' }}>
                  <span className="tiny">by {s.publisherName}</span>
                  <Btn size="sm" variant="primary" icon="play_arrow" tier={s.tier} tierLabel={s.tier === 'paid' ? s.cost : undefined} onClick={() => onRun(s.id)}>Run</Btn>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
