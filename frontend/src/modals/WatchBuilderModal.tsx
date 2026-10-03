import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { ApiError, api, toApiError } from '../api';
import type { ChannelId, Feasibility } from '../model';
import { LANGS } from '../data/i18n';
import { Btn, Check, Modal, ModalHead, Ms, Tier } from '../components/ui';
import { ErrorState } from '../components/async';

const EXAMPLES = [
  'Tell me when the dry patch on North Pivot passes 5 ha',
  'Alert me if a fire starts within 10 km of my farm',
  'Warn me if forest is cleared on plot 14',
  'Count the cars in my parking lot',
];

const CHECK_STEPS = ['Reading your request', 'Matching a skill', 'Checking satellite coverage & revisit', 'Estimating accuracy'];

type Stage = 'ask' | 'check' | 'deliver';

export function WatchBuilderModal({ prefill, placeId, skillId, fromAnswer }: { prefill?: string; placeId?: string | null; skillId?: string; fromAnswer?: boolean }) {
  const { places, skills, channels: catalogChannels, category, close, addWatch, notify, go, connectors, setConnectors, lang, open } = useStore();
  const presetSkill = skillId ? skills.find((x) => x.id === skillId) : undefined;
  const autoText = presetSkill ? `Tell me when ${presetSkill.name.toLowerCase()} finds something new` : '';

  const [stage, setStage] = useState<Stage>('ask');
  const [text, setText] = useState(prefill ?? autoText);
  const [place, setPlace] = useState<string>(placeId === undefined ? (places[0]?.id ?? '') : placeId ?? '');
  const [checking, setChecking] = useState(0); // steps done; CHECK_STEPS.length = finished
  const [feas, setFeas] = useState<Feasibility | null>(null);
  const [option, setOption] = useState<'free' | 'paid'>('free');
  const [condition, setCondition] = useState('');
  const [channels, setChannels] = useState<ChannelId[]>(['email']);
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
  const [waNumber, setWaNumber] = useState('');
  const [alertLang, setAlertLang] = useState(lang);
  const timers = useRef<number[]>([]);

  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), []);

  const placeObj = places.find((p) => p.id === place);

  const runCheck = async (q: string) => {
    const query = q.trim();
    if (!query) return;
    setText(query);
    setStage('check');
    setFeas(null);
    setError(null);
    setChecking(0);
    // Local choreography while the request is in flight — the check labels are presentation.
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = CHECK_STEPS.map((_, i) => window.setTimeout(() => setChecking(i + 1), (i + 1) * 350));

    try {
      let f = await api.watches.checkFeasibility({ text: query, placeId: place || null });
      // A watch started from a skill page keeps that skill when the text gives no better match.
      if (presetSkill && f.ok && f.skillId === 'dry-patch-finder' && presetSkill.id !== f.skillId) {
        f = {
          ...f,
          title: presetSkill.name,
          skillId: presetSkill.id,
          categoryKey: presetSkill.categoryKey,
          satellites: presetSkill.sat,
          tier: presetSkill.tier,
          cost: presetSkill.cost,
          metric: presetSkill.name,
          condition: 'Any significant change vs the 5-year range',
        };
      }
      // Use the threshold the person typed, if there is one.
      const num = query.match(/(\d+(?:\.\d+)?)\s*(ha|km|%|\u00b0C|\u00b5g\/L)/i);
      setCondition(num && f.ok ? `${f.metric} above ${num[1]} ${num[2]}` : f.condition);
      setOption(f.partial ? 'free' : f.tier);
      setFeas(f);
    } catch (err) {
      setError(toApiError(err));
    } finally {
      timers.current.forEach((t) => window.clearTimeout(t));
      setChecking(CHECK_STEPS.length);
    }
  };

  const effTier: 'free' | 'paid' =
    (feas?.partial ? option : feas?.tier) === 'paid' || channels.some((c) => catalogChannels.find((x) => x.id === c)?.tier === 'paid') ? 'paid' : 'free';

  const toggle = (c: ChannelId) => setChannels((s) => (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]));

  const create = async () => {
    if (!feas || saving) return;
    setSaving(true);
    setError(null);
    const lowFree = feas.partial && option === 'free';
    try {
      const created = await addWatch({
        name: `${feas.title} \u00b7 ${placeObj?.name ?? 'all my places'}`,
        categoryKey: feas.categoryKey,
        placeId: placeObj?.id ?? null,
        skillId: feas.skillId,
        question: text,
        condition: condition || feas.condition,
        channels,
        cadence: feas.cadence,
      });
      close();
      notify(
        lowFree ? 'Watch created with free imagery at low confidence' : 'Watch created',
        'Open',
        () => go('watches', created.id),
        'visibility',
      );
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const stepIdx = stage === 'ask' ? 0 : stage === 'check' ? 1 : 2;

  return (
    <Modal onClose={close} size="wide" label="Build a watch">
      <ModalHead
        eyebrow={fromAnswer ? 'Watch this answer' : 'New watch'}
        title={stage === 'ask' ? 'What should we watch?' : stage === 'check' ? 'Can satellites see this?' : 'Where should alerts go?'}
        sub={stage === 'ask' ? 'Say it in your own words. The agent checks if it can be watched from space before you commit.' : undefined}
        onClose={close}
      />

      {error && <ErrorState error={error} onRetry={() => (stage === 'check' ? void runCheck(text) : void create())} title="Could not complete that" compact />}

      {/* stage indicator */}
      <div className="row" style={{ gap: 6 }} aria-label={`Step ${stepIdx + 1} of 3`}>
        {['Describe', 'Check', 'Deliver'].map((l, i) => (
          <div key={l} className="row grow" style={{ gap: 8, flexDirection: 'column', alignItems: 'stretch' }}>
            <span style={{ height: 3, borderRadius: 2, background: i <= stepIdx ? '#fff' : 'var(--s3)' }} />
            <span className="tiny" style={{ color: i === stepIdx ? '#fff' : undefined }}>{i + 1}. {l}</span>
          </div>
        ))}
      </div>

      {stage === 'ask' && (
        <>
          <textarea
            className="input"
            value={text}
            autoFocus
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runCheck(text); } }}
            placeholder="Tell me when…"
            rows={3}
            style={{ fontSize: 18, lineHeight: 1.5 }}
            aria-label="What should we watch?"
          />
          <div className="row wrap">
            {EXAMPLES.map((ex) => (
              <button key={ex} className="chip" onClick={() => setText(ex)}>{ex}</button>
            ))}
          </div>
          <label className="field">
            Where
            <select className="input" value={place} onChange={(e) => setPlace(e.target.value)}>
              {places.map((p) => <option key={p.id} value={p.id}>{p.name} · {category(p.categoryKey).name}</option>)}
              <option value="">No specific place / all my places</option>
            </select>
          </label>
          <div className="modal-foot">
            <Btn variant="text" onClick={close}>Cancel</Btn>
            <Btn variant="primary" icon="travel_explore" tier="free" disabled={!text.trim()} onClick={() => runCheck(text)}>Check if it’s possible</Btn>
          </div>
        </>
      )}

      {stage === 'check' && (
        <>
          <div className="well" style={{ padding: '12px 16px' }}>
            <div className="tiny">You asked</div>
            <div className="body-sm ink" style={{ marginTop: 2 }}>“{text}” · {placeObj?.name ?? 'all my places'}</div>
          </div>

          {!feas && (
            <div className="col" style={{ gap: 10 }}>
              {CHECK_STEPS.map((s, i) => (
                <div key={s} className="row" style={{ gap: 10, opacity: i <= checking ? 1 : 0.35 }}>
                  {i < checking ? <Ms n="check_circle" size={18} style={{ color: 'var(--green)' }} /> : i === checking ? <span className="spinner" style={{ margin: 3 }} /> : <Ms n="radio_button_unchecked" size={18} className="subtle" />}
                  <span className={i === checking ? 'shimmer-text' : 'body-sm'} style={{ font: '600 14px/1.4 var(--font)' }}>{s}</span>
                </div>
              ))}
            </div>
          )}

          {feas && <Result feas={feas} option={option} setOption={setOption} condition={condition} setCondition={setCondition} onAlternative={runCheck} />}

          <div className="modal-foot">
            <Btn variant="text" icon="arrow_back" onClick={() => { setStage('ask'); setFeas(null); }}>Edit request</Btn>
            {feas?.ok && <Btn variant="primary" trailing="arrow_forward" onClick={() => setStage('deliver')}>Next: delivery</Btn>}
          </div>
        </>
      )}

      {stage === 'deliver' && feas && (
        <>
          <div className="col" style={{ gap: 2 }}>
            {catalogChannels.map((c) => {
              const on = channels.includes(c.id);
              const waMissing = c.id === 'whatsapp' && !connectors.whatsapp.connected;
              return (
                <div key={c.id} className="col" style={{ borderBottom: '1px solid var(--hair-soft)', padding: '10px 0', gap: 10 }}>
                  <button className="row" onClick={() => toggle(c.id)} aria-pressed={on} style={{ gap: 12, background: 'none', border: 0, padding: 0, textAlign: 'left', width: '100%' }}>
                    <Check on={on} />
                    <Ms n={c.icon} size={20} className="muted" />
                    <span className="grow">
                      <span className="body-sm ink" style={{ display: 'block' }}>{c.name}</span>
                      <span className="tiny">
                        {c.id === 'email' && connectors.email.connected ? connectors.email.address : c.id === 'whatsapp' && connectors.whatsapp.connected ? connectors.whatsapp.number : c.note}
                      </span>
                    </span>
                    <Tier tier={c.tier} label={c.tier === 'paid' ? c.note.split(' ')[0] === 'Pro' ? 'Pro' : c.note.split(' / ')[0] : undefined} />
                  </button>
                  {on && waMissing && (
                    <div className="row wrap" style={{ gap: 8, paddingLeft: 30 }}>
                      <input className="input" style={{ flex: '1 1 180px', height: 36 }} placeholder="+1 555 010 2030" inputMode="tel" value={waNumber} onChange={(e) => setWaNumber(e.target.value)} aria-label="WhatsApp number" />
                      <Btn
                        size="sm"
                        icon="link"
                        disabled={waNumber.replace(/\D/g, '').length < 7}
                        onClick={() => {
                          setConnectors({ ...connectors, whatsapp: { connected: true, number: waNumber.trim() } });
                          notify('WhatsApp connected — we sent a test message', undefined, undefined, 'chat');
                        }}
                      >
                        Connect WhatsApp
                      </Btn>
                    </div>
                  )}
                  {on && c.id === 'push' && !connectors.push.connected && (
                    <div className="tiny" style={{ paddingLeft: 30 }}>
                      Install the app to receive push alerts.{' '}
                      <button onClick={() => open({ kind: 'app' })} style={{ border: 0, background: 'none', padding: 0, color: 'var(--blue)', font: 'inherit' }}>Get the app</button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="row wrap" style={{ gap: 16, alignItems: 'flex-end' }}>
            <label className="field" style={{ flex: '1 1 220px' }}>
              Alert language
              <select className="input" value={alertLang} onChange={(e) => setAlertLang(e.target.value)}>
                {LANGS.map((l) => <option key={l.code} value={l.code}>{l.name}{l.name !== l.english ? ` · ${l.english}` : ''}</option>)}
              </select>
            </label>
            <div className="tiny" style={{ flex: '1 1 220px', paddingBottom: 10 }}>Messages, maps and PDF reports are written in this language — including regional languages.</div>
          </div>

          <div className="sunk" style={{ padding: '12px 16px' }}>
            <div className="body-sm">
              <span className="ink">Checks {feas.cadence.charAt(0).toLowerCase() + feas.cadence.slice(1)}</span> with {feas.partial && option === 'free' ? 'Sentinel-2' : feas.satellites}. You’ll hear from us when <span className="ink">{condition || feas.condition}</span>
              {placeObj ? ` on ${placeObj.name}` : ' on any of your places'}. First result after the next pass.
            </div>
          </div>

          {channels.includes('whatsapp') && !connectors.whatsapp.connected && (
            <div className="tiny" style={{ color: 'var(--yellow)' }}>Connect WhatsApp above, or untick it, to start.</div>
          )}

          <div className="modal-foot">
            <Btn variant="text" icon="arrow_back" onClick={() => setStage('check')}>Back</Btn>
            <Btn
              variant="primary"
              icon="visibility"
              tier={effTier}
              tierLabel={effTier === 'paid' ? (feas.partial && option === 'paid' ? feas.cost.split(' · ').pop() : 'Paid') : 'Free'}
              disabled={channels.length === 0 || (channels.includes('whatsapp') && !connectors.whatsapp.connected)}
              onClick={create}
            >
              Start watching
            </Btn>
          </div>
        </>
      )}
    </Modal>
  );
}

function Result({ feas, option, setOption, condition, setCondition, onAlternative }: {
  feas: Feasibility;
  option: 'free' | 'paid';
  setOption: (o: 'free' | 'paid') => void;
  condition: string;
  setCondition: (s: string) => void;
  onAlternative: (q: string) => void;
}) {
  const { skills } = useStore();
  const skill = skills.find((x) => x.id === feas.skillId);
  const tone = !feas.ok ? { c: 'var(--red)', bg: 'rgba(230,43,30,.1)', icon: 'block', t: 'This can’t be watched from space' }
    : feas.partial ? { c: 'var(--yellow)', bg: 'rgba(255,207,37,.08)', icon: 'error', t: 'Yes, with a trade-off' }
    : { c: 'var(--green)', bg: 'rgba(0,202,142,.08)', icon: 'check_circle', t: 'Yes, the agent can watch this' };

  return (
    <div className="col fade-up" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 12, padding: '14px 16px', borderRadius: 'var(--r)', background: tone.bg, border: `1px solid ${tone.c}`, alignItems: 'flex-start' }}>
        <Ms n={tone.icon} size={22} style={{ color: tone.c }} />
        <div>
          <div className="subhead" style={{ fontSize: 17 }}>{tone.t}</div>
          {feas.ok && <div className="body-sm" style={{ marginTop: 2 }}>{feas.title}{skill ? ` · using “${skill.name}”` : ''}</div>}
        </div>
      </div>

      {feas.ok && !feas.partial && (
        <div className="stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
          <div><div className="l">Skill</div><div className="v" style={{ fontSize: 14 }}>{skill?.name ?? feas.title}</div></div>
          <div><div className="l">Satellite</div><div className="v" style={{ fontSize: 14 }}>{feas.satellites}</div></div>
          <div><div className="l">How often</div><div className="v" style={{ fontSize: 14 }}>{feas.cadence}</div></div>
          <div><div className="l">Confidence</div><div className="v" style={{ fontSize: 14 }}>{feas.confidence}</div></div>
          <div><div className="l">Cost</div><div className="v row" style={{ fontSize: 14, gap: 4 }}>{feas.cost}<Tier tier={feas.tier} /></div></div>
        </div>
      )}

      {feas.partial && (
        <div className="col" style={{ gap: 8 }} role="radiogroup" aria-label="Choose data source">
          {([
            ['free', 'Free · Sentinel-2 10 m', 'Low confidence on a plot this small. Every ~5 days.', 'Free'],
            ['paid', `Paid · ${feas.satellites}`, `${feas.confidence} confidence. ${feas.cadence}.`, feas.cost],
          ] as const).map(([k, t, d, cost]) => (
            <button
              key={k}
              role="radio"
              aria-checked={option === k}
              onClick={() => setOption(k)}
              className="row"
              style={{ gap: 12, padding: '12px 14px', textAlign: 'left', borderRadius: 'var(--r)', background: option === k ? 'var(--s2)' : 'transparent', border: `1px solid ${option === k ? '#fff' : 'var(--hair)'}` }}
            >
              <span style={{ width: 16, height: 16, borderRadius: '50%', border: `1.5px solid ${option === k ? '#fff' : 'var(--subtle)'}`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
                {option === k && <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fff' }} />}
              </span>
              <span className="grow">
                <span className="body-sm ink" style={{ display: 'block', fontWeight: 600 }}>{t}</span>
                <span className="tiny">{d}</span>
              </span>
              <Tier tier={k} label={k === 'paid' ? cost.split(' · ').pop() : 'Free'} />
            </button>
          ))}
        </div>
      )}

      {feas.ok && (
        <label className="field">
          Tell me when
          <input className="input" value={condition} onChange={(e) => setCondition(e.target.value)} aria-label="Alert condition" />
        </label>
      )}

      {feas.notes.length > 0 && (
        <div className="col" style={{ gap: 6 }}>
          <div className="eyebrow">{feas.ok ? 'Honest caveats' : 'Why not'}</div>
          {feas.notes.map((n) => (
            <div key={n} className="row body-sm" style={{ gap: 8, alignItems: 'flex-start' }}>
              <Ms n="info" size={16} className="subtle" style={{ marginTop: 3 }} />
              <span>{n}</span>
            </div>
          ))}
        </div>
      )}

      {!feas.ok && feas.alternative && (
        <div className="col" style={{ gap: 8 }}>
          <div className="tiny">What the agent can watch instead</div>
          <button className="chip" style={{ alignSelf: 'flex-start', color: '#fff' }} onClick={() => onAlternative(feas.alternative!)}>
            <Ms n="auto_awesome" />{feas.alternative}<Ms n="arrow_forward" className="ms-flip" />
          </button>
        </div>
      )}
    </div>
  );
}
