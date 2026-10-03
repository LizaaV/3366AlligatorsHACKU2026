import { useState, type ReactNode } from 'react';
import { useStore } from '../state/store';
import { api } from '../api';
import { Btn, ConfidenceBadge, Ms } from '../components/ui';
import type { Answer } from '../model';
import { cloudFromPercent } from '../lib/format';
import { ArtifactRefs, LinkedText } from '../components/artifacts/ArtifactRefs';

/** The contract's `RouteOption` (`contracts/openapi.json`): `sat`, not `satellite`. */
type RouteOption = Answer['route'][number];

const ROUTE_STYLE: Record<RouteOption['status'], { label: string; color: string; icon: string; dash?: boolean; dim?: boolean }> = {
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
function Routing({ route }: { route: RouteOption[] }) {
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
          <div key={r.sat} className="row" style={{ gap: 0, alignItems: 'stretch' }}>
            <svg width="30" height="48" style={{ flex: 'none' }} aria-hidden>
              <line x1="11" y1="0" x2="11" y2={lastRow ? 24 : 48} stroke="var(--hair)" strokeWidth="1.5" />
              <path d="M11 14 Q11 24 21 24 L30 24" fill="none" stroke={st.color} strokeWidth="1.5" strokeDasharray={st.dash ? '3 3' : r.status === 'skipped' ? '1 4' : undefined} style={r.status === 'chosen' ? { strokeDasharray: '6 3', animation: 'dash 1s linear infinite' } : undefined} />
            </svg>
            <div className="row grow" style={{ gap: 10, margin: '6px 0', padding: '6px 10px', borderRadius: 8, background: r.status === 'chosen' ? 'var(--s1)' : 'transparent', border: `1px solid ${r.status === 'chosen' ? 'var(--hair)' : 'var(--hair-soft)'}`, opacity: st.dim ? 0.7 : 1 }}>
              <Ms n={st.icon} size={16} style={{ color: st.color }} />
              <div className="col grow">
                <span style={{ font: '600 13px/1.38 var(--font)', textDecoration: r.status === 'skipped' ? 'line-through' : undefined, textDecorationColor: 'var(--subtle)' }}>{r.sat}</span>
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

export function AnswerCard({ answer: a, turnId, question, placeId, runId, onRunSkill, onAskFollowup }: { answer: Answer; turnId: string; question: string; placeId: string | null; runId?: string | null; onRunSkill: (id: string) => void; onAskFollowup?: (q: string) => void }) {
  const { open, go, places, skills } = useStore();
  const used = a.proof.filter((p) => p.used).length;
  const place = places.find((p) => p.id === placeId);
  // The backend sends the accent colour; it has no notion of our category list.
  const color = a.color ?? 'var(--subtle)';
  return (
    <div className="col" style={{ padding: 18, borderRadius: 12, background: 'var(--s2)', border: '1px solid var(--hair)', gap: 14, animation: 'fadeUp .4s ease both' }}>
      <div className="row" style={{ justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div className="row">
          <span className="sq" style={{ background: color }} />
          <span className="eyebrow muted">{a.eyebrow}</span>
          {/* The stub run and any cached preset answer are marked, so a demo is never mistaken for a measurement. */}
          {a.preset && <span className="tiny" style={{ padding: '1px 6px', borderRadius: 4, background: 'var(--s3)', color: 'var(--subtle)' }}>demo data</span>}
        </div>
        <ConfidenceBadge level={a.confidence.level} pct={a.confidence.pct} />
      </div>
      <div style={{ font: '600 22px/1.18 var(--font)', letterSpacing: -0.4, textWrap: 'balance' }}>{a.title}</div>
      {a.sentence && (
        <div className="body-sm" style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink-dim, inherit)' }}><LinkedText text={a.sentence} turnId={turnId} /></div>
      )}
      <ArtifactRefs turnId={turnId} />
      {a.stats.length > 0 && (
        <div className="stats" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
          {a.stats.map((s) => (
            <div key={s.label}><div className="l">{s.label}</div><div className="v">{s.value}</div>{s.ci && <div className="ci">{s.ci}</div>}</div>
          ))}
        </div>
      )}
      <div>
        <div style={{ font: '600 13px/1.38 var(--font)' }}>{a.findingLabel}</div>
        {/* A measure-only answer has a measurement but no matching knowledge card, so there is
            genuinely no cause to state. Saying so is better than implying one. */}
        <div className="body-sm" style={{ marginTop: 2, fontSize: 14, lineHeight: 1.6, color: a.finding ? undefined : 'var(--subtle)' }}>
          {a.finding ?? 'Cause unknown — this is a measurement only, with no matching knowledge card.'}
        </div>
      </div>
      {a.action && (
        <div>
          <div style={{ font: '600 13px/1.38 var(--font)' }}>{a.actionLabel}</div>
          <div className="body-sm" style={{ marginTop: 2, fontSize: 14, lineHeight: 1.6 }}>{a.action}</div>
        </div>
      )}

      {a.followups.length > 0 && onAskFollowup && (
        <div className="col" style={{ gap: 6 }}>
          <div className="eyebrow">Ask next</div>
          <div className="row wrap" style={{ gap: 6 }}>
            {a.followups.map((q) => (
              <button key={q} className="chip" onClick={() => onAskFollowup(q)} style={{ textAlign: 'left' }}>{q}</button>
            ))}
          </div>
        </div>
      )}

      {a.kind === 'general' && a.suggested.length > 0 && (
        <div className="col" style={{ gap: 6 }}>
          <div className="eyebrow">Skills that answer this</div>
          {a.suggested.map((id: string) => {
            const s = skills.find((x) => x.id === id);
            if (!s) return null;
            return (
              <div key={id} className="row" style={{ gap: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--s1)', border: '1px solid var(--hair-soft)' }}>
                <div className="col grow"><span style={{ font: '600 13px/1.38 var(--font)' }}>{s.name}</span><span className="tiny">{s.sat} · by {s.publisherName}</span></div>
                <Btn size="sm" variant="text" onClick={() => go('library', id)}>Open</Btn>
                <Btn size="sm" icon="play_arrow" onClick={() => onRunSkill(id)}>Run</Btn>
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

      {/* The written rules behind the answer. These card ids were rendered nowhere until now,
          which made "method" a word rather than something you could check. */}
      {a.method && (a.method.cards?.length || a.method.skill || a.method.code_ref) && (
        <Section
          icon="menu_book"
          title="Method"
          meta={a.method.cards?.length ? `${a.method.cards.length} knowledge card${a.method.cards.length === 1 ? '' : 's'}` : undefined}
        >
          <div className="col" style={{ gap: 6 }}>
            {(a.method.cards ?? []).map((c) => (
              <button
                key={c.id}
                className="menu-item"
                onClick={() => open({ kind: 'knowledgeCard', cardId: c.id })}
                title={`Open the ${c.id} card`}
              >
                <Ms n="article" />
                <span className="grow">
                  {c.id}
                  <span className="caption" style={{ display: 'block' }}>v{c.version} · {c.status}</span>
                </span>
                <Ms n="chevron_right" className="muted" />
              </button>
            ))}
            {a.method.skill && (
              <span className="tiny muted">Skill: {a.method.skill.id} v{a.method.skill.version}</span>
            )}
            {a.method.code_ref && (
              <span className="tiny muted" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                {a.method.code_ref}
              </span>
            )}
            {/* A draft card has not been tested on known cases — which is why the backend caps
                confidence at Low while any of them are drafts. Saying so here joins the two up. */}
            {(a.method.cards ?? []).some((c) => c.status === 'draft') && (
              <span className="caption" style={{ color: 'var(--amber)' }}>
                Some of these cards are drafts, not yet tested on known cases. That is why the confidence above is capped.
              </span>
            )}
          </div>
        </Section>
      )}

      <Section icon="satellite_alt" title="Satellite routing" meta={a.route.filter((r) => r.status === 'chosen' || r.status === 'support').map((r) => r.sat.split(' ')[0]).join(' + ')}>
        <Routing route={a.route} />
      </Section>

      {a.proof.length > 0 && (
        <Section icon="verified_user" title="Proof" meta={`${used} scenes used · ${a.proof.length - used} skipped`}>
          <div className="col" style={{ gap: 4, maxHeight: 220, overflowY: 'auto' }}>
            {a.proof.map((p) => (
              <div key={p.id + p.date} className="row" style={{ gap: 8, padding: '6px 8px', borderRadius: 6, background: p.used ? 'var(--s1)' : 'transparent' }}>
                <Ms n={p.used ? 'check' : 'remove'} size={14} style={{ color: p.used ? 'var(--green)' : 'var(--subtle)' }} />
                <span className="tiny ink" style={{ width: 44, flex: 'none' }}>{p.date}</span>
                <span className="tiny grow" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.id}>{p.id}</span>
                <span className="tiny" style={{ whiteSpace: 'nowrap' }}>{p.used ? `${cloudFromPercent(p.cloud)} cloud` : p.why}</span>
              </div>
            ))}
          </div>
          <div className="row wrap" style={{ marginTop: 10, gap: 8, justifyContent: 'space-between' }}>
            <span className="tiny">Processing hash <span className="muted" style={{ fontFamily: 'ui-monospace, monospace' }}>{a.hash}</span> · re-runnable</span>
            {runId && <a className="btn btn-secondary btn-sm" href={api.shares.reportPdfUrl(runId)} download><Ms n="download" />Proof pack (PDF)</a>}
          </div>
        </Section>
      )}

      <div className="row wrap" style={{ gap: 8, borderTop: '1px solid var(--hair)', paddingTop: 14 }}>
        {a.kind === 'place' ? (
          <Btn variant="primary" icon="visibility" onClick={() => open({ kind: 'watchBuilder', prefill: watchPrefill(question, a, place?.name), placeId, skillId: a.skillId ?? undefined, fromAnswer: true })}>Keep watching</Btn>
        ) : (
          <Btn variant="primary" icon="pentagon" onClick={() => go('places')}>Pick a place</Btn>
        )}
        <Btn variant="secondary" icon="ios_share" onClick={() => open({ kind: 'export', target: { kind: 'answer', title: a.title, subtitle: a.eyebrow, id: runId ?? undefined } })}>Export</Btn>
        <Btn icon="support_agent" onClick={() => open({ kind: 'expert', context: a.title, placeId })}>Ask an expert</Btn>
      </div>
    </div>
  );
}

const watchPrefill = (q: string, a: Answer, place?: string) =>
  a.skillId === 'dry-patch-finder' ? `Tell me when the dry patch on ${place ?? 'my field'} passes 5 ha` : `Tell me when anything changes: ${q}`;
