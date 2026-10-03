/**
 * `highlight`: the specific patches that changed, and how big they are.
 *
 * `base` is an optional server-rendered image of the area; when it is present the patch
 * outlines are drawn over it, projected from their own GeoJSON into the image's `bounds`.
 * Without it the block is still useful as a list — a reader mainly wants "how many patches,
 * how big, and where", and the sizes are the part they act on.
 */

import { BlockFrame } from './BlockFrame';
import { hideBroken } from '../ui';
import { fmtC, outerRing } from '../../lib/geo';
import type { components } from '../../api/schema';

type S = components['schemas'];

export function HighlightBlock({ block }: { block: S['HighlightBlock'] }) {
  const base = block.base ?? null;
  return (
    <BlockFrame
      title={block.title}
      caption={block.caption ?? `${block.patches.length} patch${block.patches.length === 1 ? '' : 'es'} · ${block.total_ha.toFixed(1)} ha in total`}
      primary={block.primary}
      provenance={block.provenance}
    >
      {base && (
        <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden', background: 'var(--s3)', aspectRatio: '16 / 10' }}>
          <img
            src={base.url}
            alt={`${base.label}, ${base.date}`}
            onError={hideBroken}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} aria-hidden>
            {block.patches.map((p, i) => {
              const d = outlinePath(p, base.bounds);
              return d ? <path key={i} d={d} fill="rgba(20,198,203,.25)" stroke="var(--cyan)" strokeWidth="0.4" vectorEffect="non-scaling-stroke" /> : null;
            })}
          </svg>
        </div>
      )}

      <ul className="col" style={{ gap: 4, listStyle: 'none', margin: 0, padding: 0, maxHeight: 160, overflowY: 'auto' }}>
        {block.patches.map((p, i) => (
          <li key={i} className="row tiny" style={{ gap: 8, padding: '4px 6px', borderRadius: 6, background: 'var(--s2)' }}>
            <span className="ink" style={{ width: 62, flex: 'none' }}>{p.ha.toFixed(2)} ha</span>
            <span className="muted">{fmtC(p.centroid[1], p.centroid[0])}</span>
          </li>
        ))}
      </ul>
    </BlockFrame>
  );
}

/**
 * Project a patch's outer ring into the base image's 0..100 viewBox.
 *
 * `bounds` is [west, south, east, north] in WGS84. Over a single scene the linear mapping is
 * close enough for an overlay; the authoritative geometry stays in the GeoJSON.
 */
function outlinePath(patch: S['Patch'], bounds: [number, number, number, number]): string | null {
  const ring = outerRing(patch.geojson);
  if (!ring?.length) return null;
  const [w, s, e, n] = bounds;
  const dx = e - w;
  const dy = n - s;
  if (!dx || !dy) return null;
  const pts = ring.map(([lon, lat]) => `${(((lon - w) / dx) * 100).toFixed(2)},${(((n - lat) / dy) * 100).toFixed(2)}`);
  return `M${pts.join(' L')} Z`;
}
