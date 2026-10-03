/**
 * Step 2: choose the outline, and derive everything the preview and the save need from it.
 *
 * Owns the shape choice, the circle/rectangle dimensions, the suggested boundary and the
 * preview zoom. Everything downstream (`pts`, `isCircle`, `ha`, `draft`) is derived, so there
 * is one source of truth for the geometry.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api, toApiError } from '../../api';
import { approxAreaHa, circlePts, fitZoom, mpp, rectPts, ringToPts, type Pt } from '../../lib/geo';
import type { Loc, Method, Shape } from './types';

export function useOutline({ loc, step, method }: { loc: Loc | null; step: number; method: Method | null }) {
  const [shape, setShape] = useState<Shape>('detected');
  const [radius, setRadius] = useState(300);
  const [rw, setRw] = useState(600);
  const [rh, setRh] = useState(400);
  /**
   * Absolute preview zoom; `null` means "fit the outline".
   *
   * It used to be an *offset* from a zoom that is itself derived from the outline — so dragging
   * the radius slider silently moved the user's manual zoom underneath them.
   */
  const [zoom, setZoom] = useState<number | null>(null);
  const [detected, setDetected] = useState<Pt[] | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectError, setDetectError] = useState<ApiError | null>(null);

  /**
   * Detection is keyed on the coordinates, and on nothing the request itself writes.
   *
   * This matters more than it looks. The dependency list previously included `detected` and
   * `detecting` — state the effect sets — so calling `setDetecting(true)` re-ran the effect,
   * React ran the cleanup first, and the cleanup's `live = false` disarmed the very request that
   * had just gone out. Its `.then`, `.catch` and `.finally` all became no-ops, which meant
   * **detection could never finish**: the outline stayed empty, the area stayed 0 and Continue
   * stayed disabled. It went unnoticed because `detecting` was never rendered.
   *
   * So: the effect depends only on what identifies a request, and the "already attempted" mark
   * is a ref rather than state, so recording it cannot re-trigger the effect either.
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
    api.places
      .detectBoundary(loc.lat, loc.lon, ac.signal)
      .then((res) => live && setDetected(ringToPts(res.geometry.coordinates[0] ?? [], { lat: loc.lat, lon: loc.lon })))
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

  /** Called when the wizard enters step 2, to pick a sensible starting shape. */
  const begin = useCallback((at: Loc, by: Method | null) => {
    setShape(at.pts ? 'given' : by === 'pin' || by === 'whatsapp' || by === 'coords' ? 'circle' : 'detected');
    setZoom(null);
    setDetected(null);
    setDetectError(null);
    attempted.current = null;
  }, []);

  const metresPerPx = loc ? mpp(loc.lat) : 1;
  const pts: Pt[] = useMemo(() => {
    if (!loc) return [];
    if (shape === 'given' && loc.pts) return loc.pts;
    if (shape === 'circle') return circlePts(radius / metresPerPx, 48);
    if (shape === 'rect') return rectPts(rw / metresPerPx, rh / metresPerPx);
    return detected ?? [];
  }, [loc, shape, radius, rw, rh, detected, metresPerPx]);

  const isCircle = shape === 'circle' || (shape === 'given' && !!loc?.circle);
  /**
   * PROVISIONAL area, for live feedback while the outline is still being edited. The place has
   * no server-side identity yet, so there is no authoritative figure to show. After saving, the
   * toast and every later view use the server's `areaHa`.
   */
  const ha = loc ? approxAreaHa(pts, loc.lat) : 0;
  const fitted = pts.length ? fitZoom(pts, 220) : 15;
  const previewZoom = Math.max(3, Math.min(18, zoom ?? fitted));

  /** How the chosen outline should be described on the saved place. */
  const outlineLabel =
    shape === 'detected'
      ? 'Detected boundary'
      : shape === 'circle'
        ? `Circle, ${radius} m radius`
        : shape === 'rect'
          ? `Rectangle, ${rw} × ${rh} m`
          : (loc?.givenLabel ?? 'Provided');

  return {
    shape, setShape,
    radius, setRadius,
    rw, setRw,
    rh, setRh,
    previewZoom, setZoom,
    detected, detecting, detectError, retryDetect,
    pts, isCircle, ha, fitted, outlineLabel,
    begin,
    method,
  };
}

export type Outline = ReturnType<typeof useOutline>;
