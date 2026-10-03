/**
 * Locate by name: `POST /api/areas/resolve` with a free-text query.
 *
 * The resolver reads a place name, coordinates or a map link and answers with one best area
 * plus "did you mean" candidates (`docs/API.md` §7).
 */

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../../api';
import { useResource } from '../../../hooks/useResource';
import { ErrorState } from '../../../components/async';
import { Ms } from '../../../components/ui';
import { outerRing, ringToPts } from '../../../lib/geo';
import { toSearchHits, type AreaSearchHit } from '../../../model';
import type { Loc, MethodProps } from '../types';

/** Category guessed from a geocoder hit, so the wizard can preselect one. */
const SEARCH_CAT: Record<string, string> = {
  'Lake Mead': 'water',
  'Rondônia': 'forests',
  'Port of Rotterdam': 'finance',
  'Great Barrier Reef': 'oceans',
};

/** Typing pause before a lookup goes out. The resolver may hit a real geocoder. */
const DEBOUNCE_MS = 350;

export function SearchMethod({ onChange }: MethodProps) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<AreaSearchHit | null>(null);
  const term = useDebounced(query.trim(), DEBOUNCE_MS);

  // Only ask once there is something to ask about. `resolve` takes exactly one of
  // point/geojson/link/query, so an empty string is not a valid request — the previous version
  // fired one on mount, before the user had even chosen this method.
  const geo = useResource(
    useCallback(
      (signal) => (term ? api.areas.resolve({ query: term }, signal).then(toSearchHits) : Promise.resolve([])),
      [term],
    ),
    [term],
  );
  const hits = geo.data ?? [];

  useEffect(() => onChange(picked ? toLoc(picked) : null), [picked, onChange]);

  return (
    <div className="col" style={{ gap: 10 }}>
      <div style={{ position: 'relative' }}>
        <Ms n="search" size={18} className="subtle" style={{ position: 'absolute', left: 12, top: 12 }} />
        <input
          className="input"
          autoFocus
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPicked(null); }}
          placeholder="e.g. Lake Mead, Garden City, Port of Rotterdam"
          style={{ paddingLeft: 38 }}
          aria-label="Search a place name"
        />
      </div>
      <div className="tiny">
        {geo.isFetching ? 'Searching…' : term ? `${hits.length} result${hits.length === 1 ? '' : 's'}` : 'Type a place name, coordinates, or paste a map link'}
      </div>
      {geo.error ? (
        <ErrorState error={geo.error} onRetry={geo.refetch} title="Search is unavailable" compact />
      ) : term && hits.length === 0 && !geo.isFetching ? (
        <div className="caption">No match. Try coordinates, or draw it on the map instead.</div>
      ) : (
        <div className="col" style={{ gap: 2 }}>
          {hits.map((r, i) => (
            // The best match and a candidate can share a name, so the index is part of the key.
            <button key={`${r.name}-${i}`} className={`menu-item ${picked === r ? 'on' : ''}`} onClick={() => setPicked(r)}>
              <Ms n="location_on" />
              <span className="grow">{r.name} <span className="caption">· {r.description}</span></span>
              {picked === r && <Ms n="check" style={{ color: '#fff' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Keep the outline the resolver already returned.
 *
 * Only the best match carries one. Without this the wizard dropped it and step 2 made a second
 * round trip to *guess* a boundary the server had just handed us.
 */
function toLoc(hit: AreaSearchHit): Loc {
  const ring = hit.area ? outerRing(hit.area.geojson) : null;
  const pts = ring?.length ? ringToPts(ring, { lat: hit.lat, lon: hit.lon }) : undefined;
  return {
    lat: hit.lat,
    lon: hit.lon,
    label: hit.name,
    source: 'search',
    via: `Search · ${hit.name}, ${hit.description}`,
    categoryKey: SEARCH_CAT[hit.name],
    ...(pts ? { pts, givenLabel: 'Outline from the place search' } : {}),
  };
}

function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return settled;
}
