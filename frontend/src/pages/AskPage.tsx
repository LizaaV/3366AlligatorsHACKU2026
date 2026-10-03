import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
// three.js is ~600 kB and only the landing globe needs it, so it is split out of the main
// bundle and loaded when the globe first renders.
const Globe = lazy(() => import('../components/Globe').then((m) => ({ default: m.Globe })));
import { MapView } from '../components/MapView';
import { Btn, IconBtn, Ms } from '../components/ui';
import { api } from '../api';
import type { MapLayer } from '../model';
import { passTimelineFrom } from '../model';
import { DEFAULT_CENTER, DEFAULT_ZOOM } from '../lib/geo';
import { useAskRun } from '../ask/useAskRun';
import { Composer } from '../components/chat/Composer';
import { PlacePicker, type Spot } from '../components/chat/PlacePicker';
import { ChatSidebar } from '../components/chat/ChatSidebar';
import { TurnView } from '../components/chat/TurnView';
import { takeChatHandoff } from '../components/chat/chatContext';
import { turnsFromThread } from '../components/chat/threadTurns';
import { LayerRail } from '../components/place';
import { ArtifactsContext } from '../components/artifacts/ArtifactsContext';
import { ArtifactsPanel, MIN_PANEL_W, usePanelWidth } from '../components/artifacts/ArtifactsPanel';
import { catalogLayerFor, deriveArtifacts, primaryArtifactOf } from '../components/artifacts/artifacts';
import '../components/chat/chat.css';

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
  const { places, skills, askPlaceId, setAskPlace, route, open, notify, t, lang, mapLayers: catalogLayers } = store;
  const { W, H: winH } = useViewport();
  const navH = W <= 760 ? 52 : 56;
  const mobile = W <= 760;
  const H = winH - navH - (mobile ? 64 : 0);

  const place = places.find((p) => p.id === askPlaceId) || null;

  const [mode, setMode] = useState<'globe' | 'map'>('globe');
  const [center, setCenter] = useState({ lat: place?.lat ?? DEFAULT_CENTER.lat, lon: place?.lon ?? DEFAULT_CENTER.lon });
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [layers, setLayers] = useState<MapLayer[]>([]);
  /** The place outline is drawn locally, independent of the layer catalog. On by default. */
  const [outlineOn, setOutlineOn] = useState(true);
  const [dateIdx, setDateIdx] = useState(0);
  const [q, setQ] = useState('');
  const [sidebar, setSidebar] = useState(false);
  /** A temporary pinned point (geocoder result, coordinates or globe click) used as the chat's place. */
  const [spot, setSpot] = useState<Spot | null>(null);
  const [globePick, setGlobePick] = useState<{ lat: number; lon: number } | null>(null);
  /** Artifacts sidebar: what is selected, whether it is shrunk to a pill, or expanded over the map. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [panelW, setPanelW] = usePanelWidth(W);
  const [loadingThread, setLoadingThread] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  const spotRef = useRef<Spot | null>(null);
  spotRef.current = spot;

  // History opens as an overlay from the composer, so the content never shifts sideways.
  // The chat docks in a left column (as in the original layout); globe, map and hero use the rest.
  const chatW = mobile ? W - 16 : W < 1280 ? 380 : 440;
  const sideW = mobile ? 0 : chatW + 20;

  // Layer definitions come from the catalog endpoint; keep the local on/ready flags.
  useEffect(() => {
    setLayers((cur) => (cur.length ? cur : catalogLayers));
  }, [catalogLayers]);

  const cy = H / 2;

  const flyTo = useCallback((p: { lat: number; lon: number; zoom: number }) => {
    setMode('map');
    setCenter({ lat: p.lat, lon: p.lon });
    setZoom(p.zoom);
  }, []);

  // Selecting a place (from Places page, picker or URL) shows it on the map; "no place" returns to the globe.
  const lastPlace = useRef<string | null | undefined>(undefined);
  const placesLoaded = useRef(false);
  useEffect(() => {
    if (lastPlace.current === askPlaceId) return;
    // The store picks a default place once places finish loading; that is not the user
    // choosing one, so the landing view stays on the globe.
    const first = lastPlace.current === undefined || (lastPlace.current === null && !placesLoaded.current);
    lastPlace.current = askPlaceId;
    placesLoaded.current = places.length > 0;
    if (first && !route.query.place) return; // landing stays on the globe
    if (place) {
      setSpot(null);
      flyTo(place);
    } else if (!spotRef.current) setMode('globe');
  }, [askPlaceId, place, flyTo, route.query.place]);

  /* ---------------- agent run ---------------- */

  // The conversation and the stream live in the hook. This page only reacts to the coarse
  // `stage` to drive the map, and reads the blocks the run produced.
  const run = useAskRun({ lang, selectedPlaceId: askPlaceId });
  const { turns, last, stage } = run;

  /* ---------------- artifacts ---------------- */

  // Artifacts are derived from the turns' blocks (see components/artifacts/artifacts.ts), so a
  // reopened thread brings them back. Only layers the map can draw are offered as layers.
  const catalogIds = useMemo(() => new Set(catalogLayers.map((l) => l.id)), [catalogLayers]);
  const artifacts = useMemo(() => deriveArtifacts(turns, (id) => catalogIds.has(id)), [turns, catalogIds]);
  const selected = artifacts.find((a) => a.id === selectedId) ?? null;
  const artifactsRef = useRef(artifacts);
  artifactsRef.current = artifacts;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const placeIdOf = useCallback((turnId: string) => turns.find((t) => t.id === turnId)?.placeId ?? null, [turns]);

  const panelOpen = !mobile && artifacts.length > 0 && !collapsed;
  const expandedW = Math.max(MIN_PANEL_W, W - sideW - 24);
  const panelWidth = expanded ? expandedW : panelW;
  /** Room the right-edge map controls and the map centre keep clear of the panel. */
  const rightPad = panelOpen ? panelWidth + 12 : 0;
  const cx = sideW + (W - sideW - rightPad) / 2;

  const ask = useCallback((text: string, opts: { skillId?: string; placeId?: string | null } = {}) => run.submit(text, { ...opts, point: spotRef.current }), [run]);
  // The contract streams a `timeline` block rather than a `timeline` field on the answer.
  const lastTimeline = useMemo(() => (last ? passTimelineFrom(last.blocks) : null), [last]);
  // The map's pass cursor follows the selected artifact's run when it has passes of its own.
  const selectedTurn = selected ? turns.find((t) => t.id === selected.turnId) : undefined;
  const timeline = useMemo(() => (selectedTurn ? passTimelineFrom(selectedTurn.blocks) : null) ?? lastTimeline, [selectedTurn, lastTimeline]);

  const selectArtifact = useCallback((id: string) => {
    const next = artifactsRef.current.find((a) => a.id === id);
    if (!next) return;
    const prev = selectedRef.current;
    if (!prev || prev.turnId !== next.turnId) {
      const tl = passTimelineFrom(next.blocks);
      if (tl) setDateIdx(Math.max(0, tl.dates.length - 1));
    }
    setSelectedId(id);
    setCollapsed(false);
  }, []);

  // A run that just finished opens its primary artifact (else its first); a reopened thread opens the latest.
  const autoRun = useRef<string | null>(null);
  const hydrating = useRef(false);
  const pendingSelect = useRef<string | null>(null);
  useEffect(() => {
    if (pendingSelect.current) {
      if (artifacts.some((a) => a.id === pendingSelect.current)) {
        selectArtifact(pendingSelect.current);
        pendingSelect.current = null;
      }
      return;
    }
    if (!last || last.phase !== 'done' || !last.runId || autoRun.current === last.runId) return;
    autoRun.current = last.runId;
    const pick = hydrating.current ? artifacts[artifacts.length - 1] : primaryArtifactOf(artifacts, last.id) ?? artifacts[0];
    hydrating.current = false;
    if (!pick) return;
    setSelectedId(pick.id);
    if (!mobile) setCollapsed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifacts, last]);

  // A layer artifact is on the map while it is selected, and off again when something else is
  // chosen (unless the layer was already on before).
  const activeLayer = selected?.kind === 'layer' ? selected.layerId ?? null : null;
  const layersRef = useRef<MapLayer[]>([]);
  layersRef.current = layers;
  const selectedPlace = selected ? places.find((x) => x.id === placeIdOf(selected.turnId)) : undefined;
  useEffect(() => {
    if (!activeLayer) return;
    const cur = layersRef.current.find((l) => l.id === activeLayer);
    const wasOn = !!(cur && cur.on && cur.ready);
    setLayers((ls) => ls.map((l) => (l.id === activeLayer ? { ...l, ready: true, on: true } : l)));
    if (selectedPlace) flyTo(selectedPlace);
    return () => {
      if (!wasOn) setLayers((ls) => ls.map((l) => (l.id === activeLayer ? { ...l, on: false } : l)));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLayer, selectedId]);

  // The real rendered image for the layer on show: the selected layer artifact, else the agent
  // layer most recently switched on. Taken from the newest run that rendered that measure.
  const rasterLayerId = activeLayer ?? [...layers].reverse().find((l) => l.isAgentMade && l.on && l.ready)?.id ?? null;
  const raster = useMemo(() => {
    if (!rasterLayerId) return null;
    for (const turn of [...turns].reverse()) {
      for (const b of turn.blocks) {
        if (b.type !== 'then_now' && b.type !== 'highlight') continue;
        const ref = b.type === 'then_now' ? b.after : b.base;
        if (ref?.url && ref.bounds && catalogLayerFor(ref.layer_id, b.measure, (id) => id === rasterLayerId) === rasterLayerId) {
          return { url: ref.url, bounds: ref.bounds };
        }
      }
    }
    return null;
  }, [rasterLayerId, turns]);

  const setLayersOn = useCallback(
    (ids: string[]) => setLayers((ls) => ls.map((l) => (ids.includes(l.id) ? { ...l, ready: true, on: true } : l))),
    [],
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
    // Steps can finish in jumps, so 'locating' may be skipped: fly to the run's place on any
    // later stage while still on the globe.
    if (mode === 'globe' && stage !== 'error') {
      const p = places.find((x) => x.id === last?.placeId);
      if (p) flyTo(p);
    }
    if (stage === 'locating') return;
    if (stage === 'done') {
      // Switch on the layers this run actually rendered, mapped onto the catalog ids.
      const ids = new Set<string>();
      for (const b of last?.blocks ?? []) {
        if (b.type !== 'then_now' && b.type !== 'highlight') continue;
        const refs = b.type === 'then_now' ? [b.after, b.before] : b.base ? [b.base] : [];
        for (const r of refs) {
          const id = catalogLayerFor(r.layer_id, b.measure, (x) => catalogIds.has(x));
          if (id) ids.add(id);
        }
      }
      if (ids.size) setLayersOn([...ids]);
      setDateIdx(Math.max(0, (timeline?.dates.length ?? 1) - 1));
    }
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
    ask(text);
  };

  const runSkill = useCallback(
    (skillId: string, placeId?: string | null) => {
      const skill = skills.find((x) => x.id === skillId);
      if (!skill) return;
      const pid = placeId !== undefined ? placeId : askPlaceId;
      if (!pid) {
        notify('Pick a place to run this skill on', undefined, undefined, 'pentagon');
        return;
      }
      const p = places.find((x) => x.id === pid);
      setQ('');
      ask(`Run “${skill.name}” on ${p?.name ?? 'this place'}`, { skillId, placeId: pid });
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

  /* ---------------- chat history ---------------- */

  const resetView = useCallback(() => {
    setLayers(catalogLayers);
    setSelectedId(null);
    setExpanded(false);
  }, [catalogLayers]);

  const newChat = () => {
    run.reset();
    autoRun.current = null;
    setQ('');
    setSpot(null);
    resetView();
  };

  const openThread = async (threadId: string) => {
    setLoadingThread(true);
    try {
      const detail = await api.threads.get(threadId);
      const loaded = turnsFromThread(detail);
      resetView();
      autoRun.current = null;
      hydrating.current = true;
      pendingSelect.current = null;
      run.hydrate(loaded);
      const pid = loaded[loaded.length - 1]?.placeId ?? null;
      setSpot(null);
      setAskPlace(pid && places.some((p) => p.id === pid) ? pid : null);
    } catch {
      notify('Could not open that chat', undefined, undefined, 'error');
    } finally {
      setLoadingThread(false);
    }
  };

  // "Open in full chat" from the floating bubble leaves its conversation for us to pick up.
  useEffect(() => {
    if (route.page !== 'ask') return;
    const h = takeChatHandoff();
    if (!h) return;
    resetView();
    autoRun.current = null;
    pendingSelect.current = h.artifactId ?? null;
    run.hydrate(h.turns);
    setAskPlace(h.placeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  /* ---------------- place / spot ---------------- */

  const selectPlace = (id: string | null) => {
    setSpot(null);
    setAskPlace(id);
    if (!id) setMode('globe');
  };

  /** A geocoder result or coordinates: fly there, use it as the question's place, offer to save it. */
  const pickSpot = (s: Spot) => {
    setSpot(s);
    setAskPlace(null);
    flyTo(s);
    notify(`${s.name} — not saved yet`, 'Save as place', () => open({ kind: 'addPlace', prefill: { lat: s.lat, lon: s.lon, name: s.name, method: 'pin' } }), 'location_on');
  };

  const askAboutGlobePick = (p: { lat: number; lon: number }) => {
    setSpot({ name: `Spot ${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`, lat: p.lat, lon: p.lon, zoom: 12 });
    setAskPlace(null);
    setGlobePick(null);
  };

  /* ---------------- derived ---------------- */

  const on = (id: string) => { const l = layers.find((x) => x.id === id); return !!(l && l.on && l.ready); };
  // The rail shows the local outline toggle first, then the catalog layers (minus the catalog's
  // own `contour`, which the outline replaces).
  const railLayers: MapLayer[] = [
    ...(place ? [{ id: 'outline', name: 'Outline', source: 'You', color: '#ffffff', isAgentMade: false, on: outlineOn, ready: true } as MapLayer] : []),
    ...layers.filter((l) => l.id !== 'contour'),
  ];
  // Backend layer ids are measure names; the map overlays still use the index names.
  const isMap = mode === 'map';
  const showHero = !turns.length && !loadingThread;
  const focusPt = place ?? spot;

  const suggestions = place
    ? [
        { icon: 'water_drop', text: 'Where are the dry patches in my field?', go: () => ask('Where are the dry patches in my field?') },
        { icon: 'eco', text: `How healthy is ${place.name} this week?`, go: () => runSkill('weekly-crop-health') },
        { icon: 'local_fire_department', text: 'Any fires within 10 km of this place?', go: () => runSkill('active-fire-map') },
      ]
    : [
        { icon: 'satellite_alt', text: 'Which free satellite is best for crop health?', go: () => ask('Which free satellite is best for crop health?') },
        { icon: 'flood', text: 'How can I map a flood through clouds?', go: () => ask('How can I map a flood through clouds?') },
        { icon: 'add_location_alt', text: 'Add a place to ask about it', go: () => open({ kind: 'addPlace' }) },
      ];

  const sliderArtifact = [...artifacts].reverse().find((a) => a.kind === 'slider') ?? null;
  const closeChats = useCallback(() => setSidebar(false), []);
  const current = last?.threadId ? { threadId: last.threadId, title: turns[0]?.text ?? 'New chat' } : null;

  return (
    <ArtifactsContext.Provider value={{ artifacts, selectedId: selected?.id ?? null, select: selectArtifact }}>
    <div style={{ position: 'fixed', top: navH, left: 0, right: 0, bottom: mobile ? 64 : 0, overflow: 'hidden', background: '#000', visibility: active ? 'visible' : 'hidden' }} aria-hidden={!active}>
      <Suspense fallback={null}>
        <Globe
          visible={active && !isMap}
          offsetRight={!mobile}
          offsetPx={mobile ? 0 : (sideW - rightPad) / 2}
          focus={focusPt ? { lat: focusPt.lat, lon: focusPt.lon } : null}
          onPickLocation={(p) => setGlobePick({ lat: p.lat, lon: p.lon })}
        />
      </Suspense>
      {isMap && <MapView W={W} H={H} cx={cx} cy={cy} center={center} zoom={zoom} place={place} outline={outlineOn} raster={raster} />}

      {/* LAYER RAIL (place view): right edge, under the zoom and globe buttons. */}
      {isMap && (
        <div style={{ position: 'absolute', right: 8 + rightPad, top: 0, width: 0, height: '100%', zIndex: 25 }}>
          <LayerRail
            layers={railLayers}
            side="right"
            top={170}
            onToggle={(id) => {
              if (id === 'outline') return setOutlineOn((v) => !v);
              const l = layers.find((x) => x.id === id);
              if (l && !l.ready) return notify('Ask the agent about this place to generate this layer', undefined, undefined, 'info');
              setLayers((ls) => ls.map((x) => (x.id === id ? { ...x, on: !x.on } : x)));
            }}
          />
        </div>
      )}

      {/* GLOBE CLICK */}
      {globePick && !isMap && (
        <div className="menu fade-up" role="menu" style={{ left: cx - 130, top: 24, width: 260, zIndex: 35 }}>
          <div className="row" style={{ justifyContent: 'space-between', padding: '4px 10px 6px' }}>
            <span className="tiny">{globePick.lat.toFixed(3)}, {globePick.lon.toFixed(3)}</span>
            <button className="icon-btn sm" onClick={() => setGlobePick(null)} aria-label="Close"><Ms n="close" /></button>
          </div>
          <button className="menu-item" onClick={() => askAboutGlobePick(globePick)}><Ms n="forum" />Ask about this spot</button>
          <button className="menu-item" onClick={() => { open({ kind: 'addPlace', prefill: { lat: globePick.lat, lon: globePick.lon, method: 'pin' } }); setGlobePick(null); }}><Ms n="polyline" />Draw an area here</button>
          <button className="menu-item" onClick={() => { open({ kind: 'addPlace', prefill: { lat: globePick.lat, lon: globePick.lon, method: 'pin' } }); setGlobePick(null); }}><Ms n="add_location_alt" />Save as place</button>
        </div>
      )}

      {/* HERO */}
      {showHero && H >= 520 && (
        <div style={{ position: 'absolute', left: sideW, right: rightPad, top: mobile ? 56 : '9%', padding: '0 24px', textAlign: 'center', pointerEvents: 'none', animation: 'fadeUp .6s ease both' }}>
          <div className="display" style={{ textShadow: '0 2px 24px rgba(0,0,0,.7)' }}>{t('hero.title')}</div>
          <div className="body-lg" style={{ marginTop: 14, maxWidth: 560, marginInline: 'auto', textShadow: '0 1px 12px rgba(0,0,0,.8)' }}>{t('hero.line')}</div>
        </div>
      )}

      {/* CHAT: left column, conversation above the composer */}
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: mobile ? '100%' : chatW + 20, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', alignItems: 'flex-start', padding: mobile ? '0 8px 8px' : '0 0 20px 20px', pointerEvents: 'none', zIndex: 20 }}>
        <div style={{ width: chatW, maxWidth: '100%', minHeight: 0, display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '100%', paddingTop: mobile ? 56 : 16 }}>
          {(turns.length > 0 || loadingThread) && (
            <div ref={thread} className="panel" style={{ pointerEvents: 'auto', flex: '0 1 auto', minHeight: 0, overflowY: 'auto', padding: mobile ? 14 : 20, display: 'flex', flexDirection: 'column', gap: 20 }}>
              {loadingThread && <div className="caption"><span className="spinner" /> Opening chat…</div>}
              {turns.map((turn) => (
                <TurnView
                  key={turn.id}
                  turn={turn}
                  isLast={turn === last}
                  places={places}
                  onToggle={() => run.toggleOpen(turn.id)}
                  onPick={(k, o) => run.setAnswerValue(turn.id, k, o)}
                  onRemember={(r) => run.setRemember(turn.id, r)}
                  onContinue={run.continueAfterClarify}
                  onRetry={run.retry}
                  onRunSkill={(id) => runSkill(id)}
                  onAskFollowup={(text) => ask(text)}
                />
              ))}
            </div>
          )}

          <div className="row wrap" style={{ pointerEvents: 'auto', gap: 8, justifyContent: 'center', flex: 'none' }}>
            {!turns.length && suggestions.map((sg) => (
              <button key={sg.text} onClick={sg.go} className="chip glass" style={{ color: '#fff' }}>
                <Ms n={sg.icon} />{sg.text}
              </button>
            ))}
            {sliderArtifact && selected?.id !== sliderArtifact.id && (
              <button onClick={() => selectArtifact(sliderArtifact.id)} className="chip glass" style={{ color: '#fff' }}>
                <Ms n="timeline" />Step through satellite passes
              </button>
            )}
          </div>

          <div style={{ pointerEvents: 'auto', flex: 'none' }}>
            <Composer
              value={q}
              onChange={setQ}
              onSubmit={submit}
              busy={run.isBusy}
              placeholder={place ? `Ask about ${place.name}…` : spot ? `Ask about ${spot.name}…` : t('chat.placeholder')}
              leading={
                <div className="row" style={{ gap: 6, rowGap: 6, flexWrap: 'wrap', position: 'relative', minWidth: 0 }}>
                  <button
                    data-chats-cta
                    className="pill"
                    onClick={() => setSidebar((o) => !o)}
                    aria-expanded={sidebar}
                    aria-haspopup="dialog"
                    title="Chats and projects"
                    style={{ border: '1px solid var(--glass-border)', background: sidebar ? 'var(--glass-fill-hover)' : 'var(--glass-fill)', color: '#fff', maxWidth: 150, minWidth: 0 }}
                  >
                    <Ms n="forum" size={14} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current ? current.title : 'Chats'}</span>
                    <Ms n="expand_less" size={16} className="muted" />
                  </button>
                  <ChatSidebar
                    open={sidebar}
                    mobile={mobile}
                    activeThreadId={last?.threadId ?? null}
                    current={current}
                    refreshKey={last?.phase === 'done' ? last.runId : null}
                    onClose={closeChats}
                    onNew={newChat}
                    onOpen={openThread}
                  />
                  <PlacePicker placeId={askPlaceId} spot={spot} onPlace={selectPlace} onSpot={pickSpot} />
                </div>
              }
            />
          </div>
        </div>
      </div>

      {/* MAP CONTROLS: zoom and back to the globe */}
      {isMap && !mobile && (
        <div className="col" style={{ position: 'absolute', right: 20 + rightPad, top: 16, gap: 6, zIndex: 22 }}>
          <IconBtn icon="add" className="boxed" title="Zoom in" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(18, z + 1))} />
          <IconBtn icon="remove" className="boxed" title="Zoom out" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(3, z - 1))} />
          <IconBtn icon="public" className="boxed" title="Back to globe" aria-label="Back to globe" onClick={() => setMode('globe')} />
        </div>
      )}
      {isMap && mobile && (
        <Btn size="sm" icon="public" onClick={() => setMode('globe')} style={{ position: 'absolute', right: 12, top: 12, zIndex: 22 }}>Globe</Btn>
      )}

      <ArtifactsPanel
        artifacts={artifacts}
        selectedId={selected?.id ?? null}
        onSelect={selectArtifact}
        collapsed={collapsed}
        onCollapse={setCollapsed}
        expanded={expanded}
        onExpand={setExpanded}
        width={panelWidth}
        onResize={setPanelW}
        mobile={mobile}
        places={places}
        placeIdOf={placeIdOf}
        dateIdx={dateIdx}
        onDateIdx={setDateIdx}
        layerShown={on}
      />
    </div>
    </ArtifactsContext.Provider>
  );
}
