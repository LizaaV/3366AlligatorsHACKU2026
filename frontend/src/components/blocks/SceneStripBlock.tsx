/**
 * `scene_strip`: every satellite pass considered, and what happened to it.
 *
 * The rejected passes matter as much as the used ones — "we looked 14 times and could only use
 * 9" is the honest version of the answer — so unused scenes are shown greyed with their reason
 * rather than filtered out.
 */

import { BlockFrame } from './BlockFrame';
import { Ms } from '../ui';
import { cloudFromFraction } from '../../lib/format';
import type { components } from '../../api/schema';

type S = components['schemas'];

export function SceneStripBlock({ block }: { block: S['SceneStripBlock'] }) {
  const used = block.scenes.filter((s) => s.used).length;
  return (
    <BlockFrame
      title={block.title}
      caption={block.caption ?? `${used} of ${block.scenes.length} passes usable`}
      primary={block.primary}
      provenance={block.provenance}
    >
      <ol
        className="row"
        style={{ gap: 6, overflowX: 'auto', listStyle: 'none', margin: 0, padding: '2px 0 6px', alignItems: 'stretch' }}
      >
        {block.scenes.map((s) => (
          <li
            key={s.scene}
            title={s.why ?? `${s.satellite} · ${cloudFromFraction(s.cloud)} cloud`}
            style={{
              flex: '0 0 auto',
              width: 72,
              padding: '6px 8px',
              borderRadius: 6,
              background: s.used ? 'var(--s2)' : 'transparent',
              border: `1px solid ${s.used ? 'var(--hair)' : 'var(--hair-soft)'}`,
              opacity: s.used ? 1 : 0.6,
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
            }}
          >
            <span className="row" style={{ gap: 4 }}>
              <Ms
                n={s.used ? 'check_circle' : 'cloud'}
                size={13}
                style={{ color: s.used ? 'var(--green)' : 'var(--subtle)' }}
              />
              <span className="tiny ink">{shortDate(s.date)}</span>
            </span>
            <span className="tiny muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {s.satellite}
            </span>
            <span className="tiny">{cloudFromFraction(s.cloud)} cloud</span>
          </li>
        ))}
      </ol>
    </BlockFrame>
  );
}

/** "2026-09-30" -> "30 Sep". Dates here are already plain ISO days, not instants. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
