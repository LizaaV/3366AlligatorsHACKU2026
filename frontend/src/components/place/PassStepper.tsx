/**
 * PassStepper: a compact inline timeline of the dates the ground was seen, shown inside the
 * chat thread when the user picks "Step through satellite passes".
 *
 * Play/pause, previous/next, the current date, and a dot per pass (cloudy ones hollow).
 * The parent owns `index`; this component only owns the play timer.
 */

import { useEffect, useRef, useState } from 'react';
import { Ms } from '../ui';
import type { PassTimeline } from '../../model';

const STEP_MS = 1100;

export function PassStepper({
  timeline,
  index,
  onChange,
}: {
  timeline: PassTimeline;
  index: number;
  onChange: (i: number) => void;
}) {
  const [playing, setPlaying] = useState(false);
  const n = timeline.dates.length;
  const idx = Math.min(Math.max(index, 0), Math.max(n - 1, 0));
  const cloudy = new Set(timeline.cloudyIndices);

  // Keep the latest values in a ref so the interval never restarts mid-play.
  const live = useRef({ idx, n, onChange });
  live.current = { idx, n, onChange };

  useEffect(() => {
    if (!playing) return;
    const t = window.setInterval(() => {
      const { idx: i, n: len, onChange: set } = live.current;
      if (i >= len - 1) setPlaying(false);
      else set(i + 1);
    }, STEP_MS);
    return () => window.clearInterval(t);
  }, [playing]);

  if (n === 0) return <div className="tiny">No passes to step through yet.</div>;

  const go = (i: number) => {
    setPlaying(false);
    onChange(Math.min(Math.max(i, 0), n - 1));
  };
  const toggle = () => {
    if (!playing && idx >= n - 1) onChange(0);
    setPlaying((p) => !p);
  };

  return (
    <div
      className="panel"
      style={{ padding: 10, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 420 }}
      role="group"
      aria-label="Step through passes"
    >
      <div className="row" style={{ gap: 6, alignItems: 'center' }}>
        <button
          type="button"
          onClick={toggle}
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause' : 'Play'}
          style={{ width: 32, height: 32, flex: 'none', borderRadius: 8, background: '#fff', color: '#000', border: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <Ms n={playing ? 'pause' : 'play_arrow'} size={20} />
        </button>
        <button type="button" className="icon-btn" onClick={() => go(idx - 1)} disabled={idx === 0} aria-label="Previous pass" title="Previous pass">
          <Ms n="chevron_left" size={20} />
        </button>
        <button type="button" className="icon-btn" onClick={() => go(idx + 1)} disabled={idx >= n - 1} aria-label="Next pass" title="Next pass">
          <Ms n="chevron_right" size={20} />
        </button>
        <div className="col" style={{ marginLeft: 4, minWidth: 0 }}>
          <span style={{ font: '600 13px/1.3 var(--font)' }} aria-live="polite">{timeline.dates[idx]}</span>
          <span className="tiny">
            Pass {idx + 1} of {n}
            {cloudy.has(idx) ? ' · mostly cloudy' : ''}
          </span>
        </div>
      </div>

      <div className="row" style={{ gap: 6, overflowX: 'auto', padding: '2px 0' }} role="tablist" aria-label="Passes">
        {timeline.dates.map((d, i) => {
          const isCloudy = cloudy.has(i);
          const current = i === idx;
          return (
            <button
              key={`${d}-${i}`}
              type="button"
              role="tab"
              aria-selected={current}
              aria-label={`${d}${isCloudy ? ', cloudy' : ''}`}
              title={`${d}${isCloudy ? ' · mostly cloudy' : ''}`}
              onClick={() => go(i)}
              style={{
                flex: 'none',
                width: current ? 14 : 10,
                height: current ? 14 : 10,
                padding: 0,
                borderRadius: '50%',
                background: isCloudy ? 'transparent' : current ? '#fff' : 'var(--cyan)',
                border: `1.5px solid ${isCloudy ? 'var(--subtle)' : current ? '#fff' : 'var(--cyan)'}`,
                outline: current ? '2px solid rgba(255,255,255,.35)' : 'none',
                outlineOffset: 2,
              }}
            />
          );
        })}
      </div>
      {cloudy.size > 0 && (
        <span className="tiny row" style={{ gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', border: '1.5px solid var(--subtle)' }} />
          cloudy pass, harder to read
        </span>
      )}
    </div>
  );
}
