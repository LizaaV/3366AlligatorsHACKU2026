import { useStore } from '../state/store';
import { Btn, Modal, ModalHead, Ms, Tier } from '../components/ui';

const FREE = ['Free satellites: Sentinel-1/2/3/5P, Landsat, VIIRS', '40 agent runs a month', '5 active watches', 'Email, app and WhatsApp alerts', 'Share links, PDF, GeoJSON & CSV', 'Community expert forum'];
const PRO = ['Everything in Free', 'Paid imagery at cost (3 m – 30 cm)', 'Unlimited runs and watches', 'SMS and Slack alerts', 'GeoTIFF layers, API & webhooks', 'Signed PDFs and notarised proof', '1 expert review a month'];

export function UpgradeModal({ feature, price }: { feature: string; price?: string }) {
  const { close, notify, setPlan, plan } = useStore();
  const one = price && !price.includes('Pro');
  return (
    <Modal onClose={close} size="wide" label="Upgrade">
      <ModalHead eyebrow="Free vs paid" title={feature === 'Pro plan' ? 'Upgrade to Pro' : feature} sub={one ? 'Pay once for this, or get it with Pro. Nothing is charged until you confirm.' : 'Free stays free. Pro adds paid data and higher limits.'} onClose={close} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 12 }}>
        <div className="well col" style={{ padding: 20, gap: 10 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}><span className="subhead">Free</span><Tier tier="free" label={plan === 'free' ? 'Current' : 'Free'} /></div>
          <div className="h3">$0</div>
          {FREE.map((x) => <div key={x} className="row body-sm" style={{ gap: 8, fontSize: 14 }}><Ms n="check" size={16} style={{ color: 'var(--green)' }} />{x}</div>)}
        </div>
        <div className="col" style={{ padding: 20, gap: 10, borderRadius: 12, background: 'var(--s2)', border: '1px solid #fff' }}>
          <div className="row" style={{ justifyContent: 'space-between' }}><span className="subhead">Pro</span><Tier tier="paid" label={plan === 'pro' ? 'Current' : 'Paid'} /></div>
          <div className="h3">$29<span className="body-sm"> / month</span></div>
          {PRO.map((x) => <div key={x} className="row body-sm" style={{ gap: 8, fontSize: 14 }}><Ms n="check" size={16} style={{ color: 'var(--yellow)' }} />{x}</div>)}
        </div>
      </div>
      <div className="modal-foot">
        <Btn onClick={close}>Not now</Btn>
        {one && <Btn icon="shopping_cart" tier="paid" tierLabel={price} onClick={() => { close(); notify(`${feature} ordered · ${price}`, undefined, undefined, 'receipt_long'); }}>Buy once</Btn>}
        {plan === 'free' ? (
          <Btn variant="primary" icon="bolt" tier="paid" tierLabel="$29/mo" onClick={() => { setPlan('pro'); close(); notify('You are on Pro · paid features unlocked', undefined, undefined, 'bolt'); }}>Upgrade to Pro</Btn>
        ) : (
          <Btn variant="primary" onClick={() => { setPlan('free'); close(); notify('Switched back to Free', undefined, undefined, 'info'); }}>Switch to Free</Btn>
        )}
      </div>
    </Modal>
  );
}
