/**
 * The shared 3D globe, framed for picking a spot on Earth.
 *
 * three.js is large, so the Globe is lazy-loaded exactly as AskPage does it. The picked
 * coordinates come back through `onPick`; `onBack` (optional) returns to the map.
 */

import { Suspense, lazy } from 'react';
import { Btn } from '../../components/ui';

const Globe = lazy(() => import('../../components/Globe').then((m) => ({ default: m.Globe })));

export function GlobePicker({ H, onPick, focus, onBack, hint }: {
  H: number;
  onPick: (p: { lat: number; lon: number }) => void;
  focus?: { lat: number; lon: number } | null;
  onBack?: () => void;
  hint?: string;
}) {
  return (
    <div style={{ position: 'relative', flex: 'none', height: H, borderRadius: 'var(--r)', overflow: 'hidden', border: '1px solid var(--hair-soft)', background: '#05070a' }}>
      <Suspense fallback={<div className="row caption" style={{ position: 'absolute', inset: 0, justifyContent: 'center', gap: 8 }}><span className="spinner" />Loading the globe…</div>}>
        <Globe visible autoRotate={!focus} offsetRight={false} onPickLocation={onPick} focus={focus ?? null} showSatellites={false} />
      </Suspense>
      <span className="tiny" style={{ position: 'absolute', left: 10, bottom: 8, color: 'var(--muted)', textShadow: '0 1px 2px #000', pointerEvents: 'none' }}>
        {hint ?? 'Drag to rotate · scroll to zoom · click a spot to choose it'}
      </span>
      {onBack && (
        <div style={{ position: 'absolute', right: 8, top: 8 }}>
          <Btn size="sm" variant="text" icon="map" onClick={onBack}>Back to map</Btn>
        </div>
      )}
    </div>
  );
}
