import { useState } from 'react';
import { useStore, type ExportTarget } from '../state/store';
import { api } from '../api';
import { Btn, Modal, ModalHead, Ms } from '../components/ui';
import { absoluteUrl, copyText, downloadRunReport, runActionError } from './runActions';

type Share = { slug: string; url: string; expires_at: string };

const fmtExpiry = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
};

/**
 * Export a finished run: a public share link (POST /api/runs/{id}/share) and the PDF report
 * (GET /api/runs/{id}/report.pdf). Those are the only exports the backend makes, so they are
 * the only ones offered. For an answer the target's `id` is the run id.
 */
export function ExportModal({ target }: { target: ExportTarget }) {
  const { close, notify } = useStore();
  const runId = target.kind === 'answer' ? target.id ?? null : null;
  const [share, setShare] = useState<Share | null>(null);
  const [busy, setBusy] = useState<'share' | 'pdf' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const createLink = async () => {
    if (!runId) return;
    setBusy('share');
    setError(null);
    try {
      const created = await api.runs.share(runId);
      const res = { ...created, url: absoluteUrl(created.url) };
      setShare(res);
      const copied = await copyText(res.url);
      notify(copied ? 'Share link created and copied' : 'Share link created', undefined, undefined, 'link');
    } catch (err) {
      setError(runActionError(err, 'share'));
    } finally {
      setBusy(null);
    }
  };

  const copy = async () => {
    if (!share) return;
    if (await copyText(share.url)) notify('Link copied', undefined, undefined, 'link');
    else notify('Copy failed: select the link and copy it', undefined, undefined, 'error');
  };

  const pdf = async () => {
    if (!runId) return;
    setBusy('pdf');
    setError(null);
    const msg = await downloadRunReport(runId);
    setBusy(null);
    if (msg) setError(msg);
    else notify('PDF report downloaded', undefined, undefined, 'download');
  };

  return (
    <Modal onClose={close} size="wide" label="Share and export">
      <ModalHead eyebrow="Share and export" title={target.title} sub={target.subtitle} onClose={close} />

      {!runId ? (
        <div className="sunk caption" style={{ padding: 12 }}>
          Share links and PDF reports are made from a finished answer. Ask a question about this place, then use Share on the answer.
        </div>
      ) : (
        <div className="col" style={{ gap: 18 }}>
          <div className="col" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 8 }}><Ms n="link" size={18} className="muted" /><span style={{ font: '600 14px/1.4 var(--font)' }}>Share link</span></div>
            {share ? (
              <>
                <div className="row" style={{ gap: 8 }}>
                  <input className="input" readOnly value={share.url} onFocus={(e) => e.target.select()} aria-label="Share link" />
                  <Btn variant="primary" icon="content_copy" onClick={() => void copy()}>Copy</Btn>
                </div>
                <span className="tiny">Anyone with the link can view a read-only copy until {fmtExpiry(share.expires_at)}.</span>
              </>
            ) : (
              <Btn variant="primary" icon="add_link" style={{ alignSelf: 'flex-start' }} disabled={busy !== null} onClick={() => void createLink()}>
                {busy === 'share' ? 'Creating link…' : 'Create share link'}
              </Btn>
            )}
            <div className="sunk caption" style={{ padding: 12 }}>
              A shared page shows the answer, the confidence, the satellite scenes used and the caveats. Your other places, notes and history stay private.
            </div>
          </div>

          <div className="col" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 8 }}><Ms n="picture_as_pdf" size={18} className="muted" /><span style={{ font: '600 14px/1.4 var(--font)' }}>PDF report</span></div>
            <span className="tiny">An A4 report with the answer, every chart and image, the caveats, and the method and sources behind it.</span>
            <Btn icon="download" style={{ alignSelf: 'flex-start' }} disabled={busy !== null} onClick={() => void pdf()}>
              {busy === 'pdf' ? 'Preparing…' : 'Download PDF'}
            </Btn>
          </div>

          {error && (
            <div role="alert" className="caption" style={{ padding: 10, borderRadius: 8, background: 'var(--s2)', border: '1px solid var(--hair-soft)', color: 'var(--coral)' }}>
              {error}
            </div>
          )}
        </div>
      )}
      <div className="modal-foot"><Btn onClick={close}>Done</Btn></div>
    </Modal>
  );
}
