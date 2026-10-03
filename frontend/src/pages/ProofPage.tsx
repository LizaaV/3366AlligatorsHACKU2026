/**
 * The public page behind a share link: `/proof/<slug>` (the URL `POST /api/runs/{id}/share`
 * returns). Read-only, no login: the question, the answer, its evidence blocks and the PDF.
 */

import { useCallback } from 'react';
import { api } from '../api';
import type { SharedRun } from '../api';
import { useResource } from '../hooks/useResource';
import { toAnswer, type AnswerBlock } from '../model';
import { AnswerBlocks } from '../components/blocks';
import { ErrorState } from '../components/async';
import { Logo } from '../components/Shell';
import { Ms } from '../components/ui';
import { AnswerCard } from './AnswerCard';

/** The slug when the page was opened at `/proof/<slug>`, else null. */
export const proofSlug = (path = window.location.pathname): string | null => {
  const m = /^\/proof\/([A-Za-z0-9_-]{4,128})\/?$/.exec(path);
  return m ? m[1] : null;
};

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function ProofPage({ slug }: { slug: string }) {
  const res = useResource(useCallback((signal: AbortSignal) => api.shares.get(slug, signal), [slug]), [slug]);
  const run: SharedRun | undefined = res.data;

  return (
    <div style={{ minHeight: '100vh', background: '#000' }}>
      <header className="row" style={{ height: 56, padding: '0 20px', borderBottom: '1px solid var(--hair-soft)', gap: 16 }}>
        <Logo />
        <span className="tiny muted" style={{ marginLeft: 'auto' }}>Shared result · read only</span>
      </header>
      <main style={{ maxWidth: 760, margin: '0 auto', padding: '32px 16px 64px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {res.error && (
          <ErrorState
            error={res.error}
            title={res.error.status === 410 ? 'This link has expired' : 'This shared result could not be opened'}
            message={res.error.status === 410 ? 'The owner revoked it, or it is past its expiry date.' : undefined}
          />
        )}
        {!run && !res.error && <div className="caption">Loading…</div>}
        {run && (
          <>
            <div className="col" style={{ gap: 6 }}>
              <div className="eyebrow muted">{run.area?.name ?? 'A place on Earth'} · asked {fmtDate(run.created_at)}</div>
              <h1 className="h3" style={{ margin: 0 }}>{run.question}</h1>
              <div className="row wrap" style={{ gap: 8 }}>
                <a className="btn btn-sm" href={api.shares.reportUrl(slug)} download>
                  <Ms n="picture_as_pdf" />PDF report
                </a>
                <span className="tiny muted">Link expires {fmtDate(run.expires_at)}</span>
              </div>
            </div>
            <AnswerBlocks blocks={run.blocks as AnswerBlock[]} onPickScene={() => undefined} />
            {run.answer && (
              <AnswerCard answer={toAnswer(run.answer)} question={run.question} placeId={null} onRunSkill={() => undefined} />
            )}
            <div className="caption muted" style={{ borderTop: '1px solid var(--hair-soft)', paddingTop: 14 }}>
              Made with Constellation from free satellite data. Not an official assessment.{' '}
              <a href="/" style={{ color: '#fff' }}>Ask your own question</a>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
