import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { hasStatus, sourceLabel } from '../data/presentation';
import type { Place, Watch } from '../model';
import { TILE, txy } from '../lib/geo';
import { Btn, CatPill, Empty, IconBtn, Ms, RingOverlay, hideBroken } from '../components/ui';
import { ErrorState, SkeletonCard } from '../components/async';

const THUMB_H = 170;
const STATUS_COLOR: Record<Watch['status'], string> = { ok: 'var(--green)', warn: 'var(--yellow)', alert: 'var(--red)' };

/** Satellite thumbnail centred on the place, with its outline drawn at the right scale. */
function PlaceThumb({ place, ring }: { place: Place; ring: boolean }) {
  // Pick a zoom where the outline fits in the thumbnail height with some margin.
  const xs = place.pts.map((p) => p[0]);
  const ys = place.pts.map((p) => p[1]);
  const ext = Math.max(Math.max(...ys) - Math.min(...ys), (Math.max(...xs) - Math.min(...xs)) * 0.5, 1);
  const z = Math.max(10, Math.min(17, Math.floor(16 + Math.log2((THUMB_H - 44) / ext))));
  const s = Math.pow(2, z - 16);
  const t = txy(place.lat, place.lon, z);
  const tx = Math.floor(t.x), ty = Math.floor(t.y);
  // 3×3 tile block; the place sits inside the middle tile.
  const ox = (t.x - (tx - 1)) * 256, oy = (t.y - (ty - 1)) * 256;
  const tiles: { url: string; l: number; t: number }[] = [];
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) tiles.push({ url: TILE(z, tx + i, ty + j), l: (i + 1) * 256, t: (j + 1) * 256 });
  const pts = place.pts.map((p) => `${(p[0] * s).toFixed(1)},${(p[1] * s).toFixed(1)}`).join(' ');
  const ringSize = place.circle ? Math.round((Math.max(...ys) - Math.min(...ys)) * s) : 0;

  return (
    <div style={{ position: 'relative', height: THUMB_H, background: '#0b0d10', overflow: 'hidden', borderRadius: 'var(--r-lg) var(--r-lg) 0 0' }}>
      <div style={{ position: 'absolute', left: `calc(50% - ${ox}px)`, top: THUMB_H / 2 - oy, width: 768, height: 768 }}>
        {tiles.map((tl) => (
          <img onError={hideBroken} key={tl.url} src={tl.url} alt="" draggable={false} loading="lazy" style={{ position: 'absolute', left: tl.l, top: tl.t, width: 256, height: 256 }} />
        ))}
      </div>
      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,.12)' }} />
      {ring && place.circle ? (
        <RingOverlay size={ringSize} />
      ) : (
        <svg width="0" height="0" style={{ position: 'absolute', left: '50%', top: '50%', overflow: 'visible' }} aria-hidden>
          <polygon points={pts} fill="rgba(255,255,255,.08)" stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      )}
      <span className="live" style={{ position: 'absolute', left: 12, bottom: 12, background: 'rgba(0,0,0,.8)' }}>
        <Ms n="satellite_alt" size={13} />
        SENTINEL-2
      </span>
    </div>
  );
}

function CardMenu({ place, onClose }: { place: Place; onClose: () => void }) {
  const { open, removePlace, notify } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', down);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('mousedown', down); window.removeEventListener('keydown', key); };
  }, [onClose]);
  const item = (icon: string, label: string, fn: () => void, danger?: boolean) => (
    <button className="menu-item" role="menuitem" onClick={() => { onClose(); fn(); }} style={danger ? { color: 'var(--coral)' } : undefined}>
      <Ms n={icon} style={danger ? { color: 'var(--coral)' } : undefined} />
      {label}
    </button>
  );
  return (
    <div ref={ref} className="menu" role="menu" style={{ right: 0, top: 'calc(100% + 4px)', minWidth: 220 }} onClick={(e) => e.stopPropagation()}>
      {item('add_alert', 'Add a trigger', () => open({ kind: 'watchBuilder', placeId: place.id }))}
      <div className="divider" style={{ margin: '6px 0' }} />
      {item('delete', 'Delete', () => {
        removePlace(place.id);
        notify(`${place.name} deleted`, undefined, undefined, 'delete');
      }, true)}
    </div>
  );
}

function PlaceCard({ place, watches }: { place: Place; watches: Watch[] }) {
  const { go, category } = useStore();
  const [menu, setMenu] = useState(false);
  const ask = () => go('ask', undefined, { place: place.id });
  const ha = place.areaHa;
  const ring = watches.some((w) => w.ring);

  return (
    <div
      className="card"
      role="link"
      tabIndex={0}
      aria-label={`Ask about ${place.name}`}
      onClick={ask}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) ask(); }}
      style={{ display: 'flex', flexDirection: 'column', cursor: 'pointer', position: 'relative', transition: 'border-color .15s' }}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--hair)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = '')}
    >
      <PlaceThumb place={place} ring={ring} />
      <div style={{ padding: '20px 24px 24px', display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div className="grow">
            <div className="card-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{place.name}</div>
            <div className="caption" style={{ marginTop: 4 }}>
              {[place.project, typeof ha === 'number' ? `${ha.toLocaleString()} ha` : null, sourceLabel(place.source)].filter(Boolean).join(' · ')}
            </div>
          </div>
          <div style={{ position: 'relative', margin: '-6px -10px 0 0' }} onClick={(e) => e.stopPropagation()}>
            <IconBtn icon="more_vert" className="sm" aria-label={`More actions for ${place.name}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)} />
            {menu && <CardMenu place={place} onClose={() => setMenu(false)} />}
          </div>
        </div>

        <div className="row wrap" style={{ gap: 6 }}>
          <CatPill category={category(place.categoryKey)} />
          {place.tags.map((t: string) => <span key={t} className="tag">{t}</span>)}
        </div>

        <div style={{ marginTop: 4, paddingTop: 12, borderTop: '1px solid var(--hair-soft)' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="eyebrow">Triggers on this place</span>
            <span className="tiny">{watches.length}</span>
          </div>
          {watches.length === 0 ? (
            <div className="caption" style={{ marginTop: 6 }}>None yet. Add one from the menu.</div>
          ) : (
            <div className="col" style={{ gap: 4, marginTop: 8 }}>
              {watches.slice(0, 3).map((w) => (
                <div key={w.id} className="row body-sm" style={{ gap: 8, minWidth: 0 }}>
                  <span className="dot" style={{ background: w.enabled && hasStatus(w) ? STATUS_COLOR[w.status] : 'var(--subtle)' }} />
                  <span className="grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--ink)' }}>{w.name}</span>
                  {!w.enabled && <span className="tiny">Paused</span>}
                </div>
              ))}
              {watches.length > 3 && <div className="tiny">+{watches.length - 3} more</div>}
            </div>
          )}
        </div>

        <div style={{ marginTop: 'auto', paddingTop: 8 }}>
          <Btn variant="primary" icon="forum" onClick={(e) => { e.stopPropagation(); ask(); }} style={{ width: '100%' }}>
            Ask about this place
          </Btn>
        </div>
      </div>
    </div>
  );
}

export function PlacesPage() {
  const { places, watches, t, open, loading, errors, reload } = useStore();
  const [project, setProject] = useState('All');
  const [q, setQ] = useState('');

  const projects = useMemo(() => ['All', ...Array.from(new Set(places.map((p) => p.project)))], [places]);
  useEffect(() => { if (!projects.includes(project)) setProject('All'); }, [projects, project]);

  const shown = places.filter((p) => {
    if (project !== 'All' && p.project !== project) return false;
    const s = q.trim().toLowerCase();
    if (!s) return true;
    return [p.name, p.project, ...p.tags].some((x) => x.toLowerCase().includes(s));
  });

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div style={{ maxWidth: 640 }}>
            <div className="eyebrow">{places.length} saved · {projects.length - 1} projects</div>
            <h1 className="h1" style={{ margin: '8px 0 0' }}>{t('places.title')}</h1>
            <div className="body" style={{ marginTop: 8 }}>{t('places.sub')}</div>
          </div>
          <Btn variant="primary" icon="add_location_alt" onClick={() => open({ kind: 'addPlace' })}>Add place</Btn>
        </div>

        <div className="row wrap" style={{ gap: 12, justifyContent: 'space-between' }}>
          <div className="seg" role="tablist" aria-label="Filter by project" style={{ maxWidth: '100%', overflowX: 'auto' }}>
            {projects.map((p) => (
              <button key={p} role="tab" aria-selected={project === p} className={project === p ? 'on' : ''} onClick={() => setProject(p)} style={{ whiteSpace: 'nowrap' }}>
                {p}
                <span className="tiny" style={{ color: 'inherit', opacity: 0.6 }}>
                  {p === 'All' ? places.length : places.filter((x) => x.project === p).length}
                </span>
              </button>
            ))}
          </div>
          <div style={{ position: 'relative', flex: '0 1 300px', minWidth: 200 }}>
            <Ms n="search" size={18} className="subtle" style={{ position: 'absolute', left: 12, top: 12 }} />
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search places, tags…" aria-label="Search places" style={{ paddingLeft: 38 }} />
          </div>
        </div>

        {loading.places ? (
          <div className="grid-cards" aria-busy="true" aria-label="Loading places">
            {Array.from({ length: 4 }, (_, i) => <SkeletonCard key={i} height={320} />)}
          </div>
        ) : errors.places ? (
          <ErrorState error={errors.places} onRetry={reload} title="Could not load your places" />
        ) : shown.length === 0 ? (
          <Empty icon="travel_explore" title="No places match" body={q ? `Nothing in ${project === 'All' ? 'your places' : project} matches “${q}”.` : 'This project has no places yet.'}>
            <Btn onClick={() => { setQ(''); setProject('All'); }}>Clear filters</Btn>
            <Btn variant="primary" icon="add_location_alt" onClick={() => open({ kind: 'addPlace' })}>Add place</Btn>
          </Empty>
        ) : (
          <div className="grid-cards">
            {shown.map((p) => (
              <PlaceCard key={p.id} place={p} watches={watches.filter((w) => w.placeId === p.id)} />
            ))}
            <button
              onClick={() => open({ kind: 'addPlace' })}
              style={{ minHeight: 280, borderRadius: 'var(--r-lg)', border: '1px dashed var(--hair)', background: 'transparent', color: 'var(--muted)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8, font: '600 14px/1.29 var(--font)', padding: 24 }}
              onMouseEnter={(e) => { e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = 'var(--subtle)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--muted)'; e.currentTarget.style.borderColor = 'var(--hair)'; }}
            >
              <Ms n="add" size={28} />
              Add place
              <span className="caption" style={{ fontWeight: 500, maxWidth: 220, textAlign: 'center' }}>Search a name, paste coordinates, draw an outline or drop a pin</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
