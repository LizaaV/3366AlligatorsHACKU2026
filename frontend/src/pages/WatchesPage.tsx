import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { CHANNELS, type Watch } from '../data/watches';
import { CATS } from '../data/catalog';
import { Btn, Empty, HistoryChart, Ms, RingOverlay, Tier, Toggle } from '../components/ui';
import { AskBar, STATUS, WatchDetail, ciLabel, fmtVal, nextRank, type AskAnswer } from './WatchDetail';

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
  const { watches, places, open, t } = useStore();
  const [cat, setCat] = useState<number | 'all'>('all');
  const [grouped, setGrouped] = useState(true);

  const active = watches.filter((w) => w.on);
  const attention = active.filter((w) => w.status !== 'ok');
  const soonest = [...active].sort((a, b) => nextRank(a.nextRun) - nextRank(b.nextRun))[0];
  const channelsUsed = CHANNELS.filter((c) => active.some((w) => w.channels.includes(c.id)));

  const catsUsed = useMemo(
    () => CATS.map((c, i) => ({ c, i, n: watches.filter((w) => w.cat === i).length })).filter((x) => x.n > 0),
    [watches],
  );
  const shown = cat === 'all' ? watches : watches.filter((w) => w.cat === cat);
  const groups = catsUsed.filter((g) => cat === 'all' || g.i === cat).map((g) => ({ ...g, list: shown.filter((w) => w.cat === g.i) }));

  const answer = (q: string): AskAnswer => {
    const first = attention.find((w) => w.id === 'w-dry') ?? attention[0];
    const steps = [`Read ${watches.length} watches`, 'Compared last 3 passes', 'Checked 5-year baseline'];
    const hasDry = watches.some((w) => w.id === 'w-dry');
    if (/irrigat/i.test(q) && hasDry)
      return {
        steps,
        title: 'Fix spans 5–6 on North Pivot before Oct 3',
        body: `You asked: “${q}” The dry arc on North Pivot follows pivot spans 5–6 and is now 4.6 ha (90% range 3.9–5.3) vs 1.2 ha for the 5-year average at this week. NDMI there is 0.12 while the rest of the field holds near 0.31, and surface temperature is 2.8 °C above the field average. Check nozzles and pressure regulators on spans 5–6 and the end-gun timer. South Block is rain-fed and stable at NDVI 0.71 (range 0.68–0.74), so no change is needed there. Confidence is medium: the cause is inferred, not observed.`,
      };
    if (first)
      return {
        steps,
        title: `${first.name.split(' · ').pop()} needs attention first`,
        body: hasDry
          ? `You asked: “${q}” The dry zone on North Pivot grew from 2.1 ha to 4.6 ha (90% range 3.9–5.3) over the last three passes, vs 1.2 ha for the 5-year average at this week, while the rest of the field held NDMI near 0.31. Surface temperature there is 2.8 °C above the field average. South Block is stable at NDVI 0.71. Lake Erie chlorophyll is 28 µg/L (range 21–35) — above the 5-year average of 19 but falling. Check spans 5–6 on North Pivot before the next pass on Oct 3; if the zone keeps growing at this rate it will pass your 5 ha trigger.`
          : `You asked: “${q}” ${first.metric} is ${fmtVal(first.value, first.unit)} (${ciLabel(first)}) vs ${fmtVal(first.baseline, first.unit)} for the ${first.baselineLabel.toLowerCase()}. ${first.delta}. Your rule is “${first.condition}”.`,
      };
    if (watches.length)
      return { steps, title: 'Nothing needs attention right now', body: `You asked: “${q}” All ${watches.length} watches are inside their normal 5-year range. The next update is ${soonest?.nextRun ?? 'after the next pass'}.` };
    return { steps, title: 'You have no watches yet', body: 'Ask the agent to build one — tell it what to watch and where, and it will check if satellites can see it.' };
  };

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
          <div className="eyebrow">Watches</div>
          <div className="h1" style={{ marginTop: 10 }}>{t('watches.title')}</div>
          <div className="body" style={{ marginTop: 6, maxWidth: 640 }}>{t('watches.sub')}</div>
        </div>
        <Btn variant="primary" icon="add" tier="free" onClick={() => open({ kind: 'watchBuilder' })}>New watch</Btn>
      </div>

      <div className="stats wp-stats">
        <div>
          <div className="l">Active watches</div>
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
          <div className="v">{soonest?.nextRun ?? '—'}</div>
          <div className="ci">{soonest ? soonest.sat.split(' · ')[0] : 'No active watches'}</div>
        </div>
        <div>
          <div className="l">Delivery channels</div>
          <div className="v row" style={{ gap: 6 }}>
            {channelsUsed.length ? channelsUsed.map((c) => <Ms key={c.id} n={c.icon} size={20} />) : '—'}
          </div>
          <div className="ci">{channelsUsed.map((c) => c.name).join(' · ') || 'None yet'}</div>
        </div>
      </div>

      <AskBar
        placeholder="Ask your watches what changed and what it means for you…"
        suggestions={['What changed since last week?', 'Which place needs attention first?', 'What does this mean for my irrigation?']}
        thinkLabel={`Reading ${watches.length} watches and comparing the last 3 passes…`}
        answer={answer}
        onExport={(a) => open({ kind: 'export', target: { kind: 'answer', title: a.title, subtitle: 'From your watches' } })}
        onExpert={(a) => open({ kind: 'expert', context: a.title, placeId: null })}
      />

      <div className="col" style={{ gap: 16 }}>
        <div className="row wrap" style={{ justifyContent: 'space-between', gap: 12 }}>
          <div className="wp-chips grow" role="tablist" aria-label="Filter by category">
            <button className={`chip ${cat === 'all' ? 'on' : ''}`} onClick={() => setCat('all')}>All <span style={{ opacity: 0.6 }}>{watches.length}</span></button>
            {catsUsed.map(({ c, i, n }) => (
              <button key={c.key} className={`chip ${cat === i ? 'on' : ''}`} onClick={() => setCat(i)}>
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

        {watches.length === 0 ? (
          <Empty icon="visibility" title="No watches yet" body="Tell the agent what to keep an eye on. It checks whether satellites can see it, then alerts you by email, WhatsApp or push.">
            <Btn variant="primary" icon="add" tier="free" onClick={() => open({ kind: 'watchBuilder' })}>New watch</Btn>
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
                {g.list.map((w) => <WatchCard key={w.id} w={w} placeName={places.find((p) => p.id === w.placeId)?.name} />)}
                {gi === groups.length - 1 && <AddTile />}
              </div>
            </section>
          ))
        ) : (
          <div className="grid-cards">
            {shown.map((w) => <WatchCard key={w.id} w={w} placeName={places.find((p) => p.id === w.placeId)?.name} />)}
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
      Ask the agent to build a watch
      <span className="tiny" style={{ maxWidth: 240 }}>Describe it in a sentence — the agent checks if satellites can see it.</span>
      <Tier tier="free" />
    </button>
  );
}

function WatchCard({ w, placeName }: { w: Watch; placeName?: string }) {
  const { go, updateWatch, notify } = useStore();
  const cat = CATS[w.cat];
  const accent = w.on && w.status !== 'ok' ? STATUS[w.status].color : null;
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div
      className="card wp-card fade-up col"
      role="link"
      tabIndex={0}
      onClick={() => go('watches', w.id)}
      onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && go('watches', w.id)}
      style={{ overflow: 'hidden', position: 'relative', opacity: w.on ? 1 : 0.78, boxShadow: accent ? `inset 3px 0 0 ${accent}` : undefined }}
    >
      <div style={{ position: 'relative', height: 150, background: `#000 url(${w.img}) center/cover`, filter: w.on ? undefined : 'grayscale(.6)' }}>
        {w.ring && <RingOverlay size={110} />}
        {accent && (
          <span className="pill" style={{ position: 'absolute', left: 12, top: 12, color: accent }}>
            <span className="dot" style={{ background: accent }} />
            {STATUS[w.status].label}
          </span>
        )}
        <span style={{ position: 'absolute', right: 12, bottom: 12 }}>
          {w.on ? <span className="live"><span className="dot" />LIVE</span> : <span className="live" style={{ color: 'var(--muted)' }}><Ms n="pause" size={12} />PAUSED</span>}
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

        <div className="row wrap" style={{ alignItems: 'baseline', gap: 8, marginTop: 4 }}>
          <span style={{ font: '700 32px/1.17 var(--font)', letterSpacing: -0.8 }}>{fmtVal(w.value, w.unit)}</span>
          <span className="body-sm">{w.metric}</span>
        </div>
        <div className="tiny" style={{ marginTop: -4 }}>
          <span className="muted">{ciLabel(w)}</span> · {w.baselineLabel}: {fmtVal(w.baseline, w.unit)}
        </div>
        <div className="caption" style={{ color: accent ?? 'var(--muted)' }}>{w.delta}</div>

        <div style={{ marginTop: 4 }}>
          <HistoryChart series={w.history} band={w.band} mean={w.histMean} color={cat.color} height={70} compact />
        </div>

        <div className="row" style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid var(--hair-soft)', gap: 10 }}>
          <span className="row" style={{ gap: 4 }} title={w.channels.map((c) => CHANNELS.find((x) => x.id === c)?.name).join(', ')}>
            {w.channels.map((c) => <Ms key={c} n={CHANNELS.find((x) => x.id === c)?.icon ?? 'notifications'} size={16} className="muted" />)}
          </span>
          <span className="tiny grow" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{w.cadence}</span>
          <Tier tier={w.tier} />
          <span onClick={stop} onKeyDown={stop}>
            <Toggle
              on={w.on}
              title={w.on ? 'Pause watch' : 'Resume watch'}
              onClick={() => {
                updateWatch(w.id, { on: !w.on, nextRun: w.on ? 'Paused' : 'Next pass' });
                notify(w.on ? `Paused “${w.name}”` : `Resumed “${w.name}”`);
              }}
            />
          </span>
        </div>
      </div>
    </div>
  );
}
