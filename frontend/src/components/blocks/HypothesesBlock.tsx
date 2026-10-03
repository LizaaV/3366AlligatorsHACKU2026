/**
 * `hypotheses`: "what else could it be".
 *
 * Each candidate cause is shown with what the agent *expected* to see if it were true, what it
 * actually observed, and the verdict. This is the block that stops an answer being a guess with
 * a confident voice: the alternatives that were ruled out are on the page next to the one that
 * was not.
 *
 * `post_hoc` matters and is surfaced. A hypothesis registered *before* the data was read is
 * evidence; one invented afterwards to fit the data is a story, and the reader deserves to know
 * which they are looking at.
 */

import { BlockFrame } from './BlockFrame';
import { Ms } from '../ui';
import type { components } from '../../api/schema';

type S = components['schemas'];

const VERDICT: Record<S['HypothesisRow']['verdict'], { label: string; icon: string; color: string }> = {
  supported: { label: 'Supported', icon: 'check_circle', color: 'var(--green)' },
  contradicted: { label: 'Ruled out', icon: 'cancel', color: 'var(--subtle)' },
  unclear: { label: 'Unclear', icon: 'help', color: 'var(--amber)' },
  untested: { label: 'Not tested', icon: 'remove', color: 'var(--subtle)' },
};

export function HypothesesBlock({ block }: { block: S['HypothesesBlock'] }) {
  return (
    <BlockFrame title={block.title} caption={block.caption} primary={block.primary} provenance={block.provenance}>
      {block.post_hoc && (
        <div className="row tiny" style={{ gap: 6, color: 'var(--amber)' }}>
          <Ms n="info" size={14} />
          <span>These were considered after the measurements, not before.</span>
        </div>
      )}
      <div className="col" style={{ gap: 8 }}>
        {block.rows.map((r) => {
          const v = VERDICT[r.verdict];
          const measures = Object.keys({ ...r.expected, ...r.observed });
          return (
            <div
              key={r.card_id}
              className="col"
              style={{
                gap: 6,
                padding: '8px 10px',
                borderRadius: 8,
                background: r.verdict === 'supported' ? 'var(--s2)' : 'transparent',
                border: `1px solid ${r.verdict === 'supported' ? 'var(--hair)' : 'var(--hair-soft)'}`,
                opacity: r.verdict === 'contradicted' ? 0.72 : 1,
              }}
            >
              <div className="row" style={{ gap: 8 }}>
                <Ms n={v.icon} size={15} style={{ color: v.color }} />
                <span className="grow" style={{ font: '600 13px/1.38 var(--font)' }}>{r.label}</span>
                <span className="tiny" style={{ color: v.color, whiteSpace: 'nowrap' }}>{v.label}</span>
              </div>
              {r.reason && <span className="caption muted">{r.reason}</span>}
              {measures.length > 0 && (
                <table style={{ borderCollapse: 'collapse', width: '100%' }}>
                  <thead>
                    <tr className="tiny muted">
                      <th style={{ textAlign: 'left', fontWeight: 500, paddingRight: 8 }}>Measure</th>
                      <th style={{ textAlign: 'left', fontWeight: 500, paddingRight: 8 }}>Expected</th>
                      <th style={{ textAlign: 'left', fontWeight: 500 }}>Observed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {measures.map((m) => (
                      <tr key={m} className="tiny">
                        <td style={{ paddingRight: 8 }} className="muted">{m}</td>
                        <td style={{ paddingRight: 8 }}>{r.expected[m] ?? '—'}</td>
                        <td className="ink">{r.observed[m] ?? 'not measured'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>
    </BlockFrame>
  );
}
