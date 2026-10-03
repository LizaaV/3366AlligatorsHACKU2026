/**
 * The step-2 map: shows the outline, lets the user draw one (polygon / rectangle / circle) and
 * edit its vertices.
 *
 * All geometry here is in reference-zoom pixel offsets from the location (`Pt`), the same space
 * `useOutline` keeps; `s` converts to screen pixels. Edits are reported through the outline
 * hook, never held here — the only local state is what is mid-gesture.
 *
 * Editing: drag a vertex to move it; click the small dot on an edge to insert one; right-click,
 * Alt-click or the × on a selected vertex removes it (never below three).
 */

import { useState } from 'react';
import type { Place } from '../../model';
import { circlePts, type Pt } from '../../lib/geo';
import { MapFrame, useMapHeight } from './MapFrame';
import { type Loc, type Tool } from './types';
import { MIN_VERTICES, type Outline } from './useOutline';

/** Beyond this many vertices (a 48-gon circle) handles shrink and edge midpoints are hidden. */
const DENSE = 24;
const r1 = (v: number) => +v.toFixed(1);

export function OutlineMap({ loc, draft, outline, tool, setTool, verts, setVerts, onGlobe }: {
  loc: Loc;
  draft: Place;
  outline: Outline;
  tool: Tool;
  setTool: (t: Tool) => void;
  /** Polygon points placed so far; owned by the step so its toolbar can finish/undo them. */
  verts: Pt[];
  setVerts: (v: Pt[]) => void;
  onGlobe: () => void;
}) {
  const { pts, previewZoom, setZoom, editPts, commitDrawn } = outline;
  const [selected, setSelected] = useState<number | null>(null);
  const [drag, setDrag] = useState<{ a: Pt; b: Pt } | null>(null);
  const [moving, setMoving] = useState<number | null>(null);
  const center = { lat: loc.lat, lon: loc.lon };

  const removeVertex = (i: number) => {
    if (pts.length <= MIN_VERTICES) return;
    editPts(pts.filter((_, k) => k !== i));
    setSelected(null);
  };

  const insertAfter = (i: number) => {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const next = [...pts.slice(0, i + 1), [r1((a[0] + b[0]) / 2), r1((a[1] + b[1]) / 2)] as Pt, ...pts.slice(i + 1)];
    editPts(next);
    setSelected(i + 1);
  };

  const drawing = tool !== 'edit';
  // The saved-outline overlay hides while a new shape is mid-gesture, so the two don't overlap.
  const showPlace = verts.length > 0 || drag ? null : draft;

  const pointer = tool === 'rect' || tool === 'circle'
    ? {
        down: (pt: Pt, e: React.PointerEvent<HTMLDivElement>) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          setDrag({ a: pt, b: pt });
        },
        move: (pt: Pt) => drag && setDrag({ a: drag.a, b: pt }),
        up: (pt: Pt) => {
          if (!drag) return;
          const { a } = drag;
          setDrag(null);
          if (tool === 'rect') {
            if (Math.abs(pt[0] - a[0]) < 3 || Math.abs(pt[1] - a[1]) < 3) return;
            commitDrawn([[a[0], a[1]], [pt[0], a[1]], [pt[0], pt[1]], [a[0], pt[1]]].map((p) => [r1(p[0]), r1(p[1])] as Pt), false);
          } else {
            const rad = Math.hypot(pt[0] - a[0], pt[1] - a[1]);
            if (rad < 3) return;
            commitDrawn(circlePts(rad, 48).map((p) => [r1(p[0] + a[0]), r1(p[1] + a[1])] as Pt), true);
          }
          setTool('edit');
        },
      }
    : undefined;

  const onPick = tool === 'polygon'
    ? (dx: number, dy: number) => {
        const s = Math.pow(2, previewZoom - 16);
        // Clicking the first point closes the shape.
        if (verts.length >= 3 && Math.hypot(dx - verts[0][0], dy - verts[0][1]) * s < 10) {
          commitDrawn(verts, false);
          setVerts([]);
          setTool('edit');
          return;
        }
        setVerts([...verts, [r1(dx), r1(dy)]]);
      }
    : undefined;

  const H = useMapHeight();
  return (
    <MapFrame
      H={H} center={center} zoom={previewZoom} setZoom={setZoom} place={showPlace}
      onGlobe={onGlobe} onPick={onPick} pointer={pointer} cursor={drawing ? 'crosshair' : undefined}
    >
      {(s, W, H, toPt) => {
        const X = (p: Pt) => W / 2 + p[0] * s;
        const Y = (p: Pt) => H / 2 + p[1] * s;
        const dense = pts.length > DENSE;
        return (
          <g>
            {/* Shape being drawn. */}
            {tool === 'polygon' && verts.length > 0 && (
              <g>
                <polygon points={verts.map((v) => `${X(v)},${Y(v)}`).join(' ')} fill={verts.length > 2 ? 'rgba(255,255,255,.12)' : 'none'} stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
                {verts.map((v, i) => <circle key={i} cx={X(v)} cy={Y(v)} r={i === 0 && verts.length >= 3 ? 7 : 4.5} fill={i === 0 ? '#fff' : '#000'} stroke="#fff" strokeWidth="2" />)}
              </g>
            )}
            {drag && tool === 'rect' && (
              <rect x={Math.min(X(drag.a), X(drag.b))} y={Math.min(Y(drag.a), Y(drag.b))} width={Math.abs(X(drag.b) - X(drag.a))} height={Math.abs(Y(drag.b) - Y(drag.a))}
                fill="rgba(255,255,255,.12)" stroke="#fff" strokeWidth="2" />
            )}
            {drag && tool === 'circle' && (
              <circle cx={X(drag.a)} cy={Y(drag.a)} r={Math.hypot(drag.b[0] - drag.a[0], drag.b[1] - drag.a[1]) * s} fill="rgba(255,255,255,.12)" stroke="#fff" strokeWidth="2" />
            )}

            {/* Vertex handles. */}
            {tool === 'edit' && pts.length >= MIN_VERTICES && (
              <g>
                {!dense && pts.map((a, i) => {
                  const b = pts[(i + 1) % pts.length];
                  const m: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
                  return (
                    <g key={`m${i}`} style={{ pointerEvents: 'all', cursor: 'copy', touchAction: 'none' }} onClick={(e) => { e.stopPropagation(); insertAfter(i); }}>
                      <title>Add a point</title>
                      <circle cx={X(m)} cy={Y(m)} r="12" fill="transparent" />
                      <circle cx={X(m)} cy={Y(m)} r="3.5" fill="rgba(255,255,255,.55)" stroke="#000" strokeWidth="1" />
                    </g>
                  );
                })}
                {pts.map((p, i) => (
                  <g
                    key={`v${i}`}
                    style={{ pointerEvents: 'all', cursor: moving === i ? 'grabbing' : 'grab', touchAction: 'none' }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (e.altKey) { removeVertex(i); return; }
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setMoving(i);
                      setSelected(i);
                    }}
                    onPointerMove={(e) => {
                      if (moving !== i) return;
                      const q = toPt(e);
                      editPts(pts.map((v, k) => (k === i ? [r1(q[0]), r1(q[1])] as Pt : v)));
                    }}
                    onPointerUp={() => setMoving(null)}
                    onPointerCancel={() => setMoving(null)}
                    onContextMenu={(e) => { e.preventDefault(); removeVertex(i); }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <title>Drag to move · right-click or Alt-click to remove</title>
                    <circle cx={X(p)} cy={Y(p)} r={dense ? 11 : 14} fill="transparent" />
                    <circle cx={X(p)} cy={Y(p)} r={dense ? 4 : 6.5} fill={selected === i ? '#2b89ff' : '#fff'} stroke="#000" strokeWidth="1.5" />
                  </g>
                ))}
                {selected !== null && pts[selected] && pts.length > MIN_VERTICES && moving === null && (
                  <g style={{ pointerEvents: 'all', cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); removeVertex(selected); }}>
                    <title>Remove this point</title>
                    <circle cx={X(pts[selected]) + 16} cy={Y(pts[selected]) - 16} r="10" fill="#000" stroke="#fff" strokeWidth="1.5" />
                    <path d={`M${X(pts[selected]) + 12},${Y(pts[selected]) - 20} l8,8 m0,-8 l-8,8`} stroke="#fff" strokeWidth="1.8" strokeLinecap="round" fill="none" />
                  </g>
                )}
              </g>
            )}
          </g>
        );
      }}
    </MapFrame>
  );
}
