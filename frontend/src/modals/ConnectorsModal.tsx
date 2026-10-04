import { useStore } from '../state/store';
import { Btn, Modal, ModalHead, Ms } from '../components/ui';
import type { ChannelId } from '../api/types';

const CHANNELS: { id: ChannelId; name: string; icon: string; desc: string }[] = [
  { id: 'email', name: 'Email', icon: 'mail', desc: 'Trigger alerts and reports by email' },
  { id: 'whatsapp', name: 'WhatsApp', icon: 'chat', desc: 'Ask questions and get alerts in chat' },
  { id: 'push', name: 'Mobile app', icon: 'smartphone', desc: 'Push alerts on your phone' },
  { id: 'sms', name: 'SMS', icon: 'sms', desc: 'For phones without data' },
  { id: 'slack', name: 'Slack', icon: 'tag', desc: 'Post alerts to a channel' },
];

/**
 * Where alerts could be delivered. None of these channels is built yet, so the modal says so
 * plainly instead of offering a sign-up that goes nowhere. Answers live in the app for now.
 */
export function ConnectorsModal({ focus }: { focus?: ChannelId }) {
  const { close } = useStore();
  return (
    <Modal onClose={close} label="Alert channels">
      <ModalHead
        eyebrow="Alert channels"
        title="Alerts outside the app are coming soon"
        sub="For now, answers, reports and share links live here in Constellation. Triggers you set are saved, and these channels will deliver them once they are built."
        onClose={close}
      />
      <div className="col" style={{ gap: 4 }}>
        {CHANNELS.map((c) => (
          <div key={c.id} className={`menu-item ${focus === c.id ? 'on' : ''}`} style={{ cursor: 'default' }}>
            <Ms n={c.icon} />
            <span className="col grow"><span style={{ font: '600 14px/1.4 var(--font)' }}>{c.name}</span><span className="tiny">{c.desc}</span></span>
            <span className="tiny" style={{ padding: '1px 6px', borderRadius: 4, background: 'var(--s3)', whiteSpace: 'nowrap' }}>Coming soon</span>
          </div>
        ))}
      </div>
      <div className="modal-foot"><Btn onClick={close}>Done</Btn></div>
    </Modal>
  );
}
