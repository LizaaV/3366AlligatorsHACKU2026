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
type Price = 'any' | 'free' | 'paid';

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
  const [price, setPrice] = useState<Price>('any');

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
      if (price !== 'any' && s.tier !== price) return false;
      if (needle && !`${s.name} ${s.short} ${s.sat} ${s.publisherName} ${category(s.categoryKey).name}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [skills, categories, category, cat, src, price, q, installed]);

  const official = filtered.filter((s) => s.official);
  const community = filtered.filter((s) => !s.official);
  const showOfficial = src !== 'community';
  const showCommunity = src !== 'official';
  const nothing = (!showOfficial || !official.length) && (!showCommunity || !community.length);

  const reset = () => { setQ(''); setSrc('all'); setPrice('any'); setCat(null); };

  return (
    <>
      <div className="page-head">
        <div style={{ maxWidth: 680 }}>
          <Eyebrow>Library</Eyebrow>
          <h1 className="h1" style={{ margin: '10px 0 0' }}>{t('library.title')}</h1>
          <p className="body-lg" style={{ margin: '10px 0 0' }}>{t('library.sub')}</p>
        </div>
        <Btn variant="primary" icon="construction" tier="free" onClick={() => go('library', 'new')}>Build a skill</Btn>
      </div>

      <div className="lib-toolbar">
        <label className="lib-search">
          <Ms n="search" />
          <input className="input" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search skills, satellites, developers" aria-label="Search skills" />
        </label>
        <div className="lib-segs">
          <Seg<Source> value={src} onChange={setSrc} label="Source" options={[['all', 'All'], ['official', 'Official'], ['community', 'Community'], ['installed', 'Installed']]} />
          <Seg<Price> value={price} onChange={setPrice} label="Price" options={[['any', 'Any price'], ['free', 'Free'], ['paid', 'Paid']]} />
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
          <Btn variant="primary" icon="construction" tier="free" onClick={() => go('library', 'new')}>Build a skill</Btn>
        </Empty>
      ) : (
        <>
          {showOfficial && (
            <Section
              title="Official · by Constellation"
              badge={<span className="lib-badge official"><Ms n="verified" />Verified</span>}
              line="Built and validated by Constellation. Accuracy tested on ground-truth plots."
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

/**
 * Category switcher: one horizontally scrolling row of cards.
 *
 * Click a card, swipe, or use the mouse wheel: a vertical wheel delta scrolls the row sideways
 * (only while the row still has room in that direction, so the page is never trapped). Cards
 * snap to the start edge, and the selected card is kept in view.
 */
function Hotbar({ cat, setCat }: { cat: number | null; setCat: React.Dispatch<React.SetStateAction<number | null>> }) {
  const { categories, skills } = useStore();
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });

  const measure = () => {
    const el = ref.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return; // already a sideways gesture
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const next = el.scrollLeft + e.deltaY;
      // At an end and pushing outward: let the page scroll as usual.
      if ((el.scrollLeft <= 0 && e.deltaY < 0) || (el.scrollLeft >= max - 1 && e.deltaY > 0)) return;
      e.preventDefault();
      el.scrollLeft = Math.max(0, Math.min(max, next));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => { el.removeEventListener('wheel', onWheel); ro.disconnect(); };
  }, [categories.length]);

  // Keep the selected card visible. Scroll only the row: scrollIntoView would move the page too.
  useEffect(() => {
    const bar = ref.current;
    const el = bar?.querySelector('.lib-cat.on') as HTMLElement | null;
    if (!bar || !el) return;
    const l = el.offsetLeft - bar.offsetLeft, r = l + el.offsetWidth;
    if (l < bar.scrollLeft) bar.scrollTo({ left: l - 8, behavior: 'smooth' });
    else if (r > bar.scrollLeft + bar.clientWidth) bar.scrollTo({ left: r - bar.clientWidth + 8, behavior: 'smooth' });
  }, [cat]);

  const page = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * Math.max(240, (ref.current?.clientWidth ?? 0) * 0.8), behavior: 'smooth' });
  const c = cat === null ? null : categories[cat];
  const count = (key: string) => skills.filter((x) => x.categoryKey === key).length;

  return (
    <div className="lib-catwrap">
      <div className="lib-catrail">
        <button className="lib-cat-arrow" aria-label="Scroll categories left" disabled={edge.start} onClick={() => page(-1)}><Ms n="chevron_left" className="ms-flip" /></button>
        <div className="lib-cats" ref={ref} role="tablist" aria-label="Categories" onScroll={measure}>
          <button className={`lib-cat ${cat === null ? 'on' : ''}`} onClick={() => setCat(null)} role="tab" aria-selected={cat === null}>
            <Ms n="apps" />
            <span className="nm">All categories</span>
            <span className="ct">{skills.length}</span>
          </button>
          {categories.map((k, i) => {
            const sel = cat === i;
            return (
              <button key={k.key} className={`lib-cat ${sel ? 'on' : ''}`} onClick={() => setCat(i)} role="tab" aria-selected={sel} style={sel ? { borderColor: k.color } : undefined}>
                <Ms n={k.icon} style={{ color: k.color }} />
                <span className="nm">{k.name}</span>
                <span className="ct">{count(k.key)}</span>
              </button>
            );
          })}
        </div>
        <button className="lib-cat-arrow" aria-label="Scroll categories right" disabled={edge.end} onClick={() => page(1)}><Ms n="chevron_right" className="ms-flip" /></button>
      </div>
      <div className="lib-hb-info">
        <div className="row">
          <span style={{ width: 10, height: 10, borderRadius: 2, background: c ? c.color : '#fff' }} />
          <span className="subhead">{c ? c.name : 'All categories'}</span>
        </div>
        <div className="body-sm">{c ? c.uses : 'Farms, water, forests, disasters, cities, oceans, air, finance and public good.'}</div>
        <div className="caption">
          {c ? <>Main free satellites: {c.sats}</> : 'Main free satellites: Sentinel-1/2/3/5P, Landsat, VIIRS, MODIS'}
          <span className="hide-mobile"> · Scroll or swipe the row, or use keys 0–9 and arrows</span>
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
