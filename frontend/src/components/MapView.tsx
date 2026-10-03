import { useRef } from 'react';
import { TILE, txy } from '../lib/geo';
import type { MapImage, Place } from '../model';
import { Ms, hideBroken } from './ui';

/** What the small add-place maps draw: only the outline. */
export interface MapLayers { contour: boolean }

interface Props {
  W: number;
  H: number;
  cx: number; // screen x of the map centre (map is shifted right of the chat panel on desktop)
  cy: number;
  center: { lat: number; lon: number };
  zoom: number;
  place: Place | null;
  /** Draw the place's outline and label. */
  contour: boolean;
  /** A real image the agent rendered (then/now), placed by its WGS84 bounds. */
  overlay?: MapImage | null;
  pass?: string | null; // satellite name to draw a ground-track for while the agent routes
  /** A picked spot: pin plus the circle a question about it covers. */
  pin?: { lat: number; lon: number; radiusM: number } | null;
  /** `{z}/{x}/{y}` tiles of a live satellite band drawn over the basemap. */
  bandTiles?: string | null;
  /** Drag to pan, wheel to zoom, click to tap. Without these the map is static. */
  onCenter?: (c: { lat: number; lon: number }) => void;
  onZoom?: (z: number) => void;
  onTap?: (lat: number, lon: number) => void;
}

/** Inverse of `txy`: fractional tile coordinates at zoom `z` -> lat/lon. */
const fromTxy = (x: number, y: number, z: number) => {
  const n = Math.pow(2, z);
  return { lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI, lon: (x / n) * 360 - 180 };
};

/** Basemap tiles, the place outline, and the run's own rendered layer on top. */
export function MapView({ W, H, cx, cy, center, zoom, place, contour, overlay, pass, pin, bandTiles, onCenter, onZoom, onTap }: Props) {
  const drag = useRef<{ x: number; y: number; moved: number; c: { x: number; y: number } } | null>(null);
  const lastWheel = useRef(0);
  const interactive = !!(onCenter || onZoom || onTap);
  const c = txy(center.lat, center.lon, zoom);
  const x0 = Math.floor(c.x - cx / 256) - 1, x1 = Math.floor(c.x + (W - cx) / 256) + 1;
  const y0 = Math.floor(c.y - cy / 256) - 1, y1 = Math.floor(c.y + (H - cy) / 256) + 1;
  const tiles: { url: string; left: number; top: number }[] = [];
  const band: typeof tiles = [];
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++) {
      const left = Math.round(cx + (x - c.x) * 256), top = Math.round(cy + (y - c.y) * 256);
      tiles.push({ url: TILE(zoom, x, y), left, top });
      // Sentinel-2 is 10 m, so above zoom 17 its tiles are just upsampled; titiler handles it.
      if (bandTiles) band.push({ url: bandTiles.replace('{z}', String(zoom)).replace('{x}', String(x)).replace('{y}', String(y)), left, top });
    }

  const pointer = interactive
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, moved: 0, c: { x: c.x, y: c.y } };
        },
        onPointerMove: (e: React.PointerEvent) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x, dy = e.clientY - d.y;
          d.moved = Math.max(d.moved, Math.abs(dx) + Math.abs(dy));
          if (d.moved > 4 && onCenter) onCenter(fromTxy(d.c.x - dx / 256, d.c.y - dy / 256, zoom));
        },
        onPointerUp: (e: React.PointerEvent) => {
          const d = drag.current;
          drag.current = null;
          if (!d || d.moved > 4 || !onTap) return;
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const p = fromTxy(c.x + (e.clientX - r.left - cx) / 256, c.y + (e.clientY - r.top - cy) / 256, zoom);
          onTap(p.lat, p.lon);
        },
        onWheel: (e: React.WheelEvent) => {
          if (!onZoom || Math.abs(e.deltaY) < 4) return;
          const now = Date.now();
          if (now - lastWheel.current < 220) return;
          lastWheel.current = now;
          onZoom(Math.max(3, Math.min(18, zoom + (e.deltaY < 0 ? 1 : -1))));
        },
      }
    : {};

  let pinPx: null | { x: number; y: number; r: number } = null;
  if (pin) {
    const p = txy(pin.lat, pin.lon, zoom);
    const mPerPx = (156543.03 * Math.cos((pin.lat * Math.PI) / 180)) / Math.pow(2, zoom);
    pinPx = { x: cx + (p.x - c.x) * 256, y: cy + (p.y - c.y) * 256, r: pin.radiusM / mPerPx };
  }

  // Screen position of a lat/lon at this zoom and centre.
  const screen = (lat: number, lon: number) => {
    const p = txy(lat, lon, zoom);
    return { x: cx + (p.x - c.x) * 256, y: cy + (p.y - c.y) * 256 };
  };

  let ov: null | { x: number; y: number; s: number; pts: string; labelTop: number; ha: number } = null;
  if (place) {
    const ft = screen(place.lat, place.lon);
    const sc = Math.pow(2, zoom - 16);
    const minY = Math.min(...place.pts.map((p) => p[1]));
    ov = { x: ft.x, y: ft.y, s: sc, pts: place.pts.map((p) => `${p[0] + 300},${p[1] + 300}`).join(' '), labelTop: minY - 36, ha: place.areaHa };
  }

  let img: null | { left: number; top: number; width: number; height: number } = null;
  if (overlay) {
    const [w, s, e, n] = overlay.bounds;
    const nw = screen(n, w), se = screen(s, e);
    img = { left: nw.x, top: nw.y, width: se.x - nw.x, height: se.y - nw.y };
  }

  return (
    <div {...pointer} style={{ position: 'absolute', inset: 0, background: '#0b0d10', overflow: 'hidden', animation: 'fadeIn .5s ease both', cursor: interactive ? 'grab' : undefined, touchAction: interactive ? 'none' : undefined }}>
      {tiles.map((t) => (
        <img onError={hideBroken} key={t.url} src={t.url} alt="" draggable={false} style={{ position: 'absolute', left: t.left, top: t.top, width: 256, height: 256, userSelect: 'none', pointerEvents: 'none' }} />
      ))}
      {band.map((t) => (
        <img onError={hideBroken} key={t.url} src={t.url} alt="" draggable={false} style={{ position: 'absolute', left: t.left, top: t.top, width: 256, height: 256, userSelect: 'none', pointerEvents: 'none', opacity: 0.92 }} />
      ))}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.12)', pointerEvents: 'none' }} />
      {overlay && img && (
        <img
          key={overlay.url}
          src={overlay.url}
          alt={overlay.label}
          onError={hideBroken}
          draggable={false}
          style={{ position: 'absolute', ...img, opacity: 0.85, imageRendering: 'pixelated', pointerEvents: 'none', animation: 'fadeIn .3s ease both' }}
        />
      )}
      {ov && (
        <div style={{ position: 'absolute', left: ov.x, top: ov.y, width: 0, height: 0, transform: `scale(${ov.s})`, transformOrigin: '0 0', pointerEvents: 'none' }}>
          <svg width="600" height="600" style={{ position: 'absolute', left: -300, top: -300, overflow: 'visible' }}>
            <polygon points={ov.pts} style={{ fill: 'none', stroke: '#fff', strokeWidth: 2 / Math.max(ov.s, 0.25), opacity: contour ? 1 : 0 }} />
            <circle cx="300" cy="300" r="4" style={{ fill: '#fff', opacity: contour ? 1 : 0 }} />
          </svg>
          <div style={{ position: 'absolute', left: -100, top: ov.labelTop, width: 200, display: 'flex', justifyContent: 'center', opacity: contour ? 1 : 0, transform: `scale(${1 / Math.max(ov.s, 0.25)})`, transformOrigin: '50% 100%' }}>
            <div style={{ padding: '4px 10px', borderRadius: 9999, background: '#000', border: '1px solid #3b3d45', font: '600 12px/1.23 var(--font)', letterSpacing: 0.6, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
              {place!.name} · {ov.ha} ha
            </div>
          </div>
        </div>
      )}
      {pinPx && (
        <div style={{ position: 'absolute', left: pinPx.x, top: pinPx.y, width: 0, height: 0, pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: -pinPx.r, top: -pinPx.r, width: pinPx.r * 2, height: pinPx.r * 2, borderRadius: '50%', border: '1.5px dashed rgba(255,255,255,.85)', background: 'rgba(255,255,255,.06)' }} />
          <div style={{ position: 'absolute', left: -7, top: -7, width: 14, height: 14, borderRadius: '50%', background: '#fff', boxShadow: '0 0 0 3px #000, 0 0 0 5px rgba(255,255,255,.5)' }} />
        </div>
      )}
      {pass && (
        <div style={{ position: 'absolute', left: cx - 90, top: 24, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 9999, background: '#000', border: '1px solid #2b89ff', font: '600 12px/1.38 var(--font)', animation: 'fadeUp .3s ease both' }}>
          <Ms n="satellite_alt" size={16} style={{ color: '#2b89ff' }} />
          Searching {pass} passes…
        </div>
      )}
    </div>
  );
}
