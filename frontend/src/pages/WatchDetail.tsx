import { useCallback, useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { api } from '../api';
import { useResource } from '../hooks/useResource';
import type { ChannelId, DeliveryChannel, Watch } from '../model';
import { STATUS_STYLE } from '../data/presentation';
import { ciLabel, fmtDateTime, fmtDay, fmtVal } from '../lib/format';
import { Btn, Check, ConfidenceBadge, Empty, HistoryChart, Ms, Tier } from '../components/ui';
import { ErrorState, Skeleton } from '../components/async';

/* ---------- status pill ---------- */

export const StatusPill = ({ status, on = true }: { status: Watch['status']; on?: boolean }) =>
  !on ? (
    <span className="pill" style={{ background: 'var(--s2)' }}><Ms n="pause" size={14} />Paused</span>
  ) : (
    <span className="pill" style={{ background: 'var(--s2)', color: status === 'ok' ? 'var(--muted)' : STATUS_STYLE[status].color }}>
      <span className="dot" style={{ background: STATUS_STYLE[status].color }} />
      {STATUS_STYLE[status].label}
    </span>
  );

/** Whether a trigger keeps firing on every pass or fires once and stops. */
export const RecurrencePill = ({ recurrence }: { recurrence: Watch['recurrence'] }) => (
  <span className="pill" style={{ background: 'var(--s2)' }} title={recurrence === 'once' ? 'Fires once, then stops' : 'Checks on every new satellite pass'}>
    <Ms n={recurrence === 'once' ? 'looks_one' : 'autorenew'} size={14} />
    {recurrence === 'once' ? 'One-time' : 'Recurring'}
  </span>
);

/* ---------- chart range helpers ---------- */

type Range = 'season' | 'year' | 'five';
const wobble = (i: number, amp: number) => Math.sin(i * 1.7) * amp + Math.cos(i * 0.9) * amp * 0.5;
const clamp = (v: number) => Math.max(0, Math.min(1.05, v));

function chartData(w: Watch, r: Range) {
  const { current, bandLow, bandHigh, mean: avg, labels } = w.series;
  if (r === 'season') return { series: current, band: [bandLow, bandHigh] as [number[], number[]], mean: avg, labels };
  if (r === 'year') {
    const prev = avg.map((v, i) => clamp(v * 0.96 + wobble(i, 0.02)));
    return {
      series: [...prev, ...current],
      band: [[...bandLow, ...bandLow], [...bandHigh, ...bandHigh]] as [number[], number[]],
      mean: [...avg, ...avg],
      labels: ['Oct ’25', 'Jan', 'Apr', 'Jul', 'Oct'],
    };
  }
  const years = [0.94, 1.04, 0.9, 1.08];
  const past = years.flatMap((k, y) => avg.map((v, i) => clamp(v * k + wobble(i + y * 12, 0.025))));
  return {
    series: [...past, ...current],
    band: [[0, 1, 2, 3, 4].flatMap(() => bandLow), [0, 1, 2, 3, 4].flatMap(() => bandHigh)] as [number[], number[]],
    mean: [0, 1, 2, 3, 4].flatMap(() => avg),
    labels: ['2022', '2023', '2024', '2025', '2026'],
  };
}

function chartReading(w: Watch) {
  const i = w.series.current.length - 1;
  const v = w.series.current[i], lo = w.series.bandLow[i], hi = w.series.bandHigh[i];
  const base = `${w.baselineLabel}: ${fmtVal(w.baseline, w.unit)}`;
  if (v > hi) return `${w.metric} is now ${fmtVal(w.value, w.unit)} — above anything seen at this time of year in the last 5 years (${base}).`;
  if (v < lo) return `${w.metric} is now ${fmtVal(w.value, w.unit)} — below the usual range for this time of year (${base}).`;
  return `${w.metric} is ${fmtVal(w.value, w.unit)}, inside the normal range for this time of year (${base}).`;
}

/* ---------- proof scenes ---------- */

/* ---------- detail page ---------- */

const LEVEL_COLOR = { info: 'var(--subtle)', warn: 'var(--yellow)', alert: 'var(--red)' } as const;

export function WatchDetail({ id }: { id: string }) {
  const { watches, places, skills, channels, category, go, open, notify, updateWatch, removeWatch, connectors } = useStore();
  const w = watches.find((x) => x.id === id);
  const [range, setRange] = useState<Range>('season');
  const data = useMemo(() => (w ? chartData(w, range) : null), [w, range]);
  const proof = useResource(useCallback((signal) => api.watches.proof(id, signal), [id]), [id]);
  const dashboards = useResource(useCallback((signal) => api.dashboards.list(signal), []), []);

  if (!w || !data) {
    return (
      <div className="col" style={{ gap: 16 }}>
        <button className="btn btn-text" style={{ alignSelf: 'flex-start' }} onClick={() => go('triggers')}><Ms n="arrow_back" className="ms-flip" />All triggers</button>
        <Empty icon="visibility_off" title="This trigger no longer exists" body="It may have been deleted. Your other triggers are still running.">
          <Btn variant="primary" onClick={() => go('triggers')}>See all triggers</Btn>
        </Empty>
      </div>
    );
  }

  const cat = category(w.categoryKey);
  const place = places.find((p) => p.id === w.placeId);
  const scenes = proof.data?.scenes ?? [];
  const skill = skills.find((x) => x.id === w.skillId);

  const color = cat.color;

  const toggleChannel = (c: DeliveryChannel) => {
    const has = w.channels.includes(c.id);
    const next: ChannelId[] = has ? w.channels.filter((x) => x !== c.id) : [...w.channels, c.id];
    void updateWatch(w.id, { channels: next }).catch(() => notify('Could not update the channels', undefined, undefined, 'error'));
  };

  const del = async () => {
    const name = w.name;
    try {
      await removeWatch(w.id);
      go('triggers');
      // No Undo: re-creating would mint a new server-side record rather than restore this one.
      // TODO(api): a soft-delete + POST /watches/{id}/restore would let Undo work honestly.
      notify(`Deleted \u201c${name}\u201d`, undefined, undefined, 'delete');
    } catch {
      notify('Could not delete the trigger', undefined, undefined, 'error');
    }
  };

  return (
    <div className="col" style={{ gap: 28 }}>
      <style>{`
        .wd-two { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 24px; align-items: start; }
        .wd-kpi { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        .wd-kpi > div { padding: 16px 18px; }
        .wd-kpi .v { font-size: 24px; letter-spacing: -0.4px; }
        @media (max-width: 900px) { .wd-two { grid-template-columns: 1fr; } .wd-kpi { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
        @media (max-width: 760px) { .wd-kpi .v { font-size: 18px; } }
      `}</style>

      {/* sub header */}
      <div className="col" style={{ gap: 14, paddingBottom: 20, borderBottom: '1px solid var(--hair-soft)' }}>
        <button className="btn btn-text btn-sm" style={{ alignSelf: 'flex-start', marginLeft: -12 }} onClick={() => go('triggers')}>
          <Ms n="arrow_back" className="ms-flip" />All triggers
        </button>
        <div className="h1" style={{ fontSize: 'clamp(28px, 4vw, 48px)' }}>{w.name}</div>
        <div className="row wrap">
          <span className="pill" style={{ background: 'var(--s2)' }}><span className="dot" style={{ background: color }} />{cat.name}</span>
          {place ? (
            <button className="pill" style={{ border: 0, background: 'var(--s2)', color: '#fff' }} onClick={() => go('ask', undefined, { place: place.id })}>
              <Ms n="location_on" size={14} />{place.name}
            </button>
          ) : (
            <span className="pill" style={{ background: 'var(--s2)' }}><Ms n="travel_explore" size={14} />All my places</span>
          )}
          <StatusPill status={w.status} on={w.enabled} />
          <RecurrencePill recurrence={w.recurrence} />
          {w.dashboardId && (
            <button className="pill" style={{ border: 0, background: 'var(--s2)', color: '#fff' }} onClick={() => go('dashboard', w.dashboardId!)}>
              <Ms n="dashboard" size={14} />
              {dashboards.data?.find((d) => d.id === w.dashboardId)?.name ?? 'Dashboard'}
            </button>
          )}
          <ConfidenceBadge level={w.confidence} />
        </div>
        <div className="row wrap">
          <Btn icon="ios_share" tier="free" onClick={() => open({ kind: 'export', target: { kind: 'watch', title: w.name, subtitle: place?.name } })}>Export</Btn>
          <Btn icon="support_agent" tier="paid" tierLabel="from $49" onClick={() => open({ kind: 'expert', context: w.name, placeId: w.placeId })}>Ask an expert</Btn>
          <Btn icon="refresh" tier="free" onClick={() => notify(`Re-checking with the latest ${w.satellites.split(' · ')[0]} pass…`, undefined, undefined, 'satellite_alt')}>Run now</Btn>
          <Btn
            icon={w.enabled ? 'pause' : 'play_arrow'}
            onClick={() => {
              void updateWatch(w.id, { enabled: !w.enabled })
                .then(() => notify(w.enabled ? 'Trigger paused' : 'Trigger resumed'))
                .catch(() => notify('Could not change the trigger', undefined, undefined, 'error'));
            }}
          >
            {w.enabled ? 'Pause' : 'Resume'}
          </Btn>
          <Btn variant="text" icon="delete" onClick={del}>Delete</Btn>
        </div>
      </div>

      {/* KPIs */}
      <div className="stats wd-kpi">
        <div>
          <div className="l">{w.metric} · now</div>
          <div className="v">{fmtVal(w.value, w.unit)}</div>
          <div className="ci">{ciLabel(w)}</div>
        </div>
        <div>
          <div className="l">Historical reference</div>
          <div className="v">{fmtVal(w.baseline, w.unit)}</div>
          <div className="ci">{w.baselineLabel}</div>
        </div>
        <div>
          <div className="l">Change</div>
          <div className="v" style={{ color: w.status === 'ok' ? undefined : STATUS_STYLE[w.status].color }}>{w.delta}</div>
          <div className="ci">Last checked {fmtDateTime(w.lastRunAt)}</div>
        </div>
        <div>
          <div className="l">Next update</div>
          <div className="v">{fmtDay(w.nextRunAt)}</div>
          <div className="ci">{w.satellites}</div>
        </div>
      </div>

      {/* big chart */}
      <div className="card col" style={{ padding: 24, gap: 14 }}>
        <div className="row wrap" style={{ justifyContent: 'space-between', gap: 12 }}>
          <div>
            <div className="eyebrow">Historical reference</div>
            <div className="card-title" style={{ marginTop: 6 }}>This season vs the last 5 years</div>
          </div>
          <div className="seg" role="tablist" aria-label="Chart range">
            {([['season', 'This season'], ['year', '1 year'], ['five', '5 years']] as [Range, string][]).map(([k, l]) => (
              <button key={k} className={range === k ? 'on' : ''} onClick={() => setRange(k)} role="tab" aria-selected={range === k}>{l}</button>
            ))}
          </div>
        </div>
        <HistoryChart series={data.series} band={data.band} mean={data.mean} color={color} labels={data.labels} height={220} />
        <div className="body-sm">{chartReading(w)}</div>
      </div>

      {/* two columns */}
      <div className="wd-two">
        <div className="col" style={{ gap: 24 }}>
          <div className="card col" style={{ padding: 24, gap: 16 }}>
            <div className="eyebrow">What happened</div>
            <div className="col" style={{ gap: 0 }}>
              {w.events.map((e, i) => (
                <div key={i} className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
                  <div className="col" style={{ alignItems: 'center', alignSelf: 'stretch' }}>
                    <span className="dot" style={{ width: 10, height: 10, marginTop: 5, background: LEVEL_COLOR[e.level], boxShadow: e.level === 'info' ? 'none' : `0 0 0 4px ${e.level === 'warn' ? 'rgba(255,207,37,.15)' : 'rgba(230,43,30,.18)'}` }} />
                    {i < w.events.length - 1 && <span style={{ flex: 1, width: 1, background: 'var(--hair-soft)', marginTop: 6 }} />}
                  </div>
                  <div style={{ paddingBottom: 18, minWidth: 0 }}>
                    <div className="tiny">{fmtDay(e.at, '—')}{e.level !== 'info' && <span style={{ color: LEVEL_COLOR[e.level], marginLeft: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>{e.level === 'warn' ? 'Warning' : 'Alert'}</span>}</div>
                    <div className="body-sm ink" style={{ marginTop: 2 }}>{e.text}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* proof */}
          <div className="card col" style={{ padding: 24, gap: 14 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div className="eyebrow">Proof</div>
              <span className="tiny">Last 5 scenes</span>
            </div>
            <div className="body-sm">Every result can be traced to the exact satellite scenes behind it, including the ones the agent threw away.</div>
            {proof.isLoading && <Skeleton h={14} lines={5} />}
            {proof.error && !proof.isLoading && (
              <ErrorState error={proof.error} onRetry={proof.refetch} title="Could not load the scene list" compact />
            )}
            <div className="col" style={{ gap: 0, borderTop: '1px solid var(--hair-soft)' }}>
              {scenes.map((s) => (
                <div key={s.sceneId} className="row" style={{ gap: 12, padding: '10px 0', borderBottom: '1px solid var(--hair-soft)', alignItems: 'flex-start' }}>
                  <Ms n={s.used ? 'check_circle' : 'block'} size={18} style={{ color: s.used ? 'var(--green)' : 'var(--subtle)', marginTop: 1 }} />
                  <div className="grow">
                    <div style={{ font: '500 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace', color: s.used ? 'var(--ink)' : 'var(--subtle)', overflowWrap: 'anywhere' }}>{s.sceneId}</div>
                    <div className="tiny">{s.date} · {s.satellite} · {s.used ? 'Used' : s.why}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="tiny" style={{ overflowWrap: 'anywhere' }}>
              Processing hash <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', color: 'var(--muted)' }}>{proof.data?.hash ?? ''}</span> · skill {skill ? `${skill.name} v${skill.version}` : w.skillId}
            </div>
            <div className="row wrap">
              <Btn size="sm" icon="download" tier="free" onClick={() => notify('Proof pack ready: scenes, masks, settings and hash (ZIP, 14 MB)', undefined, undefined, 'download')}>Download proof pack</Btn>
              <Btn size="sm" icon="verified" tier="paid" tierLabel="$5" onClick={() => notify('Notarised proof requested — timestamped and signed within 1 hour', undefined, undefined, 'verified')}>Notarised proof</Btn>
            </div>
          </div>
        </div>

        <div className="col" style={{ gap: 24 }}>
          {/* rule */}
          <div className="card col" style={{ padding: 24, gap: 16 }}>
            <div className="eyebrow">Rule</div>
            <div className="subhead" style={{ fontSize: 18 }}>“{w.question}”</div>
            <div className="stats" style={{ gridTemplateColumns: '1fr' }}>
              <div><div className="l">Tell me when</div><div className="v" style={{ fontSize: 15 }}>{w.condition}</div></div>
              <div><div className="l">How often</div><div className="v" style={{ fontSize: 15 }}>{w.cadence}</div></div>
              <div><div className="l">Satellite</div><div className="v" style={{ fontSize: 15 }}>{w.satellites}</div></div>
              <div>
                <div className="l">Skill</div>
                <button className="btn-text" style={{ border: 0, background: 'none', padding: 0, marginTop: 2, color: 'var(--blue)', font: '600 15px/1.35 var(--font)' }} onClick={() => go('library', w.skillId)}>
                  {skill?.name ?? w.skillId} <Ms n="arrow_forward" size={14} className="ms-flip" />
                </button>
              </div>
            </div>
            <div className="col" style={{ gap: 4 }}>
              <div className="l caption" style={{ marginBottom: 6 }}>Deliver to</div>
              {channels.map((c) => {
                const on = w.channels.includes(c.id);
                const needsConnect = c.id === 'whatsapp' && !connectors.whatsapp.connected;
                return (
                  <div key={c.id} className="row" style={{ gap: 10, padding: '8px 0' }}>
                    <button onClick={() => toggleChannel(c)} className="row grow" style={{ gap: 10, background: 'none', border: 0, padding: 0, textAlign: 'left' }} aria-pressed={on}>
                      <Check on={on} />
                      <Ms n={c.icon} size={18} className="muted" />
                      <span className="body-sm ink">{c.name}</span>
                      <Tier tier={c.tier} />
                    </button>
                    {needsConnect ? (
                      <Btn size="sm" variant="text" onClick={() => open({ kind: 'connectors', focus: 'whatsapp' })}>Connect</Btn>
                    ) : (
                      <span className="tiny hide-mobile">{c.note}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* limits */}
          <div className="card col" style={{ padding: 24, gap: 12 }}>
            <div className="eyebrow">Accuracy &amp; limits</div>
            <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <Ms n="fact_check" size={18} className="muted" />
              <div className="body-sm ink">{skill?.accuracy ?? 'Accuracy not yet measured for this skill.'}</div>
            </div>
            <ul className="body-sm" style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(skill?.limits ?? ['Optical satellites cannot see through cloud; cloudy passes are skipped.']).map((l) => <li key={l}>{l}</li>)}
              <li>The 90% range means 9 in 10 re-measurements of the same scene would land inside it.</li>
            </ul>
          </div>
        </div>
      </div>

    </div>
  );
}
