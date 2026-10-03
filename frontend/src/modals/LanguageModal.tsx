import { useState } from 'react';
import { useStore } from '../state/store';
import { Modal, ModalHead, Ms } from '../components/ui';
import { LANGS } from '../data/i18n';

export function LanguageModal() {
  const { close, lang, setLang, notify } = useStore();
  const [q, setQ] = useState('');
  const s = q.trim().toLowerCase();
  const list = LANGS.filter((l) => !s || l.name.toLowerCase().includes(s) || l.english.toLowerCase().includes(s) || l.region.toLowerCase().includes(s));
  const pick = (code: string) => {
    const l = LANGS.find((x) => x.code === code)!;
    setLang(code);
    close();
    notify(l.ui ? `Language set to ${l.english}` : `Answers and alerts in ${l.english} · interface stays in English`, undefined, undefined, 'translate');
  };
  return (
    <Modal onClose={close} size="wide" label="Language">
      <ModalHead eyebrow="Language" title="Choose your language" sub={`${LANGS.length} languages for answers, WhatsApp replies, alerts and PDF reports. ${LANGS.filter((l) => l.ui).length} also translate the whole interface.`} onClose={close} />
      <div className="row" style={{ gap: 8, height: 42, padding: '0 12px', borderRadius: 8, background: '#000', border: '1px solid var(--hair)' }}>
        <Ms n="search" size={20} className="muted" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search language or region" aria-label="Search languages" style={{ flex: 1, background: 'transparent', border: 0, outline: 0, color: '#fff', font: '500 15px/1.5 var(--font)' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))', gap: 8 }}>
        {list.map((l) => (
          <button key={l.code} onClick={() => pick(l.code)} dir={l.rtl ? 'rtl' : 'ltr'} aria-pressed={l.code === lang} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2, padding: '10px 12px', borderRadius: 8, textAlign: 'start', background: l.code === lang ? 'var(--s2)' : '#000', border: `1px solid ${l.code === lang ? '#fff' : 'var(--hair-soft)'}` }}>
            <span className="row" style={{ gap: 6, width: '100%' }}>
              <span style={{ font: '600 15px/1.4 var(--font)' }}>{l.name}</span>
              {l.code === lang && <Ms n="check" size={16} style={{ marginInlineStart: 'auto' }} />}
            </span>
            <span className="tiny" dir="ltr">{l.english} · {l.region}</span>
            <span className="tiny" dir="ltr" style={{ color: l.ui ? 'var(--green)' : 'var(--muted)' }}>{l.ui ? 'Full interface' : 'Answers & alerts'}</span>
          </button>
        ))}
      </div>
      <div className="sunk caption" style={{ padding: 12 }}>Machine-translated answers are marked as such. Satellite indices, scene IDs and units are never translated, so results stay comparable.</div>
    </Modal>
  );
}
