import { useState } from 'react';
import { useStore, type Connectors } from '../state/store';
import { Btn, Modal, ModalHead, Ms, Tier } from '../components/ui';
import type { ChannelId } from '../api/types';
import { api } from '../api';

const WA_NUMBER = api.places.whatsappNumber();

function WhatsAppSetup() {
  const { connectors, setConnectors, notify } = useStore();
  const wa = connectors.whatsapp;
  const [num, setNum] = useState(wa.number);
  const [stage, setStage] = useState<'number' | 'code'>('number');
  const [code, setCode] = useState('');
  if (wa.connected) {
    return (
      <div className="col" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 8 }}><span className="dot" style={{ background: 'var(--green)' }} /><span style={{ font: '600 14px/1.4 var(--font)' }}>Connected to {wa.number}</span></div>
        <div className="sunk" style={{ padding: 12 }}>
          <div className="caption muted">Save <span className="ink">{WA_NUMBER}</span> as “Constellation” and message it:</div>
          <div className="col" style={{ gap: 6, marginTop: 8 }}>
            {['“How is North Pivot?”', '🎤 Voice note in any language', '📍 Send a location pin to add a place', '“Stop alerts for Lake Mead”'].map((x) => (
              <span key={x} style={{ alignSelf: 'flex-start', padding: '6px 10px', borderRadius: '10px 10px 10px 2px', background: '#0b3d2c', font: '500 13px/1.4 var(--font)' }}>{x}</span>
            ))}
          </div>
        </div>
        <Btn size="sm" variant="text" style={{ alignSelf: 'flex-start' }} onClick={() => { setConnectors({ ...connectors, whatsapp: { connected: false, number: '' } }); notify('WhatsApp disconnected', undefined, undefined, 'link_off'); }}>Disconnect</Btn>
      </div>
    );
  }
  return (
    <div className="col" style={{ gap: 12 }}>
      {stage === 'number' ? (
        <>
          <label className="field">Your WhatsApp number<input className="input" inputMode="tel" placeholder="+91 98765 43210" value={num} onChange={(e) => setNum(e.target.value)} /></label>
          <Btn variant="primary" icon="sms" style={{ alignSelf: 'flex-start' }} disabled={num.replace(/\D/g, '').length < 8} onClick={() => setStage('code')}>Send code</Btn>
        </>
      ) : (
        <>
          <div className="caption muted">We sent a 6-digit code to <span className="ink">{num}</span> on WhatsApp.</div>
          <label className="field">Code<input className="input" inputMode="numeric" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} style={{ letterSpacing: 6, maxWidth: 200 }} /></label>
          <div className="row" style={{ gap: 8 }}>
            <Btn onClick={() => setStage('number')}>Back</Btn>
            <Btn variant="primary" icon="check" disabled={code.length !== 6} onClick={() => { setConnectors({ ...connectors, whatsapp: { connected: true, number: num } }); notify('WhatsApp connected', undefined, undefined, 'chat'); }}>Verify</Btn>
          </div>
        </>
      )}
      <div className="tiny">Ask questions, add places by sending a pin, and get watch alerts with a map image — in your own language. Message rates from your carrier may apply.</div>
    </div>
  );
}

export function ConnectorsModal({ focus }: { focus?: ChannelId }) {
  const { close, connectors, setConnectors, open, notify, plan } = useStore();
  const [sel, setSel] = useState<keyof Connectors | 'api'>(focus ?? 'whatsapp');
  const rows: { id: keyof Connectors | 'api'; name: string; icon: string; desc: string; tier: 'free' | 'paid'; tierLabel?: string; on: boolean }[] = [
    { id: 'whatsapp', name: 'WhatsApp', icon: 'chat', desc: 'Ask, add places and get alerts in chat', tier: 'free', on: connectors.whatsapp.connected },
    { id: 'email', name: 'Email', icon: 'mail', desc: connectors.email.address, tier: 'free', on: connectors.email.connected },
    { id: 'push', name: 'Mobile app', icon: 'smartphone', desc: 'Push alerts and field mode', tier: 'free', on: connectors.push.connected },
    { id: 'sms', name: 'SMS', icon: 'sms', desc: 'For phones without data', tier: 'paid', tierLabel: '$0.02/msg', on: connectors.sms.connected },
    { id: 'slack', name: 'Slack', icon: 'tag', desc: 'Post alerts to a channel', tier: 'paid', tierLabel: 'Pro', on: connectors.slack.connected },
    { id: 'api', name: 'API & webhooks', icon: 'api', desc: 'Send results to your systems', tier: 'paid', tierLabel: 'Pro', on: false },
  ];
  const cur = rows.find((r) => r.id === sel)!;
  const connectSimple = (id: 'sms' | 'slack' | 'api') => {
    if (plan === 'free' && id !== 'sms') return open({ kind: 'upgrade', feature: cur.name, price: '$29 / month (Pro)' });
    if (id === 'api') return notify('API key created', undefined, undefined, 'key');
    setConnectors({ ...connectors, [id]: id === 'sms' ? { connected: true, number: connectors.whatsapp.number || '' } : { connected: true } });
    notify(`${cur.name} connected`);
  };
  return (
    <Modal onClose={close} size="wide" label="Connectors">
      <ModalHead eyebrow="Connectors" title="Where should the agent reach you?" sub="Answers and watch alerts can go to any of these. Free channels are marked." onClose={close} />
      <div className="row" style={{ gap: 16, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <div className="col" style={{ gap: 4, flex: '1 1 220px' }}>
          {rows.map((r) => (
            <button key={r.id} onClick={() => setSel(r.id)} className={`menu-item ${sel === r.id ? 'on' : ''}`}>
              <Ms n={r.icon} />
              <span className="col grow"><span style={{ font: '600 14px/1.4 var(--font)' }}>{r.name}</span><span className="tiny">{r.on ? 'Connected' : r.desc}</span></span>
              {r.on ? <span className="dot" style={{ background: 'var(--green)' }} /> : <Tier tier={r.tier} label={r.tierLabel} />}
            </button>
          ))}
        </div>
        <div className="well col" style={{ flex: '2 1 300px', padding: 20, gap: 14 }}>
          <div className="row" style={{ gap: 10 }}><Ms n={cur.icon} size={22} /><span className="subhead">{cur.name}</span><Tier tier={cur.tier} label={cur.tierLabel} /></div>
          {sel === 'whatsapp' && <WhatsAppSetup />}
          {sel === 'email' && <div className="body-sm">Alerts and reports go to <span className="ink">{connectors.email.address}</span>. Reports include a link and a PDF.</div>}
          {sel === 'push' && (
            <div className="col" style={{ gap: 10 }}>
              <div className="body-sm">Install the app and sign in to get push alerts, offline maps of your places and field mode.</div>
              <Btn variant="primary" icon="qr_code_2" style={{ alignSelf: 'flex-start' }} onClick={() => open({ kind: 'app' })}>Get the app</Btn>
            </div>
          )}
          {(sel === 'sms' || sel === 'slack' || sel === 'api') && (
            <div className="col" style={{ gap: 10 }}>
              <div className="body-sm">{cur.desc}. {sel === 'sms' ? 'Charged per message at cost; you set a monthly cap.' : 'Included in the Pro plan.'}</div>
              <Btn variant="primary" icon="link" tier="paid" tierLabel={cur.tierLabel} style={{ alignSelf: 'flex-start' }} disabled={cur.on} onClick={() => connectSimple(sel)}>{cur.on ? 'Connected' : 'Connect'}</Btn>
            </div>
          )}
        </div>
      </div>
      <div className="modal-foot"><Btn onClick={close}>Done</Btn></div>
    </Modal>
  );
}
