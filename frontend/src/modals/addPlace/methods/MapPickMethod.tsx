/**
 * Draw an outline, or drop a single pin, on a small map.
 *
 * The two share everything except what a click does and what gets drawn, so they are one
 * component rather than two near-copies: the same "jump to" list, the same zoom, the same frame.
 */

import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../../state/store';
import { Btn } from '../../../components/ui';
import { DEFAULT_CENTER, approxAreaHa, fmtC, shift, type Pt } from '../../../lib/geo';
import { MapFrame } from '../MapFrame';
import { NO_LAYERS, type Loc, type MethodProps } from '../types';

export function MapPickMethod({ mode, onChange }: MethodProps & { mode: 'draw' | 'pin' }) {
  const { places } = useStore();
  const [at, setAt] = useState(0);
  const [zoom, setZoom] = useState(15);
  const [verts, setVerts] = useState<Pt[]>([]);
  const [pin, setPin] = useState<Pt | null>(null);
  const isDraw = mode === 'draw';

  // Memoised: these feed a `Loc` that an effect depends on, and a fresh array every render
  // would make that effect fire on every render.
  const jumps = useMemo(
    () => [
      { n: 'My Farm, Garden City', lat: DEFAULT_CENTER.lat, lon: DEFAULT_CENTER.lon },
      ...places.map((p) => ({ n: p.name, lat: p.lat, lon: p.lon })),
    ],
    [places],
  );
  const centre = jumps[Math.min(at, jumps.length - 1)] ?? jumps[0];

  const loc: Loc | null = useMemo(() => {
    if (isDraw) {
      if (verts.length < 3) return null;
      const cx = verts.reduce((s, v) => s + v[0], 0) / verts.length;
      const cy = verts.reduce((s, v) => s + v[1], 0) / verts.length;
      const c = shift(centre.lat, centre.lon, cx, cy);
      return {
        ...c,
        label: 'New field',
        source: 'drawn',
        via: `${verts.length} points drawn`,
        pts: verts.map((v) => [+(v[0] - cx).toFixed(1), +(v[1] - cy).toFixed(1)] as Pt),
        givenLabel: 'As drawn',
      };
    }
    if (!pin) return null;
    const c = shift(centre.lat, centre.lon, pin[0], pin[1]);
    return { ...c, label: 'Pinned site', source: 'pin', via: fmtC(c.lat, c.lon) };
  }, [isDraw, verts, pin, centre]);

  useEffect(() => onChange(loc), [loc, onChange]);

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row wrap" style={{ gap: 8, justifyContent: 'space-between' }}>
        <label className="row caption" style={{ gap: 8 }}>
          Jump to
          <select className="input" style={{ height: 34, width: 'auto', fontSize: 13 }} value={at}
            onChange={(e) => { setAt(+e.target.value); setVerts([]); setPin(null); setZoom(+e.target.value === 0 ? 15 : 13); }}>
            {jumps.map((j, i) => <option key={`${j.n}-${i}`} value={i}>{j.n}</option>)}
          </select>
        </label>
        {isDraw && (
          <div className="row" style={{ gap: 4 }}>
            <Btn size="sm" variant="text" icon="undo" disabled={!verts.length} onClick={() => setVerts((v) => v.slice(0, -1))}>Undo</Btn>
            <Btn size="sm" variant="text" icon="delete" disabled={!verts.length} onClick={() => setVerts([])}>Clear</Btn>
          </div>
        )}
      </div>
      <MapFrame H={240} center={centre} zoom={zoom} setZoom={setZoom} place={null} layers={NO_LAYERS}
        onPick={(dx, dy) => (isDraw ? setVerts((v) => [...v, [dx, dy]]) : setPin([dx, dy]))}>
        {(s, W, H) => isDraw ? (
          <g>
            {verts.length > 1 && (
              <polygon points={verts.map((v) => `${W / 2 + v[0] * s},${H / 2 + v[1] * s}`).join(' ')}
                fill={verts.length > 2 ? 'rgba(255,255,255,.12)' : 'none'} stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
            )}
            {verts.map((v, i) => <circle key={i} cx={W / 2 + v[0] * s} cy={H / 2 + v[1] * s} r="4.5" fill={i === 0 ? '#fff' : '#000'} stroke="#fff" strokeWidth="2" />)}
          </g>
        ) : pin ? (
          <g>
            <circle cx={W / 2 + pin[0] * s} cy={H / 2 + pin[1] * s} r="14" fill="rgba(43,137,255,.25)" />
            <circle cx={W / 2 + pin[0] * s} cy={H / 2 + pin[1] * s} r="5" fill="#2b89ff" stroke="#fff" strokeWidth="2" />
          </g>
        ) : null}
      </MapFrame>
      <div className="caption">
        {isDraw
          ? verts.length < 3
            ? `Click the corners of your area on the map (${verts.length}/3 minimum). You can refine the outline in the next step.`
            : `${verts.length} points · about ${approxAreaHa(verts, centre.lat)} ha. Keep clicking to add corners.`
          : loc ? `Pin at ${fmtC(loc.lat, loc.lon)}. You'll set the radius next.` : 'Click once on the map to drop a pin.'}
      </div>
    </div>
  );
}
