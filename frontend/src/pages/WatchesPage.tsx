import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import type { Place, Watch } from '../model';
import { thumb } from '../lib/geo';
import { STATUS_STYLE, hasMeasurement, hasSeries, hasStatus } from '../data/presentation';
import { ciLabel, fmtDate, fmtVal } from '../lib/format';
import { Btn, Empty, HistoryChart, Ms, RingOverlay, Toggle } from '../components/ui';
import { ErrorState, SkeletonCard } from '../components/async';
import { WatchDetail } from './WatchDetail';

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
  const { watches, places, open, t, categories, loading, errors, reload } = useStore();
  const [cat, setCat] = useState<number | 'all'>('all');
  const [grouped, setGrouped] = useState(true);

  const active = watches.filter((w) => w.enabled);
  const attention = active.filter((w) => hasStatus(w) && w.status !== 'ok');
  const checked = watches.filter((w) => w.lastRunAt);

  const catsUsed = useMemo(
    () => categories.map((c, i) => ({ c, i, n: watches.filter((w) => w.categoryKey === c.key).length })).filter((x) => x.n > 0),
    [watches, categories],
  );
  const shown = cat === 'all' ? watches : watches.filter((w) => w.categoryKey === categories[cat]?.key);
  const groups = catsUsed.filter((g) => cat === 'all' || g.i === cat).map((g) => ({ ...g, list: shown.filter((w) => w.categoryKey === g.c.key) }));

  return (
    <>
      <style>{`
        .wp-stats { grid-template-columns: repeat(3, minmax(0, 1fr)); }
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
          <div className="body" style={{ marginTop: 6, maxWidth: 640 }}>Saved questions about your places, each with the condition you care about.</div>
          <div className="caption" style={{ marginTop: 6, maxWidth: 640 }}>Automatic re-checks and alerts are not running yet: a trigger shows numbers once a run has measured it.</div>
        </div>
        <Btn variant="primary" icon="add" onClick={() => open({ kind: 'watchBuilder' })}>New trigger</Btn>
      </div>

      <div className="stats wp-stats">
        <div>
          <div className="l">Active triggers</div>
          <div className="v">{active.length}</div>
          <div className="ci">{watches.length - active.length} paused</div>
        </div>
        <div>
          <div className="l">Need attention</div>
          <div className="v" style={{ color: attention.length ? 'var(--yellow)' : undefined }}>{checked.length ? attention.length : '—'}</div>
          <div className="ci">{!checked.length ? 'Not checked yet' : attention.length ? attention.map((w) => w.name.split(' · ').pop()).join(', ') : 'All normal'}</div>
        </div>
        <div>
          <div className="l">Checked</div>
          <div className="v">{checked.length}</div>
          <div className="ci">{checked.length ? `of ${watches.length} triggers` : 'Not checked yet'}</div>
        </div>
      </div>

      <div className="col" style={{ gap: 16 }}>
        <div className="row wrap" style={{ justifyContent: 'space-between', gap: 12 }}>
          <div className="wp-chips grow" role="tablist" aria-label="Filter by category">
            <button role="tab" aria-selected={cat === 'all'} className={`chip ${cat === 'all' ? 'on' : ''}`} onClick={() => setCat('all')}>All <span style={{ opacity: 0.6 }}>{watches.length}</span></button>
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
          <Empty icon="notifications" title="No triggers yet" body="Describe what to look for at a place. The agent checks whether satellites can see it before you save the trigger.">
            <Btn variant="primary" icon="add" onClick={() => open({ kind: 'watchBuilder' })}>New trigger</Btn>
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
                {g.list.map((w) => { const pl = places.find((p) => p.id === w.placeId); return <WatchCard key={w.id} w={w} placeName={pl?.name} place={pl} />; })}
                {gi === groups.length - 1 && <AddTile />}
              </div>
            </section>
          ))
        ) : (
          <div className="grid-cards">
            {shown.map((w) => { const pl = places.find((p) => p.id === w.placeId); return <WatchCard key={w.id} w={w} placeName={pl?.name} place={pl} />; })}
            <AddTile />
          </div>
        )}

        <ExampleTriggers />
      </div>
    </>
  );
}

/**
 * Ready-made trigger ideas from the team's pitch and research docs. Picking one opens the
 * builder with the sentence filled in, so the agent still checks it against real coverage.
 */
const EXAMPLE_TRIGGERS: { icon: string; categoryKey: string; title: string; text: string; when: string }[] = [
  { icon: 'flood', categoryKey: 'disasters', title: 'Flood check after a rainstorm', text: 'When a Black Rainstorm warning is issued, check flooding around my building with radar and message me', when: 'On an event' },
  { icon: 'water_drop', categoryKey: 'agriculture', title: 'Weekly dry-patch alert', text: 'Every week, tell me if a dry patch in my field grows past 2 ha', when: 'Weekly' },
  { icon: 'set_meal', categoryKey: 'oceans', title: 'Red tide near a fish farm', text: 'Alert me if algae or red tide appears within 2 km of my fish farm', when: 'Every pass' },
  { icon: 'forest', categoryKey: 'forests', title: 'Forest cleared on a plot', text: 'Warn me if any forest is cleared on this plot compared with 31 Dec 2020', when: 'Every pass' },
  { icon: 'grass', categoryKey: 'agriculture', title: 'Pasture for herders', text: 'Tell me when the grass here drops below its 5-year average for this month', when: 'Every 10 days' },
  { icon: 'construction', categoryKey: 'urban', title: 'New construction nearby', text: 'Tell me when new buildings or cleared ground appear around the reservoir', when: 'Monthly' },
  { icon: 'local_fire_department', categoryKey: 'disasters', title: 'Fire close to my farm', text: 'Alert me if a fire starts within 10 km of my farm', when: 'Daily' },
  { icon: 'waves', categoryKey: 'water', title: 'Pond filled in', text: 'Tell me if any of the ponds here stop holding open water', when: 'One time' },
];

function ExampleTriggers() {
  const { open, category } = useStore();
  return (
    <section className="col" style={{ gap: 14, marginTop: 24 }}>
      <div className="col" style={{ gap: 4 }}>
        <span className="eyebrow">Examples</span>
        <span className="caption">Start from one of these. Each can be recurring or one-time, and you can change the sentence before saving.</span>
      </div>
      <div className="grid-cards">
        {EXAMPLE_TRIGGERS.map((ex) => {
          const cat = category(ex.categoryKey);
          return (
            <button
              key={ex.title}
              className="card wp-card col"
              onClick={() => open({ kind: 'watchBuilder', prefill: ex.text })}
              style={{ padding: 18, gap: 8, textAlign: 'left', color: 'inherit', font: 'inherit' }}
            >
              <div className="row" style={{ gap: 8 }}>
                <Ms n={ex.icon} size={20} style={{ color: cat.color }} />
                <span className="eyebrow">{cat.name}</span>
                <span className="tiny" style={{ marginLeft: 'auto' }}>{ex.when}</span>
              </div>
              <div className="card-title">{ex.title}</div>
              <div className="body-sm">{ex.text}</div>
              <span className="row tiny" style={{ marginTop: 'auto', paddingTop: 6, gap: 4, color: 'var(--blue)' }}><Ms n="add" size={14} />Use this trigger</span>
            </button>
          );
        })}
      </div>
    </section>
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
      Ask the agent to set a trigger
      <span className="tiny" style={{ maxWidth: 240 }}>Describe it in a sentence; the agent checks if satellites can see it.</span>
    </button>
  );
}

/**
 * Thumbnail for a trigger. The backend sends a location and a zoom hint, not a baked tile URL —
 * building the URL is a frontend concern (and lets the basemap provider change freely).
 */
const thumbFor = (w: Watch, place?: Place) =>
  place ? thumb(place.lat, place.lon, w.thumbnailZoom) : thumb(0, 0, 2);

function WatchCard({ w, placeName, place }: { w: Watch; placeName?: string; place?: Place }) {
  const { go, updateWatch, notify, category } = useStore();
  const cat = category(w.categoryKey);
  const accent = w.enabled && hasStatus(w) && w.status !== 'ok' ? STATUS_STYLE[w.status].color : null;
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
          {w.enabled ? <span className="live" style={{ color: 'var(--muted)' }}>ACTIVE</span> : <span className="live" style={{ color: 'var(--muted)' }}><Ms n="pause" size={12} />PAUSED</span>}
        </span>
      </div>

      <div className="col" style={{ padding: '18px 20px 18px', gap: 8, flex: 1 }}>
        <div className="row">
          <span className="sq" style={{ background: cat.color }} />
          <span className="eyebrow">{cat.name}</span>
        </div>
        <div className="card-title">{w.name}</div>
        {w.placeId && placeName ? (
          <button onClick={(e) => { stop(e); go('ask', undefined, { place: w.placeId! }); }} className="row" style={{ alignSelf: 'flex-start', gap: 4, padding: 0, border: 0, background: 'none', color: 'var(--blue)', font: '500 13px/1.38 var(--font)' }}>
            <Ms n="location_on" size={14} />{placeName}
          </button>
        ) : (
          <span className="caption row" style={{ gap: 4 }}><Ms n="travel_explore" size={14} />All my places</span>
        )}

        {hasMeasurement(w) ? (
          <>
            <div className="row wrap" style={{ alignItems: 'baseline', gap: 8, marginTop: 4 }}>
              <span style={{ font: '700 32px/1.17 var(--font)', letterSpacing: -0.8 }}>{fmtVal(w.value, w.unit ?? '')}</span>
              <span className="body-sm">{w.metric}</span>
            </div>
            <div className="tiny" style={{ marginTop: -4 }}>
              {w.ci && <span className="muted">{ciLabel(w)}</span>}
              {typeof w.baseline === 'number' && <> · {w.baselineLabel}: {fmtVal(w.baseline, w.unit ?? '')}</>}
            </div>
            {w.delta && <div className="caption" style={{ color: accent ?? 'var(--muted)' }}>{w.delta}</div>}
          </>
        ) : (
          <div className="col" style={{ gap: 2, marginTop: 4 }}>
            <span className="body-sm ink">Not checked yet</span>
            <span className="tiny" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{w.condition || w.question}</span>
          </div>
        )}

        {hasSeries(w) && (
          <div style={{ marginTop: 4 }}>
            <HistoryChart series={w.series.current} band={w.series.bandLow?.length ? [w.series.bandLow, w.series.bandHigh] : undefined} mean={w.series.mean?.length ? w.series.mean : undefined} color={cat.color} height={70} compact />
          </div>
        )}

        <div className="row" style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid var(--hair-soft)', gap: 10 }}>
          <span className="tiny grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.lastRunAt ? `Checked ${fmtDate(w.lastRunAt)}` : 'Not checked yet'}</span>
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
