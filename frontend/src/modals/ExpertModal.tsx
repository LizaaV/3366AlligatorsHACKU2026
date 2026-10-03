import { useState } from 'react';
import { useStore } from '../state/store';
import { Btn, Check, Modal, ModalHead, Ms, Tier } from '../components/ui';
import { LANGS } from '../data/i18n';

const EXPERTS = [
  { id: 'community', name: 'Community forum', icon: 'groups', who: 'Other farmers, analysts and skill authors', time: 'Usually 1–2 days', price: 'Free', tier: 'free' as const },
  { id: 'agro', name: 'Agronomist', icon: 'agriculture', who: 'Certified crop adviser · irrigation & soil', time: 'Within 24 h', price: '$49', tier: 'paid' as const },
  { id: 'rs', name: 'Remote-sensing analyst', icon: 'satellite_alt', who: 'Checks the imagery, method and confidence', time: 'Within 24 h', price: '$79', tier: 'paid' as const },
  { id: 'hydro', name: 'Hydrologist', icon: 'water_drop', who: 'Reservoirs, floods, water use', time: 'Within 48 h', price: '$79', tier: 'paid' as const },
  { id: 'audit', name: 'EUDR / insurance auditor', icon: 'gavel', who: 'Signs off evidence for buyers, lenders and insurers', time: '2–3 days', price: '$149', tier: 'paid' as const },
];

/** "Ask an expert" — a human reviews the agent's answer (replaces bare proof export as the next step). */
export function ExpertModal({ context }: { context: string; placeId?: string | null }) {
  const { close, lang } = useStore();
  const [pick, setPick] = useState('agro');
  const [msg, setMsg] = useState(`Can you check this result and tell me what to do next?\n\n“${context}”`);
  const [attach, setAttach] = useState({ answer: true, proof: true, layers: false });
  const [l, setL] = useState(lang);
  return (
    <Modal onClose={close} size="wide" label="Ask an expert">
      <ModalHead eyebrow="Ask an expert" title="Get a human to check this" sub="A specialist reviews the answer, the satellite scenes and the caveats, then replies in your language." onClose={close} />
      <div className="well row" role="note" style={{ gap: 10, padding: 12, alignItems: 'flex-start' }}>
        <Ms n="schedule" size={20} className="muted" />
        <span className="caption">Coming soon. Expert reviews are not available yet, so nothing can be sent from here. This is a preview of how it will work.</span>
      </div>
      <div className="col" style={{ gap: 8 }}>
        {EXPERTS.map((x) => (
          <button key={x.id} onClick={() => setPick(x.id)} className="row" style={{ gap: 12, padding: '12px 14px', borderRadius: 10, textAlign: 'left', background: pick === x.id ? 'var(--s2)' : '#000', border: `1px solid ${pick === x.id ? '#fff' : 'var(--hair-soft)'}` }} aria-pressed={pick === x.id}>
            <Ms n={x.icon} size={22} className="muted" />
            <div className="col grow"><span style={{ font: '600 15px/1.4 var(--font)' }}>{x.name}</span><span className="tiny">{x.who} · {x.time}</span></div>
            <Tier tier={x.tier} label={x.price} />
          </button>
        ))}
      </div>
      <label className="field">Your question<textarea className="input" rows={4} value={msg} onChange={(ev) => setMsg(ev.target.value)} /></label>
      <div className="row wrap" style={{ gap: 16 }}>
        {([['answer', 'Attach this answer'], ['proof', 'Attach proof pack'], ['layers', 'Share map layers']] as const).map(([k, t]) => (
          <button key={k} className="row" onClick={() => setAttach({ ...attach, [k]: !attach[k] })} style={{ gap: 8, background: 'transparent', border: 0, font: '500 14px/1.4 var(--font)' }}><Check on={attach[k]} />{t}</button>
        ))}
      </div>
      <label className="field" style={{ maxWidth: 280 }}>Reply language
        <select className="input" value={l} onChange={(ev) => setL(ev.target.value)}>{LANGS.map((x) => <option key={x.code} value={x.code}>{x.name} · {x.english}</option>)}</select>
      </label>
      <div className="modal-foot">
        <Btn onClick={close}>Close</Btn>
        <Btn variant="primary" icon="schedule" disabled title="Coming soon">Coming soon</Btn>
      </div>
    </Modal>
  );
}
