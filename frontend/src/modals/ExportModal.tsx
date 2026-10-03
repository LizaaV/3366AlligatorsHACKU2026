import { useCallback, useState } from 'react';
import { useStore, type ExportTarget } from '../state/store';
import { api, toApiError } from '../api';
import type { ShareCreated, ShareInfo } from '../api';
import { useResource } from '../hooks/useResource';
import { Btn, Modal, ModalHead, Ms } from '../components/ui';

type Tab = 'link' | 'pdf' | 'data';

/** Save a GeoJSON value as a file in the browser. */
function downloadGeoJson(name: string, value: unknown) {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: 'application/geo+json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/[^\w.-]+/g, '-').toLowerCase() || 'export'}.geojson`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** A run's `area.geojson` may be a Polygon, a Feature or a FeatureCollection; return a FeatureCollection. */
const asFeatureCollection = (g: Record<string, unknown>, properties: Record<string, unknown>) => {
  if (g.type === 'FeatureCollection') return g;
  if (g.type === 'Feature') return { type: 'FeatureCollection', features: [{ ...g, properties: { ...(g.properties as object | undefined), ...properties } }] };
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties, geometry: g }] };
};

/**
 * Export for an answer (needs the run id) or a saved place (needs the place id).
 *
 * Everything here is backed by the API: the share link and PDF come from the run's routes, the
 * GeoJSON comes from the run's `area` or the place's `geometry`. Watches and skills have no
 * export backend, so their entry points are not offered.
 */
export function ExportModal({ target }: { target: ExportTarget }) {
  const { close, notify } = useStore();
  const isAnswer = target.kind === 'answer';
  const [tab, setTab] = useState<Tab>(isAnswer ? 'link' : 'data');
  const [busy, setBusy] = useState<string | null>(null);
  const [share, setShare] = useState<ShareCreated | null>(null);

  const runId = isAnswer ? target.id : undefined;
  const links = useResource(useCallback(async (signal) => (runId ? api.shares.list(runId, signal) : []), [runId]), [runId]);
  const [turnedOff, setTurnedOff] = useState<string[]>([]);
  const [created, setCreated] = useState<ShareInfo[]>([]);
  const all = [...created, ...(links.data ?? []).filter((l) => !created.some((c) => c.slug === l.slug))];

  const fail = (err: unknown) => {
    const e = toApiError(err);
    // 409 = the run has not finished yet.
    notify(e.status === 409 ? 'Finish the run first, then share it.' : e.userMessage, undefined, undefined, 'cloud_off');
  };

  const createLink = async () => {
    if (!target.id) return;
    setBusy('link');
    try {
      const s = await api.shares.create(target.id);
      setShare(s);
      setCreated((c) => [{ ...s, shared_at: new Date().toISOString(), revoked: false }, ...c]);
    } catch (err) { fail(err); } finally { setBusy(null); }
  };

  const text = share ? `${target.title} ${share.url}` : '';
  const copy = async () => {
    if (!share) return;
    try { await navigator.clipboard.writeText(share.url); notify('Link copied', undefined, undefined, 'link'); } catch { notify('Copy failed — select the link and copy it', undefined, undefined, 'error'); }
  };

  const copyUrl = async (url: string) => {
    try { await navigator.clipboard.writeText(url); notify('Link copied', undefined, undefined, 'link'); } catch { notify('Copy failed — select the link and copy it', undefined, undefined, 'error'); }
  };

  const turnOff = async (slug: string) => {
    setBusy(`off:${slug}`);
    try {
      await api.shares.revoke(slug);
      setTurnedOff((t) => [...t, slug]);
      if (share?.slug === slug) setShare(null);
      notify('Link turned off', undefined, undefined, 'link_off');
    } catch (err) { fail(err); } finally { setBusy(null); }
  };

  const downloadGeo = async () => {
    if (!target.id) return;
    setBusy('geo');
    try {
      if (isAnswer) {
        const run = await api.runs.get(target.id);
        if (!run.area) { notify('This answer has no outline to export', undefined, undefined, 'info'); return; }
        downloadGeoJson(target.title, asFeatureCollection(run.area.geojson, { name: run.area.name ?? target.title, area_ha: run.area.area_ha, run_id: target.id }));
      } else {
        const p = await api.shares.placeDto(target.id);
        downloadGeoJson(p.name, { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: p.name, area_ha: p.area_ha, category: p.category_key }, geometry: p.geometry }] });
      }
      notify('GeoJSON downloaded', undefined, undefined, 'download');
    } catch (err) { fail(err); } finally { setBusy(null); }
  };

  return (
    <Modal onClose={close} size="wide" label="Export">
      <ModalHead eyebrow={`Export ${target.kind}`} title={target.title} sub={target.subtitle} onClose={close} />

      {isAnswer && (
        <div className="seg" role="tablist" style={{ alignSelf: 'flex-start' }}>
          {([['link', 'link', 'Share link'], ['pdf', 'picture_as_pdf', 'PDF report'], ['data', 'dataset', 'Data files']] as const).map(([k, i, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><Ms n={i} size={16} />{l}</button>
          ))}
        </div>
      )}

      {!target.id && <div className="sunk caption" style={{ padding: 12 }}>Nothing saved to export yet.</div>}

      {isAnswer && tab === 'link' && (
        <div className="col" style={{ gap: 16 }}>
          {share ? (
            <>
              <div className="row" style={{ gap: 8 }}>
                <input className="input" readOnly value={share.url} onFocus={(e) => e.target.select()} aria-label="Share link" />
                <Btn variant="primary" icon="content_copy" onClick={() => void copy()}>Copy</Btn>
              </div>
              <div className="tiny">Anyone with this link can read a snapshot of the answer. It expires on {new Date(share.expires_at).toLocaleDateString()}.</div>
              <div className="col" style={{ gap: 8 }}>
                <div className="field">Send it</div>
                <div className="row wrap" style={{ gap: 8 }}>
                  <Btn icon="chat" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer')}>WhatsApp</Btn>
                  <Btn icon="mail" onClick={() => { window.location.href = `mailto:?subject=${encodeURIComponent(target.title)}&body=${encodeURIComponent(text)}`; }}>Email</Btn>
                </div>
              </div>
            </>
          ) : (
            <div className="row" style={{ gap: 12 }}>
              <Btn variant="primary" icon="link" disabled={!target.id || busy === 'link'} onClick={() => void createLink()}>{busy === 'link' ? 'Creating…' : 'Create share link'}</Btn>
              <span className="tiny">Makes a public, read-only snapshot of this answer.</span>
            </div>
          )}
          {all.length > 0 && (
            <div className="col" style={{ gap: 8 }}>
              <div className="field">Your links for this answer</div>
              {all.map((l) => {
                const off = l.revoked || turnedOff.includes(l.slug);
                return (
                  <div key={l.slug} className="row wrap sunk" style={{ gap: 8, padding: '8px 12px' }}>
                    <div className="col grow" style={{ minWidth: 0 }}>
                      <span className="ink" style={{ font: '500 13px/1.4 var(--font)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: off ? 'line-through' : undefined }}>{l.url}</span>
                      <span className="tiny">Shared {new Date(l.shared_at).toLocaleDateString()} · {off ? 'Turned off' : `expires ${new Date(l.expires_at).toLocaleDateString()}`}</span>
                    </div>
                    {!off && <Btn size="sm" icon="content_copy" onClick={() => void copyUrl(l.url)}>Copy</Btn>}
                    {!off && <Btn size="sm" variant="text" icon="link_off" disabled={busy === `off:${l.slug}`} onClick={() => void turnOff(l.slug)}>Turn off</Btn>}
                  </div>
                );
              })}
            </div>
          )}
          <div className="sunk caption" style={{ padding: 12 }}>Shared pages show the answer, the confidence range, the satellite scenes used and the caveats. Your other places stay private.</div>
        </div>
      )}

      {isAnswer && tab === 'pdf' && (
        <div className="col" style={{ gap: 12 }}>
          <div className="caption">An A4 report with the answer, the maps, the confidence ranges, the satellite scenes used and the method.</div>
          <div className="row wrap" style={{ gap: 8 }}>
            {target.id
              ? <a className="btn btn-primary" href={api.shares.reportPdfUrl(target.id)} download><Ms n="download" />Download PDF</a>
              : <Btn variant="primary" icon="download" disabled>Download PDF</Btn>}
          </div>
        </div>
      )}

      {(!isAnswer || tab === 'data') && (
        <div className="row" style={{ gap: 12, padding: '10px 12px', borderRadius: 8, background: '#000', border: '1px solid var(--hair-soft)' }}>
          <Ms n="data_object" size={20} className="muted" />
          <div className="col grow"><span style={{ font: '600 14px/1.4 var(--font)' }}>GeoJSON</span><span className="tiny">{isAnswer ? 'The outline this answer is about, with its area' : 'The outline of this place, with its area'}</span></div>
          <Btn size="sm" icon="download" disabled={!target.id || busy === 'geo'} onClick={() => void downloadGeo()}>{busy === 'geo' ? 'Preparing…' : 'Download'}</Btn>
        </div>
      )}

      <div className="modal-foot"><Btn onClick={close}>Done</Btn></div>
    </Modal>
  );
}
