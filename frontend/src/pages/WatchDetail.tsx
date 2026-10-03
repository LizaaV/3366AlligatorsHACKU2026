import { useCallback } from 'react';
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

/* ---------- measurement helpers ---------- */

/** A watch has no measurement until its first real run; show a dash, never a made-up number. */
export const watchValue = (w: Watch) => (w.value === null ? '\u2014' : fmtVal(w.value, w.unit));
export const watchBaseline = (w: Watch) => (w.baseline === null ? '\u2014' : fmtVal(w.baseline, w.unit));
export const watchRange = (w: Watch) => (w.ci ? ciLabel({ ci: w.ci }) : 'Not measured yet');
/** `HistoryChart` needs at least two points to draw a line. */
export const hasSeries = (w: Watch) => w.series.current.length >= 2;

function chartReading(w: Watch) {
  if (!hasSeries(w) || w.value === null) return 'No satellite pass has been measured for this trigger yet.';
  const i = w.series.current.length - 1;
  const v = w.series.current[i], lo = w.series.bandLow[i], hi = w.series.bandHigh[i];
  const base = `${w.baselineLabel}: ${watchBaseline(w)}`;
  if (v > hi) return `${w.metric} is now ${watchValue(w)} \u2014 above anything seen at this time of year in the last 5 years (${base}).`;
  if (v < lo) return `${w.metric} is now ${watchValue(w)} \u2014 below the usual range for this time of year (${base}).`;
  return `${w.metric} is ${watchValue(w)}, inside the normal range for this time of year (${base}).`;
}

/* ---------- proof scenes ---------- */

/* ---------- detail page ---------- */

const LEVEL_COLOR = { info: 'var(--subtle)', warn: 'var(--yellow)', alert: 'var(--red)' } as const;

export function WatchDetail({ id }: { id: string }) {
  const { watches, places, skills, channels, category, go, open, notify, updateWatch, removeWatch, connectors } = useStore();
  const w = watches.find((x) => x.id === id);
  const proof = useResource(useCallback((signal) => api.watches.proof(id, signal), [id]), [id]);
  const dashboards = useResource(useCallback((signal) => api.dashboards.list(signal), []), []);

  if (!w) {
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
          <Btn icon="support_agent" tier="paid" tierLabel="from $49" onClick={() => open({ kind: 'expert', context: w.name, placeId: w.placeId })}>Ask an expert</Btn>
          <Btn icon="refresh" disabled title="Running a trigger on demand is not available yet">Run now · Coming soon</Btn>
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
          <div className="v">{watchValue(w)}</div>
          <div className="ci">{watchRange(w)}</div>
        </div>
        <div>
          <div className="l">Historical reference</div>
          <div className="v">{watchBaseline(w)}</div>
          <div className="ci">{w.baselineLabel || 'Not measured yet'}</div>
        </div>
        <div>
          <div className="l">Change</div>
          <div className="v" style={{ color: w.status === 'ok' ? undefined : STATUS_STYLE[w.status].color }}>{w.hasRun ? w.delta || '\u2014' : 'Waiting for the first pass'}</div>
          <div className="ci">{w.lastRunAt ? `Last checked ${fmtDateTime(w.lastRunAt)}` : 'Not checked yet'}</div>
        </div>
        <div>
          <div className="l">Next update</div>
          <div className="v">{w.nextRunAt ? fmtDay(w.nextRunAt) : 'Not scheduled'}</div>
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
        </div>
        {hasSeries(w) ? (
          <HistoryChart series={w.series.current} band={[w.series.bandLow, w.series.bandHigh]} mean={w.series.mean} color={color} labels={w.series.labels} height={220} />
        ) : (
          <div className="well body-sm" style={{ padding: 20 }}>The chart appears after this trigger&rsquo;s first satellite passes.</div>
        )}
        <div className="body-sm">{chartReading(w)}</div>
      </div>

      {/* two columns */}
      <div className="wd-two">
        <div className="col" style={{ gap: 24 }}>
          <div className="card col" style={{ padding: 24, gap: 16 }}>
            <div className="eyebrow">What happened</div>
            {w.events.length === 0 && <div className="body-sm">Nothing has happened yet.</div>}
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
              <span className="tiny">Most recent run</span>
            </div>
            <div className="body-sm">Every result can be traced to the exact satellite scenes behind it, including the ones the agent threw away.</div>
            {proof.isLoading && <Skeleton h={14} lines={5} />}
            {proof.error && !proof.isLoading && (
              <ErrorState error={proof.error} onRetry={proof.refetch} title="Could not load the scene list" compact />
            )}
            {!proof.isLoading && !proof.error && scenes.length === 0 && <div className="body-sm">No scenes yet \u2014 this trigger has not run.</div>}
            <div className="col" style={{ gap: 0, borderTop: scenes.length ? '1px solid var(--hair-soft)' : undefined }}>
              {scenes.map((s) => (
                <div key={s.id} className="row" style={{ gap: 12, padding: '10px 0', borderBottom: '1px solid var(--hair-soft)', alignItems: 'flex-start' }}>
                  <Ms n={s.used ? 'check_circle' : 'block'} size={18} style={{ color: s.used ? 'var(--green)' : 'var(--subtle)', marginTop: 1 }} />
                  <div className="grow">
                    <div style={{ font: '500 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace', color: s.used ? 'var(--ink)' : 'var(--subtle)', overflowWrap: 'anywhere' }}>{s.id}</div>
                    <div className="tiny">{s.date} · {s.sat} · {Math.round(s.cloud)}% cloud · {s.used ? 'Used' : s.why ?? 'Skipped'}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="tiny" style={{ overflowWrap: 'anywhere' }}>
              {proof.data?.hash ? <>Processing hash <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', color: 'var(--muted)' }}>{proof.data.hash}</span> · </> : null}skill {skill ? `${skill.name} v${skill.version}` : w.skillId}
            </div>
            <div className="row wrap">
              <Btn size="sm" icon="download" disabled title="Not available yet">Download proof pack · Coming soon</Btn>
              <Btn size="sm" icon="verified" disabled title="Not available yet">Notarised proof · Coming soon</Btn>
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
