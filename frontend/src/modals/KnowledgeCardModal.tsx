/**
 * One knowledge card, in full.
 *
 * This is the document behind a claim: an answer says it used `pond_filling`, and this is what
 * `pond_filling` actually says. Until now the card ids were rendered as labels with nothing
 * behind them, which is the opposite of the point.
 *
 * `status` is shown prominently and honestly — a `draft` card has not been tested against known
 * cases, which is exactly why the runs contract caps confidence at Low while cards are drafts.
 */

import { useCallback } from 'react';
import { api } from '../api';
import { useStore } from '../state/store';
import { useResource } from '../hooks/useResource';
import { ErrorState, Skeleton } from '../components/async';
import { Markdown } from '../components/Markdown';
import { Modal, ModalHead, Ms } from '../components/ui';
import type { CardIndexEntry } from '../api/endpoints/knowledge';

const STATUS: Record<CardIndexEntry['status'], { label: string; hint: string; color: string }> = {
  draft: { label: 'Draft', hint: 'Not yet tested against known cases.', color: 'var(--amber)' },
  tested: { label: 'Tested', hint: 'Checked against a set of documented places.', color: 'var(--blue)' },
  reviewed: { label: 'Reviewed', hint: 'Tested and reviewed by a second person.', color: 'var(--green)' },
};

export function KnowledgeCardModal({ cardId }: { cardId: string }) {
  const { close } = useStore();
  const card = useResource(useCallback((signal) => api.knowledge.card(cardId, signal), [cardId]), [cardId]);
  const entry = card.data?.entry;
  const status = entry ? STATUS[entry.status] : null;

  return (
    <Modal size="wide" onClose={close} label="Knowledge card">
      <ModalHead
        eyebrow={entry ? (entry.type === 'event' ? 'Event card' : 'Setting card') : 'Knowledge card'}
        title={entry?.name ?? cardId}
        sub={entry?.summary}
        onClose={close}
      />

      {card.isLoading && <Skeleton lines={6} h={14} />}
      {card.error && <ErrorState error={card.error} onRetry={card.refetch} title="That card could not be opened" />}

      {card.data && entry && status && (
        <div className="col" style={{ gap: 14 }}>
          <div className="row wrap" style={{ gap: 10 }}>
            <span className="row tiny" style={{ gap: 6, color: status.color }}>
              <Ms n="verified" size={14} />
              {status.label}
            </span>
            <span className="tiny muted">v{entry.version}</span>
            <span className="tiny muted" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{entry.id}</span>
          </div>
          <div className="caption muted">{status.hint}</div>

          {entry.aliases && entry.aliases.length > 0 && (
            <div className="col" style={{ gap: 4 }}>
              <span className="eyebrow">Also called</span>
              <div className="row wrap" style={{ gap: 4 }}>
                {entry.aliases.slice(0, 12).map((a) => <span key={a} className="tag">{a}</span>)}
              </div>
            </div>
          )}

          <div style={{ borderTop: '1px solid var(--hair)', paddingTop: 12, maxHeight: '48vh', overflowY: 'auto' }}>
            <Markdown source={card.data.body_markdown} />
          </div>
        </div>
      )}
    </Modal>
  );
}
