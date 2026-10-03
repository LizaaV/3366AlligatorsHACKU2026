import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { CHANNELS, type Channel, type Watch } from '../data/watches';
import { CATS, skillById } from '../data/catalog';
import { Btn, Check, ConfidenceBadge, Empty, HistoryChart, Ms, Tier } from '../components/ui';

/* ---------- shared helpers (also used by WatchesPage) ---------- */

export const fmtNum = (v: number) => {
  const s = Number.isInteger(v) ? String(v) : String(+v.toFixed(2));
  return s.replace('-', '−');
};
export const fmtVal = (v: number, unit: string) => `${fmtNum(v)}${unit ? (unit.startsWith('%') || unit.startsWith('°') ? '' : ' ') + unit : ''}`;
export const ciLabel = (w: Watch) =>
  w.ci[0] === w.ci[1] ? 'Exact count' : `90% range ${fmtNum(w.ci[0])}–${fmtNum(w.ci[1])}`;

export const STATUS = {
  ok: { label: 'Normal', color: 'var(--green)' },
  warn: { label: 'Needs attention', color: 'var(--yellow)' },
  alert: { label: 'Alert', color: 'var(--red)' },
} as const;

export const StatusPill = ({ status, on = true }: { status: Watch['status']; on?: boolean }) =>
  !on ? (
    <span className="pill" style={{ background: 'var(--s2)' }}><Ms n="pause" size={14} />Paused</span>
  ) : (
    <span className="pill" style={{ background: 'var(--s2)', color: status === 'ok' ? 'var(--muted)' : STATUS[status].color }}>
      <span className="dot" style={{ background: STATUS[status].color }} />
      {STATUS[status].label}
    </span>
  );

/** Rank a free-text "next run" so the soonest one can be picked. */
export const nextRank = (s: string) => {
  if (/paused/i.test(s)) return 1e9;
  if (/today/i.test(s)) return 0;
  if (/tomorrow/i.test(s)) return 1;
  const m = s.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d+)/);
  if (!m) return 5e8;
  const mi = 'JanFebMarAprMayJunJulAugSepOctNovDec'.indexOf(m[1]) / 3;
  return 2 + mi * 31 + +m[2];
};

/* ---------- "Ask" bar — port of the prototype's "Ask this dashboard" ---------- */

export interface AskAnswer { steps: string[]; title: string; body: string; }

export function AskBar({ placeholder, suggestions, thinkLabel, answer, onExport, onExpert }: {
  placeholder: string;
  suggestions: string[];
  thinkLabel: string;
  answer: (q: string) => AskAnswer;
  onExport: (a: AskAnswer) => void;
  onExpert: (a: AskAnswer) => void;
}) {
  const [q, setQ] = useState('');
  const [thinking, setThinking] = useState(false);
  const [ans, setAns] = useState<AskAnswer | null>(null);
  const tm = useRef<number>();
  useEffect(() => () => window.clearTimeout(tm.current), []);

  const ask = (text?: string) => {
    const query = (text ?? q).trim() || suggestions[0];
    setThinking(true);
    setAns(null);
    window.clearTimeout(tm.current);
    tm.current = window.setTimeout(() => {
      setThinking(false);
      setQ('');
      setAns(answer(query));
    }, 1800);
  };

  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="row" style={{ gap: 12, padding: '8px 8px 8px 16px', background: 'var(--s1)', border: '1px solid var(--hair)', borderRadius: 'var(--r-lg)' }}>
        <Ms n="forum" size={20} className="muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
          placeholder={placeholder}
          aria-label={placeholder}
          style={{ flex: 1, minWidth: 0, height: 40, background: 'transparent', border: 0, outline: 0, color: '#fff', font: '500 16px/1.5 var(--font)' }}
        />
        <Btn variant="primary" onClick={() => ask()} disabled={thinking}>Ask</Btn>
      </div>
      <div className="row wrap">
        {suggestions.map((s) => (
          <button key={s} className="chip" onClick={() => { setQ(s); ask(s); }}>{s}</button>
        ))}
      </div>
      {thinking && (
        <div className="card row" style={{ padding: '20px 24px', gap: 10 }}>
          <span className="spinner" />
          <span className="shimmer-text" style={{ font: '600 14px/1.4 var(--font)' }}>{thinkLabel}</span>
        </div>
      )}
      {ans && !thinking && (
        <div className="card fade-up col" style={{ padding: 24, gap: 12 }}>
          <div className="row wrap">
            {ans.steps.map((s) => <span key={s} className="tag"><Ms n="check" />{s}</span>)}
          </div>
          <div className="subhead">{ans.title}</div>
          <div className="body" style={{ maxWidth: 860 }}>{ans.body}</div>
          <div className="row wrap" style={{ marginTop: 4 }}>
            <Btn size="sm" icon="ios_share" tier="free" onClick={() => onExport(ans)}>Export</Btn>
            <Btn size="sm" variant="text" icon="support_agent" tier="paid" tierLabel="from $49" onClick={() => onExpert(ans)}>Ask an expert</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- chart range helpers ---------- */

type Range = 'season' | 'year' | 'five';
const wobble = (i: number, amp: number) => Math.sin(i * 1.7) * amp + Math.cos(i * 0.9) * amp * 0.5;
const clamp = (v: number) => Math.max(0, Math.min(1.05, v));

function chartData(w: Watch, r: Range) {
  if (r === 'season') return { series: w.history, band: w.band, mean: w.histMean, labels: w.labels };
  if (r === 'year') {
    const prev = w.histMean.map((v, i) => clamp(v * 0.96 + wobble(i, 0.02)));
    return {
      series: [...prev, ...w.history],
      band: [[...w.band[0], ...w.band[0]], [...w.band[1], ...w.band[1]]] as [number[], number[]],
      mean: [...w.histMean, ...w.histMean],
      labels: ['Oct ’25', 'Jan', 'Apr', 'Jul', 'Oct'],
    };
  }
  const years = [0.94, 1.04, 0.9, 1.08];
  const past = years.flatMap((k, y) => w.histMean.map((v, i) => clamp(v * k + wobble(i + y * 12, 0.025))));
  return {
    series: [...past, ...w.history],
    band: [[0, 1, 2, 3, 4].flatMap(() => w.band[0]), [0, 1, 2, 3, 4].flatMap(() => w.band[1])] as [number[], number[]],
    mean: [0, 1, 2, 3, 4].flatMap(() => w.histMean),
    labels: ['2022', '2023', '2024', '2025', '2026'],
  };
}

function chartReading(w: Watch) {
  const i = w.history.length - 1;
  const v = w.history[i], lo = w.band[0][i], hi = w.band[1][i];
  const base = `${w.baselineLabel}: ${fmtVal(w.baseline, w.unit)}`;
  if (v > hi) return `${w.metric} is now ${fmtVal(w.value, w.unit)} — above anything seen at this time of year in the last 5 years (${base}).`;
  if (v < lo) return `${w.metric} is now ${fmtVal(w.value, w.unit)} — below the usual range for this time of year (${base}).`;
  return `${w.metric} is ${fmtVal(w.value, w.unit)}, inside the normal range for this time of year (${base}).`;
}

/* ---------- proof scenes ---------- */

const MON: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const PROOF_DATES = ['Sep 28', 'Sep 23', 'Sep 18', 'Sep 13', 'Sep 8'];

function sceneId(sat: string, date: string, i: number) {
  const [m, d] = date.split(' ');
  const md = MON[m] + d.padStart(2, '0');
  if (/landsat/i.test(sat)) return `LC09_L2SP_031034_2026${md}_02_T1`;
  if (/sentinel-1/i.test(sat)) return `S1${i % 2 ? 'A' : 'C'}_IW_GRDH_1SDV_2026${md}T092114_0${54210 + i}_06A2F1`;
  if (/sentinel-3/i.test(sat)) return `S3${i % 2 ? 'A' : 'B'}_OL_2_WFR____2026${md}T160512_0180_LN1_O_NT_003`;
  if (/viirs|firms/i.test(sat)) return `VNP14IMG.A2026${(240 + 28 - i * 5).toString().padStart(3, '0')}.0954.002`;
  if (/swot/i.test(sat)) return `SWOT_L2_HR_Raster_100m_2026${md}T0812_PIC0_01`;
  return `S2${i % 2 ? 'A' : 'B'}_MSIL2A_2026${md}T172909_N0511_R055_T14SKG`;
}

function proofScenes(w: Watch) {
  const sat = w.sat.split(' · ')[0];
  const optical = !/sentinel-1|viirs|firms|swot/i.test(sat);
  return PROOF_DATES.map((date, i) => {
    let why: string | undefined;
    if (optical && i === 2) why = 'Skipped — 64% cloud over the area';
    if (optical && i === 3) why = 'Skipped — 18 mm rain the day before';
    return { id: sceneId(sat, date, i), date, sat, used: !why, why };
  });
}

const hashOf = (s: string) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  const hex = (n: number) => n.toString(16).padStart(8, '0');
  return `sha256:${hex(h)}${hex(Math.imul(h, 2654435761) >>> 0)}…${hex(h ^ 0x9e3779b9).slice(0, 6)}`;
};

/* ---------- detail page ---------- */

const LEVEL_COLOR = { info: 'var(--subtle)', warn: 'var(--yellow)', alert: 'var(--red)' } as const;

export function WatchDetail({ id }: { id: string }) {
  const { watches, places, go, open, notify, updateWatch, removeWatch, addWatch, connectors, plan } = useStore();
  const w = watches.find((x) => x.id === id);
  const [range, setRange] = useState<Range>('season');
  const data = useMemo(() => (w ? chartData(w, range) : null), [w, range]);

  if (!w || !data) {
    return (
      <div className="col" style={{ gap: 16 }}>
        <button className="btn btn-text" style={{ alignSelf: 'flex-start' }} onClick={() => go('watches')}><Ms n="arrow_back" className="ms-flip" />All watches</button>
        <Empty icon="visibility_off" title="This watch no longer exists" body="It may have been deleted. Your other watches are still running.">
          <Btn variant="primary" onClick={() => go('watches')}>See all watches</Btn>
        </Empty>
      </div>
    );
  }

  const cat = CATS[w.cat];
  const place = places.find((p) => p.id === w.placeId);
  const skill = skillById(w.skillId);
  const scenes = proofScenes(w);
  const color = cat.color;

  const toggleChannel = (c: (typeof CHANNELS)[number]) => {
    const has = w.channels.includes(c.id);
    if (!has && c.tier === 'paid' && plan === 'free') {
      open({ kind: 'upgrade', feature: `${c.name} alerts`, price: c.note });
      return;
    }
    const next: Channel[] = has ? w.channels.filter((x) => x !== c.id) : [...w.channels, c.id];
    updateWatch(w.id, { channels: next });
  };

  const del = () => {
    const copy = w;
    removeWatch(w.id);
    go('watches');
    notify(`Deleted “${copy.name}”`, 'Undo', () => addWatch(copy), 'delete');
  };

  const scopedAnswer = (q: string): AskAnswer => ({
    steps: [`Read ${w.history.length} passes`, 'Compared last 3 passes', 'Checked 5-year baseline'],
    title: w.status === 'ok' ? `${w.name.split(' · ')[0]} looks normal` : `${w.name.split(' · ')[0]} needs a look before ${w.nextRun}`,
    body: `You asked: “${q}” ${w.metric} is ${fmtVal(w.value, w.unit)} (${ciLabel(w)}) vs ${fmtVal(w.baseline, w.unit)} for the ${w.baselineLabel.toLowerCase()}. ${w.delta}. ${w.events[0] ? 'Latest: ' + w.events[0].text + ' ' : ''}Your rule is “${w.condition}”${w.status === 'ok' ? ' and it is not close to firing.' : '; at the current rate it may fire on the next pass.'} Confidence is ${w.confidence.toLowerCase()} — ${skill?.limits[1] ?? 'cloudy passes are skipped.'}`,
  });

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
        <button className="btn btn-text btn-sm" style={{ alignSelf: 'flex-start', marginLeft: -12 }} onClick={() => go('watches')}>
          <Ms n="arrow_back" className="ms-flip" />All watches
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
          <StatusPill status={w.status} on={w.on} />
          <ConfidenceBadge level={w.confidence} />
        </div>
        <div className="row wrap">
          <Btn icon="ios_share" tier="free" onClick={() => open({ kind: 'export', target: { kind: 'watch', title: w.name, subtitle: place?.name } })}>Export</Btn>
          <Btn icon="support_agent" tier="paid" tierLabel="from $49" onClick={() => open({ kind: 'expert', context: w.name, placeId: w.placeId })}>Ask an expert</Btn>
          <Btn icon="refresh" tier="free" onClick={() => notify(`Re-checking with the latest ${w.sat.split(' · ')[0]} pass…`, undefined, undefined, 'satellite_alt')}>Run now</Btn>
          <Btn
            icon={w.on ? 'pause' : 'play_arrow'}
            onClick={() => {
              updateWatch(w.id, { on: !w.on, nextRun: w.on ? 'Paused' : 'Next pass' });
              notify(w.on ? 'Watch paused' : 'Watch resumed');
            }}
          >
            {w.on ? 'Pause' : 'Resume'}
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
          <div className="v" style={{ color: w.status === 'ok' ? undefined : STATUS[w.status].color }}>{w.delta}</div>
          <div className="ci">Last checked {w.lastRun}</div>
        </div>
        <div>
          <div className="l">Next update</div>
          <div className="v">{w.nextRun}</div>
          <div className="ci">{w.sat}</div>
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
                    <div className="tiny">{e.date}{e.level !== 'info' && <span style={{ color: LEVEL_COLOR[e.level], marginLeft: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>{e.level === 'warn' ? 'Warning' : 'Alert'}</span>}</div>
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
            <div className="col" style={{ gap: 0, borderTop: '1px solid var(--hair-soft)' }}>
              {scenes.map((s) => (
                <div key={s.id} className="row" style={{ gap: 12, padding: '10px 0', borderBottom: '1px solid var(--hair-soft)', alignItems: 'flex-start' }}>
                  <Ms n={s.used ? 'check_circle' : 'block'} size={18} style={{ color: s.used ? 'var(--green)' : 'var(--subtle)', marginTop: 1 }} />
                  <div className="grow">
                    <div style={{ font: '500 12px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace', color: s.used ? 'var(--ink)' : 'var(--subtle)', overflowWrap: 'anywhere' }}>{s.id}</div>
                    <div className="tiny">{s.date} · {s.sat} · {s.used ? 'Used' : s.why}</div>
                  </div>
                </div>
              ))}
            </div>
            <div className="tiny" style={{ overflowWrap: 'anywhere' }}>
              Processing hash <span style={{ fontFamily: 'ui-monospace, Menlo, monospace', color: 'var(--muted)' }}>{hashOf(w.id + w.lastRun)}</span> · skill {skill ? `${skill.name} v${skill.version}` : w.skillId}
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
              <div><div className="l">Satellite</div><div className="v" style={{ fontSize: 15 }}>{w.sat}</div></div>
              <div>
                <div className="l">Skill</div>
                <button className="btn-text" style={{ border: 0, background: 'none', padding: 0, marginTop: 2, color: 'var(--blue)', font: '600 15px/1.35 var(--font)' }} onClick={() => go('library', w.skillId)}>
                  {skill?.name ?? w.skillId} <Ms n="arrow_forward" size={14} className="ms-flip" />
                </button>
              </div>
            </div>
            <div className="col" style={{ gap: 4 }}>
              <div className="l caption" style={{ marginBottom: 6 }}>Deliver to</div>
              {CHANNELS.map((c) => {
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

      {/* ask this watch */}
      <div className="col" style={{ gap: 12 }}>
        <div className="eyebrow">Ask this watch</div>
        <AskBar
          placeholder={`Ask about ${w.name.split(' · ')[0].toLowerCase()} — what changed and what it means…`}
          suggestions={['What changed since the last pass?', 'Is this normal for the time of year?', 'When will it cross my threshold?']}
          thinkLabel={`Reading ${w.history.length} passes and comparing with the 5-year range…`}
          answer={scopedAnswer}
          onExport={(a) => open({ kind: 'export', target: { kind: 'answer', title: a.title, subtitle: w.name } })}
          onExpert={() => open({ kind: 'expert', context: w.name, placeId: w.placeId })}
        />
      </div>
    </div>
  );
}
