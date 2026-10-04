/**
 * `then_now`: the same place on two dates.
 *
 * A compact pair of thumbnails with their dates underneath — nothing is drawn over the
 * images, so text can never spill past them. Where there is a map (the Ask page), "Show on
 * map" puts the full-size before/after layer on it, with its own Before/After switch.
 */

import { BlockFrame } from './BlockFrame';
import { Ms } from '../ui';
import type { components } from '../../api/schema';

type S = components['schemas'];

const day = (iso: string) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export function ThenNowBlock({ block, onShowOnMap }: { block: S['ThenNowBlock']; onShowOnMap?: (layerKey: string) => void }) {
  const key = block.measure ?? block.after.layer_id;
  return (
    <BlockFrame title={block.title} caption={block.caption} primary={block.primary} provenance={block.provenance}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {[block.before, block.after].map((img, i) => (
          <div key={img.url} className="col" style={{ gap: 4, minWidth: 0 }}>
            <div style={{ aspectRatio: '1', borderRadius: 8, overflow: 'hidden', background: '#000', border: '1px solid var(--hair-soft)' }}>
              <img src={img.url} alt={`${i ? 'After' : 'Before'}, ${img.date}`} style={{ width: '100%', height: '100%', objectFit: 'cover', imageRendering: 'pixelated', display: 'block' }} />
            </div>
            <span className="tiny" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              <span className="muted">{i ? 'After' : 'Before'} · </span>{day(img.date)}
            </span>
          </div>
        ))}
      </div>
      {onShowOnMap && (
        <button className="btn btn-text btn-sm" style={{ alignSelf: 'flex-start', marginTop: 2 }} onClick={() => onShowOnMap(key)}>
          <Ms n="map" />Show on map
        </button>
      )}
    </BlockFrame>
  );
}
