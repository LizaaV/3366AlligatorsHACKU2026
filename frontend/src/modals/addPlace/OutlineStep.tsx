/** Step 2: check and adjust the outline. */

import { ErrorState } from '../../components/async';
import { Ms } from '../../components/ui';
import type { Place } from '../../model';
import { MapFrame } from './MapFrame';
import { Slider } from './Slider';
import { CONTOUR, type Loc, type Shape } from './types';
import type { Outline } from './useOutline';

export function OutlineStep({ loc, draft, outline }: { loc: Loc; draft: Place; outline: Outline }) {
  const { shape, setShape, radius, setRadius, rw, setRw, rh, setRh, previewZoom, setZoom, ha, detecting, detectError, retryDetect } = outline;

  const shapeOpts: { id: Shape; icon: string; label: string; ai?: boolean }[] = [
    ...(loc.pts ? [{ id: 'given' as Shape, icon: 'check_circle', label: loc.givenLabel ?? 'As provided' }] : []),
    // Grown from the latest clear Sentinel-2 scene by POST /places/detect-boundary.
    { id: 'detected', icon: 'auto_awesome', label: 'Detect the field', ai: true },
    { id: 'circle', icon: 'radio_button_unchecked', label: 'Circle' },
    { id: 'rect', icon: 'crop_square', label: 'Rectangle' },
  ];

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

      <div className="seg" role="radiogroup" aria-label="Outline shape" style={{ flexWrap: 'wrap', alignSelf: 'flex-start', maxWidth: '100%' }}>
        {shapeOpts.map((o) => (
          <button key={o.id} role="radio" aria-checked={shape === o.id} className={shape === o.id ? 'on' : ''} onClick={() => setShape(o.id)}>
            <Ms n={o.icon} size={16} />
            {o.label}
            {o.ai && <span className="badge-ai" style={{ padding: '0 6px', fontSize: 10 }}>AI</span>}
          </button>
        ))}
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

      <MapFrame H={300} center={{ lat: loc.lat, lon: loc.lon }} zoom={previewZoom} setZoom={setZoom} place={draft} layers={CONTOUR} />

      {shape === 'circle' && <Slider label="Radius" value={radius} min={50} max={2000} step={10} unit="m" onChange={setRadius} />}
      {shape === 'rect' && (
        <div className="row wrap" style={{ gap: 16 }}>
          <Slider label="Width (east–west)" value={rw} min={50} max={3000} step={10} unit="m" onChange={setRw} />
          <Slider label="Height (north–south)" value={rh} min={50} max={3000} step={10} unit="m" onChange={setRh} />
        </div>
      )}

      <div className="well row" style={{ padding: '10px 14px', gap: 10, alignItems: 'flex-start' }}>
        <Ms n="info" size={18} className="muted" style={{ marginTop: 1 }} />
        <div className="body-sm">
          {shape === 'detected'
            ? 'Auto-detected boundaries can be off by 10–20 m at field edges. Adjust before running analyses.'
            : shape === 'given' && loc.source === 'parcel'
              ? 'Registered parcel boundaries are legal lines — the planted area inside can differ. Results are reported for the full parcel.'
              : 'Satellite pixels are 10 m wide, so the outermost 10 m of any outline mixes with what is next to it.'}
          {ha < 1 && <span style={{ color: 'var(--yellow)' }}> Under 1 ha, free 10 m imagery gives fewer than 100 pixels — results will be less certain.</span>}
        </div>
      </div>
    </>
  );
}
