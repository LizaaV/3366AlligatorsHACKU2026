/** Fixed-size MapView centred in a fluid frame, with zoom buttons and an optional overlay/click handler. */

import type { ReactNode } from 'react';
import { MapView, type MapLayers } from '../../components/MapView';
import { IconBtn } from '../../components/ui';
import { fmtC } from '../../lib/geo';
import type { Place } from '../../model';

export function MapFrame({ H, center, zoom, setZoom, place, layers, onPick, children }: {
  H: number; center: { lat: number; lon: number }; zoom: number; setZoom: (z: number) => void; place: Place | null; layers: MapLayers;
  onPick?: (dx16: number, dy16: number) => void; children?: (s: number, W: number, H: number) => ReactNode;
}) {
  const W = 700;
  const s = Math.pow(2, zoom - 16);
  return (
    <div style={{ position: 'relative', height: H, borderRadius: 'var(--r)', overflow: 'hidden', border: '1px solid var(--hair-soft)', background: '#0b0d10' }}>
      <div
        style={{ position: 'absolute', top: 0, left: '50%', width: W, height: H, marginLeft: -W / 2, cursor: onPick ? 'crosshair' : 'default' }}
        onClick={onPick ? (e) => {
          const r = e.currentTarget.getBoundingClientRect();
          onPick((e.clientX - r.left - W / 2) / s, (e.clientY - r.top - H / 2) / s);
        } : undefined}
      >
        <MapView W={W} H={H} cx={W / 2} cy={H / 2} center={center} zoom={zoom} place={place} layers={layers} dateIdx={7} />
        {children && (
          <svg width={W} height={H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
            {children(s, W, H)}
          </svg>
        )}
      </div>
      <div className="col" style={{ position: 'absolute', right: 8, top: 8, gap: 4 }}>
        <IconBtn icon="add" className="sm boxed" aria-label="Zoom in" onClick={() => setZoom(Math.min(18, zoom + 1))} />
        <IconBtn icon="remove" className="sm boxed" aria-label="Zoom out" onClick={() => setZoom(Math.max(3, zoom - 1))} />
      </div>
      <span className="tiny" style={{ position: 'absolute', left: 8, bottom: 6, color: 'var(--muted)', textShadow: '0 1px 2px #000' }}>
        Sentinel-2 cloudless · {fmtC(center.lat, center.lon)} · z{zoom}
      </span>
    </div>
  );
}
