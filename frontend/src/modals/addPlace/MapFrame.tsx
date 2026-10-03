/**
 * Fixed-size MapView centred in a fluid frame, with zoom buttons, an optional overlay and
 * optional pointer handlers.
 *
 * Zooming out past `GLOBE_AT` (button, or wheel) hands over to the globe via `onGlobe`, and a
 * Globe button is always shown when `onGlobe` is given — every map that selects an area can
 * therefore be left for the globe and re-entered by picking a spot on it.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MapView } from '../../components/MapView';
import { IconBtn } from '../../components/ui';
import { fmtC, type Pt } from '../../lib/geo';
import type { Place } from '../../model';

export const MIN_ZOOM = 3;
export const MAX_ZOOM = 18;
/** Zooming out from here or below switches to the globe. */
export const GLOBE_AT = 5;

/** Map height that follows the window: clamp(220px, 38vh, 420px), so short windows scroll the modal instead of squashing the map. */
export function useMapHeight() {
  const calc = () => Math.round(Math.max(220, Math.min(420, window.innerHeight * 0.38)));
  const [h, setH] = useState(calc);
  useEffect(() => {
    const on = () => setH(calc());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return h;
}

export interface PointerHandlers {
  /** All coordinates are reference-zoom pixel offsets from the map centre. */
  down?: (pt: Pt, e: React.PointerEvent<HTMLDivElement>) => void;
  move?: (pt: Pt, e: React.PointerEvent<HTMLDivElement>) => void;
  up?: (pt: Pt, e: React.PointerEvent<HTMLDivElement>) => void;
}

export function MapFrame({ H, center, zoom, setZoom, place, onPick, onGlobe, pointer, cursor, children }: {
  H: number; center: { lat: number; lon: number }; zoom: number; setZoom: (z: number) => void; place: Place | null;
  onPick?: (dx16: number, dy16: number) => void;
  onGlobe?: () => void;
  pointer?: PointerHandlers;
  cursor?: string;
  children?: (s: number, W: number, H: number, toPt: (e: { clientX: number; clientY: number }) => Pt) => ReactNode;
}) {
  const W = 700;
  const s = Math.pow(2, zoom - 16);
  const frame = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);

  const toPt = (e: { clientX: number; clientY: number }): Pt => {
    const r = inner.current!.getBoundingClientRect();
    return [(e.clientX - r.left - W / 2) / s, (e.clientY - r.top - H / 2) / s];
  };

  const zoomBy = (dir: 1 | -1) => {
    if (dir === 1) setZoom(Math.min(MAX_ZOOM, zoom + 1));
    else if (onGlobe && zoom <= GLOBE_AT) onGlobe();
    else setZoom(Math.max(MIN_ZOOM, zoom - 1));
  };

  // Wheel zoom needs a non-passive native listener to stop the modal scrolling underneath.
  const latest = useRef(zoomBy);
  latest.current = zoomBy;
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    let last = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const now = Date.now();
      if (now - last < 220) return;
      last = now;
      latest.current(e.deltaY < 0 ? 1 : -1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const interactive = !!pointer;
  return (
    <div ref={frame} style={{ position: 'relative', flex: 'none', height: H, borderRadius: 'var(--r)', overflow: 'hidden', border: '1px solid var(--hair-soft)', background: '#0b0d10' }}>
      <div
        ref={inner}
        style={{ position: 'absolute', top: 0, left: '50%', width: W, height: H, marginLeft: -W / 2, cursor: cursor ?? (onPick ? 'crosshair' : 'default'), touchAction: interactive ? 'none' : undefined }}
        onClick={onPick ? (e) => { const [x, y] = toPt(e); onPick(x, y); } : undefined}
        onPointerDown={pointer?.down ? (e) => pointer.down!(toPt(e), e) : undefined}
        onPointerMove={pointer?.move ? (e) => pointer.move!(toPt(e), e) : undefined}
        onPointerUp={pointer?.up ? (e) => pointer.up!(toPt(e), e) : undefined}
      >
        <MapView W={W} H={H} cx={W / 2} cy={H / 2} center={center} zoom={zoom} place={place} />
        {children && (
          <svg width={W} height={H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
            {children(s, W, H, toPt)}
          </svg>
        )}
      </div>
      <div className="col" style={{ position: 'absolute', right: 8, top: 8, gap: 4 }}>
        <IconBtn icon="add" className="sm boxed" aria-label="Zoom in" onClick={() => zoomBy(1)} />
        <IconBtn icon="remove" className="sm boxed" aria-label={onGlobe && zoom <= GLOBE_AT ? 'Zoom out to the globe' : 'Zoom out'} onClick={() => zoomBy(-1)} />
        {onGlobe && <IconBtn icon="public" className="sm boxed" aria-label="Show the globe" title="Show the globe" onClick={onGlobe} />}
      </div>
      <span className="tiny" style={{ position: 'absolute', left: 8, bottom: 6, color: 'var(--muted)', textShadow: '0 1px 2px #000', pointerEvents: 'none' }}>
        Sentinel-2 cloudless · {fmtC(center.lat, center.lon)} · z{zoom}
      </span>
    </div>
  );
}
