/**
 * `stat`: one number, with the range around it.
 *
 * The range is shown whenever the backend gives one. A measurement from satellite imagery has
 * real uncertainty, and a bare "32.7 ha" reads as more precise than it is.
 */

import { BlockFrame } from './BlockFrame';
import type { components } from '../../api/schema';

type S = components['schemas'];

export function StatBlock({ block }: { block: S['StatBlock'] }) {
  const hasRange = block.lo != null && block.hi != null;
  return (
    <BlockFrame title={block.title} caption={block.caption} primary={block.primary} provenance={block.provenance}>
      <div className="col" style={{ gap: 2 }}>
        <span className="eyebrow muted">{block.label}</span>
        <span style={{ font: '600 28px/1.1 var(--font)', letterSpacing: -0.6 }}>
          {format(block.value)}
          <span style={{ font: '500 15px/1.1 var(--font)', color: 'var(--muted)', marginLeft: 6 }}>{block.unit}</span>
        </span>
        {hasRange && (
          <span className="tiny muted">
            between {format(block.lo as number)} and {format(block.hi as number)} {block.unit}
          </span>
        )}
      </div>
    </BlockFrame>
  );
}

/** Keep small indices readable without turning hectares into 32.70000000000001. */
const format = (v: number): string =>
  Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toFixed(2);
