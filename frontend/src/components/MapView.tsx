import { TILE, txy } from '../lib/geo';
import type { Place } from '../model';
import { hideBroken } from './ui';

interface Props {
  W: number;
  H: number;
  cx: number; // screen x of the map centre (map is shifted right of the chat panel on desktop)
  cy: number;
  center: { lat: number; lon: number };
  zoom: number;
  place: Place | null;
  /** Draw the place outline and its name / area label. On unless switched off. */
  outline?: boolean;
  /** A real rendered layer image from the run, pinned to its WGS84 bounds `[west, south, east, north]`. */
  raster?: { url: string; bounds: number[] } | null;
}

/** Basemap tiles with the place outline and, optionally, one real rendered layer image. */
export function MapView({ W, H, cx, cy, center, zoom, place, outline = true, raster }: Props) {
  const c = txy(center.lat, center.lon, zoom);
  const x0 = Math.floor(c.x - cx / 256) - 1, x1 = Math.floor(c.x + (W - cx) / 256) + 1;
  const y0 = Math.floor(c.y - cy / 256) - 1, y1 = Math.floor(c.y + (H - cy) / 256) + 1;
  const tiles: { url: string; left: number; top: number }[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push({ url: TILE(zoom, x, y), left: Math.round(cx + (x - c.x) * 256), top: Math.round(cy + (y - c.y) * 256) });

  let ov: null | { x: number; y: number; s: number; pts: string; labelTop: number; ha: number } = null;
  if (place) {
    const ft = txy(place.lat, place.lon, zoom);
    const sc = Math.pow(2, zoom - 16);
    const minY = Math.min(...place.pts.map((p) => p[1]));
    ov = {
      x: cx + (ft.x - c.x) * 256, y: cy + (ft.y - c.y) * 256, s: sc,
      pts: place.pts.map((p) => `${p[0] + 300},${p[1] + 300}`).join(' '),
      labelTop: minY - 36, ha: place.areaHa,
    };
  }
  // Real layer image: project its corners with the same tile maths as the basemap.
  let img: null | { left: number; top: number; width: number; height: number } = null;
  if (raster && raster.bounds.length === 4) {
    const [w, s, e, n] = raster.bounds;
    const nw = txy(n, w, zoom), se = txy(s, e, zoom);
    img = { left: cx + (nw.x - c.x) * 256, top: cy + (nw.y - c.y) * 256, width: (se.x - nw.x) * 256, height: (se.y - nw.y) * 256 };
  }
  return (
    <div style={{ position: 'absolute', inset: 0, background: '#0b0d10', overflow: 'hidden', animation: 'fadeIn .5s ease both' }}>
      {tiles.map((t) => (
        <img onError={hideBroken} key={t.url} src={t.url} alt="" draggable={false} style={{ position: 'absolute', left: t.left, top: t.top, width: 256, height: 256, userSelect: 'none' }} />
      ))}
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.12)', pointerEvents: 'none' }} />
      {raster && img && (
        <img src={raster.url} alt="" draggable={false} onError={hideBroken}
          style={{ position: 'absolute', left: img.left, top: img.top, width: img.width, height: img.height, opacity: 0.85, pointerEvents: 'none', userSelect: 'none', animation: 'fadeIn .4s ease both' }} />
      )}
      {ov && outline && (
        <div style={{ position: 'absolute', left: ov.x, top: ov.y, width: 0, height: 0, transform: `scale(${ov.s})`, transformOrigin: '0 0', pointerEvents: 'none' }}>
          <svg width="600" height="600" style={{ position: 'absolute', left: -300, top: -300, overflow: 'visible' }}>
            <polygon points={ov.pts} style={{ fill: 'none', stroke: '#fff', strokeWidth: 2 / Math.max(ov.s, 0.25) }} />
          </svg>
          <div style={{ position: 'absolute', left: -100, top: ov.labelTop, width: 200, display: 'flex', justifyContent: 'center', transform: `scale(${1 / Math.max(ov.s, 0.25)})`, transformOrigin: '50% 100%' }}>
            <div style={{ padding: '4px 10px', borderRadius: 9999, background: '#000', border: '1px solid #3b3d45', font: '600 12px/1.23 var(--font)', letterSpacing: 0.6, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
              {place!.name} · {ov.ha} ha
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
