/** Reuse a place that another project already has. The outline is copied; triggers are not. */

import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../../../state/store';
import { Ms } from '../../../components/ui';
import type { MethodProps } from '../types';

export function ProjectMethod({ onChange }: MethodProps) {
  const { places, category } = useStore();
  const [fromProject, setFromProject] = useState<string | null>(null);
  const [fromPlace, setFromPlace] = useState<string | null>(null);
  const projects = useMemo(() => Array.from(new Set(places.map((p) => p.project))), [places]);
  const list = places.filter((p) => p.project === fromProject);

  useEffect(() => {
    const p = places.find((x) => x.id === fromPlace);
    onChange(
      p
        ? {
            lat: p.lat, lon: p.lon, label: p.name, source: p.source, via: `Copied from ${p.project} · ${p.name}`,
            pts: p.pts, circle: p.circle, givenLabel: `As in ${p.project}`, categoryKey: p.categoryKey, details: p.details,
          }
        : null,
    );
  }, [fromPlace, places, onChange]);

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="row wrap" style={{ gap: 6 }}>
        {projects.map((p) => (
          <button key={p} className={`chip ${fromProject === p ? 'on' : ''}`} onClick={() => { setFromProject(p); setFromPlace(null); }}>
            <Ms n="folder" />{p}
          </button>
        ))}
      </div>
      {fromProject && (
        <div className="col" style={{ gap: 2 }}>
          {list.map((p) => (
            <button key={p.id} className={`menu-item ${fromPlace === p.id ? 'on' : ''}`} onClick={() => setFromPlace(p.id)}>
              <span className="dot" style={{ background: category(p.categoryKey).color }} />
              <span className="grow">{p.name} <span className="caption">· {p.areaHa} ha</span></span>
              {fromPlace === p.id && <Ms n="check" style={{ color: '#fff' }} />}
            </button>
          ))}
        </div>
      )}
      {!fromProject && <div className="caption">Pick a project to see its places. The outline is copied; triggers are not.</div>}
    </div>
  );
}
