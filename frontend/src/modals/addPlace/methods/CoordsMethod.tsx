/** Locate by latitude/longitude, typed or from the browser's geolocation. */

import { useEffect, useState } from 'react';
import { Btn } from '../../../components/ui';
import { fmtC } from '../../../lib/geo';
import type { Loc, MethodProps } from '../types';

export function CoordsMethod({ onChange }: MethodProps) {
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [geoMsg, setGeoMsg] = useState('');

  const a = parseFloat(lat);
  const b = parseFloat(lon);
  const valid = isFinite(a) && isFinite(b) && Math.abs(a) <= 85 && Math.abs(b) <= 180;
  const loc: Loc | null = valid ? { lat: a, lon: b, label: `Site ${fmtC(a, b)}`, source: 'coords', via: fmtC(a, b) } : null;

  useEffect(() => onChange(loc), [loc?.lat, loc?.lon, onChange]); // eslint-disable-line react-hooks/exhaustive-deps

  const useMyLocation = () => {
    if (!navigator.geolocation) { setGeoMsg('Location is not available in this browser.'); return; }
    setGeoMsg('Finding you…');
    navigator.geolocation.getCurrentPosition(
      (p) => { setLat(p.coords.latitude.toFixed(5)); setLon(p.coords.longitude.toFixed(5)); setGeoMsg(`Accurate to about ${Math.round(p.coords.accuracy)} m.`); },
      () => setGeoMsg('Could not get your location. Type it in instead.'),
      { timeout: 8000 },
    );
  };

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '1 1 140px' }}>
          Latitude
          <input className="input" inputMode="decimal" value={lat} placeholder="37.9785"
            onChange={(e) => {
              const v = e.target.value;
              const both = v.split(/[,\s]+/).filter(Boolean);
              if (both.length === 2 && isFinite(+both[0]) && isFinite(+both[1])) { setLat(both[0]); setLon(both[1]); } else setLat(v);
            }} />
        </label>
        <label className="field" style={{ flex: '1 1 140px' }}>
          Longitude
          <input className="input" inputMode="decimal" value={lon} placeholder="-100.9155" onChange={(e) => setLon(e.target.value)} />
        </label>
        <Btn icon="near_me" onClick={useMyLocation}>Use my location</Btn>
      </div>
      <div className="caption">
        Decimal degrees, WGS84. You can paste “lat, lon” into the first box.{geoMsg && <> {geoMsg}</>}
        {(lat || lon) && !valid && <span style={{ color: 'var(--coral)' }}> Latitude must be within ±85, longitude within ±180.</span>}
      </div>
    </div>
  );
}
