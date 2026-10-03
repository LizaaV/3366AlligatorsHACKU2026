import { useEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { ApiError, api, toApiError } from '../api';
import type { ChannelId, Feasibility } from '../model';
import { Btn, Modal, ModalHead, Ms } from '../components/ui';
import { ErrorState } from '../components/async';

const EXAMPLES = [
  'Tell me when the dry patch on North Pivot passes 5 ha',
  'Alert me if a fire starts within 10 km of my farm',
  'Warn me if forest is cleared on plot 14',
  'Count the cars in my parking lot',
];

const CHECK_STEPS = ['Reading your request', 'Matching a skill', 'Checking satellite coverage & revisit', 'Estimating accuracy'];

type Stage = 'ask' | 'check' | 'save';

export function WatchBuilderModal({ prefill, placeId, skillId, fromAnswer }: { prefill?: string; placeId?: string | null; skillId?: string; fromAnswer?: boolean }) {
  const { places, skills, category, close, addWatch, notify, go } = useStore();
  const presetSkill = skillId ? skills.find((x) => x.id === skillId) : undefined;
  const autoText = presetSkill ? `Tell me when ${presetSkill.name.toLowerCase()} finds something new` : '';

  const [stage, setStage] = useState<Stage>('ask');
  const [text, setText] = useState(prefill ?? autoText);
  const [place, setPlace] = useState<string>(placeId === undefined ? (places[0]?.id ?? '') : placeId ?? '');
  const [checking, setChecking] = useState(0); // steps done; CHECK_STEPS.length = finished
  const [feas, setFeas] = useState<Feasibility | null>(null);
  const [condition, setCondition] = useState('');
  // No delivery channel is built yet; the API still takes one, so the default is sent as is.
  const channels: ChannelId[] = ['email'];
  const [error, setError] = useState<ApiError | null>(null);
  const [saving, setSaving] = useState(false);
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
      setFeas(f);
    } catch (err) {
      setError(toApiError(err));
    } finally {
      timers.current.forEach((t) => window.clearTimeout(t));
      setChecking(CHECK_STEPS.length);
    }
  };

  const create = async () => {
    if (!feas || saving) return;
    setSaving(true);
    setError(null);
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
        feas.partial ? 'Trigger saved (low confidence on free imagery)' : 'Trigger saved',
        'Open',
        () => go('triggers', created.id),
        'notifications',
      );
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setSaving(false);
    }
  };

  const stepIdx = stage === 'ask' ? 0 : stage === 'check' ? 1 : 2;

  return (
    <Modal onClose={close} size="wide" label="Set a trigger">
      <ModalHead
        eyebrow={fromAnswer ? 'Trigger from this answer' : 'New trigger'}
        title={stage === 'ask' ? 'What should the trigger look for?' : stage === 'check' ? 'Can satellites see this?' : 'Save the trigger'}
        sub={stage === 'ask' ? 'Say it in your own words. The agent checks whether satellites can see it before you save.' : undefined}
        onClose={close}
      />

      {error && <ErrorState error={error} onRetry={() => (stage === 'check' ? void runCheck(text) : void create())} title="Could not complete that" compact />}

      {/* stage indicator */}
      <div className="row" style={{ gap: 6 }} aria-label={`Step ${stepIdx + 1} of 3`}>
        {['Describe', 'Check', 'Save'].map((l, i) => (
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
            aria-label="What should the trigger look for?"
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
            <Btn variant="primary" icon="travel_explore" disabled={!text.trim()} onClick={() => runCheck(text)}>Check if it’s possible</Btn>
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

          {feas && <Result feas={feas} condition={condition} setCondition={setCondition} onAlternative={runCheck} />}

          <div className="modal-foot">
            <Btn variant="text" icon="arrow_back" onClick={() => { setStage('ask'); setFeas(null); }}>Edit request</Btn>
            {feas?.ok && <Btn variant="primary" trailing="arrow_forward" onClick={() => setStage('save')}>Next</Btn>}
          </div>
        </>
      )}

      {stage === 'save' && feas && (
        <>
          <div className="sunk" style={{ padding: '12px 16px' }}>
            <div className="body-sm">
              Look for <span className="ink">{condition || feas.condition}</span>
              {placeObj ? ` on ${placeObj.name}` : ' on any of your places'}, using {feas.satellites}.
            </div>
          </div>
          <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
            <Ms n="info" size={16} className="subtle" style={{ marginTop: 2 }} />
            <span className="tiny">
              Automatic re-checks and alerts are not running yet. The trigger is saved with your question, so you can open it from Triggers and run it on the latest imagery at any time.
            </span>
          </div>
          <div className="modal-foot">
            <Btn variant="text" icon="arrow_back" onClick={() => setStage('check')}>Back</Btn>
            <Btn variant="primary" icon="notifications" disabled={saving} onClick={create}>
              {saving ? 'Saving…' : 'Save trigger'}
            </Btn>
          </div>
        </>
      )}
    </Modal>
  );
}

function Result({ feas, condition, setCondition, onAlternative }: {
  feas: Feasibility;
  condition: string;
  setCondition: (s: string) => void;
  onAlternative: (q: string) => void;
}) {
  const { skills } = useStore();
  const skill = skills.find((x) => x.id === feas.skillId);
  const tone = !feas.ok ? { c: 'var(--red)', bg: 'rgba(230,43,30,.1)', icon: 'block', t: 'Satellites can’t see this' }
    : feas.partial ? { c: 'var(--yellow)', bg: 'rgba(255,207,37,.08)', icon: 'error', t: 'Yes, at lower confidence' }
    : { c: 'var(--green)', bg: 'rgba(0,202,142,.08)', icon: 'check_circle', t: 'Yes, satellites can see this' };

  return (
    <div className="col fade-up" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 12, padding: '14px 16px', borderRadius: 'var(--r)', background: tone.bg, border: `1px solid ${tone.c}`, alignItems: 'flex-start' }}>
        <Ms n={tone.icon} size={22} style={{ color: tone.c }} />
        <div>
          <div className="subhead" style={{ fontSize: 17 }}>{tone.t}</div>
          {feas.ok && <div className="body-sm" style={{ marginTop: 2 }}>{feas.title}{skill ? ` · using “${skill.name}”` : ''}</div>}
        </div>
      </div>

      {feas.ok && (
        <div className="stats" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
          <div><div className="l">Skill</div><div className="v" style={{ fontSize: 14 }}>{skill?.name ?? feas.title}</div></div>
          <div><div className="l">Satellite</div><div className="v" style={{ fontSize: 14 }}>{feas.satellites}</div></div>
          <div><div className="l">Satellite revisit</div><div className="v" style={{ fontSize: 14 }}>{feas.cadence}</div></div>
          <div><div className="l">Confidence</div><div className="v" style={{ fontSize: 14 }}>{feas.confidence}</div></div>
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
          <div className="tiny">What the agent can check instead</div>
          <button className="chip" style={{ alignSelf: 'flex-start', color: '#fff' }} onClick={() => onAlternative(feas.alternative!)}>
            <Ms n="auto_awesome" />{feas.alternative}<Ms n="arrow_forward" className="ms-flip" />
          </button>
        </div>
      )}
    </div>
  );
}
