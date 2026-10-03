import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../state/store';
import type { Skill } from '../model';
import { Btn, Empty, Eyebrow, Ms } from '../components/ui';
import { ErrorState, SkeletonCard } from '../components/async';
import { SkillCard } from './libraryParts';
import { SkillDetail } from './SkillDetail';
import { SkillBuilder } from './SkillBuilder';
import './library.css';

export function LibraryPage() {
  const { route } = useStore();
  return (
    <div className="page">
      <div className="page-inner">
        {route.id === 'new' ? <SkillBuilder key={route.query.from || 'blank'} /> : route.id ? <SkillDetail key={route.id} id={route.id} /> : <LibraryHome />}
      </div>
    </div>
  );
}

type Source = 'all' | 'official' | 'community' | 'installed';

const isTyping = (el: EventTarget | null) => {
  const n = el as HTMLElement | null;
  return !!n && (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable);
};

function LibraryHome() {
  const { t, go, skills, installed, modal, route, categories, category, loading, errors, reload } = useStore();
  const initialCat = route.query.cat !== undefined && /^[0-8]$/.test(route.query.cat) ? +route.query.cat : null;
  const [cat, setCat] = useState<number | null>(initialCat);
  const [q, setQ] = useState('');
  const [src, setSrc] = useState<Source>('all');

  // Keys 1–9 pick a block, 0 shows all, arrows step through (as in the prototype's Explore sheet).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (modal || isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[1-9]$/.test(e.key)) setCat(+e.key - 1);
      else if (e.key === '0') setCat(null);
      else if (e.key === 'ArrowRight') setCat((c) => (c === null ? 0 : (c + 1) % 9));
      else if (e.key === 'ArrowLeft') setCat((c) => (c === null ? 8 : (c + 8) % 9));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modal]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return skills.filter((s) => {
      if (cat !== null && s.categoryKey !== categories[cat]?.key) return false;
      if (src === 'installed' && !installed.includes(s.id)) return false;
      if (needle && !`${s.name} ${s.short} ${s.sat} ${s.publisherName} ${category(s.categoryKey).name}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [skills, categories, category, cat, src, q, installed]);

  const official = filtered.filter((s) => s.official);
  const community = filtered.filter((s) => !s.official);
  const showOfficial = src !== 'community';
  const showCommunity = src !== 'official';
  const nothing = (!showOfficial || !official.length) && (!showCommunity || !community.length);

  const reset = () => { setQ(''); setSrc('all'); setCat(null); };

  return (
    <>
      <div className="page-head">
        <div style={{ maxWidth: 680 }}>
          <Eyebrow>Library</Eyebrow>
          <h1 className="h1" style={{ margin: '10px 0 0' }}>{t('library.title')}</h1>
          <p className="body-lg" style={{ margin: '10px 0 0' }}>{t('library.sub')}</p>
        </div>
        <Btn variant="primary" icon="construction" onClick={() => go('library', 'new')}>Build a skill</Btn>
      </div>

      <div className="lib-toolbar">
        <label className="lib-search">
          <Ms n="search" />
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search skills, satellites, developers" aria-label="Search skills" />
        </label>
        <div className="lib-segs">
          <Seg<Source> value={src} onChange={setSrc} label="Source" options={[['all', 'All'], ['official', 'Official'], ['community', 'Community'], ['installed', 'Installed']]} />
        </div>
      </div>

      <Hotbar cat={cat} setCat={setCat} />

      {loading.skills ? (
        <div className="grid-cards" aria-busy="true" aria-label="Loading skills">
          {Array.from({ length: 6 }, (_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : errors.skills ? (
        <ErrorState error={errors.skills} onRetry={reload} title="Could not load the library" />
      ) : nothing ? (
        <Empty icon="search_off" title="No skills match" body="Try another category or clear the filters. You can also build the skill you need from modules.">
          <Btn icon="restart_alt" onClick={reset}>Clear filters</Btn>
          <Btn variant="primary" icon="construction" onClick={() => go('library', 'new')}>Build a skill</Btn>
        </Empty>
      ) : (
        <>
          {showOfficial && (
            <Section
              title="Official · by Constellation"
              badge={<span className="lib-badge official"><Ms n="verified" />Verified</span>}
              line="Built by Constellation."
              items={official}
              installed={installed}
              onOpen={(id) => go('library', id)}
            />
          )}
          {showCommunity && (
            <Section
              title="Community · by other developers"
              badge={<span className="lib-badge community"><Ms n="groups" />Community</span>}
              line="Shared by other teams. Check the accuracy notes before relying on them."
              items={community}
              installed={installed}
              onOpen={(id) => go('library', id)}
            />
          )}
        </>
      )}
    </>
  );
}

function Seg<T extends string>({ value, onChange, options, label }: { value: T; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map(([k, l]) => (
        <button key={k} className={value === k ? 'on' : ''} role="radio" aria-checked={value === k} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

function Hotbar({ cat, setCat }: { cat: number | null; setCat: React.Dispatch<React.SetStateAction<number | null>> }) {
  const { categories } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const lastSwitch = useRef(0);
  const swipe = useRef(0);

  // Sideways scrolling over the bar switches category — a trackpad swipe, or Shift + wheel on a
  // mouse. Up/down is left alone so the page scrolls normally (design review: "side to side, not
  // up and down"). Non-passive so the sideways gesture does not also scroll the bar or go back.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const n = categories.length;
    const onWheel = (e: WheelEvent) => {
      const dx = e.deltaX !== 0 ? e.deltaX : e.shiftKey ? e.deltaY : 0;
      // Mostly-vertical scrolling is the page's, not ours.
      if (!dx || (!e.shiftKey && Math.abs(e.deltaY) > Math.abs(dx))) return;
      e.preventDefault();
      // A trackpad swipe arrives as many small events: add them up so one swipe moves one step.
      swipe.current += dx;
      const now = Date.now();
      if (Math.abs(swipe.current) < 40 || now - lastSwitch.current < 250) return;
      const dir = swipe.current > 0 ? 1 : -1;
      swipe.current = 0;
      lastSwitch.current = now;
      setCat((c) => (c === null ? (dir > 0 ? 0 : n - 1) : (c + dir + n) % n));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setCat, categories.length]);

  // Keep the selected block visible when the bar scrolls (phones).
  useEffect(() => {
    // Scroll only the bar itself — scrollIntoView would also scroll the page.
    const bar = ref.current;
    const el = bar?.querySelector('.lib-hb.on') as HTMLElement | null;
    if (!bar || !el) return;
    const l = el.offsetLeft - bar.offsetLeft, r = l + el.offsetWidth;
    if (l < bar.scrollLeft) bar.scrollTo({ left: l - 8, behavior: 'smooth' });
    else if (r > bar.scrollLeft + bar.clientWidth) bar.scrollTo({ left: r - bar.clientWidth + 8, behavior: 'smooth' });
  }, [cat]);

  const c = cat === null ? null : categories[cat];

  return (
    <div className="lib-hotbar-row">
      <div className="lib-hotbar" ref={ref} role="tablist" aria-label="Categories">
        <button className={`lib-hb ${cat === null ? 'on' : ''}`} onClick={() => setCat(null)} title="All categories" role="tab" aria-selected={cat === null}
          style={{ color: cat === null ? '#fff' : undefined }}>
          <span className="n">0</span>
          <Ms n="apps" />
          <span className="bar" style={{ background: cat === null ? '#fff' : 'transparent' }} />
        </button>
        {categories.map((k, i) => {
          const sel = cat === i;
          return (
            <button key={k.key} className={`lib-hb ${sel ? 'on' : ''}`} onClick={() => setCat(i)} title={k.name} role="tab" aria-selected={sel} aria-label={k.name}
              style={{ color: sel ? k.color : undefined }}>
              <span className="n">{i + 1}</span>
              <Ms n={k.icon} />
              <span className="bar" style={{ background: sel ? k.color : 'transparent' }} />
            </button>
          );
        })}
      </div>
      <div className="lib-hb-info">
        <div className="row">
          <span style={{ width: 10, height: 10, borderRadius: 2, background: c ? c.color : '#fff' }} />
          <span className="subhead">{c ? c.name : 'All categories'}</span>
        </div>
        <div className="body-sm">{c ? c.uses : 'Farms, water, forests, disasters, cities, oceans, air, finance and public good.'}</div>
        <div className="caption">
          {c ? <>Main free satellites: {c.sats}</> : 'Main free satellites: Sentinel-1/2/3/5P, Landsat, VIIRS, MODIS'}
          <span className="hide-mobile"> · Click, swipe sideways or use ← → and 0–9 to switch</span>
        </div>
      </div>
    </div>
  );
}

function Section({ title, badge, line, items, installed, onOpen }: {
  title: string; badge: React.ReactNode; line: string; items: Skill[]; installed: string[]; onOpen: (id: string) => void;
}) {
  return (
    <section className="lib-section">
      <div className="lib-section-head">
        <div className="col" style={{ gap: 6 }}>
          <div className="row wrap" style={{ gap: 10 }}>
            <h2 className="h3" style={{ margin: 0 }}>{title}</h2>
            {badge}
          </div>
          <div className="body-sm">{line}</div>
        </div>
        <span className="caption">{items.length} skill{items.length === 1 ? '' : 's'}</span>
      </div>
      {items.length ? (
        <div className="lib-row">
          {items.map((s, i) => (
            <SkillCard key={s.id} s={s} installed={installed.includes(s.id)} onOpen={() => onOpen(s.id)} delay={Math.min(i, 6) * 40} />
          ))}
        </div>
      ) : (
        <div className="well body-sm" style={{ padding: 20 }}>Nothing here for these filters.</div>
      )}
    </section>
  );
}
