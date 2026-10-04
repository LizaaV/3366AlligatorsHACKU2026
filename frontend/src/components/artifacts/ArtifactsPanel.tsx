/**
 * The artifacts side of the Chat page: everything an answer produced that is not words
 * (then/now images, graphs, tables, notes), shown on the right while the chat on the left
 * stays short. The look and controls follow the artifacts panel on `main` (glass panel, a
 * picker grouped by kind, previous/next, expand, resize, collapse to a pill); the content is
 * this branch's blocks, with "show on map" for the rendered images.
 *
 * Artifacts are not stored anywhere of their own: they are the turns' blocks, so a reloaded
 * conversation shows the same ones.
 */

import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { Ms } from '../ui';
import { AnswerBlocks } from '../blocks';
import type { AnswerBlock } from '../../model';
import type { AskTurn } from '../../ask/useAskRun';
import './artifacts.css';

export type ArtifactKind = 'graph' | 'image' | 'compare' | 'table' | 'note';

export interface Artifact {
  /** `${turnId}:${blockId}`, stable across re-renders of the same conversation. */
  id: string;
  name: string;
  icon: string;
  kind: ArtifactKind;
  turnId: string;
  question: string;
  block: AnswerBlock;
}

export const KIND_META: Record<ArtifactKind, { label: string; icon: string }> = {
  graph: { label: 'Graphs', icon: 'show_chart' },
  image: { label: 'Images', icon: 'image' },
  compare: { label: 'Comparisons', icon: 'compare' },
  table: { label: 'Tables', icon: 'table_chart' },
  note: { label: 'Notes', icon: 'info' },
};

const KIND_ORDER: ArtifactKind[] = ['graph', 'image', 'compare', 'table', 'note'];

const BY_TYPE: Record<AnswerBlock['type'], { kind: ArtifactKind; icon: string }> = {
  then_now: { kind: 'image', icon: 'compare' },
  highlight: { kind: 'image', icon: 'image' },
  timeline: { kind: 'graph', icon: 'show_chart' },
  stat: { kind: 'graph', icon: 'monitoring' },
  scene_strip: { kind: 'compare', icon: 'satellite_alt' },
  hypotheses: { kind: 'table', icon: 'table_chart' },
  limits: { kind: 'note', icon: 'info' },
};

/** One artifact per block, the primary block of each answer first. */
export function artifactsOf(turns: AskTurn[]): Artifact[] {
  const out: Artifact[] = [];
  for (const t of turns) {
    const ordered = [...t.blocks].sort((a, b) => Number(b.primary) - Number(a.primary));
    for (const b of ordered) {
      const meta = BY_TYPE[b.type] ?? { kind: 'note' as const, icon: 'widgets' };
      out.push({ id: `${t.id}:${b.id}`, name: b.title || 'Result', icon: meta.icon, kind: meta.kind, turnId: t.id, question: t.text, block: b });
    }
  }
  return out;
}

export const MIN_PANEL_W = 320;
export const maxPanelW = (viewportW: number) => Math.max(MIN_PANEL_W, Math.round(viewportW * 0.65));
const STORE_KEY = 'artifacts.panelWidth';

/** The panel's width, remembered between visits. Storage may be blocked, so every access is guarded. */
export function usePanelWidth(viewportW: number, fallback: number): [number, (w: number) => void] {
  const [w, setW] = useState<number>(() => {
    try {
      const v = Number(window.localStorage.getItem(STORE_KEY));
      if (v >= MIN_PANEL_W) return v;
    } catch { /* blocked storage: use the default */ }
    return fallback;
  });
  const set = (next: number) => {
    const c = Math.min(Math.max(next, MIN_PANEL_W), maxPanelW(viewportW));
    setW(c);
    try { window.localStorage.setItem(STORE_KEY, String(Math.round(c))); } catch { /* ignore */ }
  };
  return [Math.min(Math.max(w, MIN_PANEL_W), maxPanelW(viewportW)), set];
}

export function ArtifactsPanel({
  artifacts,
  selectedId,
  onSelect,
  onClose,
  onShowOnMap,
  width,
  onResize,
  expanded = false,
  onExpand,
}: {
  artifacts: Artifact[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Collapse the panel to its pill. */
  onClose: () => void;
  onShowOnMap?: (turnId: string, layerKey: string) => void;
  width: number;
  onResize?: (w: number) => void;
  expanded?: boolean;
  onExpand?: (e: boolean) => void;
}) {
  const [menu, setMenu] = useState(false);
  const pick = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => { if (!pick.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [menu]);

  // Esc restores an expanded panel (or closes the menu first).
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (menu) setMenu(false);
      else if (expanded) onExpand?.(false);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [menu, expanded, onExpand]);

  const idx = Math.max(0, artifacts.findIndex((a) => a.id === selectedId));
  const current = artifacts[idx];
  if (!current) return null;
  const step = (d: number) => onSelect(artifacts[(idx + d + artifacts.length) % artifacts.length].id);

  return (
    <aside className={`artifacts-panel panel fade-up${expanded ? ' expanded' : ''}`} aria-label="Artifacts" style={{ width }}>
      {onResize && !expanded && <ResizeHandle width={width} onResize={onResize} />}
      <header className="artifacts-head">
        <div className="artifacts-pick" ref={pick}>
          <button type="button" className="artifacts-select" onClick={() => setMenu((m) => !m)} aria-haspopup="menu" aria-expanded={menu}>
            <Ms n={current.icon} size={18} />
            <span className="grow artifacts-name">{current.name}</span>
            <Ms n="expand_more" size={18} />
          </button>
          {menu && (
            <div className="menu artifacts-menu" role="menu">
              {KIND_ORDER.map((kind) => {
                const list = artifacts.filter((a) => a.kind === kind);
                if (!list.length) return null;
                return (
                  <div key={kind} role="group" aria-label={KIND_META[kind].label}>
                    <div className="eyebrow artifacts-group"><Ms n={KIND_META[kind].icon} size={14} />{KIND_META[kind].label}</div>
                    {list.map((a) => (
                      <button key={a.id} type="button" role="menuitem" className="menu-item" aria-current={a.id === current.id} onClick={() => { onSelect(a.id); setMenu(false); }}>
                        <Ms n={a.icon} />
                        <span className="grow artifacts-item">
                          <span className="artifacts-item-name">{a.name}</span>
                          <span className="caption artifacts-item-q">{a.question}</span>
                        </span>
                        {a.id === current.id && <Ms n="check" size={16} />}
                      </button>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <button type="button" className="icon-btn sm" onClick={() => step(-1)} aria-label="Previous artifact" title="Previous" disabled={artifacts.length < 2}><Ms n="chevron_left" /></button>
        <button type="button" className="icon-btn sm" onClick={() => step(1)} aria-label="Next artifact" title="Next" disabled={artifacts.length < 2}><Ms n="chevron_right" /></button>
        {onExpand && (
          <button type="button" className="icon-btn sm" onClick={() => onExpand(!expanded)} aria-label={expanded ? 'Restore size' : 'Expand'} title={expanded ? 'Restore (Esc)' : 'Expand'}>
            <Ms n={expanded ? 'close_fullscreen' : 'open_in_full'} />
          </button>
        )}
        <button type="button" className="icon-btn sm" onClick={onClose} aria-label="Collapse artifacts" title="Collapse"><Ms n="right_panel_close" /></button>
      </header>
      <div className="artifacts-body">
        <div className="artifacts-context" style={{ marginBottom: 12 }}>
          <div className="eyebrow">{KIND_META[current.kind].label.replace(/s$/, '')}</div>
          <div className="artifacts-title">{current.name}</div>
          <div className="caption">Answers: “{current.question}”</div>
          {sourceLine(current.block) && <div className="tiny muted">{sourceLine(current.block)}</div>}
        </div>
        <AnswerBlocks
          key={current.id}
          blocks={[current.block]}
          onShowOnMap={onShowOnMap ? (k) => onShowOnMap(current.turnId, k) : undefined}
        />
      </div>
    </aside>
  );
}

/** Date range and satellites a block was made from, for the context header. */
function sourceLine(b: AnswerBlock): string {
  const prov = 'provenance' in b && Array.isArray(b.provenance) ? b.provenance : [];
  const dates = prov.map((x) => String(x.date)).sort();
  const range = dates.length ? (dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} to ${dates[dates.length - 1]}`) : '';
  const sats = [...new Set(prov.map((x) => x.satellite))].join(', ');
  return [range, sats].filter(Boolean).join(' · ');
}

/** Drag the left edge to resize; the page keeps the width. */
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

/** The collapsed form: a small glass button that brings the panel back. */
export function ArtifactsPill({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button type="button" className="artifacts-pill glass" onClick={onOpen} aria-label={`Show artifacts, ${count}`}>
      <Ms n="dashboard_customize" size={16} />
      Artifacts · {count}
    </button>
  );
}

/** "See on the right:" and one chip per artifact the turn produced; clicking opens it. */
export function ArtifactChips({ list, selectedId, onSelect }: { list: Artifact[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (!list.length) return null;
  return (
    <div className="col" style={{ gap: 6, alignItems: 'flex-start' }}>
      <span className="tiny muted">See on the right</span>
      {list.map((a) => (
        <button key={a.id} className={`chip artifact-chip ${a.id === selectedId ? 'on' : ''}`} onClick={() => onSelect(a.id)} title={`Show “${a.name}”`} style={{ maxWidth: '100%', justifyContent: 'flex-start' }}>
          <Ms n={a.icon} size={14} />{a.name}
        </button>
      ))}
    </div>
  );
}
