import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { Globe } from '../components/Globe';
import { MapView, type MapLayers } from '../components/MapView';
import { Btn, CatPill, Check, IconBtn, Ms, Tier, hideBroken } from '../components/ui';
import { CATS, SKILLS, skillById } from '../data/catalog';
import { CLAR, CLOUDY, DATES, DRY_STEPS, GENERAL_STEPS, LAYERS, dryAnswer, generalAnswer, presetSteps, skillAnswer, type Answer, type LayerDef, type Step } from '../data/agent';
import { PLACE_RESULTS, SOURCE_LABEL, type Place } from '../data/places';
import { areaHa, circlePts, fmtC, thumb, type Pt } from '../data/geo';
import { LANGS } from '../data/i18n';
import { AnswerCard } from './AnswerCard';

interface Turn {
  id: number;
  text: string;
  placeId: string | null;
  mode: 'dry' | 'skill' | 'general';
  skillId?: string;
  steps: Step[];
  idx: number;
  phase: 'clarify' | 'running' | 'done';
  open: boolean;
  t0: number;
  secs?: string;
  ans: Record<string, string>;
  answer?: Answer;
}

const STEP_MS = 950;

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
  const { places, askPlaceId, setAskPlace, route, go, open, notify, t, lang, watches, addPlace } = store;
  const { W, H: winH } = useViewport();
  const navH = W <= 760 ? 52 : 56;
  const mobile = W <= 760;
  const H = winH - navH - (mobile ? 64 : 0);
  const compact = W < 1280;
  const chatW = mobile ? W - 32 : compact ? 360 : 420;

  const place = places.find((p) => p.id === askPlaceId) || null;

  const [mode, setMode] = useState<'globe' | 'map'>('globe');
  const [center, setCenter] = useState({ lat: place?.lat ?? 37.9785, lon: place?.lon ?? -100.9155 });
  const [zoom, setZoom] = useState(16);
  const [layers, setLayers] = useState<LayerDef[]>(LAYERS);
  const [dateIdx, setDateIdx] = useState(7);
  const [playing, setPlaying] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [q, setQ] = useState('');
  const [pop, setPop] = useState<string | null>(null);
  const [panel, setPanel] = useState<'layers' | null>(null);
  const [searchQ, setSearchQ] = useState('');
  const [coord, setCoord] = useState({ lat: '37.9785', lon: '-100.9155' });
  const [drawing, setDrawing] = useState(false);
  const [drawPts, setDrawPts] = useState<Pt[]>([]);
  const [pass, setPass] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [cat, setCat] = useState(0);
  const [placeOpen, setPlaceOpen] = useState(!mobile);
  const timer = useRef<number>();
  const playT = useRef<number>();
  const thread = useRef<HTMLDivElement>(null);

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

  useEffect(() => () => { clearTimeout(timer.current); clearInterval(playT.current); }, []);

  useEffect(() => { const el = thread.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); }, [turns]);

  /* ---------------- agent run ---------------- */

  const advance = useCallback(() => {
    timer.current = window.setTimeout(() => {
      setTurns((all) => {
        const run = all[all.length - 1];
        if (!run || run.phase !== 'running') return all;
        const next = run.idx + 1;
        const p = places.find((x) => x.id === run.placeId) || null;
        const steps = run.steps.slice();
        if (run.mode !== 'general') {
          if (next === 1 && p) flyTo(p);
          if (next === 2 && p) steps[1] = { ...steps[1], result: `Using “${p.name}” · ${areaHa(p.pts, p.lat)} ha` };
          if (next === 3) setPass(run.mode === 'dry' ? 'Sentinel-2B' : (skillById(run.skillId!)?.sat.split(' · ')[0] ?? 'Sentinel-2'));
          if (next === 5) setPass(null);
          const setL = (ids: string[]) => setLayers((ls) => ls.map((l) => (ids.includes(l.id) ? { ...l, ready: true, on: true } : l)));
          if (next === 7) setL(run.mode === 'dry' ? ['ndmi'] : ['ndvi']);
          if (next === 9 && run.mode === 'dry') setL(['dry']);
        }
        if (next >= run.steps.length) {
          if (run.mode !== 'general') {
            setLayers((ls) => ls.map((l) => ({ ...l, ready: true, on: l.on || (run.mode === 'dry' && l.id === 'dry') })));
            setDateIdx(7);
          }
          const answer = run.mode === 'general' ? generalAnswer(run.text) : run.mode === 'dry' ? dryAnswer(p!, run.ans) : skillAnswer(p!, skillById(run.skillId!)!);
          const done: Turn = { ...run, steps, phase: 'done', open: false, secs: ((Date.now() - run.t0) / 1000).toFixed(1), answer };
          return [...all.slice(0, -1), done];
        }
        advance();
        return [...all.slice(0, -1), { ...run, steps, idx: next }];
      });
    }, STEP_MS);
  }, [places, flyTo]);

  const startRun = useCallback((text: string, opts: { skillId?: string; placeId?: string | null } = {}) => {
    clearTimeout(timer.current);
    const pid = opts.placeId !== undefined ? opts.placeId : askPlaceId;
    const p = places.find((x) => x.id === pid) || null;
    const low = text.toLowerCase();
    let m: Turn['mode'] = 'general';
    let skillId = opts.skillId;
    if (p) {
      if (skillId && skillId !== 'dry-patch-finder') m = 'skill';
      else if (skillId === 'dry-patch-finder' || /dry|water stress|irrigat|drought/.test(low)) m = 'dry';
      else {
        const match = SKILLS.find((s) => low.includes(s.name.toLowerCase().split(' ')[0].replace(/[^a-z]/g, '')) && s.name.length > 3);
        skillId = (match ?? SKILLS.find((s) => s.cat === p.cat) ?? SKILLS[1]).id;
        m = skillId === 'dry-patch-finder' ? 'dry' : 'skill';
      }
    }
    const steps = (m === 'dry' ? DRY_STEPS : m === 'skill' ? presetSteps(skillById(skillId!)!) : GENERAL_STEPS).map((s) => ({ ...s }));
    if (m !== 'general') setLayers((ls) => ls.map((l) => (l.ai ? { ...l, ready: false, on: false } : l)));
    setQ('');
    setPop(null);
    setSheet(false);
    setPlaceOpen(false);
    setTurns((all) => [
      ...all.map((x) => ({ ...x, open: false })),
      { id: Date.now(), text, placeId: p?.id ?? null, mode: m, skillId, steps, idx: 0, phase: m === 'dry' ? 'clarify' : 'running', open: true, t0: Date.now(), ans: { crop: 'Maize', water: 'Center pivot', when: '1–2 weeks ago' } },
    ]);
    if (m !== 'dry') advance();
  }, [askPlaceId, places, advance]);

  // Deep link from the Library: #/ask?place=np&skill=weekly-crop-health runs the skill on that place.
  useEffect(() => {
    const sk = route.query.skill;
    if (route.page !== 'ask' || !sk) return;
    const s = skillById(sk);
    const pid = route.query.place && route.query.place !== 'none' ? route.query.place : askPlaceId;
    const p = places.find((x) => x.id === pid);
    if (s && p) {
      setAskPlace(p.id);
      startRun(`Run “${s.name}” on ${p.name}`, { skillId: s.id, placeId: p.id });
    }
    window.history.replaceState(null, '', `#/ask?place=${pid ?? 'none'}`);
  }, [route]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = () => {
    const text = q.trim();
    if (!text) return;
    startRun(text);
  };

  const continueRun = () => {
    setTurns((all) => [...all.slice(0, -1), { ...all[all.length - 1], phase: 'running' }]);
    advance();
  };

  /* ---------------- map tools ---------------- */

  const togglePlay = () => {
    if (playing) { clearInterval(playT.current); setPlaying(false); return; }
    setPlaying(true);
    setDateIdx((d) => (d >= 7 ? 0 : d));
    playT.current = window.setInterval(() => {
      setDateIdx((d) => {
        if (d >= 7) { clearInterval(playT.current); setPlaying(false); return d; }
        return d + 1;
      });
    }, 850);
  };

  const finishDraw = () => {
    if (drawPts.length < 3) return notify('Add at least 3 points', undefined, undefined, 'info');
    const sc = Math.pow(2, zoom - 16);
    const pts = drawPts.map((p) => [+((p[0] - cx) / sc).toFixed(1), +((p[1] - navH - cy) / sc).toFixed(1)] as Pt);
    const id = 'p' + Date.now();
    const np: Place = { id, name: `Field ${places.length + 1}`, cat: 0, lat: center.lat, lon: center.lon, zoom, pts, circle: false, project: 'My Farm', tags: [], source: 'drawn', created: 'Oct 2026', details: [{ l: 'Added via', v: SOURCE_LABEL.drawn }] };
    addPlace(np);
    setAskPlace(id);
    setDrawing(false);
    setDrawPts([]);
    notify(`${np.name} saved · ${areaHa(pts, np.lat)} ha`, 'Rename', () => go('places'));
  };

  const addCircle = () => {
    const id = 'p' + Date.now();
    const np: Place = { id, name: `Circle ${places.length + 1}`, cat: 0, lat: center.lat, lon: center.lon, zoom: 16, pts: circlePts(150, 48), circle: true, project: 'My Farm', tags: [], source: 'pin', created: 'Oct 2026', details: [{ l: 'Added via', v: SOURCE_LABEL.pin }] };
    addPlace(np);
    setAskPlace(id);
    setPop(null);
    notify(`${np.name} added · ${areaHa(np.pts, np.lat)} ha`);
  };

  const toolClick = (k: string) => {
    if (['draw', 'contours', 'coords', 'ref'].includes(k)) return setPop((p) => (p === k ? null : k));
    if (k === 'layers') { setPop(null); return setPanel((p) => (p === 'layers' ? null : 'layers')); }
    if (k === 'undo') return drawing && drawPts.length ? setDrawPts((d) => d.slice(0, -1)) : notify('Nothing to undo', undefined, undefined, 'info');
    if (k === 'redo') return notify('Nothing to redo', undefined, undefined, 'info');
    if (k === 'pin') { setPop(null); return notify('Placemark added at map centre', 'Save as place', () => open({ kind: 'addPlace' }), 'location_on'); }
    if (k === 'measure') { setPop(null); return notify(place ? `${place.name} is ${Math.round(Math.sqrt(areaHa(place.pts, place.lat) * 10000 / Math.PI) * 2)} m across` : 'Pick a place to measure', undefined, undefined, 'straighten'); }
  };

  /* ---------------- derived ---------------- */

  const on = (id: string) => { const l = layers.find((x) => x.id === id); return !!(l && l.on && l.ready); };
  const mapLayers: MapLayers = { contour: on('contour'), ndmi: on('ndmi'), ndvi: on('ndvi'), lst: on('lst'), dry: on('dry'), clouds: on('clouds') };
  const isMap = mode === 'map';
  const last = turns[turns.length - 1];
  const showHero = !isMap && !turns.length && !sheet && H >= 640 && !mobile;
  const cloudy = CLOUDY.includes(dateIdx);
  const placeWatches = place ? watches.filter((w) => w.placeId === place.id) : [];
  const L = LANGS.find((l) => l.code === lang)!;

  const suggestions = place
    ? [
        { icon: 'water_drop', text: 'Where are the dry patches in my field?', go: () => startRun('Where are the dry patches in my field?') },
        { icon: 'eco', text: `How healthy is ${place.name} this week?`, go: () => startRun(`How healthy is ${place.name} this week?`, { skillId: 'weekly-crop-health' }) },
        { icon: 'local_fire_department', text: 'Any fires within 10 km of this place?', go: () => startRun('Any fires within 10 km of this place?', { skillId: 'active-fire-map' }) },
      ]
    : [
        { icon: 'satellite_alt', text: 'Which free satellite is best for crop health?', go: () => startRun('Which free satellite is best for crop health?') },
        { icon: 'flood', text: 'How can I map a flood through clouds?', go: () => startRun('How can I map a flood through clouds?') },
        { icon: 'pentagon', text: 'Pick one of my places to ask about it', go: () => setPop('place') },
      ];

  const sq = searchQ.trim().toLowerCase();
  const searchResults = useMemo(() => [
    ...places.map((p) => ({ n: p.name, d: `My place · ${p.project}`, icon: 'pentagon', go: () => { setAskPlace(p.id); flyTo(p); setPop(null); setSearchQ(''); } })),
    ...PLACE_RESULTS.map((r) => ({ n: r.n, d: r.d, icon: 'location_on', go: () => { setMode('map'); setCenter({ lat: r.lat, lon: r.lon }); setZoom(r.z); setPop(null); setSearchQ(''); notify(`${r.n} — not saved yet`, 'Save as place', () => open({ kind: 'addPlace' }), 'location_on'); } })),
  ].filter((r) => !sq || r.n.toLowerCase().includes(sq) || r.d.toLowerCase().includes(sq)), [places, sq, setAskPlace, flyTo, notify, open]);

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
      <Globe visible={active && !isMap} offsetRight={!mobile} />
      {isMap && <MapView W={W} H={H} cx={cx} cy={cy} center={center} zoom={zoom} place={place} layers={mapLayers} dateIdx={dateIdx} pass={pass} />}

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
              {place ? <span className="dot" style={{ background: CATS[place.cat].color }} /> : <Ms n="public" size={14} className="muted" />}
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{place ? place.name : t('chat.noPlace')}</span>
              {place && <span className="tiny">{areaHa(place.pts, place.lat)} ha</span>}
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
                    <span className="dot" style={{ background: CATS[p.cat].color, width: 8, height: 8 }} />
                    <span className="col grow"><span>{p.name}</span><span className="tiny">{p.project} · {areaHa(p.pts, p.lat)} ha</span></span>
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
              {turns.map((run) => (
                <TurnView key={run.id} run={run} isLast={run === last} places={places}
                  onToggle={() => setTurns((all) => all.map((x) => (x.id === run.id ? { ...x, open: !x.open } : x)))}
                  onPick={(k, o) => setTurns((all) => all.map((x) => (x.id === run.id ? { ...x, ans: { ...x.ans, [k]: o } } : x)))}
                  onContinue={continueRun}
                  onRunSkill={(id) => (place ? startRun(`Run “${skillById(id)!.name}” on ${place.name}`, { skillId: id }) : (setPop('place'), notify('Pick a place first', undefined, undefined, 'pentagon')))}
                />
              ))}
              {last?.phase === 'done' && (
                <button className="btn btn-text btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => { setTurns([]); setLayers(LAYERS); }}>
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
                <span className="tiny">{place.project} · {areaHa(place.pts, place.lat)} ha · {fmtC(place.lat, place.lon)}</span>
              </div>
              <Ms n={placeOpen ? 'expand_more' : 'expand_less'} size={20} className="muted" />
            </button>
            {placeOpen && (
              <div style={{ padding: '0 14px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="stats" style={{ gridTemplateColumns: '1fr 1fr' }}>
                  {place.details.slice(0, 4).map((d) => (
                    <div key={d.l}><div className="l">{d.l}</div><div className="v" style={{ fontSize: 14 }}>{d.v}</div></div>
                  ))}
                </div>
                <div className="col" style={{ gap: 6 }}>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span className="eyebrow">Watches here · {placeWatches.length}</span>
                    <button className="btn btn-text btn-sm" onClick={() => open({ kind: 'watchBuilder', placeId: place.id })}><Ms n="add" />Add watch<Tier tier="free" /></button>
                  </div>
                  {placeWatches.slice(0, 3).map((w) => (
                    <button key={w.id} onClick={() => go('watches', w.id)} className="row" style={{ gap: 8, padding: '6px 8px', borderRadius: 8, background: 'var(--s2)', border: 0, textAlign: 'left' }}>
                      <span className="dot" style={{ background: w.status === 'ok' ? 'var(--green)' : w.status === 'warn' ? 'var(--yellow)' : 'var(--red)' }} />
                      <span className="grow" style={{ font: '500 13px/1.38 var(--font)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.name}</span>
                      <span className="tiny ink">{w.value}{w.unit ? ' ' + w.unit : ''}</span>
                    </button>
                  ))}
                  {!placeWatches.length && <span className="caption">Nothing is being watched here yet.</span>}
                </div>
                <div className="row wrap" style={{ gap: 6 }}>
                  {place.tags.map((tg) => <span key={tg} className="tag">{tg}</span>)}
                  <span className="tag"><Ms n="draw" />{SOURCE_LABEL[place.source]}</span>
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
                  <button key={r.n} className="menu-item" onClick={r.go}>
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
                        <span className="col grow"><span style={{ font: '600 14px/1.4 var(--font)' }}>{c.name}</span><span className="tiny">{areaHa(c.pts, c.lat)} ha</span></span>
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
                    <Btn size="sm" icon="hd" tier="paid" tierLabel="$12/km²" onClick={() => open({ kind: 'upgrade', feature: '30 cm reference image (Pléiades Neo)', price: '$12 / km²' })}>Order 30 cm image</Btn>
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
          {!layers.some((l) => l.ai && l.ready) && <div className="sunk body-sm" style={{ margin: '0 20px 12px', padding: 12, fontSize: 13 }}>Layers made by the agent appear here after you ask a question about this place.</div>}
          <div className="col" style={{ padding: '0 8px 12px' }}>
            {layers.map((l) => (
              <button key={l.id} className="menu-item" style={{ opacity: l.ready ? 1 : 0.4, gap: 12 }} onClick={() => (l.ready ? setLayers((ls) => ls.map((x) => (x.id === l.id ? { ...x, on: !x.on } : x))) : notify('Ask the agent about this place to generate this layer', undefined, undefined, 'info'))}>
                <Check on={l.on && l.ready} />
                <span className="sq" style={{ width: 10, height: 10, background: l.color }} />
                <span className="col grow"><span style={{ font: '600 14px/1.4 var(--font)' }}>{l.name}</span><span className="tiny">{l.src}</span></span>
                {l.ai && <span className="badge-ai">AI</span>}
              </button>
            ))}
          </div>
          <div className="caption" style={{ borderTop: '1px solid var(--hair-soft)', padding: '14px 20px 18px' }}>Use the timeline at the bottom to step through each satellite pass.</div>
        </div>
      )}

      {/* TIMELINE */}
      {isMap && place && !sheet && !mobile && (
        <div className="panel fade-up row" style={{ position: 'absolute', left: chatW + 40, right: 20, margin: '0 auto', bottom: 92, width: 600, maxWidth: `calc(100% - ${chatW + 120}px)`, padding: '12px 16px', gap: 14, zIndex: 15 }}>
          <button onClick={togglePlay} title={playing ? 'Pause' : 'Play'} aria-label={playing ? 'Pause' : 'Play'} style={{ width: 38, height: 38, flex: 'none', borderRadius: 8, background: '#fff', color: '#000', border: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ms n={playing ? 'pause' : 'play_arrow'} size={22} /></button>
          <div className="col grow" style={{ gap: 4 }}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ font: '600 14px/1.4 var(--font)' }}>{DATES[dateIdx]}, 2026</span>
              <span className="tiny">{cloudy ? `Pass ${dateIdx + 1} of 8 · cloudy, skipped by agent` : `Sentinel-2 pass ${dateIdx + 1} of 8`}</span>
            </div>
            <input type="range" min={0} max={7} step={1} value={dateIdx} onChange={(e) => setDateIdx(+e.target.value)} aria-label="Satellite pass date" style={{ width: '100%', margin: '2px 0' }} />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              {DATES.map((d, i) => (
                <button key={d} onClick={() => setDateIdx(i)} style={{ background: 'transparent', border: 0, padding: 0, font: '500 11px/1.38 var(--font)', color: i === dateIdx ? '#fff' : 'var(--subtle)', display: 'flex', alignItems: 'center', gap: 2 }}>
                  {d}{CLOUDY.includes(i) && <Ms n="cloud" size={12} />}
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
          <Btn icon="visibility" onClick={() => go('watches')}>
            Watches<span style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9999, background: '#fff', color: '#000', font: '600 11px/18px var(--font)', textAlign: 'center' }}>{watches.filter((w) => w.on).length}</span>
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
          onRun={(id) => (place ? startRun(`Run “${skillById(id)!.name}” on ${place.name}`, { skillId: id }) : (setSheet(false), setPop('place'), notify('Pick a place to run this skill on', undefined, undefined, 'pentagon')))}
          onOpen={(id) => go('library', id)} />
      )}
    </div>
  );
}

/* ---------------- one Q&A turn ---------------- */

function TurnView({ run, isLast, places, onToggle, onPick, onContinue, onRunSkill }: {
  run: Turn; isLast: boolean; places: Place[]; onToggle: () => void; onPick: (k: string, o: string) => void; onContinue: () => void; onRunSkill: (id: string) => void;
}) {
  const p = places.find((x) => x.id === run.placeId);
  const cur = run.steps[run.idx];
  const label = run.phase === 'running' ? cur.tool + '…' : run.phase === 'clarify' ? 'Waiting for your answers' : `Analyzed in ${run.steps.length} steps · ${run.secs}s`;
  const steps = run.steps.slice(0, run.idx + 1);
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="col" style={{ alignSelf: 'flex-end', alignItems: 'flex-end', maxWidth: '85%', gap: 4 }}>
        <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--s2)', font: '500 14px/1.5 var(--font)' }}>{run.text}</div>
        <span className="tiny">{p ? <>about <span className="muted">{p.name}</span></> : 'general question'}</span>
      </div>
      <div className="col">
        <button onClick={onToggle} className="row" style={{ gap: 8, padding: '4px 0', background: 'transparent', border: 0, color: 'var(--muted)', textAlign: 'left', font: '500 13px/1.38 var(--font)' }} aria-expanded={run.open}>
          {run.phase === 'running' ? <><span className="spinner" /><span className="shimmer-text" style={{ fontSize: 13 }}>{label}</span></> : <><Ms n={run.phase === 'done' ? 'check_circle' : 'help'} size={16} /><span>{label}</span></>}
          <Ms n={run.open ? 'expand_less' : 'expand_more'} size={18} style={{ marginLeft: 'auto' }} />
        </button>
        {run.open && (
          <div className="col" style={{ marginTop: 10 }}>
            {steps.map((st, i) => {
              const done = run.phase === 'done' || i < run.idx;
              const waiting = run.phase === 'clarify' && i === 0;
              const activeS = !done && !waiting;
              const result = i === 0 && run.mode === 'dry' ? `${run.ans.crop} · ${run.ans.water} · started ${run.ans.when}` : st.result;
              return (
                <div key={i} className="row" style={{ gap: 10, alignItems: 'stretch', animation: 'fadeUp .35s ease both' }}>
                  <div className="col" style={{ alignItems: 'center', width: 18, flex: 'none' }}>
                    {activeS && <span className="spinner" style={{ marginTop: 4 }} />}
                    {waiting && <Ms n="help" size={18} style={{ marginTop: 2, animation: 'pulse 1.4s ease infinite' }} />}
                    {done && <Ms n="check_circle" size={18} className="muted" style={{ marginTop: 2 }} />}
                    <div style={{ flex: 1, width: 1, background: 'var(--hair)', margin: '4px 0', minHeight: 10 }} />
                  </div>
                  <div className="grow" style={{ paddingBottom: 12 }}>
                    {activeS ? <div className="shimmer-text" style={{ font: '600 14px/1.5 var(--font)' }}>{st.tool}</div> : <div style={{ font: '600 14px/1.5 var(--font)' }}>{st.tool}</div>}
                    <div className="caption" style={{ marginTop: 2 }}><span className="muted">{st.title}:</span> {st.desc}</div>
                    {done && result && <div className="tag" style={{ marginTop: 6 }}>{result}</div>}
                    {waiting && isLast && (
                      <div className="col" style={{ marginTop: 10, padding: 14, borderRadius: 12, background: 'var(--s2)', border: '1px solid var(--hair)', gap: 12 }}>
                        {CLAR.map((g) => (
                          <div key={g.k} className="col" style={{ gap: 6 }}>
                            <div style={{ font: '600 13px/1.38 var(--font)' }}>{g.label}</div>
                            <div className="row wrap" style={{ gap: 6 }}>
                              {g.opts.map((o) => (
                                <button key={o} className={`chip ${run.ans[g.k] === o ? 'on' : ''}`} style={{ padding: '4px 10px' }} onClick={() => onPick(g.k, o)}>{o}</button>
                              ))}
                            </div>
                          </div>
                        ))}
                        <Btn variant="primary" style={{ alignSelf: 'flex-start' }} onClick={onContinue} tier="free">Continue</Btn>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {run.phase === 'done' && run.answer && <AnswerCard answer={run.answer} question={run.text} placeId={run.placeId} onRunSkill={onRunSkill} />}
    </div>
  );
}

/* ---------------- skills quick sheet (hotbar from the prototype) ---------------- */

function SkillSheet({ cat, setCat, place, onClose, onRun, onOpen }: { cat: number; setCat: (n: number) => void; place: Place | null; onClose: () => void; onRun: (id: string) => void; onOpen: (id: string) => void }) {
  const lw = useRef(0);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (/INPUT|TEXTAREA/.test((e.target as HTMLElement).tagName)) return;
      if (e.key === 'Escape') onClose();
      if (/^[1-9]$/.test(e.key)) setCat(+e.key - 1);
      if (e.key === 'ArrowRight') setCat((cat + 1) % 9);
      if (e.key === 'ArrowLeft') setCat((cat + 8) % 9);
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [cat, setCat, onClose]);
  const c = CATS[cat];
  const cards = SKILLS.filter((s) => s.cat === cat);
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
          <div onWheel={(e) => { const now = Date.now(); if (now - lw.current < 120) return; lw.current = now; setCat((cat + ((e.deltaY || e.deltaX) > 0 ? 1 : 8)) % 9); }} className="row" style={{ alignItems: 'flex-end', flexWrap: 'wrap', rowGap: 16, gap: 0 }}>
            <div className="row" style={{ alignItems: 'flex-end', gap: 0, overflowX: 'auto', maxWidth: '100%', paddingBottom: 2 }}>
              {CATS.map((k, i) => {
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
            <div className="col" style={{ marginLeft: 24, gap: 4, minWidth: 260, flex: 1, paddingBottom: 4 }}>
              <div className="row"><span className="sq" style={{ width: 10, height: 10, background: c.color }} /><span className="subhead">{c.name}</span></div>
              <div className="body-sm">{c.uses}</div>
              <div className="caption">Main free satellites: {c.sats}</div>
            </div>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 20, overflowX: 'auto', scrollSnapType: 'x mandatory', padding: '24px clamp(16px,4vw,48px) 32px' }}>
          {cards.map((s) => (
            <div key={s.id} className="card" style={{ flex: 'none', width: 300, display: 'flex', flexDirection: 'column', overflow: 'hidden', scrollSnapAlign: 'start', animation: 'fadeUp .3s ease both' }}>
              <button onClick={() => onOpen(s.id)} style={{ position: 'relative', height: 130, width: '100%', background: '#000', border: 0, padding: 0 }} aria-label={`Open ${s.name}`}>
                <img onError={hideBroken} src={thumb(s.lat, s.lon, 13)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                <span className="eyebrow" style={{ position: 'absolute', left: 10, top: 10, padding: '3px 8px', borderRadius: 4, background: '#000', fontSize: 11, color: 'var(--muted)' }}>Reference</span>
                <span className="pill" style={{ position: 'absolute', right: 10, top: 10 }}>{s.official ? <><Ms n="verified" size={14} style={{ color: 'var(--blue)' }} />Official</> : 'Community'}</span>
              </button>
              <div className="col" style={{ padding: 16, gap: 8, flex: 1 }}>
                <div className="row wrap" style={{ gap: 6 }}><CatPill cat={s.cat} /><span className="pill">{s.cost}</span></div>
                <div style={{ font: '600 18px/1.25 var(--font)', letterSpacing: -0.3 }}>{s.name}</div>
                <div className="row caption muted" style={{ gap: 6 }}><Ms n="satellite_alt" size={16} />{s.sat}</div>
                <div className="body-sm">{s.short}</div>
                <div className="row" style={{ marginTop: 'auto', paddingTop: 8, justifyContent: 'space-between' }}>
                  <span className="tiny">by {s.dev}</span>
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
