/**
 * SatelliteCompare: "What each satellite saw".
 *
 * Lists every pass the agent looked at, grouped by satellite, with a thumbnail, date, cloud
 * cover and whether it fed the decision. Pick up to two passes to compare them side by side
 * or with a draggable swipe divider, and switch the kind of picture (true colour, plant
 * health, moisture...) when a finished run id is available.
 */

import { useMemo, useRef, useState } from 'react';
import { Ms, hideBroken } from '../ui';
import { API_BASE } from '../../api/config';
import { cloudFromFraction } from '../../lib/format';
import { thumb } from '../../lib/geo';
import type { AnswerBlock, Place } from '../../model';
import { VIEWS, collectPasses, groupBySatellite, layerPngUrl, type Pass } from './passes';

type Mode = 'side' | 'swipe';

export function SatelliteCompare({
  place,
  blocks,
  runId,
  onClose,
}: {
  place: Place | null;
  blocks: AnswerBlock[];
  runId?: string;
  onClose?: () => void;
}) {
  const passes = useMemo(() => collectPasses(blocks), [blocks]);
  const groups = useMemo(() => groupBySatellite(passes), [passes]);
  const [picked, setPicked] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>('side');
  const [viewId, setViewId] = useState('true');

  const view = VIEWS.find((v) => v.id === viewId) ?? VIEWS[0];
  const byScene = (s: string) => passes.find((p) => p.scene === s);
  const selected = picked.map(byScene).filter((p): p is Pass => !!p);

  const toggle = (scene: string) =>
    setPicked((cur) => (cur.includes(scene) ? cur.filter((s) => s !== scene) : cur.length >= 2 ? [cur[1], scene] : [...cur, scene]));

  const imageFor = (p: Pass): string[] => {
    // Candidate sources, best first; the Picture component falls through on a load error.
    const out: string[] = [];
    if (view.measure && runId) out.push(layerPngUrl(API_BASE, runId, view.measure, p.scene));
    if (!view.measure && p.imageUrl) out.push(p.imageUrl);
    if (place) out.push(thumb(place.lat, place.lon, Math.min(Math.max(place.zoom, 3), 17)));
    return out;
  };

  return (
    <section className="panel" aria-label="What each satellite saw" style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
      <header className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
        <div className="col" style={{ flex: 1, minWidth: 0 }}>
          <span className="eyebrow">Compare</span>
          <h3 style={{ margin: 0, font: '600 16px/1.3 var(--font)' }}>What each satellite saw</h3>
          {place && <span className="tiny">{place.name}</span>}
        </div>
        {onClose && (
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close" title="Close">
            <Ms n="close" size={20} />
          </button>
        )}
      </header>

      {passes.length === 0 ? (
        <div className="col" style={{ gap: 6, alignItems: 'flex-start', padding: '8px 0' }}>
          <Ms n="satellite_alt" size={28} style={{ color: 'var(--subtle)' }} />
          <span style={{ font: '600 14px/1.38 var(--font)' }}>Nothing to compare yet</span>
          <span className="tiny">Ask a question about this place. Once the answer is ready, every image the agent looked at will be listed here.</span>
        </div>
      ) : (
        <>
          <div className="row wrap" style={{ gap: 8, justifyContent: 'space-between' }}>
            <div className="seg" role="group" aria-label="Comparison style">
              <button type="button" className={mode === 'side' ? 'on' : ''} onClick={() => setMode('side')}>Side by side</button>
              <button type="button" className={mode === 'swipe' ? 'on' : ''} onClick={() => setMode('swipe')}>Swipe</button>
            </div>
            <label className="row tiny" style={{ gap: 6 }}>
              View
              <select
                value={viewId}
                onChange={(e) => setViewId(e.target.value)}
                aria-label="Kind of picture"
                style={{ background: 'var(--s2)', color: '#fff', border: '1px solid var(--hair)', borderRadius: 6, padding: '5px 8px', font: '500 13px/1.3 var(--font)' }}
              >
                {VIEWS.map((v) => (
                  <option key={v.id} value={v.id} disabled={!!v.measure && !runId}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <Stage selected={selected} mode={mode} imageFor={imageFor} />

          <span className="tiny">
            {selected.length === 0 && 'Tap a pass below to look at it. Pick a second one to compare.'}
            {selected.length === 1 && 'Pick a second pass to compare.'}
            {selected.length === 2 && 'Comparing two passes. Tap one to swap it out.'}
          </span>

          <div className="col" style={{ gap: 12 }}>
            {groups.map((g) => (
              <div key={g.satellite} className="col" style={{ gap: 6 }}>
                <span className="eyebrow">
                  {g.satellite} · {g.passes.length} {g.passes.length === 1 ? 'pass' : 'passes'}
                </span>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6, gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                  {g.passes.map((p) => (
                    <PassCard key={p.scene} pass={p} src={imageFor(p)} on={picked.includes(p.scene)} onClick={() => toggle(p.scene)} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ pieces */

/** An image that falls through a list of sources if one fails to load (e.g. a layer not rendered yet). */
function Picture({ srcs, alt, style }: { srcs: string[]; alt: string; style?: React.CSSProperties }) {
  const [fails, setFails] = useState(0);
  // Reset the fall-through when the candidate list changes.
  const key = srcs.join('|');
  const lastKey = useRef(key);
  if (lastKey.current !== key) {
    lastKey.current = key;
    if (fails !== 0) setFails(0);
  }
  const src = srcs[fails];
  if (!src) return <div style={{ background: 'var(--s3)', ...style }} aria-label={alt} />;
  return (
    <img
      src={src}
      alt={alt}
      draggable={false}
      onError={(e) => {
        if (fails < srcs.length - 1) setFails(fails + 1);
        else hideBroken(e);
      }}
      style={{ objectFit: 'cover', width: '100%', height: '100%', display: 'block', ...style }}
    />
  );
}

function PassCard({ pass, src, on, onClick }: { pass: Pass; src: string[]; on: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        aria-pressed={on}
        title={pass.why ?? undefined}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: 6,
          borderRadius: 8,
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          background: on ? 'var(--s2)' : 'transparent',
          border: `1px solid ${on ? '#fff' : 'var(--hair-soft)'}`,
          opacity: pass.used ? 1 : 0.65,
          color: 'inherit',
        }}
      >
        <div style={{ aspectRatio: '4 / 3', borderRadius: 5, overflow: 'hidden', background: 'var(--s3)' }}>
          <Picture srcs={src} alt={`${pass.satellite}, ${pass.date}`} />
        </div>
        <div className="row" style={{ gap: 4, justifyContent: 'space-between' }}>
          <span style={{ font: '600 12px/1.3 var(--font)' }}>{longDate(pass.date)}</span>
          <span className="tiny">{pass.cloud === null ? 'cloud ?' : `${cloudFromFraction(pass.cloud)} cloud`}</span>
        </div>
        <span className="tiny row" style={{ gap: 4, color: pass.used ? 'var(--green)' : 'var(--subtle)' }}>
          <Ms n={pass.used ? 'check_circle' : 'block'} size={13} />
          {pass.used ? 'Used for the answer' : (pass.why ?? 'Not used')}
        </span>
      </button>
    </li>
  );
}

function Stage({ selected, mode, imageFor }: { selected: Pass[]; mode: Mode; imageFor: (p: Pass) => string[] }) {
  if (selected.length === 0) {
    return (
      <div className="tiny" style={{ aspectRatio: '16 / 8', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 8, background: 'var(--s2)' }}>
        Nothing selected
      </div>
    );
  }
  if (selected.length === 1) {
    return (
      <figure style={{ margin: 0, position: 'relative', aspectRatio: '16 / 10', borderRadius: 8, overflow: 'hidden', background: 'var(--s3)' }}>
        <Picture srcs={imageFor(selected[0])} alt={`${selected[0].satellite}, ${selected[0].date}`} />
        <Tag side="left" pass={selected[0]} />
      </figure>
    );
  }
  const [a, b] = selected;
  return mode === 'side' ? (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
      {[a, b].map((p) => (
        <figure key={p.scene} style={{ margin: 0, position: 'relative', aspectRatio: '4 / 3', borderRadius: 8, overflow: 'hidden', background: 'var(--s3)' }}>
          <Picture srcs={imageFor(p)} alt={`${p.satellite}, ${p.date}`} />
          <Tag side="left" pass={p} />
        </figure>
      ))}
    </div>
  ) : (
    <Swipe a={a} b={b} imageFor={imageFor} />
  );
}

/** Two passes stacked with a draggable divider: `a` shows left of it, `b` right of it. */
function Swipe({ a, b, imageFor }: { a: Pass; b: Pass; imageFor: (p: Pass) => string[] }) {
  const [pos, setPos] = useState(50);
  const box = useRef<HTMLDivElement>(null);

  const move = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  };

  return (
    <div
      ref={box}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e.clientX);
      }}
      style={{ position: 'relative', aspectRatio: '16 / 10', borderRadius: 8, overflow: 'hidden', background: 'var(--s3)', touchAction: 'none', cursor: 'ew-resize', userSelect: 'none' }}
    >
      <div style={{ position: 'absolute', inset: 0 }}>
        <Picture srcs={imageFor(b)} alt={`${b.satellite}, ${b.date}`} />
      </div>
      <div style={{ position: 'absolute', inset: 0, clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        <Picture srcs={imageFor(a)} alt={`${a.satellite}, ${a.date}`} />
      </div>
      <div aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, left: `${pos}%`, width: 2, marginLeft: -1, background: '#fff' }} />
      <div
        role="slider"
        tabIndex={0}
        aria-label={`Swipe between ${a.date} and ${b.date}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pos)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') setPos((p) => Math.max(0, p - 5));
          if (e.key === 'ArrowRight') setPos((p) => Math.min(100, p + 5));
        }}
        style={{ position: 'absolute', top: '50%', left: `${pos}%`, width: 30, height: 30, marginLeft: -15, marginTop: -15, borderRadius: '50%', background: '#fff', color: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <Ms n="drag_indicator" size={18} />
      </div>
      <Tag side="left" pass={a} />
      <Tag side="right" pass={b} />
    </div>
  );
}

const Tag = ({ side, pass }: { side: 'left' | 'right'; pass: Pass }) => (
  <span
    className="tiny"
    style={{ position: 'absolute', top: 8, [side]: 8, padding: '2px 6px', borderRadius: 4, background: 'rgba(0,0,0,.6)', color: '#fff', pointerEvents: 'none' }}
  >
    {pass.satellite} · {longDate(pass.date)}
  </span>
);

/** "2026-09-30" -> "30 Sep 2026". Plain ISO days, so format in UTC to avoid a day shift. */
function longDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
