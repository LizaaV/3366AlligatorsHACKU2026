/** The LOCATE / OUTLINE / DETAILS rail at the top of the wizard. */

import { Ms } from '../../components/ui';

export function Steps({ step }: { step: number }) {
  const items = ['Locate', 'Outline', 'Details'];
  return (
    <div className="row" style={{ gap: 0 }} aria-label={`Step ${step} of 3`}>
      {items.map((l, i) => {
        const n = i + 1, done = n < step, on = n === step;
        return (
          <div key={l} className="row" style={{ gap: 8, flex: i < 2 ? 1 : 'none' }}>
            <span style={{
              width: 24, height: 24, borderRadius: '50%', flex: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              font: '600 12px/1 var(--font)', background: on || done ? '#fff' : 'transparent', color: on || done ? '#000' : 'var(--subtle)',
              border: on || done ? '1px solid #fff' : '1px solid var(--hair)',
            }}>
              {done ? <Ms n="check" size={14} /> : n}
            </span>
            <span className={`eyebrow ${on ? '' : 'hide-mobile'}`} style={{ color: on ? 'var(--ink)' : done ? 'var(--muted)' : 'var(--subtle)' }}>{l}</span>
            {i < 2 && <span style={{ flex: 1, height: 1, minWidth: 12, margin: '0 12px', background: done ? 'var(--muted)' : 'var(--hair-soft)' }} />}
          </div>
        );
      })}
    </div>
  );
}
