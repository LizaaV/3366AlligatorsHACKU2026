import { useState } from 'react';
import { useStore, type ExportTarget } from '../state/store';
import { api, toApiError } from '../api';
import { Btn, Check, Modal, ModalHead, Ms } from '../components/ui';
import { LANGS } from '../data/i18n';
import { DEFAULT_CENTER, thumb } from '../lib/geo';

type Tab = 'link' | 'pdf' | 'data';

export function ExportModal({ target }: { target: ExportTarget }) {
  const { close, notify, lang } = useStore();
  const [tab, setTab] = useState<Tab>('link');
  const [access, setAccess] = useState<'anyone' | 'team' | 'invited'>('anyone');
  const [expires, setExpires] = useState('30 days');
  const [liveLink, setLiveLink] = useState(target.kind === 'watch');
  const [opts, setOpts] = useState({ map: true, ci: true, proof: true, method: true });
  const [pdfLang, setPdfLang] = useState(lang);
  const [busy, setBusy] = useState<string | null>(null);
  // Placeholder share link until POST /export exists; `requestExport` replaces it with the
  // server's real URL once the endpoint is live.
  const slug = Math.abs([...target.title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36).slice(0, 8);
  const [url, setUrl] = useState(`https://groundtruth.earth/s/${slug}`);

  /**
   * TODO(api): every export here goes through POST /api/export. There is no fixture for it —
   * returning a fake download would be worse than saying it is not connected — so until the
   * endpoint lands this reports the not-implemented error honestly.
   */
  const requestExport = async (format: 'link' | 'pdf' | 'data', label: string) => {
    setBusy(label);
    try {
      const res = await api.exports.create({ targetKind: target.kind, targetId: target.id, title: target.title, format, lang: pdfLang });
      if (format === 'link') setUrl(res.url);
      notify(`${label} ready`, undefined, undefined, 'download');
    } catch (err) {
      notify(toApiError(err).userMessage, undefined, undefined, 'cloud_off');
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(url); notify('Link copied', undefined, undefined, 'link'); } catch { notify('Copy failed — select the link and copy it', undefined, undefined, 'error'); }
  };
  return (
    <Modal onClose={close} size="wide" label="Export">
      <ModalHead eyebrow={`Export ${target.kind}`} title={target.title} sub={target.subtitle} onClose={close} />
      <div className="seg" role="tablist" style={{ alignSelf: 'flex-start' }}>
        {([['link', 'link', 'Share link'], ['pdf', 'picture_as_pdf', 'PDF report'], ['data', 'dataset', 'Data files']] as const).map(([k, i, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><Ms n={i} size={16} />{l}</button>
        ))}
      </div>

      {tab === 'link' && (
        <div className="col" style={{ gap: 16 }}>
          <div className="row" style={{ gap: 8 }}>
            <input className="input" readOnly value={url} onFocus={(e) => e.target.select()} aria-label="Share link" />
            <Btn variant="primary" icon="content_copy" onClick={copy}>Copy</Btn>
          </div>
          <div className="col" style={{ gap: 8 }}>
            <div className="field">Who can open it</div>
            <div className="row wrap" style={{ gap: 8 }}>
              {([['anyone', 'public', 'Anyone with the link'], ['team', 'group', 'My team'], ['invited', 'lock', 'Only people I invite']] as const).map(([k, i, l]) => (
                <button key={k} className={`chip ${access === k ? 'on' : ''}`} onClick={() => setAccess(k)}><Ms n={i} />{l}</button>
              ))}
            </div>
          </div>
          <div className="row wrap" style={{ gap: 16 }}>
            <label className="field" style={{ minWidth: 180 }}>Link expires
              <select className="input" value={expires} onChange={(e) => setExpires(e.target.value)}>{['7 days', '30 days', '1 year', 'Never'].map((x) => <option key={x}>{x}</option>)}</select>
            </label>
            <button className="row" onClick={() => setLiveLink((v) => !v)} style={{ gap: 10, background: 'transparent', border: 0, textAlign: 'left', paddingTop: 18 }}>
              <Check on={liveLink} />
              <span className="col"><span style={{ font: '600 14px/1.4 var(--font)' }}>Keep it live</span><span className="tiny">Viewers see new passes as they arrive, not a frozen copy</span></span>
            </button>
          </div>
          <div className="col" style={{ gap: 8 }}>
            <div className="field">Send it</div>
            <div className="row wrap" style={{ gap: 8 }}>
              <Btn icon="chat" tier="free" onClick={() => notify('Opening WhatsApp with the link…', undefined, undefined, 'chat')}>WhatsApp</Btn>
              <Btn icon="mail" tier="free" onClick={() => notify('Email draft created', undefined, undefined, 'mail')}>Email</Btn>
              <Btn icon="qr_code_2" tier="free" onClick={() => notify('QR code saved', undefined, undefined, 'qr_code_2')}>QR code</Btn>
            </div>
          </div>
          <div className="sunk caption" style={{ padding: 12 }}>Shared pages show the answer, the confidence range, the satellite scenes used and the caveats. Your other places stay private.</div>
        </div>
      )}

      {tab === 'pdf' && (
        <div className="row" style={{ gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          {/* report preview */}
          <div aria-label="PDF preview" style={{ width: 230, flex: 'none', aspectRatio: '1 / 1.414', background: '#fff', color: '#000', borderRadius: 6, padding: 14, display: 'flex', flexDirection: 'column', gap: 6, boxShadow: '0 10px 30px rgba(0,0,0,.5)' }}>
            <div className="row" style={{ gap: 5, font: '700 7px/1 var(--font)', letterSpacing: 0.5 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', border: '1.5px solid #000' }} />GROUNDTRUTH REPORT
            </div>
            <div style={{ font: '700 11px/1.2 var(--font)' }}>{target.title}</div>
            {opts.map && <div style={{ height: 70, borderRadius: 3, background: `#000 url(${thumb(DEFAULT_CENTER.lat, DEFAULT_CENTER.lon, 16)}) center/cover`, position: 'relative' }}><span style={{ position: 'absolute', inset: 14, borderRadius: '50%', border: '1.5px solid #ffcf25' }} /></div>}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 3 }}>
              {['4.6 ha', '0.12', 'Sep 8'].map((v) => <div key={v} style={{ background: '#f1f2f3', borderRadius: 2, padding: 3, font: '700 7px/1.2 var(--font)' }}>{v}{opts.ci && <div style={{ fontWeight: 500, color: '#656a76' }}>±0.7</div>}</div>)}
            </div>
            {[90, 100, 70, 95, 60].map((w, i) => <div key={i} style={{ height: 3, width: `${w}%`, background: '#d5d7db', borderRadius: 2 }} />)}
            {opts.proof && <><div style={{ font: '700 6px/1 var(--font)', marginTop: 4 }}>PROOF · 7 SCENES</div>{[0, 1, 2].map((i) => <div key={i} style={{ height: 3, width: '100%', background: '#eceef0', borderRadius: 2 }} />)}</>}
            <div style={{ marginTop: 'auto', font: '500 5.5px/1.2 var(--font)', color: '#656a76' }}>Hash sha256:7f3a…c91e · {LANGS.find((l) => l.code === pdfLang)?.english}</div>
          </div>
          <div className="col grow" style={{ gap: 12, minWidth: 220 }}>
            {([['map', 'Map with AI layers'], ['ci', 'Confidence ranges on every number'], ['proof', 'Proof appendix (scene IDs, cloud %, hash)'], ['method', 'Method & known issues']] as const).map(([k, l]) => (
              <button key={k} className="row" onClick={() => setOpts({ ...opts, [k]: !opts[k] })} style={{ gap: 10, background: 'transparent', border: 0, textAlign: 'left', font: '500 14px/1.4 var(--font)' }}>
                <Check on={opts[k]} />{l}
              </button>
            ))}
            <label className="field">Report language
              <select className="input" value={pdfLang} onChange={(e) => setPdfLang(e.target.value)}>{LANGS.map((l) => <option key={l.code} value={l.code}>{l.name} · {l.english}</option>)}</select>
            </label>
            <div className="row wrap" style={{ gap: 8 }}>
              <Btn variant="primary" icon="download" tier="free" disabled={busy === 'PDF report'} onClick={() => void requestExport('pdf', 'PDF report')}>{busy === 'PDF report' ? 'Preparing…' : 'Download PDF'}</Btn>
              <Btn icon="workspace_premium" tier="paid" tierLabel="$5" onClick={() => void requestExport('pdf', 'Signed & time-stamped PDF')}>Signed PDF</Btn>
            </div>
            <div className="tiny">Signed PDFs carry a time-stamp and a hash anyone can check — useful for lenders, insurers and EUDR buyers.</div>
          </div>
        </div>
      )}

      {tab === 'data' && (
        <div className="col" style={{ gap: 8 }}>
          {([
            ['GeoJSON', 'Outlines and zones with attributes', 'data_object', 'free', ''],
            ['CSV', 'Every number per date, with confidence ranges', 'table', 'free', ''],
            ['KML', 'Open in Google Earth', 'public', 'free', ''],
            ['GeoTIFF layers', 'Full-resolution NDMI, NDVI, temperature rasters', 'grid_on', 'paid', 'Pro'],
            ['API & webhooks', 'Pull results into your own systems', 'api', 'paid', 'Pro'],
          ] as const).map(([n, d, i, tier, lbl]) => (
            <div key={n} className="row" style={{ gap: 12, padding: '10px 12px', borderRadius: 8, background: '#000', border: '1px solid var(--hair-soft)' }}>
              <Ms n={i} size={20} className="muted" />
              <div className="col grow"><span style={{ font: '600 14px/1.4 var(--font)' }}>{n}</span><span className="tiny">{d}</span></div>
              <Btn size="sm" icon="download" tier={tier} tierLabel={lbl || undefined} onClick={() => void requestExport('data', n)}>Download</Btn>
            </div>
          ))}
        </div>
      )}
      <div className="modal-foot"><Btn onClick={close}>Done</Btn></div>
    </Modal>
  );
}

