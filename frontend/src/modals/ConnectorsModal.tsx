import { useState } from 'react';
import { useStore } from '../state/store';
import { Btn, Modal, ModalHead, Ms } from '../components/ui';
import type { ChannelId } from '../api/types';

type RowId = ChannelId | 'api';

const ROWS: { id: RowId; name: string; icon: string; desc: string; detail: string }[] = [
  { id: 'whatsapp', name: 'WhatsApp', icon: 'chat', desc: 'Ask, add places and get alerts in chat', detail: 'Message the agent, send voice notes and get trigger alerts with a map image, in your own language.' },
  { id: 'email', name: 'Email', icon: 'mail', desc: 'Alerts and reports by email', detail: 'Trigger alerts and reports delivered to your inbox, with a link and a PDF.' },
  { id: 'push', name: 'Mobile app', icon: 'smartphone', desc: 'Push alerts and field mode', detail: 'Push alerts, offline maps of your places and field mode.' },
  { id: 'sms', name: 'SMS', icon: 'sms', desc: 'For phones without data', detail: 'Text-message alerts for phones without data.' },
  { id: 'slack', name: 'Slack', icon: 'tag', desc: 'Post alerts to a channel', detail: 'Post trigger alerts to a Slack channel.' },
  { id: 'api', name: 'API & webhooks', icon: 'api', desc: 'Send results to your systems', detail: 'Send results to your own systems with an API key and webhooks.' },
];

/** Connectors are not wired to a backend yet: every channel is shown as a preview and nothing can be connected. */
export function ConnectorsModal({ focus }: { focus?: ChannelId }) {
  const { close } = useStore();
  const [sel, setSel] = useState<RowId>(focus ?? 'whatsapp');
  const cur = ROWS.find((r) => r.id === sel) ?? ROWS[0];
  return (
    <Modal onClose={close} size="wide" label="Connectors">
      <ModalHead eyebrow="Connectors" title="Where should the agent reach you?" sub="Coming soon. No channel can be connected yet, so alerts are only shown in the app." onClose={close} />
      <div className="row" style={{ gap: 16, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <div className="col" style={{ gap: 4, flex: '1 1 220px' }}>
          {ROWS.map((r) => (
            <button key={r.id} onClick={() => setSel(r.id)} className={`menu-item ${sel === r.id ? 'on' : ''}`} aria-pressed={sel === r.id}>
              <Ms n={r.icon} />
              <span className="col grow"><span style={{ font: '600 14px/1.4 var(--font)' }}>{r.name}</span><span className="tiny">{r.desc}</span></span>
              <span className="tiny muted">Coming soon</span>
            </button>
          ))}
        </div>
        <div className="well col" style={{ flex: '2 1 300px', padding: 20, gap: 14 }}>
          <div className="row" style={{ gap: 10 }}><Ms n={cur.icon} size={22} /><span className="subhead">{cur.name}</span></div>
          <div className="body-sm">{cur.detail}</div>
          <Btn variant="primary" icon="schedule" style={{ alignSelf: 'flex-start' }} disabled title="Coming soon">Coming soon</Btn>
          <div className="tiny">This channel is not available yet. Nothing is sent or stored from here.</div>
        </div>
      </div>
      <div className="modal-foot"><Btn onClick={close}>Close</Btn></div>
    </Modal>
  );
}
