import { useState, type ReactNode } from 'react';
import { thumb } from '../lib/geo';
import { Btn, CatPill, Ms, hideBroken } from '../components/ui';
import { skillStatus } from '../data/presentation';
import { fmtRuns, slug } from '../lib/format';
import { useStore } from '../state/store';
import type { Skill } from '../model';

// slug and fmtRuns now live in lib/format.ts — slug previously existed in three places.
// Re-exported for existing importers; prefer importing from lib/format directly.
export { fmtRuns, slug };

/** Official = built by Constellation. Community = anyone else; "verified" means the publisher's identity is checked. */
export const PublisherBadge = ({ s }: { s: Pick<Skill, 'official' | 'verified'> }) =>
  s.official ? (
    <span className="lib-badge official" title="Built by the Constellation team"><Ms n="verified" />Official</span>
  ) : (
    <span className="lib-badge community" title={s.verified ? 'Community skill from a verified publisher' : 'Community skill'}>
      <Ms n={s.verified ? 'verified_user' : 'groups'} />
      {s.verified ? 'Verified community' : 'Community'}
    </span>
  );

/** Whether a skill can run today. A concept is a planned recipe with no script behind it yet. */
export const StatusBadge = ({ s }: { s: object }) => {
  const st = skillStatus(s);
  return st === 'available' ? (
    <span className="pill" style={{ color: 'var(--green)' }} title="Runs in the agent today"><Ms n="check_circle" size={14} />Ready</span>
  ) : (
    <span className="pill" style={{ color: 'var(--muted)' }} title={st === 'draft' ? 'Your draft, not published' : 'Planned recipe, not runnable yet'}>
      <Ms n={st === 'draft' ? 'edit_note' : 'lightbulb'} size={14} />{st === 'draft' ? 'Draft' : 'Concept'}
    </span>
  );
};

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
          <StatusBadge s={s} />
        </div>
        <div className="lib-card-name">{s.name}</div>
        <div className="lib-sat"><Ms n="satellite_alt" />{s.sat}</div>
        <div className="body-sm">{s.short}</div>
        <div className="lib-card-stats">
          {typeof s.rating === 'number' && s.rating > 0 && (
            <><span className="row" style={{ gap: 3 }}><span style={{ color: 'var(--yellow)' }}>★</span>{s.rating.toFixed(1)}</span><span className="subtle">·</span></>
          )}
          {typeof s.runs === 'number' && s.runs > 0 && <><span>{fmtRuns(s.runs)} runs</span><span className="subtle">·</span></>}
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
        A skill is a versioned manifest: an ordered list of modules with their parameters, plus a pointer to the script for skills
        that run. Same modules, same parameters, same version, so a run can be reproduced and checked.
      </div>
    </div>
  </div>
);


