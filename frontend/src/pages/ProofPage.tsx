/**
 * Public page behind a share link: `<origin>/proof/<slug>`.
 *
 * Whoever receives the link sees a read-only snapshot of one answer — the question, the
 * answer, its visuals and the PDF report — without an account or the rest of the app.
 * Data comes from `GET /api/shares/{slug}`; an expired or revoked link answers 410.
 */

import { useCallback } from 'react';
import { API_BASE, ApiError } from '../api';
import { request } from '../api/http';
import type { components } from '../api/schema';
import { useResource } from '../hooks/useResource';
import { toAnswer } from '../model';
import { AnswerBlocks } from '../components/blocks';
import { Ms } from '../components/ui';
import { Logo } from '../components/Shell';

type SharedRun = components['schemas']['SharedRun'];

/** The slug when the page was opened on a share link, else null. */
export const proofSlug = (path = window.location.pathname): string | null => {
  const m = path.match(/^\/proof\/([A-Za-z0-9_-]+)\/?$/);
  return m ? m[1] : null;
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function ProofPage({ slug }: { slug: string }) {
  const shared = useResource(
    useCallback((signal) => request<SharedRun>({ method: 'GET', path: `/shares/${encodeURIComponent(slug)}`, signal }), [slug]),
    [slug],
  );

  const gone = shared.error instanceof ApiError && (shared.error.status === 410 || shared.error.status === 404);
  const run = shared.data;
  const answer = run?.answer ? toAnswer(run.answer) : null;
  const blocks = run?.blocks?.length ? run.blocks : answer?.blocks ?? [];
  const pdf = `${API_BASE}/shares/${encodeURIComponent(slug)}/report.pdf`;

  return (
    <div style={{ position: 'fixed', inset: 0, overflowY: 'auto', background: 'var(--canvas)' }}>
      <header className="row" style={{ height: 'var(--nav-h)', padding: '0 20px', borderBottom: '1px solid var(--hair-soft)' }}>
        <Logo />
        <span className="tiny" style={{ marginLeft: 'auto' }}>Shared answer</span>
      </header>

      <main className="col" style={{ maxWidth: 760, margin: '0 auto', padding: '32px 16px 64px', gap: 20 }}>
        {shared.isLoading && <div className="caption"><span className="spinner" /> Loading the shared answer…</div>}

        {shared.error && (
          <div className="panel col" style={{ padding: 24, gap: 8 }}>
            <Ms n={gone ? 'link_off' : 'error_outline'} size={28} className="muted" />
            <div className="subhead">{gone ? 'This link has expired or was turned off' : 'The shared answer could not be loaded'}</div>
            <div className="caption">{gone ? 'Ask the person who sent it for a new link.' : 'Check your connection and try again.'}</div>
            {!gone && <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start' }} onClick={shared.refetch}>Try again</button>}
          </div>
        )}

        {run && (
          <>
            <div className="col" style={{ gap: 6 }}>
              <span className="eyebrow muted">
                {run.area?.name ? `${run.area.name} · ` : ''}asked {fmtDate(run.created_at)}
              </span>
              <h1 style={{ margin: 0, font: '600 28px/1.2 var(--font)', letterSpacing: -0.6 }}>{run.question}</h1>
            </div>

            {answer && (
              <div className="panel col" style={{ padding: 20, gap: 10 }}>
                <div style={{ font: '600 22px/1.2 var(--font)', letterSpacing: -0.4 }}>{answer.title}</div>
                <div className="body-sm" style={{ fontSize: 15, lineHeight: 1.6 }}>{answer.sentence}</div>
                {answer.finding && <div className="body-sm"><span className="muted">{answer.findingLabel}: </span>{answer.finding}</div>}
                {answer.action && <div className="body-sm"><span className="muted">{answer.actionLabel}: </span>{answer.action}</div>}
                <div className="tiny">Confidence: {answer.confidence.level} · {answer.confidence.pct}%</div>
              </div>
            )}

            <AnswerBlocks blocks={blocks} />

            <div className="row wrap" style={{ gap: 8 }}>
              <a className="btn btn-primary" href={pdf} download><Ms n="picture_as_pdf" />Download PDF report</a>
              <a className="btn btn-ghost" href="/"><Ms n="public" />Open Constellation</a>
            </div>
            <div className="tiny">Snapshot taken {fmtDate(run.shared_at)} · link valid until {fmtDate(run.expires_at)}</div>
          </>
        )}
      </main>
    </div>
  );
}
