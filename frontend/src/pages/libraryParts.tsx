import { useState, type ReactNode } from 'react';
import { thumb } from '../lib/geo';
import { Btn, CatPill, Ms, hideBroken } from '../components/ui';
import { fmtRuns, slug } from '../lib/format';
import { useStore } from '../state/store';
import type { Skill } from '../model';

// slug and fmtRuns now live in lib/format.ts — slug previously existed in three places.
// Re-exported for existing importers; prefer importing from lib/format directly.
export { fmtRuns, slug };

/** Official = built by Constellation. Community = anyone else; "verified" means the publisher's identity is checked. */
export const PublisherBadge = ({ s }: { s: Pick<Skill, 'official' | 'verified'> }) =>
  s.official ? (
    <span className="lib-badge official" title="Built and validated by Constellation"><Ms n="verified" />Official</span>
  ) : (
    <span className="lib-badge community" title={s.verified ? 'Community skill from a verified publisher' : 'Community skill'}>
      <Ms n={s.verified ? 'verified_user' : 'groups'} />
      {s.verified ? 'Verified community' : 'Community'}
    </span>
  );

export function SkillCard({ s, installed, onOpen, delay = 0 }: { s: Skill; installed: boolean; onOpen: () => void; delay?: number }) {
  const { category } = useStore();
  return (
    <button className="lib-card" onClick={onOpen} style={{ animationDelay: `${delay}ms` }} aria-label={`${s.name} by ${s.publisherName}`}>
      <div className="lib-card-img">
        <img onError={hideBroken} src={thumb(s.reference?.lat ?? 0, s.reference?.lon ?? 0, 13)} alt="" loading="lazy" />
        <span className="lib-ref">Reference</span>
        {installed && <span className="lib-installed"><Ms n="check" />Installed</span>}
      </div>
      <div className="lib-card-body">
        <div className="row wrap" style={{ gap: 6 }}>
          <CatPill category={category(s.categoryKey)} />
        </div>
        <div className="lib-card-name">{s.name}</div>
        <div className="lib-sat"><Ms n="satellite_alt" />{s.sat}</div>
        <div className="body-sm">{s.short}</div>
        <div className="lib-card-stats">
          <span className="row" style={{ gap: 3 }}><span style={{ color: 'var(--yellow)' }}>★</span>{s.rating ? s.rating.toFixed(1) : 'New'}</span>
          {s.runs !== null && <><span className="subtle">·</span><span>{fmtRuns(s.runs)} runs</span></>}
          <span className="subtle">·</span>
          <span>v{s.version}</span>
        </div>
        <div className="lib-card-foot">
          <span className="row" style={{ gap: 4, minWidth: 0 }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>by {s.publisherName}</span>
            {s.official && <Ms n="verified" className="lib-v-official" />}
            {!s.official && s.verified && <Ms n="verified_user" className="lib-v-community" />}
          </span>
          <span className="open">Open<Ms n="open_in_full" /></span>
        </div>
      </div>
    </button>
  );
}

/** Very small JSON highlighter: keys, strings, numbers, booleans/null. */
export function JsonCode({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2);
  const out: ReactNode[] = [];
  const re = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      out.push(<span key={i++} className={m[2] ? 'k' : 's'}>{m[1]}</span>);
      if (m[2]) out.push(m[2]);
    } else if (m[3]) out.push(<span key={i++} className="n">{m[3]}</span>);
    else out.push(<span key={i++} className="b">{m[4]}</span>);
    last = re.lastIndex;
  }
  out.push(text.slice(last));
  return <pre className="lib-code" tabIndex={0} aria-label="Skill file JSON">{out}</pre>;
}

export function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      window.setTimeout(() => setDone(false), 1600);
    } catch {
      setDone(false);
    }
  };
  return <Btn size="sm" icon={done ? 'check' : 'content_copy'} onClick={copy}>{done ? 'Copied' : label}</Btn>;
}

export const StorageExplainer = () => (
  <div className="well lib-explain">
    <Ms n="database" size={20} />
    <div className="col" style={{ gap: 4 }}>
      <div className="ink" style={{ font: '600 14px/1.4 var(--font)' }}>How skills are stored</div>
      <div className="body-sm">
        Skills are saved on the server as JSON manifests: the modules, their settings and a version number, so a skill can be
        read and re-run the same way.
      </div>
    </div>
  </div>
);


