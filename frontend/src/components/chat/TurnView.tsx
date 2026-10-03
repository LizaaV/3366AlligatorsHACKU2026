/** One question and its answer: the agent's steps, any clarification, the blocks and the answer card. */

import { ErrorState } from '../async';
import { Btn, Ms } from '../ui';
import { AnswerBlocks } from '../blocks';
import { AnswerCard } from '../../pages/AnswerCard';
import type { AskTurn } from '../../ask/useAskRun';
import type { Place } from '../../model';

export function TurnView({
  turn,
  isLast,
  places,
  onToggle,
  onPick,
  onRemember,
  onContinue,
  onRetry,
  onRunSkill,
  onAskFollowup,
  onPickScene,
  onCompare,
}: {
  turn: AskTurn;
  isLast: boolean;
  places: Place[];
  onToggle: () => void;
  onPick: (key: string, option: string) => void;
  onRemember: (remember: boolean) => void;
  onContinue: () => void;
  onRetry: () => void;
  onRunSkill: (id: string) => void;
  onAskFollowup: (q: string) => void;
  /** Move the map's pass cursor to the scene a timeline point names. */
  onPickScene: (scene: string) => void;
  /** Open the satellite comparison for this turn's blocks. */
  onCompare?: () => void;
}) {
  const place = places.find((x) => x.id === turn.placeId);
  const steps = turn.steps;
  // The step the server is on: the first one that has started but not finished.
  const current = steps.find((s) => !s.done) ?? steps[steps.length - 1];

  const label =
    turn.phase === 'clarify'
      ? 'Waiting for your answers'
      : turn.phase === 'error'
        ? 'Could not complete this'
        : turn.phase === 'running'
          ? `${current?.tool ?? 'Working'}…`
          : steps.length ? `Analyzed in ${steps.length} steps · ${((turn.durationMs ?? 0) / 1000).toFixed(1)}s` : 'Answered';

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="col" style={{ alignSelf: 'flex-end', alignItems: 'flex-end', maxWidth: '85%', gap: 4 }}>
        <div style={{ padding: '8px 12px', borderRadius: 8, background: 'var(--s2)', font: '500 14px/1.5 var(--font)' }}>{turn.text}</div>
        <span className="tiny">{place ? <>about <span className="muted">{place.name}</span></> : 'general question'}</span>
      </div>

      <div className="col">
        <button
          onClick={onToggle}
          className="row"
          style={{ gap: 8, padding: '4px 0', background: 'transparent', border: 0, color: 'var(--muted)', textAlign: 'left', font: '500 13px/1.38 var(--font)' }}
          aria-expanded={turn.open}
        >
          {turn.phase === 'running' ? (
            <>
              <span className="spinner" />
              <span className="shimmer-text" style={{ fontSize: 13 }}>{label}</span>
            </>
          ) : (
            <>
              <Ms
                n={turn.phase === 'done' ? 'check_circle' : turn.phase === 'error' ? 'error_outline' : 'help'}
                size={16}
              />
              <span>{label}</span>
            </>
          )}
          <Ms n={turn.open ? 'expand_less' : 'expand_more'} size={18} style={{ marginLeft: 'auto' }} />
        </button>

        {turn.open && (
          <div className="col" style={{ marginTop: 10 }}>
            {steps.map((st) => {
              const active = turn.phase === 'running' && !st.done;
              return (
                <div key={st.index} className="row" style={{ gap: 10, alignItems: 'stretch', animation: 'fadeUp .35s ease both' }}>
                  <div className="col" style={{ alignItems: 'center', width: 18, flex: 'none' }}>
                    {active && <span className="spinner" style={{ marginTop: 4 }} />}
                    {st.done && (
                      <Ms
                        n={st.error ? 'error_outline' : 'check_circle'}
                        size={18}
                        className="muted"
                        style={{ marginTop: 2, color: st.error ? 'var(--amber, currentColor)' : undefined }}
                      />
                    )}
                    <div style={{ flex: 1, width: 1, background: 'var(--hair)', margin: '4px 0', minHeight: 10 }} />
                  </div>
                  <div className="grow" style={{ paddingBottom: 12 }}>
                    {active ? (
                      <div className="shimmer-text" style={{ font: '600 14px/1.5 var(--font)' }}>{st.tool}</div>
                    ) : (
                      <div style={{ font: '600 14px/1.5 var(--font)' }}>{st.tool}</div>
                    )}
                    <div className="caption" style={{ marginTop: 2 }}>
                      <span className="muted">{st.title}:</span> {st.desc}
                    </div>
                    {st.done && st.result && <div className="tag" style={{ marginTop: 6 }}>{st.result}</div>}
                    {st.error && <div className="caption" style={{ marginTop: 6, color: 'var(--subtle)' }}>{st.error}</div>}
                  </div>
                </div>
              );
            })}

            {/* The agent asks for details itself now, rather than the frontend guessing which
                questions to ask. Answers are prefilled from the place's memory where it has any. */}
            {turn.clarification && isLast && (
              <div className="col" style={{ marginTop: 4, padding: 14, borderRadius: 12, background: 'var(--s2)', border: '1px solid var(--hair)', gap: 12 }}>
                <div className="caption">A few details make the answer much better.</div>
                {turn.clarification.questions.map((g) => (
                  <div key={g.key} className="col" style={{ gap: 6 }}>
                    <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      <span style={{ font: '600 13px/1.38 var(--font)' }}>{g.label}</span>
                      {g.source?.from === 'memory' && (
                        <span className="tiny" style={{ padding: '1px 6px', borderRadius: 4, background: 'var(--s3)' }}>
                          From memory{g.source.saved ? ` · ${g.source.saved}` : ''}
                        </span>
                      )}
                    </div>
                    <div className="row wrap" style={{ gap: 6 }}>
                      {(g.options ?? []).map((o) => (
                        <button
                          key={o}
                          className={`chip ${turn.answers[g.key] === o ? 'on' : ''}`}
                          style={{ padding: '4px 10px' }}
                          onClick={() => onPick(g.key, o)}
                        >
                          {o}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
                <label className="row tiny" style={{ gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={turn.remember} onChange={(e) => onRemember(e.target.checked)} />
                  Remember these answers for this place
                </label>
                <Btn variant="primary" style={{ alignSelf: 'flex-start' }} onClick={onContinue} tier="free">Continue</Btn>
              </div>
            )}
          </div>
        )}
      </div>

      {/* A refusal or a narrowed scope is the agent's decision, so it is shown as such. */}
      {turn.guard && (
        <div className="col" style={{ padding: 12, borderRadius: 10, background: 'var(--s2)', border: '1px solid var(--hair)', gap: 4 }}>
          <div className="row" style={{ gap: 6 }}>
            <Ms n="shield" size={16} className="muted" />
            <span style={{ font: '600 13px/1.38 var(--font)' }}>
              {turn.guard.scope === 'not_allowed' ? 'This is something the agent will not do' : `Scope: ${turn.guard.scope.replace(/_/g, ' ')}`}
            </span>
          </div>
          {turn.guard.reason && <div className="caption">{turn.guard.reason}</div>}
        </div>
      )}

      {/* A *recoverable* stream error is a notice: the run carries on after it. A fatal one is
          followed by done{status: "failed"}, and its message becomes the error card's — showing
          the server's own explanation instead of a generic "something went wrong". */}
      {turn.streamError?.recoverable && turn.phase !== 'error' && (
        <div className="caption" style={{ padding: 10, borderRadius: 8, background: 'var(--s2)', border: '1px solid var(--hair-soft)' }}>
          {turn.streamError.message}
        </div>
      )}

      {/* Rendered from the turn, not the answer, so each block appears the moment its
          `block_ready` event arrives rather than all at once when the run finishes. The answer
          carries the same objects, so a reloaded run shows exactly the same visuals. */}
      <AnswerBlocks blocks={turn.blocks} onPickScene={onPickScene} />

      {turn.phase === 'error' && (
        <ErrorState
          error={turn.error}
          message={turn.streamError?.message}
          onRetry={isLast ? onRetry : undefined}
          title="The agent could not answer"
        />
      )}

      {onCompare && turn.phase === 'done' && turn.blocks.length > 0 && (
        <button className="btn btn-text btn-sm" style={{ alignSelf: 'flex-start' }} onClick={onCompare}>
          <Ms n="compare" />What each satellite saw
        </button>
      )}

      {turn.answer && turn.phase !== 'running' && (
        <AnswerCard
          answer={turn.answer}
          question={turn.text}
          placeId={turn.placeId}
          onRunSkill={onRunSkill}
          onAskFollowup={isLast ? onAskFollowup : undefined}
        />
      )}
    </div>
  );
}
