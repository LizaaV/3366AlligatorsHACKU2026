import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { pts2 } from '../lib/geo';
import type { Category } from '../model';

export const Ms = ({ n, size, className = '', style }: { n: string; size?: number; className?: string; style?: React.CSSProperties }) => (
  <span className={`ms ${className}`} style={{ fontSize: size, ...style }} aria-hidden>
    {n}
  </span>
);

/** Free / paid marker. Every CTA that triggers work carries one. */
export const Tier = ({ tier, label }: { tier: 'free' | 'paid'; label?: string }) => (
  <span className={`tier tier-${tier}`}>
    {tier === 'paid' && <Ms n="bolt" />}
    {label ?? (tier === 'free' ? 'Free' : 'Paid')}
  </span>
);

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'text';
  size?: 'sm' | 'md' | 'lg';
  icon?: string;
  tier?: 'free' | 'paid';
  tierLabel?: string;
  trailing?: string;
};

export const Btn = ({ variant = 'ghost', size = 'md', icon, tier, tierLabel, trailing, className = '', children, ...rest }: BtnProps) => (
  <button className={`btn btn-${variant} ${size !== 'md' ? 'btn-' + size : ''} ${className}`} {...rest}>
    {icon && <Ms n={icon} />}
    {children}
    {tier && <Tier tier={tier} label={tierLabel} />}
    {trailing && <Ms n={trailing} />}
  </button>
);

export const IconBtn = ({ icon, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: string }) => (
  <button className={`icon-btn ${className}`} {...rest}>
    <Ms n={icon} />
  </button>
);

export const Toggle = ({ on, onClick, title }: { on: boolean; onClick: () => void; title?: string }) => (
  <button className={`toggle ${on ? 'on' : ''}`} onClick={onClick} title={title} role="switch" aria-checked={on}>
    <span />
  </button>
);

export const Check = ({ on }: { on: boolean }) => (
  <span className={`check ${on ? 'on' : ''}`}>
    <Ms n="check" style={{ opacity: on ? 1 : 0 }} />
  </span>
);

export const CatPill = ({ category }: { category: Category }) => (
  <span className="pill">
    <span className="dot" style={{ background: category.color }} />
    {category.name}
  </span>
);

export const Eyebrow = ({ category, children }: { category?: Category; children: ReactNode }) => (
  <div className="row">
    {category && <span className="sq" style={{ background: category.color }} />}
    <span className="eyebrow">{children}</span>
  </div>
);

export const ConfidenceBadge = ({ level, pct }: { level: 'High' | 'Medium' | 'Low'; pct?: number }) => {
  const c = level === 'High' ? 'var(--green)' : level === 'Medium' ? 'var(--yellow)' : 'var(--coral)';
  const bars = level === 'High' ? 3 : level === 'Medium' ? 2 : 1;
  return (
    <span className="pill" title="How sure the agent is about this result" style={{ background: 'var(--s2)' }}>
      <span style={{ display: 'inline-flex', gap: 2, alignItems: 'flex-end' }}>
        {[0, 1, 2].map((i) => (
          <span key={i} style={{ width: 3, height: 5 + i * 3, borderRadius: 1, background: i < bars ? c : 'var(--s3)' }} />
        ))}
      </span>
      <span className="ink">{level} confidence</span>
      {pct !== undefined && <span>· {pct}%</span>}
    </span>
  );
};

export function Modal({ children, onClose, size, label }: { children: ReactNode; onClose: () => void; size?: 'wide' | 'xwide'; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal aria-label={label} className={`modal ${size ?? ''}`} style={{ outline: 0 }}>
        {children}
      </div>
    </div>
  );
}

export const ModalHead = ({ eyebrow, title, sub, onClose }: { eyebrow: string; title: ReactNode; sub?: ReactNode; onClose: () => void }) => (
  <div className="modal-head">
    <div>
      <div className="eyebrow">{eyebrow}</div>
      <div className="h3" style={{ marginTop: 8 }}>{title}</div>
      {sub && <div className="body-sm" style={{ marginTop: 6 }}>{sub}</div>}
    </div>
    <IconBtn icon="close" className="sm" onClick={onClose} aria-label="Close" />
  </div>
);

/**
 * History chart: current series, confidence ribbon around it, and the 5-year historical band + mean
 * so every number is read against "what is normal here".
 */
export function HistoryChart({ series, band, mean, color, labels, height = 130, ci = 0.06, compact }: {
  series: number[]; band?: [number[], number[]]; mean?: number[]; color: string; labels?: string[]; height?: number; ci?: number; compact?: boolean;
}) {
  const W = 300, H = 100, P = 90;
  const x = (i: number, n: number) => ((i / (n - 1)) * W).toFixed(1);
  const y = (v: number) => (H - Math.max(0, Math.min(1.08, v)) * P).toFixed(1);
  const area = (lo: number[], hi: number[]) =>
    `M${hi.map((v, i) => `${x(i, hi.length)},${y(v)}`).join(' L')} L${lo.map((_, i) => `${x(lo.length - 1 - i, lo.length)},${y(lo[lo.length - 1 - i])}`).join(' L')} Z`;
  const ciLo = series.map((v) => v - ci);
  const ciHi = series.map((v) => v + ci);
  return (
    <div>
      <svg viewBox="0 0 300 110" width="100%" height={height} style={{ display: 'block', overflow: 'visible' }} role="img" aria-label="Trend with historical range">
        <line x1="0" y1="100" x2="300" y2="100" stroke="var(--hair-soft)" />
        <line x1="0" y1="55" x2="300" y2="55" stroke="var(--hair-soft)" strokeDasharray="3 4" />
        <line x1="0" y1="10" x2="300" y2="10" stroke="var(--hair-soft)" strokeDasharray="3 4" />
        {band && <path d={area(band[0], band[1])} fill="rgba(178,182,189,.09)" />}
        {mean && <polyline points={pts2(mean)} fill="none" stroke="var(--subtle)" strokeWidth="1.5" strokeDasharray="4 4" />}
        <path d={area(ciLo, ciHi)} fill={color} opacity="0.16" />
        <polyline points={pts2(series)} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        <circle cx="300" cy={y(series[series.length - 1])} r="3.5" fill={color} />
      </svg>
      {labels && (
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }} className="tiny">
          {labels.map((l) => <span key={l}>{l}</span>)}
        </div>
      )}
      {!compact && (
        <div className="row wrap" style={{ gap: 14, marginTop: 8, font: '500 12px/1.38 var(--font)', color: 'var(--muted)' }}>
          <span className="row" style={{ gap: 6 }}><span style={{ width: 12, height: 2, background: color }} />This year</span>
          <span className="row" style={{ gap: 6 }}><span style={{ width: 12, height: 8, background: color, opacity: 0.25, borderRadius: 2 }} />Confidence range</span>
          {mean && <span className="row" style={{ gap: 6 }}><span style={{ width: 12, height: 0, borderTop: '1.5px dashed var(--subtle)' }} />5-year average</span>}
          {band && <span className="row" style={{ gap: 6 }}><span style={{ width: 12, height: 8, background: 'var(--hair-faint)', borderRadius: 2 }} />5-year range</span>}
        </div>
      )}
    </div>
  );
}

/** Dry-zone ring overlay used on thumbnails of the North Pivot (from prototype dashboard card). */
export const RingOverlay = ({ size = 150 }: { size?: number }) => (
  <>
    <div style={{ position: 'absolute', left: '50%', top: '50%', width: size, height: size, margin: `-${size / 2}px 0 0 -${size / 2}px`, borderRadius: '50%', border: '1.5px solid #fff', background: 'rgba(20,198,203,.35)' }} />
    <div style={{
      position: 'absolute', left: '50%', top: '50%', width: size, height: size, margin: `-${size / 2}px 0 0 -${size / 2}px`, borderRadius: '50%',
      background: `radial-gradient(circle,transparent ${size * 0.3}px,rgba(255,207,37,.9) ${size * 0.367}px,rgba(187,90,0,.9) ${size * 0.42}px,rgba(255,207,37,.85) ${size * 0.473}px,transparent ${size * 0.5}px)`,
      WebkitMaskImage: 'conic-gradient(from 0deg,transparent 0deg,#000 18deg,#000 88deg,transparent 108deg)',
      maskImage: 'conic-gradient(from 0deg,transparent 0deg,#000 18deg,#000 88deg,transparent 108deg)',
    }} />
  </>
);

export const Empty = ({ icon, title, body, children }: { icon: string; title: string; body: string; children?: ReactNode }) => (
  <div className="card" style={{ padding: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10 }}>
    <Ms n={icon} size={32} className="muted" />
    <div className="subhead">{title}</div>
    <div className="body-sm" style={{ maxWidth: 420 }}>{body}</div>
    {children && <div className="row wrap" style={{ marginTop: 8, justifyContent: 'center' }}>{children}</div>}
  </div>
);

/** Hide an image that failed to load (offline, blocked tile server) instead of showing a broken icon. */
export const hideBroken = (e: React.SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.style.visibility = 'hidden';
};
