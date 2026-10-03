/**
 * "Ask your watches" bar, used on the watches overview and on a single watch.
 *
 * Was defined inside `pages/WatchDetail.tsx` and imported by `pages/WatchesPage.tsx` — a page
 * importing shared infrastructure from another page. It also faked a 1.8s think and received
 * several paragraphs of hardcoded findings from each caller. Now it calls
 * `POST /ask/insights` and plays a prewritten progress script while waiting.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, toApiError } from '../api';
import type { InsightDto } from '../api/types';
import { useStore } from '../state/store';
import { pickProgressScript, type ProgressScript } from '../ask/progressScripts';
import { Btn, Ms } from './ui';
import { ErrorState } from './async';

export function AskBar({
  placeholder,
  suggestions,
  scope,
  watchId,
  onExport,
  onExpert,
}: {
  placeholder: string;
  suggestions: string[];
  scope: 'watches' | 'watch';
  watchId?: string;
  onExport: (a: InsightDto) => void;
  onExpert: (a: InsightDto) => void;
}) {
  const { lang } = useStore();
  const [q, setQ] = useState('');
  const [pending, setPending] = useState(false);
  const [script, setScript] = useState<ProgressScript | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [answer, setAnswer] = useState<InsightDto | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const ticker = useRef<number | undefined>(undefined);
  const lastQuestion = useRef('');

  useEffect(
    () => () => {
      inflight.current?.abort();
      window.clearInterval(ticker.current);
    },
    [],
  );

  const ask = useCallback(
    async (text?: string) => {
      const question = (text ?? q).trim() || suggestions[0];
      lastQuestion.current = question;
      inflight.current?.abort();
      const ac = new AbortController();
      inflight.current = ac;

      // Prewritten choreography while the request is in flight; holds on the last step.
      const chosen = pickProgressScript(script?.id);
      setScript(chosen);
      setStepIndex(0);
      setPending(true);
      setAnswer(null);
      setError(null);
      window.clearInterval(ticker.current);
      ticker.current = window.setInterval(
        () => setStepIndex((i) => Math.min(i + 1, chosen.steps.length - 1)),
        700,
      );

      try {
        const res = await api.insights.ask({ question, scope, watchId, lang }, ac.signal);
        if (ac.signal.aborted) return;
        setAnswer(res);
        setQ('');
      } catch (err) {
        if (ac.signal.aborted) return;
        const e = toApiError(err);
        if (e.kind === 'aborted') return;
        setError(e);
      } finally {
        if (!ac.signal.aborted) {
          window.clearInterval(ticker.current);
          setPending(false);
        }
      }
    },
    [lang, q, scope, script?.id, suggestions, watchId],
  );

  const current = script?.steps[stepIndex];

  return (
    <div className="col" style={{ gap: 12 }}>
      <div
        className="row"
        style={{ gap: 12, padding: '8px 8px 8px 16px', background: 'var(--s1)', border: '1px solid var(--hair)', borderRadius: 'var(--r-lg)' }}
      >
        <Ms n="forum" size={20} className="muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !pending && void ask()}
          placeholder={placeholder}
          aria-label={placeholder}
          style={{ flex: 1, minWidth: 0, height: 40, background: 'transparent', border: 0, outline: 0, color: '#fff', font: '500 16px/1.5 var(--font)' }}
        />
        <Btn variant="primary" onClick={() => void ask()} disabled={pending}>
          Ask
        </Btn>
      </div>

      <div className="row wrap">
        {suggestions.map((s) => (
          <button key={s} className="chip" disabled={pending} onClick={() => void ask(s)}>
            {s}
          </button>
        ))}
      </div>

      {pending && current && (
        <div className="card col" style={{ padding: '20px 24px', gap: 8 }} aria-busy="true">
          <div className="row" style={{ gap: 10 }}>
            <span className="spinner" />
            <span className="shimmer-text" style={{ font: '600 14px/1.4 var(--font)' }}>
              {current.tool}
            </span>
          </div>
          <div className="caption" style={{ paddingLeft: 22 }}>
            {current.desc}
          </div>
        </div>
      )}

      {error && !pending && <ErrorState error={error} onRetry={() => void ask(lastQuestion.current)} title="Could not answer that" />}

      {answer && !pending && (
        <div className="card fade-up col" style={{ padding: 24, gap: 12 }}>
          <div className="row wrap">
            {answer.basis.map((b) => (
              <span key={b} className="tag">
                <Ms n="check" />
                {b}
              </span>
            ))}
          </div>
          <div className="subhead">{answer.title}</div>
          <div className="body" style={{ maxWidth: 860 }}>
            {answer.body}
          </div>
          <div className="row wrap" style={{ marginTop: 4 }}>
            <Btn size="sm" icon="ios_share" tier="free" onClick={() => onExport(answer)}>
              Export
            </Btn>
            <Btn size="sm" variant="text" icon="support_agent" tier="paid" tierLabel="from $49" onClick={() => onExpert(answer)}>
              Ask an expert
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}
