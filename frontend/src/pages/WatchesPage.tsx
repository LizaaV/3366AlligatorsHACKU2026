import { useCallback, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import type { Place, Watch } from '../model';
import { thumb } from '../lib/geo';
import { STATUS_STYLE } from '../data/presentation';
import { fmtDay, timeKey } from '../lib/format';
import { api } from '../api';
import { useResource } from '../hooks/useResource';
import { Btn, Empty, HistoryChart, Ms, RingOverlay, Toggle } from '../components/ui';
import { ErrorState, SkeletonCard } from '../components/async';
import { RecurrencePill, WatchDetail, hasSeries, watchBaseline, watchRange, watchValue } from './WatchDetail';

type Kind = 'all' | 'recurring' | 'once' | 'dashboard';

const KINDS: { id: Kind; label: string; icon: string; test: (w: Watch) => boolean }[] = [
  { id: 'all', label: 'All', icon: 'select_all', test: () => true },
  { id: 'recurring', label: 'Recurring', icon: 'autorenew', test: (w) => w.recurrence === 'recurring' },
  { id: 'once', label: 'One-time', icon: 'looks_one', test: (w) => w.recurrence === 'once' },
  { id: 'dashboard', label: 'On a dashboard', icon: 'dashboard', test: (w) => !!w.dashboardId },
];

export function WatchesPage() {
  const { route } = useStore();
  return (
    <div className="page">
      <div className="page-inner">
        {route.id ? <WatchDetail id={route.id} /> : <Overview />}
      </div>
    </div>
  );
}

function Overview() {
  const { watches, places, open, t, categories, channels, loading, errors, reload } = useStore();
  const [cat, setCat] = useState<number | 'all'>('all');
  const [grouped, setGrouped] = useState(true);
  const [kind, setKind] = useState<Kind>('all');
  const dashboards = useResource(useCallback((signal) => api.dashboards.list(signal), []), []);
  const dashName = (id: string | null) => (id ? dashboards.data?.find((d) => d.id === id)?.name ?? 'Dashboard' : undefined);

  const active = watches.filter((w) => w.enabled);
  const attention = active.filter((w) => w.status !== 'ok');
  const soonest = [...active].sort((a, b) => timeKey(a.nextRunAt) - timeKey(b.nextRunAt))[0];
  const channelsUsed = channels.filter((c) => active.some((w) => w.channels.includes(c.id)));

  const byKind = useMemo(() => watches.filter(KINDS.find((k) => k.id === kind)!.test), [watches, kind]);
  const catsUsed = useMemo(
    () => categories.map((c, i) => ({ c, i, n: byKind.filter((w) => w.categoryKey === c.key).length })).filter((x) => x.n > 0),
    [byKind, categories],
  );
  const shown = cat === 'all' ? byKind : byKind.filter((w) => w.categoryKey === categories[cat]?.key);
  const groups = catsUsed.filter((g) => cat === 'all' || g.i === cat).map((g) => ({ ...g, list: shown.filter((w) => w.categoryKey === g.c.key) }));

  return (
    <>
      <style>{`
        .wp-stats { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .wp-stats > div { padding: 16px 18px; }
        .wp-stats .v { font-size: 24px; letter-spacing: -0.4px; }
        .wp-card { cursor: pointer; transition: border-color .15s ease; }
        .wp-card:hover { border-color: var(--hair); }
        .wp-chips { display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; padding-bottom: 2px; }
        .wp-chips::-webkit-scrollbar { display: none; }
        .wp-chips .chip { flex: none; }
        @media (max-width: 760px) { .wp-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } .wp-stats .v { font-size: 18px; } }
      `}</style>

      <div className="page-head">
        <div>
          <div className="eyebrow">Triggers</div>
          <div className="h1" style={{ marginTop: 10 }}>{t('watches.title')}</div>
          <div className="body" style={{ marginTop: 6, maxWidth: 640 }}>{t('watches.sub')}</div>
        </div>
        <Btn variant="primary" icon="add" onClick={() => open({ kind: 'watchBuilder' })}>{t('cta.newTrigger')}</Btn>
      </div>

      <div className="stats wp-stats">
        <div>
          <div className="l">Active triggers</div>
          <div className="v">{active.length}</div>
          <div className="ci">{watches.length - active.length} paused</div>
        </div>
        <div>
          <div className="l">Need attention</div>
          <div className="v" style={{ color: attention.length ? 'var(--yellow)' : undefined }}>{attention.length}</div>
          <div className="ci">{attention.length ? attention.map((w) => w.name.split(' · ').pop()).join(', ') : 'All normal'}</div>
        </div>
        <div>
          <div className="l">Next update</div>
          <div className="v">{fmtDay(soonest?.nextRunAt ?? null, '—')}</div>
          <div className="ci">{soonest ? soonest.satellites.split(' · ')[0] : 'No active triggers'}</div>
        </div>
        <div>
          <div className="l">Delivery channels</div>
          <div className="v row" style={{ gap: 6 }}>
            {channelsUsed.length ? channelsUsed.map((c) => <Ms key={c.id} n={c.icon} size={20} />) : '—'}
          </div>
          <div className="ci">{channelsUsed.map((c) => c.name).join(' · ') || 'None yet'}</div>
        </div>
      </div>


      <div className="col" style={{ gap: 16 }}>
        <div className="wp-chips" role="tablist" aria-label="Filter by type">
          {KINDS.map((k) => (
            <button key={k.id} role="tab" aria-selected={kind === k.id} className={`chip ${kind === k.id ? 'on' : ''}`} onClick={() => { setKind(k.id); setCat('all'); }}>
              <Ms n={k.icon} />
              {k.label}
              <span style={{ opacity: 0.6 }}>{watches.filter(k.test).length}</span>
            </button>
          ))}
        </div>
        <div className="row wrap" style={{ justifyContent: 'space-between', gap: 12 }}>
          <div className="wp-chips grow" role="tablist" aria-label="Filter by category">
            <button role="tab" aria-selected={cat === 'all'} className={`chip ${cat === 'all' ? 'on' : ''}`} onClick={() => setCat('all')}>All <span style={{ opacity: 0.6 }}>{byKind.length}</span></button>
            {catsUsed.map(({ c, i, n }) => (
              <button key={c.key} role="tab" aria-selected={cat === i} className={`chip ${cat === i ? 'on' : ''}`} onClick={() => setCat(i)}>
                <span className="dot" style={{ background: c.color }} />
                {c.name}
                <span style={{ opacity: 0.6 }}>{n}</span>
              </button>
            ))}
          </div>
          <div className="seg">
            <button className={grouped ? 'on' : ''} onClick={() => setGrouped(true)}><Ms n="view_agenda" size={16} />Grouped by category</button>
            <button className={!grouped ? 'on' : ''} onClick={() => setGrouped(false)}><Ms n="grid_view" size={16} />All</button>
          </div>
        </div>

        {loading.watches ? (
          <div className="grid-cards" aria-busy="true" aria-label="Loading triggers">
            {Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} height={360} />)}
          </div>
        ) : errors.watches ? (
          <ErrorState error={errors.watches} onRetry={reload} title="Could not load your triggers" />
        ) : watches.length === 0 ? (
          <Empty icon="visibility" title="No triggers yet" body="Tell the agent what to keep an eye on. It checks whether satellites can see it, then alerts you by email, WhatsApp or push.">
            <Btn variant="primary" icon="add" onClick={() => open({ kind: 'watchBuilder' })}>{t('cta.newTrigger')}</Btn>
          </Empty>
        ) : byKind.length === 0 ? (
          <Empty icon="filter_alt_off" title="No triggers match" body="Try a different filter to see the rest of your triggers.">
            <Btn onClick={() => setKind('all')}>Show all triggers</Btn>
          </Empty>
        ) : grouped ? (
          groups.map((g, gi) => (
            <section key={g.c.key} className="col" style={{ gap: 14, marginTop: 8 }}>
              <div className="row">
                <span className="sq" style={{ background: g.c.color }} />
                <span className="eyebrow">{g.c.name}</span>
                <span className="eyebrow" style={{ opacity: 0.7 }}>· {g.list.length}</span>
              </div>
              <div className="grid-cards">
                {g.list.map((w) => { const pl = places.find((p) => p.id === w.placeId); return <WatchCard key={w.id} w={w} placeName={pl?.name} place={pl} dashboardName={dashName(w.dashboardId)} />; })}
                {gi === groups.length - 1 && <AddTile />}
              </div>
            </section>
          ))
        ) : (
          <div className="grid-cards">
            {shown.map((w) => { const pl = places.find((p) => p.id === w.placeId); return <WatchCard key={w.id} w={w} placeName={pl?.name} place={pl} dashboardName={dashName(w.dashboardId)} />; })}
            <AddTile />
          </div>
        )}
      </div>
    </>
  );
}

function AddTile() {
  const { open } = useStore();
  return (
    <button
      onClick={() => open({ kind: 'watchBuilder' })}
      className="col"
      style={{ minHeight: 280, borderRadius: 'var(--r-lg)', border: '1px dashed var(--hair)', background: 'transparent', color: 'var(--muted)', alignItems: 'center', justifyContent: 'center', gap: 8, font: '600 14px/1.29 var(--font)', padding: 24, textAlign: 'center' }}
    >
      <Ms n="add" size={28} />
      Ask the agent to build a trigger
      <span className="tiny" style={{ maxWidth: 240 }}>Describe it in a sentence — the agent checks if satellites can see it.</span>
    </button>
  );
}

/**
 * Thumbnail for a watch. The backend sends a location and a zoom hint, not a baked tile URL —
 * building the URL is a frontend concern (and lets the basemap provider change freely).
 */
const thumbFor = (w: Watch, place?: Place) =>
  place ? thumb(place.lat, place.lon, w.thumbnailZoom) : thumb(0, 0, 2);

function WatchCard({ w, placeName, place, dashboardName }: { w: Watch; placeName?: string; place?: Place; dashboardName?: string }) {
  const { go, updateWatch, notify, category, channels } = useStore();
  const cat = category(w.categoryKey);
  const accent = w.enabled && w.status !== 'ok' ? STATUS_STYLE[w.status].color : null;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      className="card wp-card fade-up col"
      role="link"
      tabIndex={0}
      onClick={() => go('triggers', w.id)}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && go('triggers', w.id)}
      style={{ overflow: 'hidden', position: 'relative', opacity: w.enabled ? 1 : 0.78, boxShadow: accent ? `inset 3px 0 0 ${accent}` : undefined }}
    >
      <div style={{ position: 'relative', height: 150, background: `#000 url(${thumbFor(w, place)}) center/cover`, filter: w.enabled ? undefined : 'grayscale(.6)' }}>
        {w.ring && <RingOverlay size={110} />}
        {accent && (
          <span className="pill" style={{ position: 'absolute', left: 12, top: 12, color: accent }}>
            <span className="dot" style={{ background: accent }} />
            {STATUS_STYLE[w.status].label}
          </span>
        )}
        <span style={{ position: 'absolute', right: 12, bottom: 12 }}>
          {w.enabled ? <span className="live" style={{ color: 'var(--muted)' }}><Ms n="bookmark" size={12} />SAVED</span> : <span className="live" style={{ color: 'var(--muted)' }}><Ms n="pause" size={12} />PAUSED</span>}
        </span>
      </div>

      <div className="col" style={{ padding: '18px 20px 18px', gap: 8, flex: 1 }}>
        <div className="row">
          <span className="sq" style={{ background: cat.color }} />
          <span className="eyebrow">{cat.name}</span>
        </div>
        <div className="card-title">{w.name}</div>
        <div className="row wrap" style={{ gap: 6 }}>
          <RecurrencePill recurrence={w.recurrence} />
          {w.dashboardId && (
            <button
              className="pill"
              style={{ border: 0, background: 'var(--s2)', color: '#fff' }}
              onClick={(e) => { stop(e); go('dashboard', w.dashboardId!); }}
              title="The dashboard this trigger watches"
            >
              <Ms n="dashboard" size={14} />{dashboardName ?? 'Dashboard'}
            </button>
          )}
        </div>
        {w.placeId && placeName ? (
          <button onClick={(e) => { stop(e); go('ask', undefined, { place: w.placeId! }); }} className="row" style={{ alignSelf: 'flex-start', gap: 4, padding: 0, border: 0, background: 'none', color: 'var(--blue)', font: '500 13px/1.38 var(--font)' }}>
            <Ms n="location_on" size={14} />{placeName}
          </button>
        ) : (
          <span className="caption row" style={{ gap: 4 }}><Ms n="travel_explore" size={14} />All my places</span>
        )}

        <div className="row wrap" style={{ alignItems: 'baseline', gap: 8, marginTop: 4 }}>
          <span style={{ font: '700 32px/1.17 var(--font)', letterSpacing: -0.8 }}>{watchValue(w)}</span>
          <span className="body-sm">{w.metric}</span>
        </div>
        <div className="tiny" style={{ marginTop: -4 }}>
          <span className="muted">{watchRange(w)}</span>{w.baselineLabel ? <> · {w.baselineLabel}: {watchBaseline(w)}</> : null}
        </div>
        <div className="caption" style={{ color: accent ?? 'var(--muted)' }}>{w.hasRun ? w.delta : 'Waiting for the first pass'}</div>

        {hasSeries(w) && (
          <div style={{ marginTop: 4 }}>
            <HistoryChart series={w.series.current} band={[w.series.bandLow, w.series.bandHigh]} mean={w.series.mean} color={cat.color} height={70} compact />
          </div>
        )}

        <div className="row" style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid var(--hair-soft)', gap: 10 }}>
          <span className="row" style={{ gap: 4 }} title={w.channels.map((c) => channels.find((x) => x.id === c)?.name).join(', ')}>
            {w.channels.map((c) => <Ms key={c} n={channels.find((x) => x.id === c)?.icon ?? 'notifications'} size={16} className="muted" />)}
          </span>
          <span className="tiny grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.cadence}</span>
          <span onClick={stop} onKeyDown={stop}>
            <Toggle
              on={w.enabled}
              title={w.enabled ? 'Pause trigger' : 'Resume trigger'}
              onClick={() => {
                const resuming = !w.enabled;
                void updateWatch(w.id, { enabled: resuming })
                  .then(() => notify(resuming ? `Resumed \u201c${w.name}\u201d` : `Paused \u201c${w.name}\u201d`))
                  .catch(() => notify('Could not change the trigger', undefined, undefined, 'error'));
              }}
            />
          </span>
        </div>
      </div>
    </div>
  );
}
