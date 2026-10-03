import { useState, type ReactNode } from 'react';
import { useStore } from '../state/store';
import { Btn, ConfidenceBadge, Ms, Tier } from '../components/ui';
import type { RouteOptionDto } from '../api/types';
import type { Answer } from '../model';

const ROUTE_STYLE: Record<RouteOptionDto['status'], { label: string; color: string; icon: string; dash?: boolean; dim?: boolean }> = {
  chosen: { label: 'Chosen', color: '#ffffff', icon: 'check_circle' },
  support: { label: 'Supporting', color: 'var(--blue)', icon: 'add_circle' },
  fallback: { label: 'Fallback', color: 'var(--subtle)', icon: 'alt_route', dash: true },
  skipped: { label: 'Not used', color: 'var(--subtle)', icon: 'block', dim: true },
};

function Section({ icon, title, meta, children, defaultOpen = false }: { icon: string; title: string; meta?: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderTop: '1px solid var(--hair)', paddingTop: 10 }}>
      <button onClick={() => setOpen((o) => !o)} className="row" style={{ width: '100%', gap: 8, background: 'transparent', border: 0, padding: '2px 0', textAlign: 'left' }} aria-expanded={open}>
        <Ms n={icon} size={18} className="muted" />
        <span style={{ font: '600 13px/1.38 var(--font)' }}>{title}</span>
        {meta && <span className="tiny">{meta}</span>}
        <Ms n={open ? 'expand_less' : 'expand_more'} size={18} className="muted" style={{ marginLeft: 'auto' }} />
      </button>
      {open && <div style={{ marginTop: 10, animation: 'fadeUp .25s ease both' }}>{children}</div>}
    </div>
  );
}

/** Satellite routing: how the agent picked sources — free first, paid only when needed. */
function Routing({ route }: { route: RouteOptionDto[] }) {
  return (
    <div className="col" style={{ gap: 0 }}>
      <div className="row" style={{ gap: 8 }}>
        <span style={{ width: 22, height: 22, borderRadius: 6, background: 'var(--s3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Ms n="psychology" size={14} /></span>
        <span className="caption muted">Agent compared {route.length} sources</span>
      </div>
      {route.map((r, i) => {
        const st = ROUTE_STYLE[r.status];
        const lastRow = i === route.length - 1;
        return (
          <div key={r.satellite} className="row" style={{ gap: 0, alignItems: 'stretch' }}>
            <svg width="30" height="48" style={{ flex: 'none' }} aria-hidden>
              <line x1="11" y1="0" x2="11" y2={lastRow ? 24 : 48} stroke="var(--hair)" strokeWidth="1.5" />
              <path d="M11 14 Q11 24 21 24 L30 24" fill="none" stroke={st.color} strokeWidth="1.5" strokeDasharray={st.dash ? '3 3' : r.status === 'skipped' ? '1 4' : undefined} style={r.status === 'chosen' ? { strokeDasharray: '6 3', animation: 'dash 1s linear infinite' } : undefined} />
            </svg>
            <div className="row grow" style={{ gap: 10, margin: '6px 0', padding: '6px 10px', borderRadius: 8, background: r.status === 'chosen' ? 'var(--s1)' : 'transparent', border: `1px solid ${r.status === 'chosen' ? 'var(--hair)' : 'var(--hair-soft)'}`, opacity: st.dim ? 0.7 : 1 }}>
              <Ms n={st.icon} size={16} style={{ color: st.color }} />
              <div className="col grow">
                <span style={{ font: '600 13px/1.38 var(--font)', textDecoration: r.status === 'skipped' ? 'line-through' : undefined, textDecorationColor: 'var(--subtle)' }}>{r.satellite}</span>
                <span className="tiny">{r.why}</span>
              </div>
              <span className="tiny" style={{ color: st.color, whiteSpace: 'nowrap' }}>{st.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AnswerCard({ answer: a, question, placeId, onRunSkill }: { answer: Answer; question: string; placeId: string | null; onRunSkill: (id: string) => void }) {
  const { open, notify, go, places, skills, category } = useStore();
  const used = a.proof.filter((p) => p.used).length;
  const place = places.find((p) => p.id === placeId);
  const color = category(a.categoryKey).color;
  return (
    <div className="col" style={{ padding: 18, borderRadius: 12, background: 'var(--s2)', border: '1px solid var(--hair)', gap: 14, animation: 'fadeUp .4s ease both' }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div className="row"><span className="sq" style={{ background: color }} /><span className="eyebrow muted">{a.eyebrow}</span></div>
        <ConfidenceBadge level={a.confidence.level} pct={a.confidence.pct} />
      </div>
      <div style={{ font: '600 22px/1.18 var(--font)', letterSpacing: -0.4, textWrap: 'balance' }}>{a.title}</div>
      <div className="stats" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
        {a.stats.map((s) => (
          <div key={s.label}><div className="l">{s.label}</div><div className="v">{s.value}</div>{s.ci && <div className="ci">{s.ci}</div>}</div>
        ))}
      </div>
      <div>
        <div style={{ font: '600 13px/1.38 var(--font)' }}>{a.findingLabel}</div>
        <div className="body-sm" style={{ marginTop: 2, fontSize: 14, lineHeight: 1.6 }}>{a.finding}</div>
      </div>
      <div>
        <div style={{ font: '600 13px/1.38 var(--font)' }}>{a.actionLabel}</div>
        <div className="body-sm" style={{ marginTop: 2, fontSize: 14, lineHeight: 1.6 }}>{a.action}</div>
      </div>

      {a.kind === 'general' && a.suggestedSkillIds && (
        <div className="col" style={{ gap: 6 }}>
          <div className="eyebrow">Skills that answer this</div>
          {a.suggestedSkillIds.map((id) => {
            const s = skills.find((x) => x.id === id);
            if (!s) return null;
            return (
              <div key={id} className="row" style={{ gap: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--s1)', border: '1px solid var(--hair-soft)' }}>
                <div className="col grow"><span style={{ font: '600 13px/1.38 var(--font)' }}>{s.name}</span><span className="tiny">{s.sat} · by {s.publisherName}</span></div>
                <Btn size="sm" variant="text" onClick={() => go('library', id)}>Open</Btn>
                <Btn size="sm" icon="play_arrow" tier={s.tier} onClick={() => onRunSkill(id)}>Run</Btn>
              </div>
            );
          })}
        </div>
      )}

      {/* honesty: what could be wrong */}
      <Section icon="report" title="Accuracy & known issues" meta={`${a.caveats.length} notes`} defaultOpen={a.kind === 'place'}>
        <div className="caption muted" style={{ marginBottom: 8 }}>{a.confidence.note}</div>
        <ul style={{ margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }} className="body-sm">
          {a.caveats.map((c) => <li key={c} style={{ fontSize: 13 }}>{c}</li>)}
        </ul>
      </Section>

      <Section icon="satellite_alt" title="Satellite routing" meta={a.route.filter((r) => r.status === 'chosen' || r.status === 'support').map((r) => r.satellite.split(' ')[0]).join(' + ')}>
        <Routing route={a.route} />
      </Section>

      {a.proof.length > 0 && (
        <Section icon="verified_user" title="Proof" meta={`${used} scenes used · ${a.proof.length - used} skipped`}>
          <div className="col" style={{ gap: 4, maxHeight: 220, overflowY: 'auto' }}>
            {a.proof.map((p) => (
              <div key={p.sceneId + p.date} className="row" style={{ gap: 8, padding: '6px 8px', borderRadius: 6, background: p.used ? 'var(--s1)' : 'transparent' }}>
                <Ms n={p.used ? 'check' : 'remove'} size={14} style={{ color: p.used ? 'var(--green)' : 'var(--subtle)' }} />
                <span className="tiny ink" style={{ width: 44, flex: 'none' }}>{p.date}</span>
                <span className="tiny grow" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.sceneId}>{p.sceneId}</span>
                <span className="tiny" style={{ whiteSpace: 'nowrap' }}>{p.used ? `${p.cloudPct}% cloud` : p.why}</span>
              </div>
            ))}
          </div>
          <div className="row wrap" style={{ marginTop: 10, gap: 8, justifyContent: 'space-between' }}>
            <span className="tiny">Processing hash <span className="muted" style={{ fontFamily: 'ui-monospace, monospace' }}>{a.hash}</span> · re-runnable</span>
            <Btn size="sm" icon="download" tier="free" onClick={() => notify('Proof pack downloaded · scenes, masks, parameters, hash', undefined, undefined, 'download')}>Proof pack</Btn>
          </div>
        </Section>
      )}

      <div className="row wrap" style={{ gap: 8, borderTop: '1px solid var(--hair)', paddingTop: 14 }}>
        {a.kind === 'place' ? (
          <Btn variant="primary" icon="visibility" tier="free" onClick={() => open({ kind: 'watchBuilder', prefill: watchPrefill(question, a, place?.name), placeId, skillId: a.skillId, fromAnswer: true })}>Keep watching</Btn>
        ) : (
          <Btn variant="primary" icon="pentagon" onClick={() => go('places')}>Pick a place</Btn>
        )}
        <Btn variant="secondary" icon="ios_share" tier="free" onClick={() => open({ kind: 'export', target: { kind: 'answer', title: a.title, subtitle: a.eyebrow } })}>Export</Btn>
        <Btn icon="support_agent" tier="paid" tierLabel="from $49" onClick={() => open({ kind: 'expert', context: a.title, placeId })}>Ask an expert</Btn>
      </div>
      {a.kind === 'place' && (
        <div className="tiny row" style={{ gap: 6 }}>
          <Tier tier="free" /> This run used free satellites only. Paid sources are always marked before you spend.
        </div>
      )}
    </div>
  );
}

const watchPrefill = (q: string, a: Answer, place?: string) =>
  a.skillId === 'dry-patch-finder' ? `Tell me when the dry patch on ${place ?? 'my field'} passes 5 ha` : `Tell me when anything changes: ${q}`;
