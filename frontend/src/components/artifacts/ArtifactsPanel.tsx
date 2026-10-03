/**
 * The artifacts sidebar of the Ask page: everything the answers produced that is not words.
 *
 * The page owns the state (selection, width, expanded, collapsed) because it also has to move
 * the map controls and the map centre out of the panel's way; this component only draws.
 */

import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Ms } from '../ui';
import { Block } from '../blocks';
import { PassStepper, SatelliteCompare, layerLook } from '../place';
import { passTimelineFrom, type Place } from '../../model';
import { KIND_META, KIND_ORDER, type Artifact } from './artifacts';
import './artifacts.css';

export const MIN_PANEL_W = 320;
export const maxPanelW = (viewportW: number) => Math.max(MIN_PANEL_W, Math.round(viewportW * 0.65));
const STORE_KEY = 'artifacts.panelWidth';

/** The panel's width, remembered between visits. Storage may be blocked, so every access is guarded. */
export function usePanelWidth(viewportW: number): [number, (w: number) => void] {
  const [w, setW] = useState<number>(() => {
    try {
      const v = Number(window.localStorage.getItem(STORE_KEY));
      if (v >= MIN_PANEL_W) return v;
    } catch { /* blocked storage: use the default */ }
    return 400;
  });
  const set = (next: number) => {
    const c = Math.min(Math.max(next, MIN_PANEL_W), maxPanelW(viewportW));
    setW(c);
    try { window.localStorage.setItem(STORE_KEY, String(Math.round(c))); } catch { /* ignore */ }
  };
  return [Math.min(Math.max(w, MIN_PANEL_W), maxPanelW(viewportW)), set];
}

interface Props {
  artifacts: Artifact[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  collapsed: boolean;
  onCollapse: (c: boolean) => void;
  expanded: boolean;
  onExpand: (e: boolean) => void;
  /** Effective width in px (the expanded width when expanded). */
  width: number;
  onResize: (w: number) => void;
  mobile: boolean;
  places: Place[];
  placeIdOf: (turnId: string) => string | null;
  dateIdx: number;
  onDateIdx: (i: number) => void;
  /** Layer artifacts are switched on by the page; this says whether the map is showing it. */
  layerShown: (layerId: string) => boolean;
}

export function ArtifactsPanel(p: Props) {
  const { artifacts, selectedId, onSelect, collapsed, onCollapse, expanded, onExpand, width, onResize, mobile } = p;
  const [menu, setMenu] = useState(false);
  const pick = useRef<HTMLDivElement>(null);
  // Close the menu on a click anywhere outside it. (A fixed scrim cannot do this: inside the
  // panel's backdrop-filter it only covers the panel.)
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => { if (!pick.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [menu]);
  const idx = artifacts.findIndex((a) => a.id === selectedId);
  const current = idx >= 0 ? artifacts[idx] : null;

  // Esc restores an expanded panel (or closes the menu first).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (menu) setMenu(false);
      else if (expanded) onExpand(false);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [menu, expanded, onExpand]);

  if (!artifacts.length) return null;

  if (collapsed) {
    return (
      <button type="button" className={`artifacts-pill glass${mobile ? ' mobile' : ''}`} onClick={() => onCollapse(false)} aria-label={`Show artifacts, ${artifacts.length}`}>
        <Ms n="dashboard_customize" size={16} />
        Artifacts · {artifacts.length}
      </button>
    );
  }

  const step = (d: number) => {
    const n = artifacts.length;
    onSelect(artifacts[(((idx < 0 ? 0 : idx) + d) % n + n) % n].id);
  };

  return (
    <aside
      className={`artifacts-panel panel${mobile ? ' mobile' : ''}${expanded ? ' expanded' : ''}`}
      style={mobile ? undefined : { width }}
      aria-label="Artifacts"
    >
      {!mobile && !expanded && <ResizeHandle width={width} onResize={onResize} />}
      <header className="artifacts-head">
        <div className="artifacts-pick" ref={pick}>
          <button type="button" className="artifacts-select" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}>
            <Ms n={current?.icon ?? 'dashboard_customize'} size={18} />
            <span className="grow artifacts-name">{current?.name ?? 'Choose an artifact'}</span>
            <Ms n="expand_more" size={18} />
          </button>
          {menu && (
            <>
              <div className="menu artifacts-menu" role="menu">
                {KIND_ORDER.map((kind) => {
                  const list = artifacts.filter((a) => a.kind === kind);
                  if (!list.length) return null;
                  return (
                    <div key={kind} role="group" aria-label={KIND_META[kind].label}>
                      <div className="eyebrow artifacts-group"><Ms n={KIND_META[kind].icon} size={14} />{KIND_META[kind].label}</div>
                      {list.map((a) => (
                        <button key={a.id} type="button" role="menuitem" className="menu-item" aria-current={a.id === selectedId} onClick={() => { onSelect(a.id); setMenu(false); }}>
                          <Ms n={a.icon} />
                          <span className="grow artifacts-item">
                            <span className="artifacts-item-name">{a.name}</span>
                            <span className="caption artifacts-item-q">{a.question}</span>
                          </span>
                          {a.id === selectedId && <Ms n="check" size={16} />}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
        <button type="button" className="icon-btn sm" onClick={() => step(-1)} aria-label="Previous artifact" title="Previous" disabled={artifacts.length < 2}><Ms n="chevron_left" /></button>
        <button type="button" className="icon-btn sm" onClick={() => step(1)} aria-label="Next artifact" title="Next" disabled={artifacts.length < 2}><Ms n="chevron_right" /></button>
        {!mobile && (
          <button type="button" className="icon-btn sm" onClick={() => onExpand(!expanded)} aria-label={expanded ? 'Restore size' : 'Expand'} title={expanded ? 'Restore (Esc)' : 'Expand'}>
            <Ms n={expanded ? 'close_fullscreen' : 'open_in_full'} />
          </button>
        )}
        <button type="button" className="icon-btn sm" onClick={() => onCollapse(true)} aria-label="Collapse artifacts" title="Collapse"><Ms n="right_panel_close" /></button>
      </header>

      <div className="artifacts-body">
        {current ? <ArtifactView a={current} {...p} /> : <div className="caption">Pick an artifact from the list.</div>}
      </div>
    </aside>
  );
}

/** Drag the left edge to resize; the page persists the width. */
function ResizeHandle({ width, onResize }: { width: number; onResize: (w: number) => void }) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    start.current = { x: e.clientX, w: width };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    if (start.current) onResize(start.current.w + (start.current.x - e.clientX));
  };
  const up = () => { start.current = null; };
  return (
    <div
      className="artifacts-resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize artifacts"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    />
  );
}

/** Date range and sources a block was made from, for the context header. */
function sourceLine(a: Artifact): string {
  const b = a.block;
  if (!b) return '';
  const dates = b.type === 'timeline' ? b.data.map((d) => d.date) : b.provenance.map((x) => x.date);
  const sorted = [...dates].sort();
  const range = sorted.length ? (sorted[0] === sorted[sorted.length - 1] ? sorted[0] : `${sorted[0]} to ${sorted[sorted.length - 1]}`) : '';
  const sats = [...new Set(b.provenance.map((x) => x.satellite))].join(', ');
  return [range, sats].filter(Boolean).join(' · ');
}

function ArtifactView({ a, places, placeIdOf, dateIdx, onDateIdx, layerShown }: { a: Artifact } & Props) {
  const place = places.find((x) => x.id === placeIdOf(a.turnId));
  const timeline = useMemo(() => (a.kind === 'slider' || a.kind === 'graph' ? passTimelineFrom(a.block ? [a.block] : []) : null), [a]);
  const src = sourceLine(a);

  const context = (
    <div className="artifacts-context">
      <div className="eyebrow">{KIND_META[a.kind].label.replace(/s$/, '')}</div>
      <div className="artifacts-title">{a.name}</div>
      <div className="caption">Answers: “{a.question}”</div>
      <div className="tiny muted">{[place?.name, src].filter(Boolean).join(' · ')}</div>
    </div>
  );

  switch (a.kind) {
    case 'layer': {
      const look = layerLook(a.layerId ?? '', a.name);
      const shown = a.layerId ? layerShown(a.layerId) : false;
      return (
        <div className="col" style={{ gap: 12 }}>
          {context}
          <div className="artifacts-legend">
            <div className="row" style={{ gap: 8 }}>
              <Ms n={look.icon} size={18} />
              <span style={{ font: '600 14px/1.38 var(--font)' }}>{look.label}</span>
            </div>
            <div className="artifacts-ramp" style={{ background: `linear-gradient(90deg, ${look.ramp.join(', ')})` }} />
            {look.legend && <div className="caption">{look.legend}</div>}
          </div>
          <div className="caption">
            {shown ? 'Shown on the map' : 'Not available on the map yet'}
            {place ? ` for ${place.name}` : ''}
            {a.date ? `, ${a.date}` : ''}. Choose another artifact to take it off again.
          </div>
        </div>
      );
    }
    case 'slider':
      return (
        <div className="col" style={{ gap: 12 }}>
          {context}
          {timeline ? <PassStepper timeline={timeline} index={dateIdx} onChange={onDateIdx} /> : <div className="tiny">No passes to step through.</div>}
          <div className="caption">Moves the date shown on the map.</div>
        </div>
      );
    case 'compare':
      return (
        <div className="col" style={{ gap: 12 }}>
          <SatelliteCompare place={place ?? null} blocks={a.blocks} runId={a.runId} />
        </div>
      );
    default:
      return (
        <div className="col" style={{ gap: 12 }}>
          {context}
          {a.block && (
            <Block
              block={a.block}
              onPickScene={(scene) => {
                const i = timeline?.scenes.indexOf(scene) ?? -1;
                if (i >= 0) onDateIdx(i);
              }}
            />
          )}
        </div>
      );
  }
}
