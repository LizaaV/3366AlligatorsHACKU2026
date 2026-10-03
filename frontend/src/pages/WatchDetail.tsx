import { useCallback } from 'react';
import { useStore } from '../state/store';
import { api } from '../api';
import { useResource } from '../hooks/useResource';
import type { Watch } from '../model';
import { STATUS_STYLE, hasMeasurement, hasSeries, hasStatus, skillRunnable } from '../data/presentation';
import { ciLabel, fmtDateTime, fmtDay, fmtVal } from '../lib/format';
import { Btn, ConfidenceBadge, Empty, HistoryChart, Ms } from '../components/ui';
import { ErrorState, Skeleton } from '../components/async';

/* ---------- status pill ---------- */

export const StatusPill = ({ status, on = true }: { status: Watch['status'] | null | undefined; on?: boolean }) => {
  if (!on) return <span className="pill" style={{ background: 'var(--s2)' }}><Ms n="pause" size={14} />Paused</span>;
  const st = status ? STATUS_STYLE[status] : undefined;
  if (!st) return <span className="pill" style={{ background: 'var(--s2)', color: 'var(--muted)' }}><Ms n="schedule" size={14} />Not checked yet</span>;
  return (
    <span className="pill" style={{ background: 'var(--s2)', color: status === 'ok' ? 'var(--muted)' : st.color }}>
      <span className="dot" style={{ background: st.color }} />
      {st.label}
    </span>
  );
};

/** One sentence reading the latest point against its normal range. Only called with real data. */
function chartReading(w: Watch) {
  const i = w.series.current.length - 1;
  const v = w.series.current[i];
  const lo = w.series.bandLow?.[i];
  const hi = w.series.bandHigh?.[i];
  const now = hasMeasurement(w) ? fmtVal(w.value, w.unit ?? '') : null;
  if (!now) return null;
  const base = typeof w.baseline === 'number' ? ` (${w.baselineLabel}: ${fmtVal(w.baseline, w.unit ?? '')})` : '';
  if (typeof hi === 'number' && v > hi) return `${w.metric} is now ${now}, above the usual range for this time of year${base}.`;
  if (typeof lo === 'number' && v < lo) return `${w.metric} is now ${now}, below the usual range for this time of year${base}.`;
  return `${w.metric} is ${now}${base}.`;
}

/* ---------- detail page ---------- */

const LEVEL_COLOR = { info: 'var(--subtle)', warn: 'var(--yellow)', alert: 'var(--red)' } as const;

export function WatchDetail({ id }: { id: string }) {
  const { watches, places, skills, category, go, notify, updateWatch, removeWatch } = useStore();
  const w = watches.find((x) => x.id === id);
  // Hooks run before any early return, so the order stays the same when the trigger disappears.
  const proof = useResource(useCallback((signal) => api.watches.proof(id, signal), [id]), [id]);

  if (!w) {
    return (
      <div className="col" style={{ gap: 16 }}>
        <button className="btn btn-text" style={{ alignSelf: 'flex-start' }} onClick={() => go('triggers')}><Ms n="arrow_back" className="ms-flip" />All triggers</button>
        <Empty icon="notifications_off" title="This trigger no longer exists" body="It may have been deleted. Your other triggers are still saved.">
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
  const measured = hasMeasurement(w);
  const events = w.events ?? [];

  // "Run now": nothing re-checks triggers in the background, so the honest version is to take
  // the question to the Ask page for this place, where a real run answers it.
  const runNow = () => {
    const q: Record<string, string> = {};
    if (w.placeId) q.place = w.placeId;
    if (skill && skillRunnable(skill) && w.skillId) q.skill = w.skillId;
    go('ask', undefined, q);
  };

  const del = async () => {
    const name = w.name;
    try {
      await removeWatch(w.id);
      go('triggers');
      notify(`Deleted “${name}”`, undefined, undefined, 'delete');
    } catch {
      notify('Could not delete the trigger', undefined, undefined, 'error');
    }
  };

  return (
    <div className="col" style={{ gap: 28 }}>
      <style>{`
        .wd-two { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 24px; align-items: start; }
        .wd-kpi { grid-template-columns: repeat(3, minmax(0, 1fr)); }
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
          <StatusPill status={hasStatus(w) ? w.status : null} on={w.enabled} />
          {measured && w.confidence && <ConfidenceBadge level={w.confidence} />}
        </div>
        <div className="row wrap">
          <Btn variant="primary" icon="forum" onClick={runNow}>Ask it now</Btn>
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

      {/* KPIs: only real measurements; otherwise say plainly it has not been checked */}
      {measured ? (
        <div className="stats wd-kpi">
          <div>
            <div className="l">{w.metric} · now</div>
            <div className="v">{fmtVal(w.value, w.unit ?? '')}</div>
            <div className="ci">{w.ci ? ciLabel(w) : ' '}</div>
          </div>
          <div>
            <div className="l">Historical reference</div>
            <div className="v">{typeof w.baseline === 'number' ? fmtVal(w.baseline, w.unit ?? '') : '—'}</div>
            <div className="ci">{w.baselineLabel || ' '}</div>
          </div>
          <div>
            <div className="l">Change</div>
            <div className="v" style={{ color: hasStatus(w) && w.status !== 'ok' ? STATUS_STYLE[w.status].color : undefined }}>{w.delta || '—'}</div>
            <div className="ci">Last checked {fmtDateTime(w.lastRunAt)}</div>
          </div>
        </div>
      ) : (
        <div className="card row" style={{ padding: 20, gap: 14, alignItems: 'flex-start' }}>
          <Ms n="schedule" size={22} className="muted" />
          <div className="col" style={{ gap: 4 }}>
            <div className="subhead" style={{ fontSize: 17 }}>Not checked yet</div>
            <div className="body-sm">
              Automatic re-checks are not running yet, so there is no measurement for this trigger. Use “Ask it now” to run the question on the latest imagery.
            </div>
          </div>
        </div>
      )}

      {hasSeries(w) && (
        <div className="card col" style={{ padding: 24, gap: 14 }}>
          <div>
            <div className="eyebrow">Historical reference</div>
            <div className="card-title" style={{ marginTop: 6 }}>This season against the usual range</div>
          </div>
          <HistoryChart
            series={w.series.current}
            band={w.series.bandLow?.length ? [w.series.bandLow, w.series.bandHigh] : undefined}
            mean={w.series.mean?.length ? w.series.mean : undefined}
            color={color}
            labels={w.series.labels?.length ? w.series.labels : undefined}
            height={220}
          />
          {chartReading(w) && <div className="body-sm">{chartReading(w)}</div>}
        </div>
      )}

      {/* two columns */}
      <div className="wd-two">
        <div className="col" style={{ gap: 24 }}>
          {events.length > 0 && (
            <div className="card col" style={{ padding: 24, gap: 16 }}>
              <div className="eyebrow">What happened</div>
              <div className="col" style={{ gap: 0 }}>
                {events.map((e, i) => (
                  <div key={i} className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
                    <div className="col" style={{ alignItems: 'center', alignSelf: 'stretch' }}>
                      <span className="dot" style={{ width: 10, height: 10, marginTop: 5, background: LEVEL_COLOR[e.level] ?? 'var(--subtle)' }} />
                      {i < events.length - 1 && <span style={{ flex: 1, width: 1, background: 'var(--hair-soft)', marginTop: 6 }} />}
                    </div>
                    <div style={{ paddingBottom: 18, minWidth: 0 }}>
                      <div className="tiny">{fmtDay(e.at, '—')}{e.level !== 'info' && <span style={{ color: LEVEL_COLOR[e.level], marginLeft: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>{e.level === 'warn' ? 'Warning' : 'Alert'}</span>}</div>
                      <div className="body-sm ink" style={{ marginTop: 2 }}>{e.text}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* proof: only meaningful once a check has run */}
          {(measured || scenes.length > 0) && (
            <div className="card col" style={{ padding: 24, gap: 14 }}>
              <div className="eyebrow">Proof</div>
              <div className="body-sm">The satellite scenes behind the latest check, including the ones the agent threw away.</div>
              {proof.isLoading && <Skeleton h={14} lines={5} />}
              {proof.error && !proof.isLoading && (
                <ErrorState error={proof.error} onRetry={proof.refetch} title="Could not load the scene list" compact />
              )}
              {!proof.isLoading && !proof.error && scenes.length === 0 && <div className="tiny">No scenes recorded yet.</div>}
              <div className="col" style={{ gap: 0, borderTop: scenes.length ? '1px solid var(--hair-soft)' : undefined }}>
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
              {proof.data?.hash && (
                <div className="tiny" style={{ overflowWrap: 'anywhere' }}>
                  Processing hash <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', color: 'var(--muted)' }}>{proof.data.hash}</span>
                </div>
              )}
            </div>
          )}

          {/* rule */}
          <div className="card col" style={{ padding: 24, gap: 16 }}>
            <div className="eyebrow">Rule</div>
            <div className="subhead" style={{ fontSize: 18 }}>“{w.question}”</div>
            <div className="stats" style={{ gridTemplateColumns: '1fr' }}>
              {w.condition && <div><div className="l">Tell me when</div><div className="v" style={{ fontSize: 15 }}>{w.condition}</div></div>}
              {w.satellites && <div><div className="l">Satellite</div><div className="v" style={{ fontSize: 15 }}>{w.satellites}</div></div>}
              {w.skillId && (
                <div>
                  <div className="l">Skill</div>
                  <button className="btn-text" style={{ border: 0, background: 'none', padding: 0, marginTop: 2, color: 'var(--blue)', font: '600 15px/1.35 var(--font)' }} onClick={() => go('library', w.skillId)}>
                    {skill?.name ?? w.skillId} <Ms n="arrow_forward" size={14} className="ms-flip" />
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col" style={{ gap: 24 }}>
          {/* limits */}
          <div className="card col" style={{ padding: 24, gap: 12 }}>
            <div className="eyebrow">Accuracy &amp; limits</div>
            <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              <Ms n="fact_check" size={18} className="muted" />
              <div className="body-sm ink">{skill?.accuracy || 'Accuracy not yet measured for this skill.'}</div>
            </div>
            <ul className="body-sm" style={{ margin: 0, paddingLeft: 20, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {(skill?.limits?.length ? skill.limits : ['Optical satellites cannot see through cloud; cloudy passes are skipped.']).map((l) => <li key={l}>{l}</li>)}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
