/**
 * Step 2: choose the outline, and derive everything the preview and the save need from it.
 *
 * Owns the shape choice, the circle/rectangle dimensions, the AI-suggested boundary, anything
 * the user drew, and their vertex edits. The outline is always
 *
 *     pts = edited ?? (the pts of the chosen `shape`)
 *
 * so there is one source of truth for the geometry, and "reset" is just clearing `edited`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api, toApiError } from '../../api';
import { approxAreaHa, circlePts, fitZoom, mpp, rectPts, ringToPts, shift, type Pt } from '../../lib/geo';
import type { Loc, Method, Shape } from './types';

export const MIN_VERTICES = 3;

export function useOutline({ loc, step, method }: { loc: Loc | null; step: number; method: Method | null }) {
  const [shape, setShapeRaw] = useState<Shape>(() => (loc?.pts ? 'given' : method === 'pin' || method === 'coords' ? 'circle' : 'detected'));
  const [radius, setRadius] = useState(300);
  const [rw, setRw] = useState(600);
  const [rh, setRh] = useState(400);
  /** What the user drew with the polygon / rectangle / circle tools. */
  const [drawn, setDrawn] = useState<{ pts: Pt[]; circle: boolean } | null>(null);
  /** The outline after the user moved, added or removed vertices; overrides the shape's own pts. */
  const [edited, setEdited] = useState<Pt[] | null>(null);
  /**
   * Absolute preview zoom; `null` means "fit the outline".
   *
   * It used to be an *offset* from a zoom that is itself derived from the outline — so dragging
   * the radius slider silently moved the user's manual zoom underneath them. It is also frozen
   * as soon as the user starts drawing or editing, or the map would zoom as they drag a point.
   */
  const [zoom, setZoom] = useState<number | null>(null);
  const [detected, setDetected] = useState<Pt[] | null>(null);
  /** How the detected outline was made; `fallback_square` means no clear boundary was found. */
  const [detectInfo, setDetectInfo] = useState<{ method: string; note: string } | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<ApiError | null>(null);

  /**
   * Detection is keyed on the coordinates, and on nothing the request itself writes.
   *
   * The dependency list previously included `detected` and `detecting` — state the effect sets —
   * so calling `setDetecting(true)` re-ran the effect, React ran the cleanup first, and the
   * cleanup's `live = false` disarmed the very request that had just gone out. Detection could
   * never finish. So: the effect depends only on what identifies a request, and the "already
   * attempted" mark is a ref rather than state, so recording it cannot re-trigger the effect.
   */
  const key = loc ? `${loc.lat.toFixed(5)},${loc.lon.toFixed(5)}` : null;
  const attempted = useRef<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    if (step !== 2 || shape !== 'detected' || !key || !loc) return;
    if (attempted.current === key) return;
    attempted.current = key;

    let live = true;
    const ac = new AbortController();
    setDetecting(true);
    setDetectError(null);
    setDetectInfo(null);
    api.places
      .detectBoundary(loc.lat, loc.lon, ac.signal)
      .then((res) => {
        if (!live) return;
        setDetectInfo({ method: res.method, note: res.note });
        setDetected(ringToPts(res.geometry.coordinates[0] ?? [], { lat: loc.lat, lon: loc.lon }));
      })
      .catch((err) => live && setDetectError(toApiError(err)))
      .finally(() => live && setDetecting(false));
    return () => {
      live = false;
      ac.abort();
    };
    // `loc` is read inside but deliberately not a dependency — `key` stands in for it, and
    // including the object would re-run this on every render of the locate-method.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, shape, key, retryNonce]);

  const retryDetect = useCallback(() => {
    attempted.current = null;
    setDetectError(null);
    setRetryNonce((n) => n + 1);
  }, []);

  /** Choosing a shape starts from that shape's own outline, discarding vertex edits. */
  const setShape = useCallback((next: Shape) => {
    setShapeRaw(next);
    setEdited(null);
  }, []);

  /** Called when the wizard enters step 2 (or the location changes), to pick a starting shape. */
  const begin = useCallback((at: Loc, by: Method | null) => {
    setShapeRaw(at.pts ? 'given' : by === 'pin' || by === 'coords' ? 'circle' : 'detected');
    setZoom(null);
    setDetected(null);
    setDetectError(null);
    setDrawn(null);
    setEdited(null);
    attempted.current = null;
  }, []);

  const metresPerPx = loc ? mpp(loc.lat) : 1;
  const basePts: Pt[] = useMemo(() => {
    if (!loc) return [];
    if (shape === 'given' && loc.pts) return loc.pts;
    if (shape === 'circle') return circlePts(radius / metresPerPx, 48);
    if (shape === 'rect') return rectPts(rw / metresPerPx, rh / metresPerPx);
    if (shape === 'drawn') return drawn?.pts ?? [];
    return detected ?? [];
  }, [loc, shape, radius, rw, rh, detected, drawn, metresPerPx]);

  const pts = edited ?? basePts;

  // A circle stops being one the moment a vertex is moved.
  const isCircle = !edited && (shape === 'circle' || (shape === 'given' && !!loc?.circle) || (shape === 'drawn' && !!drawn?.circle));
  /**
   * PROVISIONAL area, for live feedback while the outline is still being edited. The place has
   * no server-side identity yet, so there is no authoritative figure to show. After saving, the
   * toast and every later view use the server's `areaHa`.
   */
  const ha = loc ? approxAreaHa(pts, loc.lat) : 0;
  const fitted = pts.length ? fitZoom(pts, 220) : 15;
  const previewZoom = Math.max(3, Math.min(18, zoom ?? fitted));

  const freezeZoom = useCallback(() => setZoom((z) => z ?? previewZoom), [previewZoom]);

  /** Replace the outline with the user's vertex edits. */
  const editPts = useCallback((next: Pt[]) => {
    freezeZoom();
    setEdited(next);
  }, [freezeZoom]);

  /** Commit a shape made with the drawing tools. */
  const commitDrawn = useCallback((next: Pt[], circle: boolean) => {
    freezeZoom();
    setDrawn({ pts: next, circle });
    setShapeRaw('drawn');
    setEdited(null);
  }, [freezeZoom]);

  const resetEdits = useCallback(() => setEdited(null), []);

  /**
   * Where the saved place is centred. Pts are offsets from `loc`, so `loc` stays the anchor for
   * the geometry; only a hand-made outline moves the reported centre to its own middle.
   */
  const center = useMemo(() => {
    if (!loc) return null;
    if ((shape === 'drawn' || edited) && pts.length) {
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
      const cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
      return shift(loc.lat, loc.lon, cx, cy);
    }
    return { lat: loc.lat, lon: loc.lon };
  }, [loc, shape, edited, pts]);

  /** How the chosen outline should be described on the saved place. */
  const baseLabel =
    shape === 'detected'
      ? detectInfo?.method === 'fallback_square' ? 'Rough square, no clear boundary found' : 'AI-detected boundary'
      : shape === 'circle'
        ? `Circle, ${radius} m radius`
        : shape === 'rect'
          ? `Rectangle, ${rw} × ${rh} m`
          : shape === 'drawn'
            ? drawn?.circle ? 'Drawn circle' : 'As drawn'
            : (loc?.givenLabel ?? 'Provided');
  const outlineLabel = edited ? `${baseLabel}, edited` : baseLabel;

  return {
    shape, setShape,
    radius, setRadius,
    rw, setRw,
    rh, setRh,
    previewZoom, setZoom,
    detected, detectInfo, detecting, detectError, retryDetect,
    pts, isCircle, ha, fitted, outlineLabel, center,
    isEdited: !!edited, drawn: !!drawn,
    editPts, commitDrawn, resetEdits,
    begin,
    method,
  };
}

export type Outline = ReturnType<typeof useOutline>;
