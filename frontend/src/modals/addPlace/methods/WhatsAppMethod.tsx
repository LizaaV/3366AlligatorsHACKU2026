/** Locate from a WhatsApp location pin the user sent from the field. */

import { useEffect, useState } from 'react';
import { api } from '../../../api';
import { useStore } from '../../../state/store';
import { Btn, Ms } from '../../../components/ui';
import { fmtC } from '../../../lib/geo';
import type { MethodProps } from '../types';

const WA_PINS = api.places.inboundPins();
const WA_NUMBER = api.places.whatsappNumber();

export function WhatsAppMethod({ onChange }: MethodProps) {
  const { connectors, open } = useStore();
  const [waPin, setWaPin] = useState<string | null>(null);

  useEffect(() => {
    const p = WA_PINS.find((x) => x.id === waPin);
    onChange(p ? { lat: p.lat, lon: p.lon, label: p.note, source: 'whatsapp', via: `${p.from} · ${p.when}` } : null);
  }, [waPin, onChange]);

  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="body-sm">
        Standing in the field? In WhatsApp, tap <span className="ink">📎 → Location → Send your current location</span> to <span className="ink">{WA_NUMBER}</span> (Constellation). It shows up here within seconds — no app needed.
      </div>
      {!connectors.whatsapp.connected ? (
        <div className="well row wrap" style={{ padding: '12px 14px', gap: 12 }}>
          <Ms n="link_off" className="muted" />
          <div className="grow body-sm" style={{ minWidth: 180 }}>Connect your WhatsApp number first so we know which pins are yours.</div>
          <Btn variant="secondary" icon="chat" tier="free" onClick={() => open({ kind: 'connectors', focus: 'whatsapp' })}>Connect WhatsApp</Btn>
        </div>
      ) : (
        <div className="col" style={{ gap: 2 }}>
          <div className="tiny" style={{ marginBottom: 4 }}>Pins received from {connectors.whatsapp.number || 'your number'}</div>
          {WA_PINS.map((p) => (
            <button key={p.id} className={`menu-item ${waPin === p.id ? 'on' : ''}`} onClick={() => setWaPin(p.id)}>
              <Ms n="pin_drop" />
              <span className="grow">
                {p.note}
                <span className="caption" style={{ display: 'block' }}>{p.from} · {p.when} · {fmtC(p.lat, p.lon)}</span>
              </span>
              {waPin === p.id && <Ms n="check" style={{ color: '#fff' }} />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
