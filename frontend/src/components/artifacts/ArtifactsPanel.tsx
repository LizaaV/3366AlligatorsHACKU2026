/**
 * The artifacts side of the Chat page: everything an answer produced that is not words
 * (then/now images, graphs, tables, notes), shown on the right while the chat on the left
 * stays short. Modelled on the artifacts panel on `main`, cut down to what this branch needs.
 *
 * Artifacts are not stored anywhere of their own: they are the turns' blocks, so a reloaded
 * conversation shows the same ones.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Ms, IconBtn } from '../ui';
import { AnswerBlocks } from '../blocks';
import type { AnswerBlock } from '../../model';
import type { AskTurn } from '../../ask/useAskRun';

export interface Artifact {
  /** `${turnId}:${blockId}`, stable across re-renders of the same conversation. */
  id: string;
  name: string;
  icon: string;
  turnId: string;
  question: string;
  block: AnswerBlock;
}

const ICON: Record<AnswerBlock['type'], string> = {
  then_now: 'compare',
  timeline: 'show_chart',
  scene_strip: 'satellite_alt',
  highlight: 'image',
  hypotheses: 'table_chart',
  stat: 'monitoring',
  limits: 'info',
};

/** One artifact per block, the primary block of each answer first. */
export function artifactsOf(turns: AskTurn[]): Artifact[] {
  const out: Artifact[] = [];
  for (const t of turns) {
    const ordered = [...t.blocks].sort((a, b) => Number(b.primary) - Number(a.primary));
    for (const b of ordered) {
      out.push({ id: `${t.id}:${b.id}`, name: b.title || 'Result', icon: ICON[b.type] ?? 'widgets', turnId: t.id, question: t.text, block: b });
    }
  }
  return out;
}

export function ArtifactsPanel({
  artifacts,
  selectedId,
  onSelect,
  onClose,
  onShowOnMap,
  width,
}: {
  artifacts: Artifact[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  onShowOnMap?: (turnId: string, layerKey: string) => void;
  width: number;
}) {
  const [menu, setMenu] = useState(false);
  const pick = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const down = (e: MouseEvent) => pick.current && !pick.current.contains(e.target as Node) && setMenu(false);
    window.addEventListener('mousedown', down);
    return () => window.removeEventListener('mousedown', down);
  }, [menu]);

  const idx = Math.max(0, artifacts.findIndex((a) => a.id === selectedId));
  const current = artifacts[idx];
  // Group the menu by the question that produced each artifact.
  const groups = useMemo(() => {
    const m = new Map<string, Artifact[]>();
    for (const a of artifacts) m.set(a.turnId, [...(m.get(a.turnId) ?? []), a]);
    return [...m.values()];
  }, [artifacts]);
  if (!current) return null;
  const step = (d: number) => onSelect(artifacts[(idx + d + artifacts.length) % artifacts.length].id);

  return (
    <aside className="panel col fade-up" aria-label="Artifacts" style={{ position: 'absolute', right: 20, top: 90, bottom: 24, width, zIndex: 21, overflow: 'hidden' }}>
      <header className="row" style={{ gap: 6, padding: '8px 8px 8px 12px', borderBottom: '1px solid var(--hair-soft)', flex: 'none' }}>
        <div ref={pick} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
          <button onClick={() => setMenu((m) => !m)} className="row" aria-haspopup="menu" aria-expanded={menu} style={{ width: '100%', gap: 8, padding: '4px 0', background: 'transparent', border: 0, color: '#fff', textAlign: 'left' }}>
            <Ms n={current.icon} size={18} />
            <span className="grow" style={{ font: '600 14px/1.35 var(--font)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current.name}</span>
            <Ms n="arrow_drop_down" size={18} className="muted" />
          </button>
          {menu && (
            <div className="menu" role="menu" style={{ left: -4, top: 36, width: Math.min(width - 16, 360), maxHeight: 380, overflowY: 'auto' }}>
              {groups.map((g) => (
                <div key={g[0].turnId}>
                  <div className="menu-label eyebrow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={g[0].question}>{g[0].question}</div>
                  {g.map((a) => (
                    <button key={a.id} role="menuitem" className={`menu-item ${a.id === current.id ? 'on' : ''}`} onClick={() => { onSelect(a.id); setMenu(false); }}>
                      <Ms n={a.icon} />
                      <span className="grow">{a.name}</span>
                      {a.id === current.id && <Ms n="check" size={18} />}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        {artifacts.length > 1 && (
          <>
            <span className="tiny muted" style={{ whiteSpace: 'nowrap' }}>{idx + 1} / {artifacts.length}</span>
            <IconBtn icon="chevron_left" className="sm" onClick={() => step(-1)} aria-label="Previous artifact" />
            <IconBtn icon="chevron_right" className="sm" onClick={() => step(1)} aria-label="Next artifact" />
          </>
        )}
        <IconBtn icon="close" className="sm" onClick={onClose} aria-label="Hide artifacts" />
      </header>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14 }}>
        <div className="tiny muted" style={{ marginBottom: 10 }}>From: {current.question}</div>
        <AnswerBlocks
          key={current.id}
          blocks={[current.block]}
          onShowOnMap={onShowOnMap ? (k) => onShowOnMap(current.turnId, k) : undefined}
        />
      </div>
    </aside>
  );
}

/** The collapsed form: a small button that brings the panel back. */
export function ArtifactsPill({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <button className="panel row" onClick={onOpen} aria-label={`Show artifacts, ${count}`} style={{ position: 'absolute', right: 20, top: 90, zIndex: 21, gap: 8, padding: '8px 12px', border: 0, color: '#fff', font: '600 13px/1.3 var(--font)' }}>
      <Ms n="dashboard" size={18} />Artifacts · {count}
    </button>
  );
}

/** "See:" and one chip per artifact the turn produced; clicking opens it on the right. */
export function ArtifactChips({ list, selectedId, onSelect }: { list: Artifact[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (!list.length) return null;
  return (
    <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
      <span className="tiny muted">See on the right:</span>
      {list.map((a) => (
        <button key={a.id} className={`chip ${a.id === selectedId ? 'on' : ''}`} style={{ padding: '3px 10px' }} onClick={() => onSelect(a.id)} title={`Show “${a.name}”`}>
          <Ms n={a.icon} size={14} style={{ marginRight: 4 }} />{a.name}
        </button>
      ))}
    </div>
  );
}
