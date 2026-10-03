/**
 * LayerRail: a slim vertical rail of round layer buttons pinned to one edge of the map.
 *
 * One button per layer, with a hover label, an active state, and a small legend that opens
 * beside the rail for the active layer. Names are plain language (see `layerNames.ts`),
 * never sensor names.
 */

import { useState } from 'react';
import { Ms } from '../ui';
import type { MapLayer } from '../../model';
import { layerLook } from './layerNames';

export function LayerRail({
  layers,
  onToggle,
  top = 76,
  side = 'left',
}: {
  layers: MapLayer[];
  onToggle: (id: string) => void;
  /** Distance from the top of the map container, so it clears the page header. */
  top?: number;
  /** Which edge of the map the rail sits on; tooltips and the legend open towards the map. */
  side?: 'left' | 'right';
}) {
  const [hover, setHover] = useState<string | null>(null);
  // The legend follows the most recently switched-on layer.
  const [focus, setFocus] = useState<string | null>(null);

  if (!layers.length) return null;
  const isActive = (l: MapLayer) => l.on && l.ready;
  const legendLayer = layers.find((l) => l.id === focus && isActive(l)) ?? layers.find(isActive);
  const legend = legendLayer ? layerLook(legendLayer.id, legendLayer.name) : null;

  return (
    <div
      style={{
        position: 'absolute',
        [side]: 12,
        top,
        zIndex: 20,
        display: 'flex',
        alignItems: 'flex-start',
        flexDirection: side === 'right' ? 'row-reverse' : 'row',
        gap: 8,
        maxHeight: `calc(100% - ${top + 12}px)`,
        pointerEvents: 'none',
      }}
    >
      <nav
        aria-label="Map layers"
        style={{
          pointerEvents: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: 6,
          borderRadius: 999,
          background: 'var(--glass-bg)',
          WebkitBackdropFilter: 'var(--glass-blur)',
          backdropFilter: 'var(--glass-blur)',
          border: '1px solid var(--glass-border)',
          boxShadow: 'var(--glass-shadow)',
        }}
      >
        {layers.map((l) => {
          const look = layerLook(l.id, l.name);
          const dim = !l.ready;
          const active = isActive(l);
          const hint = dim ? 'Ask about this place to make this layer' : active ? 'Shown on the map' : 'Show on the map';
          return (
            <div key={l.id} style={{ position: 'relative' }} onMouseEnter={() => setHover(l.id)} onMouseLeave={() => setHover(null)}>
              <button
                type="button"
                aria-pressed={active}
                aria-disabled={dim}
                aria-label={`${look.label}. ${hint}`}
                onFocus={() => setHover(l.id)}
                onBlur={() => setHover(null)}
                onClick={() => {
                  if (dim) return;
                  onToggle(l.id);
                  if (!l.on) setFocus(l.id);
                }}
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: dim ? 'default' : 'pointer',
                  opacity: dim ? 0.4 : 1,
                  background: active ? '#fff' : 'var(--glass-fill)',
                  color: active ? '#000' : 'var(--muted)',
                  border: `1px solid ${active ? '#fff' : 'var(--hair)'}`,
                }}
              >
                <Ms n={look.icon} size={20} />
              </button>
              {hover === l.id && (
                <div
                  role="tooltip"
                  style={{
                    position: 'absolute',
                    [side === 'right' ? 'right' : 'left']: 46,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    whiteSpace: 'nowrap',
                    padding: '5px 9px',
                    borderRadius: 6,
                    background: 'var(--glass-bg-strong)',
                    WebkitBackdropFilter: 'var(--glass-blur)',
                    backdropFilter: 'var(--glass-blur)',
                    border: '1px solid var(--glass-border)',
                    zIndex: 2,
                  }}
                >
                  <div style={{ font: '600 12px/1.3 var(--font)', color: '#fff' }}>{look.label}</div>
                  {dim && <div className="tiny">{hint}</div>}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      {legend && legendLayer && (
        <div
          className="panel"
          style={{ pointerEvents: 'auto', padding: '8px 10px', width: 168, display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          <span style={{ font: '600 12px/1.3 var(--font)' }}>{legend.label}</span>
          <span
            aria-hidden
            style={{ height: 6, borderRadius: 3, background: `linear-gradient(90deg, ${legend.ramp.join(', ')})` }}
          />
          {legend.legend && <span className="tiny">{legend.legend}</span>}
        </div>
      )}
    </div>
  );
}
