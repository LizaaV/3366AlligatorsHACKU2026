/**
 * The shell every answer block sits in: title, optional caption, body, provenance.
 *
 * Provenance is the point of the whole product — "which scene, from which provider, at what
 * resolution, by what method" — so every block carries it and it is never silently dropped.
 * It is collapsed by default because most readers want the picture first, and expanded in one
 * click because the ones who want the receipt really want it.
 */

import { useState, type ReactNode } from 'react';
import { Ms } from '../ui';
import type { components } from '../../api/schema';

type S = components['schemas'];

export function BlockFrame({
  title,
  caption,
  primary,
  provenance,
  children,
}: {
  title: string;
  caption?: string | null;
  /** At most one block per answer is primary; it gets the stronger surface. */
  primary?: boolean;
  provenance: S['Provenance'][];
  children: ReactNode;
}) {
  return (
    <figure
      style={{
        margin: 0,
        padding: 12,
        borderRadius: 10,
        background: primary ? 'var(--s2)' : 'var(--s1)',
        border: `1px solid ${primary ? 'var(--hair)' : 'var(--hair-soft)'}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <figcaption style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ font: '600 13px/1.38 var(--font)' }}>{title}</span>
        {caption && <span className="caption muted">{caption}</span>}
      </figcaption>
      {children}
      {provenance.length > 0 && <Provenance entries={provenance} />}
    </figure>
  );
}

function Provenance({ entries }: { entries: S['Provenance'][] }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ borderTop: '1px solid var(--hair-soft)', paddingTop: 8 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="row tiny"
        style={{ gap: 6, background: 'transparent', border: 0, padding: 0, color: 'var(--muted)', cursor: 'pointer' }}
        aria-expanded={open}
      >
        <Ms n="receipt_long" size={14} />
        <span>
          {entries.length === 1
            ? `${entries[0].satellite} · ${entries[0].date}`
            : `${entries.length} sources`}
        </span>
        <Ms n={open ? 'expand_less' : 'expand_more'} size={14} />
      </button>
      {open && (
        <div className="col" style={{ gap: 8, marginTop: 8 }}>
          {entries.map((p) => (
            <div key={`${p.scene}-${p.method}`} className="col" style={{ gap: 2 }}>
              <span className="tiny ink" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>{p.scene}</span>
              <span className="tiny">
                {p.satellite} · {p.date} · {p.resolution_m} m · {Math.round(p.cloud_over_area * 100)}% cloud over the area
              </span>
              <span className="tiny muted">{p.provider} · {p.method}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
