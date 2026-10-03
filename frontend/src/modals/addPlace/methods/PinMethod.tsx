/**
 * Drop a pin: start on the 3D globe, pick anywhere on Earth, then refine on the map.
 *
 * Picking on the globe flies in to a map at that spot with the pin already dropped there;
 * a click on the map moves it. The Globe button (or zooming all the way out) goes back up.
 */

import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../../state/store';
import { fmtC, shift, type Pt } from '../../../lib/geo';
import { GlobePicker } from '../GlobePicker';
import { MapFrame } from '../MapFrame';
import { type Loc, type MethodProps } from '../types';

export function PinMethod({ onChange }: MethodProps) {
  const { places } = useStore();
  const [spot, setSpot] = useState<{ lat: number; lon: number } | null>(null);
  const [globe, setGlobe] = useState(true);
  const [zoom, setZoom] = useState(13);
  const [pin, setPin] = useState<Pt | null>(null);

  // Memoised: a fresh array every render would re-fire the effects that depend on it.
  const jumps = useMemo(
    () => places.map((p) => ({ n: p.name, lat: p.lat, lon: p.lon })),
    [places],
  );

  const flyTo = (p: { lat: number; lon: number }, z: number) => {
    setSpot(p);
    setPin([0, 0]);
    setZoom(z);
    setGlobe(false);
  };

  const loc: Loc | null = useMemo(() => {
    if (!spot || !pin) return null;
    const c = shift(spot.lat, spot.lon, pin[0], pin[1]);
    return { ...c, label: 'Pinned site', source: 'pin', via: fmtC(c.lat, c.lon) };
  }, [spot, pin]);

  useEffect(() => onChange(loc), [loc, onChange]);

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row wrap" style={{ gap: 8, justifyContent: 'space-between' }}>
        {jumps.length > 0 && <label className="row caption" style={{ gap: 8 }}>
          Or jump to
          <select className="input" style={{ height: 34, width: 'auto', fontSize: 13 }} value="" aria-label="Jump to a saved place"
            onChange={(e) => { const j = jumps[+e.target.value]; if (j) flyTo(j, 13); }}>
            <option value="" disabled>Choose…</option>
            {jumps.map((j, i) => <option key={`${j.n}-${i}`} value={i}>{j.n}</option>)}
          </select>
        </label>}
      </div>

      {globe || !spot ? (
        <GlobePicker H={280} focus={spot} onPick={(p) => flyTo(p, 12)} onBack={spot ? () => setGlobe(false) : undefined} />
      ) : (
        <MapFrame H={260} center={spot} zoom={zoom} setZoom={setZoom} place={null}
          onGlobe={() => setGlobe(true)} onPick={(dx, dy) => setPin([dx, dy])}>
          {(s, W, H) => pin ? (
            <g>
              <circle cx={W / 2 + pin[0] * s} cy={H / 2 + pin[1] * s} r="14" fill="rgba(43,137,255,.25)" />
              <circle cx={W / 2 + pin[0] * s} cy={H / 2 + pin[1] * s} r="5" fill="#2b89ff" stroke="#fff" strokeWidth="2" />
            </g>
          ) : null}
        </MapFrame>
      )}

      <div className="caption">
        {globe || !spot
          ? 'Choose a spot on the globe. The map opens there and you can place the pin precisely.'
          : loc ? `Pin at ${fmtC(loc.lat, loc.lon)}. Click the map to move it; you'll set the radius or draw the outline next.` : 'Click the map to drop a pin.'}
      </div>
    </div>
  );
}
