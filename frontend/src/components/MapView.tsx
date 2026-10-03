import { DRY_PATH, TILE, txy } from '../lib/geo';
import type { PassTimeline } from '../model';
import type { Place } from '../model';
import { Ms, hideBroken } from './ui';

export interface MapLayers { contour: boolean; ndmi: boolean; ndvi: boolean; lst: boolean; dry: boolean; clouds: boolean; }

interface Props {
  W: number;
  H: number;
  cx: number; // screen x of the map centre (map is shifted right of the chat panel on desktop)
  cy: number;
  center: { lat: number; lon: number };
  zoom: number;
  place: Place | null;
  layers: MapLayers;
  dateIdx: number;
  pass?: string | null; // satellite name to draw a ground-track for while the agent routes
  /**
   * Per-pass timeline from the answer: which passes were cloudy and how strong the detected
   * feature was on each. Previously hardcoded in the frontend; now part of the API response.
   */
  timeline?: PassTimeline | null;
  /** A real rendered layer image from the run, pinned to its WGS84 bounds `[west, south, east, north]`. */
  raster?: { url: string; bounds: number[] } | null;
}

/** Sentinel-2 tile map with the AI overlay stack from the prototype. */
export function MapView({ W, H, cx, cy, center, zoom, place, layers, dateIdx, pass, timeline, raster }: Props) {
  const c = txy(center.lat, center.lon, zoom);
  const x0 = Math.floor(c.x - cx / 256) - 1, x1 = Math.floor(c.x + (W - cx) / 256) + 1;
  const y0 = Math.floor(c.y - cy / 256) - 1, y1 = Math.floor(c.y + (H - cy) / 256) + 1;
  const tiles: { url: string; left: number; top: number }[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push({ url: TILE(zoom, x, y), left: Math.round(cx + (x - c.x) * 256), top: Math.round(cy + (y - c.y) * 256) });

  let ov: null | { x: number; y: number; s: number; pts: string; clip: string; labelTop: number; ha: number } = null;
  if (place) {
    const ft = txy(place.lat, place.lon, zoom);
    const sc = Math.pow(2, zoom - 16);
    const minY = Math.min(...place.pts.map((p) => p[1]));
    ov = {
      x: cx + (ft.x - c.x) * 256, y: cy + (ft.y - c.y) * 256, s: sc,
      pts: place.pts.map((p) => `${p[0] + 300},${p[1] + 300}`).join(' '),
      clip: `polygon(${place.pts.map((p) => `${p[0] + 300}px ${p[1] + 300}px`).join(',')})`,
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
  // Feature intensity and cloudiness for the pass being shown. No timeline (a general answer,
  // or a place with no run yet) means no agent overlays to animate.
  const dl = timeline?.intensity[dateIdx] ?? 0;
  const circ = !!place?.circle;
  const cloudy = timeline?.cloudyIndices.includes(dateIdx) ?? false;
  const mask = 'conic-gradient(from 0deg,transparent 0deg,#000 18deg,#000 88deg,transparent 108deg)';
  const arc: React.CSSProperties = { position: 'absolute', inset: 0, WebkitMaskImage: mask, maskImage: mask, transition: 'opacity .4s' };
  const fill: React.CSSProperties = { position: 'absolute', inset: 0, transition: 'opacity .4s' };

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
      {ov && (
        <div style={{ position: 'absolute', left: ov.x, top: ov.y, width: 0, height: 0, transform: `scale(${ov.s})`, transformOrigin: '0 0', pointerEvents: 'none' }}>
          <div style={{ position: 'absolute', left: -300, top: -300, width: 600, height: 600, clipPath: ov.clip }}>
            <div style={{ ...fill, background: 'rgba(20,198,203,.42)', opacity: layers.ndmi ? 1 : 0 }} />
            <div style={{ ...arc, background: 'radial-gradient(circle at 50% 50%,transparent 128px,rgba(255,207,37,.9) 146px,rgba(187,90,0,.9) 170px,rgba(255,207,37,.85) 192px,transparent 210px)', opacity: layers.ndmi && circ ? dl : 0 }} />
            <div style={{ ...fill, background: 'rgba(0,202,142,.38)', opacity: layers.ndvi ? 1 : 0 }} />
            <div style={{ ...arc, background: 'radial-gradient(circle at 50% 50%,transparent 130px,rgba(251,234,191,.75) 160px,rgba(251,234,191,.7) 190px,transparent 210px)', opacity: layers.ndvi && circ ? dl * 0.8 : 0 }} />
            <div style={{ ...fill, background: 'rgba(242,76,83,.14)', opacity: layers.lst ? 1 : 0 }} />
            <div style={{ ...arc, background: 'radial-gradient(circle at 50% 50%,transparent 120px,rgba(242,76,83,.8) 165px,transparent 215px)', opacity: layers.lst && circ ? dl * 0.9 : 0 }} />
            <div style={{ position: 'absolute', left: 120, top: 150, width: 260, height: 180, borderRadius: '50%', background: 'rgba(255,255,255,.85)', filter: 'blur(30px)', opacity: layers.clouds && cloudy ? 1 : 0, transition: 'opacity .4s' }} />
            <div style={{ position: 'absolute', left: 300, top: 330, width: 200, height: 140, borderRadius: '50%', background: 'rgba(255,255,255,.7)', filter: 'blur(28px)', opacity: layers.clouds && cloudy ? 1 : 0, transition: 'opacity .4s' }} />
          </div>
          <svg width="600" height="600" style={{ position: 'absolute', left: -300, top: -300, overflow: 'visible' }}>
            <polygon points={ov.pts} style={{ fill: 'none', stroke: '#fff', strokeWidth: 2 / Math.max(ov.s, 0.25), opacity: layers.contour ? 1 : 0 }} />
            <path d={DRY_PATH} style={{ fill: 'rgba(255,207,37,.12)', stroke: '#ffcf25', strokeWidth: 2.5, strokeDasharray: '7 5', opacity: layers.dry && circ ? (dl > 0.25 ? 1 : 0.3) : 0, transition: 'opacity .4s' }} />
            <circle cx="300" cy="300" r="4" style={{ fill: '#fff', opacity: layers.contour ? 1 : 0 }} />
          </svg>
          <div style={{ position: 'absolute', left: -100, top: ov.labelTop, width: 200, display: 'flex', justifyContent: 'center', opacity: layers.contour ? 1 : 0, transform: `scale(${1 / Math.max(ov.s, 0.25)})`, transformOrigin: '50% 100%' }}>
            <div style={{ padding: '4px 10px', borderRadius: 9999, background: '#000', border: '1px solid #3b3d45', font: '600 12px/1.23 var(--font)', letterSpacing: 0.6, textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
              {place!.name} · {ov.ha} ha
            </div>
          </div>
          <div style={{ position: 'absolute', left: 190, top: -205, opacity: layers.dry && circ ? 1 : 0, transition: 'opacity .4s' }}>
            <div style={{ padding: '6px 10px', borderRadius: 6, background: '#ffcf25', color: '#000', font: '600 13px/1.38 var(--font)', whiteSpace: 'nowrap' }}>
              Dry zone · {(4.6 * dl).toFixed(1)} ha <span style={{ opacity: 0.6 }}>±{(0.7 * dl).toFixed(1)}</span>
            </div>
          </div>
        </div>
      )}
      {pass && (
        <svg width={W} height={H} style={{ position: 'absolute', inset: 0, pointerEvents: 'none', animation: 'fadeIn .4s ease both' }}>
          <line x1={cx - H * 0.35} y1={-20} x2={cx + H * 0.35} y2={H + 20} stroke="rgba(43,137,255,.18)" strokeWidth={180} />
          <line x1={cx - H * 0.35} y1={-20} x2={cx + H * 0.35} y2={H + 20} stroke="#2b89ff" strokeWidth={1.5} strokeDasharray="8 4" style={{ animation: 'dash 1s linear infinite' }} />
        </svg>
      )}
      {pass && (
        <div style={{ position: 'absolute', left: cx - H * 0.12, top: cy - H * 0.33, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 9999, background: '#000', border: '1px solid #2b89ff', font: '600 12px/1.38 var(--font)', animation: 'fadeUp .3s ease both' }}>
          <Ms n="satellite_alt" size={16} style={{ color: '#2b89ff' }} />
          {pass} ground track
        </div>
      )}
    </div>
  );
}
