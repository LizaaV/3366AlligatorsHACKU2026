/**
 * The opening screen: the Earth fills the window with the live satellites going round it.
 * Press any key (or tap anywhere, on a phone) to go to the app. Picking a place happens after,
 * in the app; tapping here only starts.
 */

import { useEffect, useState } from 'react';
import { BigDipper } from './Shell';

export function Splash({ onContinue }: { onContinue: () => void }) {
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const t = window.setInterval(() => setClock(new Date()), 1000);
    const key = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      onContinue();
    };
    window.addEventListener('keydown', key);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('keydown', key);
    };
  }, [onContinue]);

  const utc = clock.toISOString().slice(11, 19);
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 40, pointerEvents: 'none', animation: 'fadeIn .8s ease both' }}>
      <div className="row" style={{ position: 'absolute', top: 24, left: 28, gap: 10, font: '600 15px/1 var(--font)', color: '#fff' }}>
        <BigDipper />
        Constellation
      </div>
      <div className="row" style={{ position: 'absolute', top: 26, right: 28, gap: 8, font: '500 12px/1 var(--font)', color: 'var(--muted)' }}>
        <span className="dot" style={{ background: 'var(--green)', animation: 'pulse 2s ease infinite' }} />
        Live orbits · {utc} UTC
      </div>
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 'max(48px, 9vh)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center', padding: '0 24px' }}>
        <div className="display" style={{ fontSize: 'clamp(34px, 5vw, 64px)' }}>Ask the planet a question.</div>
        <div className="body-lg" style={{ maxWidth: 560, color: 'var(--muted)' }}>
          Free satellites pass over every place on Earth every few days. Pick one and ask what changed.
        </div>
        <div className="row wrap" style={{ gap: 10, justifyContent: 'center', marginTop: 6 }}>
          <span className="pill" style={{ background: 'rgba(255,255,255,.08)' }}>
            Press <kbd style={{ font: '600 12px/1 var(--font)', padding: '2px 6px', borderRadius: 4, background: 'rgba(255,255,255,.16)' }}>any key</kbd> to start
          </span>
        </div>
      </div>
    </div>
  );
}
