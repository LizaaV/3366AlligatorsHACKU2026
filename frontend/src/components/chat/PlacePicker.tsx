/**
 * The one control for "where is this question about": a chip in the composer that opens a
 * popover with search over the user's saved places and the geocoder, plus No place, Add a
 * place, Draw an area and Go to coordinates.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { useResource } from '../../hooks/useResource';
import { toSearchHits } from '../../model';
import { useStore } from '../../state/store';
import { Ms } from '../ui';

/** A spot on the map that is not (yet) a saved place. */
export interface Spot {
  name: string;
  lat: number;
  lon: number;
  zoom: number;
}

const useDebounced = <T,>(value: T, ms: number) => {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
};

export function PlacePicker({
  placeId,
  spot,
  onPlace,
  onSpot,
  align = 'left',
}: {
  placeId: string | null;
  /** A temporary pinned point, shown in the chip when no saved place is selected. */
  spot: Spot | null;
  onPlace: (id: string | null) => void;
  /** A geocoder result or coordinates were picked: the page flies there and offers to save it. */
  onSpot: (s: Spot) => void;
  align?: 'left' | 'right';
}) {
  const { places, category, open, t } = useStore();
  const [show, setShow] = useState(false);
  const [q, setQ] = useState('');
  const [coordsMode, setCoordsMode] = useState(false);
  const [coord, setCoord] = useState({ lat: '', lon: '' });
  const [coordErr, setCoordErr] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const place = places.find((p) => p.id === placeId) ?? null;

  const close = useCallback(() => {
    setShow(false);
    setQ('');
    setCoordsMode(false);
    setCoordErr(false);
  }, []);

  useEffect(() => {
    if (!show) return;
    const away = (e: MouseEvent) => wrap.current && !wrap.current.contains(e.target as Node) && close();
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    input.current?.focus();
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [show, close]);

  const sq = useDebounced(q.trim(), 300);
  // Only ask the geocoder once there is something to look up; the user's own places are
  // matched locally since they are already loaded.
  const geo = useResource(
    useCallback(
      (signal) => (sq.length >= 2 ? api.areas.resolve({ query: sq }, signal).then(toSearchHits) : Promise.resolve([])),
      [sq],
    ),
    [sq],
  );

  const lq = q.trim().toLowerCase();
  const mine = useMemo(
    () => places.filter((p) => !lq || `${p.name} ${p.project}`.toLowerCase().includes(lq)),
    [places, lq],
  );

  const pick = (fn: () => void) => () => {
    fn();
    close();
  };

  const goCoords = () => {
    const la = parseFloat(coord.lat);
    const lo = parseFloat(coord.lon);
    if (isNaN(la) || isNaN(lo) || Math.abs(la) > 85 || Math.abs(lo) > 180) return setCoordErr(true);
    onSpot({ name: `${la.toFixed(4)}, ${lo.toFixed(4)}`, lat: la, lon: lo, zoom: 13 });
    close();
  };

  const label = place ? place.name : spot ? spot.name : t('chat.noPlace');

  return (
    <div ref={wrap} style={{ position: 'relative', minWidth: 0 }}>
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        aria-haspopup="dialog"
        aria-expanded={show}
        title="Choose the place this question is about"
        className="row"
        style={{
          gap: 6,
          maxWidth: '100%',
          padding: '5px 8px 5px 10px',
          borderRadius: 9999,
          background: place || spot ? 'var(--s2)' : 'transparent',
          border: `1px ${place || spot ? 'solid' : 'dashed'} var(--hair)`,
          color: '#fff',
          font: '600 13px/1.3 var(--font)',
        }}
      >
        {place ? <span className="dot" style={{ background: category(place.categoryKey).color }} /> : <Ms n={spot ? 'location_on' : 'public'} size={16} className="muted" />}
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        {place && <span className="tiny hide-mobile" style={{ whiteSpace: 'nowrap' }}>{place.areaHa} ha</span>}
        <Ms n="arrow_drop_down" size={18} className="muted" />
      </button>

      {show && (
        <div
          role="dialog"
          aria-label="Choose a place"
          className="menu"
          style={{ bottom: 'calc(100% + 8px)', [align]: 0, width: 340, maxWidth: 'calc(100vw - 32px)', maxHeight: 'min(460px, 60vh)', display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}
        >
          {coordsMode ? (
            <div className="col" style={{ padding: 14, gap: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span className="eyebrow">Go to coordinates</span>
                <button className="btn btn-text btn-sm" onClick={() => setCoordsMode(false)}><Ms n="arrow_back" />Back</button>
              </div>
              <label className="field">Latitude<input className="input" inputMode="decimal" value={coord.lat} onChange={(e) => { setCoord({ ...coord, lat: e.target.value }); setCoordErr(false); }} placeholder="48.1374" autoFocus /></label>
              <label className="field">Longitude<input className="input" inputMode="decimal" value={coord.lon} onChange={(e) => { setCoord({ ...coord, lon: e.target.value }); setCoordErr(false); }} onKeyDown={(e) => e.key === 'Enter' && goCoords()} placeholder="11.5755" /></label>
              {coordErr && <div className="caption">Enter a latitude between -85 and 85 and a longitude between -180 and 180.</div>}
              <button className="btn btn-primary" onClick={goCoords}>Go</button>
            </div>
          ) : (
            <>
              <div className="row" style={{ gap: 8, margin: 8, padding: '0 12px', height: 40, borderRadius: 8, background: 'var(--glass-fill)', border: '1px solid var(--hair-soft)', flex: 'none' }}>
                <Ms n="search" size={20} className="muted" />
                <input
                  ref={input}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return;
                    const first = mine[0];
                    if (first) { onPlace(first.id); close(); }
                    else if (geo.data?.[0]) { const r = geo.data[0]; onSpot({ name: r.name, lat: r.lat, lon: r.lon, zoom: r.zoom }); close(); }
                  }}
                  placeholder="Search a place or address"
                  aria-label="Search a place"
                  style={{ flex: 1, minWidth: 0, height: 38, background: 'transparent', border: 0, outline: 0, color: '#fff', font: '500 14px/1.4 var(--font)' }}
                />
              </div>
              <div style={{ overflowY: 'auto', padding: '0 6px 6px' }}>
                {!lq && (
                  <button className={`menu-item ${!place && !spot ? 'on' : ''}`} onClick={pick(() => onPlace(null))}>
                    <Ms n="public" />
                    <span className="col grow"><span>No place</span><span className="tiny">General question, not tied to a place</span></span>
                    {!place && !spot && <Ms n="check" size={18} />}
                  </button>
                )}
                {mine.length > 0 && <div className="menu-label eyebrow">My places</div>}
                {mine.map((p) => (
                  <button key={p.id} className={`menu-item ${p.id === placeId ? 'on' : ''}`} onClick={pick(() => onPlace(p.id))}>
                    <span className="dot" style={{ background: category(p.categoryKey).color, width: 8, height: 8 }} />
                    <span className="col grow"><span>{p.name}</span><span className="tiny">{p.project} · {p.areaHa} ha</span></span>
                    {p.id === placeId && <Ms n="check" size={18} />}
                  </button>
                ))}
                {sq.length >= 2 && (geo.data?.length ?? 0) > 0 && <div className="menu-label eyebrow">On the map</div>}
                {(geo.data ?? []).map((r) => (
                  <button key={`${r.name}:${r.lat}`} className="menu-item" onClick={pick(() => onSpot({ name: r.name, lat: r.lat, lon: r.lon, zoom: r.zoom }))}>
                    <Ms n="location_on" />
                    <span className="col grow"><span>{r.name}</span><span className="tiny">{r.description}</span></span>
                  </button>
                ))}
                {sq.length >= 2 && geo.isFetching && !geo.data?.length && <div className="caption" style={{ padding: '8px 10px' }}>Searching…</div>}
                {lq && !mine.length && !geo.isFetching && !geo.data?.length && <div className="caption" style={{ padding: '8px 10px' }}>No matches. Try coordinates instead.</div>}
                <div className="divider" style={{ margin: '6px 4px' }} />
                <button className="menu-item" onClick={pick(() => open({ kind: 'addPlace' }))}><Ms n="add_location_alt" />{t('cta.addPlace')}</button>
                <button className="menu-item" onClick={pick(() => open({ kind: 'addPlace' }))}><Ms n="polyline" />Draw an area</button>
                <button className="menu-item" onClick={() => setCoordsMode(true)}><Ms n="my_location" />Go to coordinates</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
