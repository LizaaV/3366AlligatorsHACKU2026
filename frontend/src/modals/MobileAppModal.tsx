import { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { Btn, Modal, ModalHead, Ms } from '../components/ui';

/** Deterministic QR-looking matrix (decorative — the real link is shown under it). */
function FakeQr({ size = 168 }: { size?: number }) {
  const n = 25;
  const cells = useMemo(() => {
    const out: [number, number][] = [];
    let s = 1337;
    const finder = (x: number, y: number) => [[0, 0], [n - 7, 0], [0, n - 7]].some(([fx, fy]) => x >= fx && x < fx + 7 && y >= fy && y < fy + 7);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      if (!finder(x, y) && s % 100 < 47) out.push([x, y]);
    }
    return out;
  }, []);
  const c = size / n;
  const F = ({ x, y }: { x: number; y: number }) => (
    <g>
      <rect x={x * c} y={y * c} width={7 * c} height={7 * c} fill="#000" />
      <rect x={(x + 1) * c} y={(y + 1) * c} width={5 * c} height={5 * c} fill="#fff" />
      <rect x={(x + 2) * c} y={(y + 2) * c} width={3 * c} height={3 * c} fill="#000" />
    </g>
  );
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="QR code to download the app">
      <rect width={size} height={size} fill="#fff" />
      {cells.map(([x, y]) => <rect key={`${x}-${y}`} x={x * c} y={y * c} width={c + 0.3} height={c + 0.3} fill="#000" />)}
      <F x={0} y={0} /><F x={n - 7} y={0} /><F x={0} y={n - 7} />
    </svg>
  );
}

export function MobileAppModal() {
  const { close, notify, connectors, setConnectors } = useStore();
  const [phone, setPhone] = useState('');
  return (
    <Modal onClose={close} size="wide" label="Mobile app">
      <ModalHead eyebrow="Mobile app" title="Take your places into the field" sub="Free on iOS and Android. Same account, same places and watches." onClose={close} />
      <div className="row" style={{ gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="col" style={{ alignItems: 'center', gap: 10, flex: 'none' }}>
          <div style={{ padding: 12, background: '#fff', borderRadius: 12 }}><FakeQr /></div>
          <span className="tiny">Scan with your phone camera</span>
          <span className="tiny muted">groundtruth.earth/app</span>
        </div>
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
          <div className="row wrap" style={{ gap: 8 }}>
            <Btn variant="primary" icon="phone_iphone" onClick={() => notify('Opening the App Store…', undefined, undefined, 'phone_iphone')}>App Store</Btn>
            <Btn variant="primary" icon="android" onClick={() => notify('Opening Google Play…', undefined, undefined, 'android')}>Google Play</Btn>
          </div>
        </div>
      </div>
      <div className="well row wrap" style={{ padding: 14, gap: 8 }}>
        <input className="input grow" style={{ minWidth: 180, flex: 1 }} inputMode="tel" placeholder="Your phone number" value={phone} onChange={(e) => setPhone(e.target.value)} aria-label="Phone number" />
        <Btn icon="chat" tier="free" disabled={phone.replace(/\D/g, '').length < 8} onClick={() => { notify('Download link sent on WhatsApp', undefined, undefined, 'chat'); setConnectors({ ...connectors, push: { connected: true } }); }}>Send via WhatsApp</Btn>
        <Btn icon="sms" tier="free" disabled={phone.replace(/\D/g, '').length < 8} onClick={() => { notify('Download link sent by SMS', undefined, undefined, 'sms'); setConnectors({ ...connectors, push: { connected: true } }); }}>Text me</Btn>
      </div>
    </Modal>
  );
}
