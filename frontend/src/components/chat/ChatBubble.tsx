/**
 * Floating chat on every page except Ask: a bubble in the bottom-left corner that expands into a
 * small chat panel. Context-aware (see chatContext.ts); in a place context, questions are about
 * that place. Its conversation is not filed into any project.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAskRun } from '../../ask/useAskRun';
import { useStore } from '../../state/store';
import { Ms } from '../ui';
import { Composer } from './Composer';
import { TurnView } from './TurnView';
import { ArtifactsContext } from '../artifacts/ArtifactsContext';
import { deriveArtifacts } from '../artifacts/artifacts';
import { contextFromRoute, contextHint, contextKey, contextPlaceId, contextSuggestions, setChatHandoff } from './chatContext';

export function ChatBubble() {
  const { route, places, watches, lang, go, t } = useStore();
  const ctx = contextFromRoute(route);
  const key = contextKey(ctx);
  const placeId = contextPlaceId(ctx) ?? (ctx.kind === 'trigger' && ctx.triggerId ? watches.find((w) => w.id === ctx.triggerId)?.placeId ?? null : null);
  const place = places.find((p) => p.id === placeId);

  const [expanded, setExpanded] = useState(false);
  const [q, setQ] = useState('');
  const run = useAskRun({ lang, selectedPlaceId: placeId });
  const { turns, last } = run;
  const scroll = useRef<HTMLDivElement>(null);

  // A new context is a new conversation.
  const lastKey = useRef(key);
  useEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    run.reset();
    setQ('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    scroll.current?.scrollTo({ top: scroll.current.scrollHeight, behavior: 'smooth' });
  }, [turns, last?.steps.length]);

  const send = (text: string) => {
    if (!text.trim()) return;
    setQ('');
    run.submit(text, { placeId });
  };

  // The bubble has no map or sidebar: its turns are words only, and a reference opens the full chat on that artifact.
  const artifacts = useMemo(() => deriveArtifacts(turns), [turns]);

  const openFull = (artifactId?: string) => {
    setChatHandoff({ turns, placeId, artifactId });
    setExpanded(false);
    go('ask', undefined, { place: placeId ?? 'none' });
  };

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        aria-label="Open chat"
        title="Ask Constellation"
        className="chat-bubble"
        style={{ position: 'fixed', left: 16, bottom: 20, zIndex: 85, width: 52, height: 52, borderRadius: '50%', background: '#fff', color: '#000', border: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 8px 28px rgba(0,0,0,.55)' }}
      >
        <Ms n="chat_bubble" size={24} />
        {last?.phase === 'running' && <span className="spinner" style={{ position: 'absolute', right: -2, top: -2 }} />}
      </button>
    );
  }

  return (
    <div
      role="dialog"
      aria-label="Chat"
      className="panel chat-bubble-panel"
      style={{ position: 'fixed', left: 16, bottom: 20, zIndex: 85, width: 'min(400px, calc(100vw - 32px))', height: 'min(560px, calc(100vh - 110px))', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      <div className="row" style={{ padding: '10px 10px 10px 16px', borderBottom: '1px solid var(--hair-soft)', gap: 8 }}>
        <div className="col grow">
          <span style={{ font: '600 14px/1.3 var(--font)' }}>Ask</span>
          <span className="tiny">{contextHint(ctx, place?.name)}</span>
        </div>
        <button className="btn btn-text btn-sm" onClick={() => openFull()} title="Continue in the full chat"><Ms n="open_in_full" />Open in full chat</button>
        <button className="icon-btn" onClick={() => setExpanded(false)} aria-label="Close chat"><Ms n="close" /></button>
      </div>

      <div ref={scroll} style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!turns.length && (
          <div className="col" style={{ gap: 6 }}>
            <div className="eyebrow" style={{ marginBottom: 4 }}>{t('chat.try')}</div>
            {contextSuggestions(ctx, place?.name).map((s) => (
              <button key={s} className="menu-item" style={{ color: 'var(--muted)' }} onClick={() => send(s)}>{s}</button>
            ))}
          </div>
        )}
        <ArtifactsContext.Provider value={{ artifacts, selectedId: null, select: openFull }}>
        {turns.map((turn) => (
          <TurnView
            key={turn.id}
            turn={turn}
            isLast={turn === last}
            places={places}
            onToggle={() => run.toggleOpen(turn.id)}
            onPick={(k, o) => run.setAnswerValue(turn.id, k, o)}
            onRemember={(r) => run.setRemember(turn.id, r)}
            onContinue={run.continueAfterClarify}
            onRetry={run.retry}
            onRunSkill={(id) => go('library', id)}
            onAskFollowup={send}
          />
        ))}
        </ArtifactsContext.Provider>
      </div>

      <div style={{ padding: 10 }}>
        <Composer
          compact
          autoFocus
          value={q}
          onChange={setQ}
          onSubmit={() => send(q)}
          busy={run.isBusy}
          placeholder={place ? `Ask about ${place.name}…` : t('chat.placeholder')}
          leading={
            <span className="pill" style={{ background: 'var(--s2)' }}>
              <Ms n={place ? 'pentagon' : 'public'} size={14} />
              {place ? place.name : 'General'}
            </span>
          }
        />
      </div>
    </div>
  );
}
