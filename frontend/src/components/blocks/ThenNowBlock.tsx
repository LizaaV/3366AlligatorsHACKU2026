/**
 * `then_now`: two dated images of the same ground, with a wipe between them.
 *
 * The images are server-rendered PNGs from `/api/layers/...`, and their urls arrive inside the
 * block — `docs/API.md` §6 is explicit that the frontend never builds one itself. Both carry
 * identical `bounds`, so a single wipe over stacked images is a true comparison rather than two
 * pictures placed side by side and hoped to line up.
 */

import { useId, useState } from 'react';
import { hideBroken } from '../ui';
import { BlockFrame } from './BlockFrame';
import type { components } from '../../api/schema';

type S = components['schemas'];

export function ThenNowBlock({ block }: { block: S['ThenNowBlock'] }) {
  // Percentage of the width showing the "now" image.
  const [wipe, setWipe] = useState(50);
  const id = useId();

  return (
    <BlockFrame title={block.title} caption={block.caption} primary={block.primary} provenance={block.provenance}>
      <div
        style={{
          position: 'relative',
          borderRadius: 8,
          overflow: 'hidden',
          background: 'var(--s3)',
          aspectRatio: '16 / 10',
        }}
      >
        <img
          src={block.before.url}
          alt={`${block.before.label}, ${block.before.date}`}
          onError={hideBroken}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
        {/* The "now" image is revealed from the left edge up to the wipe position. */}
        <img
          src={block.after.url}
          alt={`${block.after.label}, ${block.after.date}`}
          onError={hideBroken}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            clipPath: `inset(0 ${100 - wipe}% 0 0)`,
          }}
        />
        <div
          aria-hidden
          style={{ position: 'absolute', top: 0, bottom: 0, left: `${wipe}%`, width: 2, background: '#fff', opacity: 0.9 }}
        />
        <DateTag side="left" date={block.after.date} label={block.after.label} />
        <DateTag side="right" date={block.before.date} label={block.before.label} />
      </div>

      <label htmlFor={id} className="tiny muted">
        Drag to compare {block.before.date} with {block.after.date}
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        value={wipe}
        onChange={(e) => setWipe(+e.target.value)}
        aria-label={`Wipe between ${block.before.date} and ${block.after.date}`}
        style={{ width: '100%' }}
      />
    </BlockFrame>
  );
}

const DateTag = ({ side, date, label }: { side: 'left' | 'right'; date: string; label: string }) => (
  <span
    className="tiny"
    style={{
      position: 'absolute',
      top: 8,
      [side]: 8,
      padding: '2px 6px',
      borderRadius: 4,
      background: 'rgba(0,0,0,.55)',
      color: '#fff',
    }}
  >
    {label} · {date}
  </span>
);
