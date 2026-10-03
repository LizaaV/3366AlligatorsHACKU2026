import { useEffect, useRef, useState } from 'react';
import { href, useStore, type Page } from '../state/store';
import { Ms } from './ui';

const TABS: { page: Page; icon: string; key: string }[] = [
  { page: 'ask', icon: 'forum', key: 'nav.ask' },
  { page: 'places', icon: 'pentagon', key: 'nav.places' },
  { page: 'triggers', icon: 'notifications_active', key: 'nav.triggers' },
  { page: 'dashboard', icon: 'dashboard', key: 'nav.dashboard' },
  { page: 'library', icon: 'auto_stories', key: 'nav.library' },
];

/** The Big Dipper, star for star: handle Alkaid → Mizar → Alioth, then the bowl Megrez → Dubhe → Merak → Phecda. */
const DIPPER: [number, number][] = [[1, 3], [5.5, 2], [9, 3.5], [13, 5.5], [21, 3.5], [22, 10.5], [14, 11]];

export const BigDipper = ({ width = 30 }: { width?: number }) => (
  <svg width={width} height={(width * 14) / 24} viewBox="0 0 24 14" aria-hidden="true" style={{ flex: 'none', overflow: 'visible' }}>
    <polyline points={[...DIPPER, DIPPER[3]].map((p) => p.join(',')).join(' ')} fill="none" stroke="#fff" strokeOpacity={0.45} strokeWidth={0.8} />
    {DIPPER.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i >= 4 ? 1.5 : 1.25} fill="#fff" />)}
  </svg>
);

export const Logo = () => (
  <a href={href('ask')} className="row" style={{ gap: 10, font: '600 15px/1 var(--font)', color: '#fff' }} aria-label="Constellation home">
    <BigDipper />
    Constellation
  </a>
);

function useClickAway(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && close();
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open, close]);
  return ref;
}

function AccountMenu() {
  const { open, connectors } = useStore();
  const [show, setShow] = useState(false);
  const ref = useClickAway(show, () => setShow(false));
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button onClick={() => setShow((s) => !s)} aria-label="Account" style={{ width: 32, height: 32, borderRadius: '50%', border: '1px solid var(--hair)', background: 'var(--s2)', font: '600 13px/1 var(--font)' }}>
        MK
      </button>
      {show && (
        <div className="menu" style={{ right: 0, top: 42, width: 280 }}>
          <div className="menu-label eyebrow">Account</div>
          <div style={{ padding: '4px 10px 10px' }}>
            <div className="ink" style={{ font: '600 14px/1.4 var(--font)' }}>Your workspace</div>
          </div>
          <button className="menu-item" onClick={() => { setShow(false); open({ kind: 'connectors' }); }}>
            <Ms n="hub" />Connectors
            <span className="tiny" style={{ marginLeft: 'auto' }}>{Object.values(connectors).filter((c) => c.connected).length} on</span>
          </button>
        </div>
      )}
    </div>
  );
}

export function TopNav() {
  const { route, t } = useStore();
  return (
    <header style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 'var(--nav-h)', zIndex: 90, display: 'flex', alignItems: 'center', gap: 24, padding: '0 20px', background: '#000', borderBottom: '1px solid var(--hair-soft)' }}>
      <Logo />
      <nav className="hide-mobile" style={{ display: 'flex', gap: 4 }} aria-label="Main">
        {TABS.map((tb) => {
          const on = route.page === tb.page;
          return (
            <a key={tb.page} href={href(tb.page)} aria-current={on ? 'page' : undefined} className="row" style={{ gap: 6, padding: '8px 14px', borderRadius: 8, background: on ? 'var(--s2)' : 'transparent', color: on ? '#fff' : 'var(--muted)', font: '600 14px/1.29 var(--font)' }}>
              <Ms n={tb.icon} size={18} />
              {t(tb.key)}
            </a>
          );
        })}
      </nav>
      <div className="row" style={{ marginLeft: 'auto', gap: 6 }}>
        <AccountMenu />
      </div>
    </header>
  );
}

export function MobileTabs() {
  const { route, t } = useStore();
  return (
    <nav className="show-mobile" aria-label="Main" style={{ position: 'fixed', left: 0, right: 0, bottom: 0, height: 64, zIndex: 90, display: 'flex', background: '#000', borderTop: '1px solid var(--hair-soft)', paddingBottom: 'env(safe-area-inset-bottom)' }}>
      {TABS.map((tb) => {
        const on = route.page === tb.page;
        return (
          <a key={tb.page} href={href(tb.page)} aria-current={on ? 'page' : undefined} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, color: on ? '#fff' : 'var(--subtle)', font: '600 11px/1.3 var(--font)' }}>
            <Ms n={tb.icon} size={22} />
            {t(tb.key)}
          </a>
        );
      })}
    </nav>
  );
}

export function ToastHost() {
  const { toast, dismissToast } = useStore();
  if (!toast) return null;
  return (
    <div role="status" style={{ position: 'fixed', left: 0, right: 0, margin: '0 auto', width: 'max-content', maxWidth: 'calc(100vw - 32px)', top: 72, zIndex: 120, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 10px 10px 16px', borderRadius: 12, background: '#fff', color: '#000', font: '600 14px/1.4 var(--font)', animation: 'fadeUp .25s ease both' }}>
      <Ms n={toast.icon || 'check_circle'} size={18} />
      <span>{toast.text}</span>
      {toast.action && (
        <button onClick={() => { toast.fn?.(); dismissToast(); }} style={{ padding: '6px 12px', borderRadius: 8, background: '#000', color: '#fff', border: 0, font: '600 13px/1.29 var(--font)' }}>
          {toast.action}
        </button>
      )}
    </div>
  );
}
