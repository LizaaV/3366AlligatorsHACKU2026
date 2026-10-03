/**
 * `timeline`: a measure over time, against the normal seasonal range.
 *
 * Not drawn with `HistoryChart`: that one is built for watch series — values normalised to
 * 0..1, a symmetric confidence band, and a "5-year average" legend. A measure here is a real
 * index (water runs -1..1), the band is **per calendar month** rather than per point, and the
 * marks are dated events. Forcing it through the other chart would misplot it.
 *
 * Each point carries its `scene`, so clicking one can move the shared time cursor — see
 * `links` in §6. The cursor itself is wired by the page that owns the map.
 */

import { useMemo } from 'react';
import { BlockFrame } from './BlockFrame';
import type { components } from '../../api/schema';

type S = components['schemas'];

const W = 320;
const H = 120;
const PAD = { top: 8, right: 6, bottom: 18, left: 30 };

export function TimelineBlock({
  block,
  onPickScene,
}: {
  block: S['TimelineBlock'];
  /** Move the shared time cursor to this point's scene. */
  onPickScene?: (scene: string) => void;
}) {
  const geom = useMemo(() => layout(block), [block]);

  return (
    <BlockFrame title={block.title} caption={block.caption} primary={block.primary} provenance={block.provenance}>
      {geom ? (
        <>
          <svg
            viewBox={`0 0 ${W} ${H}`}
            width="100%"
            style={{ display: 'block', overflow: 'visible' }}
            role="img"
            aria-label={`${block.measure} over time`}
          >
            {/* y axis: just the extremes and zero, which is the line that matters for an index */}
            {geom.ticks.map((t) => (
              <g key={t.v}>
                <line x1={PAD.left} y1={t.y} x2={W - PAD.right} y2={t.y} stroke="var(--hair-soft)" strokeDasharray={t.v === 0 ? undefined : '3 4'} />
                <text x={PAD.left - 5} y={t.y + 3} textAnchor="end" fontSize="8" fill="var(--subtle)">{t.label}</text>
              </g>
            ))}

            {/* the normal range for the time of year */}
            {geom.bandPath && <path d={geom.bandPath} fill="rgba(178,182,189,.12)" />}

            {/* other series the backend sent for comparison */}
            {geom.compare.map((c) => (
              <polyline key={c.label} points={c.points} fill="none" stroke="var(--subtle)" strokeWidth="1.5" strokeDasharray="4 4" />
            ))}

            <polyline points={geom.points} fill="none" stroke="var(--cyan)" strokeWidth="2" strokeLinejoin="round" />

            {geom.dots.map((d) => (
              <circle
                key={d.scene}
                cx={d.x}
                cy={d.y}
                r={3}
                fill={d.cloudy ? 'var(--s3)' : 'var(--cyan)'}
                stroke={d.cloudy ? 'var(--subtle)' : 'none'}
                strokeWidth="1"
                style={onPickScene ? { cursor: 'pointer' } : undefined}
                onClick={onPickScene ? () => onPickScene(d.scene) : undefined}
              >
                <title>{`${d.date} · ${d.value}${block.unit ? ` ${block.unit}` : ''}${d.cloudy ? ' · mostly obscured' : ''}`}</title>
              </circle>
            ))}

            {/* dated events, e.g. "first dry pass" */}
            {geom.marks.map((m) => (
              <g key={`${m.date}-${m.label}`}>
                <line x1={m.x} y1={PAD.top} x2={m.x} y2={H - PAD.bottom} stroke="var(--amber)" strokeWidth="1" strokeDasharray="2 3" />
                <text x={m.x + 3} y={PAD.top + 8} fontSize="8" fill="var(--amber)">{m.label}</text>
              </g>
            ))}

            <text x={PAD.left} y={H - 5} fontSize="8" fill="var(--subtle)">{geom.first}</text>
            <text x={W - PAD.right} y={H - 5} fontSize="8" fill="var(--subtle)" textAnchor="end">{geom.last}</text>
          </svg>

          <div className="row wrap tiny" style={{ gap: 12, color: 'var(--muted)' }}>
            <span className="row" style={{ gap: 6 }}><span style={{ width: 12, height: 2, background: 'var(--cyan)' }} />{block.measure}</span>
            {geom.bandPath && <span className="row" style={{ gap: 6 }}><span style={{ width: 12, height: 8, background: 'var(--hair-faint)', borderRadius: 2 }} />normal for the month</span>}
            {geom.hasCloudy && <span className="row" style={{ gap: 6 }}><span style={{ width: 8, height: 8, borderRadius: '50%', border: '1px solid var(--subtle)' }} />mostly obscured</span>}
          </div>
        </>
      ) : (
        <div className="caption muted">No readings in this window.</div>
      )}
    </BlockFrame>
  );
}

/** A pass with less than half the area visible is marked rather than silently plotted. */
const CLEAN_ENOUGH = 0.5;

function layout(block: S['TimelineBlock']) {
  const data = block.data;
  if (!data.length) return null;

  const times = data.map((p) => Date.parse(p.date));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const span = t1 - t0 || 1;

  const bandLo = block.band.map((b) => b.lo);
  const bandHi = block.band.map((b) => b.hi);
  const values = [...data.map((p) => p.value), ...bandLo, ...bandHi, ...block.compare.flatMap((c) => c.data.map((p) => p.value))];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (hi - lo < 1e-6) {
    // A flat series would divide by zero; give it a little room either side instead.
    lo -= 0.5;
    hi += 0.5;
  }

  const x = (ms: number) => PAD.left + ((ms - t0) / span) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);
  const at = (p: S['TimelinePoint']) => `${x(Date.parse(p.date)).toFixed(1)},${y(p.value).toFixed(1)}`;

  // The band is given per calendar month, so each reading is compared with its own month.
  const byMonth = new Map(block.band.map((b) => [b.month, b]));
  const bandPts = data
    .map((p) => ({ p, b: byMonth.get(new Date(p.date).getUTCMonth() + 1) }))
    .filter((e): e is { p: S['TimelinePoint']; b: S['TimelineBand'] } => !!e.b);
  const bandPath = bandPts.length
    ? `M${bandPts.map(({ p, b }) => `${x(Date.parse(p.date)).toFixed(1)},${y(b.hi).toFixed(1)}`).join(' L')} L${[...bandPts]
        .reverse()
        .map(({ p, b }) => `${x(Date.parse(p.date)).toFixed(1)},${y(b.lo).toFixed(1)}`)
        .join(' L')} Z`
    : null;

  const ticks = [hi, ...(lo < 0 && hi > 0 ? [0] : []), lo].map((v) => ({
    v,
    y: y(v),
    label: v.toFixed(Math.abs(hi - lo) < 2 ? 2 : 0),
  }));

  return {
    points: data.map(at).join(' '),
    dots: data.map((p) => ({
      scene: p.scene,
      date: p.date,
      value: p.value.toFixed(2),
      cloudy: p.clean_px < CLEAN_ENOUGH,
      x: x(Date.parse(p.date)),
      y: y(p.value),
    })),
    hasCloudy: data.some((p) => p.clean_px < CLEAN_ENOUGH),
    bandPath,
    compare: block.compare.map((c) => ({ label: c.label, points: c.data.map(at).join(' ') })),
    marks: block.marks
      .filter((m) => Number.isFinite(Date.parse(m.date)))
      .map((m) => ({ ...m, x: x(Date.parse(m.date)) })),
    ticks,
    first: data[0].date,
    last: data[data.length - 1].date,
  };
}
