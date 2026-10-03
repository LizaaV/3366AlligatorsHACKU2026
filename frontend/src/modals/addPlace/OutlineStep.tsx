/**
 * Step 2: check and adjust the outline.
 *
 * Whatever method located the place, the same tools are offered here: the AI boundary, a
 * centred circle or rectangle with sliders, drawing a polygon / rectangle / circle on the map,
 * and editing the vertices of whichever outline is current. The map can also be left for the
 * globe to re-pick the location.
 */

import { useState } from 'react';
import { ErrorState } from '../../components/async';
import { Btn, Ms } from '../../components/ui';
import type { Pt } from '../../lib/geo';
import type { Place } from '../../model';
import { GlobePicker } from './GlobePicker';
import { useMapHeight } from './MapFrame';
import { OutlineMap } from './OutlineMap';
import { Slider } from './Slider';
import { MIN_VERTICES, type Outline } from './useOutline';
import type { Loc, Shape, Tool } from './types';

const TOOLS: { id: Tool; icon: string; label: string }[] = [
  { id: 'edit', icon: 'edit_location_alt', label: 'Edit points' },
  { id: 'polygon', icon: 'pentagon', label: 'Polygon' },
  { id: 'rect', icon: 'crop_square', label: 'Rectangle' },
  { id: 'circle', icon: 'radio_button_unchecked', label: 'Circle' },
];

export function OutlineStep({ loc, draft, outline, onRelocate }: {
  loc: Loc;
  draft: Place;
  outline: Outline;
  /** The user picked a different spot on the globe. */
  onRelocate: (at: { lat: number; lon: number }) => void;
}) {
  const {
    shape, setShape, radius, setRadius, rw, setRw, rh, setRh, ha, detecting, detectError, retryDetect,
    isEdited, resetEdits, commitDrawn, drawn,
  } = outline;
  const [tool, setTool] = useState<Tool>('edit');
  const [verts, setVerts] = useState<Pt[]>([]);
  const [globe, setGlobe] = useState(false);
  const H = useMapHeight();

  const pickTool = (t: Tool) => { setVerts([]); setTool(t); };
  const finishPolygon = () => { commitDrawn(verts, false); setVerts([]); setTool('edit'); };

  const presets: { id: Shape; icon: string; label: string; ai?: boolean }[] = [
    ...(loc.pts ? [{ id: 'given' as Shape, icon: 'check_circle', label: loc.givenLabel ?? 'As provided' }] : []),
    { id: 'detected', icon: 'auto_awesome', label: 'Use AI boundary', ai: true },
    { id: 'circle', icon: 'radio_button_unchecked', label: 'Circle · set radius' },
    { id: 'rect', icon: 'crop_square', label: 'Rectangle · set size' },
    ...(drawn ? [{ id: 'drawn' as Shape, icon: 'draw', label: 'As drawn' }] : []),
  ];

  const hint: Record<Tool, string> = {
    edit: 'Drag a point to move it. Click a dot on an edge to add a point. Right-click, Alt-click, or select a point and press × to remove it.',
    polygon: verts.length < 3
      ? `Click the corners of your area (${verts.length}/${MIN_VERTICES} minimum).`
      : `${verts.length} points. Keep clicking to add corners, click the first point or press Finish to close the shape.`,
    rect: 'Press and drag from one corner to the opposite corner.',
    circle: 'Press at the centre and drag outwards to set the radius.',
  };

  return (
    <>
      <div className="row wrap" style={{ justifyContent: 'space-between', gap: 8 }}>
        <div>
          <div className="subhead">Check the outline</div>
          <div className="caption" style={{ marginTop: 2 }}>{loc.via}</div>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <span className="eyebrow">Area</span>
          <span style={{ font: '700 24px/1.17 var(--font)', letterSpacing: -0.5 }}>{ha.toLocaleString()}</span>
          <span className="body-sm">ha</span>
        </div>
      </div>

      <div className="seg" role="radiogroup" aria-label="Outline" style={{ flexWrap: 'wrap', alignSelf: 'flex-start', maxWidth: '100%' }}>
        {presets.map((o) => {
          const on = shape === o.id && !isEdited;
          return (
            <button key={o.id} role="radio" aria-checked={shape === o.id} className={on ? 'on' : ''} onClick={() => { setVerts([]); setShape(o.id); }}>
              <Ms n={o.icon} size={16} />
              {o.label}
              {o.ai && <span className="badge-ai" style={{ padding: '0 6px', fontSize: 10 }}>AI</span>}
            </button>
          );
        })}
      </div>

      {/* Detection used to run invisibly: while it was in flight the outline was empty, the area
          read 0 and Continue was disabled with nothing on screen explaining why. */}
      {shape === 'detected' && detecting && (
        <div className="row caption" style={{ gap: 8 }}>
          <span className="spinner" />
          <span>Looking for a field boundary here…</span>
        </div>
      )}
      {shape === 'detected' && detectError && !detecting && (
        <ErrorState error={detectError} onRetry={retryDetect} title="No boundary could be detected" compact />
      )}

      <div className="row wrap" style={{ gap: 8, justifyContent: 'space-between' }}>
        <div className="seg" role="radiogroup" aria-label="Map tool" style={{ flexWrap: 'wrap', maxWidth: '100%' }}>
          {TOOLS.map((t) => (
            <button key={t.id} role="radio" aria-checked={tool === t.id} className={tool === t.id ? 'on' : ''} onClick={() => pickTool(t.id)}>
              <Ms n={t.icon} size={16} />
              {t.label}
            </button>
          ))}
        </div>
        <div className="row wrap" style={{ gap: 4 }}>
          {tool === 'polygon' && verts.length > 0 && (
            <>
              <Btn size="sm" variant="text" icon="undo" onClick={() => setVerts(verts.slice(0, -1))}>Undo</Btn>
              <Btn size="sm" variant="primary" icon="check" disabled={verts.length < MIN_VERTICES} onClick={finishPolygon}>Finish</Btn>
            </>
          )}
          {isEdited && (
            <Btn size="sm" variant="text" icon="restart_alt" onClick={resetEdits}>
              {shape === 'detected' ? 'Reset to AI boundary' : 'Reset edits'}
            </Btn>
          )}
        </div>
      </div>

      {globe ? (
        <GlobePicker
          H={H}
          focus={loc}
          onBack={() => setGlobe(false)}
          hint="Click a spot on the globe to move the place there"
          onPick={(p) => { setGlobe(false); setVerts([]); setTool('edit'); onRelocate(p); }}
        />
      ) : (
        <OutlineMap loc={loc} draft={draft} outline={outline} tool={tool} setTool={setTool} verts={verts} setVerts={setVerts} onGlobe={() => setGlobe(true)} />
      )}
      <div className="caption">{globe ? 'Picking a new spot replaces the current outline.' : hint[tool]}</div>

      {!isEdited && shape === 'circle' && <Slider label="Radius" value={radius} min={50} max={2000} step={10} unit="m" onChange={setRadius} />}
      {!isEdited && shape === 'rect' && (
        <div className="row wrap" style={{ gap: 16 }}>
          <Slider label="Width (east–west)" value={rw} min={50} max={3000} step={10} unit="m" onChange={setRw} />
          <Slider label="Height (north–south)" value={rh} min={50} max={3000} step={10} unit="m" onChange={setRh} />
        </div>
      )}

      <div className="well row" style={{ padding: '10px 14px', gap: 10, alignItems: 'flex-start' }}>
        <Ms n="info" size={18} className="muted" style={{ marginTop: 1 }} />
        <div className="body-sm">
          {shape === 'detected' && !isEdited
            ? 'Auto-detected boundaries can be off by 10–20 m at field edges. Drag the points to correct them before running analyses.'
            : 'Satellite pixels are 10 m wide, so the outermost 10 m of any outline mixes with what is next to it.'}
          {ha < 1 && <span style={{ color: 'var(--yellow)' }}> Under 1 ha, free 10 m imagery gives fewer than 100 pixels — results will be less certain.</span>}
        </div>
      </div>
    </>
  );
}
