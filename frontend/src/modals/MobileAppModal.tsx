import { useStore } from '../state/store';
import { Btn, Modal, ModalHead, Ms } from '../components/ui';

export function MobileAppModal() {
  const { close } = useStore();
  return (
    <Modal onClose={close} size="wide" label="Mobile app">
      <ModalHead eyebrow="Mobile app" title="Take your places into the field" sub="Coming soon. The mobile app is not released yet; this is a preview of what it will do." onClose={close} />
      <div className="row" style={{ gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="col grow" style={{ gap: 14, minWidth: 240 }}>
          {[
            ['notifications_active', 'Push alerts', 'Watch alerts with a map image, even when the app is closed.'],
            ['offline_pin', 'Offline maps', 'Your places and last layers are saved for areas with no signal.'],
            ['directions_walk', 'Field mode', 'GPS walks you to the dry patch; add a photo to confirm what the satellite saw.'],
            ['mic', 'Ask by voice', 'Speak your question in your own language.'],
            ['network_cell', 'Low bandwidth', 'Lite maps under 200 KB for slow connections.'],
          ].map(([i, t, d]) => (
            <div key={t} className="row" style={{ gap: 12, alignItems: 'flex-start' }}>
              <Ms n={i} size={20} className="muted" style={{ marginTop: 2 }} />
              <div className="col"><span style={{ font: '600 14px/1.4 var(--font)' }}>{t}</span><span className="caption">{d}</span></div>
            </div>
          ))}
        </div>
      </div>
      <div className="well row" role="note" style={{ padding: 14, gap: 10, alignItems: 'flex-start' }}>
        <Ms n="schedule" size={20} className="muted" />
        <span className="caption">Coming soon. There is no download link, QR code or text message yet. Nothing is sent from here.</span>
      </div>
      <div className="modal-foot"><Btn onClick={close}>Close</Btn></div>
    </Modal>
  );
}
