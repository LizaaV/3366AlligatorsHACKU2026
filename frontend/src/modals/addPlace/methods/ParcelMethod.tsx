/** Locate by parcel / cadastre ID, looked up in an official register server-side. */

import { useEffect, useState } from 'react';
import { ApiError, api, toApiError } from '../../../api';
import type { ParcelLookupResponse } from '../../../api/types';
import { ErrorState } from '../../../components/async';
import { Btn } from '../../../components/ui';
import { ringToPts } from '../../../lib/geo';
import type { MethodProps } from '../types';

const PARCEL_SYS = api.places.parcelSystems();

export function ParcelMethod({ onChange }: MethodProps) {
  const [sys, setSys] = useState('br');
  const [parcelId, setParcelId] = useState('');
  const [state, setState] = useState<'idle' | 'busy' | 'found'>('idle');
  const [found, setFound] = useState<{ res: ParcelLookupResponse; id: string; sys: string } | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const register = PARCEL_SYS.find((p) => p.id === sys) ?? PARCEL_SYS[0];

  useEffect(() => {
    onChange(
      found
        ? {
            lat: found.res.center.lat,
            lon: found.res.center.lon,
            label: `Parcel ${found.id}`,
            source: 'parcel',
            via: `${PARCEL_SYS.find((p) => p.id === found.sys)?.name ?? found.sys} · ${found.id}`,
            pts: ringToPts(found.res.geometry.coordinates[0] ?? [], found.res.center),
            givenLabel: 'From parcel register',
            categoryKey: found.res.categoryKey,
            details: [{ label: 'Parcel ID', value: found.res.registryLabel }],
          }
        : null,
    );
  }, [found, onChange]);

  /** Editing the inputs invalidates the result: the label and the geometry must not disagree. */
  const invalidate = () => { setState('idle'); setFound(null); };

  const lookup = async () => {
    const id = parcelId.trim();
    if (!id) return;
    setState('busy');
    setFound(null);
    setError(null);
    try {
      setFound({ res: await api.places.lookupParcel({ system: sys, parcelId: id }), id, sys });
      setState('found');
    } catch (err) {
      setError(toApiError(err));
      setState('idle');
    }
  };

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: '1 1 220px' }}>
          Register
          <select className="input" value={sys} onChange={(e) => { setSys(e.target.value); invalidate(); }}>
            {PARCEL_SYS.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.tier === 'free' ? 'free' : '$0.50 / lookup'}</option>)}
          </select>
        </label>
        <label className="field" style={{ flex: '1 1 220px' }}>
          Parcel ID
          <input className="input" value={parcelId} placeholder={register.placeholder} onChange={(e) => { setParcelId(e.target.value); invalidate(); }} onKeyDown={(e) => e.key === 'Enter' && lookup()} />
        </label>
        <Btn variant="secondary" icon={state === 'found' ? 'check' : 'travel_explore'} disabled={!parcelId.trim() || state === 'busy'} onClick={lookup}
          tier={register.tier} tierLabel={register.tier === 'paid' ? '$0.50' : undefined}>
          {state === 'busy' ? 'Looking up…' : state === 'found' ? 'Found' : 'Look up'}
        </Btn>
      </div>
      {error && <ErrorState error={error} onRetry={lookup} title="That parcel could not be looked up" compact />}
      <div className="caption">
        {state === 'found'
          ? `Parcel found in ${register.name}. Official boundary loaded — check it in the next step.`
          : register.tier === 'paid' ? 'This register charges per lookup. You are only charged if the parcel is found.' : 'Free public register. Boundaries come straight from the official record.'}
      </div>
    </div>
  );
}
