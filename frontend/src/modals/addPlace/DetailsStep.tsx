/** Step 3: name it, file it, tag it, and optionally start watching it. */

import { useStore } from '../../state/store';
import { Check, Tier } from '../../components/ui';
import { sourceLabel } from '../../data/presentation';
import { fmtC } from '../../lib/geo';
import type { Loc, Shape } from './types';
import type { DetailsForm } from './useDetailsForm';

export function DetailsStep({ loc, ha, form, outline }: { loc: Loc; ha: number; form: DetailsForm; outline: { shape: Shape; edited: boolean } }) {
  const origin = `${outline.shape === 'drawn' ? 'Drawn' : sourceLabel(loc.source)}${outline.edited ? ' · outline edited' : ''}`;
  const { categories } = useStore();
  const {
    projects, name, setName, project, setProject, newProject, setNewProject,
    categoryKey, setCategoryKey, tags, setTags, startWatch, setStartWatch, suggested,
  } = form;

  return (
    <>
      <div className="subhead">Details</div>
      <div className="row wrap" style={{ gap: 12 }}>
        <label className="field" style={{ flex: '1 1 240px' }}>
          Name
          <input className="input" value={name} autoFocus onChange={(e) => setName(e.target.value)} placeholder="e.g. East paddock" />
        </label>
        <label className="field" style={{ flex: '1 1 200px' }}>
          Project
          <select className="input" value={project} onChange={(e) => setProject(e.target.value)}>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
            <option value="__new">New project…</option>
          </select>
        </label>
      </div>
      {project === '__new' && (
        <label className="field">
          New project name
          <input className="input" value={newProject} onChange={(e) => setNewProject(e.target.value)} placeholder="e.g. Nakuru dairy co-op" autoFocus />
        </label>
      )}
      <div className="field">
        Category
        <div className="row wrap" style={{ gap: 6 }}>
          {categories.map((c) => (
            <button key={c.key} className={`chip ${categoryKey === c.key ? 'on' : ''}`} onClick={() => setCategoryKey(c.key)} aria-pressed={categoryKey === c.key}>
              <span className="dot" style={{ background: c.color, boxShadow: categoryKey === c.key ? '0 0 0 1px #000' : undefined }} />
              {c.name}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        Tags <span className="tiny">Comma separated</span>
        <input className="input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. Maize, Drip irrigation" />
      </label>
      {suggested.length > 0 && (
        <div className="field">
          Start watching <span className="tiny">Optional · re-runs on every new satellite pass</span>
          <div className="col" style={{ gap: 6 }}>
            {suggested.map((sk) => {
              const on = startWatch.includes(sk.id);
              return (
                <button key={sk.id} onClick={() => setStartWatch((s) => (on ? s.filter((x) => x !== sk.id) : [...s, sk.id]))} aria-pressed={on}
                  className="well row" style={{ padding: '10px 14px', gap: 12, textAlign: 'left', color: '#fff', borderColor: on ? 'var(--hair)' : undefined }}>
                  <Check on={on} />
                  <span className="grow">
                    <span style={{ font: '600 14px/1.4 var(--font)' }}>{sk.name}</span>
                    <span className="caption" style={{ display: 'block' }}>{sk.short} · {sk.sat}</span>
                  </span>
                  <Tier tier={sk.tier} label={sk.tier === 'paid' ? sk.cost : undefined} />
                </button>
              );
            })}
          </div>
        </div>
      )}
      <div className="well row wrap" style={{ padding: '10px 14px', gap: 12 }}>
        <span className="caption">{origin}</span>
        <span className="caption">·</span>
        <span className="caption">{fmtC(loc.lat, loc.lon)}</span>
        <span className="caption">·</span>
        <span className="caption">{ha.toLocaleString(undefined, { maximumFractionDigits: 1 })} ha</span>
      </div>
    </>
  );
}
